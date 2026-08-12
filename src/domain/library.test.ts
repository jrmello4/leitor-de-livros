import { describe, expect, it } from 'vitest';
import { mostRecentPublication, nextBookmark, sortBookmarks, visiblePublications } from './library';
import type { Bookmark, Publication } from './types';

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
    isFavorite: false,
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
    isFavorite: false,
  },
];

describe('library view contracts', () => {
  it('toggles a page bookmark without touching other pages', () => {
    const next = nextBookmark([], 'page-2', 'climax', '1000');
    expect(next[0]).toMatchObject({ pageId: 'page-2', label: 'climax', createdAt: '1000', updatedAt: '1000' });
    expect(nextBookmark(next, 'page-2', '', '1001')).toEqual([]);
  });

  it('orders bookmarks by their page order and preserves unknown pages afterward', () => {
    const bookmarks: Bookmark[] = [
      { pageId: 'page-3', label: 'third', createdAt: '3', updatedAt: '3' },
      { pageId: 'missing', label: 'missing', createdAt: '4', updatedAt: '4' },
      { pageId: 'page-1', label: 'first', createdAt: '1', updatedAt: '1' },
    ];

    expect(sortBookmarks(bookmarks, pagesForBookmarks).map((bookmark) => bookmark.pageId)).toEqual([
      'page-1',
      'page-3',
      'missing',
    ]);
  });

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

const pagesForBookmarks = [
  { id: 'page-1', index: 0, name: '1.png', src: 'blob:1', width: 100, height: 140 },
  { id: 'page-2', index: 1, name: '2.png', src: 'blob:2', width: 100, height: 140 },
  { id: 'page-3', index: 2, name: '3.png', src: 'blob:3', width: 100, height: 140 },
];
