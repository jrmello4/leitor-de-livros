# Atualização in-app (Android)

O app não usa Play Store. A atualização automática **total** não é possível:
o Android sempre pede confirmação para instalar um APK. O fluxo implementado
automatiza checagem, download e abertura do instalador.

## Baixar

Cada push na `main` publica um APK assinado na release rolante
[`android-latest`](https://github.com/jrmello4/leitor-de-livros/releases/tag/android-latest).
Baixe o `tactile-reader-*-arm64.apk`, permita “Instalar apps desconhecidos”
para o Tactile Reader e abra o arquivo.

## Feed

A release rolante publica um `latest.json` junto com o APK:

```json
{
  "version": "0.1.1",
  "versionCode": 43,
  "url": "https://github.com/jrmello4/leitor-de-livros/releases/download/android-latest/tactile-reader-0.1.1-arm64.apk",
  "notes": "main @ abc1234"
}
```

URL lida pelo app (`DEFAULT_UPDATE_MANIFEST_URL` em `src/services/updater.ts`):

`https://github.com/jrmello4/leitor-de-livros/releases/download/android-latest/latest.json`

Como a `main` gera vários builds com o mesmo `version`, o app oferece a
atualização quando o `version` é maior **ou** quando o `version` é igual e o
`versionCode` do feed é maior que o instalado (`get_installed_version`).

## Fluxo

1. Configurações → **Atualização do app** → “Procurar atualizações”
2. Compara `version`/`versionCode` do feed com o app instalado
3. Se houver build mais novo: **Baixar e instalar**
4. APK vai para `cacheDir/app-updater/update.apk`
5. `FileProvider` + `ACTION_VIEW` abrem o instalador do sistema
6. Usuário confirma; a assinatura do APK deve ser a **mesma** da instalação atual

## Keystore (obrigatório no CI)

O Android só atualiza por cima com a **mesma assinatura**. O workflow
`.github/workflows/release-android.yml` assina com um keystore de release
guardado em secrets. Sem ele, cada build teria uma assinatura efêmera e o
auto-update quebraria.

Gere uma vez (guarde o arquivo e as senhas fora do git):

```powershell
keytool -genkey -v -keystore tactile-release.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload
[Convert]::ToBase64String([IO.File]::ReadAllBytes("tactile-release.jks")) | Set-Content tactile-release.b64
```

Cadastre no repositório (Settings → Secrets → Actions):

- `ANDROID_KEY_BASE64` — conteúdo do `tactile-release.b64`
- `ANDROID_KEY_ALIAS` — `upload` (ou o alias usado)
- `ANDROID_KEY_PASSWORD` — senha do keystore e da chave

O `versionCode` de cada build é o número da execução do workflow
(`github.run_number`), sempre crescente, então todo push na `main`
aparece como atualização no app.

## Primeira troca de assinatura

APKs de depuração instalados manualmente (ex.: `artifacts/android-test/`)
têm assinatura diferente da do CI. Para migrar, desinstale o app e instale o
APK da release rolante — a biblioteca local é recriada do zero.

## Publicar uma release manualmente

O fluxo é automático, mas o `latest.json` pode ser gerado à mão:

```bash
node scripts/android/make-latest-json.mjs tactile-reader-0.1.1-arm64.apk 43 "notas" --out latest.json
```

## Segurança

- Apenas `https://`
- Limite de 200 MB no download
- Mesmo keystore para atualizar por cima
- Sem execução de código extra: só o instalador do sistema
