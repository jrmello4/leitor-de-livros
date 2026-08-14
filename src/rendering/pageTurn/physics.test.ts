import { describe, expect, it } from 'vitest';
import { PaperPhysicsSolver } from './physics';

describe('PaperPhysicsSolver', () => {
  it('keeps every spine point pinned while the outer edge follows the pointer', () => {
    const solver = new PaperPhysicsSolver({ quality: 'rich', direction: 'ltr' });
    const frame = solver.begin({ x: 1, y: 0.25 }).step({ pointer: { x: 0.55, y: 0.3 }, elapsedMs: 16 });

    expect(frame.pointAt(0, 0)).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(frame.pointAt(0, 6)).toMatchObject({ x: 0, y: 1, z: 0 });
    expect(frame.grabPoint).toEqual({ x: 0.55, y: 0.3 });
    expect(frame.invalidReason).toBeUndefined();
  });

  it('produces deterministic cylinder output for the same normalized steps', () => {
    const inputs = [
      { pointer: { x: 0.82, y: 0.2 }, elapsedMs: 16 },
      { pointer: { x: 0.64, y: 0.35 }, elapsedMs: 16 },
      { pointer: { x: 0.48, y: 0.4 }, elapsedMs: 17 },
    ] as const;

    const left = new PaperPhysicsSolver({ quality: 'balanced', direction: 'ltr' }).begin({ x: 1, y: 0.2 });
    const right = new PaperPhysicsSolver({ quality: 'balanced', direction: 'ltr' }).begin({ x: 1, y: 0.2 });

    let leftFrame = left.step({ elapsedMs: 0 });
    let rightFrame = right.step({ elapsedMs: 0 });

    for (const input of inputs) {
      leftFrame = left.step(input);
      rightFrame = right.step(input);
    }

    expect(Array.from(leftFrame.controlPoints)).toEqual(Array.from(rightFrame.controlPoints));
  });

  it('keeps frame snapshots immutable after later solver steps', () => {
    const solver = new PaperPhysicsSolver({ quality: 'rich', direction: 'ltr' }).begin({ x: 1, y: 0.25 });
    const frame = solver.step({ pointer: { x: 0.72, y: 0.3 }, elapsedMs: 16 });
    const index = 2 * 9 + 8;
    const pointBefore = frame.pointAt(8, 2);
    const pointsBefore = frame.points.map((point) => ({ ...point }));
    const controlBefore = Array.from(frame.controlPoints);

    solver.step({ pointer: { x: 0.4, y: 0.65 }, elapsedMs: 16 });

    expect(frame.pointAt(8, 2)).toEqual(pointBefore);
    expect(frame.points).toEqual(pointsBefore);
    expect(Array.from(frame.controlPoints)).toEqual(controlBefore);
    expect(frame.pointAt(8, 2)).toEqual(pointsBefore[index]);
    expect(frame.pointAt(8, 2).x).toBeCloseTo(controlBefore[index * 6], 6);
    expect(frame.pointAt(8, 2).y).toBeCloseTo(controlBefore[index * 6 + 1], 6);
    expect(frame.pointAt(8, 2).z).toBeCloseTo(controlBefore[index * 6 + 2], 6);
  });

  it('caps integration to four substeps and drops excess accumulated time', () => {
    const solver = new PaperPhysicsSolver({ quality: 'balanced', direction: 'ltr' }).begin({ x: 1, y: 0.5 });

    const frame = solver.step({ pointer: { x: 0.5, y: 0.5 }, elapsedMs: 100 });
    const next = solver.step({ elapsedMs: 0 });

    expect(frame.substeps).toBe(4);
    expect(frame.droppedSeconds).toBeCloseTo(0.0666666667, 6);
    expect(next.substeps).toBe(0);
    expect(next.droppedSeconds).toBe(0);
  });

  it('rejects non-finite input before integrating', () => {
    const solver = new PaperPhysicsSolver({ quality: 'essential', direction: 'ltr' }).begin({ x: 1, y: 0.5 });
    const frame = solver.step({ pointer: { x: Number.NaN, y: 0.5 }, elapsedMs: 8 });

    expect(frame.invalidReason).toBe('non-finite-input');
    expect(frame.controlPoints).toHaveLength(0);
    expect(frame.points).toHaveLength(0);
  });

  it('rejects out-of-envelope normalized grab points without leaking them through a public frame', () => {
    const solver = new PaperPhysicsSolver({ quality: 'essential', direction: 'ltr' }).begin({ x: 3.01, y: 0.5 });
    const frame = solver.step({ elapsedMs: 0 });

    expect(frame.invalidReason).toBe('excessive-displacement');
    expect(frame.controlPoints).toHaveLength(0);
    expect(frame.points).toHaveLength(0);
    expect(frame.grabPoint).toEqual({ x: 1, y: 0.5 });
  });

  it('rejects out-of-envelope normalized pointers without leaking them through a public frame', () => {
    const solver = new PaperPhysicsSolver({ quality: 'essential', direction: 'ltr' }).begin({ x: 1, y: 0.5 });
    const valid = solver.step({ pointer: { x: 0.6, y: 0.45 }, elapsedMs: 16 });
    const invalid = solver.step({ pointer: { x: 3.01, y: 0.45 }, elapsedMs: 16 });

    expect(valid.invalidReason).toBeUndefined();
    expect(invalid.invalidReason).toBe('excessive-displacement');
    expect(invalid.controlPoints).toHaveLength(0);
    expect(invalid.points).toHaveLength(0);
    expect(invalid.grabPoint).toEqual(valid.grabPoint);
  });

  it('rejects excessive displacement before exposing the frame', () => {
    const solver = new PaperPhysicsSolver({ quality: 'essential', direction: 'ltr' }).begin({ x: 1, y: 0.5 });
    const frame = solver.step({ pointer: { x: -3, y: 0.5 }, elapsedMs: 40 });

    expect(frame.invalidReason).toBe('excessive-displacement');
    expect(frame.controlPoints).toHaveLength(0);
  });

  it('mirrors the lattice equivalently for rtl turns', () => {
    const ltr = new PaperPhysicsSolver({ quality: 'rich', direction: 'ltr' }).begin({ x: 1, y: 0.3 });
    const rtl = new PaperPhysicsSolver({ quality: 'rich', direction: 'rtl' }).begin({ x: 0, y: 0.3 });

    const ltrFrame = ltr.step({ pointer: { x: 0.42, y: 0.65 }, elapsedMs: 16 });
    const rtlFrame = rtl.step({ pointer: { x: 0.58, y: 0.65 }, elapsedMs: 16 });

    for (let row = 0; row <= 6; row += 1) {
      for (let column = 0; column <= 8; column += 1) {
        const mirrored = 8 - column;
        const leftPoint = ltrFrame.pointAt(column, row);
        const rightPoint = rtlFrame.pointAt(mirrored, row);

        expect(rightPoint.x).toBeCloseTo(1 - leftPoint.x, 6);
        expect(rightPoint.y).toBeCloseTo(leftPoint.y, 6);
        expect(rightPoint.z).toBeCloseTo(leftPoint.z, 6);
      }
    }
  });
});
