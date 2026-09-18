# Dark-First Editorial Workbench

<!-- tactile-reader:design-system 2.0 -->

## 1. Visão e Direção

O **Tactile Reader** adota a direção **Dark-First Editorial Workbench** ("mesa editorial digital de alto acabamento"), substituindo a estética anterior de painel de desenvolvedor por um instrumento de leitura preciso, focado e calmo (Calm Tech).

Construído 100% em **Android Nativo com Kotlin e Jetpack Compose**, o aplicativo prioriza a obra em si: as capas e páginas trazem o drama visual, enquanto a moldura cromática do leitor recua com elegância e respeito à ergonomia de uso com uma mão.

### Princípios Fundamentais
1. **A Obra é Soberana:** A arte das capas e páginas dita a cor viva da experiência. As superfícies da interface permanecem sóbrias em grafite escuro.
2. **Costuras em Vez de Elevação Artificial:** Separação estrutural por linhas finas (*hairline seams* de 1dp) e elevação tonal sutil do Material 3, eliminando gradientes pesados e sombras ornamentais.
3. **Tipografia Editorial com Números Tabulares (`tnum`):** Todos os números de páginas, durações, velocidades e porcentagens usam alinhamento monoespaçado tabular para evitar oscilações visuais e garantir legibilidade rigorosa.
4. **Cores Semânticas Estritamente Reservadas:**
   - **Warm Amber (`#F59E0B`)**: Ação primária, progresso de leitura, estado ativo e marcadores.
   - **Oxide Red (`#D64045`)**: Erros, ações destrutivas e cancelamentos.
   - **Sage Green (`#588157`)**: Sucesso exclusivo e leitura 100% concluída.
   - **Sem Azul Genérico Dominante.**
5. **Ergonomia M3 de Polegar:** Navegação inferior (`NavigationBar`) acessível com uma mão, alvos de toque mínimos de 48dp com 8dp de espaçamento, e FAB de importação posicionado no canto inferior.
6. **Rolagem Unificada:** Telas com rolagem única de ponta a ponta, sem menus ou cabeçalhos travados na metade da tela.

---

## 2. Paleta de Cores e Tokens de Superfície

### Canvas e Camadas Grafite (Dark-First)
- `DarkGraphite950` (`#0B0D11`): Canvas profundo do leitor (otimizado para telas OLED e imersão).
- `DarkGraphite900` (`#101318`): Fundo padrão da Estante, Ajustes, Marcadores e Minha Leitura.
- `DarkGraphite850` (`#161A22`): Barras de navegação inferior e superior, headers e superfícies intermediárias.
- `DarkGraphite800` (`#1C222D`): Superfície de cartões de publicações, séries, seções e modais.
- `DarkGraphite750` (`#242B38`): Containers de controle, filtros secundários e botões de ação secundária.

### Costuras Estruturais (Hairline Seams)
- `SeamSubtle` (`#232B38`): Contorno fino de 1dp para cartões, divisores horizontais e separadores de lista.
- `SeamStrong` (`#333E50`): Contorno de foco, campos de texto ativos e ênfase estrutural.

### Tipografia Editorial Paper
- `Paper50` (`#F7F5EE`): Texto primário de alto contraste (branco editorial com tom sutilmente aquecido).
- `Paper300` (`#C5C0B4`): Texto secundário, descrições e metadados de suporte.
- `Paper500` (`#888275`): Rótulos terciários, cabeçalhos de seção e dicas de uso.

### Acentos Semânticos
- `WarmAmber` (`#F59E0B`): Botões primários, indicador de progresso ativo, estrelas de marcadores.
- `WarmAmberContainer` (`#2E1E08`) / `WarmAmberOnContainer` (`#FDE68A`).
- `OxideRed` (`#D64045`): Botões de remoção, mensagens de erro e botão cancelar download.
- `OxideRedContainer` (`#2D1214`) / `OxideRedOnContainer` (`#FCA5A5`).
- `SageGreen` (`#588157`): Barra de progresso para edições 100% concluídas.
- `SageGreenContainer` (`#142417`) / `SageGreenOnContainer` (`#A3CFAB`).

---

## 3. Tipografia e Numeração Tabular

A tipografia do aplicativo segue a escala Material 3 com font feature settings ativado globalmente para números tabulares:
`fontFeatureSettings = "tnum"`.

- **Title Large:** 20sp, FontWeight.Bold, letterSpacing -0.25sp, `tnum`.
- **Title Medium:** 16sp, FontWeight.SemiBold, letterSpacing 0sp, `tnum`.
- **Title Small:** 14sp, FontWeight.SemiBold, letterSpacing 0.1sp, `tnum`.
- **Body Large / Medium / Small:** 16sp / 14sp / 12sp, FontWeight.Normal, `tnum`.
- **Label Large:** 14sp, FontWeight.SemiBold (botões de ação e abas).
- **Label Small (Headers de Seção):** 11sp, FontWeight.Bold, letterSpacing 1.0sp, uppercase (ex: `RESUMO GERAL`, `ARMAZENAMENTO & CACHE`).

---

## 4. Arquitetura de Navegação e Telas

### Navegação Principal (M3 NavigationBar)
Quatro destinos canônicos na barra inferior:
1. **Estante** (`EditorialIcons.Book`): Coleção local organizada por séries e edições avulsas.
2. **Marcadores** (`EditorialIcons.Bookmark`): Central consolidada de páginas marcadas com navegação direta.
3. **Leitura** (`EditorialIcons.Metrics`): Estatísticas de leitura locais (tempo, ritmo, histórico).
4. **Ajustes** (`Icons.Filled.Settings`): Gerenciamento de armazenamento, backup local, servidores e atualizações.

### Estante (Library)
- **Rolagem Unificada:** Implementada com `LazyVerticalGrid` como container raiz. Não há listas aninhadas com rolagem bloqueada na metade da tela.
- **Hero Card Editorial:** Cartão em destaque com capa expandida, título da série/edição, indicador de progresso com tempo restante estimado e botão de continuidade imediata.
- **Fita de Filtros:** Ribbon horizontal compacto com opções `Tudo`, `Lendo`, `Favoritos` e agrupamento por série.
- **Floating Action Button (FAB):** Botão flutuante `+ HQ` no canto inferior direito, liberando o cabeçalho superior de poluição visual.

### Leitor Vertical
- **Canvas Infinito:** Faixa vertical contínua com carregamento sob demanda de bitmaps via Coil (máximo 1080px).
- **HUD Coordenado:** Top Bar e Bottom Bar em grafite profundo (`Color(0xF2101318)`) com bordas `SeamSubtle`, ativados por toque central e sem ocluir a arte da página desnecessariamente.
- **Folio Tabular:** Indicador inferior com semântica TalkBack: `página X de Y`.
- **Controles Físicos e Gestos:** Teclas de volume para avançar/voltar páginas; duplo toque para zoom 2x; pinça livre para zoom global e pan lateral sem travar a rolagem vertical.
- **Card de Fim de Edição (Binge):** Transição suave para a próxima edição da série com contagem regressiva de 6 segundos e opção de cancelamento.

### Central de Marcadores
- Listagem editorial com badges tabulares `PÁG. X`.
- Toque no marcador abre a publicação diretamente na página salva.
- Confirmação de exclusão com ação reversível e feedback claro.

### Minha Leitura (Estatísticas)
- **100% On-Device:** Sem telemetria, cookies, contas ou chamadas à nuvem.
- Cartões com números tabulares para tempo total de leitura, páginas lidas, sessões e velocidade média (`págs/min`).
- Histórico detalhado por publicação com estimativa de tempo restante baseada no ritmo pessoal do leitor.

### Ajustes e Servidores Remotos
- Seções agrupadas com cabeçalhos estruturados em caixa alta rastreada:
  - `ARMAZENAMENTO & CACHE`: Medição exata em bytes e limpeza com regeneração transparente.
  - `BACKUP LOCAL`: Exportação e importação em formato JSON estritamente local.
  - `SERVIDORES REMOTOS`: Conexão direta com OPDS, Komga e Kavita para streaming sob demanda e download offline.
  - `ATUALIZAÇÃO DO APLICATIVO`: Verificador da release rolling `native-latest` no GitHub com barra de progresso linear em Amber e instalação direta pelo sistema.

---

## 5. Acessibilidade e Inclusão

- **Alvos de Toque:** Mínimo absoluto de 48x48dp em todos os botões e áreas interativas, com margem mínima de respiro de 8dp.
- **Semântica TalkBack:** Anúncios explícitos de headings (`semantics { heading() }`), live regions (`LiveRegionMode.Polite`), rótulos descritivos de ícones e botões (`contentDescription`), e descrições de estado (`stateDescription`).
- **Resiliência de Layout:** Suporte nativo a largura estreita de 320dp sem quebra ou clipping de texto, e adaptação fluida a escalas de fonte de até 1.3x do sistema Android.
