import type { ReadingDirection } from '../../domain/types';
import type { Vec2 } from '../../domain/pageTurnTypes';
import type { RenderQuality } from '../contracts';
import { QUALITY_TOPOLOGY } from './mesh';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SolverInput {
  pointer?: Vec2;
  elapsedMs: number;
}

export interface PageTurnPhysicsFrame {
  controlPoints: Float32Array;
  points: readonly Vec3[];
  grabPoint: Vec2;
  substeps: number;
  droppedSeconds: number;
  invalidReason?: 'non-finite-input' | 'non-finite-output' | 'excessive-displacement' | 'invalid-normal' | 'unpinned-spine';
  pointAt(column: number, row: number): Vec3;
}

export interface PaperPhysicsSolverOptions {
  quality: RenderQuality;
  direction: ReadingDirection;
}

const FIXED_STEP_SECONDS = 1 / 120;
const MAX_SUBSTEPS = 4;
const MAX_NORMALIZED_DISPLACEMENT = 2;
const SAFE_NORMALIZED_MIN = -MAX_NORMALIZED_DISPLACEMENT;
const SAFE_NORMALIZED_MAX = 1 + MAX_NORMALIZED_DISPLACEMENT;
const ZERO_POINT = Object.freeze({ x: 0, y: 0, z: 0 });
type InvalidFrameReason = NonNullable<PageTurnPhysicsFrame['invalidReason']>;

export class PaperPhysicsSolver {
  private readonly columns: number;
  private readonly rows: number;
  private readonly direction: ReadingDirection;
  private readonly restPoints: readonly Vec2[];
  private readonly defaultGrabPoint: Vec2;
  private accumulator = 0;
  private actualGrabPoint: Vec2;
  private actualPointer: Vec2;
  private points: Vec3[];
  private pendingInvalidReason?: InvalidFrameReason;

  constructor(options: PaperPhysicsSolverOptions) {
    const topology = QUALITY_TOPOLOGY[options.quality];
    this.columns = topology.controlColumns;
    this.rows = topology.controlRows;
    this.direction = options.direction;
    this.restPoints = createRestPoints(this.columns, this.rows);
    this.defaultGrabPoint = options.direction === 'rtl' ? { x: 0, y: 0.5 } : { x: 1, y: 0.5 };
    this.actualGrabPoint = { ...this.defaultGrabPoint };
    this.actualPointer = { ...this.actualGrabPoint };
    this.points = this.restPoints.map((point) => ({ x: point.x, y: point.y, z: 0 }));
  }

  begin(grabPoint: Vec2): this {
    this.accumulator = 0;
    this.points = this.restPoints.map((point) => ({ x: point.x, y: point.y, z: 0 }));

    if (!isFiniteVec2(grabPoint)) {
      this.pendingInvalidReason = 'non-finite-input';
      this.actualGrabPoint = { ...this.defaultGrabPoint };
      this.actualPointer = { ...this.defaultGrabPoint };
      return this;
    }

    if (!isWithinNormalizedEnvelopeVec2(grabPoint)) {
      this.pendingInvalidReason = 'excessive-displacement';
      this.actualGrabPoint = { ...this.defaultGrabPoint };
      this.actualPointer = { ...this.defaultGrabPoint };
      return this;
    }

    this.pendingInvalidReason = undefined;
    this.actualGrabPoint = { x: grabPoint.x, y: grabPoint.y };
    this.actualPointer = { x: grabPoint.x, y: grabPoint.y };
    return this;
  }

  step(input: SolverInput): PageTurnPhysicsFrame {
    if (!isFiniteNumber(input.elapsedMs) || !isFiniteVec2(this.actualGrabPoint) || (input.pointer && !isFiniteVec2(input.pointer))) {
      return this.emptyFrame('non-finite-input', 0, 0);
    }

    if (this.pendingInvalidReason) {
      return this.emptyFrame(this.pendingInvalidReason, 0, 0);
    }

    if (input.pointer && !isWithinNormalizedEnvelopeVec2(input.pointer)) {
      return this.emptyFrame('excessive-displacement', 0, 0);
    }

    if (input.pointer) {
      this.actualPointer = {
        x: input.pointer.x,
        y: input.pointer.y,
      };
    }

    this.accumulator += Math.max(0, input.elapsedMs) / 1000;
    let steps = 0;

    while (this.accumulator >= FIXED_STEP_SECONDS && steps < MAX_SUBSTEPS) {
      this.integrate();
      this.accumulator -= FIXED_STEP_SECONDS;
      steps += 1;
    }

    const droppedSeconds = steps === MAX_SUBSTEPS ? this.accumulator : 0;
    if (droppedSeconds > 0) {
      this.accumulator = 0;
    }

    return this.snapshot(steps, droppedSeconds);
  }

  private integrate(): void {
    const canonicalPointer = this.toCanonical(this.actualPointer);
    const canonicalGrab = this.toCanonical(this.actualGrabPoint);
    const pointerRow = nearestRowIndex(canonicalGrab.y, this.rows);
    const nextPoints: Vec3[] = [];

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        const restPoint = this.restPoints[index];
        const canonicalRest = this.toCanonical(restPoint);
        let canonicalPoint = cylinderPoint(canonicalRest, canonicalPointer, canonicalGrab.y);

        if (canonicalRest.x === 0) {
          canonicalPoint = { x: 0, y: canonicalRest.y, z: 0 };
        } else if (canonicalRest.x === 1 && row === pointerRow) {
          canonicalPoint = {
            x: canonicalPointer.x,
            y: canonicalPointer.y,
            z: canonicalPoint.z,
          };
        }

        nextPoints.push(this.fromCanonicalPoint(canonicalPoint));
      }
    }

    this.points = nextPoints;
  }

  private snapshot(substeps: number, droppedSeconds: number): PageTurnPhysicsFrame {
    if (this.exceedsNormalizedDisplacement()) {
      return this.emptyFrame('excessive-displacement', substeps, droppedSeconds);
    }

    if (!this.hasPinnedSpine()) {
      return this.emptyFrame('unpinned-spine', substeps, droppedSeconds);
    }

    if (!this.points.every(isFiniteVec3)) {
      return this.emptyFrame('non-finite-output', substeps, droppedSeconds);
    }

    if (!this.points.every(isWithinNormalizedEnvelopeVec3)) {
      return this.emptyFrame('excessive-displacement', substeps, droppedSeconds);
    }

    const normals = createNormals(this.points, this.columns, this.rows);
    if (!normals || !normals.every(isFiniteVec3)) {
      return this.emptyFrame('invalid-normal', substeps, droppedSeconds);
    }

    const snapshotPoints = this.points.map((point) => ({ ...point }));
    const controlPoints = new Float32Array(this.points.length * 6);
    for (let index = 0; index < snapshotPoints.length; index += 1) {
      const point = snapshotPoints[index];
      const normal = normals[index];
      const cursor = index * 6;
      controlPoints[cursor] = point.x;
      controlPoints[cursor + 1] = point.y;
      controlPoints[cursor + 2] = point.z;
      controlPoints[cursor + 3] = normal.x;
      controlPoints[cursor + 4] = normal.y;
      controlPoints[cursor + 5] = normal.z;
    }

    return {
      controlPoints,
      points: snapshotPoints,
      grabPoint: { ...this.actualPointer },
      substeps,
      droppedSeconds,
      pointAt: (column: number, row: number) => {
        const point = snapshotPoints[row * this.columns + column];
        return point ? { ...point } : ZERO_POINT;
      },
    };
  }

  private emptyFrame(
    invalidReason: InvalidFrameReason,
    substeps: number,
    droppedSeconds: number,
  ): PageTurnPhysicsFrame {
    return {
      controlPoints: new Float32Array(0),
      points: [],
      grabPoint: { ...this.actualPointer },
      substeps,
      droppedSeconds,
      invalidReason,
      pointAt: () => ZERO_POINT,
    };
  }

  private exceedsNormalizedDisplacement(): boolean {
    const pointerDeltaX = Math.abs(this.actualPointer.x - this.actualGrabPoint.x);
    const pointerDeltaY = Math.abs(this.actualPointer.y - this.actualGrabPoint.y);

    if (pointerDeltaX > MAX_NORMALIZED_DISPLACEMENT || pointerDeltaY > MAX_NORMALIZED_DISPLACEMENT) {
      return true;
    }

    return this.points.some((point, index) => {
      const rest = this.restPoints[index];
      return distance(point, { x: rest.x, y: rest.y, z: 0 }) > MAX_NORMALIZED_DISPLACEMENT;
    });
  }

  private hasPinnedSpine(): boolean {
    const spineColumn = this.direction === 'rtl' ? this.columns - 1 : 0;
    const expectedX = this.direction === 'rtl' ? 1 : 0;

    for (let row = 0; row < this.rows; row += 1) {
      const index = row * this.columns + spineColumn;
      const point = this.points[index];
      const rest = this.restPoints[index];

      if (!point) {
        return false;
      }

      if (Math.abs(point.x - expectedX) > 1e-6 || Math.abs(point.y - rest.y) > 1e-6 || Math.abs(point.z) > 1e-6) {
        return false;
      }
    }

    return true;
  }

  private toCanonical(point: Vec2): Vec2 {
    return this.direction === 'rtl'
      ? {
          x: 1 - point.x,
          y: point.y,
        }
      : {
          x: point.x,
          y: point.y,
        };
  }

  private fromCanonicalPoint(point: Vec3): Vec3 {
    return this.direction === 'rtl'
      ? {
          x: 1 - point.x,
          y: point.y,
          z: point.z,
        }
      : {
          x: point.x,
          y: point.y,
          z: point.z,
        };
  }
}

function createRestPoints(columns: number, rows: number): Vec2[] {
  const points: Vec2[] = [];

  for (let row = 0; row < rows; row += 1) {
    const y = rows === 1 ? 0 : row / (rows - 1);

    for (let column = 0; column < columns; column += 1) {
      const x = columns === 1 ? 0 : column / (columns - 1);
      points.push({ x, y });
    }
  }

  return points;
}

function cylinderPoint(rest: Vec2, pointer: Vec2, grabY: number): Vec3 {
  const progress = clamp(1 - pointer.x, 0, 1);
  const radius = Math.max(0.045, 0.22 * (1 - progress) + 0.055);
  const foldX = 1 - progress * 0.92;
  const distanceFromFold = Math.max(0, rest.x - foldX);
  const angle = Math.min(Math.PI * 1.94, distanceFromFold / radius);
  const diagonal = (rest.y - grabY) * progress * 0.18;

  if (distanceFromFold === 0) {
    return { x: rest.x, y: rest.y, z: 0 };
  }

  return {
    x: foldX + Math.sin(angle) * radius,
    y: rest.y + diagonal * Math.sin(angle),
    z: radius * (1 - Math.cos(angle)),
  };
}

function createNormals(points: readonly Vec3[], columns: number, rows: number): Vec3[] | undefined {
  const normals: Vec3[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const current = points[row * columns + column];
      const left = points[row * columns + Math.max(0, column - 1)] ?? current;
      const right = points[row * columns + Math.min(columns - 1, column + 1)] ?? current;
      const up = points[Math.max(0, row - 1) * columns + column] ?? current;
      const down = points[Math.min(rows - 1, row + 1) * columns + column] ?? current;

      const tangentX = subtract(right, left);
      const tangentY = subtract(down, up);
      const normal = normalize(cross(tangentX, tangentY));

      if (!normal) {
        return undefined;
      }

      normals.push(normal);
    }
  }

  return normals;
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize(vector: Vec3): Vec3 | undefined {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (!Number.isFinite(length) || length <= 1e-9) {
    return undefined;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function nearestRowIndex(y: number, rows: number): number {
  return clamp(Math.round(y * Math.max(rows - 1, 0)), 0, Math.max(rows - 1, 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isFiniteVec2(value: Vec2): boolean {
  return isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isFiniteVec3(value: Vec3): boolean {
  return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function isWithinNormalizedEnvelopeVec2(value: Vec2): boolean {
  return isWithinNormalizedEnvelopeNumber(value.x) && isWithinNormalizedEnvelopeNumber(value.y);
}

function isWithinNormalizedEnvelopeVec3(value: Vec3): boolean {
  return isWithinNormalizedEnvelopeNumber(value.x)
    && isWithinNormalizedEnvelopeNumber(value.y)
    && isWithinNormalizedEnvelopeNumber(value.z);
}

function isWithinNormalizedEnvelopeNumber(value: number): boolean {
  return value >= SAFE_NORMALIZED_MIN && value <= SAFE_NORMALIZED_MAX;
}
