# Reader hardening and Windows verification design

## Goal

Transform the current reader slice from a convincing technical demo into a more reliable daily reading flow that can be validated on this machine and fully checked on a Windows CI runner.

## Scope

- Promote the most recent publication and its continue action before the library manifesto.
- Replace contradictory Adaptive Flow copy with explicit ready, review, and manual states.
- Make settings a keyboard-safe modal drawer with focus transfer, Escape close, tab containment, and focus restoration.
- Disable impossible Previous/Next actions at publication boundaries and remove the redundant end-of-book turn callback.
- Keep renderer implementation details out of the primary reader chrome while preserving an accessible fallback announcement.
- Add pure domain contracts and tests for navigation availability and Flow resolution.
- Add a Windows GitHub Actions workflow that runs web tests/build plus Rust formatting, Clippy, tests, and Tauri build.

## Non-goals

- No Rust implementation changes in this slice.
- No cache eviction, publication deletion, zoom, thumbnails, or bookmarks yet.
- No new runtime dependencies for component testing.

## Architecture

Domain helpers remain framework-independent. `navigationAvailability` derives logical next/previous availability from the existing LTR/RTL `movePage` contract. `flowResolution` derives one of `ready`, `review`, or `manual` from a `PanelGraph`, so the overlay cannot present mutually contradictory states.

`ProfilePanel` owns its drawer accessibility behavior because it is the only component that knows its focusable controls. `App` supplies a stable trigger ref and restores focus after close. The reader uses the domain availability contract for both buttons and pointer-turn completion. Library presentation adds a compact continue card without changing publication identity or import behavior.

## Error and fallback behavior

- Low-confidence Flow remains reversible by choosing the full-page route or correcting markers; the UI explains one current state at a time.
- Missing pages keep the existing static fallback.
- Boundary navigation is disabled and still announces the boundary when reached through a wheel or keyboard event.
- CI failures remain visible as CI failures; local frontend verification does not claim Rust verification.

## Verification

- TDD red/green tests for `navigationAvailability` and `flowResolution`.
- Existing Vitest suite and production build.
- Browser smoke check at desktop and narrow viewport for focus, disabled navigation, and the continue card.
- Windows CI definition reviewed for web and native commands.
