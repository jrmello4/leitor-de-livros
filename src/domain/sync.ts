import type { Bookmark } from './types';
import { calculateStreaks, normalizeReadingStats, type ReadingDay, type ReadingStats } from './readingStats';
import { normalizeAchievementMap } from './achievements';
import { normalizeReviewMap, type PublicationReview } from './reviews';

export interface SyncBundle {
  version: 1;
  exportedAt: string;
  stats: ReadingStats;
  achievements: Record<string, string>;
  reviews: Record<string, PublicationReview>;
  favorites: string[];
  bookmarks: Record<string, Bookmark[]>;
  progress: Record<string, number>;
}

export function createSyncBundleFromState(state: {
  stats: ReadingStats;
  achievements: Record<string, string>;
  reviews: Record<string, PublicationReview>;
  favorites: string[];
  bookmarks: Record<string, Bookmark[]>;
  progress: Record<string, number>;
}): SyncBundle {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    stats: normalizeReadingStats(state.stats),
    achievements: normalizeAchievementMap(state.achievements),
    reviews: normalizeReviewMap(state.reviews),
    favorites: Array.from(new Set(state.favorites || [])),
    bookmarks: state.bookmarks || {},
    progress: state.progress || {},
  };
}

export function validateSyncBundle(value: unknown): value is SyncBundle {
  if (!isRecord(value)) {
    return false;
  }
  if (value.version !== 1) {
    return false;
  }
  if (typeof value.exportedAt !== 'string') {
    return false;
  }
  if (!isRecord(value.stats)) {
    return false;
  }
  return true;
}

export function mergeSyncBundle(local: SyncBundle, incoming: SyncBundle): SyncBundle {
  // Merge Reading Days and calculate streaks
  const mergedDays: Record<string, ReadingDay> = { ...local.stats.days };

  for (const [date, inDay] of Object.entries(incoming.stats.days || {})) {
    if (!mergedDays[date]) {
      mergedDays[date] = { ...inDay };
    } else {
      mergedDays[date] = {
        date,
        pagesRead: Math.max(mergedDays[date].pagesRead, inDay.pagesRead),
        minutesRead: Math.max(mergedDays[date].minutesRead, inDay.minutesRead),
        completedCount: Math.max(mergedDays[date].completedCount, inDay.completedCount),
      };
    }
  }

  const { currentStreak, maxStreak } = calculateStreaks(mergedDays);
  const totalPagesRead = Object.values(mergedDays).reduce((acc, d) => acc + d.pagesRead, 0);
  const totalMinutesRead = Object.values(mergedDays).reduce((acc, d) => acc + d.minutesRead, 0);

  const mergedStats: ReadingStats = {
    days: mergedDays,
    currentStreak,
    maxStreak: Math.max(local.stats.maxStreak || 0, incoming.stats.maxStreak || 0, maxStreak),
    totalPagesRead,
    totalMinutesRead,
    lastReadDate: incoming.stats.lastReadDate || local.stats.lastReadDate,
  };

  // Merge Achievements
  const mergedAchievements: Record<string, string> = {
    ...local.achievements,
    ...incoming.achievements,
  };

  // Merge Reviews (take latest by updatedAt)
  const mergedReviews: Record<string, PublicationReview> = { ...local.reviews };
  for (const [pubId, inReview] of Object.entries(incoming.reviews || {})) {
    const locReview = mergedReviews[pubId];
    if (!locReview || new Date(inReview.updatedAt) > new Date(locReview.updatedAt)) {
      mergedReviews[pubId] = inReview;
    }
  }

  // Merge Favorites
  const mergedFavorites = Array.from(new Set([...local.favorites, ...incoming.favorites]));

  // Merge Bookmarks
  const mergedBookmarks: Record<string, Bookmark[]> = { ...local.bookmarks };
  for (const [pubId, inMarks] of Object.entries(incoming.bookmarks || {})) {
    const existing = mergedBookmarks[pubId] || [];
    const markMap = new Map(existing.map((b) => [b.pageId, b]));
    for (const b of inMarks) {
      markMap.set(b.pageId, b);
    }
    mergedBookmarks[pubId] = Array.from(markMap.values());
  }

  // Merge Progress (take max page index)
  const mergedProgress: Record<string, number> = { ...local.progress };
  for (const [pubId, inProg] of Object.entries(incoming.progress || {})) {
    mergedProgress[pubId] = Math.max(mergedProgress[pubId] || 0, inProg);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    stats: mergedStats,
    achievements: mergedAchievements,
    reviews: mergedReviews,
    favorites: mergedFavorites,
    bookmarks: mergedBookmarks,
    progress: mergedProgress,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
