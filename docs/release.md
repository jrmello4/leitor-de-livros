# Guia de Release e Auditoria de Artefatos

## 1. Fonte Única da Verdade para Versionamento

O projeto adota uma única fonte da verdade de versionamento localizada em:
`native/version.properties`:
```properties
versionMajor=0
versionMinor=4
versionPatch=0
versionCode=4
```

### Regras de Versionamento:
- `versionName`: Composto no formato `major.minor.patch` (ex.: `0.4.0`).
- `versionCode`: Número inteiro monotonicamente crescente (ex.: `4`). Em pipelines de CI, a variável de ambiente `TACTILE_VERSION_CODE` (ex.: `${{ github.run_number }}`) sobrepõe o valor base, preservando unicidade.
- Nome padronizado do APK gerado:
  `tactile-native-${versionName}+${versionCode}-${buildType}.apk`
  (Ex.: `tactile-native-0.4.0+4-release.apk`).

## 2. Pipeline de Release Local Fechado e Autossuficiente

Para produzir e auditar localmente o binário oficial de release:

```bash
# 1. Executar suíte completa de testes unitários
cd native && ./gradlew testDebugUnitTest

# 2. Executar verificação de lint estrito de release
./gradlew lintRelease

# 3. Compilar APK de release minificado com R8, Baseline Profiles e manifesto
./gradlew assembleRelease generateReleaseMetadata
```

### O que o comando `generateReleaseMetadata` executa:
1. Compila o ART Baseline Profile (`mergeReleaseArtProfile`, `compileReleaseArtProfile`).
2. Executa minificação de código com R8 e exclusão de recursos não utilizados (`shrinkReleaseRes`).
3. Empacota o APK de release e determina a assinatura real:
   - Se credenciais de release (`TACTILE_STORE_FILE`) estiverem presentes: assina como `release-signed` e marca `publishable: true`.
   - Se executado localmente sem credenciais: assina com a chave de desenvolvimento (`debug-signed`) e marca honestamente `publishable: false`.
   - Sob `REQUIRE_RELEASE_SIGNING=true` (CI oficial), falha o build com erro fatal caso as credenciais não estejam presentes, impedindo qualquer publicação acidental de APK com chave de debug.
4. Calcula o hash SHA-256 criptográfico real do APK gerado.
5. Gera dinamicamente o `release-manifest.json` com os valores reais da compilação:
   - `name`: "tactile-native"
   - `versionName`: Versão semântica (ex.: "0.4.0")
   - `versionCode`: Código inteiro (ex.: 4)
   - `minSdkVersion`: 26 (Android 8.0 Oreo)
   - `targetSdkVersion`: 35 (Android 15)
   - `compileSdkVersion`: 35
   - `packageName`: "com.jrmello4.tactilereader.scaffold"
   - `apkName`: Nome rastreável do arquivo
   - `sha256`: Checksum hexadecimal de 64 caracteres
   - `sizeBytes`: Tamanho exato em bytes
   - `signing`: "release-signed" ou "debug-signed"
   - `publishable`: booleano (true somente com chave de release oficial)
   - `signatureScheme`: "v2"
   - `generatedAt`: Timestamp ISO-8601 da geração
6. Gera o `sbom.json` sincronizado com a versão exata do binário.

## 3. Validação do Binário Final (Ferramentas Oficiais do Android SDK)

Antes de qualquer publicação ou distribuição, o artefato é auditado por ferramentas oficiais do SDK:

### 3.1 Verificação de Assinatura (`apksigner`)
```bash
apksigner.bat verify --verbose "native/app/build/outputs/apk/release/tactile-native-0.4.0+4-release.apk"
```
**Critério**: `Verified using v2 scheme (APK Signature Scheme v2): true`.

### 3.2 Inspeção de Identidade e Atributos (`apkanalyzer`)
```bash
# Resumo de pacote, código e versão
apkanalyzer.bat apk summary "native/app/build/outputs/apk/release/tactile-native-0.4.0+4-release.apk"
# Saída esperada: com.jrmello4.tactilereader.scaffold  4  0.4.0

# Confirmação de flags de segurança
apkanalyzer.bat manifest debuggable "native/app/build/outputs/apk/release/tactile-native-0.4.0+4-release.apk"
# Saída esperada: false
```

## 4. Software Bill of Materials (SBOM)

O arquivo `sbom.json` na raiz do repositório documenta a lista de componentes, dependências de terceiros, identificadores purl e licenças de software correspondentes (Apache-2.0, UnRAR, MIT, Public Domain).

## 5. Checklist de Verificação Pré-Publicação

- [x] Testes unitários passando (`testDebugUnitTest` 100% sucesso).
- [x] Testes instrumentados compilados e validados (`compileDebugAndroidTestSources`).
- [x] Lint de release sem erros impeditivos (`lintVitalRelease` e `lintRelease`).
- [x] R8 e minificação de recursos ativos (APK reduzido de 11.4 MB para ~2.0 MB).
- [x] Regras de ProGuard (`proguard-rules.pro`) preservando decodificadores e Coil.
- [x] ART Baseline Profile (`baseline-prof.txt`) integrado.
- [x] Atualizador in-app validando allowlist HTTPS, SHA-256 e impedindo downgrade.
- [x] `release-manifest.json` e `sbom.json` gerados e sincronizados com o build.
