package com.jrmello4.tactilereader.reader

import androidx.activity.compose.BackHandler
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.jrmello4.tactilereader.core.ReaderPage
import com.jrmello4.tactilereader.ui.theme.DarkGraphite750
import com.jrmello4.tactilereader.ui.theme.DarkGraphite800
import com.jrmello4.tactilereader.ui.theme.DarkGraphite900
import com.jrmello4.tactilereader.ui.theme.DarkGraphite950
import com.jrmello4.tactilereader.ui.theme.Paper300
import com.jrmello4.tactilereader.ui.theme.Paper50
import com.jrmello4.tactilereader.ui.theme.Paper500
import com.jrmello4.tactilereader.ui.theme.SeamSubtle
import com.jrmello4.tactilereader.ui.theme.WarmAmber
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.io.File

@Composable
fun ReaderScreen(
    viewModel: ReaderViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    nextTitle: String? = null,
    onBingeOpenNext: () -> Unit = {},
) {
    val state by viewModel.state.collectAsState()
    val paths by viewModel.paths.collectAsState()
    val bookmarks by viewModel.bookmarks.collectAsState()
    val finishAndBack = {
        viewModel.finishSession()
        onBack()
    }
    BackHandler(onBack = finishAndBack)
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(viewModel, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> viewModel.resumeSession()
                Lifecycle.Event.ON_STOP -> viewModel.pauseSession()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            viewModel.finishSession()
        }
    }
    ReaderContent(
        state = state,
        onBack = finishAndBack,
        modifier = modifier,
        paths = paths,
        onPageVisible = viewModel::requestPage,
        onProgress = viewModel::saveProgress,
        bookmarks = bookmarks,
        onToggleBookmark = viewModel::toggleBookmark,
        nextTitle = nextTitle,
        onBingeOpenNext = onBingeOpenNext,
    )
}

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
) {
    var hud by rememberSaveable { mutableStateOf(true) }
    val listState = rememberLazyListState()

    // Ler não deve apagar a tela no meio de uma página.
    val view = LocalView.current
    androidx.compose.runtime.DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

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

    // Observa a primeira página visível e persiste {pageId, scrollRatio}
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
    val currentPage = pages.getOrNull(firstVisible)
    val isLastStretch = pages.isNotEmpty() && firstVisible >= (pages.size - 2).coerceAtLeast(0)
    var bingeVisible by remember(pages, nextTitle) { mutableStateOf(true) }
    var bingeCountdown by remember(pages, nextTitle) { mutableStateOf<Int?>(null) }

    // Binge: no fim da edição, conta 6s e abre a próxima
    LaunchedEffect(isLastStretch, nextTitle, didRestore, bingeVisible) {
        if (!isLastStretch || nextTitle == null || !didRestore || !bingeVisible) {
            bingeCountdown = null
            return@LaunchedEffect
        }
        for (left in 6 downTo 1) {
            bingeCountdown = left
            delay(1000)
        }
        bingeCountdown = null
        onBingeOpenNext()
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

    Box(modifier = modifier.fillMaxSize().background(DarkGraphite950)) {
        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "Abrindo HQ…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Paper300,
                )
            }
            state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(24.dp),
                ) {
                    Text(
                        "Falha: ${state.error}",
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
                        Text("Biblioteca", color = Paper50)
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
                    .pointerInput(Unit) {
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
                                val height = viewport.height.toFloat()
                                val screenX = if (width > 0) {
                                    (pos.x - width / 2f) * zoom + width / 2f + panX
                                } else {
                                    pos.x
                                }
                                val screenY = if (height > 0) {
                                    (pos.y - height / 2f) * zoom + height / 2f
                                } else {
                                    pos.y
                                }
                                val xFrac = if (width > 0) screenX / width else 0.5f
                                val yFrac = if (height > 0) screenY / height else 0.5f
                                if (xFrac in 0.35f..0.65f) {
                                    hud = !hud
                                } else {
                                    scope.launch { scrollBlock(if (yFrac < 0.5f) -1 else 1) }
                                }
                            },
                            onDoubleTap = {
                                if (zoom > 1f) {
                                    zoom = 1f
                                } else {
                                    zoom = 2f
                                }
                                panX = 0f
                            },
                        )
                    },
            ) {
                LazyColumn(
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
                        pageImage(page, file, Modifier)
                    }
                    // Binge: card editorial de transição no fim da edição
                    if (nextTitle != null && pages.isNotEmpty()) {
                        item(key = "binge") {
                            BingeCard(
                                nextTitle = nextTitle,
                                countdown = bingeCountdown,
                                onOpenNow = onBingeOpenNext,
                                onCancel = {
                                    bingeVisible = false
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
            Column(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xF2101318))
                        .statusBarsPadding()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
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
                        Text("Biblioteca", color = Paper50, style = MaterialTheme.typography.labelLarge)
                    }

                    Text(
                        text = state.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = Paper50,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 4.dp),
                    )

                    TextButton(
                        onClick = {
                            zoom = if (zoom > 1f) 1f else 2f
                            panX = 0f
                        },
                        modifier = Modifier
                            .defaultMinSize(minHeight = 48.dp)
                            .semantics {
                                contentDescription = if (zoom > 1f) "Restaurar zoom" else "Ampliar"
                                stateDescription = if (zoom > 1f) "Ampliado" else "Normal"
                            },
                    ) {
                        Text(
                            if (zoom > 1f) "1:1" else "Zoom",
                            color = if (zoom > 1f) WarmAmber else Paper50,
                            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                        )
                    }

                    val marked = currentPage?.let { bookmarks.contains(it.id) } == true
                    IconButton(
                        onClick = { currentPage?.let { onToggleBookmark(it.id) } },
                        enabled = currentPage != null,
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Icon(
                            Icons.Filled.Star,
                            contentDescription = if (marked) "Remover marcador" else "Marcar página",
                            tint = if (marked) WarmAmber else Paper500,
                        )
                    }
                }

                Box(Modifier.weight(1f))

                if (pages.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xF2101318))
                            .navigationBarsPadding()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "página ${firstVisible + 1} de ${pages.size}",
                            style = MaterialTheme.typography.labelMedium.copy(
                                letterSpacing = 0.5.sp,
                            ),
                            color = Paper300,
                            modifier = Modifier.semantics {
                                stateDescription = "Página ${firstVisible + 1} de ${pages.size}"
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BingeCard(
    nextTitle: String,
    countdown: Int?,
    onOpenNow: () -> Unit,
    onCancel: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = DarkGraphite800),
        border = BorderStroke(1.dp, SeamSubtle),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "FIM DA EDIÇÃO",
                style = MaterialTheme.typography.labelSmall.copy(
                    letterSpacing = 1.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = Paper500,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = nextTitle,
                style = MaterialTheme.typography.titleMedium,
                color = Paper50,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = if (countdown != null) "Próxima edição abrindo em ${countdown}s…" else "Próxima edição pronta",
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                color = WarmAmber,
            )
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onOpenNow,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = WarmAmber,
                        contentColor = DarkGraphite900,
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text("Abrir agora", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
                }
                TextButton(
                    onClick = onCancel,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text("Cancelar", color = Paper300, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

/**
 * Página real com Coil (arquivo garantido pelo núcleo, limite de 1080px, sem
 * crossfade para não animar a faixa). A proporção vem dos metadados do
 * núcleo para reservar a altura antes dos bytes chegarem.
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
            .background(DarkGraphite950)
            .semantics(mergeDescendants = true) {
                contentDescription = "Página ${page.index + 1}"
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "${page.index + 1}",
            style = MaterialTheme.typography.labelLarge,
            color = DarkGraphite750,
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
