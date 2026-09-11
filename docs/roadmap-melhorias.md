# Roadmap de melhorias — Android

Atualizado após a virada mobile-only. O produto **não** distribui mais desktop/Windows.

## Estado atual

Base validada em Moto G34 5G (ARM64, Android 15):

- Webtoon virtualizado, pinça, duplo-toque, autoscroll, safe areas
- Importação SAF (arquivos e pasta), coleções ZIP mistas, assinatura real do contêiner
- CBZ / CBR (unrar-rs) / 7z / pastas de imagens
- Progresso `{pageId, scrollRatio}` + migração SQLite
- Estante por séries no Android, ordem numérica, hint de duplicatas
- Cold start com retry do SQLite; 124 publicações na biblioteca de teste

Detalhes e evidências: `docs/android-status.md`.

## P0 — fechar o Android utilizável

1. **Ensaio longo de memória** — capítulo com 100+ imagens longas; alvo PSS ≤ 180 MB de forma sustentada.
2. **Ciclo de vida dos bytes das páginas** — desmontar DOM não basta; liberar blobs no fornecedor nativo.
3. **PDF no Android** — backend próprio ou biblioteca NDK; hoje o importador responde “unavailable”.
4. **Transição automática entre volumes (binge)** — hoje só existe o botão “próximo volume”.

## P1 — conforto

5. Gestos de volume (hardware) para rolagem.
6. Scanner de pastas em segundo plano com miniaturas assíncronas.
7. OPDS / Komga / Kavita com credenciais protegidas e download cancelável.
8. Flag de plataforma nativa (parar de detectar Android por user-agent).

## P2 — higiene do repositório

9. Extrair CSS mobile/webtoon de `styles.css` e reduzir `App.tsx`/`ReaderView.tsx`.
10. Remover promessas residuais de “sync em nuvem” da UI (transferência por JSON apenas).
11. `.gitignore` cobrir APKs e caches Gradle (parcialmente feito).

## Fora de escopo

Windows installer, code signing desktop, EPUB, contas, loja, iOS (por enquanto).
