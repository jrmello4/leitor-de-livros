# Issue #11 Installer and Visual Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add repeatable Windows installer smoke evidence and a Playwright visual matrix for the reader without changing production release behavior.

**Architecture:** Add compile-time guarded test surfaces to the existing React/Tauri application, keeping imports, persistence, PDFium diagnostics, and reader navigation on their production paths. A Node/Playwright visual runner will exercise a flagged Vite build, while a Windows-only runner will build and install an isolated NSIS package, drive it over WebView2 CDP, and write run-scoped evidence. GitHub Actions will publish web and installer evidence as separate artifacts without publishing releases.

**Tech Stack:** React 19, TypeScript, Vitest, Vite, Tauri 2, Rust, Node.js ESM, @playwright/test, WebView2 CDP, GitHub Actions.

## Global Constraints

- Smoke and visual controls are compiled only when VITE_SMOKE_TEST=1 or VITE_VISUAL_TEST=1; normal builds must not render them.
- The smoke build uses a temporary Tauri identifier and temporary install/evidence directories; it must not delete or mutate existing application data.
- The smoke flow uses the existing importNativePaths adapter and existing PDFium diagnostic; it must not add a parallel importer or native command.
- Static rendering is required; WebGL2 and WebGPU are attempted and recorded as skipped with a reason when unavailable.
- Visual screenshots are review artifacts; automated gates are state and geometry assertions, not pixel equality against one GPU implementation.
- CI has separate web, native, visual, and installer-smoke evidence; no job may create or upload a release.
- Every implementation task follows red-green-refactor: write a focused failing test, run it, implement the smallest change, rerun the focused test, then run the relevant broader checks.

---

## File Map

- Create src/release/testModes.ts and src/release/testModes.test.ts for pure build-flag and query parsing.
- Create src/components/SmokeHarness.tsx and src/components/SmokeHarness.test.tsx for the guarded native path-input surface.
- Modify src/App.tsx, src/components/LibraryView.tsx, and src/components/ReaderView.tsx to reuse production behavior and expose stable test IDs.
- Create src/rendering/backendSelection.ts and src/rendering/backendSelection.test.ts; modify src/rendering/ReaderSurface.tsx for visual backend forcing.
- Create tests/fixtures/smoke/cover.svg and tests/fixtures/smoke/page.svg as deterministic CBZ inputs.
- Create tests/visual/visual-matrix.ts, playwright.config.ts, and tests/visual/reader-matrix.spec.ts for the web evidence runner.
- Create scripts/release/create-fixtures.mjs, scripts/release/installer-smoke.mjs, and scripts/release/verify-workflow.mjs for deterministic fixtures, isolated NSIS evidence, and workflow validation.
- Modify package.json, package-lock.json, and .github/workflows/ci.yml for commands and separate artifact jobs.

## Task 1: Add guarded smoke mode and stable production-path selectors

**Files:**
- Create: src/release/testModes.ts
- Test: src/release/testModes.test.ts
- Create: src/components/SmokeHarness.tsx
- Test: src/components/SmokeHarness.test.tsx
- Modify: src/App.tsx
- Modify: src/components/LibraryView.tsx
- Modify: src/components/ReaderView.tsx

**Interfaces:**
- parseVisualBackend(search: string, enabled: boolean): 'auto' | 'static' | 'webgl2' | 'webgpu' returns auto for every query value when the visual flag is disabled and accepts only the three documented backend values when enabled.
- isSmokeMode(enabled: boolean, nativeRuntime: boolean): boolean returns true only for a flagged native build.
- SmokeHarnessProps is { onImportPath: (path: string) => Promise<void>; diagnostic: string | null; }.
- SmokeHarness renders data-testid="smoke-harness", data-testid="smoke-source-path", data-testid="smoke-import", data-testid="smoke-status", and data-testid="smoke-diagnostic".
- App exposes handleNativeImportPaths(paths: string[]) internally and passes a one-element path through it; the function invokes the existing importNativePaths(paths, profile.direction) adapter and updates the same library, diagnostics, metadata, and active-publication state as the file-dialog flow.

- [ ] **Step 1: Write failing pure flag tests.**

~~~ts
import { describe, expect, it } from 'vitest';
import { isSmokeMode, parseVisualBackend } from './testModes';

describe('test build modes', () => {
  it('ignores backend query parameters in a normal build', () => {
    expect(parseVisualBackend('?renderBackend=webgpu', false)).toBe('auto');
  });

  it('accepts only documented backend overrides in a visual build', () => {
    expect(parseVisualBackend('?renderBackend=static', true)).toBe('static');
    expect(parseVisualBackend('?renderBackend=webgl2', true)).toBe('webgl2');
    expect(parseVisualBackend('?renderBackend=webgpu', true)).toBe('webgpu');
    expect(parseVisualBackend('?renderBackend=canvas', true)).toBe('auto');
  });

  it('requires both the smoke flag and native runtime', () => {
    expect(isSmokeMode(true, true)).toBe(true);
    expect(isSmokeMode(true, false)).toBe(false);
    expect(isSmokeMode(false, true)).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the focused tests and verify they fail because the helpers do not exist.**

Run: npm.cmd test -- src/release/testModes.test.ts --reporter=dot

Expected: FAIL with module/function-not-found errors for ./testModes.

- [ ] **Step 3: Implement the pure helpers without reading browser globals.**

~~~ts
export type VisualBackend = 'auto' | 'static' | 'webgl2' | 'webgpu';

export function parseVisualBackend(search: string, enabled: boolean): VisualBackend {
  if (!enabled) return 'auto';
  const value = new URLSearchParams(search).get('renderBackend');
  return value === 'static' || value === 'webgl2' || value === 'webgpu' ? value : 'auto';
}

export function isSmokeMode(enabled: boolean, nativeRuntime: boolean): boolean {
  return enabled && nativeRuntime;
}
~~~

- [ ] **Step 4: Run the focused tests and verify they pass.**

Run: npm.cmd test -- src/release/testModes.test.ts --reporter=dot

Expected: all flag-mode tests pass.

- [ ] **Step 5: Write failing component tests for the smoke harness.**

Test the initial empty state, a successful import callback, and diagnostic rendering. Use the repository's existing jsdom test environment with ReactDOM createRoot and act helpers; do not add a second UI test framework. Verify the initial form, the async success state, the rejection state, and diagnostic text through DOM queries.

Required assertions include:

~~~ts
expect(screen.getByTestId('smoke-source-path')).toBeInTheDocument();
expect(screen.getByTestId('smoke-diagnostic')).toHaveTextContent('PDFium runtime not found');
~~~

- [ ] **Step 6: Implement SmokeHarness as a small controlled path form.**

The input must reject an empty path without calling onImportPath, set data-testid="smoke-status" to Importing… while awaiting the callback, set it to Imported on success, and set it to Import failed on rejection. The diagnostic element must always exist and contain the latest non-empty diagnostic text. Do not add production copy or native commands.

- [ ] **Step 7: Run the focused harness tests and fix only test-environment issues exposed by them.**

Run: npm.cmd test -- src/components/SmokeHarness.test.tsx --reporter=dot

Expected: all harness tests pass.

- [ ] **Step 8: Refactor App to share the native import path and mount the harness only in smoke mode.**

Preserve the existing dialog selection and all existing state updates by making the dialog handler call handleNativeImportPaths(selectedPaths). Mount SmokeHarness only when isSmokeMode(import.meta.env.VITE_SMOKE_TEST === '1', nativeRuntime) is true. The normal browser build must not render the harness.

- [ ] **Step 9: Add stable selectors without changing user-facing behavior.**

Add data-testid attributes for library-publication-card, library-publication-remove, library-remove-confirm, reader-back, reader-current-page, reader-stage, reader-next, reader-previous, reader-fullscreen, and reader-announcement. Cards must also expose data-publication-id, data-publication-format, and data-publication-source so the runner can distinguish CBZ and PDF fixtures without relying on localized copy. Keep existing labels, keyboard behavior, confirmation semantics, and accessible names unchanged.

- [ ] **Step 10: Run the existing frontend suite and typecheck.**

Run: npm.cmd test -- --reporter=dot and npm.cmd run build

Expected: all existing tests pass and the TypeScript/Vite build succeeds with no smoke harness in the normal output path.

- [ ] **Step 11: Commit the guarded harness and selectors.**

~~~powershell
git add src/release src/components/SmokeHarness.tsx src/components/SmokeHarness.test.tsx src/App.tsx src/components/LibraryView.tsx src/components/ReaderView.tsx
git commit -m "test: add guarded native smoke harness"
~~~

## Task 2: Add deterministic renderer backend selection for visual builds

**Files:**
- Create: src/rendering/backendSelection.ts
- Test: src/rendering/backendSelection.test.ts
- Modify: src/rendering/ReaderSurface.tsx

**Interfaces:**
- resolveBackendPreference(search: string, visualBuild: boolean): VisualBackend delegates to parseVisualBackend and is the only query-string policy used by ReaderSurface.
- ReaderSurface keeps the existing automatic WebGPU → WebGL2 → static fallback; a forced static, webgl2, or webgpu attempt is made exactly once and falls back to static with the initialization reason in the existing onStatus callback.

- [ ] **Step 1: Write failing tests for the renderer preference boundary.**

~~~ts
it('does not allow a normal build to select a query-forced backend', () => {
  expect(resolveBackendPreference('?renderBackend=webgl2', false)).toBe('auto');
});

it('selects a documented backend only in a visual build', () => {
  expect(resolveBackendPreference('?renderBackend=webgpu', true)).toBe('webgpu');
});
~~~

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: npm.cmd test -- src/rendering/backendSelection.test.ts --reporter=dot

Expected: FAIL because the selection module does not exist.

- [ ] **Step 3: Implement the selection wrapper and forced initialization branch.**

Read import.meta.env.VITE_VISUAL_TEST === '1' and window.location.search only inside the component. When the preference is forced, call the matching existing backend factory once; on failure, set the renderer to static and report Skipped <backend>: <reason> through onStatus. Do not change the automatic retry order or static-content interaction behavior for normal builds.

- [ ] **Step 4: Run the focused test and the rendering tests.**

Run: npm.cmd test -- src/rendering/backendSelection.test.ts src/rendering --reporter=dot

Expected: all selection and existing rendering tests pass.

- [ ] **Step 5: Commit the renderer override.**

~~~powershell
git add src/rendering/backendSelection.ts src/rendering/backendSelection.test.ts src/rendering/ReaderSurface.tsx
git commit -m "test: allow visual runs to select render backends"
~~~

## Task 3: Build the web visual matrix and artifact summary

**Files:**
- Create: tests/visual/visual-matrix.ts
- Create: playwright.config.ts
- Create: tests/visual/reader-matrix.spec.ts
- Modify: package.json
- Modify: package-lock.json

**Interfaces:**
- visualScenarios is a readonly list of { name, profile, backend, setup(page), assert(page) } records covering the ten named scenarios.
- writeVisualEvidence(record: VisualEvidence): Promise<void> writes visual-summary.json under VISUAL_ARTIFACT_DIR, defaulting to artifacts/visual, and preserves a deterministic screenshot path under that directory.
- The Playwright project runs Chromium with VITE_VISUAL_TEST=1, workers: 1, and the Vite server on 127.0.0.1:1420.

- [ ] **Step 1: Add the Playwright dependency and scripts.**

Run: npm.cmd install --save-dev @playwright/test

Add these scripts while preserving all existing scripts:

~~~json
"test:visual": "playwright test tests/visual --config playwright.config.ts",
"test:installer-smoke": "node scripts/release/installer-smoke.mjs"
~~~

- [ ] **Step 2: Add a deterministic Playwright configuration.**

Configure testDir: ./tests/visual, one worker, retries 0, baseURL http://127.0.0.1:1420, screenshots only on demand, and a webServer command that runs npm.cmd run dev with VITE_VISUAL_TEST=1, VITE_SMOKE_TEST=0, and CI inherited. Store results under test-results/visual and do not start a release or native build.

- [ ] **Step 3: Define the matrix records and profile bootstrap.**

Use the existing profile-store schema and a localStorage init script, with profile fields for mode, direction, reducedMotion, pageTurnDuration, and existing bindings. Use page.addInitScript before navigation. Open the existing four-page demo through the library card, never through a test-only publication API.

Define these records exactly: single-ltr, spread-ltr, single-rtl, fullscreen, boundary, cancelled-turn, reduced-motion, static-fallback, webgl2, and webgpu.

Each record runs at 1440x960 and 1000x720; the mode, direction, and backend query are explicit in the record.

- [ ] **Step 4: Write failing geometry and state assertions before the runner helpers.**

The assertions must fail if the reader stage is outside the viewport, a primary control is outside the viewport, primary controls overlap, or reader-current-page is empty while a publication is active. For boundary, advance to the last demo page, click next once, and require a non-empty reader-announcement containing the existing boundary feedback. For cancelled-turn, perform a corner pointer gesture below the commit threshold and require the page indicator to remain unchanged. For fullscreen, request the existing button and record skipped with a reason when the browser rejects fullscreen; do not fail solely because headless Chromium has no permission.

- [ ] **Step 5: Implement the matrix runner and artifact writer.**

Before each screenshot, wait for the reader stage and current-page indicator, assert geometry, then write a PNG to VISUAL_ARTIFACT_DIR and append { scenario, viewport, profile, requestedBackend, actualBackend, status, skipReason, screenshot } to visual-summary.json. A forced WebGL2/WebGPU run is skipped only when the surface reports static plus the matching initialization reason; static fallback is always passed.

- [ ] **Step 6: Run one focused visual scenario locally.**

Run: npm.cmd run test:visual -- --grep "static-fallback.*1440"

Expected: one passing test, a PNG, and a JSON summary under artifacts/visual.

- [ ] **Step 7: Run the complete visual matrix and inspect the generated summary.**

Run: $env:VISUAL_ARTIFACT_DIR='artifacts/visual'; npm.cmd run test:visual

Expected: all required static/normal scenarios pass; unsupported optional backends are explicitly skipped with reasons; the summary contains both viewports and no screenshot is written before geometry checks.

- [ ] **Step 8: Commit the visual runner.**

~~~powershell
git add package.json package-lock.json playwright.config.ts tests/visual
git commit -m "test: add reader visual evidence matrix"
~~~

## Task 4: Implement the isolated Windows installer smoke runner

**Files:**
- Create: tests/fixtures/smoke/cover.svg
- Create: tests/fixtures/smoke/page.svg
- Create: scripts/release/create-fixtures.mjs
- Create: scripts/release/installer-smoke.mjs
- Create: scripts/release/verify-workflow.mjs
- Modify: package.json

**Interfaces:**
- create-fixtures.mjs <output-directory> writes smoke.cbz from committed SVG pages and copies tactile-reader-sample.pdf to smoke.pdf.
- installer-smoke.mjs accepts SMOKE_EVIDENCE_DIR and SMOKE_TIMEOUT_MS, creates a unique temporary run directory, and exits nonzero on any assertion failure after writing result.json and process logs.
- The runner uses WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port> and Playwright chromium.connectOverCDP.

- [ ] **Step 1: Write the deterministic fixture generator.**

Use fflate.zipSync with fixed entry names and fixed UTF-8 bytes; copy the existing PDF fixture byte-for-byte. The generator must create its output directory and print absolute fixture paths as JSON. It must not modify source fixtures.

- [ ] **Step 2: Run the generator and verify stable hashes.**

Run: node scripts/release/create-fixtures.mjs "$env:TEMP\tactile-reader-fixtures"

Expected: smoke.cbz and smoke.pdf exist; running the command twice produces equal SHA-256 values for both files.

- [ ] **Step 3: Add testable lifecycle helpers.**

Cover installer discovery, port allocation, timeout cleanup, and result-status serialization without launching an installer. The runner must expose no broad deletion helper; cleanup receives only the run directory and process IDs created by this invocation.

- [ ] **Step 4: Implement temporary config and package discovery.**

Write a JSON config in the run directory with a unique identifier matching com.jrmello4.tactilereader.smoke.<pid>, run npm.cmd run tauri:build -- --config <config>, locate the generated NSIS installer under src-tauri/target/release/bundle/nsis, and fail with the directory listing if no .exe is found. Keep the current release configuration unchanged.

- [ ] **Step 5: Implement silent installation and CDP lifecycle.**

Install with the discovered NSIS executable and /S, /D=<run-directory>. Launch only the installed application executable, wait for /json/version, connect Playwright over CDP, select the first Tauri page, and terminate it in finally with taskkill /PID <pid> /T /F only for the PID started by the runner. Write stdout, stderr, and CDP errors under SMOKE_EVIDENCE_DIR.

- [ ] **Step 6: Implement the missing-PDFium scenario.**

Copy the installed application directory to a second run-scoped directory, remove only the copied pdfium.dll, launch the copied executable, import smoke.pdf through smoke-source-path, and assert smoke-diagnostic contains PDFium runtime not found. Also assert no publication card was created by that failed import.

- [ ] **Step 7: Implement the intact install scenario.**

Import smoke.cbz and smoke.pdf through the smoke path, assert two publication cards and both cbz/pdf formats, advance the CBZ once, terminate and relaunch the same install, open the CBZ card, and assert reader-current-page restored the advanced page. Return to the library, remove the CBZ via library-publication-remove and library-remove-confirm, assert the card is gone and the PDF card remains, then compare SHA-256 values of both source files with the pre-run hashes.

- [ ] **Step 8: Write result.json in both success and failure paths.**

The result must contain status, installer, installDirectory, missingPdfiumDiagnostic, resumedPage, removedPublication, sourceHashesBefore, sourceHashesAfter, and failure when applicable. Keep run directories on failure and allow cleanup only inside the generated temporary root.

- [ ] **Step 9: Run the smoke script when Windows Tauri tooling is available.**

Run: $env:SMOKE_EVIDENCE_DIR='artifacts/installer-smoke'; npm.cmd run test:installer-smoke

Expected: an installed app is exercised, result.json reports passed, and source hashes before/after are equal. If the local machine lacks WebView2, NSIS, or Rust tooling, preserve the failure evidence and report the exact prerequisite instead of weakening the CI assertions.

- [ ] **Step 10: Commit the installer runner.**

~~~powershell
git add scripts/release package.json
git commit -m "test: automate isolated Windows installer smoke"
~~~

## Task 5: Add separate GitHub Actions evidence jobs

**Files:**
- Modify: .github/workflows/ci.yml

**Interfaces:**
- visual runs only the web visual command and uploads artifacts/visual/** and test-results/visual/**.
- installer-smoke runs only the installer smoke command, sets SMOKE_EVIDENCE_DIR to the workspace artifact directory, and uploads installer/smoke artifacts separately.

- [ ] **Step 1: Add a workflow structure test.**

Create scripts/release/verify-workflow.mjs using the yaml package to parse .github/workflows/ci.yml and assert jobs web, native, visual, and installer-smoke exist; visual contains npm run test:visual; installer-smoke contains npm run test:installer-smoke; no step contains gh release, softprops/action-gh-release, or equivalent publish commands. Add package script test:workflow and the yaml dev dependency.

- [ ] **Step 2: Add the visual job.**

Use windows-latest, checkout, Node 24, npm ci, npx playwright install chromium, npm run test:visual, and an if: always() upload of only visual results. Keep it independent from native packaging and set no release credentials.

- [ ] **Step 3: Add the installer-smoke job.**

Use windows-latest, checkout, Node 24, Rust stable, npm ci, npx playwright install chromium, set SMOKE_EVIDENCE_DIR to the workspace artifact directory, run npm run test:installer-smoke, and upload smoke logs/results and src-tauri/target/release/bundle/** with if: always() and if-no-files-found: warn.

- [ ] **Step 4: Verify workflow text and package scripts locally.**

Run the workflow structure test, npm.cmd run build, and npm.cmd test -- --reporter=dot. Expected: the four jobs remain separate, no release-publish action is present, and existing frontend checks still pass.

- [ ] **Step 5: Commit the CI evidence jobs.**

~~~powershell
git add .github/workflows/ci.yml
git commit -m "ci: publish visual and installer smoke evidence separately"
~~~

## Task 6: Full verification, review, push, and issue closure

- [ ] **Step 1: Run the complete frontend and Rust verification.**

~~~powershell
npm.cmd test -- --reporter=dot
npm.cmd run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
~~~

Expected: all commands pass and generated evidence is not staged.

- [ ] **Step 2: Run the full visual matrix and installer smoke evidence.**

Run the commands from Tasks 3 and 4 with run-scoped artifact directories. Confirm the summary/result JSON files contain the required scenario and lifecycle fields.

- [ ] **Step 3: Inspect the diff and run the code-review skill.**

Review from origin/codex/issue-frontier with both standards and issue-spec axes. Resolve every finding that affects acceptance, tests, isolation, or cleanup before publishing.

- [ ] **Step 4: Stage and commit final fixes.**

~~~powershell
git add .github/workflows/ci.yml package.json package-lock.json playwright.config.ts src scripts tests
git commit -m "test: complete issue 11 release evidence"
~~~

- [ ] **Step 5: Push the branch and verify the remote commit.**

~~~powershell
git push -u origin codex/issue-11
git rev-parse HEAD
~~~

Expected: push succeeds and the remote branch points to the verified commit.

- [ ] **Step 6: Comment and close only GitHub issue #11.**

Use the repository's documented GitHub issue workflow from docs/agents/issue-tracker.md. Comment with the pushed commit, exact verification commands, and links to the separate visual and installer evidence jobs. Close issue #11 only after the push succeeds; do not alter issue #12.

- [ ] **Step 7: Report the handoff.**

Include the branch, commit, CI job names, tests run, any optional backend skips, and the issue-closure result. Link changed files with absolute workspace paths.
