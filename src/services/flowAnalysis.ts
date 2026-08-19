import { analyzePanelRaster, createManualPanelGraph, type PanelGraph } from '../domain/flow';
import type { PageDescriptor, ReadingDirection } from '../domain/types';

const MAX_ANALYSIS_EDGE = 720;

export async function analyzePageFlow(page: PageDescriptor, direction: ReadingDirection): Promise<PanelGraph> {
  try {
    const image = await loadImage(page.src);
    const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const width = Math.max(2, Math.round(image.naturalWidth * scale));
    const height = Math.max(2, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return createManualPanelGraph(page.id, direction);
    }
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return analyzePanelRaster(page.id, imageData, direction);
  } catch {
    return createManualPanelGraph(page.id, direction);
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    // Same-origin taint would make `getImageData` throw, silently costing the
    // reader panel guidance in the packaged app.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Page image could not be decoded for local flow analysis.'));
    image.src = source;
    if (image.complete && image.naturalWidth > 0) {
      resolve(image);
    }
  });
}
