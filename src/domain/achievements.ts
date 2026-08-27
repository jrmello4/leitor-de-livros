import type { ReadingStats } from './readingStats';

export interface Achievement {
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  category: 'streak' | 'pages' | 'collection' | 'time' | 'completion';
  unlocked: boolean;
  unlockedAt?: string;
  progress: number;
  target: number;
}

export interface AchievementEvaluationInput {
  stats: ReadingStats;
  publicationCount: number;
  completedCount: number;
  existingUnlockedMap: Record<string, string>;
  isNightHour?: boolean;
}

interface AchievementDefinition {
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  category: Achievement['category'];
  target: number;
  getProgress: (input: AchievementEvaluationInput) => number;
}

const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: 'first_page',
    titleKey: 'achievement.firstPageTitle',
    descriptionKey: 'achievement.firstPageDesc',
    icon: '✨',
    category: 'pages',
    target: 1,
    getProgress: (input) => input.stats.totalPagesRead,
  },
  {
    id: 'streak_3',
    titleKey: 'achievement.streak3Title',
    descriptionKey: 'achievement.streak3Desc',
    icon: '🔥',
    category: 'streak',
    target: 3,
    getProgress: (input) => input.stats.maxStreak,
  },
  {
    id: 'streak_7',
    titleKey: 'achievement.streak7Title',
    descriptionKey: 'achievement.streak7Desc',
    icon: '⚡',
    category: 'streak',
    target: 7,
    getProgress: (input) => input.stats.maxStreak,
  },
  {
    id: 'streak_30',
    titleKey: 'achievement.streak30Title',
    descriptionKey: 'achievement.streak30Desc',
    icon: '👑',
    category: 'streak',
    target: 30,
    getProgress: (input) => input.stats.maxStreak,
  },
  {
    id: 'pages_50',
    titleKey: 'achievement.pages50Title',
    descriptionKey: 'achievement.pages50Desc',
    icon: '📖',
    category: 'pages',
    target: 50,
    getProgress: (input) => input.stats.totalPagesRead,
  },
  {
    id: 'pages_250',
    titleKey: 'achievement.pages250Title',
    descriptionKey: 'achievement.pages250Desc',
    icon: '📚',
    category: 'pages',
    target: 250,
    getProgress: (input) => input.stats.totalPagesRead,
  },
  {
    id: 'pages_1000',
    titleKey: 'achievement.pages1000Title',
    descriptionKey: 'achievement.pages1000Desc',
    icon: '🏛️',
    category: 'pages',
    target: 1000,
    getProgress: (input) => input.stats.totalPagesRead,
  },
  {
    id: 'collector_5',
    titleKey: 'achievement.collector5Title',
    descriptionKey: 'achievement.collector5Desc',
    icon: '🗂️',
    category: 'collection',
    target: 5,
    getProgress: (input) => input.publicationCount,
  },
  {
    id: 'completion_1',
    titleKey: 'achievement.completion1Title',
    descriptionKey: 'achievement.completion1Desc',
    icon: '🏁',
    category: 'completion',
    target: 1,
    getProgress: (input) => input.completedCount,
  },
  {
    id: 'night_owl',
    titleKey: 'achievement.nightOwlTitle',
    descriptionKey: 'achievement.nightOwlDesc',
    icon: '🦉',
    category: 'time',
    target: 1,
    getProgress: (input) => (input.isNightHour || input.existingUnlockedMap.night_owl ? 1 : 0),
  },
];

export function evaluateAchievements(input: AchievementEvaluationInput): {
  list: Achievement[];
  newlyUnlocked: Achievement[];
  updatedUnlockedMap: Record<string, string>;
} {
  const updatedUnlockedMap = { ...input.existingUnlockedMap };
  const newlyUnlocked: Achievement[] = [];
  const nowStr = new Date().toISOString();

  const list: Achievement[] = ACHIEVEMENT_DEFINITIONS.map((def) => {
    const rawProgress = def.getProgress(input);
    const progress = Math.min(def.target, Math.max(0, Math.round(rawProgress)));
    const wasAlreadyUnlocked = Boolean(updatedUnlockedMap[def.id]);
    const isNowUnlocked = wasAlreadyUnlocked || progress >= def.target;

    if (isNowUnlocked && !wasAlreadyUnlocked) {
      updatedUnlockedMap[def.id] = nowStr;
    }

    const achievement: Achievement = {
      id: def.id,
      titleKey: def.titleKey,
      descriptionKey: def.descriptionKey,
      icon: def.icon,
      category: def.category,
      unlocked: isNowUnlocked,
      unlockedAt: updatedUnlockedMap[def.id],
      progress,
      target: def.target,
    };

    if (isNowUnlocked && !wasAlreadyUnlocked) {
      newlyUnlocked.push(achievement);
    }

    return achievement;
  });

  return {
    list,
    newlyUnlocked,
    updatedUnlockedMap,
  };
}

export function isCurrentHourNight(): boolean {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 5;
}

export function normalizeAchievementMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, date] of Object.entries(value)) {
    if (typeof date === 'string') {
      result[key] = date;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
