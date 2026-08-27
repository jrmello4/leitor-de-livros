import { describe, expect, it } from 'vitest';
import {
  calculateStreaks,
  createEmptyReadingStats,
  normalizeReadingStats,
  recordReadingActivity,
  getPastYearActivityDays,
} from './readingStats';

describe('readingStats domain', () => {
  it('creates default empty reading stats', () => {
    const stats = createEmptyReadingStats();
    expect(stats.currentStreak).toBe(0);
    expect(stats.maxStreak).toBe(0);
    expect(stats.totalPagesRead).toBe(0);
    expect(Object.keys(stats.days)).toHaveLength(0);
  });

  it('records pages read and updates total counts', () => {
    const initial = createEmptyReadingStats();
    const { stats, isNewStreakDay } = recordReadingActivity(initial, {
      date: '2026-08-25',
      pagesDelta: 15,
      minutesDelta: 20,
      completedDelta: 1,
    });

    expect(isNewStreakDay).toBe(true);
    expect(stats.totalPagesRead).toBe(15);
    expect(stats.totalMinutesRead).toBe(20);
    expect(stats.days['2026-08-25']).toEqual({
      date: '2026-08-25',
      pagesRead: 15,
      minutesRead: 20,
      completedCount: 1,
    });
  });

  it('calculates current streak and max streak correctly over consecutive days', () => {
    let stats = createEmptyReadingStats();

    // Day 1
    stats = recordReadingActivity(stats, { date: '2026-08-25', pagesDelta: 5 }).stats;
    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(1);

    // Day 2 (consecutive)
    stats = recordReadingActivity(stats, { date: '2026-08-26', pagesDelta: 10 }).stats;
    expect(stats.currentStreak).toBe(2);
    expect(stats.maxStreak).toBe(2);

    // Day 3 (consecutive)
    stats = recordReadingActivity(stats, { date: '2026-08-27', pagesDelta: 8 }).stats;
    expect(stats.currentStreak).toBe(3);
    expect(stats.maxStreak).toBe(3);

    // Same day activity should not increase streak further
    stats = recordReadingActivity(stats, { date: '2026-08-27', pagesDelta: 12 }).stats;
    expect(stats.currentStreak).toBe(3);
    expect(stats.totalPagesRead).toBe(35);
  });

  it('handles streak breaks when days are missed', () => {
    const days = {
      '2026-08-20': { date: '2026-08-20', pagesRead: 10, minutesRead: 5, completedCount: 0 },
      '2026-08-21': { date: '2026-08-21', pagesRead: 10, minutesRead: 5, completedCount: 0 },
      '2026-08-22': { date: '2026-08-22', pagesRead: 10, minutesRead: 5, completedCount: 0 },
      // Missed 23, 24
      '2026-08-25': { date: '2026-08-25', pagesRead: 5, minutesRead: 2, completedCount: 0 },
      '2026-08-26': { date: '2026-08-26', pagesRead: 5, minutesRead: 2, completedCount: 0 },
    };

    const { currentStreak, maxStreak } = calculateStreaks(days, '2026-08-26');
    expect(currentStreak).toBe(2);
    expect(maxStreak).toBe(3);
  });

  it('normalizes malformed stored stats objects cleanly', () => {
    expect(normalizeReadingStats(null)).toEqual(createEmptyReadingStats());
    expect(normalizeReadingStats('string')).toEqual(createEmptyReadingStats());

    const malformed = {
      days: {
        '2026-08-25': { date: '2026-08-25', pagesRead: 'invalid', minutesRead: 10, completedCount: null },
      },
      currentStreak: -5,
      maxStreak: 'abc',
    };

    const normalized = normalizeReadingStats(malformed);
    expect(normalized.days['2026-08-25'].pagesRead).toBe(0);
    expect(normalized.days['2026-08-25'].minutesRead).toBe(10);
    expect(normalized.days['2026-08-25'].completedCount).toBe(0);
  });

  it('generates activity days array for heatmap view', () => {
    const days = {
      '2026-08-27': { date: '2026-08-27', pagesRead: 20, minutesRead: 15, completedCount: 1 },
    };

    const history = getPastYearActivityDays(days, 7, '2026-08-27');
    expect(history).toHaveLength(7);
    expect(history[6].date).toBe('2026-08-27');
    expect(history[6].pagesRead).toBe(20);
    expect(history[0].pagesRead).toBe(0);
  });
});
