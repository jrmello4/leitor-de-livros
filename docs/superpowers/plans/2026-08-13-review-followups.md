# Review Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issues #14, #15, and #16 by fixing destination working-set protection and adding accessible component integration coverage for library controls and localized announcements.

**Architecture:** Keep the working-set calculation as a pure reader-domain contract with an explicit page index, then consume it from every cache call. Test library behavior through the rendered controlled component. Use one reusable live-region component for application and renderer announcements so localization wiring is exercised at the actual accessibility boundary.

**Tech Stack:** React 19, TypeScript 5.9, Vitest/jsdom, Vite, Tauri 2, Rust.

## Global Constraints

- Implement issues in order: #14, #15, then #16.
- Source files and publication content remain read-only.
- Tests use public seams and user-observable accessible output, not private component internals.
- No database schema, IPC shape, runtime dependency, or visual redesign changes.
- Each issue completes a red-green cycle and receives its own commit.

---

### Task 1: Protect the destination reader working set (#14)

**Files:**
- Modify: `src/domain/reader.ts`
- Modify: `src/domain/reader.test.ts`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Produces: `activeWorkingSetPageIds(publication: Publication, profile: ReadingProfile, pageIndex: number): string[]`.
- Consumes: `visiblePageIndexes(pageIndex, publication.pages, profile.mode, profile.direction)`.

- [ ] **Step 1: Write the failing domain tests**

Add an eight-page publication fixture and assertions equivalent to:

```ts
expect(activeWorkingSetPageIds(publicationAtPageOne, singleLtrProfile, 5))
  .toEqual(['page-5', 'page-6', 'page-7']);
expect(activeWorkingSetPageIds(publicationAtPageOne, spreadRtlProfile, 7))
  .toEqual(['page-7', 'page-8']);
expect(activeWorkingSetPageIds(publicationAtPageOne, singleLtrProfile, 0))
  .toEqual(['page-1', 'page-2']);
```

The first assertion must prove that neighbors of the old `currentPage` are absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- src/domain/reader.test.ts --reporter=verbose`

Expected: FAIL because `activeWorkingSetPageIds` is not exported from the reader domain.

- [ ] **Step 3: Implement the minimal pure contract**

In `reader.ts`, clamp `pageIndex`, combine its visible spread indexes with `pageIndex - 1`, `pageIndex`, and `pageIndex + 1`, discard out-of-range indexes, and map them to page IDs without duplicates.

- [ ] **Step 4: Integrate the explicit index**

Remove the private helper from `App.tsx`, import the domain contract, pass `publication.currentPage` for cache-limit/clear/reload paths, and pass `nextPage` inside `selectPublicationPage` before `ensureNativePage`.

- [ ] **Step 5: Run focused tests and build**

Run: `npm.cmd test -- src/domain/reader.test.ts src/domain/pageSelection.test.ts --reporter=verbose`

Run: `npm.cmd run build`

Expected: both commands exit 0.

- [ ] **Step 6: Commit #14**

```powershell
git add src/domain/reader.ts src/domain/reader.test.ts src/app/App.tsx
git commit -m "fix: protect destination reader working set"
```

### Task 2: Exercise library controls through accessibility seams (#15)

**Files:**
- Modify: `src/app/LibraryView.test.tsx`

**Interfaces:**
- Consumes: rendered controls named `Search your shelf` and `Sort publications`.
- Observes: `LibraryView` callbacks and rendered publication-card order after controlled rerenders.

- [ ] **Step 1: Add a controlled test harness and failing assertions**

Add a local harness that owns `query` and `sort` with React state and passes the setters to `LibraryView`. Add tests that:

```ts
const search = host.querySelector<HTMLInputElement>('input[aria-label="Search your shelf"]');
const sort = host.querySelector<HTMLSelectElement>('select[aria-label="Sort publications"]');
expect(search).not.toBeNull();
expect(sort).not.toBeNull();
```

Then dispatch input/change events and assert rendered cards filter by title and safe filename, sort in recent/title/date-added order with deterministic ties, show the empty state, accept keyboard focus, and never render an absolute source path.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- src/app/LibraryView.test.tsx --reporter=verbose`

Expected: the new tests fail until the harness uses correct React-compatible input/change events and the rendered accessibility contract satisfies every assertion.

- [ ] **Step 3: Make the smallest test-supported correction**

Prefer test-only changes. If a failing assertion exposes a genuine control naming, focus, safe-source, or controlled-value defect, change only the relevant `LibraryView` or library-domain behavior and include that production file in the commit.

- [ ] **Step 4: Run focused tests and build**

Run: `npm.cmd test -- src/app/LibraryView.test.tsx src/domain/library.test.ts --reporter=verbose`

Run: `npm.cmd run build`

Expected: both commands exit 0.

- [ ] **Step 5: Commit #15**

```powershell
git add src/app/LibraryView.test.tsx src/app/LibraryView.tsx src/domain/library.ts
git commit -m "test: cover accessible library discovery controls"
```

Stage only production files actually changed.

### Task 3: Verify localized announcements at live regions (#16)

**Files:**
- Create: `src/app/LiveAnnouncement.tsx`
- Create: `src/app/LiveAnnouncement.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/ReaderView.tsx`

**Interfaces:**
- Produces: `LiveAnnouncement({ message, testId?, className? })`, rendering `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
- Consumes: already-localized application and renderer messages; technical diagnostics remain separate siblings.

- [ ] **Step 1: Write failing live-region integration tests**

Render and rerender the component with dynamic catalogue output:

```tsx
root.render(<LiveAnnouncement message={t('app.pageReady', { page: 2, count: 8 })} />);
expect(host.querySelector('[role="status"]')?.textContent).toBe('Page 2 of 8 is ready.');

registerLocale('test-live', {
  'app.pageReady': ({ page, count }) => `Test page ${page}/${count}`,
  'render.recovering': 'Test renderer recovering',
});
setLocale('test-live');
root.render(<LiveAnnouncement message={t('app.pageReady', { page: 3, count: 8 })} />);
expect(host.querySelector('[role="status"]')?.textContent).toBe('Test page 3/8');
```

Also assert pluralized catalogue output at the live-region boundary and that a technical diagnostic string is not placed inside the announcement.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- src/app/LiveAnnouncement.test.tsx --reporter=verbose`

Expected: FAIL because `LiveAnnouncement` does not exist.

- [ ] **Step 3: Implement and wire the live-region component**

Create the small semantic component. Replace the global announcement container in `App` and the renderer status `<p>` in `ReaderView` with it. Preserve `data-testid="renderer-status-announcement"`; keep `rendererAnnouncement.diagnostic` only in its copyable diagnostic elements.

- [ ] **Step 4: Run focused tests and build**

Run: `npm.cmd test -- src/app/LiveAnnouncement.test.tsx src/i18n/catalog.test.ts src/rendering/telemetry.test.ts --reporter=verbose`

Run: `npm.cmd run build`

Expected: both commands exit 0.

- [ ] **Step 5: Commit #16**

```powershell
git add src/app/LiveAnnouncement.tsx src/app/LiveAnnouncement.test.tsx src/app/App.tsx src/app/ReaderView.tsx
git commit -m "test: verify localized live announcements"
```

### Task 4: Full verification and review

**Files:**
- Review all changes since `2a6cd3d`.

**Interfaces:**
- Consumes: the acceptance criteria of GitHub issues #14, #15, and #16.
- Produces: verified commits ready for integration.

- [ ] **Step 1: Run complete web verification**

Run: `npm.cmd test -- --reporter=dot`

Run: `npm.cmd run build`

- [ ] **Step 2: Run complete native verification**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 3: Run repository checks**

Run: `git diff --check 2a6cd3d...HEAD`

Run: `git status --short`

- [ ] **Step 4: Execute two-axis code review**

Review `git diff 2a6cd3d...HEAD` against documented standards plus GitHub issues #14–#16. Fix any correctness or spec findings with a new red-green cycle, rerun full verification, and commit the corrections.
