# Roadmap de melhorias — Android

Atualizado em 14/09/2026: lote sem-IA concluído no host (sem validação física ainda). O produto **não** distribui mais desktop/Windows.

## Estado atual

Base validada em Moto G34 5G (ARM64, Android 15):

- Webtoon virtualizado, pinça, duplo-toque, autoscroll, safe areas
- Importação SAF (arquivos e pasta), coleções ZIP mistas, assinatura real do contêiner
- CBZ / CBR (unrar-rs) / 7z / pastas de imagens
- Progresso `{pageId, scrollRatio}` + migração SQLite
- Estante por séries no Android, ordem numérica, hint de duplicatas
- Cold start com retry do SQLite; 124 publicações na biblioteca de teste

Novidades do lote 14/09 (host, sem aparelho): IA/Recap removidos, backup local
sem nuvem, PT-BR único, boot em 1 IPC (`list_library_snapshot`), modais em
`React.lazy`, preload extra desligado no nativo, PDF com mensagem PT-BR
explícita, release signing em script versionado, `cargo --locked` no CI.

Detalhes e evidências: `docs/android-status.md`.

## P0 — fechar o Android utilizável

1. **Ensaio longo de memória** — capítulo com 100+ imagens longas; alvo PSS ≤ 180 MB de forma sustentada. (Parcial: preload extra desligado no nativo; falta medir no aparelho.)
2. **Ciclo de vida dos bytes das páginas** — desmontar DOM não basta; liberar blobs no fornecedor nativo. (Parcial: `PageImage` limpa `src`+`srcset`; ciclo no fornecedor pendente.)
3. **PDF no Android** — backend próprio ou biblioteca NDK; hoje o importador responde com mensagem PT-BR explícita e preserva o original.
4. **Transição automática entre volumes (binge)** — card abre sozinho após ~1,6s visível com Cancelar; falta confirmar no aparelho. (Botão "próximo volume" existia; binge foi adicionado em lote anterior.)

## P1 — conforto

5. Gestos de volume (hardware) para rolagem. (Implementado via keydown; confirmar no Moto G34 se o sistema entrega as teclas à WebView.)
6. Scanner de pastas em segundo plano com miniaturas assíncronas.
7. OPDS / Komga / Kavita com credenciais protegidas e download cancelável.
8. Flag de plataforma nativa (parar de detectar Android por user-agent). (Feito: `runtime_platform` no Rust.)

## P2 — higiene do repositório

9. Extrair CSS mobile/webtoon de `styles.css` e reduzir `App.tsx`/`ReaderView.tsx`. (Parcial: CSS do recap removido, modais em lazy, ~90 linhas de recap saíram das views; split total pendente.)
10. Remover promessas residuais de “sync em nuvem” da UI (transferência por JSON apenas). (Feito: "Backup local · sem nuvem".)
11. `.gitignore` cobrir APKs e caches Gradle. (Feito.)

## Fora de escopo

Windows installer, code signing desktop, EPUB, contas, loja, iOS (por enquanto). IA externa e Recap também saíram do escopo em 14/09/2026.
