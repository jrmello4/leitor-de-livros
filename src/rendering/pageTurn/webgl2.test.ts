import { describe, expect, it, vi } from 'vitest';
import type { PageTurnScene } from '../../domain/pageTurnScene';
import type { PageDescriptor } from '../../domain/types';
import type { PreparedPageImage, PreparedPageTurnTextures } from './textures';
import { PAGE_TURN_LUMINANCE_BOUNDS, type PageTurnRenderFrame } from './contracts';
import { createPageTurnWebGl2 } from './webgl2';
import { PAGE_TURN_MESH_VERSION } from './mesh';
import { PaperPhysicsSolver } from './physics';

const pages: PageDescriptor[] = [
  { id: 'front', index: 4, name: 'front.png', src: 'asset://front', width: 800, height: 1200 },
  { id: 'verso', index: 5, name: 'verso.png', src: 'asset://verso', width: 800, height: 1200 },
  { id: 'under', index: 6, name: 'under.png', src: 'asset://under', width: 800, height: 1200 },
  { id: 'stationary', index: 3, name: 'stationary.png', src: 'asset://stationary', width: 800, height: 1200 },
];

function createScene(): PageTurnScene {
  return {
    stationary: [pages[3]],
    turningFront: pages[0],
    turningVerso: pages[1],
    under: pages[2],
    committed: [pages[1], pages[2]],
    versoUv: 'back-face-readable',
    generationKey: 'front:verso:under:single:ltr',
  };
}

function createPreparedTextures(): PreparedPageTurnTextures<PreparedPageImage> {
  const bySource = new Map<string, PreparedPageImage>(pages.map((page, index) => [
    page.src,
    {
      bitmap: { label: page.id, width: 800, height: 1200 } as unknown as ImageBitmap,
      width: 800,
      height: 1200,
      bytes: 800 * 1200 * 4 + index,
    },
  ]));

  return {
    bySource,
    count: bySource.size,
    bytes: Array.from(bySource.values()).reduce((total, image) => total + image.bytes, 0),
  };
}

function frameWithMidFold(): PageTurnRenderFrame {
  const solver = new PaperPhysicsSolver({ quality: 'balanced', direction: 'ltr' }).begin({ x: 1, y: 0.5 });
  const physics = solver.step({ pointer: { x: 0.32, y: 0.45 }, elapsedMs: 16.7 });

  return {
    meshVersion: PAGE_TURN_MESH_VERSION,
    controlPoints: physics.controlPoints,
    progress: 0.58,
    grabPoint: physics.grabPoint,
    viewport: { width: 960, height: 1280, dpr: 1.5 },
    luminance: PAGE_TURN_LUMINANCE_BOUNDS,
    quality: 'balanced',
  };
}

describe('createPageTurnWebGl2', () => {
  it('binds front, readable verso, under-page, and stationary textures before drawing', async () => {
    const gl = createRecordingWebGl2Context();
    const canvas = canvasWith(gl);
    const renderer = createPageTurnWebGl2(canvas);

    renderer.resize({ width: 960, height: 1280, dpr: 1.5 });
    await renderer.prepare(createScene(), createPreparedTextures());
    const allocationsAtPrepare = gl.totalAllocations();

    renderer.render(frameWithMidFold());

    expect(gl.textureRoles()).toEqual(['front', 'verso', 'under', 'stationary']);
    expect(gl.totalAllocations()).toBe(allocationsAtPrepare);
    expect(gl.readPixels).not.toHaveBeenCalled();
  });

  it('keeps lighting within 0.72..1.08 and draws a projected shadow before the deforming sheet', async () => {
    const gl = createRecordingWebGl2Context();
    const renderer = createPageTurnWebGl2(canvasWith(gl));

    renderer.resize({ width: 960, height: 1280, dpr: 1.5 });
    await renderer.prepare(createScene(), createPreparedTextures());
    renderer.render(frameWithMidFold());

    expect(gl.lastUniform('u_luminance_min')).toBeCloseTo(0.72, 4);
    expect(gl.lastUniform('u_luminance_max')).toBeCloseTo(1.08, 4);
    expect(gl.drawPasses()).toEqual(['stationary', 'under', 'shadow', 'sheet']);
  });

  it('disposes scene textures without dropping shared mesh resources', async () => {
    const gl = createRecordingWebGl2Context();
    const renderer = createPageTurnWebGl2(canvasWith(gl));

    renderer.resize({ width: 960, height: 1280, dpr: 1.5 });
    await renderer.prepare(createScene(), createPreparedTextures());
    const sharedAllocations = gl.sharedAllocationCount();

    renderer.disposeScene();

    expect(gl.deletedTextureRoles()).toEqual(['front', 'verso', 'under', 'stationary']);
    expect(gl.liveSharedAllocationCount()).toBe(sharedAllocations);
  });

  it('resizes through an explicit path and does not mutate canvas dimensions or framebuffer-sized resources in render', async () => {
    const gl = createRecordingWebGl2Context();
    const canvas = canvasWith(gl, { width: 1, height: 1, clientWidth: 960, clientHeight: 1280 });
    const renderer = createPageTurnWebGl2(canvas);

    renderer.resize({ width: 960, height: 1280, dpr: 1.5 });
    await renderer.prepare(createScene(), createPreparedTextures());
    const assignmentsAfterResize = canvas.dimensionAssignments();
    const framebufferAllocsAfterResize = gl.framebufferSizedAllocations();

    renderer.render(frameWithMidFold());

    expect(canvas.dimensionAssignments()).toEqual(assignmentsAfterResize);
    expect(gl.framebufferSizedAllocations()).toBe(framebufferAllocsAfterResize);
  });
});

function canvasWith(
  gl: RecordingWebGl2Context,
  options?: { width?: number; height?: number; clientWidth?: number; clientHeight?: number },
): HTMLCanvasElement & { dimensionAssignments(): { width: number; height: number } } {
  let width = options?.width ?? 960;
  let height = options?.height ?? 1280;
  const clientWidth = options?.clientWidth ?? width;
  const clientHeight = options?.clientHeight ?? height;
  const assignments = { width: 0, height: 0 };
  return {
    get width() {
      return width;
    },
    set width(value: number) {
      assignments.width += 1;
      width = value;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      assignments.height += 1;
      height = value;
    },
    clientWidth,
    clientHeight,
    getBoundingClientRect: () => ({ width: clientWidth, height: clientHeight }),
    getContext: (kind: string) => kind === 'webgl2' ? gl : null,
    dimensionAssignments: () => ({ ...assignments }),
  } as unknown as HTMLCanvasElement & { dimensionAssignments(): { width: number; height: number } };
}

type NamedHandle = { id: number; role?: string; kind: string };
type NamedLocation = { name: string };

interface RecordingWebGl2Context extends WebGL2RenderingContext {
  totalAllocations(): number;
  sharedAllocationCount(): number;
  liveSharedAllocationCount(): number;
  framebufferSizedAllocations(): number;
  textureRoles(): string[];
  deletedTextureRoles(): string[];
  drawPasses(): string[];
  lastUniform(name: string): number | undefined;
}

function createRecordingWebGl2Context(): RecordingWebGl2Context {
  let nextId = 1;
  let currentTextureUnit = 0;
  let currentPass = 'sheet';
  const program = { id: nextId++, kind: 'program' } as NamedHandle as WebGLProgram;
  const allocations = { buffers: 0, textures: 0, framebuffers: 0, vaos: 0, programs: 1 };
  const liveShared = new Set<number>();
  const boundTexturesByUnit = new Map<number, NamedHandle | undefined>();
  const seenTextureRoles: string[] = [];
  const deletedTextureRoles: string[] = [];
  const drawPasses: string[] = [];
  const uniformValues = new Map<string, number>();
  const readPixels = vi.fn();
  let framebufferSizedAllocs = 0;

  const context = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    TRIANGLES: 0x0004,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE3: 0x84c3,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    COLOR_BUFFER_BIT: 0x4000,
    createShader: (kind: number) => ({ id: nextId++, kind: kind === 0x8b31 ? 'vertex' : 'fragment' }),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => program,
    attachShader: () => undefined,
    linkProgram: () => undefined,
    deleteShader: () => undefined,
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    createVertexArray: () => {
      allocations.vaos += 1;
      const vao = { id: nextId++, kind: 'vao' };
      liveShared.add(vao.id);
      return vao;
    },
    bindVertexArray: () => undefined,
    deleteVertexArray: (handle?: NamedHandle | null) => {
      if (handle) {
        liveShared.delete(handle.id);
      }
    },
    createBuffer: () => {
      allocations.buffers += 1;
      const buffer = { id: nextId++, kind: 'buffer' };
      liveShared.add(buffer.id);
      return buffer;
    },
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    bufferSubData: () => undefined,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    createTexture: () => {
      allocations.textures += 1;
      return { id: nextId++, kind: 'texture' };
    },
    bindTexture: (_target: number, handle?: NamedHandle | null) => {
      boundTexturesByUnit.set(currentTextureUnit, handle ?? undefined);
      if (handle?.role && !seenTextureRoles.includes(handle.role)) {
        seenTextureRoles.push(handle.role);
      }
    },
    texParameteri: () => undefined,
    texImage2D: (...args: unknown[]) => {
      if (args.length >= 9 && args[8] === null) {
        framebufferSizedAllocs += 1;
      }
      return undefined;
    },
    activeTexture: (unit: number) => {
      currentTextureUnit = unit - 0x84c0;
    },
    deleteTexture: (handle?: NamedHandle | null) => {
      if (handle?.role) {
        deletedTextureRoles.push(handle.role);
      }
    },
    createFramebuffer: () => {
      allocations.framebuffers += 1;
      const framebuffer = { id: nextId++, kind: 'framebuffer' };
      liveShared.add(framebuffer.id);
      return framebuffer;
    },
    bindFramebuffer: () => undefined,
    framebufferTexture2D: () => undefined,
    deleteFramebuffer: (handle?: NamedHandle | null) => {
      if (handle) {
        liveShared.delete(handle.id);
      }
    },
    useProgram: () => undefined,
    getUniformLocation: (_program: WebGLProgram, name: string) => ({ name }) as NamedLocation as WebGLUniformLocation,
    uniform1i: (location: NamedLocation, value: number) => {
      if (location.name === 'u_pass') {
        currentPass = value === 0 ? 'stationary' : value === 1 ? 'under' : value === 2 ? 'shadow' : 'sheet';
      }
      uniformValues.set(location.name, value);
    },
    uniform1f: (location: NamedLocation, value: number) => {
      uniformValues.set(location.name, value);
    },
    uniform2f: () => undefined,
    uniform4fv: () => undefined,
    getAttribLocation: (_program: WebGLProgram, name: string) => (
      name === 'a_position' ? 0 : name === 'a_uv' ? 1 : 2
    ),
    viewport: () => undefined,
    clearColor: () => undefined,
    clear: () => undefined,
    drawElements: () => {
      drawPasses.push(currentPass);
    },
    deleteProgram: () => undefined,
    readPixels,
    totalAllocations: () => allocations.buffers + allocations.textures + allocations.framebuffers + allocations.vaos + allocations.programs,
    sharedAllocationCount: () => allocations.buffers + allocations.framebuffers + allocations.vaos + allocations.programs,
    liveSharedAllocationCount: () => liveShared.size + 1,
    framebufferSizedAllocations: () => framebufferSizedAllocs,
    textureRoles: () => seenTextureRoles.slice(),
    deletedTextureRoles: () => deletedTextureRoles.slice(),
    drawPasses: () => drawPasses.slice(),
    lastUniform: (name: string) => uniformValues.get(name),
  } as unknown as RecordingWebGl2Context;

  return context;
}
