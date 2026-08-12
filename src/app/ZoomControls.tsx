import type { ChangeEvent } from 'react';
import type { ZoomMode } from '../domain/types';
import { clampZoomScale } from '../domain/reader';

export interface ZoomControlsProps {
  mode: ZoomMode;
  scale: number;
  onModeChange: (mode: ZoomMode) => void;
  onScaleChange: (scale: number) => void;
  onResetPan: () => void;
}

export function ZoomControls({ mode, scale, onModeChange, onScaleChange, onResetPan }: ZoomControlsProps) {
  const safeScale = clampZoomScale(scale);
  const changeScale = (delta: number) => onScaleChange(clampZoomScale(Number((safeScale + delta).toFixed(2))));
  const onSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    onScaleChange(clampZoomScale(Number(event.currentTarget.value)));
  };

  return (
    <div className="zoom-controls" aria-label="Zoom controls" data-reader-control>
      <div className="zoom-controls__modes" role="group" aria-label="Zoom mode">
        <button type="button" className={mode === 'page' ? 'zoom-controls__mode--active' : ''} aria-pressed={mode === 'page'} aria-label="Fit to page" onClick={() => onModeChange('page')} data-reader-control>
          Page
        </button>
        <button type="button" className={mode === 'width' ? 'zoom-controls__mode--active' : ''} aria-pressed={mode === 'width'} aria-label="Fit to width" onClick={() => onModeChange('width')} data-reader-control>
          Width
        </button>
        <button type="button" className={mode === 'manual' ? 'zoom-controls__mode--active' : ''} aria-pressed={mode === 'manual'} aria-label="Manual zoom" onClick={() => onModeChange('manual')} data-reader-control>
          Manual
        </button>
      </div>
      <div className="zoom-controls__manual" role="group" aria-label="Manual zoom level">
        <button type="button" aria-label="Zoom out" onClick={() => changeScale(-0.1)} data-reader-control>−</button>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={safeScale}
          aria-label="Zoom level"
          aria-valuemin={0.5}
          aria-valuemax={3}
          aria-valuenow={safeScale}
          onChange={onSliderChange}
          data-reader-control
        />
        <button type="button" aria-label="Zoom in" onClick={() => changeScale(0.1)} data-reader-control>+</button>
        <output aria-live="polite">{Math.round(safeScale * 100)}%</output>
      </div>
      <button type="button" className="zoom-controls__reset" aria-label="Reset pan" onClick={onResetPan} data-reader-control>
        Reset pan
      </button>
    </div>
  );
}
