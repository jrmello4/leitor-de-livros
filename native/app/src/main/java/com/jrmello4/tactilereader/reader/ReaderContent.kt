package com.jrmello4.tactilereader.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.scaffold.R
import com.jrmello4.tactilereader.core.ReaderPage
import com.jrmello4.tactilereader.ui.theme.DarkGraphite950
import com.jrmello4.tactilereader.ui.theme.Paper300
import com.jrmello4.tactilereader.ui.theme.Paper50
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.io.File
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner

/** Faixa de leitura pura por estado — testável na JVM sem JNI nem ViewModel. */
@OptIn(FlowPreview::class)
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
    bookmarks: Set<String> = emptySet(),
    onToggleBookmark: (String) -> Unit = {},
    nextTitle: String? = null,
    onBingeOpenNext: () -> Unit = {},
    settings: ReaderSettings = ReaderSettings(),
    onSettingsChange: (ReaderSettings) -> Unit = {},
    onPositionChanged: (String, Double) -> Unit = { _, _ -> },
    initialHudVisible: Boolean = true,
) {
    if (!state.loading && state.error == null && settings.mode in listOf(ReaderMode.SINGLE_PAGE, ReaderMode.DOUBLE_PAGE)) {
        ReaderPagedContent(state, settings, paths, onPageVisible, onProgress, onPositionChanged,
            bookmarks, onToggleBookmark, onBack, onSettingsChange, nextTitle, onBingeOpenNext)
        return
    }
    var hud by rememberSaveable { mutableStateOf(initialHudVisible) }
    var showSettings by remember { mutableStateOf(false) }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val listState = rememberLazyListState()

    // Ler não deve apagar a tela no meio de uma página.
    ReaderWindow(settings, hud || showSettings)

    val pages = remember(state.pages, settings.direction) { readingOrder(state.pages, settings.direction) }
    val targetIndex = state.startPageId?.let { id -> pages.indexOfFirst { it.id == id } } ?: -1
    val needsOffset = targetIndex >= 0 && state.startRatio > 0.01

    // Retoma onde parou: uma vez por abertura, rola até a página salva e,
    // havendo proporção, aplica o deslocamento exato dentro dela.
    var didRestore by remember(state.loading) { mutableStateOf(false) }
    var didRestoreOffset by remember(state.loading) { mutableStateOf(!needsOffset) }
    LaunchedEffect(pages, state.startPageId, didRestore) {
        if (!didRestore && pages.isNotEmpty()) {
            if (targetIndex >= 0) {
                listState.scrollToItem(targetIndex)
            }
            didRestore = true
        }
    }

    // Immediate UI anchor survives switching modes; only persistence is debounced.
    val currentOnPosition by androidx.compose.runtime.rememberUpdatedState(onPositionChanged)
    LaunchedEffect(listState, pages, didRestore, didRestoreOffset) {
        snapshotFlow {
            visibleReadingPosition(listState, pages)
        }.distinctUntilChanged().collect { if (it != null && didRestore && didRestoreOffset) currentOnPosition(it.first, it.second) }
    }
    LaunchedEffect(listState, pages, needsOffset, didRestoreOffset) {
        if (!needsOffset || didRestoreOffset) {
            return@LaunchedEffect
        }
        val info = snapshotFlow {
            listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == targetIndex }
        }.first { it != null && it.size > 0 }!!
        listState.scrollToItem(targetIndex, (state.startRatio * info.size).toInt())
        didRestoreOffset = true
    }

    // Observa a primeira página visível e persiste {pageId, scrollRatio}
    LaunchedEffect(listState, pages, didRestore, didRestoreOffset) {
        snapshotFlow {
            if (!didRestore || !didRestoreOffset) {
                null
            } else {
                visibleReadingPosition(listState, pages)
            }
        }.distinctUntilChanged().debounce(500).collect { current ->
            if (current != null) {
                onProgress(current.first, current.second)
            }
        }
    }

    // Teclas físicas de volume: avançam/voltam uma página sem tocar na tela.
    LaunchedEffect(listState, pages.size) {
        VolumeScrollBus.events.collect { direction ->
            val target = (listState.firstVisibleItemIndex + direction)
                .coerceIn(0, (pages.size - 1).coerceAtLeast(0))
            listState.animateScrollToItem(target)
        }
    }

    val firstVisible by remember { derivedStateOf { listState.firstVisibleItemIndex } }
    val currentPage = pages.getOrNull(firstVisible.coerceAtMost(pages.lastIndex))
    LaunchedEffect(firstVisible, pages) {
        // A small neighborhood uses the same ensure/cache path as visible pages.
        for (index in (firstVisible - 1)..(firstVisible + 2)) pages.getOrNull(index)?.let(onPageVisible)
    }
    var bingeCancelled by remember(pages, nextTitle) { mutableStateOf(false) }
    var bingeCountdown by remember(pages, nextTitle) { mutableStateOf<Int?>(null) }

    // A contagem só começa quando o próprio card está visível; collectLatest
    // cancela o timer assim que o usuário rola para longe dele.
    LaunchedEffect(listState, nextTitle, didRestore, bingeCancelled, showSettings, lifecycleState) {
        if (nextTitle == null || !didRestore || bingeCancelled || showSettings || lifecycleState != Lifecycle.State.RESUMED) {
            bingeCountdown = null
            return@LaunchedEffect
        }
        snapshotFlow {
            val layout = listState.layoutInfo
            val card = layout.visibleItemsInfo.firstOrNull { it.key == "binge" }
            card?.let {
                isBingeCardActive(
                    visibleFraction(
                        itemOffset = it.offset,
                        itemSize = it.size,
                        viewportStart = layout.viewportStartOffset,
                        viewportEnd = layout.viewportEndOffset,
                    ),
                )
            } ?: false
        }.distinctUntilChanged().collectLatest { cardActive ->
            if (!cardActive) {
                bingeCountdown = null
                return@collectLatest
            }
            for (left in 6 downTo 1) {
                bingeCountdown = left
                delay(1000)
            }
            bingeCountdown = null
            onBingeOpenNext()
        }
    }

    // Zoom GLOBAL do leitor
    var zoom by remember(pages) { mutableFloatStateOf(1f) }
    var panX by remember(pages) { mutableFloatStateOf(0f) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }

    fun clampPan(value: Float): Float {
        val width = viewport.width.toFloat()
        if (width <= 0f || zoom <= 1f) return 0f
        val max = width * (zoom - 1f) / 2f
        return value.coerceIn(-max, max)
    }

    suspend fun scrollBlock(direction: Int) {
        val target = (firstVisible + direction).coerceIn(0, (pages.size - 1).coerceAtLeast(0))
        listState.animateScrollToItem(target)
    }
    val scope = rememberCoroutineScope()

    Box(modifier = modifier.fillMaxSize().background(settings.background.color)) {
        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.reader_loading),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (settings.background == ReaderBackground.WHITE) androidx.compose.ui.graphics.Color.DarkGray else Paper300,
                )
            }
            state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(24.dp),
                ) {
                    Text(
                        stringResource(R.string.common_error_detail, state.error),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Spacer(Modifier.height(16.dp))
                    TextButton(
                        onClick = onBack,
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = null,
                            tint = Paper50,
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.reader_back_to_library), color = Paper50)
                    }
                }
            }
            else -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .onSizeChanged { viewport = it }
                    .graphicsLayer(
                        scaleX = zoom,
                        scaleY = zoom,
                        translationX = panX,
                        clip = true,
                    )
                    .pointerInput(settings.direction) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            do {
                                val event = awaitPointerEvent()
                                val pressed = event.changes.count { it.pressed }
                                val zoomChange = event.calculateZoom()
                                val pan = event.calculatePan()
                                if (pressed > 1) {
                                    // Pinça: escala global.
                                    zoom = (zoom * zoomChange).coerceIn(1f, 5f)
                                    panX = clampPan(panX)
                                    event.changes.forEach { it.consume() }
                                } else if (zoom > 1f &&
                                    kotlin.math.abs(pan.x) > kotlin.math.abs(pan.y)
                                ) {
                                    // Ampliado e arrasto horizontal: pan lateral.
                                    panX = clampPan(panX + pan.x)
                                    event.changes.forEach { it.consume() }
                                }
                                // Arrasto vertical nunca é consumido: é a rolagem livre.
                            } while (event.changes.any { it.pressed })
                        }
                    }
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = { pos ->
                                val width = viewport.width.toFloat()
                                val screenX = if (width > 0) {
                                    (pos.x - width / 2f) * zoom + width / 2f + panX
                                } else {
                                    pos.x
                                }
                                val xFrac = if (width > 0) screenX / width else 0.5f
                                val step = tapStep(xFrac, settings.direction)
                                if (step == 0) {
                                    hud = !hud
                                } else if (zoom <= 1f) {
                                    scope.launch { scrollBlock(step) }
                                }
                            },
                            onDoubleTap = { point ->
                                if (zoom > 1f) {
                                    zoom = 1f
                                } else {
                                    zoom = 2f
                                }
                                panX = if (zoom == 1f) 0f else clampPan(viewport.width / 2f - point.x)
                            },
                        )
                    },
            ) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(0.dp),
                    verticalArrangement = Arrangement.spacedBy(if (settings.mode == ReaderMode.VERTICAL) 12.dp else 0.dp),
                ) {
                    items(pages, key = { it.id }) { page ->
                        val file = paths[page.id]?.let { File(it) }
                        LaunchedEffect(page.id, paths[page.id]) {
                            if (file == null) {
                                onPageVisible(page)
                            }
                        }
                        if (settings.mode == ReaderMode.WEBTOON && settings.background == ReaderBackground.BLACK) {
                            pageImage(page, file, Modifier)
                        } else {
                            ReaderFittedImage(page, file, settings, Modifier, continuous = true)
                        }
                    }
                    // Binge: card editorial de transição no fim da edição
                    if (nextTitle != null && pages.isNotEmpty()) {
                        item(key = "binge") {
                            BingeCard(
                                nextTitle = nextTitle,
                                countdown = bingeCountdown,
                                onOpenNow = onBingeOpenNext,
                                onCancel = {
                                    bingeCancelled = true
                                    bingeCountdown = null
                                },
                            )
                        }
                    }
                }
            }
        }

        // HUD Editorial coordenado em Dark Graphite profundo
        if (hud && !state.loading) {
            ReaderControls(
                title = state.title,
                zoom = zoom,
                pageNumber = (firstVisible + 1).coerceAtMost(pages.size),
                pageCount = pages.size,
                bookmarkEnabled = currentPage != null,
                isBookmarked = currentPage?.let { bookmarks.contains(it.id) } == true,
                onBack = onBack,
                onToggleZoom = {
                    zoom = if (zoom > 1f) 1f else 2f
                    panX = 0f
                },
                onToggleBookmark = { currentPage?.let { onToggleBookmark(it.id) } },
                direction = settings.direction,
                onSettings = { showSettings = true },
                onSeek = { index -> scope.launch { listState.scrollToItem(index); pages.getOrNull(index)?.let { onProgress(it.id, 0.0) } } },
            )
        }
        if (showSettings) ReaderSettingsSheet(settings, onSettingsChange) { showSettings = false }
    }
}

/** The end card is part of navigation, never a fictitious page beyond the publication. */
private fun visibleReadingPosition(listState: LazyListState, pages: List<ReaderPage>): Pair<String, Double>? {
    val layout = listState.layoutInfo
    val card = layout.visibleItemsInfo.firstOrNull { it.key == "binge" }
    if (card != null && isBingeCardActive(visibleFraction(card.offset, card.size, layout.viewportStartOffset, layout.viewportEndOffset))) {
        return pages.lastOrNull()?.let { it.id to 0.0 }
    }
    val info = layout.visibleItemsInfo.firstOrNull() ?: return null
    val page = pages.getOrNull(info.index) ?: return null
    val ratio = if (info.size > 0) (-info.offset.toDouble() / info.size).coerceIn(0.0, 1.0) else 0.0
    return page.id to ratio
}
