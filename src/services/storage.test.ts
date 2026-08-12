// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadBookmarks,
  loadFavorites,
  loadReaderState,
  saveBookmarks,
  saveFavorite,
  saveReaderState,
} from './storage';
import { defaultReaderState } from '../domain/readerState';

describe('browser fallback storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps favorites, bookmarks, and reader state isolated per publication', () => {
    saveFavorite('book-a', true);
    saveFavorite('book-b', true);
    saveBookmarks('book-a', [{ pageId: 'page-a', label: 'opening', createdAt: '1', updatedAt: '1' }]);
    saveBookmarks('book-b', [{ pageId: 'page-b', label: 'ending', createdAt: '2', updatedAt: '2' }]);
    saveReaderState('book-a', { zoomMode: 'manual', zoomScale: 1.5, panX: 20, panY: -10 });

    expect(loadFavorites()).toEqual(['book-a', 'book-b']);
    expect(loadBookmarks('book-a')).toEqual([
      { pageId: 'page-a', label: 'opening', createdAt: '1', updatedAt: '1' },
    ]);
    expect(loadBookmarks('book-b')).toEqual([
      { pageId: 'page-b', label: 'ending', createdAt: '2', updatedAt: '2' },
    ]);
    expect(loadReaderState('book-a')).toEqual({ zoomMode: 'manual', zoomScale: 1.5, panX: 20, panY: -10 });
    expect(loadReaderState('book-b')).toEqual(defaultReaderState);
  });

  it('returns safe defaults when versioned values are malformed', () => {
    window.localStorage.setItem('tactile-reader/favorites/v1', '{bad json');
    window.localStorage.setItem('tactile-reader/bookmarks/v1', JSON.stringify({ 'book-a': [{ pageId: 4 }] }));
    window.localStorage.setItem('tactile-reader/reader-state/v1', JSON.stringify({ 'book-a': { zoomMode: 'gpu' } }));

    expect(loadFavorites()).toEqual([]);
    expect(loadBookmarks('book-a')).toEqual([]);
    expect(loadReaderState('book-a')).toEqual(defaultReaderState);
  });
});
