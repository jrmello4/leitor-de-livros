package com.jrmello4.tactilereader.library

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.jrmello4.tactilereader.core.Pub
import java.io.File

/** Cor estável por publicação — placeholder e fundo enquanto a capa carrega. */
internal fun placeholderColor(id: String): Color {
    val hue = (id.hashCode() and 0x7fffffff) % 360
    return Color.hsl(hue.toFloat(), 0.45f, 0.28f)
}

@Composable
fun LibraryScreen(
    viewModel: LibraryViewModel,
    onAddClick: () -> Unit,
    onOpenClick: (Pub) -> Unit,
    modifier: Modifier = Modifier,
    onAddFolderClick: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    folders: List<FolderEntry> = emptyList(),
    onRescan: () -> Unit = {},
) {
    val state by viewModel.state.collectAsState()
    val covers by viewModel.covers.collectAsState()
    LibraryContent(
        state = state,
        onAddClick = onAddClick,
        onOpenClick = onOpenClick,
        modifier = modifier,
        onAddFolderClick = onAddFolderClick,
        onOpenSettings = onOpenSettings,
        covers = covers,
        onCoverVisible = viewModel::requestCover,
        onToggleFavorite = viewModel::toggleFavorite,
        onDelete = viewModel::deletePublication,
        onSetRead = viewModel::setRead,
        onCancelImport = viewModel::cancelImport,
        folders = folders,
        onRescan = onRescan,
    )
}

enum class LibraryFilter { TODAS, FAVORITAS, NAO_LIDAS, LIDAS, CONTINUAR }
enum class LibrarySort { RECENTES, TITULO, PROGRESSO }
enum class LibraryTab { SERIES, PASTAS }

/** Conteúdo puro por estado — testável na JVM sem JNI nem ViewModel. */
@Composable
fun LibraryContent(
    state: LibraryUiState,
    onAddClick: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenClick: (Pub) -> Unit = {},
    onAddFolderClick: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    covers: Map<String, String> = emptyMap(),
    onCoverVisible: (Pub) -> Unit = {},
    coverImage: @Composable (Pub, File?, Modifier) -> Unit = { pub, file, mod ->
        DefaultCoverImage(pub, file, mod)
    },
    onToggleFavorite: (Pub) -> Unit = {},
    onDelete: (String) -> Unit = {},
    onSetRead: (Pub, Boolean) -> Unit = { _, _ -> },
    onCancelImport: () -> Unit = {},
    folders: List<FolderEntry> = emptyList(),
    onRescan: () -> Unit = {},
) {
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(LibraryFilter.TODAS) }
    var sort by rememberSaveable { mutableStateOf(LibrarySort.RECENTES) }
    var tab by rememberSaveable { mutableStateOf(LibraryTab.SERIES) }
    var selection by remember { mutableStateOf(setOf<String>()) }
    var pendingDelete by remember { mutableStateOf(setOf<String>()) }

    val filtered = remember(state.pubs, query, filter, sort) {
        var list = state.pubs
        if (query.isNotBlank()) {
            val q = query.lowercase()
            list = list.filter { it.title.lowercase().contains(q) }
        }
        list = when (filter) {
            LibraryFilter.TODAS -> list
            LibraryFilter.FAVORITAS -> list.filter { it.isFavorite }
            LibraryFilter.NAO_LIDAS -> list.filter { it.progress <= 0.01 }
            LibraryFilter.LIDAS -> list.filter { it.progress >= 0.99 }
            LibraryFilter.CONTINUAR -> list.filter { it.progress > 0.01 && it.progress < 0.99 }
        }
        when (sort) {
            LibrarySort.RECENTES -> list
            LibrarySort.TITULO -> list.sortedBy { it.title.lowercase() }
            LibrarySort.PROGRESSO -> list.sortedByDescending { it.progress }
        }
    }
    val continueReading = remember(state.pubs) {
        state.pubs.filter { it.progress > 0.01 && it.progress < 0.99 }.take(5)
    }

    Column(modifier = modifier.fillMaxSize().background(Color(0xFF0D1117))) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(18.dp, 18.dp, 18.dp, 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Tactile Reader",
                style = MaterialTheme.typography.titleLarge,
                color = Color(0xFFF7F2E8),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onAddFolderClick) {
                    Text("+ Pasta", color = Color.White)
                }
                Button(onClick = onAddClick) {
                    Text("+ HQ", color = Color.White)
                }
                TextButton(onClick = onOpenSettings) { Text("⚙", color = Color.White) }
            }
        }
        Text(
            text = "estante local · núcleo nativo",
            style = MaterialTheme.typography.labelMedium,
            color = Color(0xFFC8C0B3),
            modifier = Modifier.padding(18.dp, 0.dp, 18.dp, 4.dp),
        )
        androidx.compose.foundation.layout.Row(
            modifier = Modifier.fillMaxWidth().padding(18.dp, 0.dp, 18.dp, 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            androidx.compose.material3.OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Buscar na estante") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
        }
        androidx.compose.foundation.layout.Row(
            modifier = Modifier.fillMaxWidth().padding(18.dp, 0.dp, 18.dp, 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(filter == LibraryFilter.TODAS, "Todas") { filter = LibraryFilter.TODAS }
            FilterChip(filter == LibraryFilter.CONTINUAR, "Continuar") { filter = LibraryFilter.CONTINUAR }
            FilterChip(filter == LibraryFilter.FAVORITAS, "★") { filter = LibraryFilter.FAVORITAS }
            FilterChip(filter == LibraryFilter.NAO_LIDAS, "Novas") { filter = LibraryFilter.NAO_LIDAS }
        }
        androidx.compose.foundation.layout.Row(
            modifier = Modifier.fillMaxWidth().padding(18.dp, 0.dp, 18.dp, 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilterChip(tab == LibraryTab.SERIES, "Séries") { tab = LibraryTab.SERIES }
            FilterChip(tab == LibraryTab.PASTAS, "Pastas") { tab = LibraryTab.PASTAS }
            androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
            FilterChip(sort == LibrarySort.RECENTES, "Recentes") { sort = LibrarySort.RECENTES }
            FilterChip(sort == LibrarySort.TITULO, "A–Z") { sort = LibrarySort.TITULO }
        }
        if (state.notice != null) {
            Text(
                text = state.notice!!,
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFFF2A900),
                modifier = Modifier.padding(18.dp, 0.dp, 18.dp, 8.dp),
            )
        }
        // Importação longa: progresso visível e cancelável, estante continua lá.
        state.importing?.let { progress ->
            Column(Modifier.fillMaxWidth().padding(18.dp, 0.dp, 18.dp, 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = if (progress.total > 0) {
                            "Importando ${progress.processed} de ${progress.total}" +
                                progress.currentName.takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty()
                        } else {
                            "Preparando importação…"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFFF2A900),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = onCancelImport) {
                        Text("Cancelar", color = Color.White)
                    }
                }
                LinearProgressIndicator(
                    progress = {
                        if (progress.total > 0) {
                            (progress.processed.toFloat() / progress.total).coerceIn(0f, 1f)
                        } else {
                            0f
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    color = Color(0xFFF2A900),
                    trackColor = Color(0x33FFFFFF),
                )
            }
        }
        if (selection.isNotEmpty()) {
            SelectionBar(
                count = selection.size,
                onClear = { selection = emptySet() },
                onMarkRead = {
                    filtered.filter { selection.contains(it.id) }.forEach { onSetRead(it, true) }
                    selection = emptySet()
                },
                onClearProgress = {
                    filtered.filter { selection.contains(it.id) }.forEach { onSetRead(it, false) }
                    selection = emptySet()
                },
                onDelete = { pendingDelete = selection },
            )
        }
        if (pendingDelete.isNotEmpty()) {
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { pendingDelete = emptySet() },
                title = { Text("Remover da estante?", color = Color(0xFFF7F2E8)) },
                text = {
                    Text(
                        "O arquivo original não é tocado. Favoritos, progresso e marcadores desta publicação saem junto.",
                        color = Color(0xFFC8C0B3),
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            pendingDelete.forEach { onDelete(it) }
                            pendingDelete = emptySet()
                            selection = emptySet()
                        },
                    ) { Text("Remover", color = Color(0xFFC96F4A)) }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDelete = emptySet() }) {
                        Text("Cancelar", color = Color(0xFFC8C0B3))
                    }
                },
            )
        }
        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Lendo biblioteca…", color = Color(0xFFC8C0B3))
            }
            state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Falha: ${state.error}", color = Color(0xFFC96F4A))
            }
            tab == LibraryTab.PASTAS -> {
                FoldersList(folders = folders, onRescan = onRescan)
            }
            else -> {
                if (filter == LibraryFilter.TODAS && query.isBlank() && continueReading.isNotEmpty()) {
                    ContinueStrip(
                        pubs = continueReading,
                        covers = covers,
                        onCoverVisible = onCoverVisible,
                        onOpenClick = onOpenClick,
                        coverImage = coverImage,
                    )
                }
                // A estante abre por séries; edições montam só ao abrir o grupo.
                val groups = remember(filtered) { groupBySeries(filtered) }
                var openSeriesKey by rememberSaveable { mutableStateOf<String?>(null) }
                val open = groups.firstOrNull { it.key == openSeriesKey }
                if (open == null) {
                    if (openSeriesKey != null) {
                        openSeriesKey = null
                    }
                    if (groups.isEmpty()) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Nada por aqui — importe uma HQ.", color = Color(0xFFC8C0B3))
                        }
                    } else {
                        SeriesGrid(
                            groups = groups,
                            covers = covers,
                            onCoverVisible = onCoverVisible,
                            onSeriesClick = { openSeriesKey = it.key },
                            coverImage = coverImage,
                        )
                    }
                } else {
                    SeriesDetail(
                        group = open,
                        covers = covers,
                        onCoverVisible = onCoverVisible,
                        onBack = { openSeriesKey = null },
                        onOpenClick = onOpenClick,
                        coverImage = coverImage,
                        selection = selection,
                        onToggleSelect = { id ->
                            selection = if (selection.contains(id)) selection - id else selection + id
                        },
                        onToggleFavorite = onToggleFavorite,
                        onRequestDelete = { pendingDelete = setOf(it) },
                        onSetRead = onSetRead,
                    )
                }
            }
        }
    }
}

@Composable
private fun FilterChip(selected: Boolean, label: String, onClick: () -> Unit) {
    if (selected) {
        Button(onClick = onClick) { Text(label, color = Color.White) }
    } else {
        TextButton(onClick = onClick) { Text(label, color = Color(0xFFC8C0B3)) }
    }
}

@Composable
private fun SelectionBar(
    count: Int,
    onClear: () -> Unit,
    onMarkRead: () -> Unit,
    onClearProgress: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().background(Color(0xFF151B23)).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("$count", color = Color(0xFFF2A900), modifier = Modifier.padding(start = 8.dp))
        TextButton(onClick = onMarkRead) { Text("Lido", color = Color.White) }
        TextButton(onClick = onClearProgress) { Text("Limpar", color = Color.White) }
        TextButton(onClick = onDelete) { Text("Excluir", color = Color(0xFFC96F4A)) }
        androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
        TextButton(onClick = onClear) { Text("✕", color = Color.White) }
    }
}

@Composable
private fun ContinueStrip(
    pubs: List<Pub>,
    covers: Map<String, String>,
    onCoverVisible: (Pub) -> Unit,
    onOpenClick: (Pub) -> Unit,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(18.dp, 0.dp, 18.dp, 8.dp)) {
        Text("Continuar lendo", style = MaterialTheme.typography.titleSmall, color = Color(0xFFF7F2E8))
        androidx.compose.foundation.lazy.LazyRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(vertical = 8.dp),
        ) {
            items(pubs.size) { index ->
                val pub = pubs[index]
                val file = covers[pub.id]?.let { File(it) }
                LaunchedEffect(pub.id, covers[pub.id]) {
                    if (file == null) onCoverVisible(pub)
                }
                Card(
                    onClick = { onOpenClick(pub) },
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23)),
                    modifier = Modifier.width(140.dp),
                ) {
                    Column {
                        coverImage(pub, file, Modifier)
                        Text(
                            pub.title,
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFFF7F2E8),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(8.dp, 6.dp, 8.dp, 0.dp),
                        )
                        LinearProgressIndicator(
                            progress = { pub.progress.toFloat() },
                            modifier = Modifier.fillMaxWidth().padding(8.dp),
                            color = Color(0xFFF2A900),
                            trackColor = Color(0x33FFFFFF),
                        )
                    }
                }
            }
        }
    }
}

/** Entrada física da aba Pastas: nome + contagem, sem mover originais. */
data class FolderEntry(val name: String, val count: Int, val path: String = "")

@Composable
private fun FoldersList(folders: List<FolderEntry>, onRescan: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(18.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Pastas do aparelho", style = MaterialTheme.typography.titleSmall, color = Color(0xFFF7F2E8))
            TextButton(onClick = onRescan) { Text("Revarrer", color = Color.White) }
        }
        if (folders.isEmpty()) {
            Text(
                "Nenhuma pasta importada ainda. Use + Pasta para autorizar via SAF.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFFC8C0B3),
                modifier = Modifier.padding(top = 12.dp),
            )
        } else {
            androidx.compose.foundation.lazy.LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(folders.size) { index ->
                    val folder = folders[index]
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23))) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(folder.name, color = Color(0xFFF7F2E8))
                                Text(
                                    if (folder.count < 0) "pasta autorizada (SAF)" else "${folder.count} arquivos",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Color(0xFFC8C0B3),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Capa real com Coil (arquivo garantido pelo núcleo, limite de 512px, sem
 * crossfade para não animar a grade). O placeholder de cor com a sigla do
 * formato fica por baixo: se o arquivo faltar ou falhar, a estante continua
 * legível e a arte nunca recebe overlay de marca.
 */
@Composable
internal fun DefaultCoverImage(pub: Pub, file: File?, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(150.dp)
            .background(placeholderColor(pub.id)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = pub.format.uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = Color.White,
        )
        if (file != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(file)
                    .size(512)
                    .memoryCacheKey("cover-${pub.id}")
                    .crossfade(false)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun SeriesGrid(
    groups: List<SeriesGroup>,
    covers: Map<String, String>,
    onCoverVisible: (Pub) -> Unit,
    onSeriesClick: (SeriesGroup) -> Unit,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        contentPadding = PaddingValues(18.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(groups, key = { it.key }) { group ->
            val first = group.editions.first().pub
            val coverFile = covers[first.id]?.let { File(it) }
            LaunchedEffect(first.id, covers[first.id]) {
                if (coverFile == null) {
                    onCoverVisible(first)
                }
            }
            SeriesCard(group, coverFile, coverImage, onSeriesClick)
        }
    }
}

@Composable
private fun SeriesCard(
    group: SeriesGroup,
    coverFile: File?,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
    onSeriesClick: (SeriesGroup) -> Unit,
) {
    val first = group.editions.first().pub
    Card(
        onClick = { onSeriesClick(group) },
        colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23)),
    ) {
        Column {
            coverImage(first, coverFile, Modifier)
            Column(Modifier.padding(10.dp)) {
                Text(
                    text = group.title,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFFF7F2E8),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = seriesSubtitle(group),
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                )
            }
        }
    }
}

private fun seriesSubtitle(group: SeriesGroup): String {
    val single = group.editions.singleOrNull()
    return if (single != null && single.number == null) {
        "${single.pub.pageCount} páginas"
    } else {
        "${group.editions.size} edições"
    }
}

@Composable
private fun SeriesDetail(
    group: SeriesGroup,
    covers: Map<String, String>,
    onCoverVisible: (Pub) -> Unit,
    onBack: () -> Unit,
    onOpenClick: (Pub) -> Unit,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
    selection: Set<String> = emptySet(),
    onToggleSelect: (String) -> Unit = {},
    onToggleFavorite: (Pub) -> Unit = {},
    onRequestDelete: (String) -> Unit = {},
    onSetRead: (Pub, Boolean) -> Unit = { _, _ -> },
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(10.dp, 4.dp, 18.dp, 0.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) { Text("‹ All series", color = Color.White) }
            Text(
                text = group.title,
                style = MaterialTheme.typography.titleSmall,
                color = Color(0xFFF7F2E8),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 4.dp),
            )
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(18.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(group.editions, key = { it.pub.id }) { edition ->
                val pub = edition.pub
                val coverFile = covers[pub.id]?.let { File(it) }
                LaunchedEffect(pub.id, covers[pub.id]) {
                    if (coverFile == null) {
                        onCoverVisible(pub)
                    }
                }
                Column {
                    PubCard(
                        pub = pub,
                        coverFile = coverFile,
                        coverImage = coverImage,
                        onOpenClick = onOpenClick,
                        selected = selection.contains(pub.id),
                        onToggleSelect = onToggleSelect,
                        onToggleFavorite = onToggleFavorite,
                        onRequestDelete = onRequestDelete,
                        onSetRead = onSetRead,
                    )
                    if (edition.possibleDuplicate) {
                        Text(
                            text = "possible duplicate",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFFF2A900),
                            modifier = Modifier.padding(top = 4.dp, start = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PubCard(
    pub: Pub,
    coverFile: File?,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
    onOpenClick: (Pub) -> Unit,
    selected: Boolean = false,
    onToggleSelect: (String) -> Unit = {},
    onToggleFavorite: (Pub) -> Unit = {},
    onRequestDelete: (String) -> Unit = {},
    onSetRead: (Pub, Boolean) -> Unit = { _, _ -> },
) {
    var menu by remember(pub.id) { mutableStateOf(false) }
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (selected) Color(0xFF2A3320) else Color(0xFF151B23),
        ),
    ) {
        Column(
            modifier = Modifier.combinedClickable(
                onClick = {
                    if (selected || menu) onToggleSelect(pub.id) else onOpenClick(pub)
                },
                onLongClick = { onToggleSelect(pub.id) },
            ),
        ) {
            Box {
                coverImage(pub, coverFile, Modifier)
                if (selected) {
                    Box(
                        Modifier.fillMaxWidth().background(Color(0x99000000)).padding(4.dp),
                        contentAlignment = Alignment.TopEnd,
                    ) {
                        Text("✓", color = Color(0xFFF2A900))
                    }
                }
            }
            Column(Modifier.padding(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = pub.title,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFFF7F2E8),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { onToggleFavorite(pub) }) {
                        Text(if (pub.isFavorite) "★" else "☆", color = Color(0xFFF2A900))
                    }
                }
                Text(
                    text = "${pub.pageCount} páginas",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                )
                LinearProgressIndicator(
                    progress = { pub.progress.toFloat() },
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    color = Color(0xFFF2A900),
                    trackColor = Color(0x33FFFFFF),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { menu = !menu }) {
                        Text("•••", color = Color(0xFFC8C0B3))
                    }
                }
                if (menu) {
                    Column {
                        TextButton(onClick = { onSetRead(pub, true); menu = false }) {
                            Text("Marcar como lido", color = Color.White)
                        }
                        TextButton(onClick = { onSetRead(pub, false); menu = false }) {
                            Text("Limpar progresso", color = Color.White)
                        }
                        TextButton(onClick = { onRequestDelete(pub.id); menu = false }) {
                            Text("Excluir da estante", color = Color(0xFFC96F4A))
                        }
                    }
                }
            }
        }
    }
}
