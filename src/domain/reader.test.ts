import { describe, expect, it } from 'vitest';
import { calculateProgress, movePage, navigationAvailability, pageCounter, visiblePageIndexes } from './reader';
import type { PageDescriptor } from './types';

const pages: PageDescriptor[] = [1, 2, 3, 4].map((number, index) => ({
  id: `page-${number}`,
  index,
  name: `page-${number}.png`,
  src: `blob:${number}`,
  width: 100,
  height: 140,
}));

describe('reader navigation contracts', () => {
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
