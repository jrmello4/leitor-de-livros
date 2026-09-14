# Android: estado da implementação

A especificação de 08/09/2026 está em `docs/superpowers/specs/2026-09-08-mobile-android-comic-reader-design.md`.

## Base disponível

O projeto existente usa React 19, TypeScript e Tauri 2, com biblioteca local,
SQLite nativo, leitura de páginas, modo Webtoon e navegação para próximo volume.
O núcleo já declara `cdylib` e o ponto de entrada móvel do Tauri.

## Implementado nesta etapa

- Webtoon mantém montadas apenas as imagens das páginas visíveis e uma vizinha
  de cada lado. Contêineres com proporção preservam a altura das páginas removidas.
- O observador mantém as interseções entre callbacks incrementais, inclusive
  para imagens muito altas. O componente reinicia ao mudar de publicação.
- Rolagem automática ajustada ao tempo entre frames, para não dobrar a velocidade
  em telas de 120 Hz.
- Faixa contínua sem preenchimento nas extremidades, viewport com suporte a
  recortes, áreas seguras e controles com altura mínima de 44 px em telas pequenas.
- Teste de janela com 120 páginas e entradas/saídas incrementais.
- Posição Webtoon persistida como `pageId` + `scrollRatio` (relativo à página),
  com migração SQLite nativa da versão 5 para a 6 e restauração ao reabrir.

A desmontagem de imagens não revoga os URLs de blobs pertencentes ao importador:
eles ainda são compartilhados pela publicação. Portanto, esta mudança limita
imagens montadas, mas não garante o orçamento total de 180 MB. O carregamento
sob demanda e o ciclo de vida dos bytes devem ser implementados no fornecedor
nativo de páginas antes de anunciar esse requisito como cumprido.

## Trabalho necessário para entregar o aplicativo Android

1. ~~Preparar Android SDK/NDK, ferramentas de plataforma e alvos Rust.~~ Concluído.
2. ~~Gerar o projeto Android pelo CLI Tauri instalado.~~ Concluído. Ainda falta
   separar os recursos
   Windows (especialmente `pdfium.dll`) da configuração móvel. CBR já possui
   backend Android; PDF continua pendente.
3. Implementar o plugin SAF com seleção de pasta, permissão persistida e leitura
   de `content://`; os caminhos de arquivos desktop não substituem esse fluxo.
4. ~~Persistir `{ pageId, scrollRatio }` em SQLite com migração e restauração.~~ Concluído.
5. Implementar pastas, seleção múltipla e metadados no scanner nativo.
6. Implementar OPDS/Komga/Kavita, credenciais protegidas e downloads canceláveis.
7. Completar gestos móveis, transição automática entre volumes e controles de
   hardware. O botão existente de próximo volume não é transição automática.
8. Medir RAM, FPS e restauração de leitura em aparelho Android, com capítulo
   de mais de 100 imagens longas, e gerar APK de teste.

Não há APK Android validado nesta etapa. Os testes de DOM não medem GPU, RAM
ou comportamento de toque da WebView em um aparelho físico.

## Validação física de 09/09/2026

O aplicativo foi instalado e aberto em um Moto G34 5G ARM64. O primeiro teste
identificou sobreposição do HUD com as barras do sistema, navegação inacessível,
duplo toque inoperante e pressão excessiva durante a pinça. A revisão seguinte:

- posiciona os HUDs abaixo/acima das áreas reservadas do Android;
- substitui controles circulares sem rótulo por setas visíveis e alvos de 44 px;
- implementa duplo toque no Webtoon alternando entre 1x e 2x;
- agrupa eventos excedentes da pinça por frame, mantendo a primeira resposta
  imediata;
- preserva o botão de retorno à biblioteca no HUD superior;
- compacta o controle de autoscroll e o afasta da navegação do sistema.

O APK ARM64 atualizado e assinado para testes está em
`artifacts/android-test/tactile-mobile-ui-debug.apk`. A instalação incremental
preservou os dados existentes. Os testes específicos do leitor passaram (23/23)
e a matriz visual passou em 21/21 cenários. O PSS observado no capítulo real foi
aproximadamente 189 MB, ainda acima do objetivo de 180 MB; otimização adicional
do ciclo de vida das imagens continua necessária.

## Validação física — Moto G34 5G (09/09/2026)

- Dispositivo ARM64 conectado e autorizado por ADB sem fio.
- APK universal de depuração instalado e atividade
  `com.jrmello4.tactilereader/.MainActivity` iniciada com sucesso.
- O frontend de desenvolvimento abriu uma publicação real já persistida no modo
  Webtoon, respeitando a barra de status, a navegação por gestos e a largura do
  viewport.
- Nenhum crash, ANR ou erro fatal da WebView foi encontrado na amostra de log.
- Memória observada durante a leitura: `TOTAL PSS 189537 KB`, acima em cerca de
  9,5 MB do orçamento de 180 MB. A amostra isolada não substitui o ensaio longo
  com capítulo de 100 imagens.
- O toque central observado não revelou o HUD completo e alterou a posição de
  leitura. O controle flutuante de autoscroll apareceu parcialmente reduzido na
  captura seguinte; ambos precisam de reprodução dirigida no aparelho.
- Evidências: `artifacts/android-test/mobile-visual-installed.png` e
  `artifacts/android-test/mobile-reader-hud.png`.

O APK instalado foi reaproveitado do build de depuração existente. O núcleo Rust
ARM64 atual recompilou, mas a remontagem do APK continua bloqueada no host por
`java.io.IOException: Unable to establish loopback connection` ao iniciar o
processo Gradle. A interface atual pôde ser exercitada pelo servidor de
desenvolvimento configurado no APK.

## Toolchain preparado

O SDK existente em `C:\Android\Sdk` foi validado com NDK 28.2, Android 35,
Build Tools 35 e CMake. Os alvos Rust `aarch64-linux-android` e
`x86_64-linux-android` foram instalados e a estrutura gerada pelo
`tauri android init` está em `src-tauri/gen/android`.

O núcleo compilou para `aarch64-linux-android`. A montagem do APK parou no
Gradle antes da compilação Java/Kotlin, com `java.io.IOException: Unable to
establish loopback connection` / `Invalid argument: connect` ao iniciar o
daemon de uso único. É necessário repetir em uma sessão Windows/Java em que o
Gradle possa abrir seu canal local, ou ajustar o ambiente Java/Gradle.

Durante a preparação inicial, o CBR foi tornado condicional. Em 09/09/2026 o
stub Android foi substituído por `unrar-rs`, mantendo o `unrar` já usado no
Windows.

## Reteste físico do HUD e gestos — 09/09/2026

O frontend atual foi embutido no núcleo ARM64, remontado sobre o invólucro
universal que contém o plugin de importação, alinhado, assinado e instalado de
forma incremental no Moto G34 5G. A biblioteca persistida permaneceu intacta.

- biblioteca e leitor respeitam as áreas da barra de status e navegação;
- toque central abre e fecha o HUD;
- retorno do leitor abre novamente a biblioteca;
- duplo toque alterna de 1x para 2x (largura medida: 411 para 823 CSS px);
- pinça multitoque foi exercitada até o limite de 5x;
- `Importar HQ` abre o seletor nativo `DocumentsUI`;
- não houve crash, ANR ou erro fatal na amostra de logs;
- `TOTAL PSS` medido após HQ real e zoom foi 174024 KB, dentro do alvo de
  180 MB nesta amostra, embora o ensaio longo com mais de 100 imagens continue
  pendente.

O APK validado está em `artifacts/android-test/tactile-mobile-ui-debug.apk`.
O Gradle do host ainda falha ao criar sua conexão loopback; por isso o pacote
foi remontado e assinado a partir dos artefatos Android já gerados.

## Suporte CBR no Android — 09/09/2026

- leitura local de CBR em RAR4 e RAR5 por backend Rust incluído no APK;
- nenhuma dependência de WinRAR, RAR for Android ou outro aplicativo externo;
- extração limitada a uma página por vez, com limites para arquivo, página,
  quantidade de páginas e total descompactado;
- bloqueio explícito de arquivos criptografados, volumes divididos, caminhos
  inseguros e nomes duplicados;
- reconstrução do cache de páginas CBR disponível no Android;
- compilação ARM64 passou e 49 testes Rust passaram (1 teste de benchmark
  ignorado);
- APK assinado instalado incrementalmente e iniciado no Moto G34 5G sem crash
  ou ANR.
- o contêiner é identificado pela assinatura real, não apenas pela extensão;
  arquivos ZIP chamados `.cbr` são tratados automaticamente como CBZ.
- validação com `Arqueiro Verde Absoluto #01.cbr`: o arquivo era ZIP apesar da
  extensão, 36 páginas foram indexadas e a primeira página foi reconstruída no
  cache com sucesso.

O APK desta revisão está em `artifacts/android-test/tactile-cbr-debug.apk`.

## Importação de coleções e contêineres mistos — 10/09/2026

- arquivos `.zip` que contêm várias HQs (`.cbr`, `.cbz`, `.7z` ou `.pdf`) são
  extraídos e importados em lote, sem alterar os originais;
- a assinatura real do contêiner é validada, incluindo 7z renomeado como
  `.cbr`, uma ocorrência encontrada na coleção do aparelho;
- no teste da coleção OneDrive (118 itens), 117 publicações foram indexadas e
  um arquivo foi isolado por conteúdo inválido/indetectável;
- APK ARM64 atualizado e assinado:
  `artifacts/android-test/tactile-7z-collection-debug.apk`.

A reinstalação e o reteste desse último arquivo dependem de o Moto G34 voltar a
aparecer no ADB sem fio; o dispositivo ficou offline após o teste anterior.

## Reteste final no Moto G34 — 10/09/2026

- APK atualizado instalado incrementalmente via ADB sem fio, preservando a
  biblioteca existente;
- cold start validado com 124 publicações visíveis (a inicialização agora faz
  retentativa enquanto o SQLite termina de abrir);
- a publicação que falhava foi importada como 7z renomeado, com 27 páginas e
  sem diagnósticos;
- duplo toque alternou 1x/2x, pinça alcançou 5x e o botão de retorno voltou à
  biblioteca com 124 cards;
- `Importar HQ` abriu o DocumentsUI; não houve crash, ANR ou erro fatal nos
  testes;
- evidências: `artifacts/android-test/collection-124-library.png` e
  `artifacts/android-test/collection-7z-reader.png`.

## Build reproduzível e artefato final — 10/09/2026

- O build Android completo passou com `TEMP/TMP=C:\tmp` e `JAVA_HOME` apontando
  para o JDK 21; o caminho curto evita a falha de socket local do Java/Gradle
  observada no ambiente do agente.
- O APK universal foi gerado pelo Gradle já com o módulo rastreado
  `src-tauri/mobile-import-plugin/android`, incluindo seleção de pasta e
  extensões `.cbz`, `.cbr` e `.rar`; ele não depende do código Kotlin gerado e
  ignorado pelo Tauri.
- O artefato assinado para instalar/testar é
  `artifacts/android-test/tactile-all-improvements-debug.apk` (assinaturas v2 e
  v3 verificadas).
- Uma tentativa de instalação no Xiaomi conectado em 10/09 retornou
  `INSTALL_FAILED_USER_RESTRICTED`; o Android exige confirmação/“Instalar via
  USB” no aparelho. Nenhuma configuração de segurança do dispositivo foi
  alterada para contornar essa proteção.

## Validação final — Motorola Moto G34 via Wi‑Fi — 10/09/2026 11:13–11:33

- O alvo foi confirmado antes da instalação pelo modelo `moto g34 5G`, Android
  15, resolução física 720×1600; o Xiaomi USB não foi usado.
- `tactile-all-improvements-debug.apk` foi instalado com sucesso por ADB sem
  fio e o app abriu preservando a biblioteca de 124 publicações.
- A tela do leitor abriu uma publicação CBR de 27 páginas; o HUD superior e a
  barra inferior ficaram dentro das áreas seguras do aparelho, sem cobrir a
  barra de status ou a navegação do sistema.
- Toque central ocultou/mostrou o HUD, duplo toque alternou para zoom 2×, Back
  voltou à biblioteca e o menu Paper Atelier abriu/fechou tanto pelo botão
  quanto pelo Back do Android.
- O botão **Import folder** abriu o DocumentsUI na pasta `HQ`, mostrando os
  arquivos CBR e a ação **USAR ESTA PASTA**; a seleção foi cancelada para não
  duplicar a coleção já importada.
- Após novo pareamento (`192.168.0.10:39807`), o APK foi reinstalado e o
  cold-start foi repetido; a biblioteca voltou a renderizar as capas após a
  hidratação, sem erro fatal no logcat.
- Evidências: `artifacts/android-test/moto-wifi-final-launch.png`,
  `moto-wifi-reader-initial-2.png`, `moto-wifi-hud-hidden.png`,
  `moto-wifi-double-tap.png`, `moto-wifi-back-library.png`,
  `moto-wifi-reader-menu-open.png`, `moto-wifi-reader-menu-back-close.png` e
  `moto-wifi-import-folder-picker.png`, `moto-wifi-final-relaunch-loaded.png`,
  `moto-wifi-final-reader.png` e `moto-wifi-final-double-tap.png`.

## Nomes originais e agrupamento de séries — 10/09/2026

- A seleção múltipla do Android e a extração de coleções ZIP agora isolam cada
  arquivo em um subdiretório, preservando o nome original da HQ. Os índices de
  cópia não entram mais no título.
- As listagens e os resultados de importação corrigem a exibição dos nomes
  legados somente quando o caminho identifica um prefixo criado pelo app
  (lote SAF, ponte Android antiga ou coleção ZIP). Os registros, caminhos,
  arquivos, IDs, progresso e marcadores não são reescritos. Números legítimos,
  como em `2000 AD`, e títulos personalizados são preservados.
- Em **Agrupar por série**, a chave ignora diferenças de maiúsculas e espaços;
  as edições são ordenadas numericamente (`#00`, `#01`, `#02`, `#10`). Datas,
  créditos e subtítulos após o número explícito não criam novos grupos.
  A ação de próxima edição usa a mesma identidade da série.
- Coleções previamente extraídas reutilizam os caminhos antigos, evitando
  criar novos IDs apenas pela mudança no esquema de nomes.
- Validação: 317 testes Vitest passaram; 55 testes Rust passaram, com um teste
  de escala ignorado. Os testes de regressão cobrem nomes legados, reinício,
  reimportação, arquivos homônimos e preservação dos originais e marcadores.
- Build Android ARM64 concluído. APK assinado e verificado (v2/v3):
  `artifacts/android-test/tactile-series-fix-v2-debug.apk`. O hash da biblioteca
  nativa dentro do APK corresponde ao binário recém-compilado.
- O teste inicial no Motorola detectou uma diferença de diretórios: no Android,
  `app_data_dir` é a raiz privada do pacote, enquanto a ponte SAF usa
  `files/imports`. A correção também reconhece os aliases `/data/data` e
  `/data/user/0` da mesma área do usuário principal, sem alterar caminhos salvos.
- Revisão final instalada e validada no Motorola `moto g34 5G` / `ZF524TDGWV`
  via Wi-Fi. As 124 publicações mantiveram os mesmos IDs, contagens de páginas,
  progresso, favoritos, datas e marcadores; 123 títulos tiveram seus prefixos
  corrigidos. Nenhum aparelho USB foi usado.
- Arqueiro Verde Absoluto aparece em um único grupo com seis entradas, na ordem
  `#01`, `#01`, `#01`, `#01`, `#02`, `#03`. As quatro cópias preexistentes de
  `#01` foram preservadas; esta correção não elimina duplicatas.
- Conferência reproduzível: `scripts/android/verify-series.mjs` (snapshot
  `before` e comparação `after` no WebView encaminhado por ADB). Evidências:
  `artifacts/android-test/series-verification.json` e `moto-series-grouped.png`.
  A busca foi limpa ao terminar, deixando a biblioteca agrupada no aparelho.

## Estante por séries e revisão de repetidas — 10/09/2026

- No Android, a biblioteca abre na estante de séries. Cada card representa uma
  série e monta as edições somente após ser aberto; a estante real de 124 HQs
  mostrou 11 cards de série, nenhum card de edição e uma única capa visível na
  primeira tela. Isso é uma observação do DOM/render, não uma medição de tempo.
- A navegação interna traz o botão **All series** e preserva a ordem numérica
  das edições. A página de Arqueiro Verde Absoluto abriu seis edições em ordem.
- Um marcador **possible duplicate** identifica entradas com mesma série,
  edição e contagem de páginas. É apenas uma sugestão para revisão manual:
  nenhuma HQ é removida, combinada ou alterada automaticamente.
- Validado no Motorola via Wi-Fi: `moto-series-folders-root.png` e
  `moto-series-folder-open.png`. APK instalado:
  `artifacts/android-test/tactile-series-folders-v2-debug.apk` (assinaturas v2
  e v3 verificadas).

## Gestos e plataforma — rodada Android-only

- Flag nativa `runtime_platform` (Rust) substitui a detecção por user-agent na
  importação SAF e nos handlers de Back (`src/services/platform.ts`).
- Webtoon: componente `PageImage` limpa `src` ao sair da janela virtual, pedindo
  à WebView que descarte o bitmap decodificado.
- Teclas de volume tentam rolar um bloco quando a WebView as entrega via
  keydown (`AudioVolumeUp`/`AudioVolumeDown`). No Moto G34 as teclas ainda
  podem controlar o volume do sistema; confirmar em device.
- Binge: o card de próximo volume, ao ficar visível (~35%) por ~1,6s, abre a
  próxima edição automaticamente, com botão Cancelar.
- Escape do recap incluído nas dependências do efeito de teclado do leitor.
- Pipeline desktop removido do produto; shell host segue só para testes.
## Performance e visual do webtoon

- Placeholders com `content-visibility: auto` + `contain: layout style paint`
  (altura via `aspect-ratio`) para não pintar páginas fora da tela.
- Removidos `transform: translateZ(0)` permanente e `scroll-behavior: smooth`
  (camada extra por página / frames extras no pan).
- `WebtoonPageItem` memoizado: rolagem só re-renderiza quem entra/sai da janela.
- Imagem da página atual usa `fetchPriority=high` e `loading=eager`; vizinhas
  ficam em `low`/`lazy`. Zoom acima de 1x aplica `is-zoomed` (qualidade alta).
- Telas ≤720px: strip full-bleed, `contain: paint` por página, folio discreto,
  letterbox preto/escuro nos fundos OLED/dark.
## Atualização in-app (GitHub Releases)

- Plugin `app-updater-plugin`: `check_update` lê `latest.json`; `download_and_install`
  baixa o APK (HTTPS, máx. 200 MB) e abre o instalador do sistema via FileProvider.
- Permissão `REQUEST_INSTALL_PACKAGES`; na 1ª vez o Android pede autorização.
- UI em Configurações → Atualização do app.
- Documentação: `docs/android-updater.md`. Modelo de feed: `docs/android/latest.json`.
- Validação no aparelho e publicação da primeira release com `latest.json` ainda pendentes.

## Lote sem-IA + PT-BR + batch nativo — 14/09/2026 (não validado no aparelho)

- IA e Recap removidos: `src/domain/recap.ts`, `RecapModal`, atalho R, botão do
  leitor, card da biblioteca, chaves `recap.*`, `SparklesIcon` e CSS do recap.
  Sem chamadas externas, sem chave em `localStorage`, sem promessa de spoiler.
- Backup local honesto: `SyncModal` virou "Backup local · sem nuvem"
  (`tactile-reader-backup-*.json`); `validateSyncBundle` rejeita data inválida
  e mapas malformados; `mergeSyncBundle` defensivo contra o crash
  `incoming.favorites is not iterable`.
- PT-BR único: locale padrão `pt-BR`, sem seletor de idioma, rodapé
  `EDIÇÃO LOCAL PARA ANDROID`, cache "neste aparelho".
- Memória: preload `new Image()` de 4 páginas desligado no nativo (dimensões
  já vêm do Rust); `PageImage` limpa `src` + `srcset` ao desmontar. Ensaio
  longo com 100+ imagens continua pendente no Moto G34.
- PDF: stubs Android em PT-BR explícito com "original preservado"; backend
  real (MuPDF/NDK) continua pendente.
- Bundle: `ReadingStatsModal`, `ReviewModal`, `SyncModal` e
  `CollectorInfoModal` via `React.lazy` (chunks separados no build).
- Boot em 1 IPC: novo comando `list_library_snapshot` (bookmarks + reader
  states em 2 consultas); `hydrateMetadata` usa o snapshot com fallback ao
  lote de 8. Teste Rust `library_snapshot_returns_all_bookmarks_and_states_in_one_call`.
- Release: `scripts/android/configure-release-signing.mjs` (com teste)
  substitui o python inline do workflow; CI com `cargo --locked`.
- Verificado no host: 322 vitest, 56 Rust (1 ignorado), `tsc+vite`,
  release-scripts, workflow e performance-contract verdes. Reteste físico
  (memória sustentada, gestos, backup, snapshot, assinatura) pendente.

## Núcleo portátil `tactile-core` — 14/09/2026 (host, fase 1 do app nativo)

- Auditoria: só `adapters.rs` acoplava algo (pdfium); `db`, `importer`,
  `models`, `error` e `publication_names` já eram Rust portátil.
- Novo crate `src-tauri/native-core` (`tactile-core`): SQLite, importadores
  CBZ/CBR/7z, cache derivado, bookmarks, reader states, snapshot e nomes de
  série — sem Tauri, sem pdfium. O crate Tauri virou cola fina (`lib.rs` +
  `pdf.rs` com o backend pdfium).
- PDF por injeção: `archive::set_pdf_backend`; sem backend, o core responde
  "indisponível" e preserva originais (mesmo contrato do stub). O Tauri
  registra o pdfium no `setup`; o futuro app nativo registra o dele (ou não).
- Workspace Cargo único (`tactile-reader`, `tactile-core`, plugins) com um
  `Cargo.lock`; CI testa e linta os dois pacotes (`-p tactile-reader
  -p tactile-core`, `verify-workflow.mjs` exige).
- Prova de portabilidade: `cargo check -p tactile-core --target
  aarch64-linux-android` passa com o NDK 28 (unrar-rs, rusqlite bundled,
  image/avif incluídos) — zero `cfg` novo.
- 56 testes Rust preservados (52 core + 4 app, incluindo o fixture pdfium
  real via backend injetado); `fmt`/`clippy -D warnings` verdes nos dois.
- Próximas fases: módulo Android (JNI/UniFFI sobre o core) → tela da
  biblioteca em Compose → superfície de leitura com tiling → import Updater;
  o shell Tauri segue até a paridade.

## Scaffold nativo + JNI provado no host — 14/09/2026 (fase 2)

- `native-core` exporta `cdylib` + `src/jni.rs`: `nativeVersion()` e
  `nativeOpenLibrary(dir)` (abre o SQLite e conta publicações; erros voltam
  como `{"error": ...}`, sem throw JNI). `jni` 0.21.
- `.so` release compilados: arm64-v8a (2,76MB) e x86_64 (2,89MB); símbolos
  `Java_com_jrmello4_tactilereader_core_TactileCore_*` confirmados via
  `llvm-nm`.
- Módulo `native/` (AGP 8.7.3, Kotlin 2.0.21, SDK 35, `applicationId`
  `.scaffold` para coexistir com o APK publicado): `TactileCore.kt`,
  `MainActivity` de prova sem Compose, tasks Gradle `buildCoreSo*` que
  compilam o Rust com o NDK e copiam para `jniLibs/` antes do `preBuild`.
-   `assembleDebug` + `assembleDebugAndroidTest` verdes; APK (6,75MB) embute
  os dois `.so`. `TactileCoreInstrumentedTest` (semver + abrir/contar 0,
  idempotente) compilado e pronto — execução pendente de aparelho
  (`gradlew.bat connectedDebugAndroidTest` com o Moto G34 no `adb`).

## Estante Compose lendo do core — 14/09/2026 (fase 3, validada no Moto G34)

- JNI novo: `nativeListPublications` (`{"publications":[...]}` camelCase) e
  `nativeImportPaths` (retorna o `NativeImportResult` do núcleo).
- `LibraryViewModel` + `LibraryScreen` (Compose Material3, grade 2 colunas,
  progresso por HQ, placeholders por cor até as capas lazy); primeira
  abertura gera e importa sozinha a HQ demo (`TestComic`, 2 PNGs em código).
- Instrumentado no aparelho: 3/3 verdes (`versionLooksLikeSemver`,
  `openLibraryOpensAndReportsZeroPublications`,
  `importGeneratedCbzAndListItBack` — CBZ real importado em 0,15s).
- Forense no banco do app (`run-as` + pull binário): 1 publicação `demo-hq`
  (cbz), 2 páginas, cache sob demanda (0 entradas — igual ao Tauri).
- Botão "+ HQ" com seletor SAF (`OpenDocument` + cópia para `imports/`, sem
  tocar no original) e diagnósticos na tela; fiação provada na JVM
  (`LibraryContentTest`, Robolectric, 3/3 — corre no CI em
  `testDebugUnitTest`). Fluxo com CBR real validado a seguir no aparelho.
- Evidências: `artifacts/android-test/native-jni-proof.png` (tela da prova
  JNI) e `artifacts/android-test/native-library-grid.png` (estante Compose
  com `demo-hq`, 2 páginas, no Moto G34 desbloqueado — o preto anterior era
  a tela de bloqueio, não o app).
- Próximo: capas lazy (ensure da capa + Coil com limite) e depois a
  superfície de leitura com tiling.
- CI (`native-app`): JDK 21 + SDK/NDK + Rust targets, `assembleDebug` e
  `assembleDebugAndroidTest` do scaffold a cada push/PR (`verify-workflow`
  exige o job). Teste instrumentado segue só com aparelho.

## Orçamento de bundle no CI — 14/09/2026 (host)
- `scripts/performance/bundle-budget.mjs` trava: entry ≤380KB, JS total
  ≤560KB, chunk lazy ≤130KB, CSS ≤100KB. Medido: 350KB / 498KB / 110KB / 85KB.
- Etapa `Enforce bundle budget` no CI após o build; `verify-workflow.mjs`
  exige a etapa. Derrubar uma trava exige decisão explícita.

## Fatiamento do App.tsx — 14/09/2026 (host)

- `App.tsx` 1718→539 linhas sem mudar comportamento: `useLibraryMetadata`
  (bookmarks/readerStates/snapshot), `useReadingProfiles` (perfis + backup),
  `useNativeLibraryBoot` (boot com retry + progresso), `usePublicationActions`
  (biblioteca, capas, cache, remoção), `useReadingSession` (navegação,
  persistência, abertura) e `useLibraryImport` (browser/SAF + retry).
- Coordenador de seleção de página segue único, no App, compartilhado por
  sessão (navegação) e ações (remoção cancela a seleção em voo).
- Verificado no host: `tsc+vite`, 322 vitest, budget (entry 352KB) verdes.