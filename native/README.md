# App nativo — o produto

O shell Tauri/WebView foi aposentado e removido (14/09/2026). Este módulo
**é** o produto: app Android em Kotlin/Compose sobre o núcleo portátil
(`tactile-core`, Rust) via JNI, crescendo tela por tela.

## O que existe

- `app/.../core/TactileCore.kt` — ponte fina: versão, abrir banco, listar
  publicações e importar caminhos, que casam 1:1 com `core/src/jni.rs`.
  Erros do Rust voltam como JSON `{"error": ...}`, nunca como exceção JNI.
- `app/.../scaffold/MainActivity.kt` — hospeda a estante Compose da fase 3.
- `app/.../library/` — `LibraryViewModel` (IO fora da thread principal,
  auto-seed com HQ de demonstração gerada em código), `LibraryScreen`
  (grade de cards com progresso, toque abre o leitor) e `TestComic` (CBZ
  mínimo de 2 páginas, só para desenvolvimento/teste).
- `app/.../reader/` — `ReaderViewModel` (páginas + progresso via JNI),
  `ReaderScreen` (faixa vertical lazy, bytes sob demanda com Coil 1080px,
  HUD no toque, folio, retoma `{pageId, scrollRatio}` e salva o progresso
  ao rolar). `MainActivity` alterna estante/leitor por `openPubId`.
- `TactileCoreInstrumentedTest` — fim-a-fim no aparelho: versão, abrir
  banco e roundtrip importar→listar CBZ gerado.
- `buildCoreSo*` no `app/build.gradle.kts` — compila o `.so` release
  (arm64-v8a + x86_64) com o NDK e copia para `jniLibs/` antes do `preBuild`.

## Pré-requisitos

JDK 21, Rust com targets `aarch64-linux-android`/`x86_64-linux-android`,
Android SDK com NDK 28.2.13676358 (`ANDROID_HOME` apontando para ele).

## Comandos (dentro de `native/`)

```bat
gradlew.bat assembleDebug
gradlew.bat connectedDebugAndroidTest
```

O teste instrumentado exige aparelho autorizado no `adb` (o Moto G34 via
Wi-Fi usado nas validações anteriores serve). Sem aparelho, o máximo
provável no host é `assembleDebug` + `assembleDebugAndroidTest` e conferir
`lib/arm64-v8a/libtactile_core.so` dentro do APK.

## Convenções

- `applicationId`/`namespace` com sufixo `.scaffold` para coexistir com o
  APK publicado; o app final reassume o identificador do produto.
- Pacote JNI `com.jrmello4.tactilereader.core` é estável — o Rust exporta
  `Java_com_jrmello4_tactilereader_core_TactileCore_*`; não renomear sem
  mudar os dois lados juntos.
- `.so`, `build/` e `local.properties` são gerados (ver `.gitignore`).
