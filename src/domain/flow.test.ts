import { describe, expect, it } from 'vitest';
import {
  addPanelRegion,
  analyzePanelRaster,
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
});
