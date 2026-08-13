# Review Follow-ups Design

## Scope

Implement GitHub issues #14, #15, and #16 in that order. These are narrow follow-ups to issues #3, #4, and #6. They correct destination working-set protection and add missing component-level accessibility coverage. No database schema, IPC shape, or visual redesign is included.

## Issue #14: destination working-set protection

### Design

The reader's protected working-set rule accepts an explicit page index instead of implicitly reading `publication.currentPage`. Existing cache-limit and clear-cache callers pass the current page. Asynchronous page preparation protects the union of the current and clamped-destination working sets so a failed or cancelled preparation cannot evict the still-visible pages. Once the destination commits, subsequent cache operations derive protection from the new current page alone, making the old working set eligible for eviction.

This keeps one domain rule for single-page, spread, LTR, RTL, and boundary behavior while making the intended page unambiguous. It avoids constructing a temporary publication with false state and avoids duplicating the rule in `App`.

### Test seam

Test the pure working-set function through its exported domain interface. Boundary, spread, and RTL examples verify the destination contract. A page-selection integration regression starts from one current page and requests a distant destination under a tight cache limit: both sets remain protected during preparation, then the old set becomes evictable after the destination commits.

## Issue #15: accessible library controls

### Design

Exercise `LibraryView` through rendered controls rather than calling the library domain functions directly. Tests locate the search field and sort selector by accessible name, drive text entry from printable key events, advance the selector from `recent` to `title` to `added` with arrow-key interactions, and rerender with the controlled values supplied by the callbacks.

The component assertions will verify title and safe-filename filtering, recent/title/date-added ordering, deterministic ties, and the empty result. They will also confirm that absolute source paths are not exposed through rendered or accessible text.

### Test seam

The public seam is the rendered `LibraryView`: accessible controls, callbacks, and visible publication order. Tests do not inspect component internals.

## Issue #16: localized live-region announcements

### Design

Add representative component integration tests that trigger reader-visible state and observe the localized result in an actual `role="status"` or `aria-live` consumer. Cover a dynamic page announcement and a renderer/status path. Catalogue unit tests remain responsible for catalogue fallback mechanics; component tests prove wiring.

Tests will use the registered test locale where practical so a hard-coded English string or missing catalogue connection fails. Technical diagnostics remain separate and copyable, and test fixtures contain no page content.

### Test seam

The public seam is rendered accessible output after a user/state transition. Assertions target live regions by semantic role or stable accessibility contract, not private functions.

## Error handling and compatibility

The #14 change only alters which already-supported protected IDs are sent during preparation. Existing failure handling and generation cancellation remain unchanged. Issues #15 and #16 primarily add regression coverage; production changes are limited to genuine accessibility wiring defects exposed by the new tests.

## Verification

Each issue follows one red-green cycle at its agreed seam. Run focused tests after every cycle, typecheck/build regularly, then run the complete Vitest suite, production build, Rust formatting, Clippy, and native tests. Finish with a two-axis code review against the three issue bodies before committing the implementation.
