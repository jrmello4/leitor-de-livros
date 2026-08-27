import {
  createDefaultProfileStore,
  getActiveProfile,
  tryMigrateProfileStore,
  type ProfileStore,
  validateProfileStore,
} from '../domain/profiles';
import type { ReadingProfile } from '../domain/types';
import type { Bookmark, CustomCover, ReaderState } from '../domain/types';
import { normalizeCustomCover } from '../domain/covers';
import { defaultReaderState, normalizeReaderState } from '../domain/readerState';
import { createEmptyReadingStats, normalizeReadingStats, recordReadingActivity, type ReadingStats } from '../domain/readingStats';
import { normalizeAchievementMap } from '../domain/achievements';
import { normalizeReview, normalizeReviewMap, type PublicationReview } from '../domain/reviews';

const PROFILE_KEY = 'tactile-reader/profile/v1';
const PROFILE_STORE_KEY = 'tactile-reader/profiles/v2';
const PROGRESS_KEY = 'tactile-reader/progress/v1';
const FAVORITES_KEY = 'tactile-reader/favorites/v1';
const BOOKMARKS_KEY = 'tactile-reader/bookmarks/v1';
const READER_STATE_KEY = 'tactile-reader/reader-state/v1';
const CUSTOM_COVERS_KEY = 'tactile-reader/custom-covers/v1';
const READING_STATS_KEY = 'tactile-reader/reading-stats/v1';
const ACHIEVEMENTS_KEY = 'tactile-reader/achievements/v1';
const REVIEWS_KEY = 'tactile-reader/reviews/v1';

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadProfileStore(): ProfileStore {
  const storage = getStorage();
  if (!storage) {
    return createDefaultProfileStore();
  }

  try {
    const currentJson = storage.getItem(PROFILE_STORE_KEY);
    const legacyJson = storage.getItem(PROFILE_KEY);
    const current = parseStoredProfile(currentJson);
    const legacy = parseStoredProfile(legacyJson);
    const migrated = tryMigrateProfileStore(current)
      ?? tryMigrateProfileStore(legacy)
      ?? createDefaultProfileStore();
    if (currentJson === null || !validateProfileStore(current).ok) {
      writeProfileStore(storage, migrated);
    }
    return migrated;
  } catch {
    return createDefaultProfileStore();
  }
}

export function loadProfile(): ReadingProfile {
  return getActiveProfile(loadProfileStore());
}

export function saveProfileStore(store: ProfileStore): boolean {
  const validation = validateProfileStore(store);
  if (!validation.ok) {
    return false;
  }
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  try {
    writeProfileStore(storage, validation.value);
    return true;
  } catch {
    return false;
  }
}

export function saveProfile(profile: ReadingProfile): void {
  const store = loadProfileStore();
  const active = getActiveProfile(store);
  const nextStore = {
    ...store,
    profiles: store.profiles.map((candidate) => candidate.id === active.id
      ? { ...candidate, ...profile, id: candidate.id, version: 1 as const }
      : candidate),
  };
  saveProfileStore(nextStore);
}

export function hasStoredProfile(): boolean {
  const storage = getStorage();
  return storage?.getItem(PROFILE_STORE_KEY) !== null || storage?.getItem(PROFILE_KEY) !== null;
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

export function resetProfileStore(): ProfileStore {
  const storage = getStorage();
  storage?.removeItem(PROFILE_STORE_KEY);
  storage?.removeItem(PROFILE_KEY);
  return createDefaultProfileStore();
}

export function resetProfile(): ReadingProfile {
  return getActiveProfile(resetProfileStore());
}

function writeProfileStore(storage: Storage, store: ProfileStore): void {
  storage.setItem(PROFILE_STORE_KEY, JSON.stringify(store));
  storage.removeItem(PROFILE_KEY);
}

function parseStoredProfile(json: string | null): unknown {
  if (json === null) {
    return null;
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
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

export function loadCustomCover(publicationId: string): CustomCover | undefined {
  return loadCustomCoverMap()[publicationId];
}

export function saveCustomCover(publicationId: string, cover: CustomCover): boolean {
  const normalized = normalizeCustomCover(cover);
  if (!normalized) {
    return false;
  }
  const covers = loadCustomCoverMap();
  return saveValue(CUSTOM_COVERS_KEY, { ...covers, [publicationId]: normalized });
}

export function clearCustomCover(publicationId: string): boolean {
  const covers = loadCustomCoverMap();
  delete covers[publicationId];
  return saveValue(CUSTOM_COVERS_KEY, covers);
}

export function loadReadingStats(): ReadingStats {
  return loadValue(READING_STATS_KEY, createEmptyReadingStats(), (val): val is ReadingStats => {
    return isRecord(val);
  });
}

export function saveReadingStats(stats: ReadingStats): boolean {
  return saveValue(READING_STATS_KEY, stats);
}

export function logReadingSessionActivity(options: {
  pagesDelta?: number;
  minutesDelta?: number;
  completedDelta?: number;
}): { stats: ReadingStats; isNewStreakDay: boolean } {
  const current = loadReadingStats();
  const { stats, isNewStreakDay } = recordReadingActivity(current, options);
  saveReadingStats(stats);
  return { stats, isNewStreakDay };
}

export function loadAchievementsMap(): Record<string, string> {
  const storage = getStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = JSON.parse(storage.getItem(ACHIEVEMENTS_KEY) ?? '{}');
    return normalizeAchievementMap(raw);
  } catch {
    return {};
  }
}

export function saveAchievementsMap(map: Record<string, string>): boolean {
  return saveValue(ACHIEVEMENTS_KEY, map);
}

export function loadAllReviews(): Record<string, PublicationReview> {
  const storage = getStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = JSON.parse(storage.getItem(REVIEWS_KEY) ?? '{}');
    return normalizeReviewMap(raw);
  } catch {
    return {};
  }
}

export function loadReviewForPublication(publicationId: string): PublicationReview | null {
  const map = loadAllReviews();
  return map[publicationId] || null;
}

export function saveReview(review: PublicationReview): boolean {
  const normalized = normalizeReview(review);
  if (!normalized) {
    return false;
  }
  const map = loadAllReviews();
  map[normalized.publicationId] = normalized;
  return saveValue(REVIEWS_KEY, map);
}

export function clearReview(publicationId: string): boolean {
  const map = loadAllReviews();
  delete map[publicationId];
  return saveValue(REVIEWS_KEY, map);
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

    clearCustomCover(publicationId);
    clearReview(publicationId);
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

export function saveRawStorageValue(key: string, value: unknown): boolean {
  try {
    const storage = getStorage();
    if (!storage) {
      return false;
    }
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function saveValue(key: string, value: unknown): boolean {
  return saveRawStorageValue(key, value);
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

function loadCustomCoverMap(): Record<string, CustomCover> {
  const storage = getStorage();
  if (!storage) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CUSTOM_COVERS_KEY) ?? 'null');
    if (!isRecord(parsed)) {
      return {};
    }
    const covers: Record<string, CustomCover> = {};
    for (const [publicationId, value] of Object.entries(parsed)) {
      const cover = normalizeCustomCover(value);
      if (cover) {
        covers[publicationId] = cover;
      }
    }
    return covers;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
