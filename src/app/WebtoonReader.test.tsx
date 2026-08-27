import { act } from 'react';
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

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    // Mock IntersectionObserver
    class MockIntersectionObserver {
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
});
