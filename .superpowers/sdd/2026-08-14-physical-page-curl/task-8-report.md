# Task 8 Report: Constrained Paper Flex and Critically Damped Settling

Date: 2026-08-14
Branch: `codex/physical-page-curl-design`
Commit target: `feat: add constrained paper flex`

## Milestone gate

Task 8 required the first integrated milestone to be green before any flex work.

Command:

```powershell
npm.cmd test -- src/app/ReaderView.test.tsx src/rendering/pageTurn/webgl2.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx
```

Initial sandboxed attempt failed before test execution because Vite/Vitest could not read the linked worktree:

```text
X [ERROR] Cannot read directory "../../../../..": Acesso negado.
X [ERROR] Could not resolve "C:\Users\adenilson.j\Documents\ChatGPT\leitor\.worktrees\physical-page-curl-design\vite.config.ts"
```

Rerun outside the sandbox:

```text
✓ src/rendering/pageTurn/webgl2.test.ts (5 tests)
✓ src/rendering/pageTurn/PageTurnSurface.test.tsx (7 tests)
✓ src/app/ReaderView.test.tsx (7 tests)
Test Files  3 passed (3)
Tests  19 passed (19)
```

Result: milestone gate passed, so implementation proceeded.

## TDD evidence

### RED cycle 1: physics invariants and settling

Added failing tests for:

- bounded stretch and page-plane/spine collision
- `settle('commit' | 'cancel')`
- torsion difference between corner and middle grabs
- fixed-step determinism grouping

Command:

```powershell
npm.cmd test -- src/rendering/pageTurn/physics.test.ts
```

Observed RED:

```text
× bounds stretch and never crosses the stationary page plane
  → actual value must be number or bigint, received "undefined"
× settles commit without persistent oscillation
  → solver.settle is not a function
× settles cancel without persistent oscillation
  → solver.settle is not a function
× creates more torsion for a corner grab than a middle-edge grab
  → Reduce of empty array with no initial value
```

### GREEN cycle 1: solver implementation

Implemented:

- low-resolution PBD lattice over analytic cylinder targets
- pinned spine
- interpolated exact pointer constraint on the outer edge
- distance constraints plus bend-to-target constraints
- page-plane and spine collision
- damping and dropped fixed-step time accounting
- terminal `settled` flags for commit/cancel
- `maxStretch` and `maxSpeed`
- public `snapshot()`
- RTL actual-order remapping for points/normals

Re-ran:

```powershell
npm.cmd test -- src/rendering/pageTurn/physics.test.ts
```

Observed GREEN:

```text
✓ src/rendering/pageTurn/physics.test.ts (14 tests)
Test Files  1 passed (1)
Tests  14 passed (14)
```

### RED cycle 2: surface terminal settle contract

Added a failing surface test requiring `PageTurnSurface` to wait for `frame.settled` instead of inferring completion from terminal progress alone.

Command:

```powershell
npm.cmd test -- src/rendering/pageTurn/PageTurnSurface.test.tsx src/app/usePageTurn.test.tsx
```

Observed RED on surface:

```text
× waits for the physics frame settled flag instead of terminal progress alone
  → expected "spy" to not be called at all, but actually been called 1 times
```

### GREEN cycle 2: surface + settle integration

Updated:

- `PageTurnSurface` to fire `onSettled` only when `physicsFrame.settled === state.outcome`
- `usePageTurn` to drive settling by stepping `PaperPhysicsSolver.settle(...)` on animation frames instead of easing pointer coordinates toward a synthetic target

Focused verification:

```powershell
npm.cmd test -- src/rendering/pageTurn/physics.test.ts src/rendering/pageTurn/PageTurnSurface.test.tsx src/app/usePageTurn.test.tsx
```

Observed GREEN:

```text
✓ src/rendering/pageTurn/PageTurnSurface.test.tsx (8 tests)
✓ src/rendering/pageTurn/physics.test.ts (14 tests)
✓ src/app/usePageTurn.test.tsx (10 tests)
Test Files  3 passed (3)
Tests  32 passed (32)
```

## Final verification

I accidentally invoked the npm script incorrectly once:

```powershell
npm.cmd build
```

Output:

```text
Unknown command: "build"
Did you mean this?
  npm run build
```

Correct build command:

```powershell
npm.cmd run build
```

Output:

```text
> tactile-reader@0.1.0 build
> tsc -b && vite build
✓ built in 980ms
```

Full suite after the final typing fix:

```powershell
npm.cmd test
```

Output:

```text
Test Files  37 passed (37)
Tests  208 passed (208)
Duration  4.15s
```

## Files changed

- `src/rendering/pageTurn/physics.ts`
- `src/rendering/pageTurn/physics.test.ts`
- `src/rendering/pageTurn/PageTurnSurface.tsx`
- `src/rendering/pageTurn/PageTurnSurface.test.tsx`
- `src/app/usePageTurn.ts`
- `src/app/usePageTurn.test.tsx`

## What changed

- Replaced the purely analytic lattice step with a deterministic analytic-plus-PBD solver.
- Added fixed-step settle state with critically damped pointer target motion and terminal settled flags.
- Exposed `maxStretch`, `maxSpeed`, `droppedSeconds`, and `settled` from solver frames.
- Ensured the spine remains pinned and points are kept on/above the stationary page plane and spine boundary.
- Made RTL snapshots use actual left-to-right control-point order while preserving mirrored geometry.
- Switched surface completion from progress heuristics to solver terminal flags.
- Removed the old JS settle easing path in favor of solver-stepped settling frames.

## Self-review

- The solver remains normalized and CPU-only; it does not depend on React, DOM, GPU APIs, or WebGPU.
- The settle path now terminates on solver tolerances instead of CSS-style terminal progress checks.
- Existing milestone behavior stayed green before the change and the full suite stayed green after the change.
- I kept the changes scoped to page-turn physics/surface/hook flow and did not touch unrelated reader/import/storage behavior.

## Concerns

1. `maxStretch` is currently defined as visible horizontal structural stretch in x/z space rather than a full 3D shear metric. That matches the visual contract and the new invariant test, but if later telemetry wants a more formal material strain metric this should be revisited explicitly.
2. The task brief listed physics and surface files, but `usePageTurn.ts` also needed updating; otherwise the new `settled` flags would never be emitted in the real settling path.

## Outcome

Task 8 milestone gate passed, RED/GREEN cycles were completed for the new physics and terminal settle behavior, build passed, and the full suite passed before commit.
