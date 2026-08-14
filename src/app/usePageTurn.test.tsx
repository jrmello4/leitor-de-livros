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
  target,
  currentTarget,
}: {
  clientX: number;
  clientY: number;
  pointerId?: number;
  pointerType?: string;
  button?: number;
  target?: EventTarget | null;
  currentTarget?: ReturnType<typeof stageTarget>;
}) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType,
    button,
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

  it('routes adjacent automatic turns through the shared 62-percent synthetic grab and preserves only the latest queued request', async () => {
    const result = await renderHook(createOptions());

    act(() => {
      result.requestTurn(1);
      result.requestTurn(-1);
      result.requestTurn(1);
    });

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
});
