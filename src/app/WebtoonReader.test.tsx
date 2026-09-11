import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Publication } from '../domain/types';
import { WebtoonReader } from './WebtoonReader';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_PUBLICATION: Publication = {
  id: 'pub-test',
  title: 'Tower of God',
  sourceLabel: 'tower.cbz',
  format: 'cbz',
  coverSrc: 'blob:cover',
  coverPageId: 'page-1',
  pageCount: 3,
  currentPage: 0,
  progress: 0,
  direction: 'ltr',
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isFavorite: false,
  pages: [
    { id: 'page-1', index: 0, name: '001.png', src: 'blob:page-1', width: 800, height: 2400 },
    { id: 'page-2', index: 1, name: '002.png', src: 'blob:page-2', width: 800, height: 2400 },
    { id: 'page-3', index: 2, name: '003.png', src: 'blob:page-3', width: 800, height: 2400 },
  ],
};

describe('WebtoonReader', () => {
  let host: HTMLDivElement;
  let root: Root;
  let notifyIntersections: IntersectionObserverCallback;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    // Mock IntersectionObserver
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) { notifyIntersections = callback; }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    window.IntersectionObserver = MockIntersectionObserver as never;
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it('consumes pinch gestures but allows single-finger scrolling', () => {
    const onScaleChange = vi.fn();
    act(() => root.render(<WebtoonReader publication={SAMPLE_PUBLICATION} currentPage={0} onPageVisible={vi.fn()} onScaleChange={onScaleChange} />));
    const container = host.querySelector('[data-testid="webtoon-reader"]')!;
    const touch = (type: string, points: number[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: points.map(clientX => ({ clientX, clientY: 100 })) });
      act(() => { container.dispatchEvent(event); });
      return event;
    };
    expect(touch('touchstart', [100]).defaultPrevented).toBe(false);
    expect(touch('touchstart', [100, 200]).defaultPrevented).toBe(true);
    expect(touch('touchmove', [50, 250]).defaultPrevented).toBe(true);
    expect(onScaleChange).toHaveBeenLastCalledWith(2);
    touch('touchend', []);
    onScaleChange.mockClear();
    touch('touchmove', [100]);
    expect(onScaleChange).not.toHaveBeenCalled();
  });

  it('uses the central tap zone for the HUD and side zones for bounded scrolling', () => {
    const onToggleHud = vi.fn();
    act(() => root.render(
      <WebtoonReader
        publication={SAMPLE_PUBLICATION}
        currentPage={0}
        onPageVisible={vi.fn()}
        onToggleHud={onToggleHud}
      />,
    ));
    const container = host.querySelector<HTMLElement>('[data-testid="webtoon-reader"]');
    expect(container).not.toBeNull();
    if (!container) return;
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 500 });
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 300, bottom: 500, width: 300, height: 500,
      x: 0, y: 0, toJSON: () => {},
    });
    const scrollBy = vi.fn();
    Object.defineProperty(container, 'scrollBy', { configurable: true, value: scrollBy });

    act(() => container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 150, clientY: 250 })));
    expect(onToggleHud).toHaveBeenCalledTimes(1);
    expect(scrollBy).not.toHaveBeenCalled();

    act(() => container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 450 })));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 360, behavior: 'smooth' });

    act(() => container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 280, clientY: 50 })));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -360, behavior: 'smooth' });
  });

  it('uses two quick taps to zoom the webtoon without scrolling first', () => {
    const onScaleChange = vi.fn();
    let renderedScale = 1;
    function Harness() {
      const [scale, setScale] = useState(1);
      return (
        <WebtoonReader
          publication={SAMPLE_PUBLICATION}
          currentPage={0}
          scale={scale}
          onScaleChange={(nextScale) => {
            renderedScale = nextScale;
            onScaleChange(nextScale);
            setScale(nextScale);
          }}
          onPageVisible={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const container = host.querySelector<HTMLElement>('[data-testid="webtoon-reader"]');
    expect(container).not.toBeNull();
    if (!container) return;
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 300, bottom: 500, width: 300, height: 500,
      x: 0, y: 0, toJSON: () => {},
    });
    const scrollBy = vi.fn();
    Object.defineProperty(container, 'scrollBy', { configurable: true, value: scrollBy });

    const tap = () => act(() => {
      container.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: 150,
        clientY: 250,
      }));
    });
    tap();
    tap();

    expect(renderedScale).toBe(2);
    expect(onScaleChange).toHaveBeenLastCalledWith(2);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('keeps the pinch focal point fixed while zooming a scrolled strip', () => {
    let renderedScale = 1;
    function Harness() {
      const [scale, setScale] = useState(1);
      return (
        <WebtoonReader
          publication={SAMPLE_PUBLICATION}
          currentPage={2}
          scale={scale}
          onScaleChange={(nextScale) => {
            renderedScale = nextScale;
            setScale(nextScale);
          }}
          onPageVisible={vi.fn()}
        />
      );
    }

    act(() => root.render(<Harness />));
    const container = host.querySelector<HTMLElement>('[data-testid="webtoon-reader"]');
    const strip = host.querySelector<HTMLElement>('.webtoon-strip');
    expect(container).not.toBeNull();
    expect(strip).not.toBeNull();
    if (!container || !strip) return;

    container.scrollTop = 1000;
    strip.getBoundingClientRect = () => ({
      left: -container.scrollLeft,
      top: -container.scrollTop,
      right: 400 * renderedScale - container.scrollLeft,
      bottom: 400 * renderedScale - container.scrollTop,
      width: 400 * renderedScale,
      height: 1200 * renderedScale,
      x: -container.scrollLeft,
      y: -container.scrollTop,
      toJSON: () => {},
    });

    const touch = (type: string, points: Array<{ clientX: number; clientY: number }>) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: points });
      act(() => container.dispatchEvent(event));
    };

    touch('touchstart', [
      { clientX: 100, clientY: 500 },
      { clientX: 200, clientY: 500 },
    ]);
    touch('touchmove', [
      { clientX: 50, clientY: 500 },
      { clientX: 250, clientY: 500 },
    ]);

    // The content point at y=500 remains at y=500 after the strip doubles in
    // size, instead of keeping the old absolute scrollTop and drifting upward.
    expect(container.scrollTop).toBe(2500);
  });

  it('renders all pages in a vertical continuous strip with folios', () => {
    const onPageVisible = vi.fn();
    act(() => {
      root.render(
        <WebtoonReader
          publication={SAMPLE_PUBLICATION}
          currentPage={0}
          rotation={0}
          background="atelier"
          scale={1}
          onPageVisible={onPageVisible}
        />,
      );
    });

    const pages = host.querySelectorAll('.webtoon-page-item');
    expect(pages).toHaveLength(3);
    expect(pages[0]?.getAttribute('data-page-index')).toBe('0');
    expect(pages[1]?.getAttribute('data-page-index')).toBe('1');
    expect(pages[2]?.getAttribute('data-page-index')).toBe('2');
  });

  it('keeps only visible pages and one neighbor mounted across a long chapter', () => {
    const publication = { ...SAMPLE_PUBLICATION, pageCount: 120,
      pages: Array.from({ length: 120 }, (_, index) => ({
        ...SAMPLE_PUBLICATION.pages[0], id: `page-${index}`, index,
      })),
    };
    const onPageVisible = vi.fn();
    act(() => root.render(<WebtoonReader publication={publication} currentPage={0} onPageVisible={onPageVisible} />));
    expect(host.querySelectorAll('article')).toHaveLength(120);
    expect(host.querySelectorAll('article img')).toHaveLength(2);
    const entry = (index: number, isIntersecting: boolean) => ({
      target: host.querySelector(`[data-page-index="${index}"]`)!, isIntersecting,
    } as IntersectionObserverEntry);
    act(() => notifyIntersections([entry(60, true)], {} as IntersectionObserver));
    expect(host.querySelectorAll('article img')).toHaveLength(3);
    expect(host.querySelector('[data-page-index="0"] img')).toBeNull();
    expect(host.querySelector('[data-page-index="60"] img')).not.toBeNull();
    expect(onPageVisible).toHaveBeenLastCalledWith(60);
    // A second callback does not include page 60, which is still visible.
    act(() => notifyIntersections([entry(61, true)], {} as IntersectionObserver));
    expect(host.querySelectorAll('article img')).toHaveLength(4);
    expect(onPageVisible).toHaveBeenLastCalledWith(60);
    act(() => notifyIntersections([entry(60, false)], {} as IntersectionObserver));
    expect(host.querySelectorAll('article img')).toHaveLength(3);
    expect(onPageVisible).toHaveBeenLastCalledWith(61);
  });

  it('applies background themes properly', () => {
    act(() => {
      root.render(
        <WebtoonReader
          publication={SAMPLE_PUBLICATION}
          currentPage={0}
          rotation={90}
          background="oled"
          scale={1.2}
          onPageVisible={vi.fn()}
        />,
      );
    });

    const container = host.querySelector('.webtoon-reader-container');
    expect(container?.getAttribute('data-background')).toBe('oled');
    expect(container?.className).toContain('webtoon-bg--oled');
  });

  it('renders next volume button and fires callback on click', () => {
    const onNextVolume = vi.fn();
    act(() => {
      root.render(
        <WebtoonReader
          publication={SAMPLE_PUBLICATION}
          currentPage={2}
          onPageVisible={vi.fn()}
          onNextVolume={onNextVolume}
          nextVolumeTitle="Tower of God - Volume 2"
        />,
      );
    });

    const nextBtn = host.querySelector<HTMLButtonElement>('.webtoon-next-volume button');
    expect(nextBtn).not.toBeNull();
    expect(nextBtn?.textContent).toContain('Next: Tower of God - Volume 2');

    act(() => nextBtn?.click());
    expect(onNextVolume).toHaveBeenCalledTimes(1);
  });

  it('toggles autoscroll when clicking the autoscroll HUD button', () => {
    act(() => {
      root.render(
        <WebtoonReader
          publication={SAMPLE_PUBLICATION}
          currentPage={0}
          onPageVisible={vi.fn()}
        />,
      );
    });

    const autoBtn = host.querySelector<HTMLButtonElement>('.webtoon-autoscroll-btn');
    expect(autoBtn).not.toBeNull();
    expect(autoBtn?.textContent).toContain('Autoscroll');

    act(() => autoBtn?.click());
    expect(autoBtn?.textContent).toContain('Pause autoscroll');
    expect(autoBtn?.className).toContain('webtoon-autoscroll-btn--active');

    act(() => autoBtn?.click());
    expect(autoBtn?.textContent).toContain('Autoscroll');
  });
  it('scrolls with hardware volume keys when the WebView forwards them', () => {
    act(() => {
      root.render(
        <WebtoonReader publication={SAMPLE_PUBLICATION} currentPage={0} onPageVisible={vi.fn()} />,
      );
    });
    const container = host.querySelector<HTMLElement>('[data-testid="webtoon-reader"]')!;
    const scrollBy = vi.fn();
    Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
    container.scrollBy = scrollBy;

    const press = (key: string, keyCode: number) => {
      const event = new KeyboardEvent('keydown', { key, keyCode, cancelable: true, bubbles: true });
      // keyCode is not settable via KeyboardEventInit in jsdom; force it.
      Object.defineProperty(event, 'keyCode', { value: keyCode });
      window.dispatchEvent(event);
      return event;
    };

    press('AudioVolumeDown', 25);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }));
    const downTop = scrollBy.mock.calls[0][0].top;
    expect(downTop).toBeGreaterThan(0);

    press('AudioVolumeUp', 24);
    const upTop = scrollBy.mock.calls[1][0].top;
    expect(upTop).toBeLessThan(0);
  });

  it('clears image src when a page leaves the virtual window', () => {
    act(() => {
      root.render(
        <WebtoonReader publication={SAMPLE_PUBLICATION} currentPage={0} onPageVisible={vi.fn()} />,
      );
    });
    // Default window is [0, 1]; page index 2 is outside and has no img.
    expect(host.querySelectorAll('img').length).toBeLessThan(SAMPLE_PUBLICATION.pages.length);

    act(() => {
      notifyIntersections(
        [
          {
            target: host.querySelector('[data-page-index="2"]'),
            isIntersecting: true,
            intersectionRatio: 1,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    const img = host.querySelector<HTMLImageElement>('[data-page-index="2"] img');
    expect(img).not.toBeNull();

    act(() => {
      notifyIntersections(
        [
          {
            target: host.querySelector('[data-page-index="2"]'),
            isIntersecting: false,
            intersectionRatio: 0,
          } as IntersectionObserverEntry,
          {
            target: host.querySelector('[data-page-index="0"]'),
            isIntersecting: true,
            intersectionRatio: 1,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(host.querySelector('[data-page-index="2"] img')).toBeNull();
  });
});