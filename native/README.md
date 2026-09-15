# App nativo — o produto

O shell Tauri/WebView foi aposentado (14/09/2026) e o núcleo Rust virou
Kotlin puro (15/09/2026). Este módulo **é** o produto: app Android em
Kotlin/Compose com o núcleo no mesmo módulo — sem JNI, sem NDK, sem `.so`.

## O que existe

- `app/.../core/` — o núcleo em Kotlin:
  - `LibraryDb.kt` — SQLite schema v6 (idêntico ao banco anterior, então
    bibliotecas já instaladas continuam válidas), migrações idempotentes,
    cache derivado com limite LRU, snapshot, bookmarks, favorito, remoção.
  - `Importer.kt` — CBZ (java.util.zip), CBR/RAR4/RAR5 (`junrar` 8),
    7z (`commons-compress` + `xz`), pastas de imagens e coleções ZIP
    aninhadas; `ComicInfo.xml` entra no título; limites de segurança iguais
    aos do núcleo anterior (64 MiB/página, 1024 páginas, traversal etc.).
  - `Internals.kt` — ids determinísticos (`sha256` truncado), ordem natural,
    validação de nomes de arquivo, reparo de nomes legados e dimensões de
    imagem via `BitmapFactory` (bounds).
  - `Models.kt` — `Pub`, `ReaderPage`, `Bookmark`, `CacheInfo`.
- `app/.../scaffold/MainActivity.kt` — hospeda estante, leitor, ajustes e
  servidores; teclas de volume passam a página só com o leitor aberto;
  cópia de pasta mostra overlay de progresso e avisa no teto de 500
  arquivos.
- `app/.../library/` — estante: séries, busca, filtros, seleção em lote
  com confirmação de exclusão, favoritos, pastas (`LibraryScanner`),
  import SAF recursivo. Biblioteca vazia não cria HQ de demonstração.
- `app/.../reader/` — faixa vertical lazy, zoom, HUD, marcadores, binge;
  tela acesa enquanto lê e progresso com debounce de 500 ms.
- `app/.../pdf/` — `PdfRenderer` do aparelho (original preservado).
- `app/.../settings/` — backup local JSON (exportar e importar), cache,
  update `native-latest`.
- `app/.../opds/` — OPDS 1.2 + Komga + Kavita-via-OPDS com download
  offline cancelável (extensão real preservada: PDF baixa como PDF).
- `LibraryCoreInstrumentedTest` — fim-a-fim no aparelho (importar→listar,
  capa/página sob demanda, progresso).

## Pré-requisitos

JDK 21 e Android SDK com build-tools 35 (`ANDROID_HOME` apontando para ele).

## Comandos (dentro de `native/`)

```bat
gradlew.bat testDebugUnitTest
gradlew.bat assembleDebug
gradlew.bat connectedDebugAndroidTest
```

O teste instrumentado exige aparelho autorizado no `adb` (o Moto G34 via
Wi-Fi usado nas validações anteriores serve). Sem aparelho, o máximo
provável no host é `testDebugUnitTest` + `assembleDebug`.

## Convenções

- `applicationId`/`namespace` com sufixo `.scaffold` para coexistir com o
  APK publicado; o app final reassume o identificador do produto.
- O schema do SQLite (v6) e os ids de publicação (`sha256` do source key)
  são contrato de compatibilidade: não mudar sem migração.
- No Android 8 (minSdk 26) o SQLite do sistema é 3.18: não usar UPSERT
  (`ON CONFLICT ... DO UPDATE`, requer 3.24).
- `build/` e `local.properties` são gerados (ver `.gitignore`).
