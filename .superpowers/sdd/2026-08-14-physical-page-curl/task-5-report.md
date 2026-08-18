# Task 5 Report: Generation-Safe Texture Preparation

## Scope delivered

Implemented Task 5 in:

- `src/rendering/pageTurn/textures.ts`
- `src/rendering/pageTurn/textures.test.ts`

Delivered only the injected generation-safe texture-preparation slice:

- deduplicates opaque `PageDescriptor.src` values
- computes effective viewport/DPR downsampled texture requests
- applies `4096` default longest-side cap and optional backend limit
- maintains a six-entry LRU
- emits a `slow` readiness signal after `150 ms`
- disposes stale generation loads
- handles loader errors
- supports `releaseGeneration(...)`
- supports `dispose()`

Did not add renderer/backend integration or source-format branching.

## TDD evidence

### Setup correction

The task brief suggested `--runInBand`, but this repo uses Vitest and rejects that flag. I corrected to the repo-valid focused command before entering the RED/GREEN loop.

Command:

```powershell
npm.cmd test -- --runInBand src/rendering/pageTurn/textures.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run --runInBand src/rendering/pageTurn/textures.test.ts

CACError: Unknown option `--runInBand`
```

### RED 1: missing module

Wrote `src/rendering/pageTurn/textures.test.ts` first, then ran the focused test before any production implementation.

Command:

```powershell
npm.cmd test -- src/rendering/pageTurn/textures.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run src/rendering/pageTurn/textures.test.ts

FAIL  src/rendering/pageTurn/textures.test.ts [ src/rendering/pageTurn/textures.test.ts ]
Error: Failed to resolve import "./textures" from "src/rendering/pageTurn/textures.test.ts". Does the file exist?
```

This was the expected RED: the cache module did not exist yet.

### GREEN attempt 1: one contract still failing

Implemented the first minimal `textures.ts`, then reran the focused suite.

Command:

```powershell
npm.cmd test -- src/rendering/pageTurn/textures.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run src/rendering/pageTurn/textures.test.ts

❯ src/rendering/pageTurn/textures.test.ts (7 tests | 1 failed)
  ✓ prepares unique front, verso, and under textures and caps the longest side
  ✓ applies the backend longest-side limit when it is smaller than the default cap
  × returns a slow readiness signal after 150 ms and publishes ready once loading finishes
  ✓ disposes a stale completed generation instead of publishing it
  ✓ evicts the least recently used entry once the cache exceeds six resident textures
  ✓ reports loader failures as generation-scoped errors
  ✓ disposes every resident texture handle when the cache is disposed
```

The remaining failure showed the same-generation post-`slow` path was re-emitting `slow` instead of awaiting the eventual ready/error result.

### GREEN: focused suite passes

Adjusted the preparation record so `slow` is a one-time provisional signal and subsequent calls for the same generation await `ready`/`error`.

Command:

```powershell
npm.cmd test -- src/rendering/pageTurn/textures.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run src/rendering/pageTurn/textures.test.ts

✓ src/rendering/pageTurn/textures.test.ts (7 tests) 12ms

Test Files  1 passed (1)
     Tests  7 passed (7)
```

## Full-suite verification

Per task requirement, ran the full suite once after the focused GREEN.

Command:

```powershell
npm.cmd test
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run

✓ src/rendering/pageTurn/physics.test.ts (9 tests)
✓ src/domain/pageTurn.test.ts (8 tests)
✓ src/rendering/pageTurn/textures.test.ts (7 tests)
✓ src/domain/pageTurnScene.test.ts (12 tests)
...
Test Files  32 passed (32)
     Tests  169 passed (169)
```

## Implementation notes

### `src/rendering/pageTurn/textures.ts`

- Added `TextureRequest`, `TextureViewport`, `TextureLoader<T>`, `PreparedPageImage`, `PreparedPageTurnTextures<T>`, and `TexturePreparation<T>`.
- Added `PageTurnTextureCache<T>` with:
  - deduplication by opaque `src`
  - viewport/DPR downsampling from `PageDescriptor.width/height`
  - default `4096` cap plus `backendMaxLongestSide`
  - resident-handle LRU using `Map` insertion order
  - generation claim tracking
  - stale generation rejection/disposal
  - one-time `slow` signal after `150 ms`
  - loader error conversion to `{ kind: 'error' }`
  - `releaseGeneration(...)`
  - `dispose()`
  - `keys()` test helper for LRU assertions

### `src/rendering/pageTurn/textures.test.ts`

Added focused unit coverage for:

- unique-source preparation
- longest-side cap at `4096`
- smaller backend limit override
- `150 ms` slow readiness signal
- stale generation disposal on release
- six-entry LRU eviction and touch behavior
- loader error reporting
- cache-wide disposal

## Self-review

- The module stays source-format agnostic and treats `PageDescriptor.src` as opaque data.
- No original filesystem path access was added.
- No PDF/CBZ/CBR/image-folder branching was added.
- No renderer/backend integration was added yet.
- The current cache reuses already-ready resident handles across generations when they remain within the six-entry LRU budget, which matches the task boundary and avoids premature churn.
- The slow-path behavior is intentionally one-shot per generation: first caller may get `slow`, later callers await `ready`/`error`.

## Concerns / follow-up notes

- `PreparedPageImage` is exported now for the downstream decode/upload slice, but this task intentionally stops at the injected preparation boundary.
- If future integration needs multiple size variants for the same `src` to coexist simultaneously, the cache key will need to expand beyond raw `src`. That was not necessary for Task 5’s stated contract and tests.

## Fix round 1: failed pending entry retry

### Review finding verified

The review finding was correct: when `loadTexture(...)` rejected, the pending-map entry for that `src` remained in `pending`, so the next `prepare(...)` reused the same rejected promise and could not retry.

### RED: retry-after-failure regression test

Added a test with a loader that rejects once and resolves on the second call.

Command:

```powershell
npm.cmd test -- src/rendering/pageTurn/textures.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run src/rendering/pageTurn/textures.test.ts


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design

 ❯ src/rendering/pageTurn/textures.test.ts (8 tests | 1 failed) 20ms
   ✓ PageTurnTextureCache > prepares unique front, verso, and under textures and caps the longest side 4ms
   ✓ PageTurnTextureCache > applies the backend longest-side limit when it is smaller than the default cap 0ms
   ✓ PageTurnTextureCache > returns a slow readiness signal after 150 ms and publishes ready once loading finishes 3ms
   ✓ PageTurnTextureCache > disposes a stale completed generation instead of publishing it 1ms
   ✓ PageTurnTextureCache > evicts the least recently used entry once the cache exceeds six resident textures 1ms
   ✓ PageTurnTextureCache > reports loader failures as generation-scoped errors 0ms
   × PageTurnTextureCache > retries a source after a failed pending load instead of reusing the rejected promise 8ms
     → expected { kind: 'error', generation: 11, …(1) } to match object { kind: 'ready', generation: 11, …(1) }
(1 matching property omitted from actual)
   ✓ PageTurnTextureCache > disposes every resident texture handle when the cache is disposed 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/rendering/pageTurn/textures.test.ts > PageTurnTextureCache > retries a source after a failed pending load instead of reusing the rejected promise
AssertionError: expected { kind: 'error', generation: 11, …(1) } to match object { kind: 'ready', generation: 11, …(1) }
(1 matching property omitted from actual)

- Expected
+ Received

  {
    "generation": 11,
-   "kind": "ready",
-   "textures": {
-     "count": 1,
-   },
+   "kind": "error",
  }

 ❯ src/rendering/pageTurn/textures.test.ts:275:5
    273|     });
    274| 
    275|     await expect(
       |     ^
    276|       cache.prepare(createSingleSourceScene('asset://retry'), 11, { wi…
    277|     ).resolves.toMatchObject({

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
   Start at  17:17:34
   Duration  818ms (transform 47ms, setup 14ms, collect 38ms, tests 20ms, environment 415ms, prepare 100ms)
```

### Fix summary

Applied the smallest fix in `resolveTexture(...)`:

- wrap the pending load promise with a rejection handler
- if the rejecting promise is still the current pending entry for that `src`, delete it from `pending`
- rethrow the same error so the current generation still reports `{ kind: 'error' }`

This preserves:

- successful cached-handle reuse
- stale-generation disposal on late success
- retry behavior on later prepares for the same `src`

### GREEN: focused verification after the fix

Command:

```powershell
npm.cmd test -- src/rendering/pageTurn/textures.test.ts
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run src/rendering/pageTurn/textures.test.ts


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design

 ✓ src/rendering/pageTurn/textures.test.ts (8 tests) 12ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  17:17:54
   Duration  792ms (transform 47ms, setup 13ms, collect 38ms, tests 12ms, environment 412ms, prepare 98ms)
```

### Full-suite verification after the fix

Command:

```powershell
npm.cmd test
```

Output:

```text
> tactile-reader@0.1.0 test
> vitest run


 RUN  v3.2.7 C:/Users/adenilson.j/Documents/ChatGPT/leitor/.worktrees/physical-page-curl-design

 ✓ src/rendering/pageTurn/textures.test.ts (8 tests) 17ms
 ✓ src/domain/flow.test.ts (4 tests) 20ms
 ✓ src/domain/library.test.ts (6 tests) 22ms
 ✓ src/rendering/pageTurn/physics.test.ts (9 tests) 18ms
 ✓ src/services/importers.test.ts (3 tests) 21ms
 ✓ src/services/storage.test.ts (7 tests) 15ms
 ✓ src/app/LiveAnnouncement.test.tsx (3 tests) 43ms
 ✓ src/app/ZoomControls.test.tsx (3 tests) 65ms
 ✓ src/services/readerState.test.ts (3 tests) 11ms
 ✓ src/app/PageNavigator.test.tsx (6 tests) 144ms
 ✓ src/app/SmokeHarness.test.tsx (9 tests) 148ms
 ✓ src/app/ProfilePanel.test.tsx (4 tests) 200ms
 ✓ src/app/LibraryView.test.tsx (12 tests) 530ms
 ✓ src/app/AppNativeImport.test.tsx (7 tests) 306ms
 ✓ src/app/AppAnnouncements.test.tsx (1 test) 697ms
   ✓ application live-region wiring > announces reader navigation and renderer state through real consumers  696ms
 ✓ src/domain/profiles.test.ts (6 tests) 13ms
 ✓ src/domain/pageTurnScene.test.ts (12 tests) 10ms
 ✓ src/domain/pageTurn.test.ts (8 tests) 13ms
 ✓ src/app/nativeImportFlow.test.ts (4 tests) 9ms
 ✓ src/domain/readerState.test.ts (3 tests) 7ms
 ✓ src/domain/reader.test.ts (8 tests) 8ms
 ✓ src/domain/pageTurnGeometry.test.ts (10 tests) 8ms
 ✓ src/domain/pageSelection.test.ts (4 tests) 7ms
 ✓ src/rendering/telemetry.test.ts (4 tests) 6ms
 ✓ src/release/testModes.test.ts (7 tests) 6ms
 ✓ src/domain/input.test.ts (4 tests) 7ms
 ✓ src/rendering/contracts.test.ts (3 tests) 6ms
 ✓ src/rendering/pageTurn/mesh.test.ts (4 tests) 5ms
 ✓ src/domain/covers.test.ts (3 tests) 3ms
 ✓ src/services/flowStorage.test.ts (1 test) 3ms
 ✓ src/i18n/catalog.test.ts (3 tests) 3ms
 ✓ tests/visual/visual-matrix.test.ts (1 test) 2ms

 Test Files  32 passed (32)
      Tests  170 passed (170)
   Start at  17:18:02
   Duration  3.68s (transform 1.73s, setup 379ms, collect 4.83s, tests 2.37s, environment 25.91s, prepare 4.61s)
```
