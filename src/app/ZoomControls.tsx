import type { ChangeEvent } from 'react';
import type { PageRotation, StageBackground, ZoomMode } from '../domain/types';
import { clampZoomScale } from '../domain/reader';
import { t } from '../i18n/catalog';
import { CloseIcon, RotateIcon, ZoomInIcon, ZoomOutIcon } from './Icons';

export interface ZoomControlsProps {
  mode: ZoomMode;
  scale: number;
  rotation?: PageRotation;
  background?: StageBackground;
  onModeChange: (mode: ZoomMode) => void;
  onScaleChange: (scale: number) => void;
  onResetPan: () => void;
  onRotate?: () => void;
  onBackgroundChange?: (background: StageBackground) => void;
  onClose?: () => void;
}

export function ZoomControls({
  mode,
  scale,
  rotation = 0,
  background = 'atelier',
  onModeChange,
  onScaleChange,
  onResetPan,
  onRotate,
  onBackgroundChange,
  onClose,
}: ZoomControlsProps) {
  const safeScale = clampZoomScale(scale);
  const changeScale = (delta: number) => onScaleChange(clampZoomScale(Number((safeScale + delta).toFixed(2))));
  const onSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    onScaleChange(clampZoomScale(Number(event.currentTarget.value)));
  };

  return (
    <div className="zoom-controls" aria-label={t('zoom.label')} data-reader-control>
      {onClose && (
        <button type="button" className="zoom-controls__close-btn" aria-label={t('reader.closeSettings')} onClick={onClose} data-reader-control>
          <CloseIcon />
        </button>
      )}
      <div className="zoom-controls__modes" role="group" aria-label={t('zoom.mode')}>
        <button type="button" className={mode === 'page' ? 'zoom-controls__mode--active' : ''} aria-pressed={mode === 'page'} aria-label={t('zoom.page')} onClick={() => onModeChange('page')} data-reader-control>
          {t('zoom.page')}
        </button>
        <button type="button" className={mode === 'width' ? 'zoom-controls__mode--active' : ''} aria-pressed={mode === 'width'} aria-label={t('zoom.width')} onClick={() => onModeChange('width')} data-reader-control>
          {t('zoom.width')}
        </button>
        <button type="button" className={mode === 'manual' ? 'zoom-controls__mode--active' : ''} aria-pressed={mode === 'manual'} aria-label={t('zoom.manual')} onClick={() => onModeChange('manual')} data-reader-control>
          {t('zoom.manual')}
        </button>
      </div>
      <div className="zoom-controls__manual" role="group" aria-label={t('zoom.manualLevel')} data-reader-control>
        <button type="button" aria-label={t('zoom.out')} onClick={() => changeScale(-0.1)} data-reader-control>
          <ZoomOutIcon />
        </button>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.1"
          value={safeScale}
          aria-label={t('zoom.level')}
          aria-valuemin={0.5}
          aria-valuemax={5}
          onChange={onSliderChange}
          onInput={(e) => onScaleChange(clampZoomScale(Number(e.currentTarget.value)))}
          data-reader-control
        />
        <button type="button" aria-label={t('zoom.in')} onClick={() => changeScale(0.1)} data-reader-control>
          <ZoomInIcon />
        </button>
        <output aria-live="polite">{Math.round(safeScale * 100)}%</output>
      </div>
      {onRotate && (
        <button type="button" className="zoom-controls__rotate" aria-label={t('reader.rotate')} onClick={onRotate} data-reader-control>
          <RotateIcon />
          <span>{rotation !== 0 ? `${rotation}°` : t('reader.rotate')}</span>
        </button>
      )}
      {onBackgroundChange && (
        <select
          className="zoom-controls__select"
          aria-label={t('reader.background')}
          value={background}
          onChange={(e) => onBackgroundChange(e.target.value as StageBackground)}
          data-reader-control
        >
          <option value="atelier">{t('reader.bgAtelier')}</option>
          <option value="oled">{t('reader.bgOled')}</option>
          <option value="dark">{t('reader.bgDark')}</option>
          <option value="paper">{t('reader.bgPaper')}</option>
        </select>
      )}
      <button type="button" className="zoom-controls__reset" aria-label={t('zoom.resetPan')} onClick={onResetPan} data-reader-control>
        {t('zoom.resetPan')}
      </button>
    </div>
  );
}
