# Task 4 Report — Versioned Mesh and Analytic Cylinder

## Implementation

Implemented the Task 4 solver slice for the physical page curl work.

What changed:

- Added `src/rendering/pageTurn/mesh.ts` with:
  - `PAGE_TURN_MESH_VERSION = 1`
  - `QUALITY_TOPOLOGY`
  - `createPageTurnMesh()`
  - `versoUv()`
- Added `src/rendering/pageTurn/physics.ts` with:
  - `PaperPhysicsSolver`
  - `PageTurnPhysicsFrame`
  - fixed `1/120` accumulator with max four substeps
  - dropped excess accumulated time
  - analytic cylindrical fold in normalized page-local coordinates
  - finite/displacement/normal/spine guards
  - mirrored RTL equivalence at the normalized contract boundary
- Added `src/rendering/pageTurn/mesh.test.ts`
- Added `src/rendering/pageTurn/physics.test.ts`

Behavior and constraints covered:

- approved rich / balanced / essential topology budgets
- versioned mesh metadata for later backend parity
- readable back-face verso UV orientation by mirroring only `u`
- deterministic solver output for the same normalized input sequence
- pinned spine invariants
- no React / DOM / GPU dependency in the solver
- fixed-step accumulation with four-substep cap and dropped overflow time
- invalid-frame cancellation contract via `invalidReason`
- RTL as a mirror of the same normalized LTR contract

## Files

- `src/rendering/pageTurn/mesh.ts`
- `src/rendering/pageTurn/mesh.test.ts`
- `src/rendering/pageTurn/physics.ts`
- `src/rendering/pageTurn/physics.test.ts`

## TDD evidence

### RED

I wrote the new tests first, before adding either production module.

Command:

```powershell
npm.cmd test -- --configLoader runner src/rendering/pageTurn/mesh.test.ts src/rendering/pageTurn/physics.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run --configLoader runner src/rendering/pageTurn/mesh.test.ts src/rendering/pageTurn/physics.test.ts


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design


⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/rendering/pageTurn/mesh.test.ts [ src/rendering/pageTurn/mesh.test.ts ]
Error: Failed to resolve import "./mesh" from "src/rendering/pageTurn/mesh.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design/src/rendering/pageTurn/mesh.test.ts:2:86
  1  |  import { describe, expect, it } from "vitest";
  2  |  import { PAGE_TURN_MESH_VERSION, QUALITY_TOPOLOGY, createPageTurnMesh, versoUv } from "./mesh";
     |                                                                                         ^
  3  |  describe("page turn mesh", () => {
  4  |    it("uses the approved rich topology and opposite readable winding on the verso", () => {

 FAIL  src/rendering/pageTurn/physics.test.ts [ src/rendering/pageTurn/physics.test.ts ]
Error: Failed to resolve import "./physics" from "src/rendering/pageTurn/physics.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design/src/rendering/pageTurn/physics.test.ts:2:35
  1  |  import { describe, expect, it } from "vitest";
  2  |  import { PaperPhysicsSolver } from "./physics";
     |                                      ^
  3  |  describe("PaperPhysicsSolver", () => {
  4  |    it("keeps every spine point pinned while the outer edge follows the pointer", () => {


 Test Files  2 failed (2)
      Tests  no tests
   Start at  16:40:19
   Duration  1.02s (transform 15ms, setup 18ms, collect 0ms, tests 0ms, environment 1.08s, prepare 332ms)
```

That RED run failed for the intended reason: both production modules were still missing.

### GREEN

After implementing `mesh.ts` and `physics.ts`, I reran the focused verification.

Command:

```powershell
npm.cmd test -- --configLoader runner src/rendering/pageTurn/mesh.test.ts src/rendering/pageTurn/physics.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run --configLoader runner src/rendering/pageTurn/mesh.test.ts src/rendering/pageTurn/physics.test.ts


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design

 ✓ src/rendering/pageTurn/mesh.test.ts (4 tests) 4ms
 ✓ src/rendering/pageTurn/physics.test.ts (6 tests) 11ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Start at  16:42:45
   Duration  1.10s (transform 56ms, setup 22ms, collect 81ms, tests 16ms, environment 1.24s, prepare 213ms)
```

Focused GREEN coverage proves:

- versioned topology matches the approved budgets
- readable verso UVs flip `u` only
- pinned spine remains fixed
- deterministic cylinder frames repeat exactly
- four-substep cap and dropped excess time work
- non-finite input rejects early
- excessive displacement rejects before exposing a frame
- RTL mirrors the same lattice motion

## Full verification

Per the task brief, I ran the full suite once after the focused GREEN verification.

Command:

```powershell
npm.cmd test -- --configLoader runner
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run --configLoader runner


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design

 ✓ src/domain/library.test.ts (6 tests) 33ms
 ✓ src/domain/flow.test.ts (4 tests) 19ms
 ✓ src/domain/pageTurnScene.test.ts (12 tests) 10ms
 ✓ src/domain/profiles.test.ts (6 tests) 14ms
 ✓ src/services/importers.test.ts (3 tests) 31ms
 ✓ src/services/storage.test.ts (7 tests) 15ms
 ✓ src/app/LiveAnnouncement.test.tsx (3 tests) 55ms
 ✓ src/app/ZoomControls.test.tsx (3 tests) 86ms
 ✓ src/app/SmokeHarness.test.tsx (9 tests) 200ms
 ✓ src/app/PageNavigator.test.tsx (6 tests) 263ms
 ✓ src/services/readerState.test.ts (3 tests) 13ms
 ✓ src/app/ProfilePanel.test.tsx (4 tests) 281ms
 ✓ src/app/LibraryView.test.tsx (12 tests) 741ms
 ✓ src/app/AppNativeImport.test.tsx (7 tests) 362ms
 ✓ src/app/AppAnnouncements.test.tsx (1 test) 737ms
   ✓ application live-region wiring > announces reader navigation and renderer state through real consumers  735ms
 ✓ src/rendering/pageTurn/physics.test.ts (6 tests) 23ms
 ✓ src/domain/reader.test.ts (8 tests) 11ms
 ✓ src/domain/readerState.test.ts (3 tests) 9ms
 ✓ src/domain/pageTurn.test.ts (8 tests) 15ms
 ✓ src/domain/pageSelection.test.ts (4 tests) 8ms
 ✓ src/domain/input.test.ts (4 tests) 8ms
 ✓ src/app/nativeImportFlow.test.ts (4 tests) 10ms
 ✓ src/release/testModes.test.ts (7 tests) 7ms
 ✓ src/domain/covers.test.ts (3 tests) 7ms
 ✓ src/rendering/telemetry.test.ts (4 tests) 8ms
 ✓ src/services/flowStorage.test.ts (1 test) 7ms
 ✓ src/rendering/contracts.test.ts (3 tests) 8ms
 ✓ src/domain/pageTurnGeometry.test.ts (10 tests) 7ms
 ✓ src/i18n/catalog.test.ts (3 tests) 4ms
 ✓ src/rendering/pageTurn/mesh.test.ts (4 tests) 5ms
 ✓ tests/visual/visual-matrix.test.ts (1 test) 2ms

 Test Files  31 passed (31)
      Tests  159 passed (159)
   Start at  16:42:57
   Duration  5.15s (transform 2.31s, setup 452ms, collect 6.78s, tests 3.00s, environment 35.98s, prepare 6.04s)
```

## Self-review

- Kept this slice limited to Task 4: no PBD distance/bend/collision flex and no settling system were added.
- The solver is CPU-only and depends only on domain/rendering contracts plus numeric helpers.
- Control lattice ordering is row-major and `controlPoints` is packed as `[x, y, z, nx, ny, nz]` per point, matching the brief.
- RTL is implemented by mirroring only at the normalized boundary, so the same canonical cylinder logic drives both directions.
- Mesh topology and solver quality tiers share the same `QUALITY_TOPOLOGY` contract to keep backends aligned later.
- Unrelated files were preserved; this task only adds the requested `src/rendering/pageTurn/` slice plus this report.

## Concerns

- The hard pointer constraint currently snaps the nearest outer-edge control row to the pointer. That satisfies this task’s lattice contract, but later visual fidelity work may want interpolation between rows once the renderer consumes the lattice directly.
- `invalid-normal` and `unpinned-spine` guards are implemented, but this task’s public tests exercise them indirectly through the frame-validation path rather than by forcing synthetic corrupted states.
- `PageTurnPhysicsFrame.grabPoint` reflects the current normalized pointer contract from the brief’s sample usage; later integration may rename or wrap that field if controller terminology needs to distinguish initial grab from current constrained point more explicitly.
