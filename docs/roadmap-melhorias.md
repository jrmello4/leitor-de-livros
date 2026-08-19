# Roadmap de melhorias

Atualizado em 12 de agosto de 2026.

Este documento reúne ideias para transformar o Tactile Reader em uma versão usável no dia a dia, mantendo o foco em leitura local, privacidade, fluidez e controle do leitor. Ele complementa o escopo técnico de `docs/implementation-slices.md`; não adiciona contas, sincronização em nuvem ou catálogo online ao v1.

## Estado atual

O projeto já possui uma base funcional para Windows com:

- biblioteca local e persistência nativa de progresso e preferências;
- importação de pastas de imagens, CBZ, CBR e PDF;
- cache derivado sem alterar os arquivos originais;
- leitura em página única ou spread, LTR/RTL, teclado, roda do mouse e arraste;
- fullscreen, movimento reduzido e fallback WebGPU → WebGL2 → página estática;
- Adaptive Flow geométrico com correção manual persistida;
- enquadramento maior e virada de página com quina, confirmação e cancelamento revisados.

O teste de fumaça do instalador e a matriz visual passam de ponta a ponta, e a linha de base de performance abaixo foi medida em hardware real. Continuam abertas a validação em uma segunda máquina de referência (GPU integrada) e a assinatura do instalador.

## Critério de prioridade

- **P0 — indispensável:** bloqueia uma versão confiável para uso diário.
- **P1 — alto impacto:** melhora bastante conforto, descoberta ou acessibilidade.
- **P2 — evolução:** agrega profundidade depois que a base estiver estável.

## Próximo passo recomendado: versão 0.1.1 utilizável

### P0 — Fechar a experiência de leitura

1. **Teste de fumaça do instalador Windows** — *concluído*

   Automatizar e também executar manualmente: instalar do zero, abrir, importar um CBZ e um PDF, fechar, reabrir, continuar da última página e remover uma publicação. O teste deve registrar diagnóstico quando o PDFium estiver ausente e confirmar que os arquivos de origem permanecem intactos.

   **Aceitação:** uma instalação limpa chega à leitura sem configuração manual; progresso e preferências sobrevivem ao reinício; falhas mostram uma ação compreensível.

2. **Matriz visual de virada e fullscreen** — *concluído*

   Criar fixtures e capturas para página única, spread, LTR, RTL, fullscreen, cancelamento, limite da publicação e movimento reduzido nos três backends de renderização. O objetivo é detectar regressões como página saindo pelo lado errado, corte, rolagem ou controles sobrepostos.

   **Aceitação:** nenhuma combinação aprovada apresenta clipping, página invertida, área vazia inesperada ou gesto iniciado fora da quina ativa.

3. **Benchmark de fluidez e memória** — *concluído em GPU dedicada; falta GPU integrada*

   Medir importação, abertura, navegação de 50 páginas, troca rápida de publicação e sessão longa em pelo menos um PC integrado e um PC com GPU dedicada. Registrar tempo de primeiro quadro, p95 do frame time, uso de memória e crescimento do cache.

   **Aceitação:** a qualidade se reduz antes de a interação ficar travada; o cache tem limite e a sessão longa não cresce sem controle.

### P1 — Deixar a leitura confortável

4. **Modos de enquadramento e zoom**

   Adicionar `ajustar à página`, `ajustar à largura`, zoom controlado, pan com espaço/arraste e restauração por publicação. O fullscreen deve oferecer uma leitura de largura útil para páginas muito altas sem esconder o final da página.

   **Aceitação:** o leitor consegue alternar entre composição completa e leitura de detalhes sem perder a posição nem criar rolagem acidental.

5. **Navegação de publicação**

   Adicionar miniaturas, scrubber de progresso, salto para página, marcadores e atalhos documentados. Em publicações longas, a busca deve permanecer responsiva e indicar quando a página ainda está sendo preparada.

   **Aceitação:** chegar a uma página distante exige uma ação clara e o leitor sempre sabe onde está; todos os comandos têm foco visível e alternativa de teclado.

6. **Biblioteca pessoal**

   Evoluir busca e ordenação para coleções, tags, favoritos, filtro por formato e filtro por progresso. Mostrar melhor o estado de importação, duplicatas e publicações com erro, sem apagar a entrada original automaticamente.

   **Aceitação:** uma biblioteca com dezenas de títulos continua fácil de filtrar e uma publicação problemática não bloqueia as demais.

7. **Diagnóstico e recuperação local**

   Criar uma tela de erro com retry, limpar cache derivado, abrir a pasta de origem e copiar diagnóstico técnico sem incluir conteúdo das páginas. Incluir limites e espaço usado pelo cache nas configurações.

   **Aceitação:** o leitor consegue se recuperar de cache corrompido, PDF inválido, arquivo removido e pouco espaço sem reinstalar o aplicativo.

8. **Acessibilidade e localização**

   Revisar foco de teclado, nomes de controles, contraste, escala de texto e leitores de tela. Depois, adicionar português e externalizar também mensagens de importação, fallback e diagnóstico.

   **Aceitação:** biblioteca, configurações e leitura são navegáveis sem mouse; movimento reduzido remove a dobra sem remover feedback de estado.

### P2 — Evoluir o diferencial

9. **Adaptive Flow com editor de painéis**

   Oferecer edição visual de regiões, ordem e direção quando a geometria errar. Só adicionar um fallback ONNX depois de escolher pesos licenciados e uma coleção de validação representativa; até lá, a rota manual é a opção correta.

   **Aceitação:** qualquer sugestão pode ser corrigida em poucos gestos, a correção fica associada à publicação e o modelo nunca substitui silenciosamente a composição original.

10. **Perfis exportáveis e presets de leitura**

   Expor presets como `Conforto`, `Mangá`, `Tela pequena` e `Alto contraste`, além de exportar/importar apenas preferências, sem caminhos locais nem histórico da biblioteca.

   **Aceitação:** o leitor pode experimentar e desfazer uma configuração com segurança; um perfil importado não altera arquivos nem progresso.

11. **Distribuição pública controlada**

   Assinar o instalador, publicar artefatos em GitHub Releases, anexar checksum e documentar rollback. Um canal de atualização só deve ser considerado depois de a instalação offline e a migração de dados estarem comprovadas.

   **Aceitação:** cada release é reproduzível, identificável e instalável sem depender de arquivos gerados no diretório de desenvolvimento.

## Linha de base de performance

Primeira execução completa da harness (`npm run test:performance`), com o aplicativo instalado a partir do instalador NSIS. Antes disto a harness nunca havia produzido um relatório: ela rodava os cinco cenários e descartava o resultado ao montá-lo.

**Máquina:** Intel Core i7-10700, 25 GB RAM, NVIDIA GeForce GTX 1650 (ANGLE/D3D11), Windows 11 Pro 10.0.26200. Classe de GPU: dedicada.

| Cenário | Medido | Orçamento | Resultado |
|---|---|---|---|
| Importação (CBZ de 50 páginas) | 316 ms | — | passou |
| Primeiro frame | 750 ms | 1500 ms | passou |
| Navegação de 50 páginas | p95 17,0 ms · máx 17,1 ms | 33,4 ms | passou |
| Troca rápida de publicação | p95 16,9 ms · p95 de troca 107 ms | 50 ms | passou |
| Sessão longa | p95 16,9 ms · máx 17,2 ms · 3509 frames | 33,4 ms | passou |
| Crescimento de memória em sessão longa | 5,09 MB | 256 MB | passou |
| Crescimento do cache derivado | 0 | 512 MB | passou |

**Ressalva:** é uma execução única. Uma corrida anterior registrou um frame isolado de 366 ms na navegação, que não se repetiu. Um cenário sensível à carga da máquina precisa de amostras repetidas antes de ser tratado como referência estável; estes números valem como ponto de partida, não como garantia.

Falta medir em um PC com GPU integrada, que é o outro alvo declarado do v1.

## Listagem da biblioteca não carrega mais todas as páginas

`LibraryDb::list_publications` fazia uma consulta por publicação e materializava **toda página de toda publicação** só para desenhar a grade de capas. O resultado era serializado em JSON, cruzava o IPC e era remapeado no front, ou seja, três materializações de dados que a tela da biblioteca não usa.

A listagem agora devolve `pageCount`, `coverSrc` e `currentPageId`; o leitor pede as páginas da única publicação que abre, via `list_publication_pages`.

Medido em build release, mediana de 7 execuções, cache do SQLite quente:

| Biblioteca | Páginas totais | SQLite antes | SQLite depois | JSON antes | JSON depois |
|---|---|---|---|---|---|
| 5 × 40 | 200 | 0,2 ms | 0,1 ms | 26 KB | 2,0 KB |
| 50 × 200 | 10.000 | 8,0 ms | 1,3 ms | 1,31 MB | 20 KB |
| 200 × 400 | 80.000 | 71,5 ms | 10,3 ms | 10,57 MB | 82 KB |

O custo da abertura deixou de crescer com o total de páginas e passou a crescer com o número de publicações. Uma publicação de pasta de imagens continua reportando os nomes dos arquivos, porque a busca da biblioteca procura por eles.

A guarda `npm run test:scale-sweep` reproduz a medição.

## Sequência sugerida

1. **Sprint 1:** smoke test do instalador, matriz visual, teste de arquivos originais e benchmark inicial.
2. **Sprint 2:** zoom/enquadramento, miniaturas, scrubber e bookmarks.
3. **Sprint 3:** biblioteca com coleções, diagnósticos e cache visível.
4. **Sprint 4:** acessibilidade/localização e revisão de release.
5. **Depois:** editor Adaptive Flow, modelo local licenciado e distribuição assinada.

## Definição de “versão usável”

Uma versão pode ser considerada pronta para uso diário quando:

- CBZ e PDF importam, abrem e retomam após fechar e reabrir;
- a virada não inicia no centro, não sai pelo lado errado e não deixa estado preso;
- página única, spread, LTR, RTL e fullscreen foram conferidos em resoluções diferentes;
- WebGPU, WebGL2 e fallback estático têm comportamento compreensível;
- teclado, foco, contraste e movimento reduzido funcionam;
- erro de arquivo, falta de PDFium e cache cheio têm diagnóstico e recuperação;
- o instalador Windows foi testado em uma máquina limpa;
- os resultados de performance e os limites conhecidos estão documentados.
