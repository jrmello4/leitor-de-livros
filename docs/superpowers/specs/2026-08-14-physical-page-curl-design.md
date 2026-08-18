# Physical Page Curl Design

## Goal

Replace the current flat `rotateY` page transition with a direct-manipulation paper turn that follows the pointer and visually behaves like a bound sheet. The signature motion must combine a predictable cylindrical fold with constrained physical flex so the outer edge, corners, verso, moving crease, lighting, and projected shadow read as one sheet of paper.

The same interaction applies after a page has been decoded, regardless of whether its source is PDF, CBZ, CBR, or an image folder. Source files remain read-only and are never accessed or rasterized during an active drag.

## User-approved behavior

- The full height of the page's outer edge is grabbable. The spine edge is never a turn handle.
- The exact grab height changes the fold: corner grabs create a diagonal curl; a middle-edge grab creates a more even fold.
- The sheet remains attached to the spine, follows mouse, touch, or pen input, and may be pulled forward or back before release.
- The front surface shows the current page. The verso shows the next sequential page with readable, correctly oriented content. The later page that will remain beneath the turned sheet is ready before motion begins.
- Release commits when either displacement or release velocity expresses a clear turn. Otherwise the sheet returns to its starting position.
- Click, wheel, keyboard, and navigation controls drive the same state machine with a synthetic pointer trajectory.
- Single-page mode uses the inner page edge as an implied spine. Spread mode uses the visible center spine. RTL mirrors geometry, input, texture assignment, shadow, and destination order.
- Manual zoom and pan are preserved. A curl begins only when the transformed outer edge is visible and grabbed.
- Reduced-motion mode performs an immediate page change with no curl, fade, slide, or decorative transition.
- There is no visually inferior CSS curl fallback. If the GPU path cannot sustain the minimum physical effect, navigation changes the page immediately.
- Paper material is selected automatically. Users do not choose paper stiffness or simulation quality.

## Non-goals

- Do not modify import, PDFium, archive extraction, persistence, or source files.
- Do not add sound, haptics, free-form page crumpling, torn paper, or a general cloth engine.
- Do not expose mesh density, solver iterations, stiffness, or backend controls in normal settings.
- Do not replace the existing reader, zoom system, Adaptive Flow, library, or profile model beyond the page-turn fields required by this feature.

## Interaction model

The outer-edge activation band spans the page height and uses a default width of `clamp(28px, 8% of the transformed page width, 72px)`. Hover or pen proximity may lift the edge by at most three percent of normalized turn progress. Reduced-motion mode has no hover lift.

Pointer-down captures the pointer and records the normalized grab point in page-local coordinates. Pointer movement is transformed through the current zoom and pan matrix before reaching the physics solver. The pointer remains authoritative while dragging; physics may lag corners but not the grabbed point.

On release, the default commit rules are:

- commit when normalized fold displacement is at least `0.45`; or
- commit when release velocity toward the destination is at least `0.65` page widths per second and displacement is at least `0.12`;
- otherwise cancel.

These constants live in the physics contract and may later be profile-controlled, but v1 does not expose them. Commit and cancellation use critically damped settling, not a fixed CSS transition. The publication index changes only after a committed sheet reaches its terminal pose. Cancellation never changes progress.

Automatic turns use a synthetic grab at 62 percent of page height and a short curved trajectory through the same controller and solver. Repeated navigation is serialized: one active turn may finish, then at most one latest requested destination is executed. Stale requests are discarded with the existing page-selection generation rules.

## State machine

`PageTurnController` owns a closed state union:

- `idle`
- `preparing`, with requested direction and texture generation
- `dragging`, with pointer id, grab point, current point, velocity, and solver state
- `settling`, with outcome `commit` or `cancel`
- `committed`, waiting for the publication index and texture scene to acknowledge the destination
- `disabled`, with reason `reduced-motion`, `backend`, `performance`, or `texture`

Only `committed` may call the navigation callback. A resize, fullscreen geometry change, publication change, texture-generation mismatch, backend loss, or unmount cancels the active generation. If cancellation cannot be rendered safely, the visual overlay disappears and the current index remains unchanged.

## Page and texture mapping

`PageTurnScene` is a pure mapping from publication pages, current index, display mode, direction, and turn direction to semantic surfaces:

- stationary visible pages;
- turning front;
- turning verso;
- destination page beneath the lifted sheet; and
- the committed visible spread or single page.

The mapping must account for up to four unique page textures during a spread turn. Missing boundary pages use the existing paper/background surface, never a fabricated duplicate page. The verso texture is transformed so text and artwork are readable when the sheet lands; face orientation must not accidentally mirror the page.

Adjacent textures are decoded before ordinary motion and uploaded before entering `dragging` or an automatic `settling` turn. A texture wait shorter than 150 ms may keep the edge in `preparing`; longer waits show the existing reader loading affordance and do not begin a partial curl. Non-adjacent uncached jumps remain direct page selections.

Texture preparation operates on safe page image URIs only. It downsamples to the effective transformed viewport and device pixel ratio, never exceeding the backend texture limit or 4096 pixels on the longest side by default. The turn cache holds only the active scene and adjacent candidates, with a target of no more than six GPU-resident page textures. Backend loss releases all turn textures.

## Hybrid paper physics

`PaperPhysicsSolver` combines two layers in one deterministic solver:

1. An analytic cylindrical fold supplies the stable global shape, fold axis, radius, front/back orientation, and spine attachment.
2. A low-resolution position-based dynamics control lattice supplies secondary torsion, corner lag, bending resistance, and settling.

The physical lattice applies:

- pinned spine constraints;
- a hard pointer constraint at the grabbed outer-edge point;
- distance constraints that prevent visible stretching;
- bend constraints that model paper stiffness;
- collision constraints against the stationary page plane and spine boundary;
- velocity damping and bounded angular velocity; and
- finite-value and maximum-displacement guards.

The solver uses a fixed 1/120-second step, accumulates real frame time, and runs no more than four substeps per rendered frame. Excess accumulated time is dropped rather than causing a spiral of death. All public inputs and outputs use normalized page-local coordinates so single, spread, zoom, viewport size, and DPI do not change the physical constants.

The automatic material targets moderately stiff coated comic paper. Automatic quality changes numerical detail, not the intended stiffness, timing, or visual identity.

## Rendering architecture

The feature is split into deep modules with explicit contracts:

- `PageTurnController`: input, state transitions, generations, release decisions, and navigation ownership.
- `PageTurnScene`: source-independent front/verso/under-page mapping and texture readiness.
- `PaperPhysicsSolver`: normalized deterministic physics with no React, DOM, or GPU dependency.
- `PageTurnRenderer`: common uniforms, mesh topology, texture bindings, lighting parameters, and backend lifecycle.
- WebGL2 and WebGPU adapters: shader compilation, buffer upload, draw submission, loss handling, and telemetry only.

The control lattice is small and CPU-solvable. The GPU interpolates it over the visual mesh, avoiding a large JavaScript cloth simulation while keeping WebGL2 and WebGPU behavior aligned. Both backend shaders consume the same versioned uniform schema and control-point ordering.

Rendering uses front-face and back-face texture sampling, corrected verso UV orientation, a bounded crease highlight, paper-back attenuation, self-shadow, and a projected shadow on stationary pages. Lighting may modulate page luminance only within a conservative range, initially 0.72 to 1.08, so colorful art remains legible. Shadows and highlights are clipped to the reader stage and never cover controls or diagnostics.

The current CSS `.curl-layer` transition is removed after the GPU turn reaches parity. Static DOM page sheets remain the authoritative idle and accessibility representation. The GPU canvas is an interaction overlay and must not hide idle content before all required resources are ready.

## Automatic quality and performance

The existing renderer telemetry selects quality with hysteresis. Initial quality targets are:

| Tier | Control lattice | Visual mesh | Physics iterations | Shadows |
| --- | --- | --- | --- | --- |
| rich | 9×7 | 48×32 | 6 | full crease, self-shadow, projected soft shadow |
| balanced | 7×5 | 32×24 | 4 | full crease, simplified projected shadow |
| essential | 5×4 | 20×14 | 3 | crease and one bounded projected shadow |

These are starting budgets, not persisted user settings. The implementation may tune them from measured evidence while retaining one visual language.

Quality drops before visible stutter and does not change during a single drag unless the frame budget is critically exceeded. A tier may recover only after five seconds of stable idle telemetry. If essential quality exceeds 32 ms frame time at p95 over a 20-frame interaction window, physical turns are disabled for the remainder of the reader session and subsequent navigation is immediate. This is not presented as a different animation.

The implementation must:

- answer pointer movement on the next animation frame;
- avoid synchronous image decode, PDF rasterization, shader compilation, or GPU readback during drag;
- compile shaders and allocate reusable buffers before interaction;
- render only while hovering, dragging, settling, or recovering from backend loss;
- use the display refresh rate naturally up to 120 Hz; and
- pause and cancel work when the window is hidden.

## Zoom, controls, and competing gestures

All hit testing and physics use the rendered page transform. Manual zoom remains active across page changes. Space-drag pan retains priority inside the page. Reader controls and Adaptive Flow controls never initiate a page turn. The outer edge may turn only when it is visible within the clipped stage.

Touch and pen use the same pointer state machine. A second pointer during a turn is ignored. Browser gestures are suppressed only for the captured turn pointer and only inside the reader stage.

Keyboard, wheel, buttons, navigator jumps, and accessibility actions preserve their existing semantics. Adjacent next/previous actions use the synthetic physical turn unless reduced motion or a disabled reason requires an immediate change. Non-adjacent jumps do not animate through intermediate pages.

## Failure and interruption behavior

- Required texture unavailable: remain on the current page, show the existing loading/diagnostic surface, then allow retry or direct navigation.
- WebGPU initialization or device loss: retry the same turn scene on WebGL2 only before motion begins. Loss during motion cancels without committing, then future turns use WebGL2.
- WebGL2 unavailable or minimum performance not sustained: use immediate navigation with no decorative fallback.
- Invalid solver output, NaN, excessive displacement, or constraint divergence: cancel the visual turn, retain the current page, record a renderer diagnostic, and disable physical turns for the session.
- Resize, fullscreen change, direction/profile change, publication change, unmount, or hidden document: cancel the active generation and release pointer capture.
- Original files, progress, bookmarks, and cache metadata are never mutated by renderer failure.

## Accessibility

Reduced motion is a strict no-animation mode. The current page changes immediately and the existing live announcement reports the committed destination. Keyboard completeness, focus, copyable diagnostics, and controls outside the page overlay remain unchanged. The GPU mesh is decorative and `aria-hidden`; the DOM page and current-page marker remain the semantic source.

Hover lift is not the only affordance: the cursor and existing turn hint indicate the outer edge. Touch users receive no hover-dependent requirement.

## Verification strategy

### Pure unit contracts

- State-machine transition table, stale generation rejection, commit/cancel ownership, and one-latest-request serialization.
- Scene mapping for LTR/RTL, single/spread, forward/backward, first/last page, and odd page counts.
- Front and verso UV orientation, including readable RTL and non-mirrored landed pages.
- Solver invariants: pinned spine, pointer attachment, bounded stretch, collision plane, finite output, mirrored RTL equivalence, fixed-step determinism, cancellation return, and committed terminal pose.
- Velocity/displacement release thresholds at exact boundaries.
- Quality hysteresis and permanent session disable at the minimum performance threshold.

### Component and integration contracts

- Pointer capture anywhere along the visible outer edge, including top, middle, and bottom grabs.
- Zoom/pan coordinate conversion and gesture precedence.
- Front/current, verso/next, and under-page texture selection from image, CBZ, CBR, and rasterized PDF fixtures without source-specific renderer branches.
- Automatic controls use the same controller and solver as pointer turns.
- Resize, fullscreen, direction change, backend loss, texture failure, repeated input, unmount, and hidden-document cancellation.
- Reduced motion performs an immediate change and mounts no turn overlay.

### Visual and physical evidence

- Desktop and narrow captures at early lift, mid-fold, spine crossing, late fold, settled commit, and cancellation.
- Grabs near both outer corners and the middle edge.
- LTR and RTL physical motion verified from rendered mesh vertices or projected bounds, not profile attributes.
- Single and spread modes with differing page aspect ratios and high-contrast artwork.
- Front/verso correctness and moving projected shadow.
- WebGL2 and WebGPU evidence record requested backend, actual backend, quality tier, solver version, and explicit skip reason.
- Deliberately reversed physical motion, mirrored verso UVs, missing under-page texture, or blank frames must fail the matrix.

### Performance evidence

- Pointer-to-frame latency, frame-time p95, dropped physics time, quality transitions, GPU texture count/bytes, and cleanup after 50 consecutive turns.
- Reference target: 60 FPS p95 on Windows 10/11 x64 with 8 GB RAM and a WebGL2-capable integrated GPU.
- High-refresh evidence up to 120 Hz where available.
- A constrained test mode forces rich, balanced, essential, and disabled thresholds without exposing those controls in production builds.

## Acceptance criteria

1. Dragging any visible point on the outer edge produces a continuous fold whose grabbed point follows the pointer on the next rendered frame.
2. The sheet remains attached to the spine, does not visibly stretch or cross the stationary page plane, and settles without persistent oscillation.
3. The current page is visible on the front, the next page is correctly oriented on the verso, and the appropriate later page is visible beneath it.
4. Commit and cancellation depend on the approved displacement/velocity rules, and the publication index changes exactly once only after a committed settle.
5. Single, spread, zoomed, LTR, RTL, mouse, touch, pen, wheel, keyboard, and button paths obey the same state and scene contracts.
6. Reduced motion and unsupported/minimum-performance failures change pages immediately with no substitute animation.
7. No drag performs synchronous decode, PDF rasterization, source-file access, shader compilation, or GPU readback.
8. The interaction reaches the existing 60 FPS p95 reference target, responds in the next frame, and never exposes a blank page.
9. Renderer or solver failure cannot modify originals, progress, bookmarks, or publication state and cannot commit the wrong page.
10. The visual matrix fails for reversed RTL motion, mirrored verso content, wrong under-page mapping, missing texture, or a flat door-like turn.

## Delivery boundary

Implementation should proceed in independently reviewed slices: contracts/state machine, scene mapping and texture preparation, cylindrical solver, constrained flex, WebGL2 renderer, WebGPU adapter, reader integration, automatic quality/failure handling, and final visual/performance evidence. The first integrated milestone must prove a pointer-driven WebGL2 turn with correct front/verso/under-page mapping before WebGPU or secondary flex is added.
