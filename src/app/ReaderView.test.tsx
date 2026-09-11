import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, Publication, ReaderState, ReadingProfile } from '../domain/types';
import type { RendererStatus } from '../rendering/contracts';
import { ReaderView } from './ReaderView';

vi.mock('../flow/useAdaptiveFlow', () => ({
  useAdaptiveFlow: () => ({
    graph: null,
    state: 'idle',
    swapOrder: vi.fn(),
    useManualRoute: vi.fn(),
  }),
}));

vi.mock('./AdaptiveFlowOverlay', () => ({
  AdaptiveFlowOverlay() {
    return <button type="button" data-testid="flow-control" data-flow-control>Flow</button>;
  },
}));

vi.mock('../rendering/ReaderSurface', () => ({
  ReaderSurface({
    staticContent,
    onStatus,
  }: {
    staticContent: ReactNode;
    onStatus: (status: RendererStatus) => void;
  }) {
    useEffect(() => {
      onStatus({ backend: 'webgl2', quality: 'balanced' });
    }, [onStatus]);
    return <div data-testid="reader-surface">{staticContent}</div>;
  },
}));

vi.mock('../rendering/pageTurn/PageTurnSurface', () => ({
  PageTurnSurface({
    scene,
    generation,
  }: {
    scene: { turningFront: { src: string }; turningVerso: { src: string } };
    generation: number;
  }) {
    return (
      <div
        data-testid="page-turn-canvas"
        data-generation={String(generation)}
        data-front-src={scene.turningFront.src}
        data-verso-src={scene.turningVerso.src}
      />
    );
  },
}));

function createPublication(format: Publication['format']): Publication {
  return {
    id: `pub-${format}`,
    title: `Format ${format}`,
    sourceLabel: `${format}.cbz`,
    sourceNames: [`${format}.cbz`],
    format,
    pages: [
      { id: 'page-0', index: 0, name: 'Page 1', src: `${format}://page-0`, width: 800, height: 1200 },
      { id: 'page-1', index: 1, name: 'Page 2', src: `${format}://page-1`, width: 800, height: 1200 },
      { id: 'page-2', index: 2, name: 'Page 3', src: `${format}://page-2`, width: 800, height: 1200 },
    ],
    pageCount: 3,
    coverSrc: `${format}://page-0`,
    coverPageId: 'page-0',
    currentPage: 1,
    progress: 0.5,
    direction: 'ltr',
    addedAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    isFavorite: false,
  };
}

function createProfile(overrides: Partial<ReadingProfile> = {}): ReadingProfile {
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
      rotate_clockwise: ['KeyR'],
      cancel: ['Escape'],
    },
    ...overrides,
  };
}

describe('ReaderView physical page-turn integration', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  async function renderReader({
    publication = createPublication('cbz'),
    profile = createProfile(),
    onNext = vi.fn(),
    onPrevious = vi.fn(),
    onRegisterTurnRequest = vi.fn(),
    onNextVolume,
    nextVolumeTitle,
    onSaveReaderState = vi.fn(),
  }: {
    publication?: Publication;
    profile?: ReadingProfile;
    onNext?: ReturnType<typeof vi.fn>;
    onPrevious?: ReturnType<typeof vi.fn>;
    onRegisterTurnRequest?: ReturnType<typeof vi.fn>;
    onNextVolume?: () => void;
    nextVolumeTitle?: string;
    onSaveReaderState?: ReturnType<typeof vi.fn>;
  } = {}) {
    const props = {
      publication,
      profile,
      announcement: '',
      onBack: vi.fn(),
      onNext,
      onPrevious,
      onToggleSettings: vi.fn(),
      onToggleFullscreen: vi.fn(),
      onFlowCorrected: vi.fn(),
      onFlowManualRoute: vi.fn(),
      nativeRuntime: false,
      settingsTriggerRef: { current: null },
      bookmarks: [] as Bookmark[],
      readerState: { zoomMode: 'page', zoomScale: 1, panX: 0, panY: 0, rotation: 0, background: 'atelier' } as ReaderState,
      onSaveReaderState,
      onSelectPage: vi.fn(),
      onToggleBookmark: vi.fn(),
      onUpdateBookmarkLabel: vi.fn(),
      navigatorVisible: false,
      navigatorTriggerRef: { current: null },
      onToggleNavigator: vi.fn(),
      onCloseNavigator: vi.fn(),
      onRegisterTurnRequest,
      onNextVolume,
      nextVolumeTitle,
    };

    await act(async () => {
      root.render(<ReaderView {...props} />);
      await Promise.resolve();
    });

    return { props };
  }

  it('changes immediately and never mounts a page-turn canvas in reduced motion', async () => {
    const onNext = vi.fn();

    await renderReader({
      profile: createProfile({ reducedMotion: true }),
      onNext,
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="reader-next"]')?.click();
      await Promise.resolve();
    });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="page-turn-canvas"]')).toBeNull();
  });

  it('mounts the page-turn surface when a registered app action requests the next page', async () => {
    const onRegisterTurnRequest = vi.fn();
    await renderReader({ onRegisterTurnRequest });

    const request = onRegisterTurnRequest.mock.calls.at(-1)?.[0] as ((delta: number) => void) | null;
    expect(typeof request).toBe('function');

    act(() => {
      request?.(1);
    });

    const canvas = host.querySelector('[data-testid="page-turn-canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-front-src')).toBe('cbz://page-1');
    expect(canvas?.getAttribute('data-verso-src')).toBe('cbz://page-2');
  });

  it.each(['pdf', 'cbz', 'cbr', 'images'] as const)('uses the page descriptors directly for %s page-turn scenes', async (format) => {
    await renderReader({ publication: createPublication(format) });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="reader-next"]')?.click();
      await Promise.resolve();
    });

    const canvas = host.querySelector('[data-testid="page-turn-canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-front-src')).toBe(`${format}://page-1`);
    expect(canvas?.getAttribute('data-verso-src')).toBe(`${format}://page-2`);
  });

  it('ignores wheel turns that originate from Adaptive Flow controls', async () => {
    const onNext = vi.fn();
    await renderReader({ onNext });

    await act(async () => {
      host.querySelector<HTMLElement>('[data-testid="flow-control"]')?.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }),
      );
      await Promise.resolve();
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="page-turn-canvas"]')).toBeNull();
  });

  it('mounts WebtoonReader when profile mode is webtoon', async () => {
    class MockIntersectionObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    window.IntersectionObserver = MockIntersectionObserver as never;

    await renderReader({
      profile: {
        id: 'test',
        version: 1,
        name: 'Webtoon Profile',
        mode: 'webtoon',
        direction: 'ltr',
        contrast: 'standard',
        reducedMotion: false,
        pageTurnDuration: 300,
        layoutZone: 'bottom',
        zoomMode: 'page',
        zoomScale: 1,
        bindings: { next_page: [], previous_page: [], toggle_library: [], toggle_fullscreen: [], toggle_settings: [], toggle_spread: [], toggle_navigator: [], toggle_bookmark: [], rotate_clockwise: [], cancel: [] },
      },
    });

    expect(host.querySelector('[data-testid="webtoon-reader"]')).not.toBeNull();
  });

  it('keeps a touch pinch out of page navigation', async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    await renderReader({ onNext, onPrevious });

    const stage = host.querySelector<HTMLElement>('.reading-stage');
    expect(stage).not.toBeNull();

    const dispatchPointer = (type: string, pointerId: number, clientX: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 400,
        button: 0,
      });
      Object.defineProperties(event, {
        pointerId: { value: pointerId },
        pointerType: { value: 'touch' },
        isPrimary: { value: pointerId === 1 },
      });
      act(() => stage?.dispatchEvent(event));
      return event;
    };

    dispatchPointer('pointerdown', 1, 100);
    // The first finger is deliberately on the page edge. It must remain a
    // pending touch so the second finger can claim the gesture as a pinch.
    expect(host.querySelector('[data-testid="page-turn-canvas"]')).toBeNull();
    dispatchPointer('pointerdown', 2, 200);
    dispatchPointer('pointermove', 1, 50);
    dispatchPointer('pointermove', 2, 250);
    expect(host.querySelector<HTMLElement>('[data-reader-content]')?.style.transform).toContain('scale(2)');

    dispatchPointer('pointerup', 1, 50);
    dispatchPointer('pointerup', 2, 250);

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="page-turn-canvas"]')).toBeNull();
  });

  it('treats two quick touch taps as zoom instead of advancing the page', async () => {
    vi.useFakeTimers();
    const onNext = vi.fn();
    await renderReader({ onNext });

    const stage = host.querySelector<HTMLElement>('.reading-stage');
    const content = host.querySelector<HTMLElement>('[data-reader-content]');
    expect(stage).not.toBeNull();
    expect(content).not.toBeNull();

    const tap = (clientX: number) => {
      const down = new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 300,
        button: 0,
      });
      const up = new MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 300,
        button: 0,
      });
      Object.defineProperties(down, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
      Object.defineProperties(up, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
      act(() => {
        stage?.dispatchEvent(down);
        stage?.dispatchEvent(up);
      });
    };

    tap(500);
    expect(onNext).not.toHaveBeenCalled();
    tap(500);

    expect(onNext).not.toHaveBeenCalled();
    expect(content?.style.transform).toContain('scale(2)');

    act(() => {
      stage?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 }));
    });
    expect(content?.style.transform).toContain('scale(2)');
  });

  it('leaves ordinary webtoon wheel input to the scroll container', async () => {
    const onNext = vi.fn();
    await renderReader({
      onNext,
      profile: createProfile({ mode: 'webtoon' }),
    });

    const container = host.querySelector<HTMLElement>('[data-testid="webtoon-reader"]');
    expect(container).not.toBeNull();

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    act(() => container?.dispatchEvent(wheel));

    expect(wheel.defaultPrevented).toBe(false);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('keeps modified-wheel zoom anchored at the cursor', async () => {
    await renderReader();

    const stage = host.querySelector<HTMLElement>('.reading-stage');
    const paper = host.querySelector<HTMLElement>('.paper-spread');
    const content = host.querySelector<HTMLElement>('[data-reader-content]');
    expect(stage).not.toBeNull();
    expect(paper).not.toBeNull();
    expect(content).not.toBeNull();

    if (!stage || !paper || !content) return;
    paper.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    act(() => {
      stage.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 300,
        ctrlKey: true,
        deltaY: -100,
      }));
    });

    expect(content.style.transform).toContain('translate(25px, 0px) scale(1.25)');
  });

  it('coalesces rapid zoom state saves until the gesture settles', async () => {
    vi.useFakeTimers();
    const onSaveReaderState = vi.fn();
    await renderReader({ onSaveReaderState });
    const stage = host.querySelector<HTMLElement>('.reading-stage');
    expect(stage).not.toBeNull();

    act(() => {
      stage?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
      stage?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
    });

    expect(onSaveReaderState).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onSaveReaderState).toHaveBeenCalledTimes(1);
    expect(onSaveReaderState).toHaveBeenLastCalledWith(expect.objectContaining({ zoomScale: 1.5 }));
  });

  it('navigates with mouse lateral buttons 3 and 4 via auxclick', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();

    await renderReader({ onPrevious, onNext });

    act(() => {
      window.dispatchEvent(new MouseEvent('auxclick', { button: 3, bubbles: true }));
    });
    expect(onPrevious).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new MouseEvent('auxclick', { button: 4, bubbles: true }));
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('renders next volume button on the final page', async () => {
    const onNextVolume = vi.fn();
    const pub = createPublication('cbz');
    pub.currentPage = pub.pages.length - 1; // page 2

    await renderReader({
      publication: pub,
      onNextVolume,
      nextVolumeTitle: 'Volume 2',
    });

    const nextVolumeBtn = host.querySelector<HTMLButtonElement>('.next-volume-btn');
    expect(nextVolumeBtn).not.toBeNull();
    expect(nextVolumeBtn?.textContent).toContain('Next: Volume 2');

    act(() => nextVolumeBtn?.click());
    expect(onNextVolume).toHaveBeenCalledTimes(1);
  });

  it('navigates when clicking on the right or left half of the stage in spread mode', async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();

    await renderReader({
      profile: createProfile({ mode: 'spread', direction: 'ltr' }),
      onNext,
      onPrevious,
    });

    const stage = host.querySelector<HTMLElement>('.reading-stage');
    expect(stage).not.toBeNull();

    // Mock bounding client rect: width 1000, left 0
    if (stage) {
      stage.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 800,
        width: 1000,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Click right side (x = 750) -> next
      act(() => {
        const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 750, clientY: 400, button: 0 });
        const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 750, clientY: 400, button: 0 });
        stage.dispatchEvent(down);
        stage.dispatchEvent(up);
      });
      expect(onNext).toHaveBeenCalledTimes(1);

      // Click left side (x = 250) -> previous
      act(() => {
        const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 250, clientY: 400, button: 0 });
        const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 250, clientY: 400, button: 0 });
        stage.dispatchEvent(down);
        stage.dispatchEvent(up);
      });
      expect(onPrevious).toHaveBeenCalledTimes(1);
    }
  });
});
