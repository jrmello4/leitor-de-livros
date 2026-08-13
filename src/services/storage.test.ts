// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadProfileStore,
  loadBookmarks,
  loadFavorites,
  loadReaderState,
  saveBookmarks,
  saveFavorite,
  saveReaderState,
  saveProfileStore,
} from './storage';
import { createDefaultProfileStore } from '../domain/profiles';
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

  it('migrates the flat profile key into the named profile store', () => {
    window.localStorage.setItem('tactile-reader/profile/v1', JSON.stringify({
      version: 1,
      name: 'Archive mode',
      mode: 'spread',
      direction: 'rtl',
      contrast: 'standard',
      reducedMotion: false,
      pageTurnDuration: 480,
      layoutZone: 'right',
      bindings: { next_page: ['KeyN'] },
    }));

    const store = loadProfileStore();
    expect(store.profiles[0]).toMatchObject({ name: 'Archive mode', direction: 'rtl', layoutZone: 'right' });
    expect(store.profiles[0]?.bindings.next_page).toEqual(['KeyN']);
    expect(JSON.parse(window.localStorage.getItem('tactile-reader/profiles/v2') ?? '{}').version).toBe(2);
  });

  it('persists the active profile catalogue and rejects invalid stores', () => {
    const store = createDefaultProfileStore();
    expect(saveProfileStore(store)).toBe(true);
    expect(loadProfileStore()).toEqual(store);
    expect(saveProfileStore({ ...store, activeProfileId: 'missing' })).toBe(false);
  });

  it('uses a valid legacy profile instead of discarding it when the v2 store is corrupt', () => {
    window.localStorage.setItem('tactile-reader/profiles/v2', JSON.stringify({
      version: 2,
      activeProfileId: 'missing',
      profiles: [],
    }));
    window.localStorage.setItem('tactile-reader/profile/v1', JSON.stringify({
      version: 1,
      name: 'Recovered profile',
      direction: 'rtl',
      mode: 'single',
      contrast: 'standard',
      reducedMotion: false,
      pageTurnDuration: 420,
      layoutZone: 'top',
      bindings: {},
    }));

    const store = loadProfileStore();

    expect(store.profiles[0]).toMatchObject({ name: 'Recovered profile', direction: 'rtl' });
    expect(JSON.parse(window.localStorage.getItem('tactile-reader/profiles/v2') ?? '{}').version).toBe(2);
  });
});
