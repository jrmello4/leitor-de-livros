export interface ReadingDay {
  date: string; // YYYY-MM-DD
  pagesRead: number;
  minutesRead: number;
  completedCount: number;
}

export interface ReadingStats {
  days: Record<string, ReadingDay>;
  currentStreak: number;
  maxStreak: number;
  totalPagesRead: number;
  totalMinutesRead: number;
  lastReadDate?: string;
}

export function createEmptyReadingStats(): ReadingStats {
  return {
    days: {},
    currentStreak: 0,
    maxStreak: 0,
    totalPagesRead: 0,
    totalMinutesRead: 0,
  };
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function recordReadingActivity(
  stats: ReadingStats,
  options: {
    date?: string;
    pagesDelta?: number;
    minutesDelta?: number;
    completedDelta?: number;
  } = {},
): { stats: ReadingStats; isNewStreakDay: boolean } {
  const date = options.date || getTodayDateString();
  const pagesDelta = Math.max(0, options.pagesDelta || 0);
  const minutesDelta = Math.max(0, options.minutesDelta || 0);
  const completedDelta = Math.max(0, options.completedDelta || 0);

  const existingDay = stats.days[date] || {
    date,
    pagesRead: 0,
    minutesRead: 0,
    completedCount: 0,
  };

  const isNewDay = !stats.days[date] || stats.days[date].pagesRead === 0;

  const nextDay: ReadingDay = {
    date,
    pagesRead: existingDay.pagesRead + pagesDelta,
    minutesRead: existingDay.minutesRead + minutesDelta,
    completedCount: existingDay.completedCount + completedDelta,
  };

  const nextDays = {
    ...stats.days,
    [date]: nextDay,
  };

  const { currentStreak, maxStreak } = calculateStreaks(nextDays, date);

  const nextStats: ReadingStats = {
    days: nextDays,
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, maxStreak),
    totalPagesRead: stats.totalPagesRead + pagesDelta,
    totalMinutesRead: stats.totalMinutesRead + minutesDelta,
    lastReadDate: date,
  };

  return {
    stats: nextStats,
    isNewStreakDay: isNewDay && (pagesDelta > 0 || minutesDelta > 0),
  };
}

export function calculateStreaks(
  days: Record<string, ReadingDay>,
  referenceDateStr?: string,
): { currentStreak: number; maxStreak: number } {
  const activeDates = Object.values(days)
    .filter((d) => d.pagesRead > 0 || d.minutesRead > 0)
    .map((d) => d.date)
    .sort();

  if (activeDates.length === 0) {
    return { currentStreak: 0, maxStreak: 0 };
  }

  // Calculate max streak across entire history
  let maxStreak = 0;
  let runningStreak = 0;
  let previousDate: Date | null = null;

  for (const dateStr of activeDates) {
    const currentDate = parseDateUtc(dateStr);
    if (!previousDate) {
      runningStreak = 1;
    } else {
      const diffDays = Math.round((currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        runningStreak += 1;
      } else if (diffDays > 1) {
        runningStreak = 1;
      }
    }
    previousDate = currentDate;
    maxStreak = Math.max(maxStreak, runningStreak);
  }

  // Calculate current streak from reference date (or latest date)
  const todayStr = referenceDateStr || getTodayDateString();
  const todayDate = parseDateUtc(todayStr);

  let currentStreak = 0;
  let checkDate = new Date(todayDate);

  // Check if read today or yesterday to start streak
  const checkStr = formatDateUtc(checkDate);
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayStr = formatDateUtc(yesterdayDate);

  const hasReadToday = Boolean(days[checkStr] && (days[checkStr].pagesRead > 0 || days[checkStr].minutesRead > 0));
  const hasReadYesterday = Boolean(days[yesterdayStr] && (days[yesterdayStr].pagesRead > 0 || days[yesterdayStr].minutesRead > 0));

  if (hasReadToday) {
    checkDate = new Date(todayDate);
  } else if (hasReadYesterday) {
    checkDate = new Date(yesterdayDate);
  } else {
    return { currentStreak: 0, maxStreak };
  }

  while (true) {
    const curStr = formatDateUtc(checkDate);
    const day = days[curStr];
    if (day && (day.pagesRead > 0 || day.minutesRead > 0)) {
      currentStreak += 1;
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
    } else {
      break;
    }
  }

  return {
    currentStreak,
    maxStreak: Math.max(maxStreak, currentStreak),
  };
}

export function getPastYearActivityDays(
  days: Record<string, ReadingDay>,
  daysCount: number = 365,
  referenceDateStr?: string,
): ReadingDay[] {
  const endDate = parseDateUtc(referenceDateStr || getTodayDateString());
  const result: ReadingDay[] = [];

  for (let i = daysCount - 1; i >= 0; i--) {
    const targetDate = new Date(endDate);
    targetDate.setUTCDate(targetDate.getUTCDate() - i);
    const dateStr = formatDateUtc(targetDate);
    result.push(
      days[dateStr] || {
        date: dateStr,
        pagesRead: 0,
        minutesRead: 0,
        completedCount: 0,
      },
    );
  }

  return result;
}

export function normalizeReadingStats(value: unknown): ReadingStats {
  if (!isRecord(value)) {
    return createEmptyReadingStats();
  }

  const days: Record<string, ReadingDay> = {};
  if (isRecord(value.days)) {
    for (const [date, rawDay] of Object.entries(value.days)) {
      if (isRecord(rawDay) && typeof date === 'string') {
        days[date] = {
          date,
          pagesRead: typeof rawDay.pagesRead === 'number' && rawDay.pagesRead >= 0 ? Math.round(rawDay.pagesRead) : 0,
          minutesRead: typeof rawDay.minutesRead === 'number' && rawDay.minutesRead >= 0 ? Math.round(rawDay.minutesRead) : 0,
          completedCount: typeof rawDay.completedCount === 'number' && rawDay.completedCount >= 0 ? Math.round(rawDay.completedCount) : 0,
        };
      }
    }
  }

  const totalPagesRead = typeof value.totalPagesRead === 'number' && value.totalPagesRead >= 0
    ? Math.round(value.totalPagesRead)
    : Object.values(days).reduce((acc, d) => acc + d.pagesRead, 0);

  const totalMinutesRead = typeof value.totalMinutesRead === 'number' && value.totalMinutesRead >= 0
    ? Math.round(value.totalMinutesRead)
    : Object.values(days).reduce((acc, d) => acc + d.minutesRead, 0);

  const { currentStreak, maxStreak } = calculateStreaks(days);

  return {
    days,
    currentStreak,
    maxStreak: typeof value.maxStreak === 'number' && value.maxStreak >= maxStreak ? Math.round(value.maxStreak) : maxStreak,
    totalPagesRead,
    totalMinutesRead,
    lastReadDate: typeof value.lastReadDate === 'string' ? value.lastReadDate : undefined,
  };
}

function parseDateUtc(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
