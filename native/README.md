# App nativo — scaffold da fase 2 (experimental)

O produto continua sendo o APK Tauri. Este módulo prova o núcleo portátil
(`tactile-core`, Rust) via JNI e cresce tela por tela até a paridade.

## O que existe

- `app/.../core/TactileCore.kt` — ponte fina: `nativeVersion()` e
  `nativeOpenLibrary(dir)`, que casam 1:1 com `native-core/src/jni.rs`.
  Erros do Rust voltam como JSON `{"error": ...}`, nunca como exceção JNI.
- `app/.../scaffold/MainActivity.kt` — tela de prova (sem Compose de
  propósito): abre o banco do núcleo e mostra o resultado.
- `TactileCoreInstrumentedTest` — fim-a-fim no aparelho: versão semver +
  abrir banco e contar 0 publicações, duas vezes (idempotência).
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
