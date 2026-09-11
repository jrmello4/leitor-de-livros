# Zoom ancorado no modo webtoon — 2026-09-08

## Causas verificadas

- A posição de rolagem era salva no App sobre uma cópia persistida do estado,
  enquanto o ReaderView mantinha o zoom atual e o salvava após 200 ms. Durante
  uma pinça lenta, esse caminho devolvia um zoom antigo ao ReaderView. No teste
  anterior à correção, a escala chegou a 1,56 e voltou a 1,00 no movimento seguinte.
- Recapturar o ponto de referência a cada movimento acumulava arredondamentos
  do scroll e mudanças de layout. Corrigir apenas a persistência ainda deixou
  deriva de até 68 px na reprodução.
- O bloqueio do IntersectionObserver expirava entre movimentos lentos; a
  correção interna de scroll podia ser interpretada como navegação.
- Na WebView Android, a abertura da biblioteca falhava com `mode is invalid`:
  o frontend normalizava o perfil para `webtoon`, mas o Rust não aceitava esse modo.

## Correção

O ReaderView agora atualiza zoom e posição em um único estado local e persiste
esse estado em conjunto. A pinça captura uma coordenada relativa à página no
início e a mantém durante todo o gesto. A compensação ocorre antes da pintura,
com `overflow-anchor: none` para evitar outra compensação pelo navegador.

Notificações de navegação ficam suspensas durante a pinça, inclusive nas pausas.
O dedo restante ao finalizar não inicia uma rolagem involuntária. Depois de
soltar os dedos, uma nova rolagem normal continua funcionando. O validador Rust
aceita `webtoon` e continua rejeitando modos desconhecidos.

## Evidências

As skills de performance, investigação, verificação e revisão React orientaram
a reprodução temporal, a conferência das fronteiras frontend/SQLite e a revisão
do estado transitório; não foi considerada suficiente a aprovação dos testes unitários.

| Validação | Resultado |
| --- | --- |
| Vitest | 305 testes passaram, 56 arquivos |
| Rust `cargo test --lib` | 48 passaram; 1 ensaio de escala ignorado |
| Build frontend e APK debug | Passaram |
| Chromium móvel, demonstração | Desvio máximo 0,634 CSS px |
| Chromium, capítulo de 120 páginas, meio/fim | Desvio máximo 0,634 CSS px |
| Chromium, pausas de 300 ms | Desvio máximo 0,585 CSS px |
| Chromium, dimensões iniciais estimadas | Desvio máximo 0,631 CSS px |
| Moto g34 5G, WebView real, página 26/50 | Desvio máximo 0,381 CSS px |
| Moto g34 5G, WebView real, página 50/50 | Desvio máximo 0,347 CSS px |

Nos testes do navegador, apenas a fronteira de I/O nativo é simulada. No aparelho,
o CBZ de teste foi importado pelo Rust, as imagens vieram do cache real e o estado
foi salvo no SQLite real. Os gestos foram enviados por CDP à WebView, não executados
manualmente. Escala de 1,00 a 1,96, com 24 movimentos e pausas de 300 ms; o zoom
permaneceu em 1,96 após o prazo de persistência. A volta a 1,00, a retirada dos dedos
em momentos diferentes e a rolagem seguinte passaram no aparelho.

A abertura do leitor para o CBZ sintético com cache quente levou 412 ms em uma
medição. Isso não mede importação, cache frio ou documentos grandes do usuário.
O APK foi atualizado com `adb install -r -t`, sem limpar os dados do aplicativo.

## Repetir

```powershell
npm.cmd test -- --reporter=dot
npx.cmd playwright test --config playwright.perf.config.ts webtoon-zoom --reporter=list
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Para o aparelho, gere arquivos com
`node scripts/performance/create-performance-fixtures.mjs <pasta-temporaria>`,
importe uma cópia de `performance-50.cbz` com o nome
`zoom-regression-20260908.cbz`, abra o APK debug e encaminhe o socket
`webview_devtools_remote_<pid>` para TCP 9223 usando adb. Execute:

```powershell
node scripts/performance/verify-android-zoom.mjs http://127.0.0.1:9223
```

O script só seleciona a publicação sintética com esse título, pois altera seu
progresso. Remova a publicação de teste depois; não use um documento pessoal.

Neste Windows, o Gradle precisou de um diretório temporário explícito para os
sockets Java. Foi usado JDK 21 e `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=<pasta-existente>`,
somente no processo de build, sem alterar configurações globais.
