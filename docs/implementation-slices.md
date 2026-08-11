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

## Deliberate next slices

1. Native Rust importer boundaries and SQLite persistence inside Tauri.
2. PDFium and UnRAR adapters with extraction limits, notices, and failure diagnostics.
3. WebGPU renderer, WebGL2 fallback, static-page mode, and release-build frame telemetry.
4. Geometry-first Adaptive Flow, bundled ONNX fallback, panel corrections, and golden fixtures.
5. Windows installer smoke tests, reference-hardware performance validation, and signed packaging.

The first slice is intentionally runnable in a browser so interaction and layout can be reviewed before native
storage and renderer work add platform-specific complexity.
