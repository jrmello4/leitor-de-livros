import { describe, expect, it } from 'vitest';
import { PAGE_TURN_MESH_VERSION, QUALITY_TOPOLOGY, createPageTurnMesh, versoUv } from './mesh';

describe('page turn mesh', () => {
  it('uses the approved rich topology and opposite readable winding on the verso', () => {
    const mesh = createPageTurnMesh('rich');

    expect(PAGE_TURN_MESH_VERSION).toBe(1);
    expect(QUALITY_TOPOLOGY.rich).toEqual({
      controlColumns: 9,
      controlRows: 7,
      visualColumns: 48,
      visualRows: 32,
      iterations: 6,
    });
    expect(mesh.version).toBe(1);
    expect(mesh.control).toEqual({ columns: 9, rows: 7 });
    expect(mesh.visual).toEqual({ columns: 48, rows: 32 });
    expect(versoUv({ u: 0.2, v: 0.7 })).toEqual({ u: 0.8, v: 0.7 });
  });

  it.each([
    ['rich', 48, 32, 9, 7],
    ['balanced', 32, 24, 7, 5],
    ['essential', 20, 14, 5, 4],
  ] as const)('builds a stable %s topology', (quality, visualColumns, visualRows, controlColumns, controlRows) => {
    const mesh = createPageTurnMesh(quality);

    expect(mesh.vertexCount).toBe((visualColumns + 1) * (visualRows + 1));
    expect(mesh.indexCount).toBe(visualColumns * visualRows * 6);
    expect(mesh.controlPointCount).toBe(controlColumns * controlRows);
  });
});
