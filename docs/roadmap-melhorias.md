# Roadmap — app Android nativo

Atualizado em 15/09/2026: shell Tauri/WebView aposentado (14/09) e núcleo
Rust removido (15/09). O produto é Kotlin puro em `native/` — banco,
importadores, cache, UI e testes no mesmo módulo; sem JNI, sem NDK, sem
`.so` por ABI.

## Estado atual

Base validada em Moto G34 5G (ARM64, Android 15):

- Estante Compose lendo do núcleo Kotlin, com capas lazy sob demanda
  (Coil 512px, teto de 200 em memória)
- Importação SAF de HQ real, SQLite schema v6 (compatível com o banco
  anterior), CBZ / CBR (RAR4/RAR5 via junrar) / 7z (commons-compress)
- CI sem Rust: `testDebugUnitTest` + `assembleDebug` + artefato

Detalhes e evidências: `docs/android-status.md`.

## P0 — virar um leitor utilizável

1. **Superfície de leitura nativa com tiling** — faixa vertical funcional
   no host em 14/09 (bytes sob demanda, HUD, folio, resume, zoom pinça
   5x + duplo-toque, offset exato).
2. **Restauração de progresso** `{pageId, scrollRatio}` no leitor nativo.
   (Feito no host em 14/09, com offset exato.)
3. **Gestos**: tap central (HUD), laterais (página), Back, pinça,
   duplo-toque e teclas de volume prontos (15/09, host).
4. **Ensaio longo de memória** — 120 páginas de 1080×2400 no Moto G34
   (15/09): PSS pico 93,7 MB, delta 16,8 MB na janela; estante do app real
   em 91,6 MB. Alvo de 180 MB cumprido com folga; falta a leitura contínua
   dentro do Compose/Coil.
5. **Release assinada do app nativo** — workflow `release-native.yml`
   verde e publicando a rolling `native-latest` (reutiliza os segredos
   `ANDROID_*`; keystore novo `tactile-reader` desde 15/09/2026).

## P1 — conforto (feito no host em 15/09, aparelho pendente)

6. Estante por séries + busca, filtros, ordenação, Continuar lendo,
   favoritos, seleção múltipla com ações em lote, excluir, marcar lido.
7. Import de pasta SAF recursivo (limite 500 arquivos) + ComicInfo.xml
   para títulos de CBZ.
8. Binge: transição automática entre volumes com contagem e Cancelar.
9. Backup local JSON + PT-BR + tela de atualização (`native-latest`).
10. PDF no Android via `PdfRenderer` (original preservado, páginas em
    `pdf-pages/`, limites 512 págs/512 MB).

## P2 — backlog (feito no host em 15/09, aparelho pendente)

11. Scanner de pastas em 2º plano (`LibraryScanner`) + aba Pastas com
    revarredura; miniaturas seguem lazy/assíncronas.
12. OPDS / Komga / Kavita com credenciais no sandbox privado e download
    cancelável para `imports/`.

## Fora de escopo

Shell Tauri/WebView, Windows installer, EPUB, contas, sync em nuvem,
loja, iOS. IA externa e Recap continuam fora.
