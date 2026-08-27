import { describe, expect, it } from 'vitest';
import { createEmptyReadingStats, recordReadingActivity } from './readingStats';
import { evaluateAchievements, normalizeAchievementMap } from './achievements';

describe('achievements domain', () => {
  it('detects first page achievement on first reading activity', () => {
    let stats = createEmptyReadingStats();
    stats = recordReadingActivity(stats, { pagesDelta: 1 }).stats;

    const result = evaluateAchievements({
      stats,
      publicationCount: 1,
      completedCount: 0,
      existingUnlockedMap: {},
      isNightHour: false,
    });

    const firstPage = result.list.find((a) => a.id === 'first_page');
    expect(firstPage?.unlocked).toBe(true);
    expect(result.newlyUnlocked).toHaveLength(1);
    expect(result.newlyUnlocked[0].id).toBe('first_page');
  });

  it('evaluates streak and page count milestones', () => {
    const stats = {
      days: {},
      currentStreak: 7,
      maxStreak: 7,
      totalPagesRead: 300,
      totalMinutesRead: 120,
    };

    const result = evaluateAchievements({
      stats,
      publicationCount: 6,
      completedCount: 1,
      existingUnlockedMap: { first_page: '2026-08-01' },
      isNightHour: false,
    });

    const streak3 = result.list.find((a) => a.id === 'streak_3');
    const streak7 = result.list.find((a) => a.id === 'streak_7');
    const streak30 = result.list.find((a) => a.id === 'streak_30');
    const pages250 = result.list.find((a) => a.id === 'pages_250');
    const collector5 = result.list.find((a) => a.id === 'collector_5');
    const completion = result.list.find((a) => a.id === 'completion_1');

    expect(streak3?.unlocked).toBe(true);
    expect(streak7?.unlocked).toBe(true);
    expect(streak30?.unlocked).toBe(false);
    expect(streak30?.progress).toBe(7);
    expect(streak30?.target).toBe(30);

    expect(pages250?.unlocked).toBe(true);
    expect(collector5?.unlocked).toBe(true);
    expect(completion?.unlocked).toBe(true);

    // first_page was already unlocked so it should not be in newlyUnlocked
    expect(result.newlyUnlocked.some((a) => a.id === 'first_page')).toBe(false);
    expect(result.newlyUnlocked.some((a) => a.id === 'streak_7')).toBe(true);
  });

  it('unlocks night owl badge when reading at night hours', () => {
    const stats = createEmptyReadingStats();
    const result = evaluateAchievements({
      stats,
      publicationCount: 1,
      completedCount: 0,
      existingUnlockedMap: {},
      isNightHour: true,
    });

    const nightOwl = result.list.find((a) => a.id === 'night_owl');
    expect(nightOwl?.unlocked).toBe(true);
  });

  it('normalizes stored achievements map', () => {
    expect(normalizeAchievementMap(null)).toEqual({});
    expect(normalizeAchievementMap({ first_page: '2026-08-01', bad: 123 })).toEqual({
      first_page: '2026-08-01',
    });
  });
});
