# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who read locally stored comics and manga on Windows and want a more immersive, responsive, and personal reading experience than conventional page viewers provide. The initial product is global and ships with an English interface.

## Product Purpose

Provide a local-first library and reader for CBZ, CBR, PDF, and image folders. Success means the interface disappears into the work, page turns feel physically convincing, panel guidance respects the intended reading order, and readers can tune the experience without surrendering reliable defaults.

## Positioning

The product combines a direct-manipulation tactile paper simulation with an adaptive, locally computed panel flow. It preserves the full-page composition while offering guided focus and never uploads the reader's files.

## Operating Context

The v1 runs on Windows 10/11 x64 desktops with 8 GB RAM and a WebGL2-capable integrated GPU. Readers import files and folders from local storage, organize a small personal library, read fullscreen with mouse or keyboard, and resume later. Hardware ranges from common integrated graphics to high-refresh gaming displays.

## Capabilities and Constraints

- Local CBZ, CBR, PDF, JPEG, PNG, WebP, AVIF, and image-folder reading.
- Adaptive left-to-right and right-to-left panel ordering with manual correction.
- Tactile corner drag, automated page turns, single pages, spreads, fullscreen, and reduced motion.
- Named, versioned visual, physics, input, and layout profiles with safe repositioning zones.
- Local SQLite persistence and derived cache; originals remain read-only.
- Fluidity takes precedence over effects when a device cannot sustain both.
- V1 excludes EPUB, accounts, sync, online metadata, a store, discovery, and the download website.

## Brand Commitments

The default interface is “Paper Atelier”: tactile and editorial, using warm print-room materials without obscuring colorful cover art. It must be deeply customizable. The product name is undecided; temporary UI naming must not be treated as a final brand.

## Evidence on Hand

The approved design specification is `docs/superpowers/specs/2026-08-11-tactile-comic-reader-design.md`. No final name, logo, licensed comic imagery, customer claims, benchmarks, or production model weights are available and none may be fabricated.

## Product Principles

1. Reading remains in the reader's control even when assistance is active.
2. Every gesture responds immediately; quality adapts before motion stutters.
3. Powerful customization is progressive, reversible, and safe.
4. Processing and personal files stay on the device.
5. Failures degrade gracefully without losing progress or modifying originals.

## Accessibility & Inclusion

The library and reader must be keyboard-complete, expose visible focus, support scalable contrast, and provide reduced-motion and static-page fallbacks. Both left-to-right and right-to-left reading are first-class.
