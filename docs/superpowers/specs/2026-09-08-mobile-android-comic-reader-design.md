# Especificação de Design — Leitor Mobile Android (Quadrinhos & Mangás)

**Data:** 08 de setembro de 2026  
**Status:** Aprovado para Planejamento  
**Plataforma-Alvo:** Android (Prioritário) via Tauri v2 Mobile  

---

## 1. Visão Geral e Propósito

Transformar o leitor em um aplicativo móvel de referência para Android focado em quadrinhos, mangás e manhwas, superando as deficiências conhecidas de concorrentes como **ComicReader/ComicScreen** (interfaces desatualizadas no estilo explorador de arquivos, engasgos com arquivos pesados) e **ReadEra** (falta de suporte a servidores de quadrinhos, ausência de rolagem contínua otimizada para webtoons e sem transição automática entre volumes).

### Pilares de Sucesso do Produto
1. **Rolagem Vertical Contínua (Webtoon / Manhwa):** Leitura de alta performance com janela virtualizada (sliding window), sem travamentos de memória ou engasgos mesmo em capítulos com mais de 100 imagens longas.
2. **Biblioteca Híbrida Sem Burocracia:** Varredura local automática das pastas do celular (Downloads, Cartão SD) com agrupamento direto por pastas e suporte nativo a servidores remotos de quadrinhos (OPDS / Komga / Kavita) para streaming e download offline.
3. **Leitura Contínua Entre Volumes (Binge Reading):** Transição automática e fluida entre edições consecutivas (ex.: Volume 1 → Volume 2 → Volume 23) sem interromper a leitura nem forçar retorno à estante.
4. **Organização Direta e Ações Rápidas:** Aba dedicada de navegação por pastas que reflete o armazenamento físico do aparelho, além de seleção múltipla com toque longo para organizar coleções em um único toque.

---

## 2. Arquitetura do Sistema e Plataforma Móvel

A aplicação adota a **Abordagem Tauri v2 Mobile**, reaproveitando o núcleo de alta velocidade em Rust e a camada de interface reativa em React 19 + TypeScript.

```
┌─────────────────────────────────────────────────────────────┐
│                 React 19 Frontend (Android WebView)        │
│  ┌───────────────────────┐  ┌─────────────────────────────┐ │
│  │   Biblioteca Híbrida  │  │  Leitor Mobile Multi-Modo   │ │
│  │  - Visão por Pastas   │  │  - Rolagem Vertical Webtoon │ │
│  │  - Multi-seleção      │  │  - Página Tátil (RTL/LTR)   │ │
│  │  - Catálogo OPDS      │  │  - Adaptive Panel Flow      │ │
│  └───────────────────────┘  └─────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC Tauri v2 (Binário / JNI)
┌──────────────────────────────┴──────────────────────────────┐
│                    Rust Backend (Android NDK)               │
│  ┌───────────────────────┐  ┌─────────────────────────────┐ │
│  │  Scanner Local & SAF  │  │  Extrator CBZ / CBR / ZIP   │ │
│  │  - Storage Access     │  │  - Descompactação em RAM    │ │
│  │  - Cache de Miniaturas│  │  - Parser ComicInfo.xml     │ │
│  └───────────────────────┘  └─────────────────────────────┘ │
│  ┌───────────────────────┐  ┌─────────────────────────────┐ │
│  │  Cliente OPDS / HTTP  │  │   SQLite Local (rusqlite)   │ │
│  │  - Streaming sob demanda│ │  - Progresso com Offset    │ │
│  │  - Downloads offline  │  │  - Coleções e Metadados     │ │
│  └───────────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Compilação e Ambiente Android
- O projeto `src-tauri` compila bibliotecas nativas C-compatíveis (`.so`) direcionadas às arquiteturas `aarch64-linux-android` (smartphones físicos modernos) e `x86_64` (emuladores de desenvolvimento).
- Interface renderizada na WebView de sistema do Android com aceleração por hardware (WebGL2).

### 2.2 Acesso ao Armazenamento (Scoped Storage & SAF)
- No Android 10+, o acesso a diretórios externos é regulado pelo Storage Access Framework (SAF).
- O usuário concede permissão para diretórios raiz de leitura (ex.: `Downloads`, `/storage/emulated/0/Mangas` ou Cartão MicroSD). As URIs persistidas permitem ao Rust listar e ler arquivos sem mover ou alterar os arquivos originais.

### 2.3 Persistência de Dados
- Banco de dados SQLite gerenciado por `rusqlite` localizado no diretório de dados privados do aplicativo (`context.getFilesDir()`).
- Migrações idempotentes garantem segurança e integridade de progresso, favoritos e configurações entre atualizações.

### 2.4 Ergonomia e Safe Areas
- Respeito completo aos recortes de tela (*notches*, câmeras *punch-hole*) e à barra de navegação/gestos do Android através de CSS `env(safe-area-inset-*)`.
- Orientação padrão bloqueada em retrato para leitura com uma mão só, com opção de rotação automática para mangás em spread duplo na horizontal.

---

## 3. Experiência de Leitura no Celular

### 3.1 Leitor de Rolagem Vertical Virtualizada (Webtoon Mode)
- **Janela Deslizante (Sliding Window):** Mantém apenas as imagens visíveis no viewport da WebView (mais 1 imagem de pré-carregamento acima e 1 abaixo). Imagens fora da janela têm seus blobs de memória liberados imediatamente e são representadas por contêineres vazios com altura calculada.
- **Costura Zero (Zero Gap):** Elementos de imagem estilizados sem margens, bordas ou espaços vazios verticais, preservando a continuidade artística dos manhwas.
- **Persistência Sub-Página:** Em rolagem vertical, o progresso é registrado como `{ pageId, scrollRatio }`, garantindo que reabrir a obra reposicione o leitor exatamente na linha dos olhos onde a leitura parou.

### 3.2 Zonas de Toque e Gestos no Smartphone
- **Toque Central (30% da largura central):** Alterna a exibição das barras de ferramentas (HUD superior com título/voltar e HUD inferior com scrubber e atalhos de brilho/modo).
- **Toques Laterais:**
  - Toque na lateral inferior avança um bloco de rolagem suave.
  - Toque na lateral superior retrocede um bloco de rolagem.
- **Pinch-to-Zoom e Duplo Toque:** Zoom livre centrado no gesto do leitor; toque duplo rápido alterna entre 100% de largura e zoom aumentado em balões de texto.
- **Botões de Volume (Hardware):** Configuração opcional para usar as teclas físicas de volume para rolar suavemente a leitura sem tocar na tela.

### 3.3 Leitura Contínua Entre Volumes (Binge Reading)
- **Ordenação Natural de Volumes:** O motor em Rust aplica algoritmo de ordenação natural para numeração em títulos e nomes de arquivo (reconhecendo corretamente sequências como `Vol. 1`, `Vol. 2` ... `Vol. 10` ... `Vol. 23`).
- **Transição Automática:**
  - Ao atingir o final da última página de um volume, um puxão adicional de rolagem ou swipe exibe uma transição discreta: *"Fim da edição 01 — Abrindo edição 02"*.
  - O leitor carrega a primeira página do volume seguinte instantaneamente, mantendo o histórico de progresso e estatísticas perfeitamente atualizados sem retornar à biblioteca.

### 3.4 Modos Alternativos Preservados
- **Página Tátil com Dobra de Papel:** Modo de página individual com física realista de dobra, suporte RTL (mangá tradicional) e divisão automática de páginas duplas (*spread split*) para leitura vertical.
- **Adaptive Panel Flow:** Modo guiado quadro a quadro com enquadramento dinâmico dos balões e vinhetas, ideal para quadrinhos ocidentais clássicos com texto miúdo.

---

## 4. Biblioteca Híbrida e Gerenciamento de Arquivos

### 4.1 Navegação Nativa por Pastas
- Aba de **Pastas** que reflete diretamente a hierarquia física do dispositivo.
- Cada pasta contendo quadrinhos é exibida como um cartão com a miniatura do primeiro volume e contagem de itens.
- Elimina a necessidade de criar coleções manualmente para quem já mantém suas HQs organizadas em pastas no celular.

### 4.2 Scanner Local e Metadados
- Varredura em segundo plano das pastas autorizadas pelo usuário.
- Extração assíncrona de miniaturas da primeira página diretamente em memória, sem poluir a galeria de fotos do Android.
- Leitura de `ComicInfo.xml` interno nos arquivos CBZ/CBR para indexação automática de metadados: Título, Série, Número, Autor, Ano e Gênero.
- Classificação inteligente: *Continuar Lendo*, *Não Lidos*, *Lidos Recentemente* e *Favoritos*.

### 4.3 Ações Rápidas em Lote
- Toque longo em qualquer publicação ativa a barra de seleção contextual.
- Seleção múltipla com toque contínuo.
- Ações com 1 toque no rodapé: *Adicionar à Coleção*, *Marcar como Lido*, *Limpar Progresso* ou *Excluir do Cache*.

### 4.4 Conector de Servidores Remotos (OPDS / Komga / Kavita)
- Suporte a múltiplos servidores cadastrados via protocolo padrão OPDS 1.2 / 2.0 e API nativa Komga/Kavita.
- **Streaming sob demanda:** As páginas são baixadas sob demanda pelo leitor diretamente do servidor sem precisar aguardar o término do download do arquivo completo.
- **Download Offline:** Botão de download de capítulo/volume completo para leitura em viagens ou locais sem internet, armazenando o arquivo na pasta de dados do app com barra de progresso em tempo real.

---

## 5. Requisitos Não-Funcionais e Desempenho

1. **Consumo de Memória (RAM Budget):** O consumo de RAM da WebView do Android deve permanecer abaixo de **180 MB** durante leituras prolongadas de volumes pesados de manhwas com mais de 100 páginas.
2. **Taxa de Quadros (Fluidez):** Gesto de rolagem e transições devem manter **60 FPS estáveis** em dispositivos padrão e até **120 FPS** em telas de alta taxa de atualização.
3. **Integridade de Originais:** Os arquivos de quadrinhos no armazenamento do celular permanecem rigorosamente em modo somente leitura. O app nunca modifica, move ou altera arquivos originais sem ação explícita e confirmada do usuário.
4. **Privacidade e Desconexão:** O aplicativo é 100% livre de telemetria externa, rastreadores e anúncios. Todas as comunicações de rede ocorrem exclusivamente com os servidores explicitamente cadastrados pelo usuário.

---

## 6. Estratégia de Testes e Validação

1. **Testes Unitários:**
   - Algoritmo de ordenação natural de volumes e detecção de próximo capítulo (`1` a `23`).
   - Ciclo de vida da janela deslizante (Sliding Window): montagem e desmontagem correta de imagens ao rolar.
   - Parsing de metadados `ComicInfo.xml` e respostas OPDS.
2. **Testes de Integração:**
   - Varredura do scanner local com diretórios de teste contendo arquivos válidos e corrompidos.
   - Persistência e restauração precisa de `{ pageId, scrollRatio }` no SQLite.
3. **Validação de Build:**
   - Sucesso na compilação do Tauri v2 para a arquitetura `aarch64-linux-android`.
   - Execução e validação dos fluxos de toque no emulador ou dispositivo físico Android.
