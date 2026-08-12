import { cloneBindings, DEFAULT_BINDINGS } from '../domain/input';
import type { BindingMap, ReadingProfile } from '../domain/types';
import type { Bookmark, ReaderState } from '../domain/types';
import { defaultReaderState, normalizeReaderState } from '../domain/readerState';

const PROFILE_KEY = 'tactile-reader/profile/v1';
const PROGRESS_KEY = 'tactile-reader/progress/v1';
const FAVORITES_KEY = 'tactile-reader/favorites/v1';
const BOOKMARKS_KEY = 'tactile-reader/bookmarks/v1';
const READER_STATE_KEY = 'tactile-reader/reader-state/v1';

const defaultProfile: ReadingProfile = {
  version: 1,
  name: 'Paper Atelier',
  mode: 'single',
  direction: 'ltr',
  contrast: 'standard',
  reducedMotion: false,
  pageTurnDuration: 420,
  layoutZone: 'top',
  bindings: cloneBindings(DEFAULT_BINDINGS),
};

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(): ReadingProfile {
  const storage = getStorage();
  if (!storage) {
    return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
  }

  try {
    const stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? 'null') as Partial<ReadingProfile> | null;
    if (!stored || stored.version !== 1) {
      return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
    }

    return {
      ...defaultProfile,
      ...stored,
      bindings: cloneBindings((stored.bindings as BindingMap | undefined) ?? defaultProfile.bindings),
    };
  } catch {
    return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
  }
}

export function saveProfile(profile: ReadingProfile): void {
  getStorage()?.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function hasStoredProfile(): boolean {
  return getStorage()?.getItem(PROFILE_KEY) !== null;
}

export function loadProgress(publicationId: string): number {
  const storage = getStorage();
  if (!storage) {
    return 0;
  }

  try {
    const progress = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>;
    return Number.isInteger(progress[publicationId]) ? Math.max(0, progress[publicationId]) : 0;
  } catch {
    return 0;
  }
}

export function saveProgress(publicationId: string, pageIndex: number): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const progress = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>;
    progress[publicationId] = pageIndex;
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    return;
  }
}

export function resetProfile(): ReadingProfile {
  const storage = getStorage();
  storage?.removeItem(PROFILE_KEY);
  return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
}

export function loadFavorites(): string[] {
  return loadValue(FAVORITES_KEY, [], (value): value is string[] => (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  ));
}

export function saveFavorite(publicationId: string, isFavorite: boolean): void {
  const favorites = new Set(loadFavorites());
  if (isFavorite) {
    favorites.add(publicationId);
  } else {
    favorites.delete(publicationId);
  }
  saveValue(FAVORITES_KEY, [...favorites]);
}

export function loadBookmarks(publicationId: string): Bookmark[] {
  const bookmarks = loadValue(BOOKMARKS_KEY, {}, isBookmarkMap);
  return bookmarks[publicationId] ?? [];
}

export function saveBookmarks(publicationId: string, bookmarks: Bookmark[]): void {
  const allBookmarks = loadValue(BOOKMARKS_KEY, {}, isBookmarkMap);
  saveValue(BOOKMARKS_KEY, { ...allBookmarks, [publicationId]: bookmarks });
}

export function loadReaderState(publicationId: string): ReaderState {
  const states = loadValue(READER_STATE_KEY, {}, isRecord);
  return normalizeReaderState(states[publicationId] ?? defaultReaderState);
}

export function saveReaderState(publicationId: string, state: ReaderState): void {
  const states = loadValue(READER_STATE_KEY, {}, isRecord);
  saveValue(READER_STATE_KEY, { ...states, [publicationId]: normalizeReaderState(state) });
}

/** Remove only browser-side metadata for a publication. Imported source files
 * are represented by object URLs and are never touched by this operation. */
export function clearPublicationStorage(publicationId: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const favorites = loadFavorites().filter((id) => id !== publicationId);
    saveValue(FAVORITES_KEY, favorites);

    const bookmarks = loadValue(BOOKMARKS_KEY, {}, isBookmarkMap);
    delete bookmarks[publicationId];
    saveValue(BOOKMARKS_KEY, bookmarks);

    const states = loadValue(READER_STATE_KEY, {}, isRecord);
    delete states[publicationId];
    saveValue(READER_STATE_KEY, states);

    const progress = loadValue(PROGRESS_KEY, {}, isRecord);
    delete progress[publicationId];
    saveValue(PROGRESS_KEY, progress);
  } catch {
    // Storage can be unavailable or quota-limited; the native caller reports
    // no destructive filesystem work even when metadata cleanup is skipped.
    return;
  }
}

function loadValue<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  const storage = getStorage();
  if (!storage) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? 'null');
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveValue(key: string, value: unknown): void {
  try {
    getStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function isBookmarkMap(value: unknown): value is Record<string, Bookmark[]> {
  return isRecord(value) && Object.values(value).every((bookmarks) => (
    Array.isArray(bookmarks) && bookmarks.every(isBookmark)
  ));
}

function isBookmark(value: unknown): value is Bookmark {
  return isRecord(value)
    && typeof value.pageId === 'string'
    && typeof value.label === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
