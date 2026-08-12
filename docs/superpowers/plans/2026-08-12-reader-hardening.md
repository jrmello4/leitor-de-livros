# Reader hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the daily reading UX and add remote Windows verification without requiring Rust on the current workstation.

**Architecture:** Keep behavior contracts in framework-independent domain helpers, then consume those helpers from the React reader and Flow overlay. Add a focused modal-drawer accessibility layer in `ProfilePanel`, and use a GitHub Actions Windows job for Rust/Tauri validation.

**Tech Stack:** React 19, TypeScript 5.9, Vite/Vitest, Tauri 2, Rust on `windows-latest` CI.

## Global Constraints

- Preserve local-first behavior and read-only publication sources.
- Preserve LTR/RTL semantics and reduced-motion behavior.
- Do not add runtime dependencies in this slice.
- Do not claim Rust/Tauri passes locally; CI is the native verification boundary.

---

### Task 1: Add navigation and Flow contracts

**Files:**
- Modify: `src/domain/reader.ts`
- Test: `src/domain/reader.test.ts`
- Modify: `src/domain/flow.ts`
- Test: `src/domain/flow.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert `navigationAvailability(0, 4, 'ltr')` disables previous and enables next, `navigationAvailability(3, 4, 'rtl')` disables next and enables previous, and `flowResolution` returns `ready`, `review`, and `manual` for the corresponding graph states.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run `npm.cmd test -- src/domain/reader.test.ts src/domain/flow.test.ts --reporter=verbose`.
Expected: failures report the missing helper exports.

- [ ] **Step 3: Implement the minimal helpers**

Implement `navigationAvailability` by comparing `movePage` output with the current page. Implement `flowResolution` using `source === 'manual'` first, then the existing confidence threshold `0.72`.

- [ ] **Step 4: Run focused tests and the full suite**

Run the focused command, then `npm.cmd test -- --reporter=dot`. Expected: all tests pass.

### Task 2: Make Adaptive Flow states explicit

**Files:**
- Modify: `src/app/AdaptiveFlowOverlay.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Implement state-specific copy using `flowResolution`**

Render one status label and one guidance sentence for `ready`, `review`, or `manual`. Keep marker swapping available only when there are at least two regions. Keep the full-page action visible only in `review`.

- [ ] **Step 2: Add accessible labels and focus styling**

Give the legend a heading relationship, label the Flow action in plain language, and keep the existing visible focus treatment for markers and the full-page action.

- [ ] **Step 3: Build and run the full suite**

Run `npm.cmd test -- --reporter=dot` and `npm.cmd run build`.

### Task 3: Harden navigation boundaries and reader chrome

**Files:**
- Modify: `src/app/ReaderView.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Consume `navigationAvailability`**

Derive `canNext` and `canPrevious`, pass `disabled` to the two footer buttons, and use `canNext` when deciding whether a committed corner drag should call `onNext`.

- [ ] **Step 2: Remove primary technical telemetry**

Remove the visible GPU/GL/PAGE badge and replace technical stage copy with user-facing static fallback or reduced-motion guidance. Preserve an `sr-only` renderer status for assistive technology.

- [ ] **Step 3: Style disabled controls**

Make disabled boundary buttons visibly quiet and non-interactive while preserving keyboard focus semantics for the remaining actions.

- [ ] **Step 4: Verify**

Run the full Vitest suite, build, and a browser smoke check at 1280×720 and 620px wide.

### Task 4: Promote the daily library action

**Files:**
- Modify: `src/app/LibraryView.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add a continue card**

When filtered publications exist, render the first sorted publication as a compact “Continue reading” card above the long manifesto. Reuse `onOpen` and do not duplicate import or persistence logic.

- [ ] **Step 2: Hide native drag guidance when drag import is unavailable**

Use runtime-aware helper copy in the empty state and intro note so native users are directed to the file/folder picker.

- [ ] **Step 3: Verify responsive layout**

Run `npm.cmd run build` and inspect the library in a desktop and narrow browser viewport.

### Task 5: Make settings keyboard-safe

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/ProfilePanel.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add focus behavior**

Use a stable settings trigger ref in `App`, pass it to `ProfilePanel`, focus the close button on open, trap Tab within the drawer, close on Escape, and restore focus on close.

- [ ] **Step 2: Add modal semantics**

Use `role="dialog"`, `aria-modal="true"`, and an explicit heading id. Ensure the panel has a focusable root fallback and a visible backdrop does not intercept reader state.

- [ ] **Step 3: Verify**

Run tests/build and manually verify mouse, Tab, Shift+Tab, Escape, and focus restoration in the browser.

### Task 6: Add Windows CI native verification

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Define web job**

Use `windows-latest`, checkout, Node 24, `npm ci`, `npm test -- --reporter=dot`, and `npm run build`.

- [ ] **Step 2: Define native job**

Use the same checkout and Node setup, install Rust stable with `dtolnay/rust-toolchain`, then run `cargo fmt --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `npm run tauri build`.

- [ ] **Step 3: Review workflow safety**

Keep permissions read-only, do not publish artifacts, and use the repository’s existing bundled PDFium resource.

### Task 7: Final verification

- [ ] **Step 1:** Run `npm.cmd test -- --reporter=dot`.
- [ ] **Step 2:** Run `npm.cmd run build`.
- [ ] **Step 3:** Run `git diff --check` and inspect `git status`.
- [ ] **Step 4:** Run the Impeccable detector once on changed TSX markup targets.
- [ ] **Step 5:** Report local evidence separately from native CI coverage.
