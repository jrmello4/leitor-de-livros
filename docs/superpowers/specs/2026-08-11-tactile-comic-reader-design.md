# Tactile and Adaptive Comic Reader — Windows v1 Design

## Product intent

Build a local-first Windows 10/11 x64 desktop reader for CBZ, CBR, PDF, and image folders. Its defining experience combines an adaptive panel-reading flow with a direct-manipulation page curl that feels like turning a physical comic page. Rendering fluidity wins over visual fidelity whenever hardware cannot sustain both.

The first delivery contains the desktop application and a minimal local library. EPUB, accounts, cloud sync, a download website, stores, catalogues, and online metadata are outside v1.

## Experience

The application opens into a warm, editorial “Paper Atelier” library. Readers can import files or folders, continue recent publications, search, sort, change a local cover, and see progress. Opening a publication moves into a distraction-free reader.

Adaptive Flow detects left-to-right or right-to-left reading, identifies panels, and begins from the full-page composition. Assistance appears as the reader advances. Incorrect direction, regions, or order can be corrected quickly and stored as publication-specific overrides.

The signature page turn follows a dragged corner in real time. Fold geometry, front and back surfaces, light, shadow, reveal, inertia, completion, and cancellation respond to the pointer. Click, wheel, and arrow-key navigation trigger the same physical transition automatically. Single page, spreads, fullscreen, reduced motion, and both reading directions are supported.

## Customization

The surface remains simple through presets while an advanced studio exposes theme, texture, contrast, scale, page physics, shadow, transition speed, camera behavior, keyboard commands, and layout. Controls can move between safe top, bottom, left, and right zones; arbitrary overlapping coordinates are not allowed.

Named profiles use this precedence:

1. application defaults;
2. global profile;
3. format or reading-direction rule;
4. publication override.

Profiles are versioned, importable, exportable, previewable, undoable, and restorable. Exports contain no library history or file paths.

## Architecture

The application uses Tauri 2 with a Rust core and a React/TypeScript/Vite frontend. SQLite stores library metadata, progress, analysis corrections, and profiles. Source publications remain read-only; derived pages, thumbnails, analysis, and indexes live in the application-data cache.

Importers are isolated behind one interface:

- CBZ via ZIP;
- CBR via UnRAR with all required upstream notices;
- PDF via a pinned PDFium build and `pdfium-render`;
- JPEG, PNG, WebP, and AVIF images, including naturally sorted folders.

The importer rejects path traversal, decompression bombs, extreme dimensions, unsupported encryption, and excessive resource use. Corrupt or unsupported publications remain visible with a diagnostic and retry action.

The reader renderer is isolated from the React interface. WebGPU is primary and WebGL2 is the fallback. It keeps the previous, current, and next pages decoded and, when possible, GPU resident. Quality tiers reduce mesh density, shadows, and lighting before frame rate falls.

Panel analysis first uses fast gutter and contour geometry. The current delivery deliberately stops at a persistent
manual route for low-confidence pages because no licensed ONNX weights or release validation set are committed to the
repository. When supplied, a locally bundled ONNX model can become the next fallback without changing the versioned
panel-graph contract (regions, order, direction, framing, confidence, and user overrides). Failure falls back from
model to geometry to manual reading without interrupting the session.

## Core contracts

- `Publication`: identity, source path, format, pages, cover, progress, and diagnostic.
- `PageDescriptor`: index, dimensions, orientation, and a safe local texture URI.
- `PanelGraph`: panel regions and relationships, sequence, direction, confidence, and corrections.
- `ReadingProfile`: visual tokens, paper physics, camera, commands, layout zones, and automatic rules.
- `ReaderSession`: publication, current page, mode, zoom, progress, and cache state.
- `RenderBackend`: common lifecycle and rendering interface implemented by WebGPU and WebGL2.

Persisted contracts carry explicit schema versions and migrations.

## Library scope

V1 supports file/folder import, source-identity deduplication, continue reading, all-publications grid, title or filename search, progress, local cover replacement, and sorting by recent, title, or date added. It does not include accounts, online metadata, synchronization, a store, or discovery.

The UI ships in English only, with all user-facing strings externalized for later localization.

## Failure behavior

- GPU initialization failure switches from WebGPU to WebGL2 and then to an accessible static-page mode.
- Model failure uses geometric analysis; low confidence remains user-correctable.
- Cache pressure evicts derived least-recently-used data without removing originals, profiles, progress, or corrections.
- Interrupted writes use SQLite transactions and atomic profile replacement.
- A bad publication cannot terminate the reader or block the rest of the library.

## Acceptance criteria

- Page curl sustains 60 FPS at the 95th percentile on the reference Windows 10/11 x64 integrated-GPU system, displays pointer response in the next frame, and never exposes a blank frame.
- High-refresh displays are used automatically up to 120 Hz.
- Adjacent pages are ready before ordinary navigation; a loading affordance is reserved for non-adjacent uncached jumps.
- Reading direction and panel order reach at least 95% accuracy on the release validation set; correction takes no more than two gestures.
- Original files are never modified.
- Invalid content, low disk space, graphics fallback, and abrupt shutdown do not lose profiles or recorded progress.
- Library and reader navigation are keyboard-complete, with visible focus, scalable contrast, and reduced-motion behavior.

## Verification strategy

Use unit tests for import validation, natural sorting, contracts, profile precedence, physics, and persistence. Use malformed and fuzzed archive/PDF fixtures for extraction limits. Use golden fixtures for geometric and model panel analysis. Use visual regression fixtures for fold proportions, spreads, cancellation, and both GPU backends. Cover import-to-resume integration, abrupt restart, long-session memory, cache growth, and Windows installer smoke tests.

## Approved defaults

- Windows 10/11 x64, 8 GB RAM, WebGL2-capable integrated GPU minimum.
- Tauri 2, Rust core, React/TypeScript/Vite surface.
- WebView2 Evergreen with capability checks and render fallback.
- Local-only processing and SQLite persistence.
- Adaptive Flow as the default reading mode.
- Tactile page curl as the default page transition.
- Paper Atelier as the default visual theme.
- Fluidity before fidelity on constrained hardware.
