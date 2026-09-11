# Tactile Reader (Android)

> A local-first Android comic and manga reader built around continuous Webtoon reading and physical device validation.

## Platform

**Android is the product.** The Windows desktop installer and desktop release pipeline are retired. Development and host-side tests still run on a Windows machine; the shipped artifact is the Android APK.

## Status

Validated on a physical Motorola Moto G34 5G (ARM64, Android 15) via Wi‑Fi ADB:

- Webtoon vertical reader with virtualized pages, pinch zoom (up to 5x), double-tap 1x/2x, autoscroll
- Library with series folders, natural issue order, and possible-duplicate flags
- SAF import of files and folders (`content://`), including mixed ZIP collections
- CBZ / CBR (RAR4/RAR5 via `unrar-rs`) / 7z / image folders
- SQLite progress as `{pageId, scrollRatio}` with migration and restore
- CBR works without WinRAR or any external app; PDF is **not** available on Android yet

See [`docs/android-status.md`](docs/android-status.md) for the full validation log and [`docs/superpowers/specs/2026-09-08-mobile-android-comic-reader-design.md`](docs/superpowers/specs/2026-09-08-mobile-android-comic-reader-design.md) for the product spec.

Test APKs live under `artifacts/android-test/` (local only; not published).

## Build

```bash
npm ci
npm run build

# One-time Android project setup (generates src-tauri/gen/android, gitignored)
npm run tauri -- android init

# Debug build / install on a connected device
npm run android:dev

# Release APK
npm run android:build
```

Requirements: Node 24, stable Rust with `aarch64-linux-android` target, Android SDK/NDK, JDK 21. On Windows hosts, set a short `TEMP`/`TMP` (for example `C:\tmp`) so Gradle can open its local socket.

## Development on the host

The same React + Rust core still compiles as a desktop shell for local UI work and `cargo test`/`vitest`. That shell is a development aid only — it is not a product, not packaged, and not released.

```bash
npm test
npm run tauri:dev
cargo test --manifest-path src-tauri/Cargo.toml
```

## What makes it different

- **Webtoon first:** sliding window keeps only visible pages mounted; zero-gap strip; position restored by page + scroll ratio.
- **Local-first:** publications, progress, and profiles stay on the device; source files are never modified.
- **Physical gestures:** central tap toggles HUD, double-tap zoom, pinch, Android Back always has an escape route.
- **Series shelf:** Android opens on series folders; issues load only when a series is opened.
- **Safe import:** SAF picker, signature-based container detection (a ZIP named `.cbr` is handled as CBZ), original names preserved.

## Out of scope for now

EPUB, accounts, cloud sync, online metadata, store, discovery, iOS, and desktop distribution.

PDF import on Android, OPDS/Komga/Kavita, and automatic volume-to-volume binge transition are planned next — see `docs/android-status.md`.

## License

MIT — see [LICENSE](LICENSE).
