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

## Deliberate next slices

1. WebGPU renderer, WebGL2 fallback, static-page mode, and release-build frame telemetry.
2. Geometry-first Adaptive Flow, bundled ONNX fallback, panel corrections, and golden fixtures.
3. Windows installer smoke tests, reference-hardware performance validation, and signed packaging.

The browser fallback remains intentionally runnable so interaction and layout can be reviewed without a native
runtime. The current native slice supports raster image folders, CBZ, CBR, and PDF. PDFium remains an explicit
distribution dependency: the application must ship/load a compatible `pdfium.dll` before PDF rendering can run.
Adaptive analysis and production packaging remain outside this phase.
