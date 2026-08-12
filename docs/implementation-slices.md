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

## Deliberate next slices

1. PDFium and UnRAR adapters with extraction limits, notices, and failure diagnostics.
2. WebGPU renderer, WebGL2 fallback, static-page mode, and release-build frame telemetry.
3. Geometry-first Adaptive Flow, bundled ONNX fallback, panel corrections, and golden fixtures.
4. Windows installer smoke tests, reference-hardware performance validation, and signed packaging.

The browser fallback remains intentionally runnable so interaction and layout can be reviewed without a native
runtime. The current native slice is limited to raster image folders and CBZ; PDF/CBR, adaptive analysis, and
production packaging remain outside this phase.
