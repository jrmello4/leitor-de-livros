import type { RenderQuality } from '../contracts';

export interface UvPoint {
  u: number;
  v: number;
}

export interface PageTurnMesh {
  version: number;
  quality: RenderQuality;
  control: {
    columns: number;
    rows: number;
  };
  visual: {
    columns: number;
    rows: number;
  };
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
  controlPointCount: number;
}

export const PAGE_TURN_MESH_VERSION = 1;

export const QUALITY_TOPOLOGY = {
  rich: { controlColumns: 9, controlRows: 7, visualColumns: 48, visualRows: 32, iterations: 6 },
  balanced: { controlColumns: 7, controlRows: 5, visualColumns: 32, visualRows: 24, iterations: 4 },
  essential: { controlColumns: 5, controlRows: 4, visualColumns: 20, visualRows: 14, iterations: 3 },
} as const satisfies Record<RenderQuality, {
  controlColumns: number;
  controlRows: number;
  visualColumns: number;
  visualRows: number;
  iterations: number;
}>;

export function versoUv(point: UvPoint): UvPoint {
  return {
    u: 1 - point.u,
    v: point.v,
  };
}

function createGridPositions(columns: number, rows: number): Float32Array {
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  let cursor = 0;

  for (let row = 0; row <= rows; row += 1) {
    const v = rows === 0 ? 0 : row / rows;

    for (let column = 0; column <= columns; column += 1) {
      const u = columns === 0 ? 0 : column / columns;
      positions[cursor] = u;
      positions[cursor + 1] = v;
      positions[cursor + 2] = 0;
      cursor += 3;
    }
  }

  return positions;
}

function createGridUvs(columns: number, rows: number): Float32Array {
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);
  let cursor = 0;

  for (let row = 0; row <= rows; row += 1) {
    const v = rows === 0 ? 0 : row / rows;

    for (let column = 0; column <= columns; column += 1) {
      const u = columns === 0 ? 0 : column / columns;
      uvs[cursor] = u;
      uvs[cursor + 1] = v;
      cursor += 2;
    }
  }

  return uvs;
}

function createGridIndices(columns: number, rows: number): Uint16Array {
  const indices = new Uint16Array(columns * rows * 6);
  const stride = columns + 1;
  let cursor = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;

      indices[cursor] = topLeft;
      indices[cursor + 1] = bottomLeft;
      indices[cursor + 2] = topRight;
      indices[cursor + 3] = topRight;
      indices[cursor + 4] = bottomLeft;
      indices[cursor + 5] = bottomRight;
      cursor += 6;
    }
  }

  return indices;
}

export function createPageTurnMesh(quality: RenderQuality): PageTurnMesh {
  const topology = QUALITY_TOPOLOGY[quality];
  const positions = createGridPositions(topology.visualColumns, topology.visualRows);
  const uvs = createGridUvs(topology.visualColumns, topology.visualRows);
  const indices = createGridIndices(topology.visualColumns, topology.visualRows);

  return {
    version: PAGE_TURN_MESH_VERSION,
    quality,
    control: {
      columns: topology.controlColumns,
      rows: topology.controlRows,
    },
    visual: {
      columns: topology.visualColumns,
      rows: topology.visualRows,
    },
    positions,
    uvs,
    indices,
    vertexCount: (topology.visualColumns + 1) * (topology.visualRows + 1),
    indexCount: indices.length,
    controlPointCount: topology.controlColumns * topology.controlRows,
  };
}
