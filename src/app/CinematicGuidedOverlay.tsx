import { useEffect } from 'react';
import type { PanelRegion } from '../domain/flow';
import { t } from '../i18n/catalog';
import { CloseIcon, FilmIcon } from './Icons';

interface CinematicGuidedOverlayProps {
  active: boolean;
  currentPanelIndex: number;
  panels: PanelRegion[];
  onNextPanel: () => void;
  onPrevPanel: () => void;
  onExit: () => void;
}

export function CinematicGuidedOverlay({
  active,
  currentPanelIndex,
  panels,
  onNextPanel,
  onPrevPanel,
  onExit,
}: CinematicGuidedOverlayProps) {
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onExit]);

  if (!active || panels.length === 0) {
    return null;
  }

  const activePanel = panels[currentPanelIndex];
  const total = panels.length;
  const current = currentPanelIndex + 1;
  const isFullPage = total <= 1 || (activePanel && activePanel.bounds.width >= 0.95 && activePanel.bounds.height >= 0.95);

  return (
    <div className="guided-overlay" aria-live="polite" data-reader-control>
      {activePanel && !isFullPage && (
        <div
          className="guided-spotlight-frame"
          style={{
            left: `${activePanel.bounds.x * 100}%`,
            top: `${activePanel.bounds.y * 100}%`,
            width: `${activePanel.bounds.width * 100}%`,
            height: `${activePanel.bounds.height * 100}%`,
          }}
          aria-hidden="true"
        />
      )}

      <div className="guided-pill-hud" role="toolbar" aria-label={t('reader.guidedView')}>
        <div className="guided-pill-badge">
          <FilmIcon />
          <span>{isFullPage ? 'Página Inteira' : t('guided.badge', { current, total })}</span>
        </div>

        <div className="guided-pill-actions">
          <button
            type="button"
            className="guided-pill-btn"
            onClick={onPrevPanel}
            aria-label={t('guided.prev')}
            title={`${t('guided.prev')} (←)`}
            data-reader-control
          >
            ←
          </button>
          <button
            type="button"
            className="guided-pill-btn"
            onClick={onNextPanel}
            aria-label={t('guided.next')}
            title={`${t('guided.next')} (→ / Espaço)`}
            data-reader-control
          >
            →
          </button>
          <button
            type="button"
            className="guided-pill-btn guided-pill-btn--exit"
            onClick={onExit}
            aria-label={t('guided.exit')}
            title={t('guided.exit')}
            data-reader-control
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
