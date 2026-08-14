import { describe, expect, it } from 'vitest';
import { buildPageTurnScene } from './pageTurnScene';
import type { PageDescriptor, ReadingDirection, ReadingMode } from './types';
import type { TurnDirection } from './pageTurnTypes';

function createPages(count: number, srcPrefix = 'asset://page'): PageDescriptor[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    index,
    name: `Page ${index + 1}`,
    src: `${srcPrefix}-${index}.png`,
    width: 800,
    height: 1200,
  }));
}

describe('buildPageTurnScene', () => {
  it.each([
    {
      mode: 'single' as const,
      readingDirection: 'ltr' as const,
      turnDirection: 'forward' as const,
      currentIndex: 1,
      expected: {
        stationary: [],
        turningFront: 'p1',
        turningVerso: 'p2',
        under: 'p3',
        committed: ['p2'],
      },
    },
    {
      mode: 'single' as const,
      readingDirection: 'rtl' as const,
      turnDirection: 'forward' as const,
      currentIndex: 1,
      expected: {
        stationary: [],
        turningFront: 'p1',
        turningVerso: 'p2',
        under: 'p3',
        committed: ['p2'],
      },
    },
    {
      mode: 'single' as const,
      readingDirection: 'ltr' as const,
      turnDirection: 'backward' as const,
      currentIndex: 2,
      expected: {
        stationary: [],
        turningFront: 'p2',
        turningVerso: 'p1',
        under: 'p0',
        committed: ['p1'],
      },
    },
    {
      mode: 'spread' as const,
      readingDirection: 'ltr' as const,
      turnDirection: 'forward' as const,
      currentIndex: 2,
      expected: {
        stationary: ['p3'],
        turningFront: 'p2',
        turningVerso: 'p3',
        under: 'p4',
        committed: ['p3', 'p4'],
      },
    },
    {
      mode: 'spread' as const,
      readingDirection: 'rtl' as const,
      turnDirection: 'forward' as const,
      currentIndex: 2,
      expected: {
        stationary: ['p1'],
        turningFront: 'p2',
        turningVerso: 'p3',
        under: 'p4',
        committed: ['p2', 'p3'],
      },
    },
    {
      mode: 'spread' as const,
      readingDirection: 'rtl' as const,
      turnDirection: 'backward' as const,
      currentIndex: 2,
      expected: {
        stationary: ['p1'],
        turningFront: 'p2',
        turningVerso: 'p1',
        under: 'p0',
        committed: ['p0', 'p1'],
      },
    },
  ] satisfies Array<{
    mode: ReadingMode;
    readingDirection: ReadingDirection;
    turnDirection: TurnDirection;
    currentIndex: number;
    expected: {
      stationary: string[];
      turningFront: string;
      turningVerso: string;
      under: string | undefined;
      committed: string[];
    };
  }>)('maps $mode $readingDirection $turnDirection from page $currentIndex', ({ mode, readingDirection, turnDirection, currentIndex, expected }) => {
    const scene = buildPageTurnScene({
      pages: createPages(6),
      currentIndex,
      mode,
      readingDirection,
      turnDirection,
    });

    expect(scene).toBeDefined();
    expect(scene && {
      stationary: scene.stationary.map((page) => page.id),
      turningFront: scene.turningFront.id,
      turningVerso: scene.turningVerso.id,
      under: scene.under?.id,
      committed: scene.committed.map((page) => page.id),
    }).toEqual(expected);
  });

  it('returns undefined when the requested turn would cross the page boundaries', () => {
    const pages = createPages(4);

    expect(
      buildPageTurnScene({
        pages,
        currentIndex: 0,
        mode: 'single',
        readingDirection: 'ltr',
        turnDirection: 'backward',
      }),
    ).toBeUndefined();

    expect(
      buildPageTurnScene({
        pages,
        currentIndex: 3,
        mode: 'spread',
        readingDirection: 'rtl',
        turnDirection: 'forward',
      }),
    ).toBeUndefined();
  });

  it('keeps boundary under-pages missing instead of duplicating a texture on odd-count spreads', () => {
    const scene = buildPageTurnScene({
      pages: createPages(5),
      currentIndex: 3,
      mode: 'spread',
      readingDirection: 'ltr',
      turnDirection: 'forward',
    });

    expect(scene && {
      stationary: scene.stationary.map((page) => page.id),
      turningFront: scene.turningFront.id,
      turningVerso: scene.turningVerso.id,
      under: scene.under?.id,
      committed: scene.committed.map((page) => page.id),
    }).toEqual({
      stationary: ['p4'],
      turningFront: 'p3',
      turningVerso: 'p4',
      under: undefined,
      committed: ['p4'],
    });
  });

  it('marks the verso UV as readable on the back face', () => {
    const scene = buildPageTurnScene({
      pages: createPages(3),
      currentIndex: 1,
      mode: 'single',
      readingDirection: 'ltr',
      turnDirection: 'backward',
    });

    expect(scene?.versoUv).toBe('back-face-readable');
  });

  it('treats PageDescriptor.src as opaque URI data regardless of source format hints', () => {
    const sourcePrefixes = [
      'asset://pdf/page',
      'asset://cbz/page',
      'asset://cbr/page',
      'asset://images/page',
      'https://example.com/vol-1/page',
      'blob:reader/page',
    ];

    for (const srcPrefix of sourcePrefixes) {
      const scene = buildPageTurnScene({
        pages: createPages(4, srcPrefix),
        currentIndex: 1,
        mode: 'single',
        readingDirection: 'rtl',
        turnDirection: 'forward',
      });

      expect(scene?.turningFront.src).toBe(`${srcPrefix}-1.png`);
      expect(scene?.turningVerso.src).toBe(`${srcPrefix}-2.png`);
      expect(scene?.under?.src).toBe(`${srcPrefix}-3.png`);
    }
  });
});
