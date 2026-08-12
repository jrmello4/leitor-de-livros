// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultReaderState } from './readerState';
import {
  loadBookmarks,
  loadFavorites,
  loadReaderState,
  saveBookmarks,
  saveFavorite,
  saveReaderState,
} from '../services/storage';

describe('reader state storage contracts', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists favorites independently by publication', () => {
    saveFavorite('book-a', true);
    saveFavorite('book-b', true);
    saveFavorite('book-a', false);

    expect(loadFavorites()).toEqual(['book-b']);
  });

  it('returns safe defaults when stored reader data is malformed', () => {
    window.localStorage.setItem('tactile-reader/reader-state/v1', '{not-json');

    expect(loadReaderState('book-a')).toEqual(defaultReaderState);
    expect(loadBookmarks('book-a')).toEqual([]);
  });

  it('round-trips reader state and bookmarks per publication', () => {
    const state = { zoomMode: 'manual' as const, zoomScale: 1.8, panX: 24, panY: -12 };
    const bookmarks = [{ pageId: 'page-2', label: 'climax', createdAt: '1000', updatedAt: '1000' }];

    saveReaderState('book-a', state);
    saveBookmarks('book-a', bookmarks);

    expect(loadReaderState('book-a')).toEqual(state);
    expect(loadBookmarks('book-a')).toEqual(bookmarks);
    expect(loadReaderState('book-b')).toEqual(defaultReaderState);
    expect(loadBookmarks('book-b')).toEqual([]);
  });
});
