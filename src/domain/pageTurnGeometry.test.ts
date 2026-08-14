import { describe, expect, it } from 'vitest';
import {
  activationBandWidth,
  clientToPagePoint,
  isVisibleOuterEdgeHit,
  turnDisplacement,
  VelocityTracker,
} from './pageTurnGeometry';

describe('page turn geometry', () => {
  it.each([
    [100, 28],
    [500, 40],
    [2000, 72],
  ] as const)('clamps activation band width for page width %s', (pageWidth, expected) => {
    expect(activationBandWidth(pageWidth)).toBe(expected);
  });

  it('inverts zoom and pan before normalizing into page space', () => {
    expect(
      clientToPagePoint(
        { x: 450, y: 350 },
        { left: 100, top: 50, width: 400, height: 600 },
        { scale: 2, panX: 50, panY: 0 },
      ),
    ).toEqual({ x: 0.375, y: 0.25 });
  });

  it('accepts the full visible outer edge in LTR and mirrors it in RTL', () => {
    const geometry = { left: 100, top: 40, width: 500, height: 700, clipLeft: 120, clipRight: 600 };

    for (const y of [40, 390, 740]) {
      expect(isVisibleOuterEdgeHit({ x: 598, y }, geometry, 'ltr')).toBe(true);
      expect(isVisibleOuterEdgeHit({ x: 122, y }, geometry, 'rtl')).toBe(true);
    }

    expect(isVisibleOuterEdgeHit({ x: 102, y: 390 }, geometry, 'ltr')).toBe(false);
    expect(isVisibleOuterEdgeHit({ x: 598, y: 390 }, geometry, 'rtl')).toBe(false);
  });

  it('uses the clipped transformed edge instead of the full page edge', () => {
    const geometry = { left: 100, top: 20, width: 500, height: 200, clipRight: 540, clipBottom: 220 };

    expect(isVisibleOuterEdgeHit({ x: 539, y: 20 }, geometry, 'ltr')).toBe(true);
    expect(isVisibleOuterEdgeHit({ x: 541, y: 20 }, geometry, 'ltr')).toBe(false);
  });

  it('returns a positive displacement toward the destination for both reading directions', () => {
    expect(turnDisplacement({ x: 500, y: 0 }, { x: 380, y: 0 }, 400, 'ltr')).toBeCloseTo(0.3);
    expect(turnDisplacement({ x: 100, y: 0 }, { x: 220, y: 0 }, 400, 'rtl')).toBeCloseTo(0.3);
    expect(turnDisplacement({ x: 380, y: 0 }, { x: 500, y: 0 }, 400, 'ltr')).toBeCloseTo(-0.3);
  });

  it('keeps velocity within a short window and returns zero for zero elapsed time', () => {
    const tracker = new VelocityTracker();

    tracker.push({ x: 0, y: 0 }, 0);
    tracker.push({ x: 10, y: 0 }, 40);
    tracker.push({ x: 100, y: 0 }, 120);

    expect(tracker.velocity()).toEqual({ x: 1125, y: 0 });

    const zeroTime = new VelocityTracker();
    zeroTime.push({ x: 10, y: 10 }, 100);
    zeroTime.push({ x: 20, y: 20 }, 100);

    expect(zeroTime.velocity()).toEqual({ x: 0, y: 0 });
  });
});
