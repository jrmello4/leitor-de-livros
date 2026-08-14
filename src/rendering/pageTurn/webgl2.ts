import type { PageTurnScene } from '../../domain/pageTurnScene';
import type { RenderQuality } from '../contracts';
import { createPageTurnMesh, PAGE_TURN_MESH_VERSION, QUALITY_TOPOLOGY } from './mesh';
import {
  PAGE_TURN_LUMINANCE_BOUNDS,
  type PageTurnBackend,
  type PageTurnRenderFrame,
} from './contracts';
import type { PreparedPageImage, PreparedPageTurnTextures } from './textures';
import { PAGE_TURN_WEBGL2_FRAGMENT_SHADER, PAGE_TURN_WEBGL2_VERTEX_SHADER } from './webgl2Shaders';

type SemanticRole = 'front' | 'verso' | 'under' | 'stationary';

interface SharedMeshResources {
  vao: WebGLVertexArrayObject;
  positionBuffer: WebGLBuffer;
  uvBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  indexCount: number;
}

interface RoleTexture {
  texture: WebGLTexture;
  role: SemanticRole;
}

interface ProgramUniforms {
  front: WebGLUniformLocation;
  verso: WebGLUniformLocation;
  under: WebGLUniformLocation;
  stationary: WebGLUniformLocation;
  pass: WebGLUniformLocation;
  progress: WebGLUniformLocation;
  grabPoint: WebGLUniformLocation;
  controlColumns: WebGLUniformLocation;
  controlRows: WebGLUniformLocation;
  controlPositions: WebGLUniformLocation;
  controlNormals: WebGLUniformLocation;
  luminanceMin: WebGLUniformLocation;
  luminanceMax: WebGLUniformLocation;
}

const MAX_CONTROL_POINTS = QUALITY_TOPOLOGY.rich.controlColumns * QUALITY_TOPOLOGY.rich.controlRows;
const PAPER_PIXEL = new Uint8Array([232, 232, 228, 255]);

export function createPageTurnWebGl2(canvas: HTMLCanvasElement): PageTurnBackend {
  const context = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });

  if (!context) {
    throw new Error('WebGL2 is not available.');
  }

  const gl = context;

  let disposed = false;
  let preparedScene: PageTurnScene | undefined;
  let preparedTextureMeta = { count: 0, bytes: 0 };
  let program: WebGLProgram | undefined;
  let uniforms: ProgramUniforms | undefined;
  const meshResources = new Map<RenderQuality, SharedMeshResources>();
  const sceneTextures = new Map<SemanticRole, RoleTexture>();
  let shadowTexture: WebGLTexture | undefined;
  let shadowFramebuffer: WebGLFramebuffer | undefined;

  function ensureProgram(): void {
    if (program && uniforms) {
      return;
    }

    const vertex = compileShader(gl, gl.VERTEX_SHADER, PAGE_TURN_WEBGL2_VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, PAGE_TURN_WEBGL2_FRAGMENT_SHADER);
    const linked = gl.createProgram();

    if (!linked) {
      throw new Error('WebGL2 could not create the page-turn program.');
    }

    gl.attachShader(linked, vertex);
    gl.attachShader(linked, fragment);
    gl.linkProgram(linked);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(linked) || 'WebGL2 could not link the page-turn program.');
    }

    program = linked;
    uniforms = {
      front: requiredUniform(gl, linked, 'u_front'),
      verso: requiredUniform(gl, linked, 'u_verso'),
      under: requiredUniform(gl, linked, 'u_under'),
      stationary: requiredUniform(gl, linked, 'u_stationary'),
      pass: requiredUniform(gl, linked, 'u_pass'),
      progress: requiredUniform(gl, linked, 'u_progress'),
      grabPoint: requiredUniform(gl, linked, 'u_grab_point'),
      controlColumns: requiredUniform(gl, linked, 'u_control_columns'),
      controlRows: requiredUniform(gl, linked, 'u_control_rows'),
      controlPositions: requiredUniform(gl, linked, 'u_control_positions'),
      controlNormals: requiredUniform(gl, linked, 'u_control_normals'),
      luminanceMin: requiredUniform(gl, linked, 'u_luminance_min'),
      luminanceMax: requiredUniform(gl, linked, 'u_luminance_max'),
    };
  }

  function ensureMeshResources(): void {
    ensureProgram();

    for (const quality of ['rich', 'balanced', 'essential'] as const satisfies RenderQuality[]) {
      if (meshResources.has(quality)) {
        continue;
      }

      const mesh = createPageTurnMesh(quality);
      const vao = required(gl.createVertexArray(), 'WebGL2 could not allocate a vertex array.');
      const positionBuffer = required(gl.createBuffer(), 'WebGL2 could not allocate the position buffer.');
      const uvBuffer = required(gl.createBuffer(), 'WebGL2 could not allocate the UV buffer.');
      const indexBuffer = required(gl.createBuffer(), 'WebGL2 could not allocate the index buffer.');
      const positionLocation = gl.getAttribLocation(program!, 'a_position');
      const uvLocation = gl.getAttribLocation(program!, 'a_uv');

      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(uvLocation);
      gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      meshResources.set(quality, {
        vao,
        positionBuffer,
        uvBuffer,
        indexBuffer,
        indexCount: mesh.indexCount,
      });
    }
  }

  function ensureShadowResources(): void {
    if (shadowTexture && shadowFramebuffer) {
      return;
    }

    const width = Math.max(1, canvas.width || canvas.clientWidth || 1);
    const height = Math.max(1, canvas.height || canvas.clientHeight || 1);
    shadowTexture = required(gl.createTexture(), 'WebGL2 could not allocate the page-turn shadow texture.');
    shadowFramebuffer = required(gl.createFramebuffer(), 'WebGL2 could not allocate the page-turn shadow framebuffer.');

    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  async function prepare(scene: PageTurnScene, textures: PreparedPageTurnTextures<PreparedPageImage>): Promise<void> {
    if (disposed) {
      return;
    }

    ensureProgram();
    ensureMeshResources();
    ensureShadowResources();
    disposeScene();

    preparedScene = scene;
    preparedTextureMeta = {
      count: textures.count,
      bytes: textures.bytes,
    };

    sceneTextures.set('front', createRoleTexture('front', textures.bySource.get(scene.turningFront.src)));
    sceneTextures.set('verso', createRoleTexture('verso', textures.bySource.get(scene.turningVerso.src)));
    sceneTextures.set('under', createRoleTexture('under', textures.bySource.get(scene.under?.src ?? '') ?? textures.bySource.get(scene.turningVerso.src)));
    sceneTextures.set(
      'stationary',
      createRoleTexture('stationary', textures.bySource.get(scene.stationary[0]?.src ?? '') ?? textures.bySource.get(scene.turningFront.src)),
    );
  }

  function render(frame: PageTurnRenderFrame): void {
    if (disposed || !preparedScene || !program || !uniforms) {
      return;
    }

    if (frame.meshVersion !== PAGE_TURN_MESH_VERSION) {
      throw new Error(`Unsupported page-turn mesh version ${frame.meshVersion}.`);
    }

    const mesh = required(meshResources.get(frame.quality), 'WebGL2 mesh resources were not prepared.');
    const topology = QUALITY_TOPOLOGY[frame.quality];
    const width = Math.max(1, Math.round(frame.viewport.width * Math.max(frame.viewport.dpr, 1)));
    const height = Math.max(1, Math.round(frame.viewport.height * Math.max(frame.viewport.dpr, 1)));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(mesh.vao);
    bindSceneTextures(gl, uniforms, sceneTextures);
    uploadControlPoints(gl, uniforms, frame.controlPoints);

    gl.uniform1i(uniforms.front, 0);
    gl.uniform1i(uniforms.verso, 1);
    gl.uniform1i(uniforms.under, 2);
    gl.uniform1i(uniforms.stationary, 3);
    gl.uniform1i(uniforms.controlColumns, topology.controlColumns);
    gl.uniform1i(uniforms.controlRows, topology.controlRows);
    gl.uniform1f(uniforms.progress, frame.progress);
    gl.uniform2f(uniforms.grabPoint, frame.grabPoint.x, frame.grabPoint.y);
    gl.uniform1f(uniforms.luminanceMin, clamp(frame.luminance.minimum, PAGE_TURN_LUMINANCE_BOUNDS.minimum, PAGE_TURN_LUMINANCE_BOUNDS.maximum));
    gl.uniform1f(uniforms.luminanceMax, clamp(frame.luminance.maximum, PAGE_TURN_LUMINANCE_BOUNDS.minimum, PAGE_TURN_LUMINANCE_BOUNDS.maximum));

    for (const pass of [0, 1, 2, 3] as const) {
      gl.uniform1i(uniforms.pass, pass);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }

    gl.bindVertexArray(null);
  }

  function disposeScene(): void {
    for (const entry of sceneTextures.values()) {
      gl.deleteTexture(entry.texture);
    }
    sceneTextures.clear();
    preparedScene = undefined;
    preparedTextureMeta = { count: 0, bytes: 0 };
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    disposeScene();

    for (const resources of meshResources.values()) {
      gl.deleteBuffer(resources.positionBuffer);
      gl.deleteBuffer(resources.uvBuffer);
      gl.deleteBuffer(resources.indexBuffer);
      gl.deleteVertexArray(resources.vao);
    }
    meshResources.clear();

    if (shadowFramebuffer) {
      gl.deleteFramebuffer(shadowFramebuffer);
      shadowFramebuffer = undefined;
    }

    if (shadowTexture) {
      gl.deleteTexture(shadowTexture);
      shadowTexture = undefined;
    }

    if (program) {
      gl.deleteProgram(program);
      program = undefined;
      uniforms = undefined;
    }
  }

  function createRoleTexture(role: SemanticRole, image?: PreparedPageImage): RoleTexture {
    const texture = required(gl.createTexture(), `WebGL2 could not allocate the ${role} texture.`);
    const tagged = texture as WebGLTexture & { role?: SemanticRole };
    tagged.role = role;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (image?.bitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image.bitmap as unknown as TexImageSource);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, PAPER_PIXEL);
    }

    return { texture, role };
  }

  return {
    kind: 'webgl2',
    prepare,
    render,
    disposeScene,
    dispose,
  };
}

function compileShader(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (!shader) {
    throw new Error('WebGL2 could not allocate a page-turn shader.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'WebGL2 could not compile a page-turn shader.');
  }
  return shader;
}

function requiredUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`WebGL2 page-turn uniform ${name} is missing.`);
  }
  return location;
}

function bindSceneTextures(
  gl: WebGL2RenderingContext,
  uniforms: ProgramUniforms,
  textures: Map<SemanticRole, RoleTexture>,
): void {
  bindRole(gl, textures, 'front', gl.TEXTURE0);
  bindRole(gl, textures, 'verso', gl.TEXTURE1);
  bindRole(gl, textures, 'under', gl.TEXTURE2);
  bindRole(gl, textures, 'stationary', gl.TEXTURE3);
  gl.uniform1i(uniforms.front, 0);
  gl.uniform1i(uniforms.verso, 1);
  gl.uniform1i(uniforms.under, 2);
  gl.uniform1i(uniforms.stationary, 3);
}

function bindRole(gl: WebGL2RenderingContext, textures: Map<SemanticRole, RoleTexture>, role: SemanticRole, unit: number): void {
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, required(textures.get(role), `WebGL2 ${role} texture was not prepared.`).texture);
}

function uploadControlPoints(
  gl: WebGL2RenderingContext,
  uniforms: ProgramUniforms,
  controlPoints: Float32Array,
): void {
  const positions = new Float32Array(MAX_CONTROL_POINTS * 4);
  const normals = new Float32Array(MAX_CONTROL_POINTS * 4);
  const count = Math.min(MAX_CONTROL_POINTS, Math.floor(controlPoints.length / 6));

  for (let index = 0; index < count; index += 1) {
    const source = index * 6;
    const target = index * 4;
    positions[target] = controlPoints[source];
    positions[target + 1] = controlPoints[source + 1];
    positions[target + 2] = controlPoints[source + 2];
    positions[target + 3] = 1;
    normals[target] = controlPoints[source + 3];
    normals[target + 1] = controlPoints[source + 4];
    normals[target + 2] = controlPoints[source + 5];
    normals[target + 3] = 0;
  }

  gl.uniform4fv(uniforms.controlPositions, positions);
  gl.uniform4fv(uniforms.controlNormals, normals);
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
