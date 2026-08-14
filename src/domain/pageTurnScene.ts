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

  if (!turningFront || !turningVerso) {
    return undefined;
  }

  const under = input.pages[input.currentIndex + step * 2];
  const stationary = visiblePagesAt(input.pages, input.currentIndex, input.mode, input.readingDirection).filter(
    (page) => page.id !== turningFront.id,
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
      input.turnDirection,
    ].join(':'),
  };
}
