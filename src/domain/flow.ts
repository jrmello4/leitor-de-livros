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

function isGutterRow(
  raster: RasterImage,
  y: number,
  lum: Float32Array,
  rowEnergy: Float32Array,
  avgRowEnergy: number,
  bg: PixelColor,
): boolean {
  const width = raster.width;
  const energy = rowEnergy[y] ?? 0;

  // Energy valley threshold: rows in gutters have significantly lower detail
  if (avgRowEnergy > 3.0 && energy < avgRowEnergy * 0.42) {
    return true;
  }

  let bgCount = 0;
  for (let x = 0; x < width; x += 1) {
    const l = lum[y * width + x] ?? 0;
    const idx = (y * width + x) * 4;
    const r = raster.data[idx] ?? 0;
    const g = raster.data[idx + 1] ?? 0;
    const b = raster.data[idx + 2] ?? 0;

    const dR = r - bg.red;
    const dG = g - bg.green;
    const dB = b - bg.blue;
    const dist = Math.sqrt(dR * dR + dG * dG + dB * dB);

    if (l > 205 || l < 45 || dist < 45) {
      bgCount += 1;
    }
  }

  const bgRatio = bgCount / width;
  return bgRatio > 0.62 || (bgRatio > 0.45 && energy < avgRowEnergy * 0.65);
}

function isGutterCol(
  raster: RasterImage,
  x: number,
  topY: number,
  bottomY: number,
  lum: Float32Array,
  bg: PixelColor,
): boolean {
  const width = raster.width;
  const height = bottomY - topY + 1;
  if (height <= 0) return false;

  let bgCount = 0;
  let colEnergy = 0;

  for (let y = topY; y <= bottomY; y += 1) {
    const l = lum[y * width + x] ?? 0;
    const idx = (y * width + x) * 4;
    const r = raster.data[idx] ?? 0;
    const g = raster.data[idx + 1] ?? 0;
    const b = raster.data[idx + 2] ?? 0;

    const dR = r - bg.red;
    const dG = g - bg.green;
    const dB = b - bg.blue;
    const dist = Math.sqrt(dR * dR + dG * dG + dB * dB);

    if (l > 205 || l < 45 || dist < 45) {
      bgCount += 1;
    }

    if (y > topY && y < bottomY) {
      const dy = Math.abs((lum[(y + 1) * width + x] ?? 0) - (lum[(y - 1) * width + x] ?? 0));
      colEnergy += dy;
    }
  }

  const bgRatio = bgCount / height;
  const avgEnergy = colEnergy / Math.max(1, height - 2);

  return bgRatio > 0.62 || (bgRatio > 0.45 && avgEnergy < 6.5);
}

function extractGutterIntervals(
  isGutter: (index: number) => boolean,
  length: number,
  minPanelSize: number,
  minGutterSize = 3,
): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  let inBlock = false;
  let blockStart = 0;

  for (let i = 0; i < length; i += 1) {
    const gutter = isGutter(i);
    if (!gutter && !inBlock) {
      inBlock = true;
      blockStart = i;
    } else if (gutter && inBlock) {
      inBlock = false;
      blocks.push({ start: blockStart, end: i - 1 });
    }
  }
  if (inBlock) {
    blocks.push({ start: blockStart, end: length - 1 });
  }

  if (blocks.length === 0) return [];

  // Merge blocks separated by a gutter thinner than minGutterSize
  const merged: Array<{ start: number; end: number }> = [];
  let current = { ...blocks[0] };

  for (let i = 1; i < blocks.length; i += 1) {
    const next = blocks[i];
    const gap = next.start - current.end - 1;
    if (gap < minGutterSize) {
      current.end = next.end;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  // Filter out tiny slivers (less than minPanelSize) by merging into adjacent panel
  const validPanels: Array<{ start: number; end: number }> = [];
  for (const block of merged) {
    const size = block.end - block.start + 1;
    if (size >= minPanelSize) {
      validPanels.push(block);
    } else if (validPanels.length > 0) {
      validPanels[validPanels.length - 1].end = block.end;
    }
  }

  return validPanels;
}

function detectPanelsViaGutters(raster: RasterImage, direction: ReadingDirection): Candidate[] {
  const { width, height, data } = raster;
  const total = width * height;
  const lum = new Float32Array(total);
  const rowEnergy = new Float32Array(height);
  const bg = sampleBackground(raster);

  for (let i = 0; i < total; i += 1) {
    const offset = i * 4;
    lum[i] = 0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
  }

  let totalEnergy = 0;
  for (let y = 1; y < height - 1; y += 1) {
    let rEnergy = 0;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const dx = Math.abs((lum[idx + 1] ?? 0) - (lum[idx - 1] ?? 0));
      const dy = Math.abs((lum[idx + width] ?? 0) - (lum[idx - width] ?? 0));
      rEnergy += dx + dy;
    }
    rowEnergy[y] = rEnergy / Math.max(1, width - 2);
    totalEnergy += rowEnergy[y];
  }
  const avgRowEnergy = totalEnergy / Math.max(1, height - 2);

  const minGutterThickness = Math.max(3, Math.floor(height * 0.006));
  const minTierHeight = Math.max(20, Math.floor(height * 0.10));
  const minColWidth = Math.max(20, Math.floor(width * 0.15));

  // Find horizontal tiers
  const tiers = extractGutterIntervals(
    (y) => isGutterRow(raster, y, lum, rowEnergy, avgRowEnergy, bg),
    height,
    minTierHeight,
    minGutterThickness,
  );

  if (tiers.length === 0) {
    return [];
  }

  const candidates: Candidate[] = [];

  for (const tier of tiers) {
    const cols = extractGutterIntervals(
      (x) => isGutterCol(raster, x, tier.start, tier.end, lum, bg),
      width,
      minColWidth,
      minGutterThickness,
    );

    const finalCols = cols.length > 0 ? cols : [{ start: 0, end: width - 1 }];
    const orderedCols = direction === 'rtl' ? [...finalCols].reverse() : finalCols;

    for (const col of orderedCols) {
      const w = col.end - col.start + 1;
      const h = tier.end - tier.start + 1;
      candidates.push({
        x: col.start,
        y: tier.start,
        width: w,
        height: h,
        pixels: w * h,
      });
    }
  }

  return candidates;
}

function generateProgressivePanels(raster: RasterImage, direction: ReadingDirection): Candidate[] {
  const isLandscape = raster.width >= raster.height * 1.1;

  if (isLandscape) {
    const halfWidth = Math.floor(raster.width * 0.58);
    const step = Math.floor(raster.width * 0.42);
    if (direction === 'rtl') {
      return [
        { x: step, y: 0, width: halfWidth, height: raster.height, pixels: halfWidth * raster.height },
        { x: 0, y: 0, width: halfWidth, height: raster.height, pixels: halfWidth * raster.height },
      ];
    }
    return [
      { x: 0, y: 0, width: halfWidth, height: raster.height, pixels: halfWidth * raster.height },
      { x: step, y: 0, width: halfWidth, height: raster.height, pixels: halfWidth * raster.height },
    ];
  }

  // Portrait: Top focus -> Bottom focus
  const halfHeight = Math.floor(raster.height * 0.58);
  const stepY = Math.floor(raster.height * 0.42);
  return [
    { x: 0, y: 0, width: raster.width, height: halfHeight, pixels: raster.width * halfHeight },
    { x: 0, y: stepY, width: raster.width, height: halfHeight, pixels: raster.width * halfHeight },
  ];
}

function candidatesFromRaster(raster: RasterImage): Candidate[] {
  const total = raster.width * raster.height;
  const background = sampleBackground(raster);
  const mask = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const minimumWidth = Math.max(20, Math.floor(raster.width * 0.18));
  const minimumHeight = Math.max(20, Math.floor(raster.height * 0.12));
  const minimumPixels = Math.max(40, Math.floor(total * 0.015));

  for (let index = 0; index < total; index += 1) {
    if ((raster.data[index * 4 + 3] ?? 255) < 40) {
      continue;
    }
    if (distanceFrom(colorAt(raster, index), background) >= 42) {
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
    if (width / raster.width > 0.94 && height / raster.height > 0.94) {
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

function hasContentVariance(raster: RasterImage): boolean {
  if (raster.width < 16 || raster.height < 16) return false;
  const first = raster.data[0] ?? 0;
  for (let i = 4; i < raster.data.length; i += 16) {
    if (Math.abs((raster.data[i] ?? 0) - first) > 10) return true;
  }
  return false;
}

export function analyzePanelRaster(pageId: string, raster: RasterImage, direction: ReadingDirection): PanelGraph {
  if (raster.width < 16 || raster.height < 16 || raster.data.length < raster.width * raster.height * 4 || !hasContentVariance(raster)) {
    return createManualPanelGraph(pageId, direction);
  }

  // Strategy 1: Gutter projection profile detection (find authentic panel grids & tiers)
  let candidates = detectPanelsViaGutters(raster, direction);

  // Strategy 2: Connected component contour detection (for irregular layout)
  if (candidates.length < 2) {
    const contourCandidates = orderedCandidates(candidatesFromRaster(raster), direction).slice(0, 10);
    if (contourCandidates.length >= 2) {
      candidates = contourCandidates;
    }
  }

  // If genuine comic panels are found (2 or more), use them
  if (candidates.length >= 2) {
    const coverage = candidates.reduce((sum, candidate) => sum + candidate.width * candidate.height, 0)
      / (raster.width * raster.height);
    const confidence = clamp(0.44 + candidates.length * 0.08 + Math.min(coverage, 0.55) * 0.35, 0.55, 0.95);

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

  // If no panel subdivisions were found (Cover, Splash Page, Full Illustration, or Text Page),
  // keep as a single clean full-page panel (scale 1.0) so the camera never focuses on random logos/text.
  return createManualPanelGraph(pageId, direction);
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

export function addPanelRegion(graph: PanelGraph, bounds: PanelBounds): PanelGraph {
  const newId = `${graph.pageId}:panel-custom-${Date.now()}`;
  const newOrder = graph.regions.length;
  const newRegion: PanelRegion = {
    id: newId,
    order: newOrder,
    bounds: {
      x: clamp(bounds.x, 0, 1),
      y: clamp(bounds.y, 0, 1),
      width: clamp(bounds.width, 0.01, 1),
      height: clamp(bounds.height, 0.01, 1),
    },
  };

  return {
    ...graph,
    source: 'manual',
    corrections: graph.corrections + 1,
    regions: [...graph.regions, newRegion],
    updatedAt: now(),
  };
}

export function removePanelRegion(graph: PanelGraph, regionId: string): PanelGraph {
  const remaining = graph.regions.filter((region) => region.id !== regionId);
  const reordered = remaining.map((region, index) => ({
    ...region,
    order: index,
  }));

  return {
    ...graph,
    source: 'manual',
    corrections: graph.corrections + 1,
    regions: reordered,
    updatedAt: now(),
  };
}

export function updatePanelBounds(graph: PanelGraph, regionId: string, bounds: PanelBounds): PanelGraph {
  return {
    ...graph,
    source: 'manual',
    corrections: graph.corrections + 1,
    regions: graph.regions.map((region) => (
      region.id === regionId
        ? {
          ...region,
          bounds: {
            x: clamp(bounds.x, 0, 1),
            y: clamp(bounds.y, 0, 1),
            width: clamp(bounds.width, 0.01, 1),
            height: clamp(bounds.height, 0.01, 1),
          },
        }
        : region
    )),
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

export interface PanelCameraTransform {
  scale: number;
  panX: number;
  panY: number;
}

export function calculatePanelCameraTransform(
  bounds: PanelBounds,
  viewportWidth: number,
  viewportHeight: number,
  pageDisplayWidth: number,
  pageDisplayHeight: number,
): PanelCameraTransform {
  if (viewportWidth <= 0 || viewportHeight <= 0 || pageDisplayWidth <= 0 || pageDisplayHeight <= 0) {
    return { scale: 1, panX: 0, panY: 0 };
  }

  const panelPixelWidth = Math.max(1, bounds.width * pageDisplayWidth);
  const panelPixelHeight = Math.max(1, bounds.height * pageDisplayHeight);

  // Target panel occupying 90% of the viewport for comfortable reading margins
  const scaleX = (viewportWidth * 0.90) / panelPixelWidth;
  const scaleY = (viewportHeight * 0.90) / panelPixelHeight;
  const rawScale = Math.min(scaleX, scaleY);
  const scale = clamp(rawScale, 1.0, 4.5);

  const panelCenterX = (bounds.x + bounds.width / 2) * pageDisplayWidth;
  const panelCenterY = (bounds.y + bounds.height / 2) * pageDisplayHeight;
  const pageCenterX = pageDisplayWidth / 2;
  const pageCenterY = pageDisplayHeight / 2;

  const panX = (pageCenterX - panelCenterX) * scale;
  const panY = (pageCenterY - panelCenterY) * scale;

  return {
    scale: Number(scale.toFixed(3)),
    panX: Math.round(panX),
    panY: Math.round(panY),
  };
}
