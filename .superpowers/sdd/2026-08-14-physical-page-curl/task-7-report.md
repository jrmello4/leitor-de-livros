# Task 7 Report — Reader Pointer, Synthetic Input, Zoom, and Reduced Motion Integration

Date: August 14, 2026
Branch: `codex/physical-page-curl-design`
Worktree: `C:\Users\adenilson.j\Documents\ChatGPT\leitor\.worktrees\physical-page-curl-design`

## Scope delivered

Implemented Task 7 integration work for:

- `usePageTurn` hook orchestration
- `ReaderView` integration
- `PageTurnSurface` mount path
- pointer capture + outer-edge geometry
- synthetic 62% automatic turn path for adjacent actions
- touch/pen-compatible pointer handling
- zoom/pan transform-aware hit testing
- interruption cancellation hooks
- latest-request queue fallback behavior
- format-agnostic `PageDescriptor.src` scene usage
- reduced-motion immediate navigation with no physical overlay
- `ReaderSurface` semantic idle DOM behavior
- removal of the old CSS curl/page-enter path after the GPU path was wired

Out-of-scope items intentionally left untouched per brief:

- no PDF/CBZ/CBR renderer branching
- no PBD/flex Task 8 work
- no WebGPU Task 9 work

## TDD log

### RED 1 — initial focused task tests

Command:

```powershell
npm.cmd test -- src/app/usePageTurn.test.tsx src/app/ReaderView.test.tsx src/rendering/ReaderSurface.test.tsx src/rendering/contracts.test.ts
```

First attempt inside sandbox failed before test execution because Vite could not resolve the linked worktree config. I reran the same focused suite outside the sandbox for the worktree.

Rerun command:

```powershell
npm.cmd test -- src/app/usePageTurn.test.tsx src/app/ReaderView.test.tsx src/rendering/ReaderSurface.test.tsx src/rendering/contracts.test.ts
```

Relevant RED output:

```text
FAIL  src/app/usePageTurn.test.tsx
Error: Failed to resolve import "./usePageTurn"

FAIL  src/app/ReaderView.test.tsx
expected null not to be null

FAIL  src/rendering/ReaderSurface.test.tsx
expected '' to be '0'
```

Interpretation:

- `usePageTurn` did not exist yet.
- `ReaderView` did not mount `PageTurnSurface` for adjacent automatic actions.
- `ReaderSurface` still hid the static semantic layer incorrectly for the new idle-overlay contract.

### GREEN 1 — hook + ReaderView + semantic overlay + static render contract

Implemented:

- new `src/app/usePageTurn.ts`
- `ReaderView` migration from CSS curl/timer progress to hook-driven GPU overlay integration
- `RenderFrame`/`buildRenderPlan()` removal of static DOM deformation fields
- `ReaderSurface` hidden-static semantic treatment
- CSS removal of the old curl/page-enter path

Focused rerun command:

```powershell
npm.cmd test -- src/app/usePageTurn.test.tsx src/app/ReaderView.test.tsx src/rendering/ReaderSurface.test.tsx src/rendering/contracts.test.ts
```

Output:

```text
✓ src/rendering/contracts.test.ts
✓ src/rendering/ReaderSurface.test.tsx
✓ src/app/usePageTurn.test.tsx
✓ src/app/ReaderView.test.tsx

Test Files  4 passed (4)
Tests  19 passed (19)
```

### RED/GREEN 2 — focused integration set from the task brief

Command:

```powershell
npm.cmd test -- src/app/usePageTurn.test.tsx src/app/ReaderView.test.tsx src/rendering/ReaderSurface.test.tsx src/rendering/contracts.test.ts src/app/AppAnnouncements.test.tsx src/app/AppNativeImport.test.tsx
```

First run exposed a real integration bug:

```text
FAIL  src/app/AppAnnouncements.test.tsx
Error: WebGL2 is not available.
```

Cause:

- `PageTurnSurface` still let WebGL2 initialization escape as an unhandled failure in jsdom-like/non-WebGL environments.

Fix:

- stubbed test canvas context to `null` in `src/test/setup.ts`
- caught `createPageTurnWebGl2()` initialization failure in `src/rendering/pageTurn/PageTurnSurface.tsx`
- preserved immediate automatic fallback through the hook’s failure path

Focused rerun command:

```powershell
npm.cmd test -- src/app/usePageTurn.test.tsx src/app/ReaderView.test.tsx src/rendering/ReaderSurface.test.tsx src/rendering/contracts.test.ts src/app/AppAnnouncements.test.tsx src/app/AppNativeImport.test.tsx
```

Output:

```text
✓ src/rendering/contracts.test.ts
✓ src/rendering/ReaderSurface.test.tsx
✓ src/app/usePageTurn.test.tsx
✓ src/app/ReaderView.test.tsx
✓ src/app/AppNativeImport.test.tsx
✓ src/app/AppAnnouncements.test.tsx

Test Files  6 passed (6)
Tests  27 passed (27)
```

### Build verification

Command:

```powershell
npm.cmd run build
```

First run caught a TypeScript narrowing issue around `progress` access and was fixed by normalizing `surfaceInput.progress`.

Successful rerun output:

```text
> tactile-reader@0.1.0 build
> tsc -b && vite build

vite v7.3.6 building client environment for production...
✓ 76 modules transformed.
dist/index.html                   0.58 kB │ gzip:   0.34 kB
dist/assets/index-BRFVj7FP.css   30.93 kB │ gzip:   6.91 kB
dist/assets/index-CWHhl4vS.js   360.54 kB │ gzip: 111.30 kB
✓ built in 1.01s
```

### Full suite verification

Command:

```powershell
npm.cmd test
```

Output:

```text
Test Files  37 passed (37)
Tests  198 passed (198)
```

### Old CSS curl removal verification

Command:

```powershell
rg -n "curl-layer|page-enter-forward|page-enter-backward|curl-glint" src
```

Output:

```text
(no matches; rg exit code 1)
```

## Files changed

Created:

- `src/app/usePageTurn.ts`
- `src/app/usePageTurn.test.tsx`
- `src/app/ReaderView.test.tsx`
- `src/rendering/ReaderSurface.test.tsx`

Modified:

- `src/app/ReaderView.tsx`
- `src/app/styles.css`
- `src/rendering/ReaderSurface.tsx`
- `src/rendering/contracts.ts`
- `src/rendering/contracts.test.ts`
- `src/rendering/pageTurn/PageTurnSurface.tsx`
- `src/test/setup.ts`

## Behavioral notes

- Pointer turns now start from the visible outer edge rather than the old bottom-corner-only heuristic.
- The hook normalizes pointer grab height across the whole edge and preserves zoom/pan transform awareness.
- Adjacent automatic actions now share a synthetic 62%-height physical path instead of bypassing the turn state machine.
- Reduced motion stays strict: immediate navigation, no decorative canvas.
- Automatic fallback now survives non-WebGL test/runtime environments instead of crashing.
- Static DOM page/article semantics remain mounted when the idle GPU layer becomes the visual layer.

## Self-review

What I checked against the brief/spec:

- `usePageTurn` exists and is integrated into `ReaderView`.
- `ReaderView` no longer relies on the old CSS curl/timer path.
- `PageTurnSurface` is mounted only through the new GPU path.
- `RenderFrame` no longer carries `turningPageId` / `turnProgress`.
- Reduced motion path performs immediate navigation and does not mount the turn overlay.
- Adjacent actions and registered app actions route through the shared request path.
- Format-specific fixtures still use `PageDescriptor.src` directly, with no format branches added.
- Full suite and build are green after the integration.

## Concerns / follow-up notes

1. The hook’s “replay latest queued request if the controller snapshot returns to idle after cancel” logic is intentionally conservative and exists as an integration safety net above the controller’s own queue behavior. It passed tests, but it is the part I would watch first if future task work deepens queue semantics.

2. `src/test/setup.ts` now forces canvas `getContext()` to return `null` in the test environment so jsdom does not emit noisy “not implemented” errors. That is appropriate for this suite because physical-turn behavior is already covered by dedicated unit/integration tests with mocked backends, but it is worth remembering if a future test needs a richer canvas stub.

3. The current Task 7 implementation keeps the physical turn path scoped to the approved WebGL2 milestone. It does not attempt secondary flex/material/backend expansion from Tasks 8 or 9.
