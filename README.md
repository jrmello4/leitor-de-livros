# Tactile Reader

> A local-first Windows reader built around the feeling of touching and turning a real comic page.

## The idea

Most digital readers treat comics as static images inside a file browser. Tactile Reader is designed around the reading moment itself: a page that bends under the pointer, a transition that follows the reader's gesture, and an adaptive flow that understands panel order without taking control away.

The first version is planned for Windows 10/11 x64 and local CBZ, CBR, PDF, and image folders. The current native
slice supports raster image folders, CBZ, CBR, and PDF. PDF import requires a PDFium runtime beside the application
or available as a system library; without it, the importer reports an actionable diagnostic and preserves the source.

## What makes it different

- **Tactile page turning:** drag a corner and control the fold, light, shadow, reveal, inertia, completion, and cancellation in real time.
- **Adaptive Flow:** detect left-to-right or right-to-left panel order locally, begin from the full composition, and guide focus only when wanted.
- **Fluidity first:** target 60 FPS on common PCs and use high-refresh displays automatically, reducing effect complexity before motion stutters.
- **Deep personalization:** tune colors, paper, contrast, physics, camera, shortcuts, and control placement through safe, reusable profiles.
- **Private by design:** publications, analysis, progress, and profiles stay on the device; source files remain read-only.
- **Graceful fallback:** WebGPU → WebGL2 → accessible static pages, without interrupting a reading session.

## Default experience

The default library uses the **Paper Atelier** direction: saturated bookcloth, ink, brass, crop marks, stacked jackets, and restrained editorial controls. The interface recedes when a publication opens, leaving the page as the dominant object.

Customization is progressive: useful presets remain close at hand, while an advanced studio exposes the complete system. Layout controls move between safe top, bottom, left, and right zones so experimentation remains reversible and accessible.

## Planned architecture

- Tauri 2 desktop shell
- Rust local core and importer boundaries
- React, TypeScript, and Vite interface
- SQLite library, progress, corrections, and profiles
- WebGPU renderer with WebGL2 fallback
- Geometry-first panel analysis with a local ONNX fallback model
- PDFium for PDF rendering; ZIP/UnRAR adapters for CBZ/CBR

## V1 scope

The first delivery covers:

- local import and deduplication;
- continue reading, search, sort, covers, and progress;
- single pages, spreads, fullscreen, RTL/LTR, keyboard, wheel, and pointer navigation;
- tactile page physics and Adaptive Flow correction;
- named, versioned, importable/exportable profiles;
- English UI prepared for later localization.

EPUB, accounts, cloud synchronization, online metadata, a store, discovery, and the download website are intentionally outside v1.

## Project status

The product concept and engineering design are approved. The current slice includes the React/Vite reader plus a
Tauri native core for SQLite library/progress/profile persistence, safe raster image, CBZ, CBR, and PDF import, and
derived page caching. PDF pages are rendered into bounded PNG cache entries; CBR pages are extracted through the
native UnRAR adapter. The reader uses WebGPU first, then WebGL2, then an accessible static page, retaining adjacent
pages and reducing effects before it sacrifices frame time.

Adaptive Flow now performs geometry-only analysis on-device and stores a versioned panel graph per publication/page.
The reader reveals its panel markers only on request; a reader can swap two detected markers or select a persistent
full-page manual route for low-confidence pages. No ONNX weights are bundled yet: that fallback remains deliberately
deferred until a licensed model and validation set are supplied. The browser fallback remains available for review;
installer smoke tests, reference-hardware performance work, and signed production packaging remain subsequent phases.

The Windows x64 package includes the compatible PDFium runtime as a Tauri resource. The native core first resolves
that bundled DLL, then a side-by-side executable DLL, then a system library; it surfaces a diagnostic if none can be
loaded. PDFium and third-party license notices ship under the package `licenses/pdfium/` directory.

Read the complete design specification in [docs/superpowers/specs/2026-08-11-tactile-comic-reader-design.md](docs/superpowers/specs/2026-08-11-tactile-comic-reader-design.md).

Read the prioritized product improvement roadmap in [docs/roadmap-melhorias.md](docs/roadmap-melhorias.md).
