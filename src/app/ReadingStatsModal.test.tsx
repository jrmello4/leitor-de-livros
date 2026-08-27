import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingStatsModal } from './ReadingStatsModal';
import type { ReadingStats } from '../domain/readingStats';
import type { Achievement } from '../domain/achievements';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_STATS: ReadingStats = {
  days: {
    '2026-08-27': { date: '2026-08-27', pagesRead: 45, minutesRead: 30, completedCount: 1 },
  },
  currentStreak: 5,
  maxStreak: 12,
  totalPagesRead: 1250,
  totalMinutesRead: 400,
};

const SAMPLE_ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_page',
    titleKey: 'achievement.firstPageTitle',
    descriptionKey: 'achievement.firstPageDesc',
    icon: '✨',
    category: 'pages',
    unlocked: true,
    unlockedAt: '2026-08-01',
    progress: 1,
    target: 1,
  },
  {
    id: 'streak_30',
    titleKey: 'achievement.streak30Title',
    descriptionKey: 'achievement.streak30Desc',
    icon: '👑',
    category: 'streak',
    unlocked: false,
    progress: 5,
    target: 30,
  },
];

describe('ReadingStatsModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it('renders streak KPIs, heatmap and switches to achievements tab', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <ReadingStatsModal
          stats={SAMPLE_STATS}
          achievements={SAMPLE_ACHIEVEMENTS}
          onClose={onClose}
        />,
      );
    });

    expect(host.textContent).toContain('5 dias');
    expect(host.textContent).toContain('12 dias');
    expect(host.textContent).toContain('1.250');

    // Switch to Achievements tab
    const tabs = host.querySelectorAll('.stats-tab-btn');
    expect(tabs).toHaveLength(2);
    act(() => {
      tabs[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).toContain('First Step');
    expect(host.textContent).toContain('Legendary Reader');
  });
});
