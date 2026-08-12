# Implementation slices

## Delivered in 0.1.0

- React, TypeScript, Vite, and a minimal Tauri 2 shell.
- Local-first library screen with a built-in, license-free paper study.
- Image-set import and CBZ import with natural page ordering.
- Single-page and spread reading, LTR/RTL direction, keyboard and wheel navigation.
- Pointer-driven corner drag with a reduced-motion path and cancel/commit threshold.
- Named input actions with conflict-checked keyboard rebinding.
- Local reader preferences and per-publication progress in `localStorage`.
- Responsive layout, visible focus, status announcements, and empty/error states.
- Native Tauri bridge for library listing, import, progress, and profile persistence.
- Versioned SQLite schema with an idempotent migration, WAL mode, and derived page cache.
- Native image-folder and CBZ import with natural ordering, read-only sources, duplicate detection,
  archive traversal checks, encrypted-entry rejection, and resource limits.
- Native CBR import through UnRAR with natural ordering, duplicate detection, traversal checks, encrypted/split-entry
  rejection, and resource limits.
- Native PDF import through PDFium into bounded PNG cache entries, with page/resource limits and explicit runtime
  availability diagnostics.
- Bundled Windows x64 PDFium runtime pinned to the ABI used by `pdfium-render`, including third-party notices and a
  two-page end-to-end PDF import fixture.
- Isolated WebGPU canvas renderer with WebGL2 and accessible static-page fallback, three-page decoded/texture retention,
  and adaptive effect quality based on sampled frame time.
- Geometry-first Adaptive Flow that analyzes pages locally, records a versioned panel graph, overlays panel order only
  when requested, and persists order/manual-route corrections per publication and page in local storage and SQLite.

## Deliberate next slices

1. Add a locally licensed ONNX fallback only after its weights and a representative validation set are selected; low
   confidence currently offers a persistent full-page manual route instead of fabricating a model.
2. Add golden visual fixtures for panel geometry, correction order, and renderer folding across the GPU backends.
3. Windows installer smoke tests, reference-hardware performance validation, and signed packaging.

The browser fallback remains intentionally runnable so interaction and layout can be reviewed without a native
runtime. The current native slice supports raster image folders, CBZ, CBR, and PDF. The bundle configuration now
ships the compatible Windows x64 `pdfium.dll`; installer smoke tests and signed production packaging remain outside
this phase. Adaptive analysis is local geometry plus a manual route; no model weights are bundled yet.
