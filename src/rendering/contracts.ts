import type { PageDescriptor, ReadingDirection, ReadingMode } from '../domain/types';
export { PAGE_TURN_LUMINANCE_BOUNDS } from './pageTurn/contracts';
export type { PageTurnBackend, PageTurnFailure, PageTurnMetrics, PageTurnRenderFrame, PageTurnSettled } from './pageTurn/contracts';

export type RenderBackendKind = 'webgpu' | 'webgl2' | 'static';
export type RenderQuality = 'rich' | 'balanced' | 'essential';

export interface RenderFrame {
  pages: PageDescriptor[];
  preloadPages: PageDescriptor[];
  turningPageId?: string;
  direction: ReadingDirection;
  mode: ReadingMode;
  turnProgress: number;
  reducedMotion: boolean;
}

export interface RenderSheet {
  page: PageDescriptor;
  x: number;
  y: number;
  width: number;
  height: number;
  shade: number;
}

export interface RendererStatus {
  backend: RenderBackendKind;
  quality: RenderQuality;
  fps?: number;
  fallbackReason?: string;
}

function pageAspect(page: PageDescriptor): number {
  if (page.width <= 0 || page.height <= 0) {
    return 0.705;
  }
  return page.width / page.height;
}

export function buildRenderPlan(frame: RenderFrame, width: number, height: number): RenderSheet[] {
  if (width <= 0 || height <= 0 || frame.pages.length === 0) {
    return [];
  }

  const pages = frame.pages.slice(0, frame.mode === 'spread' ? 2 : 1);
  const totalAspect = pages.reduce((sum, page) => sum + pageAspect(page), 0);
  const sheetHeight = Math.min(height, width / Math.max(totalAspect, 0.1));
  const sheetWidth = sheetHeight * totalAspect;
  const originX = (width - sheetWidth) / 2;
  const originY = (height - sheetHeight) / 2;
  const progress = frame.reducedMotion ? 0 : Math.min(Math.max(frame.turnProgress, 0), 1);
  let cursorX = originX;

  return pages.map((page) => {
    const originalWidth = sheetHeight * pageAspect(page);
    let x = cursorX;
    let renderedWidth = originalWidth;
    let shade = 0;
    cursorX += originalWidth;

    if (page.id === frame.turningPageId && progress > 0) {
      const fold = Math.max(0.16, 1 - progress * 0.84);
      renderedWidth = originalWidth * fold;
      if (frame.direction === 'ltr') {
        x += originalWidth - renderedWidth;
      }
      shade = progress;
    }

    return { page, x, y: originY, width: renderedWidth, height: sheetHeight, shade };
  });
}

export function backendCandidates(webGpuAvailable: boolean, webGl2Available: boolean): RenderBackendKind[] {
  const candidates: RenderBackendKind[] = [];
  if (webGpuAvailable) {
    candidates.push('webgpu');
  }
  if (webGl2Available) {
    candidates.push('webgl2');
  }
  candidates.push('static');
  return candidates;
}
