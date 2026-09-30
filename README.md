# Tactile Reader (Android nativo)

> Leitor local de HQs e mangás, Android-first: núcleo em Kotlin puro (SQLite,
> importadores, cache derivado) + app nativo em Kotlin/Compose.

O shell Tauri/WebView foi aposentado em 14/09/2026 e o núcleo Rust em
15/09/2026 — o produto é Kotlin puro, sem JNI, sem NDK, sem `.so` por ABI.
Não há frontend web, installer desktop, nem pipeline de release do shell
antigo neste repositório.

## Estado

App nativo Kotlin + Compose. O histórico de validações de host e dispositivo
fica em [`docs/android-status.md`](docs/android-status.md). O Reader 2.0 foi
validado com 141 testes locais e 44 testes instrumentados no Moto G34 5G
(Android 15); detalhes e limites em [`docs/reader-2-validation.md`](docs/reader-2-validation.md).
O acabamento da versão `0.5.1` passou em 145 testes locais e 31 testes no
aparelho; veja [`docs/reader-2-finishing.md`](docs/reader-2-finishing.md).

- Reader 2.0 com página única/dupla, Vertical/Webtoon, LTR/RTL, ajustes de
  imagem, gestos de zoom/pan, HUD com slider e configurações persistentes
- marcadores, volume físico, orientação, imersão e binge com Cancelar
- séries + busca/filtros/seleção em lote/favoritos, pastas com revarredura
- PDF com renderização sob demanda via `PdfRenderer`, backup local JSON, OPDS/Komga/Kavita, ComicInfo
- CBZ / CBR (RAR4/RAR5 via `junrar`) / 7z (commons-compress) / pastas de
  imagens, originais nunca alterados

Ver [`docs/roadmap-melhorias.md`](docs/roadmap-melhorias.md) e
[`docs/android-status.md`](docs/android-status.md).

## Estrutura

- `native/` — o produto: app Android (AGP + Compose). O núcleo vive em
  `app/.../tactilereader/core/` (SQLite schema v8, importadores, cache).
- `docs/` — estado, roadmap, spec do produto. `DESIGN.md` — direção visual
  Paper Atelier.

## Build e teste

```bat
:: Dentro de native/
gradlew.bat testDebugUnitTest lintRelease assembleDebug
gradlew.bat connectedDebugAndroidTest
```

Requisitos: JDK 21 e Android SDK (build-tools 35). Sem NDK, sem Rust.
O teste instrumentado exige aparelho autorizado no `adb`.

## Release

O workflow `release-native.yml` publica o rolling `native-latest` com o
APK assinado + `apksigner verify`. Exige 4 segredos (Settings → Secrets
→ Actions): `ANDROID_KEY_BASE64`, `ANDROID_STORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Sem eles o workflow falha
cedo; os APKs do CI comum usam assinatura de depuração e não são publicáveis.

A release versionada atual do Reader 2.0 é `v0.5.1`. O APK oficial, manifesto e
SBOM são distribuídos nos assets do GitHub Releases.

## Licença

MIT — ver [LICENSE](LICENSE). O leitor CBR usa `junrar`, distribuído sob a
licença UnRAR (permitida para extração; o app não cria/reescreve RAR).
