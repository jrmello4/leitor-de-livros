# Reader 2.0 — acabamento final

Data: 30/09/2026. Base: `fafdf27` / release `v0.5.0`.

## Correções restritas ao Reader

- `ReaderContent` guarda painel e HUD fora do `key`. O `key` continua envolvendo a navegação e o zoom; muda com publicação, modo, capa e direção. O painel permanece aberto até Concluir, voltar ou dispensar o modal pelo comportamento padrão do Android.
- `ReaderWindow` fica na camada estável. Assim, uma troca de modo não desmonta os efeitos de orientação, barras do sistema e tela ligada. Não houve alteração da implementação desses efeitos.
- O painel mostra a preferência solicitada enquanto a direção ainda está sendo confirmada no banco. Alterar outro ajuste nesse intervalo não sobrescreve a direção escolhida.
- Um teste encontrou deslocamento acumulado da página ao reagrupar spreads repetidamente. `ReaderPagedContent.positionIndex` preserva o ID físico usado como âncora entre modos; progresso persistido continua usando a última página lógica do spread, como antes. `ReaderScreen` mantém essa distinção também ao sair ou suspender o Reader. Nenhuma regra do banco ou de `FINISHED` foi alterada.
- Imagens ajustadas têm descrição de página apenas no container; `AsyncImage` é decorativa para a semântica. No caminho Webtoon, o número do placeholder também deixa de competir com a descrição do container.
- Slider mantém navegação/persistência ao soltar. A posição imediata é informada junto ao seek para preservar a âncora em uma troca de modo subsequente. Não houve aumento de gravações durante o arrasto.

PDF, 7z, Coil, preload e `PageCacheManager` permaneceram nos caminhos existentes, sem dependências novas ou migração de schema.

## RTL: decisão pendente de mangá real

**A implementação atual RTL inverte a ordem lógica das páginas do arquivo.**

Um arquivo `001, 002, …, 100` começa em `100` e termina em `001`. Esse comportamento foi preservado nesta tarefa; testes sintéticos de consistência não confirmam que seja a escolha correta para um mangá real.

Arquivo: `native/app/src/main/java/com/jrmello4/tactilereader/reader/ReaderSettings.kt`.

- `readingOrder(pages, direction)`: política de **PAGE ORDER**; usa `pages.asReversed()` em RTL. É chamada pelos caminhos paginado e contínuo.
- `visualSpread(spread, direction)`: posição espacial dentro do spread, **READING DIRECTION**. Agora é independente de `readingOrder`, mantendo o mesmo resultado atual.
- `tapStep` e `ReaderGestureLayer.readerGestures`: direção das zonas de toque e do swipe. Não determinam a ordem do arquivo.

Se o teste real indicar que RTL deve manter `001 → 100`, a mudança aprovada começa em `readingOrder`, mantendo as inversões espaciais/gestuais em `visualSpread` e `tapStep`. Também será necessário alinhar a página terminal em `core/ReadingStateRules.finalPageIndex` e os índices iniciais/métricas de `ReaderViewModel` (`refresh`, `configureDirection`, `logicalIndex`). Alterar apenas `asReversed()` deixaria finalização e métricas incoerentes. Esses pontos estão documentados, sem aplicar a decisão antecipadamente.

## Strings e acessibilidade

Textos hardcoded de UI/acessibilidade no pacote `reader`, incluindo números formatados e fallbacks de erro: **38 ocorrências antes, 0 depois**. Contagem sobre o código da base `fafdf27`, excluindo IDs, chaves de preferência/cache, nomes de arquivo e comentários. Foram usados nomes semânticos em `native/app/src/main/res/values/strings.xml`, mantendo PT-BR e as labels existentes.

Ícones de configurações/marcador, retorno, zoom e slider usam resources existentes ou novos. As opções conservam papel de radio button, estado selecionado e cabeçalhos; switches e Concluir mantêm os componentes Material e seus alvos. Não há novos botões de anterior/próxima/fechar HUD: os controles existentes continuam sendo zonas de toque, gestos, volume e slider. A experiência auditiva completa com TalkBack ainda depende do teste físico.

## Testes desta rodada

| Verificação | Resultado |
|---|---|
| `testDebugUnitTest` | PASS — 145 testes, 0 falhas, 0 erros, 0 ignorados |
| `lintRelease` | PASS — 0 erros, 17 avisos |
| `assembleDebug` | PASS |
| `compileDebugAndroidTestSources` | PASS — somente compilação |
| Instrumentados | PASS — 31 testes distintos aprovados no Moto G34/Android 15; detalhes abaixo |
| Device físico | PASS nos cenários descritos abaixo, usando instalação `.readerqa` |

Validação local com JDK 21, `TEMP/TMP=C:/tmp`, em uma única chamada Gradle das quatro tarefas acima. APK local de teste: `native/app/build/outputs/apk/debug/tactile-native-0.5.0+29-debug.apk`, com pacote separado `.readerqa`. As correções compõem a versão `0.5.1`; o APK distribuído é gerado e assinado pelo workflow oficial do GitHub, separado desse APK de QA.

PASS abaixo significa aprovação nos cenários locais e físicos executados; PARTIAL indica necessidade de validação auditiva adicional.

| Item | Estado |
|---|---|
| Settings sheet permanece aberto | PASS |
| Strings Reader | PASS |
| Acessibilidade | PARTIAL — semântica automatizada passou; áudio TalkBack pendente |
| Slider | PASS — teste existente confirma ausência de salvamentos durante o arrasto |
| Mode switching | PASS |
| Direction switching | PASS — consistência no aparelho; decisão de ordem RTL em mangá real pendente |
| Cover alone switching | PASS |
| HUD | PASS |
| Immersive | PASS — status/navegação ocultos sem HUD, visíveis com HUD/painel e restaurados ao sair |
| Keep screen on | PASS — preferência ON/OFF, trocas de modo e remoção ao sair no aparelho |
| Binge regression | PASS — quatro modos × LTR/RTL, visibilidade, saída do card, cancelar e completar timer |

Quatro testes de regressão em `ReaderFinishingTest` cobrem:

1. Painel/HUD vivos através de modo, direção, capa, ajuste e fundo; zoom reiniciado ao trocar modo.
2. Âncora válida nos quatro modos, nas duas direções e nas duas políticas de capa, sem finalização prematura de uma página intermediária.
3. Outro ajuste não sobrescreve direção com salvamento pendente.
4. Uma descrição semântica por página, nos caminhos ajustado e Webtoon.

Inicialmente não havia aparelho conectado. Após o usuário fornecer novo pareamento, o Moto G34 5G/Android 15 conectou em `192.168.0.14:38649` e executou o código atual do acabamento.

### Validação física adicional

- **22 testes PASS:** 18 testes existentes do pacote Reader e os quatro testes de `ReaderFinishingTest`, adaptados temporariamente ao runner Android. Incluem imagens reais Coil, todos os modos/ajustes, volume LTR/RTL, pinch/pan/swipe, slider sem gravações intermediárias, retomada com offset, métricas e fonte em 200%.
- **8 cenários PASS:** binge em Single/Double/Vertical/Webtoon × LTR/RTL. O timer não começa antes do card; sair dele cancela; cancelar manualmente impede abertura; completar o timer abre uma vez.
- **1 teste PASS:** barras de status e navegação, painel/HUD estáveis, preferência de tela ligada nos quatro modos e limpeza ao sair. A primeira medição usava a máscara conjunta `systemBars()` e expirou ao verificar visibilidade. Sem alterar o código do app, medir status e navegação individualmente passou; a conferência externa por `dumpsys window` também confirmou as duas barras visíveis com HUD.
- Conferência do app instalado com o CBZ sintético `Reader2-QA`: painel continuou aberto ao selecionar Página dupla; rotação Sistema → Paisagem → Sistema manteve o painel aberto e o spread das páginas físicas 2/3; Concluir voltou ao HUD na página 3/8. Após encerrar e reabrir o processo, a preferência Double e o mesmo spread 2/3 foram retomados. A troca LTR → RTL → LTR no app instalado manteve o painel aberto e voltou ao mesmo spread/página 3/8. Ao sair para a estante, `dumpsys window` confirmou `mHoldScreenWindow=null`.
- O pacote principal permaneceu em `0.4.0`, código 27; somente `.readerqa` e seu APK de testes foram instalados. Não houve correção adicional de produção nesta rodada.

Os adapters/harnesses usados no aparelho estão no diretório ignorado `native/app/build/reader-device-qa/finishing-src`, sem duplicar os testes no código versionado. Evidências: `finishing-reader-results.txt`, `finishing-window-binge-results.txt` e `finishing-window-confirmation.txt`. Capturas: `finishing-hud.png`, `finishing-settings-double.png`, `finishing-landscape-sheet.png`, `finishing-after-orientation.png` e `finishing-resume.png`.

Permanecem pendentes **a experiência auditiva completa com TalkBack** e **o teste de um mangá CBZ real para decidir a política RTL**. O arquivo sintético não substitui essa decisão editorial.

## Checklist física — fixtures no aparelho

- [x] Abrir configurações.
- [x] Trocar Single → Double sem sheet fechar.
- [x] Trocar Double → Vertical sem sheet fechar.
- [x] Trocar Vertical → Webtoon sem sheet fechar.
- [x] Trocar LTR → RTL.
- [x] Trocar RTL → LTR.
- [x] Ativar/desativar capa separada.
- [x] Mudar Fit Screen/Width/Height (Webtoon permanece em Width).
- [x] Mudar fundo.
- [x] Mudar orientação.
- [x] Ativar keep screen on; sair do Reader e verificar remoção da flag.
- [x] Testar slider: arrastar, soltar e conferir a página/spread.
- [x] Testar HUD e barras do sistema ao abrir/fechar configurações.
- [x] Testar zoom após troca de modo.
- [x] Testar binge: última página, visibilidade do card, timer e cancelar nos quatro modos e em LTR/RTL.
- [ ] Testar mangá CBZ real em RTL: **o mangá começa pela capa ou pela contracapa?**

Durante cada troca, verificar que o ID/página física atual continua no novo modo ou spread, que não há página vazia/duplicada e que uma página intermediária não marca a obra como concluída.
