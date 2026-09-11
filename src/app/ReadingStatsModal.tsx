import { useMemo, useState } from 'react';
import type { Achievement } from '../domain/achievements';
import { getPastYearActivityDays, type ReadingStats } from '../domain/readingStats';
import { t } from '../i18n/catalog';
import { CloseIcon, FlameIcon, TrophyIcon } from './Icons';

export interface ReadingStatsModalProps {
  stats: ReadingStats;
  achievements: Achievement[];
  onClose: () => void;
}

export function ReadingStatsModal({ stats, achievements, onClose }: ReadingStatsModalProps) {
  const [activeTab, setActiveTab] = useState<'calendar' | 'achievements'>('calendar');
  const activityDays = useMemo(() => getPastYearActivityDays(stats.days, 182), [stats.days]); // last ~6 months / 26 weeks for dense visual

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="collector-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="collector-modal-panel stats-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Hábitos de Leitura e Conquistas"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="collector-modal-header">
          <div className="collector-modal-title-area">
            <span className="collector-modal-eyebrow">Progresso & Hábitos</span>
            <h2>Estatísticas & Conquistas</h2>
          </div>
          <button
            type="button"
            className="collector-modal-close"
            onClick={onClose}
            aria-label="Fechar estatísticas"
          >
            <CloseIcon />
          </button>
        </header>

        {/* Tab Bar */}
        <div className="stats-tab-bar" role="tablist" aria-label="Abas de estatísticas">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'calendar'}
            className={`stats-tab-btn ${activeTab === 'calendar' ? 'stats-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('calendar')}
          >
            <FlameIcon />
            <span>Calendário & Sequências</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'achievements'}
            className={`stats-tab-btn ${activeTab === 'achievements' ? 'stats-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('achievements')}
          >
            <TrophyIcon />
            <span>Conquistas ({unlockedCount}/{achievements.length})</span>
          </button>
        </div>

        <div className="collector-modal-body">
          {/* Quick Metrics Header */}
          <div className="stats-kpi-grid">
            <div className="stats-kpi-card stats-kpi-card--streak">
              <span className="stats-kpi-icon"><FlameIcon /></span>
              <div className="stats-kpi-info">
                <span className="stats-kpi-value">{stats.currentStreak} {stats.currentStreak === 1 ? 'dia' : 'dias'}</span>
                <span className="stats-kpi-label">Sequência Atual</span>
              </div>
            </div>
            <div className="stats-kpi-card">
              <span className="stats-kpi-icon">⚡</span>
              <div className="stats-kpi-info">
                <span className="stats-kpi-value">{stats.maxStreak} {stats.maxStreak === 1 ? 'dia' : 'dias'}</span>
                <span className="stats-kpi-label">Maior Sequência</span>
              </div>
            </div>
            <div className="stats-kpi-card">
              <span className="stats-kpi-icon">📖</span>
              <div className="stats-kpi-info">
                <span className="stats-kpi-value">{stats.totalPagesRead.toLocaleString('pt-BR')}</span>
                <span className="stats-kpi-label">Páginas Lidas</span>
              </div>
            </div>
            <div className="stats-kpi-card">
              <span className="stats-kpi-icon">🏆</span>
              <div className="stats-kpi-info">
                <span className="stats-kpi-value">{unlockedCount} / {achievements.length}</span>
                <span className="stats-kpi-label">Conquistas</span>
              </div>
            </div>
          </div>

          {activeTab === 'calendar' ? (
            <section className="stats-heatmap-section" aria-label="Mapa de calor de leitura">
              <div className="stats-heatmap-header">
                <h3>Atividade Recente</h3>
                <div className="stats-heatmap-legend">
                  <span className="legend-label">Menos</span>
                  <span className="legend-cell level-0" />
                  <span className="legend-cell level-1" />
                  <span className="legend-cell level-2" />
                  <span className="legend-cell level-3" />
                  <span className="legend-label">Mais</span>
                </div>
              </div>

              <div className="stats-heatmap-grid" role="grid" aria-label="Histórico diário de páginas lidas">
                {activityDays.map((day) => {
                  let level = 0;
                  if (day.pagesRead > 0 && day.pagesRead < 10) level = 1;
                  else if (day.pagesRead >= 10 && day.pagesRead < 30) level = 2;
                  else if (day.pagesRead >= 30) level = 3;

                  return (
                    <div
                      key={day.date}
                      className={`heatmap-cell level-${level}`}
                      title={`${day.date}: ${day.pagesRead} páginas lidas`}
                      aria-label={`${day.date}: ${day.pagesRead} páginas lidas`}
                    />
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="stats-achievements-section" aria-label="Lista de conquistas">
              <div className="achievements-grid">
                {achievements.map((ach) => (
                  <article
                    key={ach.id}
                    className={`achievement-card ${ach.unlocked ? 'achievement-card--unlocked' : 'achievement-card--locked'}`}
                  >
                    <div className="achievement-icon-wrap">
                      <span className="achievement-icon">{ach.icon}</span>
                    </div>
                    <div className="achievement-details">
                      <div className="achievement-title-row">
                        <h4>{t(ach.titleKey as never) || ach.id}</h4>
                        {ach.unlocked && <span className="achievement-unlocked-badge">✓ Desbloqueada</span>}
                      </div>
                      <p className="achievement-desc">{t(ach.descriptionKey as never)}</p>
                      {!ach.unlocked && (
                        <div className="achievement-progress-wrap">
                          <div className="achievement-progress-bar">
                            <div
                              className="achievement-progress-fill"
                              style={{ width: `${Math.round((ach.progress / ach.target) * 100)}%` }}
                            />
                          </div>
                          <span className="achievement-progress-text">
                            {ach.progress} / {ach.target}
                          </span>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
