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
