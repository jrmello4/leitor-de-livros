# Task 3 report: Transformed Edge Hit Testing and Release Velocity

Implemented:

- `src/domain/pageTurnGeometry.ts`
- `src/domain/pageTurnGeometry.test.ts`

What it covers:

- activation band clamp at `28 / 8% / 72`
- client-to-page inverse normalization for zoom + pan
- visible outer-edge hit testing across the full edge
- clipped transformed page bounds
- LTR / RTL mirroring
- short velocity window
- zero-time velocity
- direction-aware positive turn displacement

## TDD evidence

### RED

Command:

```powershell
npm.cmd test -- --configLoader runner src/domain/pageTurnGeometry.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run --configLoader runner src/domain/pageTurnGeometry.test.ts


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design


⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/domain/pageTurnGeometry.test.ts [ src/domain/pageTurnGeometry.test.ts ]
Error: Failed to resolve import "./pageTurnGeometry" from "src/domain/pageTurnGeometry.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design/src/domain/pageTurnGeometry.test.ts:8:7
  6  |    turnDisplacement,
  7  |    VelocityTracker
  8  |  } from "./pageTurnGeometry";
     |          ^
  9  |  describe("page turn geometry", () => {
  10 |    it.each([

⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
   Start at  16:22:16
   Duration  1.01s (transform 15ms, setup 11ms, collect 0ms, tests 0ms, environment 565ms, prepare 130ms)
```

### GREEN

Command:

```powershell
npm.cmd test -- --configLoader runner src/domain/pageTurnGeometry.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run --configLoader runner src/domain/pageTurnGeometry.test.ts


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design

 ✓ src/domain/pageTurnGeometry.test.ts (8 tests) 4ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  16:22:52
   Duration  835ms (transform 24ms, setup 10ms, collect 25ms, tests 4ms, environment 464ms, prepare 108ms)
```

### Full suite

Command:

```powershell
npm.cmd test -- --configLoader runner
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run --configLoader runner


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design

 ✓ src/domain/flow.test.ts (4 tests) 24ms
 ✓ src/domain/library.test.ts (6 tests) 25ms
 ✓ src/domain/profiles.test.ts (6 tests) 11ms
 ✓ src/domain/pageTurnScene.test.ts (12 tests) 8ms
 ✓ src/services/importers.test.ts (3 tests) 27ms
 ✓ src/services/storage.test.ts (7 tests) 13ms
 ✓ src/app/ZoomControls.test.tsx (3 tests) 64ms
 ✓ src/app/LiveAnnouncement.test.tsx (3 tests) 46ms
 ✓ src/app/SmokeHarness.test.tsx (9 tests) 141ms
 ✓ src/services/readerState.test.ts (3 tests) 14ms
 ✓ src/app/PageNavigator.test.tsx (6 tests) 151ms
 ✓ src/app/ProfilePanel.test.tsx (4 tests) 197ms
 ✓ src/app/LibraryView.test.tsx (12 tests) 542ms
 ✓ src/app/AppNativeImport.test.tsx (7 tests) 284ms
 ✓ src/app/AppAnnouncements.test.tsx (1 test) 725ms
   ✓ application live-region wiring > announces reader navigation and renderer state through real consumers  723ms
 ✓ src/domain/pageTurn.test.ts (8 tests) 12ms
 ✓ src/services/flowStorage.test.ts (1 test) 7ms
 ✓ src/domain/readerState.test.ts (3 tests) 8ms
 ✓ src/domain/reader.test.ts (8 tests) 9ms
 ✓ src/domain/input.test.ts (4 tests) 7ms
 ✓ src/domain/pageSelection.test.ts (4 tests) 8ms
 ✓ src/rendering/telemetry.test.ts (4 tests) 7ms
 ✓ src/release/testModes.test.ts (7 tests) 7ms
 ✓ src/domain/covers.test.ts (3 tests) 6ms
 ✓ src/rendering/contracts.test.ts (3 tests) 6ms
 ✓ src/i18n/catalog.test.ts (3 tests) 5ms
 ✓ src/domain/pageTurnGeometry.test.ts (8 tests) 4ms
 ✓ tests/visual/visual-matrix.test.ts (1 test) 2ms

 Test Files  29 passed (29)
      Tests  147 passed (147)
   Start at  16:22:59
   Duration  3.70s (transform 1.78s, setup 299ms, collect 5.39s, tests 2.37s, environment 27.63s, prepare 4.89s)
```

## Notes

- Kept the implementation limited to the requested geometry/velocity module.
- No unrelated files were modified.
