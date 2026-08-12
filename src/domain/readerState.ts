import type { ReaderState } from './types';
import { clampZoomScale } from './reader';

export const defaultReaderState: ReaderState = {
  zoomMode: 'page',
  zoomScale: 1,
  panX: 0,
  panY: 0,
};

export function normalizeReaderState(value: unknown): ReaderState {
  if (!isRecord(value)) {
    return { ...defaultReaderState };
  }

  return {
    zoomMode: value.zoomMode === 'page' || value.zoomMode === 'width' || value.zoomMode === 'manual'
      ? value.zoomMode
      : defaultReaderState.zoomMode,
    zoomScale: typeof value.zoomScale === 'number' && Number.isFinite(value.zoomScale)
      ? clampZoomScale(value.zoomScale)
      : defaultReaderState.zoomScale,
    panX: typeof value.panX === 'number' && Number.isFinite(value.panX) ? value.panX : defaultReaderState.panX,
    panY: typeof value.panY === 'number' && Number.isFinite(value.panY) ? value.panY : defaultReaderState.panY,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
