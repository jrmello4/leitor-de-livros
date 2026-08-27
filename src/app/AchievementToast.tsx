import { useEffect } from 'react';
import type { Achievement } from '../domain/achievements';
import { t } from '../i18n/catalog';
import { TrophyIcon } from './Icons';

export interface AchievementToastProps {
  achievement: Achievement | null;
  onDismiss: () => void;
}

export function AchievementToast({ achievement, onDismiss }: AchievementToastProps) {
  useEffect(() => {
    if (!achievement) return undefined;

    const timer = setTimeout(() => {
      onDismiss();
    }, 4500);

    return () => clearTimeout(timer);
  }, [achievement, onDismiss]);

  if (!achievement) return null;

  return (
    <div
      className="achievement-toast-container"
      role="alert"
      aria-live="polite"
      onClick={onDismiss}
    >
      <div className="achievement-toast">
        <div className="achievement-toast-badge">
          <TrophyIcon />
        </div>
        <div className="achievement-toast-content">
          <span className="achievement-toast-eyebrow">Conquista Desbloqueada!</span>
          <div className="achievement-toast-title">
            <span className="achievement-toast-icon">{achievement.icon}</span>
            <strong>{t(achievement.titleKey as never) || achievement.id}</strong>
          </div>
          <p className="achievement-toast-desc">{t(achievement.descriptionKey as never)}</p>
        </div>
      </div>
    </div>
  );
}
