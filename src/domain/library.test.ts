import { describe, expect, it } from 'vitest';
import { filterPublications, mostRecentPublication, nextBookmark, readingStatus, sortBookmarks, visiblePublications } from './library';
import type { Bookmark, Publication } from './types';

const publications: Publication[] = [
  {
    id: 'older',
    title: 'B Story',
    sourceLabel: 'older.cbz',
    format: 'cbz',
    pages: [],
    pageCount: 0,
    coverSrc: '',
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
    pageCount: 0,
    coverSrc: '',
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

  it('matches safe source filenames without matching an absolute local path', () => {
    const filenameOnly = {
      ...publications[0],
      id: 'filename-only',
      title: 'Untitled',
      sourceLabel: 'chapter-07.cbz',
      sourceNames: ['chapter-07.cbz'],
    };

    expect(visiblePublications([filenameOnly], 'chapter-07', 'recent').map((publication) => publication.id))
      .toEqual(['filename-only']);
    expect(visiblePublications([filenameOnly], 'C:\\private\\chapter-07.cbz', 'recent')).toEqual([]);
    expect(visiblePublications([filenameOnly], 'missing', 'recent')).toEqual([]);
  });

  it('sorts by recent, title, and added date with deterministic tie breakers', () => {
    const tied = [
      {
        ...publications[0],
        id: 'b',
        title: 'Same title',
        sourceLabel: 'same.cbz',
        addedAt: '2026-08-12T08:00:00.000Z',
        updatedAt: '2026-08-12T08:00:00.000Z',
      },
      {
        ...publications[1],
        id: 'a',
        title: 'Same title',
        sourceLabel: 'same.cbz',
        addedAt: '2026-08-12T08:00:00.000Z',
        updatedAt: '2026-08-12T08:00:00.000Z',
      },
      {
        ...publications[0],
        id: 'older-added',
        title: 'Earlier',
        sourceLabel: 'earlier.cbz',
        addedAt: '2026-08-10T08:00:00.000Z',
        updatedAt: '2026-08-13T08:00:00.000Z',
      },
    ];

    expect(visiblePublications(tied, '', 'recent').map((publication) => publication.id))
      .toEqual(['older-added', 'a', 'b']);
    expect(visiblePublications(tied, '', 'title').map((publication) => publication.id))
      .toEqual(['older-added', 'a', 'b']);
    expect(visiblePublications(tied, '', 'added').map((publication) => publication.id))
      .toEqual(['a', 'b', 'older-added']);
  });

  it('determines reading status from progress value', () => {
    expect(readingStatus({ ...publications[0], progress: 0 })).toBe('unread');
    expect(readingStatus({ ...publications[0], progress: 0.5 })).toBe('reading');
    expect(readingStatus({ ...publications[0], progress: 1.0 })).toBe('completed');
  });

  it('filters publications by format and reading status', () => {
    const mixedPublications: Publication[] = [
      { ...publications[0], id: 'unread-cbz', format: 'cbz', progress: 0 },
      { ...publications[0], id: 'reading-cbz', format: 'cbz', progress: 0.5 },
      { ...publications[0], id: 'completed-pdf', format: 'pdf', progress: 1.0 },
      { ...publications[0], id: 'unread-cbr', format: 'cbr', progress: 0 },
    ];

    expect(filterPublications(mixedPublications, 'all', 'all')).toHaveLength(4);
    expect(filterPublications(mixedPublications, 'cbz', 'all').map((p) => p.id)).toEqual(['unread-cbz', 'reading-cbz']);
    expect(filterPublications(mixedPublications, 'pdf', 'all').map((p) => p.id)).toEqual(['completed-pdf']);
    expect(filterPublications(mixedPublications, 'all', 'unread').map((p) => p.id)).toEqual(['unread-cbz', 'unread-cbr']);
    expect(filterPublications(mixedPublications, 'all', 'reading').map((p) => p.id)).toEqual(['reading-cbz']);
    expect(filterPublications(mixedPublications, 'all', 'completed').map((p) => p.id)).toEqual(['completed-pdf']);
    expect(filterPublications(mixedPublications, 'cbz', 'unread').map((p) => p.id)).toEqual(['unread-cbz']);
    expect(filterPublications(mixedPublications, 'pdf', 'unread')).toEqual([]);
  });
});

const pagesForBookmarks = [
  { id: 'page-1', index: 0, name: '1.png', src: 'blob:1', width: 100, height: 140 },
  { id: 'page-2', index: 1, name: '2.png', src: 'blob:2', width: 100, height: 140 },
  { id: 'page-3', index: 2, name: '3.png', src: 'blob:3', width: 100, height: 140 },
];
