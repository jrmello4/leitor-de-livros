import { describe, expect, it } from 'vitest';
import {
  activeWorkingSetPageIds,
  calculateProgress,
  clampPan,
  clampZoomScale,
  movePage,
  navigationAvailability,
  pageCounter,
  visiblePageIndexes,
} from './reader';
import { createDefaultProfile } from './profiles';
import type { PageDescriptor, Publication } from './types';

const pages: PageDescriptor[] = [1, 2, 3, 4].map((number, index) => ({
  id: `page-${number}`,
  index,
  name: `page-${number}.png`,
  src: `blob:${number}`,
  width: 100,
  height: 140,
}));

const longPages: PageDescriptor[] = Array.from({ length: 8 }, (_, index) => ({
  id: `page-${index + 1}`,
  index,
  name: `page-${index + 1}.png`,
  src: `blob:${index + 1}`,
  width: 100,
  height: 140,
}));

const publicationAtPageTwo: Publication = {
  id: 'long-publication',
  title: 'Long publication',
  sourceLabel: 'long.cbz',
  format: 'cbz',
  pages: longPages,
  pageCount: (longPages).length,
  coverSrc: (longPages)[0]?.src ?? '',
  coverPageId: longPages[0].id,
  currentPage: 1,
  progress: 0.25,
  direction: 'ltr',
  addedAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  isFavorite: false,
};

describe('reader navigation contracts', () => {
  it('clamps manual zoom to the supported range', () => {
    expect(clampZoomScale(0.1)).toBe(0.5);
    expect(clampZoomScale(1.4)).toBe(1.4);
    expect(clampZoomScale(6)).toBe(5);
  });

  it('keeps pan inside the bounded viewport for manual zoom', () => {
    expect(clampPan(420, -80, 2)).toEqual({ x: 420, y: -80 });
    expect(clampPan(-1800, 1800, 2)).toEqual({ x: -1200, y: 1200 });
    expect(clampPan(-420, 420, 1)).toEqual({ x: 0, y: 0 });
  });

  it('moves forward in LTR and backward in RTL without leaving the book', () => {
    expect(movePage(0, 4, 'ltr', 1)).toBe(1);
    expect(movePage(0, 4, 'rtl', 1)).toBe(0);
    expect(movePage(3, 4, 'rtl', 1)).toBe(2);
    expect(movePage(0, 4, 'ltr', -1)).toBe(0);
  });

  it('keeps spread ordering aligned with the reading direction', () => {
    expect(visiblePageIndexes(1, pages, 'spread', 'ltr')).toEqual([1, 2]);
    expect(visiblePageIndexes(2, pages, 'spread', 'rtl')).toEqual([1, 2]);
    expect(visiblePageIndexes(0, pages, 'single', 'ltr')).toEqual([0]);
  });

  it('detects landscape splash pages and presents them as a single full spread in spread mode', () => {
    const splashPages: PageDescriptor[] = [
      { id: 'p0', index: 0, name: '0.png', src: 'blob:0', width: 800, height: 1200 },
      { id: 'p1', index: 1, name: '1.png', src: 'blob:1', width: 1800, height: 1200 }, // Landscape splash!
      { id: 'p2', index: 2, name: '2.png', src: 'blob:2', width: 800, height: 1200 },
    ];

    expect(visiblePageIndexes(0, splashPages, 'spread', 'ltr')).toEqual([0]); // Neighbor is splash, so p0 is standalone
    expect(visiblePageIndexes(1, splashPages, 'spread', 'ltr')).toEqual([1]); // Splash page occupies full spread
    expect(visiblePageIndexes(2, splashPages, 'spread', 'ltr')).toEqual([2]);
  });

  it('protects the destination page working set instead of the previous page neighbors', () => {
    const singleLtrProfile = createDefaultProfile();

    expect(activeWorkingSetPageIds(publicationAtPageTwo, singleLtrProfile, 5)).toEqual([
      'page-5',
      'page-6',
      'page-7',
    ]);
  });

  it('bounds destination working sets for spread, RTL, and publication edges', () => {
    const singleLtrProfile = createDefaultProfile();
    const spreadRtlProfile = { ...singleLtrProfile, mode: 'spread' as const, direction: 'rtl' as const };

    expect(activeWorkingSetPageIds(publicationAtPageTwo, spreadRtlProfile, 7)).toEqual(['page-7', 'page-8']);
    expect(activeWorkingSetPageIds(publicationAtPageTwo, singleLtrProfile, 0)).toEqual(['page-1', 'page-2']);
  });

  it('reports bounded progress and a stable counter', () => {
    expect(calculateProgress(0, 4)).toBe(0.25);
    expect(calculateProgress(3, 4, 'rtl')).toBe(0.25);
    expect(calculateProgress(0, 4, 'rtl')).toBe(1);
    expect(calculateProgress(99, 4)).toBe(1);
    expect(calculateProgress(0, 0)).toBe(0);
    expect(pageCounter(1, 4)).toBe('02 / 04');
  });

  it('reports logical next and previous availability at both reading boundaries', () => {
    expect(navigationAvailability(0, 4, 'ltr')).toEqual({ canNext: true, canPrevious: false });
    expect(navigationAvailability(3, 4, 'ltr')).toEqual({ canNext: false, canPrevious: true });
    expect(navigationAvailability(3, 4, 'rtl')).toEqual({ canNext: true, canPrevious: false });
    expect(navigationAvailability(0, 4, 'rtl')).toEqual({ canNext: false, canPrevious: true });
  });
});
