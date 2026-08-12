# Experiência completa de leitura — plano de implementação

> **Para agentes:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas de seleção (`- [ ]`).

**Objetivo:** implementar exclusão segura, cache limitado com reconstrução, retomada persistente estilo Quick Resume, zoom, navegador de páginas, favoritos híbridos e diagnóstico acessível do renderer, com validação local Rust/Tauri e no GitHub Actions.

**Arquitetura:** O SQLite nativo será a fonte de verdade para dados duráveis no Tauri; o navegador manterá um fallback local para a demonstração. O backend gerencia cache derivado, reconstrução por referência de origem e exclusão limitada ao diretório da aplicação. React consumirá contratos pequenos para estado, zoom, bookmarks e favoritos, mantendo a lógica pura nos módulos de domínio.

**Tecnologias:** React 19, TypeScript 5.9, Vite/Vitest, Tauri 2, Rust estável, rusqlite, MSVC no Windows, GitHub Actions.

## Restrições globais

- O limite inicial do cache é 2 GiB, configurável para 512 MiB, 1 GiB, 2 GiB ou 5 GiB.
- A exclusão remove somente dados locais da aplicação; PDF, CBZ, CBR e pastas de imagens originais permanecem intactos.
- A política de cache é LRU e a página atual/vizinhas ficam protegidas durante a sessão.
- O estado persistente inclui página atual via progresso existente, zoom, escala, pan, favorito e bookmarks.
- O fallback web não inventa reconstrução nativa; usa armazenamento local apenas para demo/testes.
- Não adicionar dependências runtime novas.
- Não portar para Xbox nem integrar Quick Resume real.
- Cada tarefa deve seguir TDD: teste falhando, execução confirmando a falha, implementação mínima, teste verde e commit.

---

### Task 1: Contratos de domínio e armazenamento local

**Arquivos:**
- Modificar: `src/domain/types.ts`
- Modificar: `src/domain/reader.ts`
- Modificar: `src/domain/library.ts`
- Modificar: `src/services/storage.ts`
- Criar: `src/domain/readerState.ts`
- Testar: `src/domain/reader.test.ts`, `src/domain/library.test.ts`, `src/domain/readerState.test.ts`

**Interfaces:**
- Produz `ZoomMode = 'page' | 'width' | 'manual'`.
- Produz `ReaderState { zoomMode, zoomScale, panX, panY }`.
- Produz `Bookmark { pageId, label, createdAt, updatedAt }`.
- Produz `CacheInfo { usedBytes, maxBytes, entryCount }`.
- `Publication` ganha `isFavorite: boolean` com fallback `false`.
- Produz `clampZoomScale(scale): number`, limitado a `0.5..3`.
- Produz `nextBookmark(bookmarks, pageId, label?, now): Bookmark[]`, alternando a marcação da página.
- Produz `sortBookmarks(bookmarks, pages): Bookmark[]` pela ordem das páginas.
- `storage.ts` passa a expor `loadFavorites`, `saveFavorite`, `loadBookmarks`, `saveBookmarks`, `loadReaderState` e `saveReaderState` usando chaves versionadas.

- [ ] **Passo 1: escrever testes falhando**

```ts
it('clamps manual zoom to the supported range', () => {
  expect(clampZoomScale(0.1)).toBe(0.5);
  expect(clampZoomScale(1.4)).toBe(1.4);
  expect(clampZoomScale(4)).toBe(3);
});

it('toggles a page bookmark without touching other pages', () => {
  const next = nextBookmark([], 'page-2', 'climax', '1000');
  expect(next[0]).toMatchObject({ pageId: 'page-2', label: 'climax' });
  expect(nextBookmark(next, 'page-2', '', '1001')).toEqual([]);
});
```

- [ ] **Passo 2: confirmar RED**

Rodar `npm.cmd test -- src/domain/reader.test.ts src/domain/library.test.ts src/domain/readerState.test.ts --reporter=verbose`. Esperado: falhas por exports ausentes.

- [ ] **Passo 3: implementar o mínimo**

Adicionar os tipos, helpers puros e a serialização defensiva no armazenamento. Dados inválidos retornam defaults e nunca interrompem a abertura da biblioteca.

- [ ] **Passo 4: confirmar GREEN**

Rodar os três testes focados e depois `npm.cmd test -- --reporter=dot`.

- [ ] **Passo 5: commit**

```powershell
git add src/domain src/services/storage.ts
git commit -m "feat: add reader state and bookmark contracts"
```

### Task 2: Migração SQLite e comandos de metadados

**Arquivos:**
- Modificar: `src-tauri/src/models.rs`
- Modificar: `src-tauri/src/db.rs`
- Modificar: `src-tauri/src/lib.rs`
- Modificar: `src-tauri/src/error.rs` somente se necessário para diagnósticos tipados
- Testar: testes unitários em `src-tauri/src/db.rs` e `src-tauri/src/lib.rs`

**Interfaces:**
- `NativePublication` expõe `isFavorite: bool`.
- Adicionar `NativeBookmark`, `NativeReaderState` e `CacheInfo` com `serde(rename_all = "camelCase")`.
- `LibraryDb` expõe `set_publication_favorite`, `list_bookmarks`, `upsert_bookmark`, `remove_bookmark`, `save_reader_state`, `load_reader_state`, `delete_publication`, `cache_info`, `set_cache_limit` e `clear_cache`.
- Comandos Tauri usam os mesmos nomes: `set_publication_favorite`, `list_bookmarks`, `upsert_bookmark`, `remove_bookmark`, `save_reader_state`, `load_reader_state`, `get_cache_info`, `set_cache_limit`, `clear_cache`, `delete_publication`.

- [ ] **Passo 1: escrever testes de migração e CRUD falhando**

Cobrir banco sem tabelas, banco v1/v2, repetição da migração, favorito, bookmark com cascade, estado de leitura e exclusão. O teste de exclusão deve criar um arquivo externo sentinela e afirmar que ele permanece byte a byte intacto.

- [ ] **Passo 2: confirmar RED**

Rodar `cargo test --manifest-path src-tauri/Cargo.toml db::tests -- --nocapture` no Developer Command Prompt do Visual Studio. Esperado: falhas por schema/ métodos ausentes.

- [ ] **Passo 3: implementar migração idempotente**

Avançar `MIGRATION_VERSION` para 3. Consultar `PRAGMA table_info` antes dos `ALTER TABLE`; criar `reader_states`, `bookmarks`, `cache_entries` e `cache_settings`; preencher o limite padrão de 2 GiB; manter progresso existente como fonte de `current_page`.

- [ ] **Passo 4: implementar comandos e limpeza segura**

`delete_publication` deve apagar linhas dependentes e `cache/<publication_id>` somente depois de validar que o caminho está sob `cache_dir`. Nenhum comando recebe ou remove o caminho da origem.

- [ ] **Passo 5: confirmar GREEN**

Rodar `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` e `cargo test --manifest-path src-tauri/Cargo.toml`.

- [ ] **Passo 6: commit**

```powershell
git add src-tauri/src/models.rs src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/src/error.rs
git commit -m "feat: persist reader metadata in native library"
```

### Task 3: Cache LRU e reconstrução de páginas

**Arquivos:**
- Modificar: `src-tauri/src/models.rs`
- Modificar: `src-tauri/src/db.rs`
- Modificar: `src-tauri/src/importer.rs`
- Modificar: `src-tauri/src/adapters.rs`
- Testar: `src-tauri/src/db.rs`, `src-tauri/src/importer.rs`, `src-tauri/src/adapters.rs`

**Interfaces:**
- Cada `pages` nova registra `source_ref` determinístico.
- `LibraryDb::touch_page_cache(page_id, byte_size, pinned)` atualiza `cache_entries`.
- `LibraryDb::enforce_cache_limit(protected_page_ids)` remove somente entradas LRU não protegidas e retorna bytes liberados.
- `LibraryDb::ensure_page_cache(publication_id, page_id)` reconstrói o arquivo derivado quando ausente e devolve `NativePage` atualizado.

- [ ] **Passo 1: escrever testes falhando**

Cobrir ordenação LRU, respeito a páginas protegidas, limite configurável, remoção apenas sob `cache_dir`, `source_ref` em imagem/CBZ/PDF/CBR e reconstrução de uma página depois de apagar seu derivado.

- [ ] **Passo 2: confirmar RED**

Rodar `cargo test --manifest-path src-tauri/Cargo.toml importer::tests adapters::tests db::tests -- --nocapture`. Esperado: APIs e registros ausentes.

- [ ] **Passo 3: preencher referências de origem**

Registrar caminho absoluto da imagem para conjuntos de imagens, caminho do arquivo + nome normalizado do membro para CBZ/CBR e índice da página para PDF. Bancos antigos recebem referência somente quando a derivação for determinística; caso contrário, conservam o cache atual e retornam diagnóstico de não reconstrução.

- [ ] **Passo 4: implementar LRU e reconstrução**

Reutilizar os validadores de tamanho existentes. Ao reconstruir, escrever em arquivo temporário dentro do diretório da publicação, fazer rename seguro, registrar tamanho e aplicar a limpeza depois de proteger a página solicitada e vizinhas.

- [ ] **Passo 5: confirmar GREEN**

Rodar testes focados, depois `cargo fmt`, Clippy e a suíte Rust completa.

- [ ] **Passo 6: commit**

```powershell
git add src-tauri/src/models.rs src-tauri/src/db.rs src-tauri/src/importer.rs src-tauri/src/adapters.rs
git commit -m "feat: bound and rebuild derived page cache"
```

### Task 4: Ponte nativa e fallback web

**Arquivos:**
- Modificar: `src/services/nativeLibrary.ts`
- Modificar: `src/services/storage.ts`
- Criar: `src/services/readerState.ts`
- Testar: `src/services/storage.test.ts`, `src/services/readerState.test.ts`

**Interfaces:**
- `listNativeBookmarks(publicationId): Promise<Bookmark[]>`.
- `saveNativeBookmark(publicationId, bookmark): Promise<void>`.
- `removeNativeBookmark(publicationId, pageId): Promise<void>`.
- `setNativeFavorite(publicationId, isFavorite): Promise<void>`.
- `loadNativeReaderState(publicationId): Promise<ReaderState | null>`.
- `saveNativeReaderState(publicationId, state): Promise<void>`.
- `deleteNativePublication(publicationId): Promise<void>`.
- `getNativeCacheInfo(): Promise<CacheInfo>`; `setNativeCacheLimit(bytes): Promise<void>`; `clearNativeCache(): Promise<void>`.
- `touchNativePages(publicationId, pageIds): Promise<void>`.

- [ ] **Passo 1: escrever testes falhando**

Testar que o fallback local mantém favoritos/bookmarks/estado isolados por publicação e que DTOs camelCase inválidos retornam defaults sem lançar exceção.

- [ ] **Passo 2: confirmar RED**

Rodar `npm.cmd test -- src/services/storage.test.ts src/services/readerState.test.ts --reporter=verbose`.

- [ ] **Passo 3: implementar os adaptadores**

Mapear os comandos Tauri somente quando `isNativeRuntime()` for verdadeiro; no navegador, usar as chaves versionadas da Tarefa 1. Não expor caminhos de origem para componentes.

- [ ] **Passo 4: confirmar GREEN e build**

Rodar os testes focados, `npm.cmd test -- --reporter=dot` e `npm.cmd run build`.

- [ ] **Passo 5: commit**

```powershell
git add src/services
git commit -m "feat: bridge reader state and native cache controls"
```

### Task 5: Biblioteca, exclusão e configurações de cache

**Arquivos:**
- Modificar: `src/app/App.tsx`
- Modificar: `src/app/LibraryView.tsx`
- Modificar: `src/app/ProfilePanel.tsx`
- Modificar: `src/app/styles.css`
- Testar: `src/app/LibraryView.test.tsx`, `src/app/ProfilePanel.test.tsx`

**Interfaces:**
- `App` mantém `library`, `bookmarks`, `readerStates` e `cacheInfo` sincronizados com os adaptadores.
- `LibraryView` recebe `onToggleFavorite`, `onDelete`, `favoriteOnly`, `onFavoriteOnlyChange`.
- `ProfilePanel` recebe `cacheInfo`, `onSetCacheLimit` e `onClearCache`.

- [ ] **Passo 1: escrever testes falhando**

Cobrir estrela independente do botão de abrir, filtro de favoritos, confirmação de exclusão e cópia acessível explicando que o original será preservado. Cobrir seleção de 512 MiB/1 GiB/2 GiB/5 GiB e limpeza manual.

- [ ] **Passo 2: confirmar RED**

Rodar `npm.cmd test -- src/app/LibraryView.test.tsx src/app/ProfilePanel.test.tsx --reporter=verbose`.

- [ ] **Passo 3: implementar o estado de aplicação**

Carregar metadados após `listNativePublications`, salvar alterações de forma assíncrona com diagnóstico compreensível e remover a publicação da lista somente após o comando nativo/local concluir.

- [ ] **Passo 4: implementar a biblioteca e configurações**

Adicionar estrela diferenciável, filtro, confirmação não destrutiva e painel de cache com uso/limite/ação de limpeza. O dialog de exclusão não oferece apagar a origem.

- [ ] **Passo 5: confirmar GREEN e responsividade**

Rodar testes focados, suíte completa, build e smoke check em 1280×720 e 620px.

- [ ] **Passo 6: commit**

```powershell
git add src/app
git commit -m "feat: add safe library deletion and cache settings"
```

### Task 6: Zoom, navegador de páginas e bookmarks no reader

**Arquivos:**
- Criar: `src/app/PageNavigator.tsx`
- Criar: `src/app/ZoomControls.tsx`
- Modificar: `src/app/ReaderView.tsx`
- Modificar: `src/app/styles.css`
- Modificar: `src/domain/reader.ts`
- Testar: `src/app/PageNavigator.test.tsx`, `src/app/ZoomControls.test.tsx`, `src/domain/reader.test.ts`

**Interfaces:**
- `PageNavigator` recebe `pages`, `currentPage`, `bookmarks`, `onSelectPage`, `onToggleBookmark`, `onClose`.
- `ZoomControls` recebe `mode`, `scale`, `onModeChange`, `onScaleChange`, `onResetPan`.
- `ReaderView` persiste estado após seleção de página, alteração de zoom, pan e bookmark.

- [ ] **Passo 1: escrever testes falhando**

Testar `aria-current` na miniatura atual, salto direto, bookmark independente por página, botões de zoom, slider limitado e teclado para abrir/fechar o navegador.

- [ ] **Passo 2: confirmar RED**

Rodar `npm.cmd test -- src/app/PageNavigator.test.tsx src/app/ZoomControls.test.tsx src/domain/reader.test.ts --reporter=verbose`.

- [ ] **Passo 3: implementar componentes**

Usar imagens lazy, lista horizontal rolável, scrubber com `aria-valuenow`, input de página e título opcional de bookmark. Controles não devem iniciar o gesto de virar página.

- [ ] **Passo 4: implementar zoom/pan no ReaderView**

Aplicar `transform: translate(...) scale(...)` somente ao conteúdo, manter os limites de pan e permitir arraste com espaço quando a escala manual exceder 1. Salvar `ReaderState` por publicação e proteger página atual/vizinhas via `touchNativePages`.

- [ ] **Passo 5: confirmar GREEN e acessibilidade**

Rodar testes focados, suíte completa, build e inspeção manual de teclado, leitor de tela e movimento reduzido.

- [ ] **Passo 6: commit**

```powershell
git add src/app src/domain/reader.ts
git commit -m "feat: add zoom navigation and hybrid bookmarks"
```

### Task 7: Diagnóstico acessível do renderer e pipeline de release

**Arquivos:**
- Modificar: `src/app/ReaderView.tsx`
- Modificar: `src/rendering/ReaderSurface.tsx`
- Modificar: `src/rendering/telemetry.ts`
- Modificar: `.github/workflows/ci.yml`
- Criar: `src/rendering/telemetry.test.ts` se necessário para o contrato
- Testar: `src/rendering/contracts.test.ts`, `src/rendering/telemetry.test.ts`

**Interfaces:**
- `RendererStatus` mantém `backend`, `quality` e `fallbackReason` internamente.
- O reader anuncia status de usuário em `role="status" aria-live="polite"`; detalhes técnicos ficam em diagnóstico secundário.
- O workflow continua com permissões somente leitura e passa a publicar o instalador apenas como artifact de execução, sem release automático.

- [ ] **Passo 1: escrever testes falhando**

Cobrir tradução de status técnico para mensagens simples (`ready`, `fallback`, `recovering`) e que o renderer não exiba badge técnico no chrome principal.

- [ ] **Passo 2: confirmar RED**

Rodar `npm.cmd test -- src/rendering --reporter=verbose`.

- [ ] **Passo 3: implementar o anúncio acessível**

Manter o status em live region, anunciar fallback/reconstrução com ação possível e preservar foco/reduced-motion. Não remover a telemetria interna usada para diagnóstico.

- [ ] **Passo 4: completar CI e artefato**

Manter `npm ci`, Vitest, build, Rust fmt/Clippy/test e `npm run tauri build`; adicionar `actions/upload-artifact@v4` apontando para os instaladores gerados em `src-tauri/target/release/bundle/**`.

- [ ] **Passo 5: confirmar GREEN**

Rodar testes de rendering, suíte completa, build e revisar YAML com `git diff --check`.

- [ ] **Passo 6: commit**

```powershell
git add src/rendering .github/workflows/ci.yml
git commit -m "feat: expose accessible renderer diagnostics"
```

### Task 8: Verificação integrada e revisão final

- [ ] **Passo 1:** executar `npm.cmd test -- --reporter=dot` e `npm.cmd run build`.
- [ ] **Passo 2:** executar no Developer Command Prompt do Visual Studio `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`.
- [ ] **Passo 3:** executar `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`.
- [ ] **Passo 4:** executar `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] **Passo 5:** executar `npm.cmd run tauri build` com VsDevCmd carregado e registrar os caminhos dos instaladores gerados.
- [ ] **Passo 6:** verificar `git diff --check`, `git status --short`, migrações e que `.impeccable/` não seja incluído.
- [ ] **Passo 7:** revisar cada critério da especificação e só então enviar os commits para o GitHub.
