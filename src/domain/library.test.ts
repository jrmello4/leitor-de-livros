import { describe, expect, it } from 'vitest';
import { mostRecentPublication, visiblePublications } from './library';
import type { Publication } from './types';

const publications: Publication[] = [
  {
    id: 'older',
    title: 'B Story',
    sourceLabel: 'older.cbz',
    format: 'cbz',
    pages: [],
    coverPageId: '',
    currentPage: 0,
    progress: 0.2,
    direction: 'ltr',
    addedAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z',
  },
  {
    id: 'newer',
    title: 'A Story',
    sourceLabel: 'newer.cbz',
    format: 'cbz',
    pages: [],
    coverPageId: '',
    currentPage: 0,
    progress: 0.8,
    direction: 'ltr',
    addedAt: '2026-08-11T08:00:00.000Z',
    updatedAt: '2026-08-11T08:00:00.000Z',
  },
];

describe('library view contracts', () => {
  it('sorts recent publications first and filters titles without mutating the source list', () => {
    expect(visiblePublications(publications, '', 'recent').map((publication) => publication.id)).toEqual(['newer', 'older']);
    expect(visiblePublications(publications, 'a story', 'title').map((publication) => publication.id)).toEqual(['newer']);
    expect(publications.map((publication) => publication.id)).toEqual(['older', 'newer']);
  });

  it('selects the most recent publication independently from shelf sorting', () => {
    const differentlyTitled = publications.map((publication) => ({
      ...publication,
      title: publication.id === 'older' ? 'A Story' : 'Z Story',
    }));
    const titleSorted = visiblePublications(differentlyTitled, '', 'title');

    expect(titleSorted.map((publication) => publication.id)).toEqual(['older', 'newer']);
    expect(mostRecentPublication(titleSorted)?.id).toBe('newer');
    expect(mostRecentPublication([])).toBeUndefined();
  });
});
