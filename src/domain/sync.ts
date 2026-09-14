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
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    return false;
  }
  if (!isRecord(value.stats)) {
    return false;
  }
  if (value.favorites !== undefined && !Array.isArray(value.favorites)) {
    return false;
  }
  if (value.bookmarks !== undefined && !isRecord(value.bookmarks)) {
    return false;
  }
  if (value.progress !== undefined && !isRecord(value.progress)) {
    return false;
  }
  if (value.reviews !== undefined && !isRecord(value.reviews)) {
    return false;
  }
  if (value.achievements !== undefined && !isRecord(value.achievements)) {
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

  // Merge Favorites (defensive: ignore malformed arrays)
  const localFavorites = Array.isArray(local.favorites) ? local.favorites : [];
  const incomingFavorites = Array.isArray(incoming.favorites) ? incoming.favorites : [];
  const mergedFavorites = Array.from(new Set([...localFavorites, ...incomingFavorites]));

  // Merge Bookmarks (defensive: ignore malformed maps)
  const localBookmarks = isRecord(local.bookmarks) ? (local.bookmarks as Record<string, Bookmark[]>) : {};
  const incomingBookmarks = isRecord(incoming.bookmarks) ? (incoming.bookmarks as Record<string, Bookmark[]>) : {};
  const mergedBookmarks: Record<string, Bookmark[]> = { ...localBookmarks };
  for (const [pubId, inMarks] of Object.entries(incomingBookmarks)) {
    if (!Array.isArray(inMarks)) continue;
    const existing = mergedBookmarks[pubId] || [];
    const markMap = new Map((Array.isArray(existing) ? existing : []).map((b) => [b.pageId, b]));
    for (const b of inMarks) {
      if (b && typeof b.pageId === 'string') markMap.set(b.pageId, b);
    }
    mergedBookmarks[pubId] = Array.from(markMap.values());
  }

  // Merge Progress (take max page index, defensive)
  const localProgress = isRecord(local.progress) ? (local.progress as Record<string, number>) : {};
  const incomingProgress = isRecord(incoming.progress) ? (incoming.progress as Record<string, number>) : {};
  const mergedProgress: Record<string, number> = { ...localProgress };
  for (const [pubId, inProg] of Object.entries(incomingProgress)) {
    if (typeof inProg !== 'number' || !Number.isFinite(inProg)) continue;
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
