# Experiência completa de leitura — especificação de design

**Data:** 12 de agosto de 2026  
**Status:** aprovada para planejamento

## Objetivo

Transformar a demonstração atual em uma experiência de leitura local completa: a pessoa consegue remover publicações sem perder os arquivos originais, controlar o espaço usado pelo cache, retomar exatamente a última sessão, navegar por páginas distantes, usar zoom, marcar publicações e páginas favoritas e receber diagnósticos acessíveis quando o renderer precisar de fallback.

## Escopo

### 1. Persistência nativa e ciclo de vida

O backend Rust/SQLite passa a ser a fonte de verdade no runtime Tauri para:

- favorito da publicação;
- bookmarks de página, com título curto opcional;
- estado de leitura por publicação: página atual, modo de zoom, escala e posição de pan;
- limite, uso e última utilização do cache;
- remoção de publicação e de todos os dados derivados associados.

O fallback web continua funcional para a demonstração e para os testes React. Nesse modo, favorito, bookmarks e estado de leitura usam armazenamento local do navegador; gerenciamento de cache e reconstrução a partir do arquivo original ficam disponíveis apenas no runtime nativo.

### 2. Cache e retomada

O limite inicial do cache será de 2 GiB, configurável para 512 MiB, 1 GiB, 2 GiB ou 5 GiB. A configuração inclui uma ação explícita de limpar o cache agora.

O cache contém somente páginas derivadas. Os arquivos e pastas importados nunca são apagados pelo leitor. Cada página terá uma referência de origem suficiente para ser reconstruída quando seu arquivo derivado for removido.

A política de limpeza é LRU:

1. a página atual e as páginas visíveis/vizinhas ficam protegidas durante a sessão;
2. ao ultrapassar o limite, páginas não protegidas são removidas pela menor data de acesso;
3. ao abrir uma página sem cache, o backend a reconstrói da origem, registra o tamanho e atualiza a data de acesso;
4. a limpeza de cache não remove bookmarks, progresso, favoritos ou estado de leitura.

No macOS e no Windows, o caminho será resolvido pela API de diretórios do Tauri: banco e estado persistente ficam no diretório de dados da aplicação; páginas derivadas ficam no diretório de cache da aplicação. O sistema operacional poderá limpar o diretório de cache sem corromper a biblioteca.

O comportamento de retomada será semelhante ao objetivo do Quick Resume do Xbox, mas sem prometer um snapshot do processo: o estado é salvo a cada mudança relevante, a página atual é exibida primeiro e as páginas adjacentes são pré-carregadas em segundo plano. Quick Resume do Xbox não será tratado como uma API portátil nem como alvo de distribuição desta aplicação.

### 3. Exclusão segura

Excluir uma publicação exige confirmação clara e remove:

- a linha da publicação e seus registros dependentes no SQLite;
- progresso, estado de leitura, bookmarks e gráficos Adaptive Flow associados;
- o diretório de cache derivado da publicação.

A operação não remove, move ou altera o PDF, CBZ, CBR ou a pasta de imagens original. Se a origem não existir mais, a publicação ainda pode ser removida do leitor e o diagnóstico informa que somente os dados locais foram apagados.

### 4. Navegação e conforto

O leitor receberá:

- `Ajustar à página`;
- `Ajustar à largura`;
- zoom manual entre 50% e 300%, com passos de 10%;
- pan por arraste e pela barra de espaço quando o zoom exceder o enquadramento;
- restauração de zoom e pan por publicação;
- navegador de páginas recolhível com miniaturas lazy, indicador de página atual, scrubber e salto direto para um número de página;
- navegação por teclado, foco visível e `aria-current` na página selecionada.

As miniaturas reutilizam os derivados existentes e não carregam todo o conteúdo em memória de uma vez. A página atual e as páginas próximas recebem prioridade de carregamento.

### 5. Favoritos híbridos

O diferencial do leitor será composto por dois níveis:

- **favorito da publicação:** estrela na biblioteca e no cabeçalho da leitura; a biblioteca poderá filtrar somente favoritos;
- **bookmark de página:** marcador da página atual, com título curto opcional, listado no navegador de páginas e acionável por teclado.

Os dois níveis são independentes: remover a estrela não remove bookmarks, e remover um bookmark não altera o favorito da publicação.

### 6. Diagnóstico acessível do renderer

O renderer não exibirá detalhes de GPU/GL como chrome principal. Ele manterá um status acessível e orientado à ação:

- `role="status"`/`aria-live` para anunciar que a página está pronta, em fallback ou sendo recuperada;
- mensagem de fallback em linguagem simples, sem exigir conhecimento de WebGPU/WebGL;
- detalhes técnicos disponíveis somente na área de diagnóstico das configurações, para cópia e suporte;
- foco visível e nomes estáveis para controles de Flow, zoom, miniaturas, favoritos e bookmarks;
- movimento reduzido preservado, sem remover feedback de estado.

## Modelo de dados nativo

A migração seguinte ao schema atual adicionará, verificando `PRAGMA table_info` antes de cada `ALTER TABLE` para que a execução repetida permaneça segura:

```sql
ALTER TABLE publications ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN source_ref TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS reader_states (
    publication_id TEXT PRIMARY KEY,
    zoom_mode TEXT NOT NULL DEFAULT 'page',
    zoom_scale REAL NOT NULL DEFAULT 1.0,
    pan_x REAL NOT NULL DEFAULT 0.0,
    pan_y REAL NOT NULL DEFAULT 0.0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
    publication_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(publication_id, page_id),
    FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cache_entries (
    page_id TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL,
    cache_path TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    last_accessed_at TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
    FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cache_settings (
    id TEXT PRIMARY KEY,
    max_bytes INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
```

O progresso existente continua sendo a fonte de `current_page`; `reader_states` guarda somente enquadramento e pan para não duplicar esse dado nem quebrar bancos já existentes. Novas importações preenchem `source_ref` para cada página. Para bancos antigos, a migração deriva a referência a partir de `source_path` e do nome da página quando isso for determinístico; se não for possível, o arquivo derivado atual continua válido e a UI informa que aquela página não pode ser reconstruída depois de uma limpeza. A migração será idempotente e coberta por testes de banco v1/v2/v3.

As operações expostas ao frontend nativo serão equivalentes a:

- `set_publication_favorite`;
- `list_bookmarks`, `upsert_bookmark`, `remove_bookmark`;
- `save_reader_state`, `load_reader_state`;
- `get_cache_info`, `set_cache_limit`, `clear_cache`;
- `delete_publication`;
- `ensure_page_cache` e atualização de acesso das páginas abertas.

Cada comando valida o identificador antes de montar caminhos. A remoção de cache somente poderá atuar dentro do diretório de cache resolvido pelo backend.

## Fluxos de erro e recuperação

- Se a origem estiver ausente, a biblioteca mantém a entrada com diagnóstico e permite removê-la sem tocar em outros arquivos.
- Se a reconstrução de uma página falhar, o reader anuncia o erro, mantém o progresso e oferece tentar novamente ou voltar à biblioteca.
- Se o cache for limpo pelo sistema operacional, a próxima abertura reconstrói apenas a página solicitada e suas vizinhas prioritárias.
- Se a gravação de estado falhar, a leitura continua em memória e o status informa que a retomada pode não sobreviver ao fechamento.
- Nenhum erro de cache pode apagar a origem importada.

## Abordagens rejeitadas

1. **Somente localStorage:** simples para o navegador, mas inadequado para reconstrução nativa, cache grande e persistência confiável após reinício.
2. **Snapshot do processo estilo Quick Resume:** depende do sistema operacional e não é uma capacidade portátil de Tauri; será substituído por checkpoint persistente e pré-carregamento.
3. **Apagar arquivos de origem junto com a publicação:** destrutivo e incompatível com a promessa local-first; a exclusão fica limitada aos dados derivados do leitor.

## Verificação e critérios de aceitação

### Frontend

- Testes Vitest cobrem zoom, limites, scrubber, bookmarks, favoritos, filtros, recuperação de estado e mensagens acessíveis.
- `npm.cmd test -- --reporter=dot` e `npm.cmd run build` passam.
- Smoke check visual cobre biblioteca, leitura, miniaturas, zoom, modal de diagnóstico, modo estreito e movimento reduzido.

### Rust/Tauri

- Testes de migração, CRUD de favoritos/bookmarks, exclusão sem tocar na origem, LRU do cache, reconstrução de página e round-trip do estado de leitura.
- `cargo fmt --check`, Clippy com `-D warnings`, `cargo test` e `npm.cmd run tauri build` passam no ambiente Windows com MSVC.
- O instalador gerado localmente é identificado e o workflow do GitHub Actions mantém o build Windows como artefato verificável, sem publicação automática.

### Segurança de dados

- O arquivo/pasta de origem permanece byte a byte intacto após excluir a publicação e limpar o cache.
- Caminhos de cache não podem escapar do diretório de dados da aplicação.
- Bookmarks, favoritos e estado sobrevivem a fechar/reabrir o aplicativo e à limpeza do cache.

## Fora do escopo desta fase

- Portar o aplicativo para Xbox ou integrar Quick Resume real.
- Sincronização em nuvem, contas e catálogo online.
- Remoção automática ou edição dos arquivos originais.
- Modelo ONNX ou editor visual completo do Adaptive Flow.
