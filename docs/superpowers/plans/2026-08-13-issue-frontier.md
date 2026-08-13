# Issue Frontier #1–#6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the six unblocked reader reliability and daily-use issues while preserving source files, browser/native parity, accessibility, and the existing renderer behavior.

**Architecture:** Keep pure contracts in `src/domain`, persistence and IPC validation in `src/services` plus the Rust SQLite core, and keep React components responsible only for presenting state and invoking those contracts. Native cache and publication operations will use staged filesystem transitions; frontend page selection will use one generation-gated asynchronous coordinator; profiles and messages will use versioned stores shared by browser and native adapters.

**Tech Stack:** React 19, TypeScript 5.9, Vitest/jsdom, Vite, Tauri 2, Rust, rusqlite, SQLite, localStorage.

## Global Constraints

- Source files remain read-only and are never deleted or rewritten by library/cache operations.
- Native and browser mode expose equivalent metadata semantics for search, sorting, profiles, and messages.
- Every new production behavior is introduced by a failing test first.
- Technical diagnostics remain copyable and separate from translated user-facing messages.
- LTR/RTL, reduced-motion, keyboard navigation, existing cache safety guards, and existing renderer fallbacks remain green.
- Native Rust verification is required when a local Cargo toolchain is available; otherwise the final report must identify the unavailable native command.

---

### Task 1: Make native publication deletion atomic

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models.rs` only if the deletion result needs a structured outcome
- Test: `src-tauri/src/db.rs` native tests

**Interfaces:**
- Consumes: `LibraryDb::delete_publication(&str)` and existing `remove_derived_files` origin guards.
- Produces: a deletion operation that stages the derived cache, removes only derived bytes, commits dependent metadata only after filesystem cleanup succeeds, and restores the staged cache when cleanup or the database transaction fails.

- [ ] **Step 1: Add failing native tests** for successful metadata/cache/source preservation and for a cache-path cleanup failure that leaves the publication row and dependent metadata present.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml delete_publication`** and confirm the failure is caused by the current metadata-first deletion order.
- [ ] **Step 3: Implement staged deletion** using a validated per-publication tombstone under the cache root, cleanup before the metadata transaction, rollback/restore on errors, and retry-safe empty tombstones after a committed deletion.
- [ ] **Step 4: Add a regression assertion** that the source bytes are byte-for-byte identical and no cache path outside the derived cache is touched.
- [ ] **Step 5: Run the focused native tests, then `cargo test --manifest-path src-tauri/Cargo.toml`**.

### Task 2: Unify race-safe asynchronous page selection

**Files:**
- Create: `src/domain/pageSelection.ts`
- Test: `src/domain/pageSelection.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/PageNavigator.tsx` only if its callback contract needs the selection result
- Modify: `src/app/ReaderView.tsx` only if all direct navigation entry points need a shared callback type

**Interfaces:**
- Consumes: publication id/page index, `ensureNativePage`, progress persistence, and current publication identity.
- Produces: `createPageSelectionCoordinator()` and one App-level selection operation used by next, previous, direct jump, scrubber, and resume/open hydration. Obsolete preparation resolves without committing.

- [ ] **Step 1: Add a deferred-promise test** that starts two selections, resolves the older preparation after the newer one, and asserts only the newest commit runs.
- [ ] **Step 2: Run `npm.cmd test -- src/domain/pageSelection.test.ts --reporter=verbose`** and confirm it fails because the coordinator is absent.
- [ ] **Step 3: Implement the minimal generation-gated coordinator** with cancellation on publication changes and explicit request identity.
- [ ] **Step 4: Refactor `App.tsx`** so `moveActivePage`, `selectActivePage`, opening/resume hydration, scrubber, and direct page jumps all call the same operation; persist progress and announcements only after the request is current.
- [ ] **Step 5: Add integration coverage** for rapid navigation and rerun `npm.cmd test -- src/domain/pageSelection.test.ts src/app/PageNavigator.test.tsx --reporter=verbose`.

### Task 3: Protect the active reader working set from LRU eviction

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/nativeLibrary.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/ReaderView.tsx`
- Test: Rust cache tests and `src/services/nativeLibrary.test.ts` if required

**Interfaces:**
- Consumes: current publication id, current/adjacent page ids, cache limit, and cache clear commands.
- Produces: protected variants of cache-limit and clear-cache operations; protected ids are supplied on every eviction path, and pages outside the active working set become eligible again after navigation.

- [ ] **Step 1: Add failing Rust tests** for lowering a limit while protecting current/adjacent pages and for clearing cache while retaining the protected working set.
- [ ] **Step 2: Run the focused Rust tests and confirm current `set_cache_limit`/`clear_cache` evict protected pages.**
- [ ] **Step 3: Implement protected command arguments and database helpers** while retaining compatibility wrappers for existing internal tests.
- [ ] **Step 4: Pass the active single/spread working set from React** to limit changes and cache clearing; ensure active pages are reconstructed when they were already missing and that ReaderView touch updates recency without permanent pins.
- [ ] **Step 5: Run native cache tests plus JS tests covering cache command payloads and full existing suite.**

### Task 4: Complete title/filename search and deterministic sorting

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/library.ts`
- Modify: `src/domain/library.test.ts`
- Modify: `src/services/importers.ts`
- Modify: `src/services/nativeLibrary.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/LibraryView.tsx`
- Modify: `src/app/styles.css` only for the added sort control layout

**Interfaces:**
- Consumes: `Publication.title`, safe source filename metadata, `updatedAt`, and `addedAt`.
- Produces: `LibrarySort = 'recent' | 'title' | 'added'`, filename-aware filtering, stable tie-breakers using safe metadata/id, and accessible sort labels/options.

- [ ] **Step 1: Add failing domain tests** for a filename-only match, all three sort modes, equal-primary-value ties, and empty results.
- [ ] **Step 2: Run `npm.cmd test -- src/domain/library.test.ts --reporter=verbose`** and confirm the new expectations fail.
- [ ] **Step 3: Implement normalized matching and deterministic comparators** without mutating the source list or exposing native paths.
- [ ] **Step 4: Update browser/native metadata mapping and LibraryView/App state** so the new mode is persisted in UI state and announced through accessible labels.
- [ ] **Step 5: Run library/domain/component tests and verify the build.**

### Task 5: Add named, versioned, validated reader profiles

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/profiles.ts`
- Test: `src/domain/profiles.test.ts`
- Modify: `src/services/storage.ts`
- Modify: `src/services/nativeLibrary.ts`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/app/App.tsx`
- Modify: `src/app/ProfilePanel.tsx`
- Modify: `src/app/ProfilePanel.test.tsx`
- Modify: `src/app/styles.css`

**Interfaces:**
- Consumes: legacy flat `tactile-reader/profile/v1` browser payloads, the native `profiles` row, and the existing `ReadingProfile` fields.
- Produces: `ProfileStore` with explicit schema version, active id, validated profile records, CRUD helpers, migration, native/browser persistence parity, and visible layout-zone placement.

- [ ] **Step 1: Add failing domain/storage tests** for legacy migration, invalid closed concepts, CRUD, duplicate/rename, safe deletion of the active profile, and restart persistence.
- [ ] **Step 2: Run the focused profile tests and confirm the current single-profile store fails them.**
- [ ] **Step 3: Implement `ProfileStore` normalization/validation and pure CRUD** with a safe default profile and explicit schema version.
- [ ] **Step 4: Migrate browser storage and native profile bridge**; reject invalid profiles at both TypeScript normalization and Rust SQLite/IPC boundaries without dropping valid existing settings.
- [ ] **Step 5: Refactor App/ProfilePanel** to select, create, rename, duplicate, delete, reset, and apply the active profile; expose `data-layout-zone` and CSS placement changes.
- [ ] **Step 6: Run profile domain/component tests, build, and native profile tests.**

### Task 6: Externalize all reader-facing English copy

**Files:**
- Create: `src/i18n/catalog.ts`
- Create: `src/i18n/catalog.test.ts`
- Modify: `src/domain/input.ts`
- Modify: `src/domain/reader.ts`
- Modify: `src/rendering/telemetry.ts`
- Modify: `src/services/importers.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/LibraryView.tsx`
- Modify: `src/app/PageNavigator.tsx`
- Modify: `src/app/ProfilePanel.tsx`
- Modify: `src/app/ReaderView.tsx`
- Modify: `src/app/ZoomControls.tsx`
- Modify: `src/app/AdaptiveFlowOverlay.tsx`

**Interfaces:**
- Consumes: message keys and parameter objects.
- Produces: one locale-aware `t()` interface, a complete English catalogue, parameterized plurals/status/error/accessible-name messages, and a catalog completeness test. Technical diagnostics remain raw copyable payloads.

- [ ] **Step 1: Add failing catalogue tests** for required keys, interpolation, pluralization, locale selection, and representative accessible announcements.
- [ ] **Step 2: Run `npm.cmd test -- src/i18n/catalog.test.ts --reporter=verbose`** and confirm the catalog interface/keys are absent.
- [ ] **Step 3: Implement the typed English catalogue and locale selection** with a missing-key failure in tests and a safe fallback for runtime.
- [ ] **Step 4: Replace hard-coded reader/library/settings/import/fallback/error copy** with `t()` calls while keeping diagnostic strings untouched and copyable.
- [ ] **Step 5: Update renderer tests and component assertions** to the catalogue’s English output and run the full JS suite/build.

### Task 7: Final verification and handoff

- [ ] **Step 1:** Run `npm.cmd test -- --reporter=dot`.
- [ ] **Step 2:** Run `npm.cmd run build`.
- [ ] **Step 3:** Run `git diff --check` and inspect `git status --short`.
- [ ] **Step 4:** Run `cargo fmt --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`, and `cargo test --manifest-path src-tauri/Cargo.toml` when Cargo is available.
- [ ] **Step 5:** Use the code-review skill on the complete branch, address actionable findings, rerun verification, and commit the implementation to `codex/issue-frontier`.
