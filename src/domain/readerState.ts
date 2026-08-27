import type { PageRotation, ReaderState, StageBackground } from './types';
import { clampZoomScale } from './reader';

export const defaultReaderState: ReaderState = {
  zoomMode: 'page',
  zoomScale: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
  background: 'atelier',
};

export function nextRotation(current: PageRotation): PageRotation {
  switch (current) {
    case 0:
      return 90;
    case 90:
      return 180;
    case 180:
      return 270;
    case 270:
    default:
      return 0;
  }
}

export function normalizeReaderState(value: unknown): ReaderState {
  if (!isRecord(value)) {
    return { ...defaultReaderState };
  }

  const rotation = value.rotation === 90 || value.rotation === 180 || value.rotation === 270 || value.rotation === 0
    ? (value.rotation as PageRotation)
    : defaultReaderState.rotation;

  const background = value.background === 'oled' || value.background === 'dark' || value.background === 'paper' || value.background === 'atelier'
    ? (value.background as StageBackground)
    : defaultReaderState.background;

  return {
    zoomMode: value.zoomMode === 'page' || value.zoomMode === 'width' || value.zoomMode === 'manual'
      ? value.zoomMode
      : defaultReaderState.zoomMode,
    zoomScale: typeof value.zoomScale === 'number' && Number.isFinite(value.zoomScale)
      ? clampZoomScale(value.zoomScale)
      : defaultReaderState.zoomScale,
    panX: typeof value.panX === 'number' && Number.isFinite(value.panX) ? value.panX : defaultReaderState.panX,
    panY: typeof value.panY === 'number' && Number.isFinite(value.panY) ? value.panY : defaultReaderState.panY,
    rotation,
    background,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

