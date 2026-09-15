# Domain Docs

This is a **native-first** Android comic reader in **pure Kotlin**: the app
(`native/`) and its core (`native/app/.../tactilereader/core/`) — SQLite,
importers, derived page cache — live in one module.

The Tauri/WebView shell was retired on 14/09/2026 and the Rust core on
15/09/2026 (no JNI, no NDK, no `.so` per ABI, no Cargo workspace). Do not
reintroduce the desktop shell, Windows installer, NSIS, JNI or a Rust core
without an explicit product decision — the product decision is
Android-native, single-language Kotlin.

Consult when relevant:

- `docs/android-status.md` — what is implemented and physically validated on device.
- `docs/superpowers/specs/2026-09-08-mobile-android-comic-reader-design.md` — mobile product/spec.
- `docs/roadmap-melhorias.md` — prioritized native work.
- `PRODUCT.md` — product boundaries and principles.
- `DESIGN.md` — Paper Atelier visual direction (applies to the native app).
