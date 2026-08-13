import type { PageDescriptor, Publication, ReadingDirection, ReadingMode, ReadingProfile } from './types';

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

export function clampZoomScale(scale: number): number {
  return clamp(scale, 0.5, 3);
}

export interface PanPosition {
  x: number;
  y: number;
}

/** Keep manual panning bounded; scale 1 has no available pan distance. */
export function clampPan(
  panX: number,
  panY: number,
  scale: number,
  maxX = 80,
  maxY = maxX,
): PanPosition {
  const safeScale = clampZoomScale(scale);
  const xLimit = Math.max(0, (safeScale - 1) * maxX);
  const yLimit = Math.max(0, (safeScale - 1) * maxY);
  const x = clamp(Number.isFinite(panX) ? panX : 0, -xLimit, xLimit);
  const y = clamp(Number.isFinite(panY) ? panY : 0, -yLimit, yLimit);
  return {
    x: x === 0 ? 0 : x,
    y: y === 0 ? 0 : y,
  };
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

export function activeWorkingSetPageIds(
  publication: Publication,
  profile: ReadingProfile,
  pageIndex: number,
): string[] {
  if (publication.pages.length === 0) {
    return [];
  }

  const safePageIndex = clamp(pageIndex, 0, publication.pages.length - 1);
  const indexes = new Set([
    ...visiblePageIndexes(safePageIndex, publication.pages, profile.mode, profile.direction),
    safePageIndex - 1,
    safePageIndex,
    safePageIndex + 1,
  ]);

  return [...indexes]
    .filter((index) => index >= 0 && index < publication.pages.length)
    .sort((left, right) => left - right)
    .map((index) => publication.pages[index]?.id)
    .filter((id): id is string => Boolean(id));
}

export function pageCounter(currentPage: number, pageCount: number): string {
  if (pageCount === 0) {
    return '00 / 00';
  }

  return `${Math.min(currentPage + 1, pageCount).toString().padStart(2, '0')} / ${pageCount
    .toString()
    .padStart(2, '0')}`;
}
