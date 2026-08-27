import { buildRenderPlan, type RenderBackendKind, type RenderFrame, type RenderQuality } from './contracts';

export interface CanvasRenderer {
  readonly kind: Exclude<RenderBackendKind, 'static'>;
  render(frame: RenderFrame, quality: RenderQuality): Promise<void>;
  dispose(): void;
}

type GpuApi = {
  requestAdapter: (options?: unknown) => Promise<any>;
  getPreferredCanvasFormat: () => string;
};

class ImageStore {
  private readonly images = new Map<string, Promise<HTMLImageElement>>();

  retain(sources: string[]): void {
    const keep = new Set(sources);
    for (const source of this.images.keys()) {
      if (!keep.has(source)) {
        this.images.delete(source);
      }
    }
  }

  async get(source: string): Promise<HTMLImageElement> {
    let image = this.images.get(source);
    if (!image) {
      image = new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.decoding = 'async';
        element.crossOrigin = 'anonymous';
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error(`Could not decode reader page: ${source}`));
        element.src = source;
        if (element.complete && element.naturalWidth > 0) {
          resolve(element);
        }
      });
      this.images.set(source, image);
    }
    return image;
  }

  preload(sources: string[]): void {
    for (const source of sources) {
      void this.get(source).catch(() => undefined);
    }
  }

  clear(): void {
    this.images.clear();
  }
}

function canvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = typeof window === 'undefined' ? 1 : Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const width = Math.max(1, Math.round((bounds.width || canvas.clientWidth || 1) * pixelRatio));
  const height = Math.max(1, Math.round((bounds.height || canvas.clientHeight || 1) * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

function textureSources(frame: RenderFrame): string[] {
  return [...frame.pages, ...frame.preloadPages].map((page) => page.src);
}

function shadowStrength(quality: RenderQuality, shade: number): number {
  const multiplier = quality === 'rich' ? 0.38 : quality === 'balanced' ? 0.23 : 0.08;
  return shade * multiplier;
}

function sheetVertices(
  sheet: ReturnType<typeof buildRenderPlan>[number],
  width: number,
  height: number,
  quality: RenderQuality,
): Float32Array {
  const left = (sheet.x / width) * 2 - 1;
  const right = ((sheet.x + sheet.width) / width) * 2 - 1;
  const top = 1 - (sheet.y / height) * 2;
  const bottom = 1 - ((sheet.y + sheet.height) / height) * 2;
  const shade = shadowStrength(quality, sheet.shade);
  return new Float32Array([
    left, top, 0, 0, shade,
    left, bottom, 0, 1, shade,
    right, top, 1, 0, shade,
    right, bottom, 1, 1, shade,
  ]);
}

function compileWebGlProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    throw new Error('WebGL2 could not allocate reader shaders.');
  }
  gl.shaderSource(vertex, `#version 300 es
    in vec2 a_position;
    in vec2 a_uv;
    in float a_shade;
    out vec2 v_uv;
    out float v_shade;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_uv = a_uv;
      v_shade = a_shade;
    }
  `);
  gl.shaderSource(fragment, `#version 300 es
    precision mediump float;
    uniform sampler2D u_page;
    in vec2 v_uv;
    in float v_shade;
    out vec4 out_color;
    void main() {
      vec4 page = texture(u_page, v_uv);
      float fold = 1.0 - v_shade * (0.35 + v_uv.x * 0.65);
      out_color = vec4(page.rgb * fold, page.a);
    }
  `);
  gl.compileShader(vertex);
  gl.compileShader(fragment);
  if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(vertex) || gl.getShaderInfoLog(fragment) || 'Unknown shader error.';
    throw new Error(`WebGL2 reader shader failed: ${message}`);
  }
  const program = gl.createProgram();
  if (!program) {
    throw new Error('WebGL2 could not create the reader program.');
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL2 reader program failed: ${gl.getProgramInfoLog(program) || 'Unknown link error.'}`);
  }
  return program;
}

export function createWebGl2Backend(canvas: HTMLCanvasElement): CanvasRenderer {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false });
  if (!gl) {
    throw new Error('WebGL2 is not available.');
  }
  const program = compileWebGlProgram(gl);
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('WebGL2 could not allocate a page buffer.');
  }
  const position = gl.getAttribLocation(program, 'a_position');
  const uv = gl.getAttribLocation(program, 'a_uv');
  const shade = gl.getAttribLocation(program, 'a_shade');
  const pageUniform = gl.getUniformLocation(program, 'u_page');
  const images = new ImageStore();
  const textures = new Map<string, WebGLTexture>();
  let disposed = false;

  const retainTextures = (sources: string[]) => {
    const keep = new Set(sources.slice(0, 3));
    for (const [source, texture] of textures) {
      if (!keep.has(source)) {
        gl.deleteTexture(texture);
        textures.delete(source);
      }
    }
  };

  const textureFor = (source: string, image: HTMLImageElement): WebGLTexture => {
    const existing = textures.get(source);
    if (existing) {
      return existing;
    }
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('WebGL2 could not allocate a page texture.');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    try {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } catch {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    textures.set(source, texture);
    return texture;
  };

  return {
    kind: 'webgl2',
    async render(frame, quality) {
      if (disposed) {
        return;
      }
      const size = canvasSize(canvas);
      const plan = buildRenderPlan(frame, size.width, size.height);
      const sources = textureSources(frame);
      images.retain(sources);
      images.preload(sources);
      retainTextures(sources);
      const decoded = await Promise.all(plan.map(async (sheet) => ({ sheet, image: await images.get(sheet.page.src) })));
      if (disposed) {
        return;
      }

      gl.viewport(0, 0, size.width, size.height);
      gl.clearColor(0.055, 0.11, 0.13, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 8);
      gl.enableVertexAttribArray(shade);
      gl.vertexAttribPointer(shade, 1, gl.FLOAT, false, 20, 16);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(pageUniform, 0);

      for (const { sheet, image } of decoded) {
        gl.bufferData(gl.ARRAY_BUFFER, sheetVertices(sheet, size.width, size.height, quality), gl.DYNAMIC_DRAW);
        gl.bindTexture(gl.TEXTURE_2D, textureFor(sheet.page.src, image));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const texture of textures.values()) {
        gl.deleteTexture(texture);
      }
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      images.clear();
    },
  };
}

export async function createWebGpuBackend(
  canvas: HTMLCanvasElement,
  onDeviceLost: () => void,
): Promise<CanvasRenderer> {
  const gpu = (navigator as Navigator & { gpu?: GpuApi }).gpu;
  if (!gpu) {
    throw new Error('WebGPU is not available.');
  }
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('WebGPU could not select an adapter.');
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu') as unknown as any;
  const textureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: Record<string, number> }).GPUTextureUsage;
  const bufferUsage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage;
  if (!context || !textureUsage || !bufferUsage) {
    throw new Error('WebGPU canvas support is unavailable.');
  }

  const format = gpu.getPreferredCanvasFormat();
  const shader = device.createShaderModule({
    code: `
      struct VertexInput {
        @location(0) position: vec2<f32>,
        @location(1) uv: vec2<f32>,
        @location(2) shade: f32,
      };
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) shade: f32,
      };
      @group(0) @binding(0) var page_sampler: sampler;
      @group(0) @binding(1) var page_texture: texture_2d<f32>;
      @vertex fn vertex_main(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4<f32>(input.position, 0.0, 1.0);
        output.uv = input.uv;
        output.shade = input.shade;
        return output;
      }
      @fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let page = textureSample(page_texture, page_sampler, input.uv);
        let fold = 1.0 - input.shade * (0.35 + input.uv.x * 0.65);
        return vec4<f32>(page.rgb * fold, page.a);
      }
    `,
  });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: 'vertex_main',
      buffers: [{
        arrayStride: 20,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x2' },
          { shaderLocation: 2, offset: 16, format: 'float32' },
        ],
      }],
    },
    fragment: {
      module: shader,
      entryPoint: 'fragment_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-strip' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const images = new ImageStore();
  const textures = new Map<string, { texture: any; bindGroup: any }>();
  const rasterSources = new Map<string, HTMLCanvasElement>();
  let vertexBuffer: any;
  let vertexCapacity = 0;
  let configuredSize = '';
  let disposed = false;

  const retainTextures = (sources: string[]) => {
    const keep = new Set(sources.slice(0, 3));
    for (const [source, entry] of textures) {
      if (!keep.has(source)) {
        entry.texture.destroy();
        textures.delete(source);
        rasterSources.delete(source);
      }
    }
  };

  const rasterSourceFor = (source: string, image: HTMLImageElement): HTMLCanvasElement => {
    const existing = rasterSources.get(source);
    if (existing) {
      return existing;
    }
    const raster = document.createElement('canvas');
    raster.width = image.naturalWidth;
    raster.height = image.naturalHeight;
    const context2d = raster.getContext('2d');
    if (!context2d) {
      throw new Error('WebGPU could not prepare a reader page texture.');
    }
    context2d.drawImage(image, 0, 0);
    rasterSources.set(source, raster);
    return raster;
  };

  const textureFor = (source: string, image: HTMLImageElement) => {
    const existing = textures.get(source);
    if (existing) {
      return existing;
    }
    const raster = rasterSourceFor(source, image);
    const texture = device.createTexture({
      size: [raster.width, raster.height, 1],
      format: 'rgba8unorm',
      usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST,
    });
    const rasterContext = raster.getContext('2d');
    if (!rasterContext) {
      throw new Error('WebGPU could not read a prepared reader page texture.');
    }
    const pixels = rasterContext.getImageData(0, 0, raster.width, raster.height);
    device.queue.writeTexture(
      { texture },
      pixels.data,
      { bytesPerRow: raster.width * 4, rowsPerImage: raster.height },
      [raster.width, raster.height, 1],
    );
    const entry = {
      texture,
      bindGroup: device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: texture.createView() },
        ],
      }),
    };
    textures.set(source, entry);
    return entry;
  };

  const ensureVertexBuffer = (size: number) => {
    if (vertexBuffer && vertexCapacity >= size) {
      return;
    }
    vertexBuffer?.destroy();
    vertexCapacity = Math.max(size, 320);
    vertexBuffer = device.createBuffer({
      size: vertexCapacity,
      usage: bufferUsage.VERTEX | bufferUsage.COPY_DST,
    });
  };

  void device.lost.then(() => {
    if (!disposed) {
      onDeviceLost();
    }
  });

  return {
    kind: 'webgpu',
    async render(frame, quality) {
      if (disposed) {
        return;
      }
      const size = canvasSize(canvas);
      const sizeKey = `${size.width}x${size.height}`;
      if (configuredSize !== sizeKey) {
        context.configure({ device, format, alphaMode: 'opaque' });
        configuredSize = sizeKey;
      }
      const plan = buildRenderPlan(frame, size.width, size.height);
      const sources = textureSources(frame);
      images.retain(sources);
      images.preload(sources);
      retainTextures(sources);
      const decoded = await Promise.all(plan.map(async (sheet) => ({ sheet, image: await images.get(sheet.page.src) })));
      if (disposed) {
        return;
      }

      const prepared = decoded.map(({ sheet, image }) => ({ sheet, texture: textureFor(sheet.page.src, image) }));
      const vertices = new Float32Array(prepared.length * 20);
      prepared.forEach(({ sheet }, index) => vertices.set(sheetVertices(sheet, size.width, size.height, quality), index * 20));
      ensureVertexBuffer(vertices.byteLength);
      device.queue.writeBuffer(vertexBuffer, 0, vertices.buffer);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.055, g: 0.11, b: 0.13, a: 1 },
        }],
      });
      pass.setPipeline(pipeline);
      prepared.forEach(({ texture }, index) => {
        pass.setBindGroup(0, texture.bindGroup);
        pass.setVertexBuffer(0, vertexBuffer, index * 80, 80);
        pass.draw(4);
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      vertexBuffer?.destroy();
      for (const entry of textures.values()) {
        entry.texture.destroy();
      }
      rasterSources.clear();
      images.clear();
    },
  };
}
