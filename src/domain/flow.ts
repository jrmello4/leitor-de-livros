import type { ReadingDirection } from './types';

export const PANEL_GRAPH_VERSION = 1;

export type PanelAnalysisSource = 'geometry' | 'manual';

export type FlowResolution = 'ready' | 'review' | 'manual';

export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelRegion {
  id: string;
  order: number;
  bounds: PanelBounds;
}

export interface PanelGraph {
  version: typeof PANEL_GRAPH_VERSION;
  pageId: string;
  direction: ReadingDirection;
  source: PanelAnalysisSource;
  confidence: number;
  corrections: number;
  regions: PanelRegion[];
  updatedAt: string;
}

export function flowResolution(graph: PanelGraph): FlowResolution {
  if (graph.source === 'manual') {
    return 'manual';
  }

  return graph.confidence >= 0.72 ? 'ready' : 'review';
}

export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface PixelColor {
  red: number;
  green: number;
  blue: number;
}

interface Candidate {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function now(): string {
  return new Date().toISOString();
}

function colorAt(raster: RasterImage, index: number): PixelColor {
  const offset = index * 4;
  return {
    red: raster.data[offset] ?? 0,
    green: raster.data[offset + 1] ?? 0,
    blue: raster.data[offset + 2] ?? 0,
  };
}

function sampleBackground(raster: RasterImage): PixelColor {
  const inset = Math.max(1, Math.floor(Math.min(raster.width, raster.height) * 0.025));
  const points = [
    [inset, inset],
    [raster.width - 1 - inset, inset],
    [inset, raster.height - 1 - inset],
    [raster.width - 1 - inset, raster.height - 1 - inset],
  ];
  const total = points.reduce((sum, [x, y]) => {
    const sample = colorAt(raster, y * raster.width + x);
    return {
      red: sum.red + sample.red,
      green: sum.green + sample.green,
      blue: sum.blue + sample.blue,
    };
  }, { red: 0, green: 0, blue: 0 });
  return {
    red: total.red / points.length,
    green: total.green / points.length,
    blue: total.blue / points.length,
  };
}

function distanceFrom(color: PixelColor, background: PixelColor): number {
  return Math.sqrt(
    (color.red - background.red) ** 2
    + (color.green - background.green) ** 2
    + (color.blue - background.blue) ** 2,
  );
}

function overlapsAlmostEntirely(left: Candidate, right: Candidate): boolean {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlap = overlapWidth * overlapHeight;
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 && overlap / smaller > 0.86;
}

function candidatesFromRaster(raster: RasterImage): Candidate[] {
  const total = raster.width * raster.height;
  const background = sampleBackground(raster);
  const mask = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const minimumWidth = Math.max(8, Math.floor(raster.width * 0.12));
  const minimumHeight = Math.max(8, Math.floor(raster.height * 0.1));
  const minimumPixels = Math.max(24, Math.floor(total * 0.001));

  for (let index = 0; index < total; index += 1) {
    if ((raster.data[index * 4 + 3] ?? 255) < 40) {
      continue;
    }
    if (distanceFrom(colorAt(raster, index), background) >= 52) {
      mask[index] = 1;
    }
  }

  const candidates: Candidate[] = [];
  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || visited[start]) {
      continue;
    }
    let head = 0;
    let tail = 0;
    let pixels = 0;
    let minX = raster.width;
    let maxX = 0;
    let minY = raster.height;
    let maxY = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % raster.width;
      const y = Math.floor(index / raster.width);
      pixels += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const neighbors = [index - 1, index + 1, index - raster.width, index + raster.width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= total || visited[neighbor] || !mask[neighbor]) {
          continue;
        }
        const neighborX = neighbor % raster.width;
        if (Math.abs(neighborX - x) > 1) {
          continue;
        }
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (pixels < minimumPixels || width < minimumWidth || height < minimumHeight) {
      continue;
    }
    if (width / raster.width > 0.92 && height / raster.height > 0.92) {
      continue;
    }
    candidates.push({ x: minX, y: minY, width, height, pixels });
  }

  return candidates
    .sort((left, right) => right.width * right.height - left.width * left.height)
    .reduce<Candidate[]>((unique, candidate) => (
      unique.some((existing) => overlapsAlmostEntirely(existing, candidate)) ? unique : [...unique, candidate]
    ), []);
}

function orderedCandidates(candidates: Candidate[], direction: ReadingDirection): Candidate[] {
  return [...candidates].sort((left, right) => {
    const rowTolerance = Math.min(left.height, right.height) * 0.45;
    if (Math.abs(left.y - right.y) <= rowTolerance) {
      return direction === 'rtl' ? right.x - left.x : left.x - right.x;
    }
    return left.y - right.y;
  });
}

function panelBounds(candidate: Candidate, raster: RasterImage): PanelBounds {
  return {
    x: clamp(candidate.x / raster.width, 0, 1),
    y: clamp(candidate.y / raster.height, 0, 1),
    width: clamp(candidate.width / raster.width, 0.01, 1),
    height: clamp(candidate.height / raster.height, 0.01, 1),
  };
}

export function createManualPanelGraph(pageId: string, direction: ReadingDirection): PanelGraph {
  return {
    version: PANEL_GRAPH_VERSION,
    pageId,
    direction,
    source: 'manual',
    confidence: 0,
    corrections: 0,
    regions: [{ id: `${pageId}:panel-1`, order: 0, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
    updatedAt: now(),
  };
}

export function analyzePanelRaster(pageId: string, raster: RasterImage, direction: ReadingDirection): PanelGraph {
  if (raster.width < 2 || raster.height < 2 || raster.data.length < raster.width * raster.height * 4) {
    return createManualPanelGraph(pageId, direction);
  }

  const candidates = orderedCandidates(candidatesFromRaster(raster), direction).slice(0, 12);
  if (candidates.length === 0) {
    return createManualPanelGraph(pageId, direction);
  }

  const coverage = candidates.reduce((sum, candidate) => sum + candidate.width * candidate.height, 0)
    / (raster.width * raster.height);
  const confidence = candidates.length < 2
    ? 0.42
    : clamp(0.44 + candidates.length * 0.08 + Math.min(coverage, 0.55) * 0.35, 0.44, 0.92);
  return {
    version: PANEL_GRAPH_VERSION,
    pageId,
    direction,
    source: 'geometry',
    confidence,
    corrections: 0,
    regions: candidates.map((candidate, index) => ({
      id: `${pageId}:panel-${index + 1}`,
      order: index,
      bounds: panelBounds(candidate, raster),
    })),
    updatedAt: now(),
  };
}

export function orderedPanels(graph: PanelGraph): PanelRegion[] {
  return [...graph.regions].sort((left, right) => left.order - right.order);
}

export function swapPanelOrder(graph: PanelGraph, firstId: string, secondId: string): PanelGraph {
  if (firstId === secondId) {
    return graph;
  }
  const first = graph.regions.find((region) => region.id === firstId);
  const second = graph.regions.find((region) => region.id === secondId);
  if (!first || !second) {
    return graph;
  }

  return {
    ...graph,
    corrections: graph.corrections + 1,
    regions: graph.regions.map((region) => {
      if (region.id === firstId) {
        return { ...region, order: second.order };
      }
      if (region.id === secondId) {
        return { ...region, order: first.order };
      }
      return region;
    }),
    updatedAt: now(),
  };
}

export function isPanelGraph(value: unknown): value is PanelGraph {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PanelGraph>;
  return candidate.version === PANEL_GRAPH_VERSION
    && typeof candidate.pageId === 'string'
    && (candidate.direction === 'ltr' || candidate.direction === 'rtl')
    && (candidate.source === 'geometry' || candidate.source === 'manual')
    && typeof candidate.confidence === 'number'
    && Number.isFinite(candidate.confidence)
    && typeof candidate.corrections === 'number'
    && Number.isInteger(candidate.corrections)
    && Array.isArray(candidate.regions)
    && candidate.regions.every((region) => (
      typeof region.id === 'string'
      && Number.isInteger(region.order)
      && typeof region.bounds?.x === 'number'
      && typeof region.bounds?.y === 'number'
      && typeof region.bounds?.width === 'number'
      && typeof region.bounds?.height === 'number'
    ))
    && typeof candidate.updatedAt === 'string';
}
