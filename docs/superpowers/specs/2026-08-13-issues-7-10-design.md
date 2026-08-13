# Issues #7–#10 reader workflow design

## Goal

Complete the next unblocked reader-workflow slice: tactile page transitions, safe local cover replacement, named-profile transfer with preview/undo, and keyboard-complete page/bookmark navigation.

## Scope

- Issue #7: route pointer, wheel, keyboard, and visible Previous/Next controls through one page-turn request path. Preserve LTR/RTL navigation semantics, give feedback at publication boundaries, and make reduced-motion mode immediate.
- Issue #8: let a reader select and remove a local replacement cover. Validate the selected image, persist browser covers in application storage, and persist native covers as derived cache data while retaining the original source path. Missing or invalid custom covers fall back to the publication cover and expose an actionable diagnostic.
- Issue #9: export/import named reading profiles as a versioned JSON document containing preferences only. Validate before mutating state, merge name conflicts deterministically, and support previewing changes with explicit save and undo controls.
- Issue #10: add configurable actions for opening the page navigator and toggling the current bookmark. Make the navigator keyboard reachable, closeable, focus-restoring, and able to edit bookmark titles without losing persisted metadata.
- Keep issues #11 and #12 open because their remaining blockers are #7 and/or #10, and #11 itself blocks #12.

## Non-goals

- No implementation of #11 or #12.
- No changes to publication source files, imported page bytes, or original cover files.
- No profile import of library history, progress, bookmarks, diagnostics, paths, or cache state.
- No new external runtime dependency for frontend testing.

## Architecture

### Page turns

`ReaderView` owns the visual turn state, but exposes a stable page-turn request registration seam to `App`. A single request function handles forward/backward turns from all input sources, rejects overlapping requests, invokes the existing logical navigation callbacks only after the tactile commit, and invokes them immediately when reduced motion is enabled. Boundary requests use the cancelling feedback path without changing the current page. The existing pointer drag remains the only gesture that supplies a continuous progress value; its commit/cancel result enters the same request state machine.

### Custom covers

The domain model adds an optional custom-cover descriptor containing only presentation data and a safe source name. Browser persistence uses a bounded data URL in the existing storage layer. Native persistence adds database metadata for the chosen source and a derived cover artifact; Rust validates that the input is an image, writes the derived artifact atomically, and never includes the source path in the frontend DTO. Deletion stages/removes only derived artifacts and metadata, so the original source remains untouched. The default page cover remains the fallback whenever the custom artifact cannot be loaded.

### Profile transfer and preview

Pure profile-domain functions parse, validate, serialize, and merge a version-2 transfer document. The transfer boundary rejects malformed or newer schemas before any store mutation. Conflicting names are resolved by stable ` (imported)`, ` (imported 2)`, and subsequent suffixes. `App` keeps a draft of the active named profile separate from the saved profile store; `ReaderView` consumes the draft for preview, while explicit Save commits it and Undo discards it. Import merges into a draftable profile store only after validation.

### Keyboard-complete navigator

`ActionName` gains `toggle_navigator` and `toggle_bookmark`, with defaults, labels, profile validation, and settings exposure. Navigator visibility is lifted to `App` so global actions and the reader toolbar share one state. `PageNavigator` receives a trigger ref, transfers focus to its first meaningful control, cycles Tab focus inside the panel, closes on Escape, supports keyboard page selection, and restores focus to the trigger on close. Existing bookmark labels become editable fields in the navigator and continue through the existing browser/native bookmark persistence path.

## Error and fallback behavior

- Repeated page-turn requests during an active transition are ignored; they cannot commit a stale or double navigation.
- Boundary requests do not mutate progress or current page and announce the existing boundary message.
- Reduced-motion users receive immediate navigation plus the existing page-change accessibility announcement.
- Invalid, oversized, unreadable, or missing custom covers leave the original publication cover visible and report a concise diagnostic; reset removes only custom-cover metadata and derived data.
- Profile import never partially updates the store. Export uses a browser download surface and serializes no file paths or reading history.
- Invalid bookmark title input is trimmed and bounded; an empty title falls back to the default page label.

## Verification

- TDD unit tests for the page-turn request state machine, custom-cover validation/fallback, profile transfer/merge/privacy, and expanded input actions.
- Component tests for reader transition sources, cover controls, profile import/export/preview/undo, navigator focus/keyboard/title editing, and existing regressions.
- Rust tests for native custom-cover validation, derived-file cleanup, source preservation, schema migration, and bookmark title round trips.
- Frontend test suite and production build, Rust format check, Clippy with warnings denied, Rust library tests, and `git diff --check`.
- Review the final diff against issues #7–#10 before pushing; close only those four issues after the pushed commit is available.
