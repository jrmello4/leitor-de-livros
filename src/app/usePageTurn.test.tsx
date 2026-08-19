import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { PageDescriptor, Publication, ReadingProfile } from '../domain/types';
import { usePageTurn, type UsePageTurnOptions, type UsePageTurnResult } from './usePageTurn';

const pages: PageDescriptor[] = Array.from({ length: 5 }, (_, index) => ({
  id: `page-${index}`,
  index,
  name: `Page ${index + 1}`,
  src: `asset://page-${index}.png`,
  width: 800,
  height: 1200,
}));

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    id: 'pub-1',
    title: 'Physical Page Curl',
    sourceLabel: 'physical-page-curl.cbz',
    sourceNames: ['physical-page-curl.cbz'],
    format: 'cbz',
    pages,
    pageCount: pages.length,
    coverSrc: pages[0].src,
    coverPageId: pages[0].id,
    currentPage: 1,
    progress: 0.4,
    direction: 'ltr',
    addedAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    isFavorite: false,
    ...overrides,
  };
}

function profile(overrides: Partial<ReadingProfile> = {}): ReadingProfile {
  return {
    version: 1,
    name: 'Default',
    mode: 'single',
    direction: 'ltr',
    contrast: 'standard',
    reducedMotion: false,
    pageTurnDuration: 240,
    layoutZone: 'top',
    zoomMode: 'page',
    zoomScale: 1,
    bindings: {
      next_page: ['ArrowRight'],
      previous_page: ['ArrowLeft'],
      toggle_library: ['Escape'],
      toggle_fullscreen: ['KeyF'],
      toggle_settings: ['Comma'],
      toggle_spread: ['KeyS'],
      toggle_navigator: ['KeyP'],
      toggle_bookmark: ['KeyB'],
      cancel: ['Escape'],
    },
    ...overrides,
  };
}

function createOptions(overrides: Partial<UsePageTurnOptions> = {}): UsePageTurnOptions {
  const pageElement = document.createElement('div');
  Object.defineProperty(pageElement, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 100,
      top: 40,
      width: 500,
      height: 700,
      right: 600,
      bottom: 740,
    }),
  });

  return {
    publication: publication(),
    mode: profile().mode,
    readingDirection: profile().direction,
    reducedMotion: false,
    transformedPage: { current: pageElement } as RefObject<HTMLDivElement>,
    zoom: { scale: 1, panX: 0, panY: 0 },
    canNext: true,
    canPrevious: true,
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    ...overrides,
  };
}

function stageTarget() {
  return {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
  };
}

function pointerEvent({
  clientX,
  clientY,
  pointerId = 4,
  pointerType = 'mouse',
  button = 0,
  isPrimary = true,
  target,
  currentTarget,
}: {
  clientX: number;
  clientY: number;
  pointerId?: number;
  pointerType?: string;
  button?: number;
  isPrimary?: boolean;
  target?: EventTarget | null;
  currentTarget?: ReturnType<typeof stageTarget>;
}) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType,
    button,
    isPrimary,
    target: target ?? currentTarget ?? document.createElement('div'),
    currentTarget: currentTarget ?? stageTarget(),
    preventDefault: vi.fn(),
  };
}

describe('usePageTurn', () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: UsePageTurnResult | undefined;

  function Harness({ options }: { options: UsePageTurnOptions }) {
    latest = usePageTurn(options);
    return null;
  }

  beforeEach(() => {
    latest = undefined;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function renderHook(options: UsePageTurnOptions) {
    await act(async () => {
      root.render(<Harness options={options} />);
      await Promise.resolve();
    });
    expect(latest).toBeDefined();
    return latest!;
  }

  it('captures a visible middle-edge pointer and records the normalized grab before textures are ready', async () => {
    const result = await renderHook(createOptions());
    const stage = stageTarget();

    act(() => {
      result.edgeProps.onPointerDown?.(
        pointerEvent({ clientX: 598, clientY: 390, currentTarget: stage }) as never,
      );
    });

    expect(stage.setPointerCapture).toHaveBeenCalledWith(4);
    expect(latest?.state).toMatchObject({ phase: 'preparing', direction: 'forward' });
    expect(latest?.pendingPointer).toMatchObject({ pointerId: 4 });
    expect(latest?.pendingPointer?.grab.x).toBeCloseTo(0.996, 3);
    expect(latest?.pendingPointer?.grab.y).toBeCloseTo(0.5, 2);
  });

  it('keeps hover lift within three percent and suppresses the preview in reduced motion', async () => {
    const animated = await renderHook(createOptions());

    act(() => {
      animated.edgeProps.onPointerMove?.(
        pointerEvent({ clientX: 598, clientY: 390 }) as never,
      );
    });

    expect(latest?.surfaceInput?.state.phase).toBe('preparing');
    expect(latest?.surfaceInput?.progress).toBeGreaterThan(0);
    expect(latest?.surfaceInput?.progress).toBeLessThanOrEqual(0.03);

    const reduced = await renderHook(createOptions({ reducedMotion: true }));
    act(() => {
      reduced.edgeProps.onPointerMove?.(
        pointerEvent({ clientX: 598, clientY: 390 }) as never,
      );
    });

    expect(latest?.surfaceInput).toBeUndefined();
  });

  it('keeps a requested turn alive across the re-render that starting it causes', async () => {
    const onNext = vi.fn();
    const result = await renderHook(createOptions({ onNext }));

    act(() => {
      result.requestTurn(1);
    });

    const state = latest?.state;
    const generation = state && 'generation' in state ? state.generation : undefined;
    expect(generation, 'requesting a turn must produce a generation').toBeDefined();

    // Starting a turn changes hook state, which re-renders the reader. The
    // controller has to survive that render: if a state-keyed effect tears it
    // down as if the reader had unmounted, the turn is silently dropped and the
    // page never moves.
    await act(async () => {
      latest?.onTexturesAndBackendReady(generation!);
      await Promise.resolve();
    });

    // A controller torn down by a state-keyed "unmount" cleanup is back at
    // `idle`, so it ignores this signal and the turn stays stranded.
    expect(latest?.state.phase, 'a prepared automatic turn must start driving the page').toBe('dragging');
    expect(onNext, 'the turn must not have navigated before it settles').not.toHaveBeenCalled();
  });

  it('starts an automatic turn once even if the surface reports readiness repeatedly', async () => {
    const frames: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof globalThis.cancelAnimationFrame;

    try {
      const result = await renderHook(createOptions());

      act(() => {
        result.requestTurn(1);
      });

      const state = latest?.state;
      const generation = state && 'generation' in state ? state.generation : undefined;
      expect(generation).toBeDefined();

      act(() => {
        latest?.onTexturesAndBackendReady(generation!);
      });

      const scheduledAfterFirst = frames.length;
      expect(scheduledAfterFirst, 'the first readiness signal must drive the turn').toBeGreaterThan(0);

      // The surface effect can re-run while the turn animates. Re-reporting the
      // same generation must not restart the animation, or the turn keeps
      // rewinding and never reaches the page.
      act(() => {
        latest?.onTexturesAndBackendReady(generation!);
        latest?.onTexturesAndBackendReady(generation!);
      });

      expect(frames.length, 'a repeated readiness signal must not restart the animation').toBe(scheduledAfterFirst);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

  it.each([
    { readingDirection: 'ltr' as const, delta: 1, expected: 'onNext' as const },
    { readingDirection: 'ltr' as const, delta: -1, expected: 'onPrevious' as const },
    { readingDirection: 'rtl' as const, delta: 1, expected: 'onNext' as const },
    { readingDirection: 'rtl' as const, delta: -1, expected: 'onPrevious' as const },
  ])(
    'commits an automatic $readingDirection turn for delta $delta',
    async ({ readingDirection, delta, expected }) => {
      const frames: FrameRequestCallback[] = [];
      const originalRaf = globalThis.requestAnimationFrame;
      const originalCancel = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as typeof globalThis.requestAnimationFrame;
      globalThis.cancelAnimationFrame = (() => undefined) as typeof globalThis.cancelAnimationFrame;

      try {
        const onNext = vi.fn();
        const onPrevious = vi.fn();
        const result = await renderHook(createOptions({
          readingDirection,
          publication: publication({ currentPage: 2, direction: readingDirection }),
          onNext,
          onPrevious,
        }));

        act(() => {
          result.requestTurn(delta);
        });

        const state = latest?.state;
        const generation = state && 'generation' in state ? state.generation : undefined;
        expect(generation).toBeDefined();

        act(() => {
          latest?.onTexturesAndBackendReady(generation!);
        });

        // The sheet has to travel toward the destination the controller signs
        // its release against. Reading direction is already folded into the
        // turn direction, so applying it a second time sweeps the page the
        // wrong way and every release reads as a cancel.
        const started = performance.now();
        for (let step = 0; step <= 60 && frames.length > 0; step += 1) {
          const tick = frames.shift()!;
          act(() => tick(started + step * 40));
          if (latest?.state.phase === 'settling') {
            act(() => latest?.onSettled({ generation: generation!, outcome: 'commit' }));
          }
        }

        const called = expected === 'onNext' ? onNext : onPrevious;
        const notCalled = expected === 'onNext' ? onPrevious : onNext;
        expect(called, `${readingDirection} delta ${delta} must commit`).toHaveBeenCalled();
        expect(notCalled).not.toHaveBeenCalled();
      } finally {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancel;
      }
    },
  );

  it('routes adjacent automatic turns through the shared 62-percent synthetic grab', async () => {
    const onNext = vi.fn();
    const result = await renderHook(createOptions({ onNext }));

    act(() => {
      result.requestTurn(1);
      result.requestTurn(1);
      result.requestTurn(1);
    });

    // The fold that is running owns the screen; the two behind it are counted
    // and land when it finishes.
    expect(onNext).not.toHaveBeenCalled();
    expect(latest?.syntheticTrajectory?.grab.y).toBeCloseTo(0.62, 2);
    expect(latest?.state).toMatchObject({ phase: 'preparing', direction: 'forward' });

    act(() => {
      latest?.cancelTurn('publication-change');
    });

    expect(latest?.state).toMatchObject({ phase: 'preparing', direction: 'forward' });
    expect(latest?.scene?.turningVerso.id).toBe('page-2');
  });

  it.each([0.01, 0.5, 0.99])('normalizes the grab height %s across the full visible outer edge', async (normalizedY) => {
    const result = await renderHook(createOptions());
    const stage = stageTarget();

    act(() => {
      result.edgeProps.onPointerDown?.(
        pointerEvent({
          clientX: 598,
          clientY: 40 + 700 * normalizedY,
          currentTarget: stage,
        }) as never,
      );
    });

    expect(latest?.pendingPointer?.grab.y).toBeCloseTo(normalizedY, 2);
  });

  it('falls back to immediate navigation when reduced motion or boundaries disallow a physical turn', async () => {
    const onNext = vi.fn();
    const reduced = await renderHook(createOptions({ reducedMotion: true, onNext }));

    act(() => {
      reduced.requestTurn(1);
    });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(latest?.surfaceInput).toBeUndefined();

    const boundaryNext = vi.fn();
    const boundary = await renderHook(createOptions({ canNext: false, onNext: boundaryNext }));

    act(() => {
      boundary.requestTurn(1);
    });

    expect(boundaryNext).toHaveBeenCalledTimes(1);
    expect(latest?.surfaceInput).toBeUndefined();
  });

  it('abandons the fold on renderer failure but still turns the page', async () => {
    const onNext = vi.fn();
    const result = await renderHook(createOptions({ onNext }));

    act(() => {
      result.requestTurn(1);
    });

    expect(latest?.state).toMatchObject({ phase: 'preparing', direction: 'forward' });

    // Losing the animation is an acceptable degradation. Losing the page turn
    // the reader asked for is not: a single solver or backend failure would
    // otherwise leave the reader unable to move through the publication for the
    // rest of the session, because the controller stays disabled.
    act(() => {
      latest?.onFailure({ reason: 'backend', diagnostic: 'WebGL2 is not available.' });
    });

    expect(onNext).toHaveBeenCalledTimes(1);
    // The fold is abandoned, not retired: the next turn gets to try again.
    expect(latest?.state).toEqual({ phase: 'idle' });
    expect(latest?.surfaceInput).toBeUndefined();
  });

  it('does not navigate twice when a turn fails after it already committed', async () => {
    const frames: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof globalThis.cancelAnimationFrame;

    try {
      const onNext = vi.fn();
      const result = await renderHook(createOptions({ onNext }));

      act(() => {
        result.requestTurn(1);
      });
      const state = latest?.state;
      const generation = state && 'generation' in state ? state.generation : undefined;

      act(() => {
        latest?.onTexturesAndBackendReady(generation!);
      });

      const started = performance.now();
      for (let step = 0; step <= 60 && frames.length > 0; step += 1) {
        const tick = frames.shift()!;
        act(() => tick(started + step * 40));
        if (latest?.state.phase === 'settling') {
          act(() => latest?.onSettled({ generation: generation!, outcome: 'commit' }));
        }
      }

      expect(onNext, 'the turn must have navigated on its own').toHaveBeenCalledTimes(1);

      // A failure arriving after the turn already moved the reader must not
      // move it a second time.
      act(() => {
        latest?.onFailure({ reason: 'solver', diagnostic: 'Physical page-turn solver produced invalid-normal.' });
      });

      expect(onNext).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

  it('turns one page even when the surface reports the same failure repeatedly', async () => {
    const onNext = vi.fn();
    const result = await renderHook(createOptions({ onNext }));

    act(() => {
      result.requestTurn(1);
    });

    // The surface re-runs its preparation effect several times per turn, and a
    // page that keeps failing to prepare reports a failure from each run. Every
    // report must not cost the reader another page.
    act(() => {
      latest?.onFailure({ reason: 'backend', diagnostic: 'Page-turn textures were not ready (slow).' });
    });
    act(() => {
      latest?.onFailure({ reason: 'backend', diagnostic: 'Page-turn textures were not ready (slow).' });
    });
    act(() => {
      latest?.onFailure({ reason: 'solver', diagnostic: 'Physical page-turn solver produced invalid-normal.' });
    });

    expect(onNext, 'one turn must advance the reader exactly one page').toHaveBeenCalledTimes(1);
  });

  it('does not lose a turn requested while another one is still running', async () => {
    const frames: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof globalThis.cancelAnimationFrame;

    try {
      const onNext = vi.fn();
      const result = await renderHook(createOptions({ onNext }));

      const drive = (generation: number) => {
        const started = performance.now();
        for (let step = 0; step <= 60 && frames.length > 0; step += 1) {
          const tick = frames.shift()!;
          act(() => tick(started + step * 40));
          if (latest?.state.phase === 'settling') {
            act(() => latest?.onSettled({ generation, outcome: 'commit' }));
          }
        }
      };

      act(() => {
        result.requestTurn(1);
      });
      const first = latest?.state;
      const firstGeneration = first && 'generation' in first ? first.generation : undefined;
      act(() => {
        latest?.onTexturesAndBackendReady(firstGeneration!);
      });

      // A reader clicking at a natural pace asks for the next page before the
      // current turn has settled. That request is queued, and it must still
      // reach the page once the first turn finishes.
      act(() => {
        latest?.requestTurn(1);
      });

      drive(firstGeneration!);
      expect(onNext, 'the first turn must land').toHaveBeenCalledTimes(1);

      act(() => {
        latest?.acknowledgeNavigation();
      });

      const queued = latest?.state;
      const queuedGeneration = queued && 'generation' in queued ? queued.generation : undefined;
      expect(queuedGeneration, 'the queued turn must be promoted').toBeDefined();

      act(() => {
        latest?.onTexturesAndBackendReady(queuedGeneration!);
      });
      drive(queuedGeneration!);

      expect(onNext, 'the queued turn must land too').toHaveBeenCalledTimes(2);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

  it('advances one page per request when a reader clicks faster than the fold', async () => {
    const frames: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => frames.push(callback)) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof globalThis.cancelAnimationFrame;

    try {
      const onNext = vi.fn();
      const result = await renderHook(createOptions({ onNext }));

      const drive = (generation: number) => {
        const started = performance.now();
        for (let step = 0; step <= 60 && frames.length > 0; step += 1) {
          const tick = frames.shift()!;
          act(() => tick(started + step * 40));
          if (latest?.state.phase === 'settling') {
            act(() => latest?.onSettled({ generation, outcome: 'commit' }));
          }
        }
      };

      // Three clicks arrive faster than a fold settles. A queue that keeps only
      // the most recent request drops the middle one and the reader silently
      // loses a page.
      act(() => {
        result.requestTurn(1);
      });
      const first = latest?.state;
      const firstGeneration = first && 'generation' in first ? first.generation : undefined;
      act(() => {
        latest?.onTexturesAndBackendReady(firstGeneration!);
      });
      act(() => {
        latest?.requestTurn(1);
        latest?.requestTurn(1);
      });

      drive(firstGeneration!);
      act(() => {
        latest?.acknowledgeNavigation();
      });

      const promoted = latest?.state;
      const promotedGeneration = promoted && 'generation' in promoted ? promoted.generation : undefined;
      expect(promotedGeneration, 'the counted turn must be promoted').toBeDefined();
      act(() => {
        latest?.onTexturesAndBackendReady(promotedGeneration!);
      });
      drive(promotedGeneration!);

      expect(onNext, 'three requests must reach three pages').toHaveBeenCalledTimes(3);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

  it('tries the fold again after a failure instead of retiring it for the session', async () => {
    const onNext = vi.fn();
    const result = await renderHook(createOptions({ onNext }));

    act(() => {
      result.requestTurn(1);
    });
    // A page that failed to prepare once may well prepare next time. Retiring
    // the fold on the first failure leaves the reader with no animation at all
    // until they restart the app.
    act(() => {
      latest?.onFailure({ reason: 'backend', diagnostic: 'Page-turn textures were not ready (slow).' });
    });
    expect(onNext, 'the failed turn still takes its page').toHaveBeenCalledTimes(1);

    act(() => {
      latest?.requestTurn(1);
    });
    expect(latest?.state, 'the next turn must be allowed to animate').toMatchObject({ phase: 'preparing' });
  });

  it('retires the fold once failures stop being an accident', async () => {
    const result = await renderHook(createOptions({ onNext: vi.fn() }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      act(() => {
        result.requestTurn(1);
      });
      act(() => {
        latest?.onFailure({ reason: 'solver', diagnostic: 'Physical page-turn solver produced invalid-normal.' });
      });
    }

    act(() => {
      latest?.requestTurn(1);
    });

    expect(latest?.state).toMatchObject({ phase: 'disabled' });
  });

  it.each(['touch', 'pen'] as const)('ignores non-primary %s pointers before starting a turn', async (pointerType) => {
    const result = await renderHook(createOptions());
    const stage = stageTarget();

    act(() => {
      result.edgeProps.onPointerDown?.(
        pointerEvent({
          clientX: 598,
          clientY: 390,
          pointerId: 9,
          pointerType,
          isPrimary: false,
          currentTarget: stage,
        }) as never,
      );
    });

    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    expect(latest?.state).toEqual({ phase: 'idle' });
    expect(latest?.pendingPointer).toBeUndefined();
  });

});
