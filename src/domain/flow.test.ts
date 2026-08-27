import { describe, expect, it } from 'vitest';
import {
  addPanelRegion,
  analyzePanelRaster,
  calculatePanelCameraTransform,
  createManualPanelGraph,
  flowResolution,
  orderedPanels,
  removePanelRegion,
  swapPanelOrder,
  updatePanelBounds,
  type RasterImage,
} from './flow';

function rasterWithPanels(): RasterImage {
  const width = 120;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 242;
    data[index * 4 + 1] = 235;
    data[index * 4 + 2] = 216;
    data[index * 4 + 3] = 255;
  }
  const fill = (left: number, top: number, panelWidth: number, panelHeight: number) => {
    for (let y = top; y < top + panelHeight; y += 1) {
      for (let x = left; x < left + panelWidth; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 26;
        data[offset + 1] = 40;
        data[offset + 2] = 47;
      }
    }
  };
  fill(10, 12, 38, 48);
  fill(70, 12, 38, 48);
  return { width, height, data };
}

describe('Adaptive Flow geometry', () => {
  it('orders disconnected panel regions from the selected reading edge', () => {
    const ltr = analyzePanelRaster('page-1', rasterWithPanels(), 'ltr');
    const rtl = analyzePanelRaster('page-1', rasterWithPanels(), 'rtl');

    expect(ltr.source).toBe('geometry');
    expect(ltr.regions).toHaveLength(2);
    expect(orderedPanels(ltr)[0].bounds.x).toBeLessThan(orderedPanels(ltr)[1].bounds.x);
    expect(orderedPanels(rtl)[0].bounds.x).toBeGreaterThan(orderedPanels(rtl)[1].bounds.x);
  });

  it('falls back to one manual region when geometry has no usable panel', () => {
    const raster: RasterImage = {
      width: 8,
      height: 8,
      data: new Uint8ClampedArray(8 * 8 * 4).fill(255),
    };
    const graph = analyzePanelRaster('blank', raster, 'ltr');

    expect(graph.source).toBe('manual');
    expect(graph.regions[0].bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('stores a correction by swapping exactly two chosen panels', () => {
    const graph = analyzePanelRaster('page-1', rasterWithPanels(), 'ltr');
    const [first, second] = orderedPanels(graph);
    const corrected = swapPanelOrder(graph, first.id, second.id);

    expect(corrected.corrections).toBe(1);
    expect(orderedPanels(corrected)[0].id).toBe(second.id);
    expect(createManualPanelGraph('fallback', 'rtl').direction).toBe('rtl');
  });

  it('classifies automatic, uncertain, and manual routes as exclusive states', () => {
    const ready = analyzePanelRaster('ready', rasterWithPanels(), 'ltr');
    const review = { ...ready, confidence: 0.5 };
    const manual = createManualPanelGraph('manual', 'ltr');

    expect(flowResolution(ready)).toBe('ready');
    expect(flowResolution(review)).toBe('review');
    expect(flowResolution(manual)).toBe('manual');
  });

  it('adds, removes and updates panel regions dynamically', () => {
    const graph = analyzePanelRaster('page-1', rasterWithPanels(), 'ltr');
    const initialCount = graph.regions.length;

    // Add region
    const withAdded = addPanelRegion(graph, { x: 0.1, y: 0.1, width: 0.3, height: 0.4 });
    expect(withAdded.regions).toHaveLength(initialCount + 1);
    expect(withAdded.source).toBe('manual');
    expect(withAdded.corrections).toBe(1);

    // Update region
    const addedId = withAdded.regions[withAdded.regions.length - 1].id;
    const withUpdated = updatePanelBounds(withAdded, addedId, { x: 0.2, y: 0.2, width: 0.5, height: 0.6 });
    const updated = withUpdated.regions.find((r) => r.id === addedId);
    expect(updated?.bounds).toEqual({ x: 0.2, y: 0.2, width: 0.5, height: 0.6 });

    // Remove region
    const withRemoved = removePanelRegion(withUpdated, addedId);
    expect(withRemoved.regions).toHaveLength(initialCount);
    expect(withRemoved.regions.find((r) => r.id === addedId)).toBeUndefined();
  });

  it('calculates cinematic camera framing and centering for a panel', () => {
    // Top-left panel occupying 50% width and 50% height
    const bounds = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const transform = calculatePanelCameraTransform(bounds, 1920, 1080, 800, 1200);

    // Scale should zoom in to fit 50% box into viewport
    expect(transform.scale).toBeGreaterThan(1);
    expect(transform.scale).toBeLessThanOrEqual(4.5);

    // Pan should offset toward the top-left to center the panel
    expect(transform.panX).toBeGreaterThan(0);
    expect(transform.panY).toBeGreaterThan(0);

    // Centered full page panel should have 0 pan
    const fullPageBounds = { x: 0, y: 0, width: 1, height: 1 };
    const fullTransform = calculatePanelCameraTransform(fullPageBounds, 1000, 1000, 1000, 1000);
    expect(fullTransform.panX).toBe(0);
    expect(fullTransform.panY).toBe(0);
    expect(fullTransform.scale).toBe(1);
  });

  it('detects multi-tier comic panels separated by dark or light gutters', () => {
    const width = 100;
    const height = 150;
    const data = new Uint8ClampedArray(width * height * 4).fill(255); // White background

    // Fill 4 panels in 2 tiers (2x2 grid) with gutter gaps
    const drawPanel = (x1: number, y1: number, w: number, h: number) => {
      for (let y = y1; y < y1 + h; y += 1) {
        for (let x = x1; x < x1 + w; x += 1) {
          const idx = (y * width + x) * 4;
          data[idx] = 40;
          data[idx + 1] = 40;
          data[idx + 2] = 40;
        }
      }
    };

    drawPanel(10, 10, 35, 55); // Top-left
    drawPanel(55, 10, 35, 55); // Top-right
    drawPanel(10, 80, 35, 55); // Bottom-left
    drawPanel(55, 80, 35, 55); // Bottom-right

    const graph = analyzePanelRaster('comic-page', { width, height, data }, 'ltr');
    expect(graph.regions.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps full splash art pages and covers as a clean single full-page panel', () => {
    const width = 100;
    const height = 150;
    const data = new Uint8ClampedArray(width * height * 4);
    // Draw continuous artwork across the entire page (no gutters)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i % 200) + 20;
      data[i + 1] = (i % 150) + 30;
      data[i + 2] = (i % 100) + 40;
      data[i + 3] = 255;
    }

    const graph = analyzePanelRaster('splash-page', { width, height, data }, 'ltr');
    expect(graph.regions).toHaveLength(1);
    expect(graph.regions[0].bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});
