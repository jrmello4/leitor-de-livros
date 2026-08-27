import { describe, expect, it } from 'vitest';
import type { Publication } from './types';
import { generateLocalRecap } from './recap';

const SAMPLE_PUB: Publication = {
  id: 'pub-spider',
  title: 'Amazing Spider-Man #01',
  sourceLabel: 'spidey.cbz',
  format: 'cbz',
  coverSrc: 'blob:cover',
  coverPageId: 'page-1',
  pageCount: 30,
  currentPage: 14,
  progress: 50,
  direction: 'ltr',
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isFavorite: false,
  metadata: {
    title: 'Duel with the Green Goblin',
    series: 'Amazing Spider-Man',
    number: '1',
    summary: 'Peter Parker faces Norman Osborn in an epic showdown across Manhattan while protecting innocent citizens.',
    writer: 'Stan Lee',
    penciller: 'Steve Ditko',
    characters: ['Peter Parker', 'Norman Osborn', 'Aunt May'],
    tags: ['Marvel', 'Classic', 'Superhero'],
    year: 1963,
  },
  pages: Array.from({ length: 30 }, (_, i) => ({
    id: `page-${i + 1}`,
    index: i,
    name: `00${i + 1}.png`,
    src: `blob:page-${i + 1}`,
    width: 1000,
    height: 1500,
  })),
};

describe('recap domain', () => {
  it('generates a structured spoiler-safe recap based on current page milestone', () => {
    const recap = generateLocalRecap(SAMPLE_PUB, 14); // 15th page (50% progress)

    expect(recap.title).toBe('Amazing Spider-Man #01');
    expect(recap.pageIndex).toBe(14);
    expect(recap.pageCount).toBe(30);
    expect(recap.progressPercent).toBe(50);
    expect(recap.premise).toContain('Peter Parker faces Norman Osborn');
    expect(recap.currentMilestone).toBeDefined();
    expect(recap.activeCharacters).toEqual(['Peter Parker', 'Norman Osborn', 'Aunt May']);
  });

  it('handles publications without ComicInfo metadata gracefully', () => {
    const pubWithoutMeta: Publication = {
      ...SAMPLE_PUB,
      metadata: undefined,
    };

    const recap = generateLocalRecap(pubWithoutMeta, 5);
    expect(recap.title).toBe('Amazing Spider-Man #01');
    expect(recap.pageIndex).toBe(5);
    expect(recap.progressPercent).toBe(20);
    expect(recap.premise).toBeDefined();
    expect(recap.activeCharacters).toHaveLength(0);
  });
});
