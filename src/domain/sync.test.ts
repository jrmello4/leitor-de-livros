import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSyncBundleFromState,
  mergeSyncBundle,
  validateSyncBundle,
  type SyncBundle,
} from './sync';

describe('sync domain', () => {
  it('validates a valid sync bundle', () => {
    const bundle: SyncBundle = {
      version: 1,
      exportedAt: '2026-08-27T10:00:00.000Z',
      stats: {
        days: { '2026-08-27': { date: '2026-08-27', pagesRead: 10, minutesRead: 5, completedCount: 0 } },
        currentStreak: 1,
        maxStreak: 1,
        totalPagesRead: 10,
        totalMinutesRead: 5,
      },
      achievements: { first_page: '2026-08-27' },
      reviews: {
        'pub-1': {
          publicationId: 'pub-1',
          rating: 5,
          reviewText: 'Great comic',
          updatedAt: '2026-08-27',
        },
      },
      favorites: ['pub-1'],
      bookmarks: {
        'pub-1': [{ pageId: 'page-1', label: 'Favorite moment', createdAt: '1', updatedAt: '1' }],
      },
      progress: { 'pub-1': 14 },
    };

    const valid = validateSyncBundle(bundle);
    expect(valid).toBe(true);
  });

  it('rejects invalid or corrupted sync bundles', () => {
    expect(validateSyncBundle(null)).toBe(false);
    expect(validateSyncBundle('not json')).toBe(false);
    expect(validateSyncBundle({ version: 999 })).toBe(false);
  });

  it('merges two sync bundles preserving latest progress and combining days', () => {
    const local = createSyncBundleFromState({
      stats: {
        days: { '2026-08-26': { date: '2026-08-26', pagesRead: 10, minutesRead: 5, completedCount: 0 } },
        currentStreak: 1,
        maxStreak: 1,
        totalPagesRead: 10,
        totalMinutesRead: 5,
      },
      achievements: { first_page: '2026-08-26' },
      reviews: {},
      favorites: ['pub-1'],
      bookmarks: {},
      progress: { 'pub-1': 5 },
    });

    const incoming: SyncBundle = {
      version: 1,
      exportedAt: '2026-08-27T10:00:00.000Z',
      stats: {
        days: { '2026-08-27': { date: '2026-08-27', pagesRead: 20, minutesRead: 15, completedCount: 1 } },
        currentStreak: 1,
        maxStreak: 1,
        totalPagesRead: 20,
        totalMinutesRead: 15,
      },
      achievements: { streak_3: '2026-08-27' },
      reviews: {
        'pub-1': { publicationId: 'pub-1', rating: 4, reviewText: 'Nice', updatedAt: '2026-08-27' },
      },
      favorites: ['pub-2'],
      bookmarks: {},
      progress: { 'pub-1': 12, 'pub-2': 3 },
    };

    const merged = mergeSyncBundle(local, incoming);
    expect(merged.stats.totalPagesRead).toBe(30);
    expect(merged.stats.days['2026-08-26'].pagesRead).toBe(10);
    expect(merged.stats.days['2026-08-27'].pagesRead).toBe(20);
    expect(merged.achievements.first_page).toBeDefined();
    expect(merged.achievements.streak_3).toBeDefined();
    expect(merged.favorites).toEqual(['pub-1', 'pub-2']);
    expect(merged.progress['pub-1']).toBe(12);
    expect(merged.progress['pub-2']).toBe(3);
    expect(merged.reviews['pub-1'].rating).toBe(4);
  });
});
