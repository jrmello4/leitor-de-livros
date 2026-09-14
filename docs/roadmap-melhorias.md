# Roadmap — app Android nativo

Atualizado em 14/09/2026: shell Tauri/WebView aposentado e removido do
repositório. O produto é `core/` + `native/`; não há mais frontend web,
pipeline desktop, nem release `android-latest` do shell antigo.

## Estado atual

Base validada em Moto G34 5G (ARM64, Android 15):

- Estante Compose lendo do núcleo via JNI, com capas lazy sob demanda
  (`nativeEnsureCover`, Coil 512px, teto de 200 em memória)
- Importação SAF de HQ real, SQLite local, CBZ / CBR (unrar-rs) / 7z
- `tactile-core` como crate top-level (`core/`), workspace único, CI com
  `cargo --locked` + `testDebugUnitTest` + `assembleDebug`

Detalhes e evidências: `docs/android-status.md`.

## P0 — virar um leitor utilizável

1. **Superfície de leitura nativa com tiling** — faixa vertical funcional
   no host em 14/09 (bytes sob demanda, HUD, folio, resume, zoom pinça
   5x + duplo-toque, offset exato). Falta o ensaio longo no aparelho.
2. **Restauração de progresso** `{pageId, scrollRatio}` no leitor nativo.
   (Feito no host em 14/09, com offset exato.)
3. **Gestos**: tap central (HUD), Back, pinça e duplo-toque prontos;
   teclas de volume pendentes.
4. **Ensaio longo de memória** — capítulo com 100+ imagens longas; alvo
   PSS ≤ 180 MB de forma sustentada (pendente de aparelho).
5. **Release assinada do app nativo** — workflow `release-native.yml`
   pronto (rolling `native-latest`); falta cadastrar os 4 segredos
   (`TACTILE_KEY_BASE64`, `TACTILE_STORE_PASSWORD`, `TACTILE_KEY_ALIAS`,
   `TACTILE_KEY_PASSWORD`).

## P1 — conforto

6. Estante por séries (ordem numérica, hint de duplicatas) no Compose.
   (Feita no host em 14/09.)
7. Import de pasta SAF no nativo. (Feito no host em 14/09, primeiro
   nível, sem recursão.)
8. Binge: transição automática entre volumes com Cancelar.
9. Backup local JSON + PT-BR + tela de atualização no app nativo.
10. PDF no Android (backend próprio ou biblioteca NDK).

## P1 — conforto

6. Estante por séries (ordem numérica, hint de duplicatas) no Compose.
7. Import de pasta SAF no nativo (hoje só arquivo avulso).
8. Binge: transição automática entre volumes com Cancelar.
9. Backup local JSON + PT-BR + tela de atualização no app nativo.
10. PDF no Android (backend próprio ou biblioteca NDK).

## P2 — backlog

11. Scanner de pastas em segundo plano com miniaturas assíncronas.
12. OPDS / Komga / Kavita com credenciais protegidas e download cancelável.

## Fora de escopo

Shell Tauri/WebView, Windows installer, EPUB, contas, sync em nuvem,
loja, iOS. IA externa e Recap continuam fora.
