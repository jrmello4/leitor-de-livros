# Tactile Reader (Android nativo)

> Leitor local de HQs e mangás, Android-first: núcleo portátil em Rust
> (`tactile-core`) + app nativo em Kotlin/Compose (`native/`).

O shell Tauri/WebView foi aposentado em 14/09/2026 — o produto é o app
nativo. Não há frontend web, installer desktop, nem pipeline de release
do shell antigo neste repositório.

## Estado

Estante Compose lendo do núcleo via JNI, validada no Moto G34 5G:

- grade de séries/publicações com capas lazy sob demanda (`nativeEnsureCover` + Coil, teto de 200 em memória)
- importação SAF de HQ real, SQLite local, progresso `{pageId, scrollRatio}`
- CBZ / CBR (RAR4/RAR5 via `unrar-rs`) / 7z / pastas de imagens, originais nunca alterados

Falta o principal: a superfície de leitura nativa com tiling. Ver
[`docs/roadmap-melhorias.md`](docs/roadmap-melhorias.md) e
[`docs/android-status.md`](docs/android-status.md).

## Estrutura

- `core/` — `tactile-core`: SQLite, importadores, cache derivado, JNI. Sem UI, sem Tauri.
- `native/` — app Android (AGP + Compose). Tasks `buildCoreSo*` compilam o `.so` com o NDK antes do `preBuild`.
- `docs/` — estado, roadmap, spec do produto. `DESIGN.md` — direção visual Paper Atelier.

## Build e teste

```bat
:: Núcleo (na raiz)
cargo test -p tactile-core
cargo fmt --all -- --check
cargo clippy --locked -p tactile-core --all-targets --all-features -- -D warnings

:: App (dentro de native/)
gradlew.bat testDebugUnitTest assembleDebug
gradlew.bat connectedDebugAndroidTest
```

Requisitos: Rust estável, JDK 21, Android SDK com NDK 28.2.13676358.
O teste instrumentado exige aparelho autorizado no `adb`.

## Release

Sem pipeline de release assinada no momento: o CI publica o APK de
depuração do scaffold como artefato. A release assinada do app nativo
é trabalho futuro (ver roadmap).

## Licença

MIT — ver [LICENSE](LICENSE).
