package com.jrmello4.tactilereader.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.geometry.Rect
import com.jrmello4.tactilereader.core.ReaderPage
import java.io.File
import kotlinx.coroutines.delay
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner

@Composable
internal fun ReaderPagedContent(
    state: ReaderUiState, settings: ReaderSettings, paths: Map<String, String>,
    onPageVisible: (ReaderPage) -> Unit, onProgress: (String, Double) -> Unit, onPosition: (String, Double) -> Unit,
    bookmarks: Set<String>, onBookmark: (String) -> Unit, onBack: () -> Unit, onSettings: (ReaderSettings) -> Unit,
    nextTitle: String?, onNext: () -> Unit,
) {
    val pages = remember(state.pages, settings.direction) { readingOrder(state.pages, settings.direction) }
    val spreads = remember(pages.size, settings.mode, settings.coverAlone) {
        if (settings.mode == ReaderMode.DOUBLE_PAGE) pageSpreads(pages.size, settings.coverAlone)
        else pages.indices.map { listOf(it) }
    }
    val start = pages.indexOfFirst { it.id == state.startPageId }.coerceAtLeast(0)
    var spreadIndex by rememberSaveable { mutableIntStateOf(spreads.indexOfFirst { start in it }.coerceAtLeast(0)) }
    var hud by rememberSaveable { mutableStateOf(false) }
    var sheet by remember { mutableStateOf(false) }
    var cancelled by remember(nextTitle) { mutableStateOf(false) }
    var countdown by remember { mutableStateOf<Int?>(null) }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val bingeVisible = spreadIndex == spreads.size && nextTitle != null && pages.isNotEmpty()
    var viewportBounds by remember { mutableStateOf(Rect.Zero) }
    var cardBounds by remember { mutableStateOf(Rect.Zero) }
    val cardActive = bingeVisible && cardBounds.height > 0 && isBingeCardActive(
        visibleFraction(cardBounds.top.toInt(), cardBounds.height.toInt(), viewportBounds.top.toInt(), viewportBounds.bottom.toInt()))
    val lastIndex = spreads.lastIndex + if (nextTitle != null && pages.isNotEmpty()) 1 else 0
    val transform = remember(spreadIndex) { ReaderTransform() }
    val stepAction by rememberUpdatedState<(Int) -> Unit>({ step -> spreadIndex = (spreadIndex + step).coerceIn(0, lastIndex.coerceAtLeast(0)) })
    val hudAction by rememberUpdatedState<() -> Unit>({ hud = !hud })
    val onNextCurrent by rememberUpdatedState(onNext)
    val spread = spreads.getOrNull(spreadIndex) ?: spreads.lastOrNull().orEmpty()
    val current = pages.getOrNull(spread.lastOrNull() ?: -1)
    LaunchedEffect(transform.viewport, spread, settings.fit) {
        val viewport = transform.viewport
        if (settings.fit == FitMode.FIT_SCREEN && spread.isNotEmpty()) {
            val cell = viewport.width.toFloat() / spread.size
            val sizes = spread.map { index ->
                val page = pages[index]
                val ratio = if (page.width > 0 && page.height > 0) page.width.toFloat() / page.height else 2f / 3f
                minOf(cell, viewport.height * ratio) to minOf(viewport.height.toFloat(), cell / ratio)
            }
            transform.contentSize = androidx.compose.ui.unit.IntSize(
                ((spread.size - 1) * cell + (sizes.first().first + sizes.last().first) / 2f).toInt(),
                sizes.maxOf { it.second }.toInt(),
            )
        } else transform.contentSize = viewport
        transform.pan = transform.clamp(transform.pan)
    }
    ReaderWindow(settings, hud || sheet)
    LaunchedEffect(spreadIndex, pages) {
        // Report the last logical page in a spread to the existing finish rule.
        pages.getOrNull(spread.lastOrNull() ?: -1)?.let { onPosition(it.id, 0.0); onProgress(it.id, 0.0) }
        val neighbors = spreads.getOrNull(spreadIndex - 1).orEmpty() + spread + spreads.getOrNull(spreadIndex + 1).orEmpty()
        neighbors.distinct().forEach { pages.getOrNull(it)?.let(onPageVisible) }
    }
    LaunchedEffect(pages.size) { VolumeScrollBus.events.collect { stepAction(it) } }
    LaunchedEffect(cardActive, sheet, hud, cancelled, lifecycleState) {
        countdown = null
        // The card occupies the viewport only after an explicit next-page action.
        if (cardActive && !sheet && !hud && !cancelled && lifecycleState == Lifecycle.State.RESUMED) {
            for (left in 6 downTo 1) { countdown = left; delay(1000) }
            countdown = null
            onNextCurrent()
        }
    }
    Box(Modifier.fillMaxSize().background(settings.background.color)) {
        Box(Modifier.fillMaxSize().onSizeChanged { transform.viewport = it }.onGloballyPositioned { viewportBounds = it.boundsInWindow() }
            .readerGestures(transform, settings.direction, { hudAction() }, { stepAction(it) }), contentAlignment = Alignment.Center) {
            if (bingeVisible) {
                BingeCard(nextTitle!!, countdown, onNext, { cancelled = true; countdown = null },
                    Modifier.onGloballyPositioned { cardBounds = it.boundsInWindow() })
            } else if (pages.isEmpty()) {
                Text("Esta publicação não tem páginas.", color = if (settings.background == ReaderBackground.WHITE)
                    androidx.compose.ui.graphics.Color.DarkGray else androidx.compose.ui.graphics.Color.White)
            } else {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    Row(Modifier.fillMaxSize().graphicsLayer {
                        scaleX = transform.zoom; scaleY = transform.zoom
                        translationX = transform.pan.x; translationY = transform.pan.y
                    }, verticalAlignment = Alignment.CenterVertically) {
                        visualSpread(spread, settings.direction).forEach { index ->
                            val page = pages[index]
                            ReaderFittedImage(page, paths[page.id]?.let(::File), settings, Modifier.weight(1f).fillMaxHeight())
                        }
                    }
                }
            }
        }
        if (hud) ReaderControls(state.title, transform.zoom, (spread.lastOrNull() ?: 0) + 1, pages.size,
            current != null, current?.id in bookmarks, onBack, { transform.toggle() }, { current?.let { onBookmark(it.id) } },
            onSettings = { sheet = true }, onSeek = { index -> spreadIndex = spreads.indexOfFirst { index in it }.coerceAtLeast(0) }, direction = settings.direction)
        if (sheet) ReaderSettingsSheet(settings, onSettings) { sheet = false }
    }
}
