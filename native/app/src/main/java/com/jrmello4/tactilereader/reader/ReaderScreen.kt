package com.jrmello4.tactilereader.reader

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.jrmello4.tactilereader.core.ReaderPage
import kotlinx.coroutines.flow.distinctUntilChanged
import java.io.File

@Composable
fun ReaderScreen(viewModel: ReaderViewModel, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val state by viewModel.state.collectAsState()
    val paths by viewModel.paths.collectAsState()
    BackHandler(onBack = onBack)
    ReaderContent(
        state = state,
        onBack = onBack,
        modifier = modifier,
        paths = paths,
        onPageVisible = viewModel::requestPage,
        onProgress = viewModel::saveProgress,
    )
}

/** Faixa de leitura pura por estado — testável na JVM sem JNI nem ViewModel. */
@Composable
fun ReaderContent(
    state: ReaderUiState,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    paths: Map<String, String> = emptyMap(),
    onPageVisible: (ReaderPage) -> Unit = {},
    onProgress: (pageId: String, scrollRatio: Double) -> Unit = { _, _ -> },
    pageImage: @Composable (ReaderPage, File?, Modifier) -> Unit = { page, file, mod ->
        DefaultPageImage(page, file, mod)
    },
) {
    var hud by rememberSaveable { mutableStateOf(true) }
    val listState = rememberLazyListState()
    val pages = state.pages
    val targetIndex = state.startPageId?.let { id -> pages.indexOfFirst { it.id == id } } ?: -1
    val needsOffset = targetIndex > 0 && state.startRatio > 0.01

    // Retoma onde parou: uma vez por abertura, rola até a página salva e,
    // havendo proporção, aplica o deslocamento exato dentro dela.
    var didRestore by remember { mutableStateOf(false) }
    var didRestoreOffset by remember { mutableStateOf(!needsOffset) }
    LaunchedEffect(pages, state.startPageId, didRestore) {
        if (!didRestore && pages.isNotEmpty()) {
            if (targetIndex > 0) {
                listState.scrollToItem(targetIndex)
            }
            didRestore = true
        }
    }
    LaunchedEffect(listState, pages, needsOffset, didRestoreOffset) {
        if (!needsOffset || didRestoreOffset) {
            return@LaunchedEffect
        }
        snapshotFlow {
            listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == targetIndex }
        }.collect { info ->
            if (info != null && info.size > 0) {
                listState.scrollToItem(targetIndex, (state.startRatio * info.size).toInt())
                didRestoreOffset = true
            }
        }
    }

    // Observa a primeira página visível e persiste {pageId, scrollRatio} —
    // só depois da restauração, para não sobrescrever o ponto salvo.
    LaunchedEffect(listState, pages, didRestore, didRestoreOffset) {
        snapshotFlow {
            val info = listState.layoutInfo.visibleItemsInfo.firstOrNull()
            val page = info?.let { pages.getOrNull(it.index) }
            if (page == null || !didRestore || !didRestoreOffset) {
                null
            } else {
                val ratio = if (info.size > 0) (-info.offset.toDouble() / info.size).coerceIn(0.0, 1.0) else 0.0
                page.id to ratio
            }
        }.distinctUntilChanged().collect { current ->
            if (current != null) {
                onProgress(current.first, current.second)
            }
        }
    }

    val firstVisible by remember { derivedStateOf { listState.firstVisibleItemIndex } }

    Box(modifier = modifier.fillMaxSize().background(Color.Black)) {
        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Abrindo HQ…", color = Color(0xFFC8C0B3))
            }
            state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Falha: ${state.error}", color = Color(0xFFC96F4A))
                    TextButton(onClick = onBack) { Text("‹ Biblioteca") }
                }
            }
            else -> LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(0.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                items(pages, key = { it.id }) { page ->
                    val file = paths[page.id]?.let { File(it) }
                    LaunchedEffect(page.id, paths[page.id]) {
                        if (file == null) {
                            onPageVisible(page)
                        }
                    }
                    ZoomablePage(onTap = { hud = !hud }) {
                        pageImage(page, file, Modifier)
                    }
                }
            }
        }
        if (hud && !state.loading) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xB30D1117))
                        .statusBarsPadding()
                        .padding(8.dp, 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onBack) { Text("‹ Biblioteca", color = Color.White) }
                    Text(
                        text = state.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = Color(0xFFF7F2E8),
                        maxLines = 1,
                        modifier = Modifier.weight(1f).padding(start = 4.dp),
                    )
                }
                Box(Modifier.weight(1f))
                if (pages.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xB30D1117))
                            .navigationBarsPadding()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            text = "página ${firstVisible + 1} de ${pages.size}",
                            style = MaterialTheme.typography.labelMedium,
                            color = Color(0xFFC8C0B3),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Invólucro de zoom por página: pinça até 5x com pan limitado às bordas,
 * duplo-toque alterna 1x/2x centrado no ponto tocado, toque simples sobe
 * para o HUD. O estado morre com a página (remember sem saveable): zoom
 * não é progresso e não deve sobreviver à saída da faixa.
 */
@Composable
private fun ZoomablePage(
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    var scale by remember { mutableStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }

    fun clampOffset(next: Float, raw: Offset, size: IntSize): Offset {
        if (next <= 1f || size == IntSize.Zero) {
            return Offset.Zero
        }
        val maxX = size.width * (next - 1f) / 2f
        val maxY = size.height * (next - 1f) / 2f
        return Offset(raw.x.coerceIn(-maxX, maxX), raw.y.coerceIn(-maxY, maxY))
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .onSizeChanged { viewport = it }
            .graphicsLayer(
                scaleX = scale,
                scaleY = scale,
                translationX = offset.x,
                translationY = offset.y,
                clip = true,
            )
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    val next = (scale * zoom).coerceIn(1f, 5f)
                    scale = next
                    offset = clampOffset(next, offset + pan, viewport)
                }
            }
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { pos ->
                        if (scale > 1f) {
                            scale = 1f
                            offset = Offset.Zero
                        } else {
                            val next = 2f
                            val center = Offset(viewport.width / 2f, viewport.height / 2f)
                            scale = next
                            offset = clampOffset(next, (center - pos) * next, viewport)
                        }
                    },
                )
            },
    ) {
        content()
    }
}

/**
 * Página real com Coil (arquivo garantido pelo núcleo, limite de 1080px, sem
 * crossfade para não animar a faixa). A proporção vem dos metadados do
 * núcleo para reservar a altura antes dos bytes chegarem; sem o arquivo,
 * o fundo escuro com o número da página segura o lugar.
 */
@Composable
internal fun DefaultPageImage(page: ReaderPage, file: File?, modifier: Modifier = Modifier) {
    val ratio = if (page.width > 0 && page.height > 0) {
        page.width.toFloat() / page.height
    } else {
        2f / 3f
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .background(Color(0xFF0D1117)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "${page.index + 1}",
            style = MaterialTheme.typography.labelLarge,
            color = Color(0x55FFFFFF),
            modifier = Modifier.padding(48.dp),
        )
        if (file != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(file)
                    .size(1080)
                    .memoryCacheKey("page-${page.id}")
                    .crossfade(false)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
