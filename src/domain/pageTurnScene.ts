import { visiblePageIndexes } from './reader';
import type { TurnDirection } from './pageTurnTypes';
import type { PageDescriptor, ReadingDirection, ReadingMode } from './types';

export interface PageTurnSceneInput {
  pages: PageDescriptor[];
  currentIndex: number;
  mode: ReadingMode;
  readingDirection: ReadingDirection;
  turnDirection: TurnDirection;
}

export interface PageTurnScene {
  stationary: PageDescriptor[];
  turningFront: PageDescriptor;
  turningVerso: PageDescriptor;
  under?: PageDescriptor;
  committed: PageDescriptor[];
  versoUv: 'back-face-readable';
  generationKey: string;
}

function visiblePagesAt(
  pages: PageDescriptor[],
  currentIndex: number,
  mode: ReadingMode,
  readingDirection: ReadingDirection,
): PageDescriptor[] {
  return visiblePageIndexes(currentIndex, pages, mode, readingDirection)
    .map((pageIndex) => pages[pageIndex])
    .filter((page): page is PageDescriptor => Boolean(page));
}

export function buildPageTurnScene(input: PageTurnSceneInput): PageTurnScene | undefined {
  const step = input.turnDirection === 'forward' ? 1 : -1;
  const turningFront = input.pages[input.currentIndex];
  const turningVerso = input.pages[input.currentIndex + step];

  // A page whose derived image has not been rebuilt yet has no source to draw
  // from. Building the scene anyway makes the surface fail to decode it, which
  // reports a renderer failure and costs the reader the animation; declining
  // here lets the turn fall back to a plain page change until the cache
  // catches up.
  if (!turningFront?.src || !turningVerso?.src) {
    return undefined;
  }

  const underIndex = input.mode === 'single'
    ? input.currentIndex + step
    : input.currentIndex + step * 2;
  const underPage = input.pages[underIndex];
  const under = underPage?.src ? underPage : undefined;
  const stationary = visiblePagesAt(input.pages, input.currentIndex, input.mode, input.readingDirection).filter(
    (page) => page.id !== turningFront.id && page.id !== turningVerso.id,
  );
  const committed = visiblePagesAt(
    input.pages,
    input.currentIndex + step,
    input.mode,
    input.readingDirection,
  );

  return {
    stationary,
    turningFront,
    turningVerso,
    under,
    committed,
    versoUv: 'back-face-readable',
    generationKey: [
      turningFront.id,
      turningVerso.id,
      under?.id ?? 'paper',
      input.mode,
      input.readingDirection,
    ].join(':'),
  };
}
