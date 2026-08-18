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
  maxStretch: number;
  maxSpeed: number;
  settled?: 'commit' | 'cancel';
  invalidReason?: 'non-finite-input' | 'non-finite-output' | 'excessive-displacement' | 'invalid-normal' | 'unpinned-spine';
  pointAt(column: number, row: number): Vec3;
}

export interface PaperPhysicsSolverOptions {
  quality: RenderQuality;
  direction: ReadingDirection;
}

interface DistanceConstraint {
  left: number;
  right: number;
  restLength: number;
  measureStretch: boolean;
}

interface PointerConstraint {
  topIndex: number;
  bottomIndex: number;
  topWeight: number;
  bottomWeight: number;
  target: Vec3;
}

interface SettleState {
  outcome: 'commit' | 'cancel';
  pointer: Vec2;
  velocity: Vec2;
  target: Vec2;
  settledSteps: number;
  settled?: 'commit' | 'cancel';
}

const FIXED_STEP_SECONDS = 1 / 120;
const MAX_SUBSTEPS = 4;
const MAX_NORMALIZED_DISPLACEMENT = 2;
const SAFE_NORMALIZED_MIN = -MAX_NORMALIZED_DISPLACEMENT;
const SAFE_NORMALIZED_MAX = 1 + MAX_NORMALIZED_DISPLACEMENT;
const TARGET_STIFFNESS = 0.08;
const DISTANCE_STIFFNESS = 0.96;
const BEND_STIFFNESS = 0.34;
const VELOCITY_DAMPING = 0.86;
const SETTLE_OMEGA = 18;
const SETTLE_POSITION_EPSILON = 0.01;
const SETTLE_SPEED_EPSILON = 0.01;
const SETTLE_REQUIRED_STEPS = 6;
const ZERO_POINT = Object.freeze({ x: 0, y: 0, z: 0 });
type InvalidFrameReason = NonNullable<PageTurnPhysicsFrame['invalidReason']>;

export class PaperPhysicsSolver {
  private readonly columns: number;
  private readonly rows: number;
  private readonly direction: ReadingDirection;
  private readonly iterations: number;
  private readonly restPoints: readonly Vec2[];
  private readonly restPoints3: readonly Vec3[];
  private readonly distanceConstraints: readonly DistanceConstraint[];
  private readonly defaultGrabPoint: Vec2;
  private accumulator = 0;
  private actualGrabPoint: Vec2;
  private actualPointer: Vec2;
  private points: Vec3[];
  private previousPoints: Vec3[];
  private pendingInvalidReason?: InvalidFrameReason;
  private settleState?: SettleState;

  constructor(options: PaperPhysicsSolverOptions) {
    const topology = QUALITY_TOPOLOGY[options.quality];
    this.columns = topology.controlColumns;
    this.rows = topology.controlRows;
    this.direction = options.direction;
    this.iterations = topology.iterations;
    this.restPoints = createRestPoints(this.columns, this.rows);
    this.restPoints3 = this.restPoints.map((point) => ({ x: point.x, y: point.y, z: 0 }));
    this.distanceConstraints = createDistanceConstraints(this.restPoints, this.columns, this.rows);
    this.defaultGrabPoint = options.direction === 'rtl' ? { x: 0, y: 0.5 } : { x: 1, y: 0.5 };
    this.actualGrabPoint = { ...this.defaultGrabPoint };
    this.actualPointer = { ...this.defaultGrabPoint };
    this.points = this.restPoints3.map((point) => ({ ...point }));
    this.previousPoints = this.restPoints3.map((point) => ({ ...point }));
  }

  begin(grabPoint: Vec2): this {
    this.accumulator = 0;
    this.points = this.restPoints3.map((point) => ({ ...point }));
    this.previousPoints = this.restPoints3.map((point) => ({ ...point }));
    this.settleState = undefined;

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

  settle(outcome: 'commit' | 'cancel'): this {
    if (this.pendingInvalidReason) {
      return this;
    }

    const canonicalGrab = this.toCanonical(this.actualGrabPoint);
    const canonicalPointer = this.toCanonical(this.actualPointer);
    this.settleState = {
      outcome,
      pointer: { ...canonicalPointer },
      velocity: { x: 0, y: 0 },
      target: outcome === 'commit'
        ? { x: -1, y: canonicalGrab.y }
        : { x: canonicalGrab.x, y: canonicalGrab.y },
      settledSteps: 0,
    };
    return this;
  }

  snapshot(): PageTurnPhysicsFrame {
    if (this.pendingInvalidReason) {
      return this.emptyFrame(this.pendingInvalidReason, 0, 0);
    }

    return this.buildFrame(0, 0);
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
      this.settleState = undefined;
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

    return this.buildFrame(steps, droppedSeconds);
  }

  private integrate(): void {
    if (this.settleState?.settled) {
      this.actualPointer = this.fromCanonicalVec2(this.settleState.target);
      return;
    }

    const canonicalGrab = this.toCanonical(this.actualGrabPoint);
    const canonicalPointer = this.advancePointer(FIXED_STEP_SECONDS);
    const analyticTargets = this.restPoints.map((restPoint) => cylinderPoint(restPoint, canonicalPointer, canonicalGrab.y));
    const pointerConstraint = this.settleState
      ? undefined
      : createPointerConstraint(
          this.columns,
          this.rows,
          canonicalGrab.y,
          {
            x: canonicalPointer.x,
            y: canonicalPointer.y,
            z: cylinderPoint({ x: 1, y: canonicalGrab.y }, canonicalPointer, canonicalGrab.y).z,
          },
        );
    const predicted = this.points.map((point, index) => {
      if (isPinnedIndex(index, this.columns)) {
        return { ...this.restPoints3[index] };
      }

      const target = analyticTargets[index];
      const velocity = scale(subtract(point, this.previousPoints[index]), 1);
      return add(point, add(scale(velocity, 1), scale(subtract(target, point), TARGET_STIFFNESS)));
    });

    for (let iteration = 0; iteration < this.iterations; iteration += 1) {
      solvePinnedSpine(predicted, this.restPoints3, this.columns, this.rows);
      solveDistanceConstraints(predicted, this.distanceConstraints, DISTANCE_STIFFNESS, this.columns);
      solveDistanceConstraints(predicted, this.distanceConstraints, DISTANCE_STIFFNESS, this.columns);
      solveDistanceConstraints(predicted, this.distanceConstraints, DISTANCE_STIFFNESS, this.columns);
      solveBendConstraints(predicted, analyticTargets, BEND_STIFFNESS, this.columns);
      solvePagePlaneCollision(predicted, 0);
      solveSpineBoundary(predicted, 0);

      if (pointerConstraint) {
        solvePointerConstraint(predicted, pointerConstraint);
        solvePagePlaneCollision(predicted, 0);
        solveSpineBoundary(predicted, 0);
      }
    }

    solvePinnedSpine(predicted, this.restPoints3, this.columns, this.rows);
    solvePagePlaneCollision(predicted, 0);
    solveSpineBoundary(predicted, 0);

    if (pointerConstraint) {
      solvePointerConstraint(predicted, pointerConstraint);
      solvePagePlaneCollision(predicted, 0);
      solveSpineBoundary(predicted, 0);
    }

    const currentPoints = this.points.map((point) => ({ ...point }));
    this.points = predicted;
    this.previousPoints = predicted.map((point, index) => {
      if (isPinnedIndex(index, this.columns)) {
        return { ...this.restPoints3[index] };
      }

      const velocity = scale(subtract(point, currentPoints[index]), VELOCITY_DAMPING);
      return subtract(point, velocity);
    });

    this.actualPointer = this.fromCanonicalVec2(canonicalPointer);
    this.updateSettleState(canonicalPointer);
  }

  private buildFrame(substeps: number, droppedSeconds: number): PageTurnPhysicsFrame {
    if (this.exceedsNormalizedDisplacement()) {
      return this.emptyFrame('excessive-displacement', substeps, droppedSeconds);
    }

    if (!this.hasPinnedSpine()) {
      return this.emptyFrame('unpinned-spine', substeps, droppedSeconds);
    }

    if (!this.points.every(isFiniteVec3) || !this.previousPoints.every(isFiniteVec3)) {
      return this.emptyFrame('non-finite-output', substeps, droppedSeconds);
    }

    if (!this.points.every(isWithinNormalizedEnvelopeVec3Actual.bind(undefined, this.direction))) {
      return this.emptyFrame('excessive-displacement', substeps, droppedSeconds);
    }

    const normals = createNormals(this.points, this.columns, this.rows);
    if (!normals || !normals.every(isFiniteVec3)) {
      return this.emptyFrame('invalid-normal', substeps, droppedSeconds);
    }

    const snapshotPoints = mapActualPoints(this.points, this.columns, this.rows, this.direction);
    const snapshotNormals = mapActualNormals(normals, this.columns, this.rows, this.direction);
    const controlPoints = new Float32Array(this.points.length * 6);
    for (let index = 0; index < snapshotPoints.length; index += 1) {
      const point = snapshotPoints[index];
      const normal = snapshotNormals[index];
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
      maxStretch: this.maxStretch(),
      maxSpeed: this.maxSpeed(),
      settled: this.settleState?.settled,
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
      maxStretch: 0,
      maxSpeed: 0,
      invalidReason,
      pointAt: () => ZERO_POINT,
    };
  }

  private maxStretch(): number {
    return this.distanceConstraints.reduce((maximum, constraint) => {
      if (!constraint.measureStretch) {
        return maximum;
      }

      const left = this.points[constraint.left];
      const right = this.points[constraint.right];
      const stretch = distanceXZ(left, right) / constraint.restLength - 1;
      return Math.max(maximum, stretch);
    }, 0);
  }

  private maxSpeed(): number {
    return this.points.reduce((maximum, point, index) => {
      if (isPinnedIndex(index, this.columns)) {
        return maximum;
      }

      const speed = distance(point, this.previousPoints[index]) / FIXED_STEP_SECONDS;
      return Math.max(maximum, speed);
    }, 0);
  }

  private updateSettleState(pointer: Vec2): void {
    if (!this.settleState) {
      return;
    }

    const error = Math.hypot(pointer.x - this.settleState.target.x, pointer.y - this.settleState.target.y);
    const speed = this.maxSpeed();
    const withinTolerance = error <= SETTLE_POSITION_EPSILON && speed <= SETTLE_SPEED_EPSILON;

    this.settleState.settledSteps = withinTolerance
      ? this.settleState.settledSteps + 1
      : 0;

    if (this.settleState.settledSteps >= SETTLE_REQUIRED_STEPS) {
      this.settleState.settled = this.settleState.outcome;
      this.settleState.pointer = { ...this.settleState.target };
      this.settleState.velocity = { x: 0, y: 0 };
      this.actualPointer = this.fromCanonicalVec2(this.settleState.target);
    }
  }

  private advancePointer(deltaSeconds: number): Vec2 {
    if (!this.settleState) {
      return this.toCanonical(this.actualPointer);
    }

    const nextX = criticallyDampedStep(
      this.settleState.pointer.x,
      this.settleState.velocity.x,
      this.settleState.target.x,
      deltaSeconds,
      SETTLE_OMEGA,
    );
    const nextY = criticallyDampedStep(
      this.settleState.pointer.y,
      this.settleState.velocity.y,
      this.settleState.target.y,
      deltaSeconds,
      SETTLE_OMEGA,
    );

    this.settleState.pointer = { x: nextX.position, y: nextY.position };
    this.settleState.velocity = { x: nextX.velocity, y: nextY.velocity };
    return this.settleState.pointer;
  }

  private exceedsNormalizedDisplacement(): boolean {
    const pointerDeltaX = Math.abs(this.actualPointer.x - this.actualGrabPoint.x);
    const pointerDeltaY = Math.abs(this.actualPointer.y - this.actualGrabPoint.y);

    if (pointerDeltaX > MAX_NORMALIZED_DISPLACEMENT || pointerDeltaY > MAX_NORMALIZED_DISPLACEMENT) {
      return true;
    }

    return this.points.some((point, index) => {
      const rest = this.restPoints3[index];
      return distance(point, rest) > MAX_NORMALIZED_DISPLACEMENT;
    });
  }

  private hasPinnedSpine(): boolean {
    for (let row = 0; row < this.rows; row += 1) {
      const index = row * this.columns;
      const point = this.points[index];
      const rest = this.restPoints3[index];

      if (!point) {
        return false;
      }

      if (Math.abs(point.x - rest.x) > 1e-6 || Math.abs(point.y - rest.y) > 1e-6 || Math.abs(point.z - rest.z) > 1e-6) {
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

  private fromCanonicalVec2(point: Vec2): Vec2 {
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

function createDistanceConstraints(restPoints: readonly Vec2[], columns: number, rows: number): DistanceConstraint[] {
  const constraints: DistanceConstraint[] = [];
  const addConstraint = (left: number, right: number) => {
    constraints.push({
      left,
      right,
      restLength: distance(restPoints[left], restPoints[right]),
      measureStretch: false,
    });
  };

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;

      if (column + 1 < columns) {
        addConstraint(index, index + 1);
        constraints[constraints.length - 1].measureStretch = true;
      }

      if (row + 1 < rows) {
        addConstraint(index, index + columns);
      }

      if (column + 1 < columns && row + 1 < rows) {
        addConstraint(index, index + columns + 1);
      }

      if (column > 0 && row + 1 < rows) {
        addConstraint(index, index + columns - 1);
      }
    }
  }

  return constraints;
}

function createPointerConstraint(columns: number, rows: number, grabY: number, target: Vec3): PointerConstraint {
  const normalizedRow = clamp(grabY * Math.max(rows - 1, 0), 0, Math.max(rows - 1, 0));
  const topRow = Math.floor(normalizedRow);
  const bottomRow = Math.min(rows - 1, topRow + 1);
  const blend = bottomRow === topRow ? 0 : normalizedRow - topRow;
  const topIndex = topRow * columns + (columns - 1);
  const bottomIndex = bottomRow * columns + (columns - 1);
  const denominator = (1 - blend) ** 2 + blend ** 2;

  return {
    topIndex,
    bottomIndex,
    topWeight: denominator <= 1e-9 ? 1 : (1 - blend) / denominator,
    bottomWeight: denominator <= 1e-9 ? 0 : blend / denominator,
    target,
  };
}

function solvePinnedSpine(points: Vec3[], restPoints: readonly Vec3[], columns: number, rows: number): void {
  for (let row = 0; row < rows; row += 1) {
    const index = row * columns;
    points[index] = { ...restPoints[index] };
  }
}

function solvePointerConstraint(points: Vec3[], constraint: PointerConstraint): void {
  if (constraint.topIndex === constraint.bottomIndex) {
    points[constraint.topIndex] = { ...constraint.target };
    return;
  }

  const current = lerpPoint(points[constraint.topIndex], points[constraint.bottomIndex], constraint.bottomWeight / (constraint.topWeight + constraint.bottomWeight));
  const correction = subtract(constraint.target, current);
  points[constraint.topIndex] = add(points[constraint.topIndex], scale(correction, constraint.topWeight));
  points[constraint.bottomIndex] = add(points[constraint.bottomIndex], scale(correction, constraint.bottomWeight));
}

function solveDistanceConstraints(
  points: Vec3[],
  constraints: readonly DistanceConstraint[],
  stiffness: number,
  columns: number,
): void {
  for (const constraint of constraints) {
    const leftPinned = isPinnedIndex(constraint.left, columns);
    const rightPinned = isPinnedIndex(constraint.right, columns);
    const left = points[constraint.left];
    const right = points[constraint.right];
    const delta = subtract(right, left);
    const currentLength = Math.hypot(delta.x, delta.y, delta.z);

    if (!Number.isFinite(currentLength) || currentLength <= 1e-9) {
      continue;
    }

    const correctionScale = ((currentLength - constraint.restLength) / currentLength) * stiffness;
    const correction = scale(delta, correctionScale);

    if (leftPinned && rightPinned) {
      continue;
    }

    if (leftPinned) {
      points[constraint.right] = subtract(right, correction);
      continue;
    }

    if (rightPinned) {
      points[constraint.left] = add(left, correction);
      continue;
    }

    points[constraint.left] = add(left, scale(correction, 0.5));
    points[constraint.right] = subtract(right, scale(correction, 0.5));
  }
}

function solveBendConstraints(points: Vec3[], targets: readonly Vec3[], stiffness: number, columns: number): void {
  for (let index = 0; index < points.length; index += 1) {
    if (isPinnedIndex(index, columns)) {
      continue;
    }

    points[index] = add(points[index], scale(subtract(targets[index], points[index]), stiffness));
  }
}

function solvePagePlaneCollision(points: Vec3[], planeZ: number): void {
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].z < planeZ) {
      points[index] = {
        x: points[index].x,
        y: points[index].y,
        z: planeZ,
      };
    }
  }
}

function solveSpineBoundary(points: Vec3[], spineX: number): void {
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].x < spineX) {
      points[index] = {
        x: spineX,
        y: points[index].y,
        z: points[index].z,
      };
    }
  }
}

function cylinderPoint(rest: Vec2, pointer: Vec2, grabY: number): Vec3 {
  const progress = clamp(1 - pointer.x, 0, 2);
  const radius = Math.max(0.05, 0.22 * (1 - Math.min(progress, 1)) + 0.055);
  const foldX = 1 - progress * 0.92;
  const distanceFromFold = Math.max(0, rest.x - foldX);
  const angle = Math.min(Math.PI * 1.96, distanceFromFold / radius);
  const diagonal = (rest.y - grabY) * Math.min(progress, 1) * 0.18;
  const grabBias = clamp((0.5 - grabY) * 2, -1, 1);
  const rowBias = clamp((rest.y - 0.5) * 2, -1, 1);
  const torsion = grabBias * rowBias * Math.min(progress, 1.25) * clamp(rest.x, 0, 1) * 0.12;

  if (distanceFromFold === 0) {
    return { x: rest.x, y: rest.y, z: 0 };
  }

  return {
    x: foldX + Math.sin(angle) * radius,
    y: rest.y + diagonal * Math.sin(angle) + torsion * 0.08,
    z: radius * (1 - Math.cos(angle)) + torsion,
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

function mapActualPoints(points: readonly Vec3[], columns: number, rows: number, direction: ReadingDirection): Vec3[] {
  const mapped: Vec3[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const canonicalColumn = direction === 'rtl' ? columns - 1 - column : column;
      const point = points[row * columns + canonicalColumn];
      mapped.push(direction === 'rtl'
        ? { x: 1 - point.x, y: point.y, z: point.z }
        : { ...point });
    }
  }

  return mapped;
}

function mapActualNormals(normals: readonly Vec3[], columns: number, rows: number, direction: ReadingDirection): Vec3[] {
  const mapped: Vec3[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const canonicalColumn = direction === 'rtl' ? columns - 1 - column : column;
      const normal = normals[row * columns + canonicalColumn];
      mapped.push(direction === 'rtl'
        ? { x: -normal.x, y: normal.y, z: normal.z }
        : { ...normal });
    }
  }

  return mapped;
}

function criticallyDampedStep(position: number, velocity: number, target: number, deltaSeconds: number, omega: number) {
  const acceleration = (target - position) * omega * omega - 2 * omega * velocity;
  const nextVelocity = velocity + acceleration * deltaSeconds;
  const nextPosition = position + nextVelocity * deltaSeconds;

  return {
    position: nextPosition,
    velocity: nextVelocity,
  };
}

function lerpPoint(left: Vec3, right: Vec3, amount: number): Vec3 {
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    z: left.z + (right.z - left.z) * amount,
  };
}

function add(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scale(value: Vec3, factor: number): Vec3 {
  return {
    x: value.x * factor,
    y: value.y * factor,
    z: value.z * factor,
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

function distance(left: Vec2 | Vec3, right: Vec2 | Vec3): number {
  const leftZ = 'z' in left ? left.z : 0;
  const rightZ = 'z' in right ? right.z : 0;
  return Math.hypot(left.x - right.x, left.y - right.y, leftZ - rightZ);
}

function distanceXZ(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
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

function isWithinNormalizedEnvelopeVec3Actual(direction: ReadingDirection, value: Vec3): boolean {
  const actual = direction === 'rtl'
    ? { x: 1 - value.x, y: value.y, z: value.z }
    : value;

  return isWithinNormalizedEnvelopeNumber(actual.x)
    && isWithinNormalizedEnvelopeNumber(actual.y)
    && isWithinNormalizedEnvelopeNumber(actual.z);
}

function isWithinNormalizedEnvelopeNumber(value: number): boolean {
  return value >= SAFE_NORMALIZED_MIN && value <= SAFE_NORMALIZED_MAX;
}

function isPinnedIndex(index: number, columns: number): boolean {
  return index % columns === 0;
}
