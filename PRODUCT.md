# Product

<!-- impeccable:product-schema 1 -->

## Platform

Android (phone). Development host may be Windows or Linux; the product ships as an Android APK.

## Users

People who read locally stored comics and manga on an Android phone and want continuous vertical reading (Webtoon/manhwa), a local library, and a more immersive experience than a file browser or basic image viewer.

## Product Purpose

Provide a local-first library and reader for CBZ, CBR, ZIP/7z collections, and image folders on Android. Success means the interface disappears into the work, Webtoon scrolling stays smooth on mid-range phones, series are easy to navigate, and progress restores exactly where the reader stopped.

## Positioning

A local-first Android comic reader with a virtualized Webtoon engine, SAF-based import that never moves or rewrites originals, and a series-oriented shelf. No account, no cloud, no store.

## Operating Context

v1 targets mid-range Android phones (for example Moto G34 5G class: 4–8 GB RAM, ARM64, Android 13+). Readers import from Downloads/SD via Storage Access Framework, organize a personal library, read fullscreen with touch, and resume later.

## Capabilities and Constraints

- Local CBZ, CBR (RAR4/RAR5), ZIP/7z mixed collections, and image-folder reading.
- Webtoon vertical mode is the default reading mode on Android.
- SAF file and folder pickers; originals remain read-only.
- Progress is stored as page id + scroll ratio inside the page.
- Series grouping with natural issue order and non-destructive duplicate hints.
- PDF is not available on Android yet.
- V1 excludes EPUB, accounts, sync, online metadata, a store, discovery, iOS, and desktop distribution.

## Brand Commitments

The default interface keeps the Paper Atelier materials direction for covers and chrome, adapted to phone density and safe areas. The product name is temporary.

## Evidence on Hand

Android implementation log: `docs/android-status.md`. Design specification: `docs/superpowers/specs/2026-09-08-mobile-android-comic-reader-design.md`. Physical validation on Moto G34 5G. No final name, logo, licensed comic imagery, customer claims, or store listing assets are available and none may be fabricated.

## Product Principles

1. Reading remains in the reader's control even when assistance is active.
2. Every gesture responds immediately; quality adapts before motion stutters.
3. Files stay on the device and are never rewritten by the app.
4. Failures degrade gracefully without losing progress or modifying originals.
5. Android-only: do not promise desktop distribution.

## Accessibility & Inclusion

Touch targets at least 44px, visible focus for keyboard/switch access when available, scalable contrast, reduced-motion support, and Android Back as a universal escape route.
