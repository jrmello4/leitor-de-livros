import { defaultReaderState, normalizeReaderState } from '../domain/readerState';
import type { Bookmark, ReaderState } from '../domain/types';
import {
  isNativeRuntime,
  listNativeBookmarks,
  loadNativeReaderState,
  removeNativeBookmark,
  saveNativeBookmark,
  saveNativeReaderState,
  setNativeFavorite,
} from './nativeLibrary';
import {
  loadBookmarks as loadStoredBookmarks,
  loadReaderState as loadStoredReaderState,
  saveBookmarks,
  saveReaderState as saveStoredReaderState,
  saveFavorite,
} from './storage';

/**
 * Hybrid adapters used by React. The native branch is the durable SQLite
 * source of truth; the browser branch intentionally stays on the versioned
 * localStorage contracts used by the demo and tests.
 */
export async function loadReaderStateForPublication(publicationId: string): Promise<ReaderState> {
  if (!isNativeRuntime()) {
    return loadStoredReaderState(publicationId);
  }

  const state = await loadNativeReaderState(publicationId);
  return state === null ? { ...defaultReaderState } : normalizeReaderState(state);
}

export async function saveReaderStateForPublication(publicationId: string, state: ReaderState): Promise<void> {
  const normalized = normalizeReaderState(state);
  if (!isNativeRuntime()) {
    saveStoredReaderState(publicationId, normalized);
    return;
  }
  await saveNativeReaderState(publicationId, normalized);
}

export async function listBookmarksForPublication(publicationId: string): Promise<Bookmark[]> {
  if (!isNativeRuntime()) {
    return loadStoredBookmarks(publicationId);
  }
  // Re-normalize here as well as in the raw bridge because callers may mock
  // the native bridge in tests or receive a stale plugin implementation.
  const bookmarks = await listNativeBookmarks(publicationId);
  return normalizeBookmarks(bookmarks);
}

export async function saveBookmarkForPublication(publicationId: string, bookmark: Bookmark): Promise<void> {
  const normalized = normalizeBookmark(bookmark);
  if (!normalized) {
    return;
  }
  if (!isNativeRuntime()) {
    const bookmarks = loadStoredBookmarks(publicationId).filter((entry) => entry.pageId !== normalized.pageId);
    saveBookmarks(publicationId, [...bookmarks, normalized]);
    return;
  }
  await saveNativeBookmark(publicationId, normalized);
}

export async function removeBookmarkForPublication(publicationId: string, pageId: string): Promise<void> {
  if (!isNativeRuntime()) {
    saveBookmarks(publicationId, loadStoredBookmarks(publicationId).filter((entry) => entry.pageId !== pageId));
    return;
  }
  await removeNativeBookmark(publicationId, pageId);
}

export async function toggleFavoriteForPublication(publicationId: string, isFavorite: boolean): Promise<void> {
  if (!isNativeRuntime()) {
    saveFavorite(publicationId, isFavorite);
    return;
  }
  await setNativeFavorite(publicationId, isFavorite);
}

// Short aliases make the adapter convenient for reader components while the
// longer names make the publication scope explicit at call sites.
export const loadReaderState = loadReaderStateForPublication;
export const saveReaderState = saveReaderStateForPublication;
export const listBookmarks = listBookmarksForPublication;
export const saveBookmark = saveBookmarkForPublication;
export const removeBookmark = removeBookmarkForPublication;
export const toggleFavorite = toggleFavoriteForPublication;

function normalizeBookmarks(value: unknown): Bookmark[] {
  return Array.isArray(value)
    ? value.map(normalizeBookmark).filter(Boolean) as Bookmark[]
    : [];
}

function normalizeBookmark(value: unknown): Bookmark | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const bookmark = value as Partial<Bookmark>;
  if (
    typeof bookmark.pageId !== 'string'
    || typeof bookmark.label !== 'string'
    || typeof bookmark.createdAt !== 'string'
    || typeof bookmark.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    pageId: bookmark.pageId,
    label: bookmark.label,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
  };
}
