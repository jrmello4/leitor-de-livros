# Domain Docs

This is a **native-first** Android comic reader: portable Rust core in
`core/` (`tactile-core`) plus the Kotlin/Compose app in `native/`.

The Tauri/WebView shell was retired on 14/09/2026 and fully removed
(`src/`, `src-tauri/` glue and plugins, web tests, web CI, Tauri rolling
release). Do not reintroduce it, the desktop shell, Windows installer,
NSIS, or any desktop release promise without an explicit product
decision — the product decision is native-only.

Consult when relevant:

- `docs/android-status.md` — what is implemented and physically validated on device.
- `docs/superpowers/specs/2026-09-08-mobile-android-comic-reader-design.md` — mobile product/spec.
- `docs/roadmap-melhorias.md` — prioritized native work.
- `PRODUCT.md` — product boundaries and principles.
- `DESIGN.md` — Paper Atelier visual direction (applies to the native app).
