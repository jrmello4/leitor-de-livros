# Análise do projeto — 28/08/2026

Base analisada: commit `9a01178`, versão declarada `0.1.1`.

## Síntese

A base de leitura local é consistente: separação entre domínio, interface e núcleo Rust; preservação dos originais; cache limitado; migrações e testes de recuperação. O maior retorno agora está em consolidar as funcionalidades recentes e sua integração com o aplicativo Windows, antes de ampliar o escopo.

Foram identificados nove grupos de melhorias: três P1, cinco P2 e um P3. Nenhum P0 foi demonstrado. P1 indica prioridade antes de divulgar a funcionalidade como pronta; P2 indica correção ou evolução no próximo ciclo; P3 indica manutenção de menor urgência.

## Verificações executadas

| Verificação | Resultado nesta análise |
| --- | --- |
| `npm test -- --reporter=dot` | 297 testes aprovados, 56 arquivos |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml` | 48 aprovados; 1 benchmark ignorado por padrão |
| `npm run build` | TypeScript e Vite aprovados |
| `npm run test:release-scripts` | 13 aprovados |
| `npm run test:performance-contract` | 18 aprovados |
| Build web | JS 459,30 kB, 137,80 kB gzip; CSS 57,47 kB, 11,43 kB gzip |
| GitHub Issues | A consulta de issues abertas retornou vazia |
| Interface | Inspeção da biblioteca e de controles no navegador local; renderização WebGPU observada no leitor |
| Detector Impeccable | Nenhum apontamento mecânico nos quatro novos diálogos; isso não valida seus fluxos |

Total: **376 testes aprovados**, além do build web.

Não foram executados nesta análise: instalação/desinstalação do aplicativo, matriz visual completa, benchmark em GPU integrada, teste prolongado de memória, auditoria completa de dependências ou chamada real ao Gemini. Os contratos de performance aprovados não são uma medição de performance do produto.

Os primeiros testes/builds encontraram restrições do sandbox; as execuções autorizadas passaram. O Cargo atualizou automaticamente a versão do pacote no lockfile durante o teste; essa única alteração foi revertida para preservar a implementação original. Nenhuma issue foi criada e nenhum código de produção foi alterado.

## 1. [P1] Sincronização precisa usar a persistência real do Windows

**Evidência observada:** `src/app/SyncModal.tsx:26` monta o pacote a partir de `localStorage`; a importação, a partir da linha 74, também grava apenas nele. Já `src/services/readerState.ts` grava favoritos e marcadores no SQLite quando o ambiente é nativo. O progresso é espelhado no navegador por `App.tsx:794`, mas a inicialização carrega o estado nativo. O callback de sincronização em `LibraryView.tsx:552` atualiza estatísticas, conquistas e resenhas, sem recarregar a biblioteca/progresso/marcadores do `App`.

**Impacto:** favoritos e marcadores nativos podem ficar fora da exportação, e importar progresso não atualiza sua fonte de verdade no Windows. A mensagem de sucesso não representa necessariamente os dados usados pelo leitor.

Há dois problemas adicionais:

- A identidade nativa depende do caminho de origem (`src-tauri/src/importer.rs:91`, `:167` e importadores de arquivos); a versão web gera IDs aleatórios. O mesmo quadrinho em dois dispositivos pode não ter o mesmo ID, impedindo associar o histórico ao volume correto.
- `validateSyncBundle` aceita `{version: 1, exportedAt: 'invalid-date', stats: {}}`. A reprodução isolada retornou `true`, e a mesclagem falhou com `incoming.favorites is not iterable`. Além disso, o diálogo ignora os retornos booleanos das gravações e pode anunciar sucesso após falha de armazenamento.

**Recomendação:** um módulo de exportação/importação com adapters para SQLite e navegador; identidade portátil com estratégia explícita de correspondência; validação completa e limites de tamanho; prévia de conflitos; gravação transacional ou recuperação de falhas parciais. Especificar como remover favoritos/marcadores e como lidar com releitura, pois união de listas e maior índice não representam todas essas intenções.

**Esforço:** alto. **Verificação:** exportar/importar entre duas bases nativas independentes, com caminhos diferentes; reabrir o aplicativo e conferir progresso, favoritos, marcadores e erros de escrita.

## 2. [P1] Resumo por IA está incompatível com o produto e com sua configuração

**Evidência observada:** `src/domain/recap.ts:85` usa `gemini-1.5-flash`. O Google registra o encerramento desse modelo em 29/09/2025. [Changelog oficial](https://ai.google.dev/gemini-api/docs/changelog#september-29-2025).

A CSP em `src-tauri/tauri.conf.json:28` não permite conexões com `generativelanguage.googleapis.com`. Por não declarar `connect-src`, aplica-se o fallback de `default-src`; portanto, a configuração de produção também é incompatível com essa chamada. Esta conclusão deriva da configuração e do padrão, não de um teste do instalador nesta análise. [Especificação CSP](https://www.w3.org/TR/CSP/#directive-connect-src).

O prompt recebe título, sinopse, personagens e número de página, **não o conteúdo efetivamente lido**. Assim, não há base para garantir um resumo fiel até uma página exata ou ausência de spoilers. O resumo local também mostra a sinopse e os personagens do volume inteiro, além de frases narrativas inferidas apenas da porcentagem.

`src/app/RecapModal.tsx:35` guarda a chave da API em texto no `localStorage`. A interface mantém mensagens como “device only”, enquanto esta funcionalidade tenta enviar metadados e posição de leitura a um serviço externo. Não foi observada transmissão de imagens das páginas neste código.

**Recomendação:** retirar temporariamente a promessa de resumo narrativo sem spoilers. Manter uma recapitulação factual de posição e notas locais. Se IA externa continuar no escopo, explicitar dados enviados e consentimento, proteger a chave, atualizar o modelo e a política de conexão de forma restrita, adicionar timeout/cancelamento e fundamentar a resposta apenas em conteúdo autorizado. Não basta trocar o nome do modelo.

**Esforço:** médio para restringir e esclarecer; alto para oferecer resumo fundamentado. **Verificação:** erros de serviço, política de conexão no build distribuído, cancelamento e exemplos com diferentes edições/paginações.

## 3. [P2] Resumo confunde páginas não carregadas com volume de uma página

**Reproduzido:** `generateLocalRecap({title: 'Volume teste', pageCount: 30, pages: [], currentPage: 14}, 14)` retornou página zero, total 1 e 100% de progresso. O correto para esse exemplo LTR seria página 15 de 30, 50%.

**Causa:** `src/domain/recap.ts:17` usa `publication.pages.length` para total e limites. A biblioteca nativa usa resumos com `pageCount` e carrega as páginas apenas ao abrir o leitor. `LibraryView.tsx:574` abre o resumo diretamente sobre esse objeto resumido.

**Recomendação:** usar a contagem declarada e a regra de progresso/direção compartilhada pelo leitor. Não carregar imagens só para calcular posição. Diferenciar nos tipos um resumo de biblioteca e uma publicação com páginas carregadas.

**Esforço:** baixo. **Verificação:** páginas ainda não carregadas, volume vazio, página única, limites e RTL.

## 4. [P2] Estatísticas e conquistas precisam de regras consistentes

**Reproduzido:** `loadReadingStats()` devolveu sequência atual 7 para histórico cuja última atividade era de 2020; `calculateStreaks` devolveu 0 para esse mesmo histórico em 28/08/2026. A função de leitura, em `src/services/storage.ts:207`, só verifica se o valor é objeto; não normaliza nem recalcula a sequência na data atual.

**Outras evidências:** `ReaderView.tsx:138` conta uma página em qualquer mudança de índice, inclusive retorno e salto. Uma abertura sem mudança não conta atividade. A avaliação recebe `publicationCount: 1`. A biblioteca calcula conquistas usando o total real, mas não persiste o mapa atualizado dessa avaliação. Não há chamadas de produção registrando minutos ou conclusões no histórico diário.

**Recomendação:** definir o significado de “página lida”, releitura e sessão ativa; recalcular sequências ao carregar e ao mudar o dia; centralizar eventos e persistência; usar totais reais da biblioteca; validar completamente dados armazenados antes de entregá-los à interface.

**Esforço:** médio. **Verificação:** intervalo de dias sem ler, meia-noite, salto, retorno, modo spread, volume único, conquistas após importar/remover publicações e armazenamento malformado.

## 5. [P1] Diálogos novos não mantêm o contrato de teclado e idioma

**Observado no navegador:** o diálogo de sincronização abre mantendo o foco no botão externo; Escape não o fecha. Os componentes novos não implementam gestão inicial de foco, contenção/restauração de foco e fechamento por Escape de forma compartilhada. `aria-modal="true"` sozinho não implementa esses comportamentos.

**Observado no código:** atalhos globais do `App` não têm conhecimento desses diálogos. Em `ReaderView.tsx:294`, o listener usa `recapModalOpen`, mas esse estado não está na lista de dependências do efeito. Isso é uma fonte adicional de comportamento desatualizado; o efeito completo no leitor não foi reproduzido de forma conclusiva nesta sessão.

**Localização confirmada:** com a interface em inglês, aparecem “Avaliação”, “Todas as notas”, “Nuvem & Multi-Dispositivo” e descrições em português. Há textos fixos também em resenhas, estatísticas, resumo e labels acessíveis.

**Recomendação:** um módulo de diálogo que cuide do foco, Escape, restauração e prioridade dos atalhos; localizar todos os textos e mensagens; testes reais de Tab/Shift+Tab/Escape e ativação por teclado. A promessa de interface operável sem mouse deve valer também para as novas telas.

**Esforço:** médio. **Verificação:** percorrer cada diálogo inteiramente por teclado, sem acionar a leitura ao fundo; testar inglês e pt-BR. Para a etapa de UI: `/impeccable harden`, seguido de `/impeccable polish`.

## 6. [P2] Metadados do CBZ precisam chegar também pelo núcleo nativo

**Evidência observada:** o importador web utiliza `parseComicInfoXml`, mas o DTO e o mapeamento de `src/services/nativeLibrary.ts:367` não transportam `metadata`. Os modelos e a persistência nativa analisados não oferecem o mesmo contrato de ComicInfo ao frontend.

**Impacto:** informações de coleção, resumo e correspondência de séries que funcionam com dados web ou fixtures podem perder contexto ao usar o aplicativo Windows.

**Recomendação:** definir um contrato compartilhado e persistir metadados de ComicInfo no caminho nativo. Exibir explicitamente quando os dados não estão disponíveis, sem inventar sinopse/personagens.

**Esforço:** médio. **Verificação:** importar o mesmo CBZ com ComicInfo nos dois adapters, reiniciar e comparar os campos usados pela interface.

## 7. [P2] Medir o custo de abertura de bibliotecas maiores

**Observado, impacto ainda não medido:** `App.tsx:199` busca marcadores e estado de leitura para todas as publicações com `Promise.all`. São duas chamadas por publicação: 200 volumes provocam 400 chamadas de metadados. O SQLite é protegido por um único `Mutex`, de modo que essa concorrência não implica consultas simultâneas.

`db.rs:1349` executa quatro consultas por resumo de publicação, além da consulta inicial e de nomes para pastas de imagens. A melhoria anterior que removeu a materialização de todas as páginas deve ser preservada; não há evidência nesta análise de que esse custo residual já viole um orçamento.

**Recomendação — medir primeiro:** usar os cenários existentes para comparar 10/100/1.000 publicações, distinguindo início frio e quente. Se necessário, carregar estado e marcadores somente ao abrir um volume ou disponibilizar uma consulta em lote. Medir o fluxo completo de abertura, não apenas `list_publications`.

**Impacto esperado:** desconhecido até medir. **Esforço:** baixo para instrumentar; médio para modificar. **Risco:** perder ou atrasar dados do leitor se a hidratação for alterada sem testes. **Complexidade:** manter os adapters existentes. **Reversibilidade:** alteração localizada. **Guarda:** benchmark de abertura e testes de retomada/marcadores. Não adicionar virtualização, dependências ou caches novos sem necessidade medida.

## 8. [P2] Reduzir acoplamento e testar integrações, não só componentes

O `App.tsx` tem aproximadamente 1.477 linhas e concentra importação, cache, perfis, navegação, persistência e atalhos. `ReaderView.tsx` tem aproximadamente 1.003; `styles.css`, 3.915. `db.rs` tem 3.973, mas parte considerável são testes, portanto esse total não deve ser confundido com implementação.

O problema não é o número de linhas isoladamente: os dados da sincronização divergem dos adapters existentes, e o resumo assume um formato de publicação diferente do usado pela biblioteca. São sinais concretos de invariantes espalhadas.

**Recomendação:** extrair gradualmente módulos de sessão de leitura, importação/cache e dados pessoais, cada um com interface pequena e responsabilidade clara. Distinguir tipos de resumo e publicação carregada. Evitar criar camadas que apenas repassem chamadas.

**Testes prioritários:** sincronização nativa com reinício e falha de escrita; resumo sobre biblioteca paginada; passagem de dias nas estatísticas; navegação modal por teclado; localização dos fluxos novos. `SyncModal.test.tsx` atualmente verifica apenas renderização e fechamento pelo botão; os testes existentes de resumo usam páginas já carregadas.

**Esforço:** médio, incremental. Preservar a suíte atual e acrescentar casos de integração nas superfícies existentes. Não há justificativa para reescrever o projeto.

## 9. [P3] Atualizar documentação e tornar a verificação de release mais estrita

README, PRODUCT e roadmap descrevem uma fase anterior e divergem sobre recursos entregues, idioma e sincronização. A interface atual também já se afastou de parte da direção visual descrita. É preciso decidir o que é produto suportado, experimento e trabalho futuro.

`Cargo.toml` declara `0.1.1`, enquanto o lockfile versionado ainda declara `0.1.0` para o pacote local. O teste Cargo reescreveu essa entrada automaticamente. Os testes de versão dos manifestos passaram mesmo com essa diferença.

**Recomendação:** atualizar o lockfile em uma alteração própria, incluir sua consistência na verificação e usar `--locked` no CI. Atualizar as promessas de privacidade e plataformas; chamar transferência manual por JSON de transferência/backup, sem sugerir sincronização automática em nuvem. Manter explicitamente pendentes a assinatura do instalador e a validação em GPU integrada até haver evidência.

**Esforço:** baixo. **Verificação:** checkout limpo, testes/build sem alteração em arquivos rastreados e documentação alinhada aos fluxos realmente suportados.

## Experiência de uso: melhoria de produto de baixo risco

A biblioteca já tem identidade visual consistente e uma ação de continuar leitura clara. Na captura de aproximadamente 1265 × 712, porém, a apresentação ocupa quase toda a primeira tela e as capas ficam abaixo da dobra. Para uso diário, vale experimentar uma biblioteca mais compacta após o primeiro acesso: manter “continuar”, busca e importação próximos das capas; reservar a explicação extensa para o estado inicial. É uma proposta de UX, não um defeito funcional nem um redesenho autorizado.

Na triagem Impeccable, acessibilidade e integridade das promessas são as áreas mais frágeis. Há tokens e regras responsivas existentes, mas os novos estilos repetem cores fixas. Não foi atribuída nota global: contraste completo, escala de texto e matriz de tamanhos exigem uma rodada específica. Não se deve penalizar um produto Windows por não oferecer uma experiência móvel que não foi definida como suportada.

## Sequência sugerida

1. Corrigir a fonte de verdade da sincronização e limitar a promessa do resumo por IA.
2. Resolver resumo paginado, estatísticas, teclado e localização, com regressões automatizadas.
3. Completar a paridade de metadados no Windows e atualizar documentação/lockfile.
4. Medir abertura com bibliotecas maiores e GPU integrada; otimizar apenas onde houver evidência.
5. Fazer a extração incremental dos módulos e experimentar a biblioteca compacta.

Essas etapas podem ser tratadas separadamente. Uma nova auditoria de interface após as correções pode verificar os fluxos pendentes antes do polimento final.
