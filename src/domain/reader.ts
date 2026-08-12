import type { PageDescriptor, ReadingDirection, ReadingMode } from './types';

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function calculateProgress(currentPage: number, pageCount: number, direction: ReadingDirection = 'ltr'): number {
  if (pageCount <= 0) {
    return 0;
  }

  if (pageCount === 1) {
    return 1;
  }

  const logicalPage = direction === 'rtl' ? pageCount - 1 - currentPage : currentPage;
  return clamp((logicalPage + 1) / pageCount, 0, 1);
}

export function movePage(
  currentPage: number,
  pageCount: number,
  direction: ReadingDirection,
  delta: number,
): number {
  if (pageCount <= 0) {
    return 0;
  }

  const signedDelta = direction === 'rtl' ? -delta : delta;
  return clamp(currentPage + signedDelta, 0, pageCount - 1);
}

export interface NavigationAvailability {
  canNext: boolean;
  canPrevious: boolean;
}

export function navigationAvailability(
  currentPage: number,
  pageCount: number,
  direction: ReadingDirection,
): NavigationAvailability {
  const safeCurrent = pageCount > 0 ? clamp(currentPage, 0, pageCount - 1) : 0;
  return {
    canNext: movePage(safeCurrent, pageCount, direction, 1) !== safeCurrent,
    canPrevious: movePage(safeCurrent, pageCount, direction, -1) !== safeCurrent,
  };
}

export function visiblePageIndexes(
  currentPage: number,
  pages: PageDescriptor[],
  mode: ReadingMode,
  direction: ReadingDirection,
): number[] {
  if (pages.length === 0) {
    return [];
  }

  const safeCurrent = clamp(currentPage, 0, pages.length - 1);
  if (mode === 'single') {
    return [safeCurrent];
  }

  const neighbor = direction === 'rtl' ? safeCurrent - 1 : safeCurrent + 1;
  if (neighbor < 0 || neighbor >= pages.length) {
    return [safeCurrent];
  }

  return direction === 'rtl' ? [neighbor, safeCurrent] : [safeCurrent, neighbor];
}

export function pageCounter(currentPage: number, pageCount: number): string {
  if (pageCount === 0) {
    return 'No pages';
  }

  return `${Math.min(currentPage + 1, pageCount).toString().padStart(2, '0')} / ${pageCount
    .toString()
    .padStart(2, '0')}`;
}
