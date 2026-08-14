import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageTurnScene } from '../../domain/pageTurnScene';
import type { PageDescriptor } from '../../domain/types';
import { PageTurnTextureCache } from './textures';

function createPage(
  id: string,
  src: string,
  width = 7000,
  height = 5000,
): PageDescriptor {
  return {
    id,
    index: Number(id.replace(/\D/g, '')) || 0,
    name: id,
    src,
    width,
    height,
  };
}

function createScene(overrides?: Partial<PageTurnScene>): PageTurnScene {
  const front = createPage('p1', 'asset://front');
  const verso = createPage('p2', 'asset://verso');
  const under = createPage('p3', 'asset://under');

  return {
    stationary: [],
    turningFront: front,
    turningVerso: verso,
    under,
    committed: [verso],
    versoUv: 'back-face-readable',
    generationKey: 'p1:p2:p3:single:ltr',
    ...overrides,
  };
}

function createSingleSourceScene(src: string): PageTurnScene {
  return createScene({
    stationary: [createPage('p0', src)],
    turningFront: createPage('p1', src),
    turningVerso: createPage('p2', src),
    under: createPage('p3', src),
    committed: [createPage('p4', src)],
    generationKey: `${src}:single:ltr`,
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PageTurnTextureCache', () => {
  it('prepares unique front, verso, and under textures and caps the longest side', async () => {
    const load = vi.fn(async (request: { src: string }) => ({ key: request.src }));
    const front = createPage('p1', 'asset://front', 7000, 5000);
    const verso = createPage('p2', 'asset://verso', 5000, 7000);
    const under = createPage('p3', 'asset://under', 7000, 5000);
    const cache = new PageTurnTextureCache({
      load,
      now: () => 0,
      maxEntries: 6,
      maxLongestSide: 4096,
    });

    const result = await cache.prepare(
      createScene({
        stationary: [createPage('p0', 'asset://front', 7000, 5000)],
        turningFront: front,
        turningVerso: verso,
        under,
        committed: [verso, createPage('p4', 'asset://under', 7000, 5000)],
      }),
      4,
      { width: 1800, height: 1200, dpr: 3 },
    );

    expect(result.kind).toBe('ready');
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls.map(([request]) => request.src)).toEqual([
      'asset://front',
      'asset://verso',
      'asset://under',
    ]);
    expect(load.mock.calls[0]?.[0]).toMatchObject({
      src: 'asset://front',
      width: 4096,
      height: 2926,
      longestSide: 4096,
    });
    expect(load.mock.calls[1]?.[0]).toMatchObject({
      src: 'asset://verso',
      width: 2571,
      height: 3600,
      longestSide: 3600,
    });
    expect(result).toMatchObject({
      kind: 'ready',
      generation: 4,
      textures: {
        count: 3,
        bytes: (4096 * 2926 * 4) + (2571 * 3600 * 4) + (4096 * 2926 * 4),
      },
      waitedMs: 0,
    });
  });

  it('applies the backend longest-side limit when it is smaller than the default cap', async () => {
    const load = vi.fn(async (request: { src: string }) => ({ key: request.src }));
    const cache = new PageTurnTextureCache({
      load,
      now: () => 0,
      maxLongestSide: 4096,
    });

    const result = await cache.prepare(
      createSingleSourceScene('asset://single'),
      2,
      { width: 1800, height: 1200, dpr: 3, backendMaxLongestSide: 2048 },
    );

    expect(result.kind).toBe('ready');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]).toMatchObject({
      src: 'asset://single',
      width: 2048,
      height: 1463,
      longestSide: 2048,
    });
  });

  it('returns a slow readiness signal after 150 ms and publishes ready once loading finishes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const deferred = createDeferred<{ key: string }>();
    const cache = new PageTurnTextureCache({
      load: vi.fn(() => deferred.promise),
      now: () => Date.now(),
    });

    let settled = false;
    const pending = cache.prepare(createSingleSourceScene('asset://slow'), 7, { width: 1200, height: 800, dpr: 2 });
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(149);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({
      kind: 'slow',
      generation: 7,
      waitedMs: 150,
    });

    deferred.resolve({ key: 'asset://slow' });
    await Promise.resolve();

    await expect(
      cache.prepare(createSingleSourceScene('asset://slow'), 7, { width: 1200, height: 800, dpr: 2 }),
    ).resolves.toMatchObject({
      kind: 'ready',
      generation: 7,
      textures: {
        count: 1,
      },
      waitedMs: 150,
    });
  });

  it('disposes a stale completed generation instead of publishing it', async () => {
    const deferred = createDeferred<{ key: string }>();
    const handle = { key: 'asset://stale' };
    const dispose = vi.fn();
    const cache = new PageTurnTextureCache({
      load: () => deferred.promise,
      dispose,
    });

    const pending = cache.prepare(createSingleSourceScene('asset://stale'), 1, { width: 1200, height: 800, dpr: 2 });
    cache.releaseGeneration(1);
    deferred.resolve(handle);

    await expect(pending).resolves.toEqual({ kind: 'stale', generation: 1 });
    expect(dispose).toHaveBeenCalledWith(handle);
  });

  it('evicts the least recently used entry once the cache exceeds six resident textures', async () => {
    const handles = new Map<string, { key: string }>();
    const dispose = vi.fn();
    const cache = new PageTurnTextureCache({
      load: vi.fn(async (request: { src: string }) => {
        const handle = { key: request.src };
        handles.set(request.src, handle);
        return handle;
      }),
      dispose,
      maxEntries: 6,
    });

    for (let generation = 1; generation <= 6; generation += 1) {
      const src = `asset://page-${generation}`;
      await cache.prepare(createSingleSourceScene(src), generation, { width: 1000, height: 700, dpr: 2 });
      cache.releaseGeneration(generation);
    }

    expect(cache.keys()).toEqual([
      'asset://page-1',
      'asset://page-2',
      'asset://page-3',
      'asset://page-4',
      'asset://page-5',
      'asset://page-6',
    ]);

    await cache.prepare(createSingleSourceScene('asset://page-2'), 7, { width: 1000, height: 700, dpr: 2 });
    cache.releaseGeneration(7);
    await cache.prepare(createSingleSourceScene('asset://page-7'), 8, { width: 1000, height: 700, dpr: 2 });
    cache.releaseGeneration(8);

    expect(cache.keys()).toEqual([
      'asset://page-3',
      'asset://page-4',
      'asset://page-5',
      'asset://page-6',
      'asset://page-2',
      'asset://page-7',
    ]);
    expect(dispose).toHaveBeenCalledWith(handles.get('asset://page-1'));
  });

  it('reports loader failures as generation-scoped errors', async () => {
    const cache = new PageTurnTextureCache({
      load: vi.fn(async () => {
        throw new Error('decode failed');
      }),
    });

    await expect(
      cache.prepare(createSingleSourceScene('asset://broken'), 9, { width: 1000, height: 700, dpr: 2 }),
    ).resolves.toEqual({
      kind: 'error',
      generation: 9,
      message: 'decode failed',
    });
  });

  it('retries a source after a failed pending load instead of reusing the rejected promise', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('decode failed'))
      .mockImplementationOnce(async (request: { src: string }) => ({ key: request.src }));
    const cache = new PageTurnTextureCache({ load });

    await expect(
      cache.prepare(createSingleSourceScene('asset://retry'), 10, { width: 1000, height: 700, dpr: 2 }),
    ).resolves.toEqual({
      kind: 'error',
      generation: 10,
      message: 'decode failed',
    });

    await expect(
      cache.prepare(createSingleSourceScene('asset://retry'), 11, { width: 1000, height: 700, dpr: 2 }),
    ).resolves.toMatchObject({
      kind: 'ready',
      generation: 11,
      textures: {
        count: 1,
      },
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('disposes every resident texture handle when the cache is disposed', async () => {
    const dispose = vi.fn();
    const cache = new PageTurnTextureCache({
      load: vi.fn(async (request: { src: string }) => ({ key: request.src })),
      dispose,
      maxEntries: 6,
    });

    await cache.prepare(createSingleSourceScene('asset://one'), 1, { width: 1000, height: 700, dpr: 2 });
    cache.releaseGeneration(1);
    await cache.prepare(createSingleSourceScene('asset://two'), 2, { width: 1000, height: 700, dpr: 2 });
    cache.releaseGeneration(2);

    expect(cache.keys()).toHaveLength(2);

    cache.dispose();

    expect(dispose).toHaveBeenCalledTimes(2);
    expect(cache.keys()).toHaveLength(0);
  });
});
