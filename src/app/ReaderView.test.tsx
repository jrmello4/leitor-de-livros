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
  });

  async function renderReader({
    publication = createPublication('cbz'),
    profile = createProfile(),
    onNext = vi.fn(),
    onPrevious = vi.fn(),
    onRegisterTurnRequest = vi.fn(),
  }: {
    publication?: Publication;
    profile?: ReadingProfile;
    onNext?: ReturnType<typeof vi.fn>;
    onPrevious?: ReturnType<typeof vi.fn>;
    onRegisterTurnRequest?: ReturnType<typeof vi.fn>;
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
      readerState: { zoomMode: 'page', zoomScale: 1, panX: 0, panY: 0 } as ReaderState,
      onSaveReaderState: vi.fn(),
      onSelectPage: vi.fn(),
      onToggleBookmark: vi.fn(),
      onUpdateBookmarkLabel: vi.fn(),
      navigatorVisible: false,
      navigatorTriggerRef: { current: null },
      onToggleNavigator: vi.fn(),
      onCloseNavigator: vi.fn(),
      onRegisterTurnRequest,
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
});
