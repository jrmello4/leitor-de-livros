import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageTurnScene } from '../../domain/pageTurnScene';
import type { PageDescriptor, ReadingDirection } from '../../domain/types';
import type { PageTurnPhysicsFrame } from './physics';
import { PAGE_TURN_MESH_VERSION } from './mesh';
import { PAGE_TURN_LUMINANCE_BOUNDS, type PageTurnMetrics } from './contracts';
import { PageTurnSurface, type PageTurnSurfaceState } from './PageTurnSurface';

const backend = {
  kind: 'webgl2' as const,
  prepare: vi.fn(async () => undefined),
  resize: vi.fn(() => undefined),
  render: vi.fn(() => undefined),
  disposeScene: vi.fn(() => undefined),
  dispose: vi.fn(() => undefined),
};

vi.mock('./webgl2', () => ({
  createPageTurnWebGl2: vi.fn(() => backend),
}));

vi.mock('./textures', () => ({
  PageTurnTextureCache: class {
    async prepare(_scene: PageTurnScene, generation: number) {
      return {
        kind: 'ready',
        generation,
        waitedMs: 0,
        textures: {
          bySource: new Map([
            ['asset://front', { bitmap: { width: 800, height: 1200 }, width: 800, height: 1200, bytes: 1 }],
            ['asset://verso', { bitmap: { width: 800, height: 1200 }, width: 800, height: 1200, bytes: 1 }],
            ['asset://under', { bitmap: { width: 800, height: 1200 }, width: 800, height: 1200, bytes: 1 }],
            ['asset://stationary', { bitmap: { width: 800, height: 1200 }, width: 800, height: 1200, bytes: 1 }],
          ]),
          count: 4,
          bytes: 4,
        },
      };
    }

    releaseGeneration() {
      return undefined;
    }

    dispose() {
      return undefined;
    }
  },
}));

const pages: PageDescriptor[] = [
  { id: 'front', index: 4, name: 'front.png', src: 'asset://front', width: 800, height: 1200 },
  { id: 'verso', index: 5, name: 'verso.png', src: 'asset://verso', width: 800, height: 1200 },
  { id: 'under', index: 6, name: 'under.png', src: 'asset://under', width: 800, height: 1200 },
  { id: 'stationary', index: 3, name: 'stationary.png', src: 'asset://stationary', width: 800, height: 1200 },
];

function scene(): PageTurnScene {
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

function readyFrame(
  direction: ReadingDirection,
  progress: number,
  invalidReason?: PageTurnPhysicsFrame['invalidReason'],
  settled?: 'commit' | 'cancel',
): PageTurnPhysicsFrame {
  return {
    controlPoints: new Float32Array([0, 0, 0, 0, 0, 1]),
    points: [{ x: 0, y: 0, z: 0 }],
    grabPoint: direction === 'rtl' ? { x: 0, y: 0.5 } : { x: 1, y: 0.5 },
    substeps: 1,
    droppedSeconds: 0,
    maxStretch: 0,
    maxSpeed: settled ? 0.005 : 0.1,
    invalidReason,
    pointAt: () => ({ x: progress, y: 0.5, z: 0 }),
    settled,
  } as PageTurnPhysicsFrame;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function idleState(): PageTurnSurfaceState {
  return { phase: 'idle' };
}

function draggingState(progress = 0.42): PageTurnSurfaceState {
  return {
    phase: 'dragging',
    direction: 'ltr',
    progress,
    frame: readyFrame('ltr', progress),
  };
}

function settlingState(outcome: 'commit' | 'cancel', progress: number): PageTurnSurfaceState {
  return {
    phase: 'settling',
    direction: 'ltr',
    outcome,
    progress,
    frame: readyFrame('ltr', progress),
  };
}

let cancelledRafIds = new Set<number>();

describe('PageTurnSurface', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafQueue: Array<{ id: number; callback: (time: number) => void }>;
  let nextRafId: number;

  beforeEach(() => {
    backend.prepare.mockClear();
    backend.resize.mockClear();
    backend.render.mockClear();
    backend.disposeScene.mockClear();
    backend.dispose.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    rafQueue = [];
    cancelledRafIds = new Set<number>();
    nextRafId = 1;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
      const id = nextRafId++;
      rafQueue.push({ id, callback });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelledRafIds.add(id);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders nothing while idle, then mounts a decorative canvas after prepare and reports readiness', async () => {
    const onReady = vi.fn();
    const onMetrics = vi.fn<(metrics: PageTurnMetrics) => void>();
    const view = renderSurface(root, container, {
      scene: scene(),
      generation: 8,
      state: idleState(),
      quality: 'balanced',
      onReady,
      onSettled: vi.fn(),
      onFailure: vi.fn(),
      onMetrics,
    });

    expect(view.canvas()).toBeNull();

    await view.rerender({ state: draggingState(0.52) });
    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);

    const canvas = view.canvas();
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
    expect(canvas?.getAttribute('data-turn-backend')).toBe('webgl2');
    expect(canvas?.getAttribute('data-mesh-version')).toBe(String(PAGE_TURN_MESH_VERSION));
    expect(backend.prepare).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(8);
    expect(backend.render).toHaveBeenCalledTimes(1);
    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'webgl2',
      generation: 8,
      meshVersion: PAGE_TURN_MESH_VERSION,
      progress: 0.52,
      quality: 'balanced',
      textureCount: 4,
    }));
  });

  it('notifies settled once the active frame reports a matching settled flag', async () => {
    const onSettled = vi.fn();
    const view = renderSurface(root, container, {
      scene: scene(),
      generation: 9,
      state: draggingState(0.68),
      quality: 'rich',
      onReady: vi.fn(),
      onSettled,
      onFailure: vi.fn(),
      onMetrics: vi.fn(),
    });

    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);
    await view.rerender({
      state: {
        phase: 'settling',
        direction: 'ltr',
        outcome: 'commit',
        progress: 1,
        frame: readyFrame('ltr', 1, undefined, 'commit'),
      },
    });
    await flushAnimationFrame(rafQueue, 33.4);

    expect(onSettled).toHaveBeenCalledWith({ generation: 9, outcome: 'commit' });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('waits for the physics frame settled flag instead of terminal progress alone', async () => {
    const onSettled = vi.fn();
    const view = renderSurface(root, container, {
      scene: scene(),
      generation: 14,
      state: {
        phase: 'settling',
        direction: 'ltr',
        outcome: 'commit',
        progress: 1,
        frame: readyFrame('ltr', 1),
      },
      quality: 'balanced',
      onReady: vi.fn(),
      onSettled,
      onFailure: vi.fn(),
      onMetrics: vi.fn(),
    });

    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);

    expect(onSettled).not.toHaveBeenCalled();

    await view.rerender({
      state: {
        phase: 'settling',
        direction: 'ltr',
        outcome: 'commit',
        progress: 1,
        frame: readyFrame('ltr', 1, undefined, 'commit'),
      },
    });
    await flushAnimationFrame(rafQueue, 33.4);

    expect(onSettled).toHaveBeenCalledWith({ generation: 14, outcome: 'commit' });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('cancels the generation and reports backend failure on context loss', async () => {
    const onFailure = vi.fn();
    const view = renderSurface(root, container, {
      scene: scene(),
      generation: 10,
      state: draggingState(0.4),
      quality: 'essential',
      onReady: vi.fn(),
      onSettled: vi.fn(),
      onFailure,
      onMetrics: vi.fn(),
    });

    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);
    const event = new Event('webglcontextlost', { cancelable: true });
    await act(async () => {
      view.canvas()?.dispatchEvent(event);
    });

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'backend' }));
    expect(backend.disposeScene).toHaveBeenCalled();
  });

  it('ignores a late backend prepare resolution after context loss', async () => {
    const deferred = createDeferred<void>();
    backend.prepare.mockImplementationOnce(async () => {
      await deferred.promise;
      return undefined;
    });
    const onReady = vi.fn();
    const onFailure = vi.fn();
    const onMetrics = vi.fn();
    const view = renderSurface(root, container, {
      scene: scene(),
      generation: 10,
      state: draggingState(0.4),
      quality: 'essential',
      onReady,
      onSettled: vi.fn(),
      onFailure,
      onMetrics,
    });

    await settleAsyncEffects();
    expect(backend.prepare).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    const event = new Event('webglcontextlost', { cancelable: true });
    await act(async () => {
      view.canvas()?.dispatchEvent(event);
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    deferred.resolve();
    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(backend.render).not.toHaveBeenCalled();
    expect(onMetrics).not.toHaveBeenCalled();
  });

  it('reports solver failure when the provided frame becomes invalid', async () => {
    const onFailure = vi.fn();
    renderSurface(root, container, {
      scene: scene(),
      generation: 11,
      state: {
        phase: 'dragging',
        direction: 'ltr',
        progress: 0.3,
        frame: readyFrame('ltr', 0.3, 'non-finite-output'),
      },
      quality: 'balanced',
      onReady: vi.fn(),
      onSettled: vi.fn(),
      onFailure,
      onMetrics: vi.fn(),
    });

    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'solver',
      diagnostic: expect.stringContaining('non-finite-output'),
    }));
  });

  it('disposes prepared scene resources when the surface returns to idle', async () => {
    const view = renderSurface(root, container, {
      scene: scene(),
      generation: 12,
      state: draggingState(0.37),
      quality: 'balanced',
      onReady: vi.fn(),
      onSettled: vi.fn(),
      onFailure: vi.fn(),
      onMetrics: vi.fn(),
    });

    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);
    expect(backend.disposeScene).not.toHaveBeenCalled();

    await view.rerender({ state: idleState() });

    expect(view.canvas()).toBeNull();
    expect(backend.disposeScene).toHaveBeenCalledTimes(1);
  });

  it('propagates active viewport and dpr changes through the explicit resize path', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    renderSurface(root, container, {
      scene: scene(),
      generation: 13,
      state: draggingState(0.44),
      quality: 'balanced',
      onReady: vi.fn(),
      onSettled: vi.fn(),
      onFailure: vi.fn(),
      onMetrics: vi.fn(),
    });

    await settleAsyncEffects();
    await flushAnimationFrame(rafQueue, 16.7);
    const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="page-turn-canvas"]');
    expect(canvas).not.toBeNull();
    expect(backend.resize).toHaveBeenCalledTimes(1);

    Object.defineProperty(canvas!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 720, height: 960 }),
    });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });

    await flushAnimationFrame(rafQueue, 33.4);

    expect(backend.resize).toHaveBeenCalledTimes(2);
    expect(backend.resize).toHaveBeenLastCalledWith({ width: 720, height: 960, dpr: 2 });
  });
});

function renderSurface(root: Root, container: HTMLDivElement, props: ComponentProps<typeof PageTurnSurface>) {
  let current = props;

  act(() => root.render(<PageTurnSurface {...current} />));

  return {
    canvas: () => container.querySelector<HTMLCanvasElement>('[data-testid="page-turn-canvas"]'),
    rerender: async (overrides: Partial<ComponentProps<typeof PageTurnSurface>>) => {
      current = { ...current, ...overrides };
      await act(async () => {
        root.render(<PageTurnSurface {...current} />);
      });
    },
  };
}

async function flushAnimationFrame(queue: Array<{ id: number; callback: (time: number) => void }>, time: number) {
  let entry = queue.shift();
  while (entry && cancelledRafIds.has(entry.id)) {
    entry = queue.shift();
  }

  if (!entry) {
    return;
  }

  await act(async () => {
    entry.callback(time);
    await Promise.resolve();
  });
}

async function settleAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}
