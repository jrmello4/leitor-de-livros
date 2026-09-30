# Reader 2.0 — implementação e validação

Data: 30/09/2026. Android nativo, Kotlin e Compose.

## Resultado

- `testDebugUnitTest`: **141 testes, 0 falhas e 0 erros**, após todas as correções.
- `lintRelease`: **0 erros, 17 avisos existentes**.
- `assembleDebug`, `assembleDebugAndroidTest` e `assembleRelease`: **PASS**.
- Testes instrumentados: **44 testes, 0 falhas**, no Moto G34 5G com Android 15.
- Após reconectar o ADB wireless, a repetição completa dos **44 testes instrumentados passou**, incluindo o código da última correção do cartão “Continuar”.
- Conferência física após encerrar e reabrir o processo: configuração `SINGLE_PAGE` mantida, cartão “Continuar” na página 3/8 e Reader retomado na mesma página 3/8.

A instalação física utilizou o pacote separado `.readerqa`. O pacote principal permaneceu em `0.4.0`, código 27, sem substituição ou remoção. Os testes usaram arquivos sintéticos e bancos isolados.

## Funcionalidades

PASS significa aprovação nos cenários executados abaixo, dentro dos limites descritos no fim deste documento.

| Recurso | Estado | Evidência |
|---|---|---|
| Single page | PASS | Imagens reais, toque, swipe e progresso no aparelho |
| Double page | PASS | Spreads, capa separada, páginas ímpares e imagens em retrato/paisagem |
| Vertical | PASS | Imagens reais, rolagem e navegação por volume |
| Webtoon | PASS | Imagens longas, retomada com offset e rolagem de publicação com 120 páginas |
| LTR | PASS | Navegação, posição persistida e métricas de sessão |
| RTL | PASS | Ordem, tap/swipe/volume, finalização central, backup e métricas |
| Tap zones | PASS | Zonas laterais e HUD central, sem avanço durante zoom |
| Swipe | PASS | Avanço LTR/RTL e prioridade do gesto ampliado |
| Pinch zoom | PASS | Gesto multiponto no aparelho sem navegação acidental |
| Double tap | PASS | Alternância de zoom e prioridade sobre navegação |
| HUD | PASS | Semântica, controles acessíveis e fonte em 200% |
| Slider | PASS | Salva somente ao soltar, alvo de toque mínimo de 48 dp |
| Fit modes | PASS | Três ajustes em quatro modos com imagens reais; Webtoon usa largura |
| Orientation | PASS | Paisagem física e restauração da orientação ao sair |
| Immersive mode | PASS | Barras ocultas no Reader e retorno na saída |
| Keep screen on | PASS | Flag ativa durante leitura e removida ao sair |
| Preload | PASS | Janela de vizinhos e cache existentes; ver limites de memória abaixo |
| Binge | PASS | Card só depois da navegação final; cancela ao sair e suspende em segundo plano |

## Regressões exercitadas

- CBZ importado pelo seletor SAF real; abertura das páginas e retomada após encerrar o processo.
- CBR/RAR5 real, decodificação e reconstrução no Android.
- PDF gerado pelo Android: indexação sem renderização antecipada, pixels renderizados pelo `PdfRenderer`, PDFs homônimos isolados e reconstrução após limpar cache.
- 7z: ordem natural, extração sob demanda, reconstrução e original intacto.
- Lote com PDF/7z corrompidos: diagnóstico individual e importação do arquivo válido restante.
- SQLite: progresso, retomada, favoritos, marcadores, limpar progresso, marcar como lido, reabertura e estatísticas.
- Backup: 11 cenários no aparelho, incluindo reimportação com novos IDs, ambiguidade, manifesto diferente, estados de leitura, direção RTL e compatibilidade com backups antigos.
- OPDS: testes locais de feed, links, redirecionamento de credenciais e download; Android Keystore testado no aparelho. Não houve conexão com um servidor real Komga/Kavita.
- Atualizador: validações locais existentes de URL, SHA-256, redirecionamento e assinatura. Nenhuma atualização externa foi instalada.
- Navegação e semântica das telas existentes; Reader com fonte ampliada e painel de configurações rolável.

## Correções encontradas pelos testes

1. **Retomada vertical:** aplicar o offset apenas uma vez, inclusive quando o estado passa de carregando para pronto. Evita um ciclo de reposicionamento contínuo.
2. **Backup RTL:** guardar a direção e restaurá-la antes da posição, preservando progresso e estado de leitura. Campo adicional compatível com backups anteriores; sem migração de schema.
3. **Fonte grande:** compactar o botão de retorno quando necessário para manter zoom, configurações e marcador dentro da tela. Switches e slider possuem alvos de pelo menos 48 dp.
4. **Métricas RTL:** iniciar a sessão na última página física quando uma publicação RTL não tem posição salva. Sessões novas, retomadas e encerramento repetido foram exercitados no Android.
5. **Texto do cartão “Continuar”:** usar a fração fornecida pelo núcleo. Antes, 3/8 era mostrado como página 4; agora corresponde à página 3. Testes locais atualizados para o contrato real do núcleo e conferência física após reiniciar o processo aprovada.

Testes instrumentados antigos também foram ajustados às labels atuais do app e à importação de arquivos individuais; não foi alterado o contrato do importador para aceitar uma pasta como arquivo.

## Decisões técnicas e arquivos principais

- `reader/ReaderSettings.kt` e `ReaderSettingsSheet.kt`: preferências globais, persistidas em SharedPreferences.
- `reader/ReaderPagedContent.kt`, `ReaderFittedImage.kt` e `ReaderGestureLayer.kt`: página/spread atual, ajuste proporcional e gestos coordenados.
- `reader/ReaderContent.kt`: preserva a LazyColumn existente para modos contínuos, retomada e binge.
- `reader/ReaderControls.kt` e `ReaderWindow.kt`: HUD, slider, orientação, barras e tela ligada somente durante leitura.
- `reader/ReaderScreen.kt` e `ReaderViewModel.kt`: âncora entre modos, persistência fora da main thread e sessões.
- `core/LibraryDb.kt`: usa a coluna de direção existente e as regras centrais de estado.
- `settings/BackupManager.kt`: direção portátil no backup.
- `library/LibraryProgressCards.kt`: correção restrita ao número exibido na retomada.
- Testes novos em `src/test/.../reader`, `src/androidTest/.../reader`, `ExtendedFormatsDeviceTest.kt` e `BackupManagerDeviceTest.kt`.

LTR/RTL seguem a página terminal de `ReadingStateRules`. A ordem RTL começa na última página física e termina no índice zero. Não foi criada outra regra de finalização na UI.

## Performance

O Reader continua usando Coil para imagens visuais e `PageCacheManager` para arquivos derivados. Não foi criado cache paralelo de Bitmaps. PDF e arquivos compactados continuam no caminho existente de reconstrução fora da main thread.

Uma rodada completa de 44 testes registrou:

| Cenário | PSS inicial | Pico | Crescimento | Limite do teste |
|---|---:|---:|---:|---:|
| Janela de decodificação de HQ longa | 108618 KiB | 129180 KiB | 20562 KiB, cerca de 20 MiB | 80 MiB |
| UI real Coil, publicação de 120 páginas, 30 swipes | 259331 KiB | 285209 KiB | 25878 KiB, cerca de 25 MiB | 120 MiB |

São medições de fixtures no Moto G34, não um benchmark universal. O segundo cenário verifica progresso efetivo, pixels das páginas e memória durante a rolagem; não representa leitura integral de todas as 120 páginas.

## Reproduzir

```powershell
$env:JAVA_TOOL_OPTIONS='-Djdk.net.unixdomain.tmpdir=C:\Users\adenilson.j\.codex\tmp'
native/gradlew.bat -p native :app:testDebugUnitTest :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:assembleRelease
```

Para testes físicos, instalar um pacote de QA separado do app do usuário. Nesta execução, um init script temporário em `native/app/build/reader-device-qa/init.gradle` aplicou `.readerqa` apenas ao build debug. O diretório `build/` é ignorado pelo Git.

O APK release local da validação foi verificado e está assinado com `CN=Android Debug`. É um artefato de teste. Para a publicação `v0.5.0`, o GitHub Actions gera outro APK com a chave oficial e verifica sua assinatura; apenas esse artefato assinado é distribuído.

## Limites e checklist complementar

- Testar acervo pessoal grande, PDFs extensos e imagens 4K; a cobertura atual usa fixtures controladas.
- Testar servidor real OPDS/Komga/Kavita, downloads cancelados pela UI e armazenamento externo/SD.
- Avaliar leitura com TalkBack ativado; os testes verificam semântica, não a experiência auditiva completa.
- Testar tablet e outros níveis de Android; a execução física desta tarefa ocorreu somente no Moto G34/Android 15.
- Conferir conforto de pan/zoom, rotação e binge em leitura prolongada com conteúdo pessoal.

Relatórios locais regeneráveis: `native/app/build/reports/tests/testDebugUnitTest/index.html`, `native/app/build/reports/lint-results-release.html` e `native/app/build/reports/androidTests/connected/debug/index.html`. A cópia do XML da rodada física final está em `native/app/build/reader-device-qa/device-results.xml`.

Capturas da conferência física: `native/app/build/reader-device-qa/continue-after-restart.png` e `native/app/build/reader-device-qa/resume-after-restart.png`.
