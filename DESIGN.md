# Paper Atelier

<!-- impeccable:design-schema 1 -->

## Direction

Tactile is a quiet editorial frame for a reader's collection. The visual world
borrows from print rooms, archive labels, ink, uncoated paper and the warm light
of a reading lamp. On mobile this becomes **Paper Atelier de bolso**: artwork is
the loudest color, controls recede, and every important action stays reachable
with one hand.

The interface must never resemble a generic file manager, a streaming-service
catalogue, or a neon gaming dashboard.

## Principles

1. **Artwork first.** Covers and pages carry the visual drama; application
   chrome remains restrained.
2. **One obvious action.** Each mobile region has one primary action. Secondary
   tools are quieter or progressively disclosed.
3. **Reading is the destination.** Library chrome is useful; reader chrome is
   temporary and disappears without leaving the reader stranded.
4. **Warm, not sepia.** The dark foundation is neutral ink. Amber is reserved
   for progress, focus and the next meaningful action.
5. **Tactile, not ornamental.** Depth comes from overlap, edge light and compact
   shadows rather than gradients on every container.

## Color

- Ink 950 `#080b0f`: OLED-friendly reader and deepest canvas.
- Ink 900 `#0d1117`: library background.
- Ink 800 `#151b23`: raised controls and sheets.
- Paper 50 `#f7f2e8`: primary text with a warmer editorial cast.
- Paper 300 `#c8c0b3`: supporting copy.
- Amber 500 `#f2a900`: action and progress.
- Amber 300 `#ffc94a`: focus and selected states.
- Oxide 500 `#c96f4a`: errors and destructive emphasis only.

Never use amber for large decorative fields. Cover artwork must retain its
natural color and should not receive a brand-colored overlay.

## Typography

Use the system sans stack for controls and reading UI to avoid font-loading
cost in the Android WebView. Titles use tight tracking and sentence case.
Uppercase with wide tracking is limited to metadata labels of 12 characters or
fewer. Mobile body text is at least 14px; actionable labels are at least 13px.

## Shape and Spacing

- Spacing unit: 4px; common rhythm: 8, 12, 16, 24, 32.
- Mobile page gutter: 18px.
- Touch target: minimum 44x44px; primary actions use 52px.
- Control radius: 12–16px. Cards follow cover geometry and avoid nested pills.
- Shadows are short and dense, suggesting stacked paper rather than floating
  glass.

## Library Mobile

The header is compact and visually anchored by the monogram. “Continue reading”
is a horizontal editorial strip with cover, progress and one compact action.
The shelf title, search and sort form a single hierarchy. Covers use a two-column
grid on phones, with title, progress and favourite action below. Diagnostics
read as compact notices and never dominate the shelf.

Import is the persistent bottom-corner action until a future navigation model
adds a dedicated library bar.

## Reader Mobile

Pages occupy the maximum possible canvas. The top and bottom HUDs are translucent
ink sheets, respect safe areas, and animate as one coordinated layer. Only back,
page navigation, bookmark, navigator and settings remain immediately visible.
The stage itself never receives decorative motion. Loading and unavailable-page
states must explain what is happening instead of presenting a blank black screen.

## Motion

Personality: premium paper — controlled, calm and responsive.

- Signature easing: `cubic-bezier(.2, 0, 0, 1)`.
- Quick: 120ms for press and icon feedback.
- Standard: 240ms for cards, notices and control state.
- Slow: 420ms for HUD/sheet entrance.
- Library entry: 10px upward settle with opacity; stagger capped at 160ms.
- Press feedback: scale to `.98`; never bounce primary navigation.
- Reduced motion removes translation, scale, parallax and stagger while keeping
  immediate state changes.

No ambient animation runs while a publication is open. Lottie or GSAP require a
specific narrative moment and may not be introduced for ordinary controls.

## Accessibility and Performance

Focus is always visible, color is never the only state indicator, controls have
accessible names, and layouts support 320px width without horizontal overflow.
Respect `prefers-reduced-motion` and the in-app reduced-motion profile. Animate
only opacity and transforms; avoid persistent blur animation and layout-driven
effects in the Android WebView.
