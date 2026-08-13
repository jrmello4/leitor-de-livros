# Issue #11 — Windows release evidence design

## Goal

Produce repeatable, non-publishing evidence for the Windows installer smoke path and the reader's visual matrix. The evidence must be usable locally and in GitHub Actions without changing source files or relying on a developer's existing application data.

## Scope

- Build a smoke-only Windows NSIS package with an isolated Tauri application identifier.
- Install that package silently into a temporary directory, launch it through WebView2 remote debugging, and drive the native UI with Playwright over CDP.
- Import deterministic CBZ and PDF fixtures through a smoke-only path-input harness, verify the missing-PDFium diagnostic, resume progress after a process restart, remove a publication, and confirm the fixture bytes remain unchanged.
- Build a web visual-test variant and capture deterministic scenarios at desktop and narrow supported viewports: single page, spread, LTR, RTL, fullscreen, publication boundary, cancelled turn, reduced motion, static fallback, WebGL2 when available, and WebGPU when available.
- Validate visual geometry in Playwright before writing screenshots: no clipped reader stage, no unexpected empty canvas, no controls outside the viewport, and no overlapping primary controls.
- Upload web screenshots/summary and native installer/smoke logs separately in CI. The workflow must never publish a release.

## Non-goals

- No release upload, signing, update channel, or production installer changes.
- No permanent smoke controls in the normal build; smoke and visual controls are compiled only when their explicit Vite flags are enabled.
- No OS-level destructive cleanup outside temporary directories created by the test run.
- No pixel-perfect assertion against a single GPU implementation. Screenshots are review artifacts; geometry and state assertions are the automated gate.

## Architecture

### Smoke harness

`App` will expose a small `SmokeHarness` component only when `VITE_SMOKE_TEST=1`. It accepts an absolute native source path and invokes the same `importNativePaths` adapter used by the production flow. It exposes stable `data-testid` hooks for import status and diagnostics but does not add a new native command or bypass the existing importer/database path. Library cards and reader controls receive stable test IDs for publication identity, current page, back-to-library, next-page, and delete confirmation.

The smoke runner will:

1. Generate a deterministic CBZ in a temporary fixture directory from committed SVG pages and hash the CBZ/PDF sources.
2. Build with a temporary Tauri config that uses a unique application identifier, so the run has isolated app data without deleting a user's data.
3. Install the NSIS package with `/S` and `/D=...` into a temporary directory.
4. Copy the installed app to a second temporary directory, remove only that copy's `pdfium.dll`, launch it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=...`, import the PDF, and assert an actionable `PDFium runtime not found` diagnostic.
5. Launch the intact installation, import CBZ and PDF, advance the CBZ, terminate the app process, relaunch it, reopen the CBZ, and assert the advanced page is restored.
6. Remove the CBZ through the normal confirmation flow, assert its card disappears, and compare source hashes before and after.

The runner will always terminate child processes and write logs/results under a run-specific temporary evidence directory. The CI job uploads the evidence even when the smoke test fails.

### Visual matrix

`ReaderSurface` will honor `?renderBackend=static|webgl2|webgpu` only in a `VITE_VISUAL_TEST=1` build. Static is always captured; WebGL2/WebGPU are attempted and recorded as skipped with the initialization reason when the browser cannot provide that backend. The visual runner will use the existing profile store contract through `localStorage` to select mode, direction, and reduced motion, and the existing fullscreen button when fullscreen is supported.

Each scenario runs at `1440×960` and `1000×720`. The runner records the backend, viewport, profile, scenario, and skip reason in `visual-summary.json`, captures a PNG only after state/geometry assertions pass, and stores screenshots by deterministic names. The scenario set is:

| Scenario | State under test |
| --- | --- |
| `single-ltr` | single page, LTR, normal motion |
| `spread-ltr` | spread, LTR, normal motion |
| `single-rtl` | single page, RTL |
| `fullscreen` | single page with fullscreen request when available |
| `boundary` | first/last page controls and boundary announcement |
| `cancelled-turn` | corner drag below commit threshold |
| `reduced-motion` | reduced-motion immediate navigation and feedback |
| `static-fallback` | forced static renderer |
| `webgl2` | forced WebGL2 when available |
| `webgpu` | forced WebGPU when available |

### CI evidence

Keep the current `web` and `native` jobs as the ordinary test/build evidence. Add separate Windows jobs:

- `visual`: install Playwright's Chromium, build with `VITE_VISUAL_TEST=1`, run the matrix, and upload only visual artifacts.
- `installer-smoke`: install Playwright's Chromium and Rust/Node prerequisites, build with `VITE_SMOKE_TEST=1` and the temporary identifier config, run the installer smoke script, and upload installer/smoke artifacts. It does not create a GitHub release.

The native job remains the backend-specific compile/test evidence; the installer smoke job reports package installation and end-to-end evidence separately.

## Error and fallback behavior

- Missing PDFium must remain a diagnostic from the existing adapter path and must not create a partial publication.
- A backend that cannot initialize is recorded as skipped for that backend, while static fallback remains a required visual scenario.
- A failed screenshot assertion fails the visual job and still uploads the preceding screenshots and summary.
- A failed smoke step terminates the app, preserves its temporary logs, and fails the job without deleting any fixture outside the run directory.

## Verification

- Unit/component tests for smoke-only rendering guards and stable hooks where behavior is added.
- Playwright visual matrix with geometry assertions and artifact summary.
- Installer smoke script with source hashes, missing-PDFium diagnostic, restart/resume, and deletion checks.
- Existing frontend tests/build plus Rust format, Clippy, and tests.
- GitHub Actions YAML validation by parsing the workflow and running the scripts locally when Windows tooling is available.

