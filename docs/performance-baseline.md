# Linha de Base de Desempenho e Metas (Baseline Profiles & Macrobenchmark)

## 1. Princípios de Medição e Honestidade de Execução

> [!IMPORTANT]
> **Distinção entre Ambientes**: Medições obtidas em JVM local (Robolectric), suítes de instrumentação sintética ou runners de CI em nuvem diferem da execução física em silício real. O dispositivo de referência do projeto é o **Motorola Moto G34 5G** (Snapdragon 695, 4 GB de RAM LPDDR4X, taxa de atualização de 120 Hz, Android 14). Nunca confunda ou invente resultados físicos a partir de testes em máquina de desenvolvimento ou emulador.

## 2. Orçamento de Recursos e Metas de Desempenho

| Dimensão | Alvo Físico (Moto G34) | Limite / Teto Inegociável | Mecanismo de Garantia |
|---|---|---|---|
| **Cold Start** | < 1.200 ms | <= 1.800 ms | ART Baseline Profile compilado no release |
| **Warm Start** | < 400 ms | <= 700 ms | ComponentActivity limpa sem injeção pesada |
| **Memória Leitor (PSS)** | ~90 MB - 130 MB | <= 180 MB em 120 páginas | Janela deslizante de 5 bitmaps (`decodeLikeReader`) |
| **Cache Coil em RAM** | <= 64 MB | 64 MB fixo (`TactileApp`) | `MemoryCache.Builder().maxSizeBytes(64MB)` |
| **Taxa de Quadros (Faixa)** | 120 fps estável | >= 95% frames < 8.3ms / 16.6ms | `LazyColumn` com `key`, `contentType`, `subcompose` evitado |
| **Tamanho do APK Final** | <= 2.5 MB | <= 15 MB | R8 Minify + Shrink Resources + Strip Dbg |
| **Importação de HQ (50MB)** | < 1.500 ms | <= 3.000 ms | Leitura direta de `content://` sem cópia para sandbox |

## 3. Baseline Profiles (AOT ART Optimization)

O aplicativo incorpora regras oficiais de Baseline Profile em `native/app/src/main/baseline-prof.txt`, empacotadas no APK de release e integradas via `androidx.profileinstaller:profileinstaller:1.4.1`.

### Cobertura de Caminhos Críticos no Baseline Profile:
1. **Inicialização e Scaffold**:
   - `MainActivity;->onCreate`
   - `AppSourcesKt;->AppSourcesScaffold`
2. **Tema Editorial Dark-First**:
   - `EditorialThemeKt;->TactileEditorialTheme`
   - Resolução de cores estáticas, tipografia e ícones vetoriais.
3. **Estante e Agrupamento**:
   - `LibraryScreenKt;->LibraryScreen`
   - `LibraryScreenKt;->ComicCard`
   - `SeriesGroupKt;->groupIntoSeries`
4. **Leitor Vertical e Faixa Contínua**:
   - `ReaderScreenKt;->ReaderScreen`
   - `ReaderScreenKt;->PageStrip`
   - `ReaderViewModel;->loadComic` e `updateProgress`
5. **Métricas de Leitura e Cálculos de Ritmo**:
   - `ReadingMetrics;->calculateSpeed` e `estimateRemainingMinutes`
6. **Persistência SQLite**:
   - `LibraryDb;->getAllComics`, `upsertProgress`, `listBookmarks`

## 4. Testes de Estresse de Longa Duração

A suíte instrumentada `LongComicMemoryTest` submete o leitor a um capítulo simulado extremo:
- **120 páginas completas** (resolução 1080×2400 cada, com faixas de cores e texto vetorial simulando páginas reais de mangá/webtoon).
- A política da faixa mantém uma janela deslizante ativa de 5 bitmaps decodificados (página visível + vizinhas pré-carregadas).
- **Critério de Aprovação**: O crescimento do PSS (`growthKb`) não deve aumentar linearmente com a extensão do capítulo (delta máximo permitido de 80 MB sobre a linha de base).
- Bitmaps descartados pela janela são imediatamente reciclados com `.recycle()`, aliviando a memória nativa antes de qualquer coleta de lixo periódica do ART.

## 5. Protocolo de Verificação em Aparelho Físico

Para validar a performance real em um aparelho físico (ex.: Moto G34 conectado via ADB):
```bash
# 1. Instalar APK de release compilado
adb install -r native/app/build/outputs/apk/release/tactile-native-0.4.0+4-release.apk

# 2. Compilar Baseline Profile no dispositivo (ART AOT)
adb shell cmd package compile -m speed-profile -f com.jrmello4.tactilereader.scaffold

# 3. Medir tempo de inicialização (Cold Start)
adb shell am start-W -n com.jrmello4.tactilereader.scaffold/com.jrmello4.tactilereader.scaffold.MainActivity

# 4. Monitorar alocação de memória durante leitura de 120 páginas
adb shell dumpsys meminfo com.jrmello4.tactilereader.scaffold
```
