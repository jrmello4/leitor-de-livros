# Physical Page Curl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat CSS page turn with a pointer-driven, source-agnostic physical page curl that exposes the correct front, verso, and under-page surfaces while remaining smooth on WebGL2-class hardware.

**Architecture:** Keep the existing DOM/`ReaderSurface` path authoritative while idle, and mount a separate decorative `PageTurnSurface` only for an active turn. A pure controller owns state and navigation, a pure scene mapper assigns page textures, a deterministic CPU solver produces a small control lattice, and WebGL2/WebGPU adapters render the same versioned mesh contract. Unsupported, reduced-motion, texture-failure, and minimum-performance paths perform immediate navigation rather than substituting another animation.

**Tech Stack:** React 19, TypeScript 5, Vitest, Testing Library, WebGL2, WebGPU, WGSL/GLSL ES 3.00, Playwright, Vite, Tauri 2.

## Global Constraints

- Read `docs/superpowers/specs/2026-08-14-physical-page-curl-design.md` before each task and do not weaken its acceptance criteria.
- Do not modify import, PDFium, archive extraction, persistence, cache metadata, bookmarks, progress, or source files.
- The renderer consumes only decoded `PageDescriptor.src` image URIs; PDF, CBZ, CBR, image-folder, and demo publications share one rendering path.
- The activation band is `clamp(28px, 8% of transformed page width, 72px)` along the full visible outer edge; the spine is never a handle.
- Commit at displacement `>= 0.45`, or velocity toward destination `>= 0.65` page widths/second with displacement `>= 0.12`; otherwise cancel.
- Use a fixed `1/120` second physics step, at most four substeps per rendered frame, and drop excess accumulated time.
- Texture preparation may remain in `preparing` for less than 150 ms; longer waits use the existing loading/diagnostic UI and never show a partial curl.
- Cap the default texture longest side at 4096 pixels and retain at most six page-turn textures.
- Keep lighting luminance within `0.72..1.08`.
- Quality tiers start at rich `9x7 / 48x32 / 6`, balanced `7x5 / 32x24 / 4`, and essential `5x4 / 20x14 / 3` for control lattice, visual mesh, and solver iterations.
- If essential quality has interaction frame-time p95 above 32 ms over 20 frames, disable physical turns for the remainder of the reader session.
- A quality tier may recover only after five seconds of stable idle telemetry; do not change tier during a drag unless the critical budget is exceeded.
- Reduced motion performs an immediate page change with no curl, hover lift, fade, slide, or decorative transition.
- If neither GPU backend can sustain the minimum physical effect, perform immediate navigation; do not add a CSS animation fallback.
- Paper stiffness and quality are automatic runtime decisions; do not add user-facing material, mesh, solver, or backend settings.
- A turn may navigate exactly once and only after a committed settle reaches its terminal pose.
- Run `npm.cmd test -- --reporter=dot` and `npm.cmd run build` before the final visual/performance task is committed.

---

## File and Responsibility Map

### Domain and controller

- Create `src/domain/pageTurnTypes.ts`: shared normalized vectors, closed state union, events, effects, scene types, and constants.
- Replace `src/domain/pageTurn.ts`: pure transition/release logic plus `PageTurnController`; remove the duration-based CSS decision contract.
- Replace `src/domain/pageTurn.test.ts`: transition table, thresholds, stale generations, one-latest-request serialization, and exactly-once navigation.
- Create `src/domain/pageTurnScene.ts` and `src/domain/pageTurnScene.test.ts`: pure front/verso/under/stationary texture mapping for single/spread, LTR/RTL, forward/backward, and boundaries.
- Create `src/domain/pageTurnGeometry.ts` and `src/domain/pageTurnGeometry.test.ts`: transformed hit testing, client-to-page coordinates, visible outer-edge band, and release velocity sampling.

### Physics and rendering

- Create `src/rendering/pageTurn/physics.ts` and `physics.test.ts`: analytic cylinder, fixed-step accumulator, PBD constraints, settling, finite guards, and mirrored equivalence.
- Create `src/rendering/pageTurn/mesh.ts` and `mesh.test.ts`: versioned control-point/visual-mesh layout, front/verso UVs, triangle winding, and quality topology.
- Create `src/rendering/pageTurn/textures.ts` and `textures.test.ts`: generation-safe decode/upload preparation, 150 ms readiness signal, size cap, six-entry LRU, and disposal.
- Create `src/rendering/pageTurn/contracts.ts`: the common backend contract and render-frame uniforms consumed by both GPU implementations.
- Create `src/rendering/pageTurn/webgl2.ts`, `webgl2.test.ts`, `webgl2Shaders.ts`: WebGL2 lifecycle, reusable buffers, front/back sampling, crease lighting, and projected shadow.
- Create `src/rendering/pageTurn/webgpu.ts`, `webgpu.test.ts`, `webgpuShaders.ts`: the same contract in WebGPU, including device-loss reporting.
- Create `src/rendering/pageTurn/PageTurnSurface.tsx` and `PageTurnSurface.test.tsx`: backend selection, texture/solver/render loop, cancellation, diagnostics, and decorative canvas lifecycle.

### Reader integration, quality, and evidence

- Create `src/app/usePageTurn.ts` and `usePageTurn.test.tsx`: React bridge for pointer capture, synthetic trajectories, interruption, and navigation acknowledgement.
- Create `src/app/ReaderView.test.tsx`: component-level edge, zoom/pan, automatic input, reduced-motion, texture-error, and source-format contracts.
- Modify `src/app/ReaderView.tsx`: replace local timer/progress logic with `usePageTurn` and mount `PageTurnSurface`.
- Modify `src/rendering/ReaderSurface.tsx` and create `src/rendering/ReaderSurface.test.tsx`: keep idle DOM pages semantic while the existing decorative idle GPU canvas is visible.
- Modify `src/app/styles.css`: add clipped overlay/edge affordance styles and remove `.curl-layer`, `.curl-glint`, and page-enter animation after WebGL2 parity.
- Extend `src/rendering/telemetry.ts` and `telemetry.test.ts`: interaction p95, hysteresis, session disable, dropped-time, texture, and latency metrics.
- Modify `tests/visual/visual-matrix.ts`, `visual-matrix.test.ts`, and `reader-matrix.spec.ts`: physical checkpoints and failure gates based on rendered geometry.
- Extend `scripts/performance/performance-contract.test.mjs`, `performance-smoke.mjs`, and `docs/performance/reference-hardware.md`: page-turn evidence and 50-turn cleanup.

---

### Task 1: Closed Page-Turn Controller

**Files:**
- Create: `src/domain/pageTurnTypes.ts`
- Modify: `src/domain/pageTurn.ts`
- Test: `src/domain/pageTurn.test.ts`

**Interfaces:**
- Produces: `Vec2`, `TurnDirection`, `PageTurnState`, `PageTurnEvent`, `PageTurnEffect`, `PAGE_TURN_THRESHOLDS`, `releaseOutcome()`, `transitionPageTurn()`, and `PageTurnController`.
- Navigation effect: `{ type: 'navigate'; direction: TurnDirection; generation: number }`; only `finish-settle` from a committing state may produce it.

- [ ] **Step 1: Replace the old duration tests with controller RED tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { PageTurnController, releaseOutcome } from './pageTurn';

describe('releaseOutcome', () => {
  it.each([
    [0.45, 0, 'commit'],
    [0.12, 0.65, 'commit'],
    [0.119, 2, 'cancel'],
    [0.449, 0.649, 'cancel'],
  ] as const)('uses displacement=%s and velocity=%s', (displacement, velocity, expected) => {
    expect(releaseOutcome(displacement, velocity)).toBe(expected);
  });
});

it('navigates once only after committed settling finishes', () => {
  const navigate = vi.fn();
  const controller = new PageTurnController({ navigate });
  const generation = controller.request('forward', false);
  controller.texturesReady(generation);
  controller.beginPointer(generation, 7, { x: 1, y: 0.5 }, 0);
  controller.movePointer(7, { x: 0.4, y: 0.5 }, 16);
  controller.releasePointer(7, 20);
  expect(navigate).not.toHaveBeenCalled();
  controller.finishSettle(generation);
  controller.finishSettle(generation);
  expect(navigate).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test -- src/domain/pageTurn.test.ts`

Expected: FAIL because `PageTurnController` and `releaseOutcome` are not exported.

- [ ] **Step 3: Add the closed union, constants, reducer, and controller**

```ts
export const PAGE_TURN_THRESHOLDS = {
  displacement: 0.45,
  flingVelocity: 0.65,
  minimumFlingDisplacement: 0.12,
} as const;

export type PageTurnState =
  | { phase: 'idle'; queued?: TurnDirection }
  | { phase: 'preparing'; generation: number; direction: TurnDirection }
  | { phase: 'dragging'; generation: number; direction: TurnDirection; pointerId: number; grab: Vec2; point: Vec2; velocity: Vec2 }
  | { phase: 'settling'; generation: number; direction: TurnDirection; outcome: 'commit' | 'cancel' }
  | { phase: 'committed'; generation: number; direction: TurnDirection; navigated: boolean }
  | { phase: 'disabled'; reason: 'reduced-motion' | 'backend' | 'performance' | 'texture' };

export type PageTurnEvent =
  | { type: 'request'; direction: TurnDirection; generation: number }
  | { type: 'textures-ready'; generation: number }
  | { type: 'pointer-down'; generation: number; pointerId: number; grab: Vec2; at: number }
  | { type: 'pointer-move'; pointerId: number; point: Vec2; velocity: Vec2 }
  | { type: 'pointer-up'; pointerId: number; displacement: number; velocityTowardDestination: number }
  | { type: 'finish-settle'; generation: number }
  | { type: 'navigation-ack'; generation: number }
  | { type: 'cancel'; reason: 'resize' | 'fullscreen' | 'profile' | 'publication' | 'hidden' | 'unmount' | 'backend' | 'solver' }
  | { type: 'disable'; reason: 'reduced-motion' | 'backend' | 'performance' | 'texture' };

export type PageTurnEffect =
  | { type: 'navigate'; direction: TurnDirection; generation: number }
  | { type: 'release-pointer'; pointerId: number }
  | { type: 'prepare'; direction: TurnDirection; generation: number };

export function releaseOutcome(displacement: number, velocity: number): 'commit' | 'cancel' {
  return displacement >= PAGE_TURN_THRESHOLDS.displacement
    || (displacement >= PAGE_TURN_THRESHOLDS.minimumFlingDisplacement
      && velocity >= PAGE_TURN_THRESHOLDS.flingVelocity)
    ? 'commit'
    : 'cancel';
}
```

Implement `transitionPageTurn(state, event)` as an exhaustive `switch` returning `{ state, effects }`. `PageTurnController` stores the state/generation, delegates every method to that reducer, emits effects once, ignores stale generations and second pointers, and retains only the latest queued direction while active. `request(direction, true)` emits immediate navigation without entering an animated state.

- [ ] **Step 4: Add stale-generation, cancellation, disabled, boundary, and queued-request assertions**

```ts
it('rejects a stale texture generation and keeps only the latest queued turn', () => {
  const controller = new PageTurnController({ navigate: vi.fn() });
  const first = controller.request('forward', false);
  controller.request('backward', false);
  controller.request('forward', false);
  controller.texturesReady(first + 1);
  expect(controller.snapshot().phase).toBe('preparing');
  controller.cancel('publication-change');
  expect(controller.snapshot()).toMatchObject({ phase: 'preparing', direction: 'forward' });
});
```

- [ ] **Step 5: Run GREEN and commit**

Run: `npm.cmd test -- src/domain/pageTurn.test.ts`

Expected: PASS.

```powershell
git add src/domain/pageTurn.ts src/domain/pageTurnTypes.ts src/domain/pageTurn.test.ts
git commit -m "feat: add physical page turn controller"
```

---

### Task 2: Source-Independent Page-Turn Scene

**Files:**
- Create: `src/domain/pageTurnScene.ts`
- Test: `src/domain/pageTurnScene.test.ts`

**Interfaces:**
- Consumes: `TurnDirection` from `src/domain/pageTurnTypes.ts`; `PageDescriptor`, `ReadingDirection`, and `ReadingMode` from `src/domain/types.ts`.
- Produces: `buildPageTurnScene(input): PageTurnScene | undefined`, where `PageTurnScene` contains `stationary`, `turningFront`, `turningVerso`, `under`, `committed`, and `generationKey`.

- [ ] **Step 1: Write a table-driven scene RED test**

```ts
const pages = Array.from({ length: 6 }, (_, index) => ({
  id: `p${index}`, index, name: `Page ${index + 1}`, src: `asset://p${index}.png`, width: 800, height: 1200,
}));

it.each([
  ['single', 'ltr', 'forward', 1, ['p1', 'p2', 'p3']],
  ['single', 'rtl', 'forward', 1, ['p1', 'p2', 'p3']],
  ['single', 'ltr', 'backward', 2, ['p2', 'p1', 'p0']],
] as const)('maps %s %s %s', (mode, readingDirection, turnDirection, currentIndex, ids) => {
  const scene = buildPageTurnScene({ pages, currentIndex, mode, readingDirection, turnDirection });
  expect([scene?.turningFront.id, scene?.turningVerso?.id, scene?.under?.id]).toEqual(ids);
});
```

- [ ] **Step 2: Run the scene test and confirm RED**

Run: `npm.cmd test -- src/domain/pageTurnScene.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement semantic mapping without publication-format branches**

```ts
export interface PageTurnSceneInput {
  pages: PageDescriptor[];
  currentIndex: number;
  mode: ReadingMode;
  readingDirection: ReadingDirection;
  turnDirection: TurnDirection;
}

export interface PageTurnScene {
  stationary: PageDescriptor[];
  turningFront: PageDescriptor;
  turningVerso: PageDescriptor;
  under?: PageDescriptor;
  committed: PageDescriptor[];
  versoUv: 'back-face-readable';
  generationKey: string;
}

export function buildPageTurnScene(input: PageTurnSceneInput): PageTurnScene | undefined {
  const step = input.turnDirection === 'forward' ? 1 : -1;
  const front = input.pages[input.currentIndex];
  const verso = input.pages[input.currentIndex + step];
  if (!front || !verso) return undefined;
  const under = input.pages[input.currentIndex + step * 2];
  const committedIndex = input.currentIndex + step;
  const visibleAt = (index: number) => visiblePageIndexes(index, input.pages, input.mode, input.readingDirection)
    .map((pageIndex) => input.pages[pageIndex])
    .filter((page): page is PageDescriptor => Boolean(page));
  return {
    stationary: visibleAt(input.currentIndex).filter((page) => page.id !== front.id),
    turningFront: front,
    turningVerso: verso,
    under,
    committed: visibleAt(committedIndex),
    versoUv: 'back-face-readable',
    generationKey: `${front.id}:${verso.id}:${under?.id ?? 'paper'}:${input.mode}:${input.readingDirection}`,
  };
}
```

Use `visiblePageIndexes()` from `src/domain/reader.ts` for stationary and committed spreads. Missing boundary `under` remains `undefined`, which the renderer maps to paper/background; never duplicate a page.

- [ ] **Step 4: Lock spread, odd-count, first/last, UV, and arbitrary URI behavior**

```ts
it('keeps source handling outside the scene mapper', () => {
  for (const src of ['asset://pdf/page.png', 'asset://cbz/page.png', 'asset://cbr/page.png', 'asset://images/page.png']) {
    const sourcePages = pages.map((page, index) => ({ ...page, src: `${src}?i=${index}` }));
    expect(buildPageTurnScene({ pages: sourcePages, currentIndex: 1, mode: 'single', readingDirection: 'ltr', turnDirection: 'forward' })?.turningVerso.src)
      .toBe(`${src}?i=2`);
  }
});
```

- [ ] **Step 5: Run GREEN and commit**

Run: `npm.cmd test -- src/domain/pageTurnScene.test.ts src/domain/reader.test.ts`

Expected: PASS.

```powershell
git add src/domain/pageTurnScene.ts src/domain/pageTurnScene.test.ts
git commit -m "feat: map physical page turn surfaces"
```

---

### Task 3: Transformed Edge Hit Testing and Release Velocity

**Files:**
- Create: `src/domain/pageTurnGeometry.ts`
- Test: `src/domain/pageTurnGeometry.test.ts`

**Interfaces:**
- Consumes: `Vec2` and `ReadingDirection`.
- Produces: `activationBandWidth()`, `clientToPagePoint()`, `isVisibleOuterEdgeHit()`, `VelocityTracker`, and `turnDisplacement()`.

- [ ] **Step 1: Write RED tests for the complete outer edge and transformed coordinates**

```ts
it('accepts top, middle, and bottom of the visible LTR outer edge', () => {
  const geometry = { left: 100, top: 40, width: 500, height: 700, clipLeft: 120, clipRight: 600 };
  for (const y of [40, 390, 740]) {
    expect(isVisibleOuterEdgeHit({ x: 598, y }, geometry, 'ltr')).toBe(true);
  }
  expect(isVisibleOuterEdgeHit({ x: 102, y: 390 }, geometry, 'ltr')).toBe(false);
});

it('inverts zoom and pan before normalizing', () => {
  expect(clientToPagePoint({ x: 450, y: 350 }, { left: 100, top: 50, width: 400, height: 600 }, { scale: 2, panX: 50, panY: 0 }))
    .toEqual({ x: 0.375, y: 0.25 });
});
```

- [ ] **Step 2: Run the geometry test and confirm RED**

Run: `npm.cmd test -- src/domain/pageTurnGeometry.test.ts`

Expected: FAIL because the geometry module does not exist.

- [ ] **Step 3: Implement clamped activation and a short velocity window**

```ts
export function activationBandWidth(pageWidth: number): number {
  return Math.min(72, Math.max(28, pageWidth * 0.08));
}

export class VelocityTracker {
  private samples: Array<{ point: Vec2; at: number }> = [];
  push(point: Vec2, at: number): void {
    this.samples.push({ point, at });
    this.samples = this.samples.filter((sample) => at - sample.at <= 80).slice(-6);
  }
  velocity(): Vec2 {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    const seconds = first && last ? (last.at - first.at) / 1000 : 0;
    return !first || !last || seconds <= 0 ? { x: 0, y: 0 } : { x: (last.point.x - first.point.x) / seconds, y: (last.point.y - first.point.y) / seconds };
  }
}
```

`isVisibleOuterEdgeHit()` must intersect the transformed page rect with the clipped stage rect, mirror the outer edge for RTL, accept the inclusive page height, and reject controls/Adaptive Flow before this helper is called. `turnDisplacement()` returns a positive page-width fraction toward the requested destination.

- [ ] **Step 4: Add exact band, clipped edge, RTL mirror, zero-time velocity, and velocity-direction tests**

```ts
expect(activationBandWidth(100)).toBe(28);
expect(activationBandWidth(500)).toBe(40);
expect(activationBandWidth(2000)).toBe(72);
```

- [ ] **Step 5: Run GREEN and commit**

Run: `npm.cmd test -- src/domain/pageTurnGeometry.test.ts`

Expected: PASS.

```powershell
git add src/domain/pageTurnGeometry.ts src/domain/pageTurnGeometry.test.ts
git commit -m "feat: add page edge interaction geometry"
```

---

### Task 4: Versioned Mesh and Analytic Cylinder

**Files:**
- Create: `src/rendering/pageTurn/mesh.ts`
- Create: `src/rendering/pageTurn/physics.ts`
- Test: `src/rendering/pageTurn/mesh.test.ts`
- Test: `src/rendering/pageTurn/physics.test.ts`

**Interfaces:**
- Produces: `PAGE_TURN_MESH_VERSION = 1`, `QUALITY_TOPOLOGY`, `createPageTurnMesh()`, `versoUv()`, `PaperPhysicsSolver`, and `PageTurnPhysicsFrame`.
- `PageTurnPhysicsFrame.controlPoints` is row-major `[x,y,z,nx,ny,nz]` for every lattice point and is the sole deforming input to both GPU backends.

```ts
export interface PageTurnPhysicsFrame {
  controlPoints: Float32Array;
  points: readonly Vec3[];
  grabPoint: Vec2;
  substeps: number;
  droppedSeconds: number;
  invalidReason?: 'non-finite-input' | 'non-finite-output' | 'excessive-displacement' | 'invalid-normal' | 'unpinned-spine';
  pointAt(column: number, row: number): Vec3;
}

export interface SolverInput {
  pointer?: Vec2;
  elapsedMs: number;
}
```

- [ ] **Step 1: Write RED tests for topology, readable verso UVs, pinned spine, and deterministic cylinder output**

```ts
it('uses the approved rich topology and opposite readable winding on the verso', () => {
  const mesh = createPageTurnMesh('rich');
  expect(mesh.control).toEqual({ columns: 9, rows: 7 });
  expect(mesh.visual).toEqual({ columns: 48, rows: 32 });
  expect(versoUv({ u: 0.2, v: 0.7 })).toEqual({ u: 0.8, v: 0.7 });
});

it('keeps every spine point pinned while the outer edge follows the pointer', () => {
  const solver = new PaperPhysicsSolver({ quality: 'rich', direction: 'ltr' });
  const frame = solver.begin({ x: 1, y: 0.25 }).step({ pointer: { x: 0.55, y: 0.3 }, elapsedMs: 16 });
  expect(frame.pointAt(0, 0).x).toBe(0);
  expect(frame.pointAt(0, 6).x).toBe(0);
  expect(frame.grabPoint).toEqual({ x: 0.55, y: 0.3 });
});
```

- [ ] **Step 2: Run both tests and confirm RED**

Run: `npm.cmd test -- src/rendering/pageTurn/mesh.test.ts src/rendering/pageTurn/physics.test.ts`

Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement topology and stable cylindrical projection**

```ts
export const QUALITY_TOPOLOGY = {
  rich: { controlColumns: 9, controlRows: 7, visualColumns: 48, visualRows: 32, iterations: 6 },
  balanced: { controlColumns: 7, controlRows: 5, visualColumns: 32, visualRows: 24, iterations: 4 },
  essential: { controlColumns: 5, controlRows: 4, visualColumns: 20, visualRows: 14, iterations: 3 },
} as const;

function cylinderPoint(rest: Vec2, pointer: Vec2, grabY: number): Vec3 {
  const progress = Math.min(1, Math.max(0, 1 - pointer.x));
  const radius = Math.max(0.045, 0.22 * (1 - progress) + 0.055);
  const foldX = 1 - progress * 0.92;
  const distance = Math.max(0, rest.x - foldX);
  const angle = Math.min(Math.PI * 1.94, distance / radius);
  const diagonal = (rest.y - grabY) * progress * 0.18;
  return distance === 0
    ? { x: rest.x, y: rest.y, z: 0 }
    : { x: foldX + Math.sin(angle) * radius, y: rest.y + diagonal * Math.sin(angle), z: radius * (1 - Math.cos(angle)) };
}
```

The exact cylinder constants are initial tuning values. Preserve normalized inputs, pin `x=0`, constrain the sampled grab point exactly to the pointer, compute finite normals, and mirror only at the normalized contract boundary for RTL.

- [ ] **Step 4: Implement the fixed-step accumulator and guards**

```ts
const FIXED_STEP_SECONDS = 1 / 120;
const MAX_SUBSTEPS = 4;

step(input: SolverInput): PageTurnPhysicsFrame {
  this.accumulator += Math.max(0, input.elapsedMs) / 1000;
  let steps = 0;
  while (this.accumulator >= FIXED_STEP_SECONDS && steps < MAX_SUBSTEPS) {
    this.integrate(FIXED_STEP_SECONDS, input);
    this.accumulator -= FIXED_STEP_SECONDS;
    steps += 1;
  }
  const droppedSeconds = steps === MAX_SUBSTEPS ? this.accumulator : 0;
  if (droppedSeconds > 0) this.accumulator = 0;
  return this.snapshot(steps, droppedSeconds);
}
```

Reject NaN/infinite coordinates, displacement beyond two normalized page widths, invalid normals, and a missing pinned spine by returning an empty control buffer plus `invalidReason`; the surface cancels before any draw submission.

- [ ] **Step 5: Add mirrored-RTL, four-substep, excess-drop, and invalid-input assertions**

```ts
expect(solver.step({ pointer: { x: 0.5, y: 0.5 }, elapsedMs: 100 }).substeps).toBe(4);
expect(solver.step({ pointer: { x: Number.NaN, y: 0.5 }, elapsedMs: 8 }).invalidReason).toBe('non-finite-input');
```

- [ ] **Step 6: Run GREEN and commit**

Run: `npm.cmd test -- src/rendering/pageTurn/mesh.test.ts src/rendering/pageTurn/physics.test.ts`

Expected: PASS.

```powershell
git add src/rendering/pageTurn/mesh.ts src/rendering/pageTurn/mesh.test.ts src/rendering/pageTurn/physics.ts src/rendering/pageTurn/physics.test.ts
git commit -m "feat: add cylindrical page curl solver"
```

---

### Task 5: Generation-Safe Texture Preparation

**Files:**
- Create: `src/rendering/pageTurn/textures.ts`
- Test: `src/rendering/pageTurn/textures.test.ts`

**Interfaces:**
- Consumes: `PageTurnScene` and `PageDescriptor.src`.
- Produces: `PageTurnTextureCache<T>`, `TextureLoader<T>`, `prepare(scene, generation, viewport): Promise<TexturePreparation<T>>`, `releaseGeneration()`, and `dispose()`.

- [ ] **Step 1: Write RED tests for readiness, LRU bounds, downsampling, and stale generations**

```ts
it('prepares unique front, verso, and under textures and caps the longest side', async () => {
  const load = vi.fn(async (request) => ({ key: request.src }));
  const cache = new PageTurnTextureCache({ load, now: () => 0, maxEntries: 6, maxLongestSide: 4096 });
  const result = await cache.prepare(sceneWithThreeTextures(), 4, { width: 1800, height: 1200, dpr: 3 });
  expect(result.kind).toBe('ready');
  expect(load).toHaveBeenCalledTimes(3);
  expect(load.mock.calls[0][0].longestSide).toBeLessThanOrEqual(4096);
});

it('disposes a stale completed generation instead of publishing it', async () => {
  const deferred = createDeferred<TextureHandle>();
  const dispose = vi.fn();
  const cache = new PageTurnTextureCache({ load: () => deferred.promise, dispose });
  const pending = cache.prepare(scene, 1, viewport);
  cache.releaseGeneration(1);
  deferred.resolve(handle);
  await expect(pending).resolves.toMatchObject({ kind: 'stale' });
  expect(dispose).toHaveBeenCalledWith(handle);
});
```

- [ ] **Step 2: Run the texture test and confirm RED**

Run: `npm.cmd test -- src/rendering/pageTurn/textures.test.ts`

Expected: FAIL because the texture cache does not exist.

- [ ] **Step 3: Implement injected decode/upload with a six-entry LRU**

```ts
export interface TextureLoader<T> {
  load(request: { src: string; width: number; height: number; longestSide: number }): Promise<T>;
  dispose(handle: T): void;
}

export interface PreparedPageImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  bytes: number;
}

export interface PreparedPageTurnTextures<T> {
  bySource: Map<string, T>;
  count: number;
  bytes: number;
}

export type TexturePreparation<T> =
  | { kind: 'ready'; generation: number; textures: PreparedPageTurnTextures<T>; waitedMs: number }
  | { kind: 'slow'; generation: number; waitedMs: number }
  | { kind: 'stale'; generation: number }
  | { kind: 'error'; generation: number; message: string };
```

Deduplicate semantic surfaces by `src`, call `HTMLImageElement.decode()`, downsample to an `ImageBitmap` before the GPU backend prepares its textures, calculate effective viewport/DPR dimensions, enforce backend limits and 4096, touch LRU entries on use, and never read original filesystem paths. A 150 ms timer may publish `slow`; eventual success is still generation-checked before `ready`.

- [ ] **Step 4: Add failure, six-entry eviction, backend-loss disposal, and duplicate-source assertions**

```ts
expect(cache.keys()).toHaveLength(6);
cache.dispose();
expect(dispose).toHaveBeenCalledTimes(6);
```

- [ ] **Step 5: Run GREEN and commit**

Run: `npm.cmd test -- src/rendering/pageTurn/textures.test.ts`

Expected: PASS.

```powershell
git add src/rendering/pageTurn/textures.ts src/rendering/pageTurn/textures.test.ts
git commit -m "feat: prepare page curl textures"
```

---

### Task 6: WebGL2 Physical Renderer

**Files:**
- Create: `src/rendering/pageTurn/contracts.ts`
- Create: `src/rendering/pageTurn/webgl2.ts`
- Create: `src/rendering/pageTurn/webgl2Shaders.ts`
- Create: `src/rendering/pageTurn/PageTurnSurface.tsx`
- Test: `src/rendering/pageTurn/webgl2.test.ts`
- Test: `src/rendering/pageTurn/PageTurnSurface.test.tsx`
- Modify: `src/rendering/contracts.ts`

**Interfaces:**
- Consumes: `PageTurnPhysicsFrame`, `PageTurnScene`, `PageTurnTextureCache`, `RenderQuality`.
- Produces: `PageTurnBackend`, `PageTurnRenderFrame`, `createPageTurnWebGl2()`, and `PageTurnSurface` props `{ scene, generation, state, quality, onReady, onSettled, onFailure, onMetrics }`.

- [ ] **Step 1: Write RED contract tests for reusable resources and semantic bindings**

```ts
it('binds front, readable verso, under-page, and stationary textures before drawing', async () => {
  const gl = createRecordingWebGl2Context();
  const renderer = createPageTurnWebGl2(canvasWith(gl));
  await renderer.prepare(scene, textures);
  renderer.render(frameWithMidFold());
  expect(gl.textureRoles()).toEqual(['front', 'verso', 'under', 'stationary']);
  expect(gl.bufferAllocationsAfterPrepare()).toBe(0);
  expect(gl.readPixels).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run renderer tests and confirm RED**

Run: `npm.cmd test -- src/rendering/pageTurn/webgl2.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx`

Expected: FAIL because renderer modules do not exist.

- [ ] **Step 3: Define the common backend contract and GLSL pipeline**

```ts
export interface PageTurnRenderFrame {
  meshVersion: 1;
  controlPoints: Float32Array;
  progress: number;
  grabPoint: Vec2;
  viewport: { width: number; height: number; dpr: number };
  luminance: { minimum: 0.72; maximum: 1.08 };
  quality: RenderQuality;
}

export interface PageTurnBackend {
  readonly kind: 'webgl2' | 'webgpu';
  prepare(scene: PageTurnScene, textures: PreparedPageTurnTextures<PreparedPageImage>): Promise<void>;
  render(frame: PageTurnRenderFrame): void;
  disposeScene(): void;
  dispose(): void;
}
```

The vertex shader bilinearly interpolates the version-1 control lattice over the visual grid. The fragment shader uses `gl_FrontFacing` to choose front or corrected verso UVs, clamps crease/self-shadow lighting to `0.72..1.08`, and draws a separate bounded projected-shadow pass below the deforming sheet. Allocate programs, VAOs, VBOs, IBOs, textures, and framebuffer-sized resources in `prepare()`, never in `render()`.

- [ ] **Step 4: Implement `PageTurnSurface` as a decorative active-only render loop**

```tsx
return active ? (
  <canvas
    ref={canvasRef}
    className="page-turn-canvas"
    data-testid="page-turn-canvas"
    data-turn-backend={backendKind}
    data-mesh-version={PAGE_TURN_MESH_VERSION}
    aria-hidden="true"
  />
) : null;
```

Initialize WebGL2 and compile shaders before `onReady(generation)`. Drive solver input and drawing from one `requestAnimationFrame` loop only while hover/drag/settle is active. On solver invalidity or context loss, cancel the generation, dispose scene resources, and call `onFailure({ reason: 'backend' | 'solver', diagnostic })` without navigating.

- [ ] **Step 5: Add component tests for preparing, active canvas, settle callback, and context loss**

```tsx
expect(screen.queryByTestId('page-turn-canvas')).not.toBeInTheDocument();
rerender(<PageTurnSurface {...readyDraggingProps} />);
expect(screen.getByTestId('page-turn-canvas')).toHaveAttribute('aria-hidden', 'true');
fireEvent(canvas, new Event('webglcontextlost', { cancelable: true }));
expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'backend' }));
```

- [ ] **Step 6: Run GREEN, build, and commit the WebGL2 milestone**

Run: `npm.cmd test -- src/rendering/pageTurn/webgl2.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx src/rendering/contracts.test.ts`

Run: `npm.cmd run build`

Expected: all commands PASS. This renderer-level milestone must accept changing pointer coordinates and render correct front/verso/under semantics before reader integration begins.

```powershell
git add src/rendering/contracts.ts src/rendering/pageTurn
git commit -m "feat: render physical curl with webgl2"
```

---

### Task 7: Reader Pointer, Synthetic Input, Zoom, and Reduced Motion Integration

**Files:**
- Create: `src/app/usePageTurn.ts`
- Create: `src/app/usePageTurn.test.tsx`
- Create: `src/app/ReaderView.test.tsx`
- Modify: `src/app/ReaderView.tsx`
- Modify: `src/rendering/contracts.ts`
- Modify: `src/rendering/contracts.test.ts`
- Modify: `src/rendering/ReaderSurface.tsx`
- Create: `src/rendering/ReaderSurface.test.tsx`
- Modify: `src/app/styles.css`

**Interfaces:**
- Consumes: `PageTurnController`, `buildPageTurnScene()`, geometry helpers, and `PageTurnSurface`.
- Produces: `usePageTurn(options)` returning `{ state, scene, surfaceInput, edgeProps, requestTurn, cancelTurn, acknowledgeNavigation }`.

- [ ] **Step 1: Write RED hook tests for pointer capture and a shared automatic path**

```tsx
it('captures a middle-edge pointer and feeds normalized points to the controller', () => {
  const { result } = renderHook(() => usePageTurn(options()));
  act(() => result.current.edgeProps.onPointerDown(pointerEvent({ pointerId: 4, clientX: 598, clientY: 390 })));
  expect(stage.setPointerCapture).toHaveBeenCalledWith(4);
  expect(result.current.state).toMatchObject({ phase: 'preparing' });
  expect(result.current.pendingPointer).toMatchObject({ pointerId: 4, grab: { y: 0.5 } });
});

it('routes a button turn through a synthetic 62-percent-height pointer', () => {
  const { result } = renderHook(() => usePageTurn(options()));
  act(() => result.current.requestTurn(1));
  expect(result.current.syntheticTrajectory?.grab.y).toBeCloseTo(0.62);
});

it('limits hover lift to three percent and removes it in reduced motion', () => {
  const animated = renderHook(() => usePageTurn(options()));
  act(() => animated.result.current.edgeProps.onPointerMove(pointerEvent({ clientX: 598, clientY: 390 })));
  expect(animated.result.current.surfaceInput?.progress).toBeLessThanOrEqual(0.03);
  const reduced = renderHook(() => usePageTurn(options({ reducedMotion: true })));
  act(() => reduced.result.current.edgeProps.onPointerMove(pointerEvent({ clientX: 598, clientY: 390 })));
  expect(reduced.result.current.surfaceInput).toBeUndefined();
});
```

- [ ] **Step 2: Write RED `ReaderView` tests for strict reduced motion and all source formats**

```tsx
it('changes immediately and never mounts a turn canvas in reduced motion', () => {
  renderReader({ profile: { ...profile, reducedMotion: true } });
  fireEvent.click(screen.getByTestId('reader-next'));
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('page-turn-canvas')).not.toBeInTheDocument();
});

it.each(['pdf', 'cbz', 'cbr', 'images'] as const)('uses decoded page URIs for %s', (format) => {
  renderReader({ publication: publicationWithFormat(format) });
  fireEvent.pointerDown(screen.getByTestId('reader-stage'), outerEdgePointer());
  expect(screen.getByTestId('page-turn-canvas')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npm.cmd test -- src/app/usePageTurn.test.tsx src/app/ReaderView.test.tsx`

Expected: FAIL because the hook and new integration do not exist.

- [ ] **Step 4: Implement the hook and replace timer/progress state in `ReaderView`**

```ts
const pageTurn = usePageTurn({
  publication,
  mode: profile.mode,
  readingDirection: profile.direction,
  reducedMotion: profile.reducedMotion,
  transformedPage: paperRef,
  zoom: { scale: effectiveScale, panX: safeReaderState.panX, panY: safeReaderState.panY },
  canNext,
  canPrevious,
  onNext,
  onPrevious,
});
```

Spread `pageTurn.edgeProps` onto the clipped reading stage after rejecting reader controls, Adaptive Flow, space-pan, non-primary mouse buttons, and a second pointer. Preserve manual zoom/pan state. Cancel on resize, fullscreen change, profile direction/mode change, publication change, unmount, and `document.visibilityState === 'hidden'`. Adjacent buttons, wheel, keys, and registered app actions call `requestTurn(delta)`; navigator non-adjacent selections continue to call `onSelectPage()` directly.

- [ ] **Step 5: Mount the overlay and remove the old CSS curl only after the new path is active**

```tsx
<ReaderSurface
  frame={rendererFrame}
  staticContent={staticPages}
  ariaLabel={readerCounter}
  onStatus={setRendererStatus}
  interactionActive={pageTurn.state.phase !== 'idle'}
/>
<PageTurnSurface
  {...pageTurn.surfaceInput}
  onReady={pageTurn.onTexturesAndBackendReady}
  onSettled={pageTurn.onSettled}
  onFailure={pageTurn.onFailure}
/>
```

Add `.page-turn-canvas { position:absolute; inset:0; z-index:4; width:100%; height:100%; pointer-events:none; }` and an outer-edge cursor/hint clipped to the visible sheet. Delete `.curl-layer`, `.curl-glint`, `.reading-stage--turn-* .curl-layer`, `page-enter-forward`, and `page-enter-backward`; remove their JSX and CSS variables from `ReaderView`.

Remove `turningPageId` and `turnProgress` from the idle `RenderFrame`, and remove the width-collapse/shade branch from `buildRenderPlan()`. Its tests must assert that idle pages keep their full layout regardless of page-turn controller state; deformation belongs exclusively to `PageTurnSurface`.

Change `.render-static--hidden` from `visibility:hidden` to a visually transparent, non-interactive state (`opacity:0; pointer-events:none`) so its page/article semantics remain available while the existing idle canvas is decorative. Lock this in `ReaderSurface.test.tsx` by rendering a named `<article>`, selecting a GPU backend, and asserting the article remains in the accessibility tree.

- [ ] **Step 6: Add interruption, zoom/pan priority, top/middle/bottom, touch/pen, queue, and boundary tests**

```tsx
it.each([0.01, 0.5, 0.99])('starts at normalized edge height %s', (y) => {
  const view = renderReader();
  fireEvent.pointerDown(view.stage, outerEdgePointer({ y }));
  expect(view.turnHook.pendingPointer?.grab.y).toBeCloseTo(y, 2);
});
```

- [ ] **Step 7: Run GREEN, build, and commit**

Run: `npm.cmd test -- src/app/usePageTurn.test.tsx src/app/ReaderView.test.tsx src/rendering/ReaderSurface.test.tsx src/rendering/contracts.test.ts src/app/AppAnnouncements.test.tsx src/app/AppNativeImport.test.tsx`

Run: `npm.cmd run build`

Expected: PASS, with no `.curl-layer` match under `src`.

```powershell
git add src/app/usePageTurn.ts src/app/usePageTurn.test.tsx src/app/ReaderView.tsx src/app/ReaderView.test.tsx src/rendering/ReaderSurface.tsx src/rendering/ReaderSurface.test.tsx src/rendering/contracts.ts src/rendering/contracts.test.ts src/app/styles.css
git commit -m "feat: integrate pointer driven page curl"
```

---

### Task 8: Constrained Paper Flex and Critically Damped Settling

**Files:**
- Modify: `src/rendering/pageTurn/physics.ts`
- Test: `src/rendering/pageTurn/physics.test.ts`
- Modify: `src/rendering/pageTurn/PageTurnSurface.tsx`

**Interfaces:**
- Extends: `PaperPhysicsSolver.step()` with distance, bend, plane/spine collision, damping, and `settle(outcome)`.
- Produces: terminal flags `settled: 'commit' | 'cancel' | undefined`, `maxStretch`, and `droppedSeconds` in `PageTurnPhysicsFrame`.

- [ ] **Step 1: Verify the first integrated milestone before adding secondary flex**

Run: `npm.cmd test -- src/app/ReaderView.test.tsx src/rendering/pageTurn/webgl2.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx`

Expected: PASS with pointer-driven WebGL2, correct front/verso/under mapping, commit, cancellation, and reduced-motion behavior. Stop this task if that milestone is not green.

- [ ] **Step 2: Add failing invariant and settling tests**

```ts
it('bounds stretch and never crosses the stationary page plane', () => {
  const solver = new PaperPhysicsSolver({ quality: 'balanced', direction: 'ltr' }).begin({ x: 1, y: 0.02 });
  for (let index = 0; index < 120; index += 1) solver.step({ pointer: { x: 0.08, y: 0.62 }, elapsedMs: 8.333 });
  const frame = solver.snapshot();
  expect(frame.maxStretch).toBeLessThanOrEqual(0.035);
  expect(frame.points.every((point) => point.z >= -0.0001 && point.x >= -0.0001)).toBe(true);
});

it.each(['commit', 'cancel'] as const)('settles %s without persistent oscillation', (outcome) => {
  const solver = curledSolver();
  solver.settle(outcome);
  let frame = solver.snapshot();
  for (let index = 0; index < 360 && !frame.settled; index += 1) frame = solver.step({ elapsedMs: 8.333 });
  expect(frame.settled).toBe(outcome);
  expect(frame.maxSpeed).toBeLessThan(0.01);
});
```

- [ ] **Step 3: Run the physics test and confirm RED**

Run: `npm.cmd test -- src/rendering/pageTurn/physics.test.ts`

Expected: FAIL because stretch metrics and settling are absent.

- [ ] **Step 4: Add low-resolution PBD constraints around the analytic target**

```ts
for (let iteration = 0; iteration < topology.iterations; iteration += 1) {
  solvePinnedSpine(points);
  solvePointerConstraint(points, grabConstraint);
  solveDistanceConstraints(points, restLengths, 0.96);
  solveBendConstraints(points, analyticTargets, 0.34);
  solvePagePlaneCollision(points, 0);
  solveSpineBoundary(points, 0);
}
applyVelocityDamping(points, previousPoints, 0.86);
```

Use semi-implicit Verlet/PBD state only on the small control lattice. During dragging, apply the pointer constraint last so the grabbed point is exact. During settling, replace the pointer constraint with a critically damped target whose terminal pose is `x=-1` for commit and rest coordinates for cancel; require position and speed tolerances for six consecutive steps before reporting `settled`.

- [ ] **Step 5: Add corner-vs-middle torsion and fixed-step determinism tests**

```ts
const corner = solveAtGrabY(0.02);
const middle = solveAtGrabY(0.5);
expect(Math.abs(corner.top.z - corner.bottom.z)).toBeGreaterThan(Math.abs(middle.top.z - middle.bottom.z));
expect(runSequence([8, 8, 8, 8])).toEqual(runSequence([16, 16]));
```

- [ ] **Step 6: Run GREEN and commit**

Run: `npm.cmd test -- src/rendering/pageTurn/physics.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx`

Expected: PASS.

```powershell
git add src/rendering/pageTurn/physics.ts src/rendering/pageTurn/physics.test.ts src/rendering/pageTurn/PageTurnSurface.tsx
git commit -m "feat: add constrained paper flex"
```

---

### Task 9: WebGPU Adapter with Contract Parity

**Files:**
- Create: `src/rendering/pageTurn/webgpu.ts`
- Create: `src/rendering/pageTurn/webgpuShaders.ts`
- Test: `src/rendering/pageTurn/webgpu.test.ts`
- Modify: `src/rendering/pageTurn/PageTurnSurface.tsx`
- Modify: `src/rendering/pageTurn/PageTurnSurface.test.tsx`

**Interfaces:**
- Consumes and implements the exact `PageTurnBackend` and `PageTurnRenderFrame` from Task 6.
- Produces: `createPageTurnWebGpu(canvas, onDeviceLost): Promise<PageTurnBackend>`.

- [ ] **Step 1: Write a failing backend-parity test**

```ts
it.each([createPageTurnWebGl2ForTest, createPageTurnWebGpuForTest])('uses mesh v1 and all semantic texture roles', async (factory) => {
  const backend = await factory();
  await backend.prepare(scene, textures);
  backend.render(frameWithMidFold());
  expect(backend.recording()).toMatchObject({ meshVersion: 1, roles: ['front', 'verso', 'under', 'stationary'] });
});
```

- [ ] **Step 2: Run the WebGPU test and confirm RED**

Run: `npm.cmd test -- src/rendering/pageTurn/webgpu.test.ts`

Expected: FAIL because the WebGPU factory does not exist.

- [ ] **Step 3: Implement WGSL with identical buffers, UV semantics, and lighting bounds**

```wgsl
struct TurnUniforms {
  mesh_version: u32,
  progress: f32,
  luminance_min: f32,
  luminance_max: f32,
};

let face_color = select(sampleVersoReadable(input.uv), sampleFront(input.uv), input.front_facing);
let lit = clamp(creaseLighting(input), uniforms.luminance_min, uniforms.luminance_max);
return vec4<f32>(face_color.rgb * lit, face_color.a);
```

Create pipeline, bind-group layouts, sampler, buffers, and textures in `prepare()`. Reuse buffers during `render()`. Report `device.lost` once, stop submission, dispose the scene, and allow `PageTurnSurface` to retry WebGL2 only if motion has not begun; loss during motion cancels and future turns stay on WebGL2.

- [ ] **Step 4: Add device-loss-before-motion and during-motion component tests**

```tsx
deviceLost.resolve({ reason: 'unknown', message: 'lost' });
await waitFor(() => expect(surface()).toHaveAttribute('data-turn-backend', 'webgl2'));
expect(onSettled).not.toHaveBeenCalled();
```

- [ ] **Step 5: Run GREEN, build, and commit**

Run: `npm.cmd test -- src/rendering/pageTurn/webgpu.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx`

Run: `npm.cmd run build`

Expected: PASS.

```powershell
git add src/rendering/pageTurn/webgpu.ts src/rendering/pageTurn/webgpuShaders.ts src/rendering/pageTurn/webgpu.test.ts src/rendering/pageTurn/PageTurnSurface.tsx src/rendering/pageTurn/PageTurnSurface.test.tsx
git commit -m "feat: add webgpu page curl backend"
```

---

### Task 10: Adaptive Quality, Session Disable, and Failure Semantics

**Files:**
- Modify: `src/rendering/telemetry.ts`
- Modify: `src/rendering/telemetry.test.ts`
- Modify: `src/rendering/contracts.ts`
- Modify: `src/rendering/pageTurn/PageTurnSurface.tsx`
- Modify: `src/rendering/pageTurn/PageTurnSurface.test.tsx`
- Modify: `src/app/usePageTurn.ts`
- Modify: `src/app/usePageTurn.test.tsx`

**Interfaces:**
- Produces: `PageTurnTelemetry`, `PageTurnMetrics`, `QualityDecision`, and renderer status fields `physicalTurnsEnabled`, `pageTurnDisabledReason`, `pageTurnP95Ms`.
- Consumes: frame timestamp, pointer event timestamp, dropped physics seconds, texture bytes/count, interaction phase, and current quality.

- [ ] **Step 1: Add RED tests for p95 disable and idle-only recovery**

```ts
it('permanently disables physical turns after 20 essential frames above 32ms p95', () => {
  const telemetry = new PageTurnTelemetry('essential');
  for (let index = 0; index < 20; index += 1) telemetry.recordInteractionFrame(33, 0);
  expect(telemetry.decision()).toEqual({ kind: 'disable-session', reason: 'performance' });
  telemetry.recordIdleFrame(8, 10_000);
  expect(telemetry.decision()).toEqual({ kind: 'disable-session', reason: 'performance' });
});

it('recovers one tier only after five stable idle seconds', () => {
  const telemetry = new PageTurnTelemetry('essential');
  telemetry.recordIdleFrame(16, 0);
  telemetry.recordIdleFrame(16, 4_999);
  expect(telemetry.quality()).toBe('essential');
  telemetry.recordIdleFrame(16, 5_000);
  expect(telemetry.quality()).toBe('balanced');
});
```

- [ ] **Step 2: Run telemetry tests and confirm RED**

Run: `npm.cmd test -- src/rendering/telemetry.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx`

Expected: FAIL because page-turn telemetry is absent.

- [ ] **Step 3: Implement percentile windows, hysteresis, and immutable session disable**

```ts
function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

if (this.qualityTier === 'essential' && this.interactionFrames.length >= 20 && percentile95(this.interactionFrames) > 32) {
  this.disabledReason = 'performance';
}
```

Freeze quality for the duration of ordinary dragging. Permit a critical drop from rich/balanced when frame p95 already exceeds 32 ms. Recover only one tier after each complete five-second stable idle interval. Record pointer-to-next-frame latency, dropped physics time, texture count/bytes, quality transitions, and solver version without GPU readback.

- [ ] **Step 4: Wire failure policy into surface and hook tests**

```tsx
it.each(['performance', 'backend', 'texture'] as const)('uses immediate navigation after %s disables physics', (reason) => {
  const { result } = renderTurnHook();
  act(() => result.current.disable(reason));
  act(() => result.current.requestTurn(1));
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(result.current.surfaceInput).toBeUndefined();
});
```

Texture failure before motion keeps the current page, publishes the existing diagnostic/loading state, and permits retry. Solver invalidity or backend loss during motion cancels without navigation and disables/reselects the backend according to the design. Do not mutate publication/progress/bookmarks from any renderer callback.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm.cmd test -- src/rendering/telemetry.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx src/app/usePageTurn.test.tsx`

Expected: PASS.

```powershell
git add src/rendering/telemetry.ts src/rendering/telemetry.test.ts src/rendering/contracts.ts src/rendering/pageTurn/PageTurnSurface.tsx src/rendering/pageTurn/PageTurnSurface.test.tsx src/app/usePageTurn.ts src/app/usePageTurn.test.tsx
git commit -m "feat: adapt page curl quality safely"
```

---

### Task 11: Physical Visual Matrix and RTL/Verso Failure Gates

**Files:**
- Modify: `tests/visual/visual-matrix.ts`
- Modify: `tests/visual/visual-matrix.test.ts`
- Modify: `tests/visual/reader-matrix.spec.ts`
- Modify: `src/release/testModes.ts`
- Modify: `src/release/testModes.test.ts`

**Interfaces:**
- Produces test-only query controls for `turnCheckpoint=early|mid|spine|late|settled|cancel`, `turnGrab=top|middle|bottom`, `turnQuality=rich|balanced|essential|disabled`, and an explicit `turnFault` enum.
- Evidence records requested/actual backend, quality, solver version, mesh version, projected fold bounds, front/verso/under IDs, and skip reason.

- [ ] **Step 1: Add failing pure tests for the expanded matrix and safe test-mode parsing**

```ts
it('covers physical checkpoints, edge heights, direction, modes, and backends', () => {
  const keys = physicalTurnScenarios.map((scenario) => `${scenario.checkpoint}:${scenario.grab}:${scenario.direction}:${scenario.mode}:${scenario.backend}`);
  expect(keys).toContain('mid:middle:ltr:single:webgl2');
  expect(keys).toContain('spine:top:rtl:spread:webgpu');
  expect(keys).toContain('cancel:bottom:ltr:single:webgl2');
});

expect(parseTurnFault('?turnFault=reverse-motion', true)).toBe('reverse-motion');
expect(parseTurnFault('?turnFault=reverse-motion', false)).toBeUndefined();
```

- [ ] **Step 2: Run matrix tests and confirm RED**

Run: `npm.cmd test -- tests/visual/visual-matrix.test.ts src/release/testModes.test.ts`

Expected: FAIL because physical scenarios and parsers are absent.

- [ ] **Step 3: Add deterministic visual checkpoints and evidence attributes**

```ts
const evidence = await page.getByTestId('page-turn-canvas').evaluate((canvas) => ({
  backend: canvas.dataset.turnBackend,
  meshVersion: Number(canvas.dataset.meshVersion),
  solverVersion: Number(canvas.dataset.solverVersion),
  front: canvas.dataset.frontPage,
  verso: canvas.dataset.versoPage,
  under: canvas.dataset.underPage,
  foldMinX: Number(canvas.dataset.foldMinX),
  foldMaxX: Number(canvas.dataset.foldMaxX),
}));
expect(evidence.foldMaxX - evidence.foldMinX).toBeGreaterThan(0.06);
expect(evidence.front).not.toBe(evidence.verso);
```

Pause the test-only solver at normalized progress `0.08`, `0.42`, `0.60`, `0.86`, and terminal poses. Verify LTR/RTL direction from projected mesh bounds sampled across two frames, not `data-turn-direction`. Capture desktop and narrow screenshots for top/middle/bottom grabs, single/spread, contrasting aspect ratios, and high-contrast art.

- [ ] **Step 4: Add deliberate negative gates**

```ts
for (const fault of ['reverse-motion', 'mirror-verso', 'missing-under', 'blank-frame', 'flat-mesh'] as const) {
  await openTurnScenario(page, { fault });
  await expect(collectPhysicalEvidence(page)).rejects.toThrow();
}
```

Each test-only fault must alter the actual mesh/UV/texture/draw result, and the ordinary evidence assertion must fail for the intended reason. Test-mode controls are compiled only when `VITE_VISUAL_TEST === '1'`.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm.cmd test -- tests/visual/visual-matrix.test.ts src/release/testModes.test.ts`

Run: `npm.cmd run test:visual -- --project=chromium`

Expected: unit tests PASS; supported WebGL2 scenarios PASS; optional WebGPU scenarios either PASS or record an explicit skip reason.

```powershell
git add tests/visual/visual-matrix.ts tests/visual/visual-matrix.test.ts tests/visual/reader-matrix.spec.ts src/release/testModes.ts src/release/testModes.test.ts
git commit -m "test: validate physical page curl evidence"
```

---

### Task 12: Performance Evidence, Cleanup, and Final Verification

**Files:**
- Modify: `scripts/performance/performance-contract.test.mjs`
- Modify: `scripts/performance/performance-smoke.mjs`
- Modify: `docs/performance/reference-hardware.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces scenario `physical-page-turn-50`, metrics `pointerToFrameP95Ms`, `interactionFrameP95Ms`, `droppedPhysicsMs`, `qualityTransitions`, `textureCountPeak`, `textureBytesPeak`, `texturesAfterCleanup`, `solverVersion`, and `actualBackend`.
- Uses the existing installed-app performance harness and owned-root cleanup; it does not launch a real evidence run in unit CI.

- [ ] **Step 1: Add RED contract tests for the new scenario and authenticity gates**

```js
test('physical page turn evidence requires latency, p95, and cleanup metrics', () => {
  const result = validateScenarioResult('physical-page-turn-50', {
    actualBackend: 'webgl2', solverVersion: 1,
    pointerToFrameP95Ms: 16.7, interactionFrameP95Ms: 16.7,
    droppedPhysicsMs: 0, qualityTransitions: [],
    textureCountPeak: 6, textureBytesPeak: 48_000_000, texturesAfterCleanup: 0,
  });
  assert.equal(result.status, 'passed');
});
```

- [ ] **Step 2: Run performance contracts and confirm RED**

Run: `npm.cmd run test:performance-contract`

Expected: FAIL because `physical-page-turn-50` is not defined.

- [ ] **Step 3: Implement the deterministic 50-turn harness scenario**

```js
for (let index = 0; index < 50; index += 1) {
  await triggerAdjacentTurn(page, index % 2 === 0 ? 'forward' : 'backward');
  await waitForTurnIdle(page);
}
const metrics = await page.evaluate(() => window.__READER_TEST__?.pageTurnMetrics());
assertPhysicalTurnMetrics(metrics, { maxTextureCount: 6, maxInteractionP95Ms: 32, cleanupTextureCount: 0 });
```

Record metrics from the production telemetry seam enabled only in smoke/test builds. Measure pointer event timestamp to the next frame that includes its generation. Do not include Playwright setup/fill overhead in the metric. Dispose the publication, close the session, and assert zero retained turn textures while preserving primary failure plus `cleanupFailure` serialization.

- [ ] **Step 4: Document hardware, target, skip, and evidence fields and wire contract tests into normal CI**

```yaml
- name: Test performance contracts
  run: npm run test:performance-contract
```

Document the 60 FPS p95 reference target on Windows 10/11 x64, 8 GB RAM, and a WebGL2-capable integrated GPU; distinguish unsupported/software adapters with explicit skip reasons. Document high-refresh evidence up to 120 Hz as supplemental rather than a requirement on ordinary CI hardware.

- [ ] **Step 5: Run the complete verification set**

Run: `npm.cmd test -- --reporter=dot`

Run: `npm.cmd run test:installed-app-harness`

Run: `npm.cmd run test:release-scripts`

Run: `npm.cmd run test:performance-contract`

Run: `npm.cmd run test:workflow`

Run: `npm.cmd run build`

Run: `git diff --check`

Expected: every command exits 0. Do not claim real WebGPU or reference-hardware performance evidence unless those explicit runs were executed on qualifying hardware.

- [ ] **Step 6: Run the supported local visual matrix**

Run: `npm.cmd run test:visual -- --project=chromium`

Expected: WebGL2 physical scenarios PASS; WebGPU records PASS or a precise environment skip; all screenshots and JSON refer to the same settled backend and solver generation.

- [ ] **Step 7: Commit final evidence support**

```powershell
git add scripts/performance/performance-contract.test.mjs scripts/performance/performance-smoke.mjs docs/performance/reference-hardware.md .github/workflows/ci.yml
git commit -m "test: add physical page curl performance gates"
```

---

## Final Review Gate

- [ ] Compare all twelve task results against every acceptance criterion in `docs/superpowers/specs/2026-08-14-physical-page-curl-design.md`.
- [ ] Confirm `rg -n "curl-layer|curl-glint|rotateY|page-enter-forward|page-enter-backward" src` returns no old page-turn implementation.
- [ ] Confirm the renderer has no branch on `PublicationFormat` and consumes only `PageDescriptor.src`.
- [ ] Confirm reduced motion and disabled reasons mount no `PageTurnSurface` and navigate immediately.
- [ ] Confirm a failed or cancelled generation never invokes `onNext`, `onPrevious`, or `onSelectPage`.
- [ ] Confirm visual evidence derives motion from actual projected mesh geometry and that each deliberate fault fails.
- [ ] Request a code review against this plan and the approved design before merging.
