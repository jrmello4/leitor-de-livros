import { describe, expect, it } from 'vitest';
import { createNormals, type Vec3 } from './physics';

/**
 * A vertex whose neighbours collapse onto each other has no cross product to
 * normalize. That is a local, recoverable degeneracy — the points are still
 * finite, they just describe a flat or folded patch. Failing the whole frame
 * for it reports `invalid-normal`, which disables the page turn for the rest of
 * the reading session.
 */
function flatGrid(columns: number, rows: number): Vec3[] {
  const points: Vec3[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({ x: column / (columns - 1), y: row / (rows - 1), z: 0 });
    }
  }
  return points;
}

describe('createNormals', () => {
  it('returns a finite normal for every vertex of a flat sheet', () => {
    const normals = createNormals(flatGrid(5, 5), 5, 5);

    expect(normals).toBeDefined();
    expect(normals).toHaveLength(25);
    for (const normal of normals!) {
      expect(Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z)).toBe(true);
    }
  });

  it('survives a degenerate patch instead of failing the whole frame', () => {
    const points = flatGrid(5, 5);
    // Collapse one vertex's neighbours onto a single position: the local
    // tangents become parallel and their cross product has no length.
    const centre = 2 * 5 + 2;
    points[centre - 1] = { ...points[centre] };
    points[centre + 1] = { ...points[centre] };

    const normals = createNormals(points, 5, 5);

    expect(normals, 'a degenerate patch must not fail the frame').toBeDefined();
    expect(normals).toHaveLength(25);
    for (const normal of normals!) {
      expect(Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z)).toBe(true);
    }
  });
});
