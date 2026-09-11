# Atualização in-app (Android)

O app não usa Play Store. A atualização automática **total** não é possível:
o Android sempre pede confirmação para instalar um APK. O fluxo implementado
automatiza checagem, download e abertura do instalador.

## Feed

Publique no GitHub Release um `latest.json` (modelo em `docs/android/latest.json`):

```json
{
  "version": "0.1.2",
  "versionCode": 2,
  "url": "https://github.com/<org>/<repo>/releases/download/v0.1.2/tactile-reader-0.1.2-arm64.apk",
  "notes": "Resumo curto"
}
```

URL padrão no app:

`https://github.com/jrmello4/leitor-de-livros/releases/latest/download/latest.json`

Troque em `src/services/updater.ts` (`DEFAULT_UPDATE_MANIFEST_URL`) se o repositório mudar.

## Fluxo

1. Configurações → **Atualização do app** → “Procurar atualizações”
2. Compara `version` do feed com `__APP_VERSION__` (package.json via Vite)
3. Se houver versão maior: **Baixar e instalar**
4. APK vai para `cacheDir/app-updater/update.apk`
5. `FileProvider` + `ACTION_VIEW` abrem o instalador do sistema
6. Usuário confirma; a assinatura do APK deve ser a **mesma** da instalação atual

## Permissões

- `REQUEST_INSTALL_PACKAGES` (plugin `app-updater-plugin`)
- Na 1ª vez, o Android pode abrir “Instalar apps desconhecidos” — o usuário autoriza este app

## Publicar uma release

```bash
# versão nova em package.json, Cargo.toml, tauri.conf.json
npm run android:build
# subir o APK + docs/android/latest.json no Release do GitHub com a tag vX.Y.Z
```

## Segurança

- Apenas `https://`
- Limite de 200 MB no download
- Mesmo keystore (debug ou release) para atualizar por cima
- Sem execução de código extra: só o instalador do sistema
