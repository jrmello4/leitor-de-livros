package com.jrmello4.tactilereader.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.jrmello4.tactilereader.core.Pub
import com.jrmello4.tactilereader.core.ReadingMetrics
import java.io.File
import kotlin.math.roundToInt

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
    onOpenBookmarks: () -> Unit = {},
    onOpenStats: () -> Unit = {},
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
        onOpenBookmarks = onOpenBookmarks,
        onOpenStats = onOpenStats,
        covers = covers,
        onCoverVisible = viewModel::requestCover,
        onToggleFavorite = viewModel::toggleFavorite,
        onDelete = viewModel::deletePublication,
        onSetRead = viewModel::setRead,
        onCancelImport = viewModel::cancelImport,
        onRetryImport = viewModel::retryFailedImports,
        onDismissImportReport = viewModel::dismissImportReport,
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
    onOpenBookmarks: () -> Unit = {},
    onOpenStats: () -> Unit = {},
    covers: Map<String, String> = emptyMap(),
    onCoverVisible: (Pub) -> Unit = {},
    coverImage: @Composable (Pub, File?, Modifier) -> Unit = { pub, file, mod ->
        DefaultCoverImage(pub, file, mod)
    },
    onToggleFavorite: (Pub) -> Unit = {},
    onDelete: (String) -> Unit = {},
    onSetRead: (Pub, Boolean) -> Unit = { _, _ -> },
    onCancelImport: () -> Unit = {},
    onRetryImport: () -> Unit = {},
    onDismissImportReport: () -> Unit = {},
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
    val groups = remember(filtered) { groupBySeries(filtered) }
    var openSeriesKey by rememberSaveable { mutableStateOf<String?>(null) }
    val open = groups.firstOrNull { it.key == openSeriesKey }
    if (open == null && openSeriesKey != null) {
        openSeriesKey = null
    }

    if (open != null) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
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
                AlertDialog(
                    onDismissRequest = { pendingDelete = emptySet() },
                    title = { Text("Remover da estante?", color = MaterialTheme.colorScheme.onSurface) },
                    text = {
                        Text(
                            "O arquivo original não é tocado. Favoritos, progresso e marcadores desta publicação saem junto.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                pendingDelete.forEach { onDelete(it) }
                                pendingDelete = emptySet()
                                selection = emptySet()
                            },
                        ) { Text("Remover", color = MaterialTheme.colorScheme.error) }
                    },
                    dismissButton = {
                        TextButton(onClick = { pendingDelete = emptySet() }) {
                            Text("Cancelar", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                )
            }
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
        return
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding(),
    ) {
        if (pendingDelete.isNotEmpty()) {
            AlertDialog(
                onDismissRequest = { pendingDelete = emptySet() },
                title = { Text("Remover da estante?", color = MaterialTheme.colorScheme.onSurface) },
                text = {
                    Text(
                        "O arquivo original não é tocado. Favoritos, progresso e marcadores desta publicação saem junto.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            pendingDelete.forEach { onDelete(it) }
                            pendingDelete = emptySet()
                            selection = emptySet()
                        },
                    ) { Text("Remover", color = MaterialTheme.colorScheme.error) }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDelete = emptySet() }) {
                        Text("Cancelar", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
            )
        }

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "Lendo biblioteca…",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "Falha: ${state.error}",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
            }
            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    modifier = Modifier
                        .fillMaxSize()
                        .navigationBarsPadding(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    // Header unificado (título, ações rápidas e botões + HQ / + Pasta)
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column(modifier = Modifier.fillMaxWidth().padding(bottom = 2.dp)) {
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
                                Spacer(Modifier.height(8.dp))
                            }
                            LibraryHeaderBar(
                                onAddClick = onAddClick,
                                onAddFolderClick = onAddFolderClick,
                                onOpenBookmarks = onOpenBookmarks,
                                onOpenStats = onOpenStats,
                                onOpenSettings = onOpenSettings,
                            )
                        }
                    }

                    // Campo de busca refinado
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it },
                            placeholder = {
                                Text(
                                    "Buscar na estante…",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                )
                            },
                            singleLine = true,
                            shape = RoundedCornerShape(14.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                                focusedBorderColor = MaterialTheme.colorScheme.primary,
                                unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                                focusedTextColor = MaterialTheme.colorScheme.onSurface,
                                unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    // Fita única de filtros com rolagem horizontal fluida
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            FilterChip(filter == LibraryFilter.TODAS, "Todas") { filter = LibraryFilter.TODAS }
                            FilterChip(filter == LibraryFilter.CONTINUAR, "Continuar") { filter = LibraryFilter.CONTINUAR }
                            FilterChip(filter == LibraryFilter.FAVORITAS, "Favoritas") { filter = LibraryFilter.FAVORITAS }
                            FilterChip(filter == LibraryFilter.NAO_LIDAS, "Novas") { filter = LibraryFilter.NAO_LIDAS }

                            Box(
                                modifier = Modifier
                                    .width(1.dp)
                                    .height(20.dp)
                                    .background(MaterialTheme.colorScheme.outlineVariant),
                            )

                            FilterChip(tab == LibraryTab.SERIES, "Séries") { tab = LibraryTab.SERIES }
                            FilterChip(tab == LibraryTab.PASTAS, "Pastas") { tab = LibraryTab.PASTAS }

                            Box(
                                modifier = Modifier
                                    .width(1.dp)
                                    .height(20.dp)
                                    .background(MaterialTheme.colorScheme.outlineVariant),
                            )

                            FilterChip(sort == LibrarySort.RECENTES, "Recentes") { sort = LibrarySort.RECENTES }
                            FilterChip(sort == LibrarySort.TITULO, "A–Z") { sort = LibrarySort.TITULO }
                            FilterChip(sort == LibrarySort.PROGRESSO, "Progresso") { sort = LibrarySort.PROGRESSO }
                        }
                    }

                    // Aviso passageiro da estante
                    if (state.notice != null) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Text(
                                text = state.notice!!,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.secondary,
                                modifier = Modifier
                                    .padding(vertical = 4.dp)
                                    .semantics { liveRegion = LiveRegionMode.Polite },
                            )
                        }
                    }

                    // Importação em segundo plano
                    state.importing?.let { progress ->
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = if (progress.total > 0) {
                                            "Importando ${progress.processed} de ${progress.total}" +
                                                progress.currentName.takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty()
                                        } else {
                                            "Preparando importação…"
                                        },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.secondary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    TextButton(onClick = onCancelImport) {
                                        Text("Cancelar", color = MaterialTheme.colorScheme.onSurface)
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
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(4.dp)
                                        .clip(RoundedCornerShape(2.dp)),
                                    color = MaterialTheme.colorScheme.primary,
                                    trackColor = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }

                    // Relatório de erros de importação
                    state.importReport?.let { report ->
                        if (report.hasFailures || report.cancelled) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                ImportReportCard(
                                    report = report,
                                    onRetry = onRetryImport,
                                    onDismiss = onDismissImportReport,
                                )
                            }
                        }
                    }

                    if (tab == LibraryTab.PASTAS) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "Pastas do aparelho",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.semantics { heading() },
                                )
                                TextButton(onClick = onRescan) {
                                    Text("Revarrer", color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                        if (folders.isEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Box(
                                    Modifier.fillMaxWidth().padding(vertical = 40.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        "Nenhuma pasta com HQs encontrada.",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        } else {
                            items(folders.size, span = { GridItemSpan(maxLineSpan) }) { idx ->
                                val folder = folders[idx]
                                Card(
                                    shape = RoundedCornerShape(12.dp),
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(14.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(Modifier.weight(1f)) {
                                            Text(
                                                folder.name,
                                                fontWeight = FontWeight.SemiBold,
                                                color = MaterialTheme.colorScheme.onSurface,
                                            )
                                            Text(
                                                if (folder.count < 0) "pasta autorizada (SAF)" else "${folder.count} arquivos",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // Seção única Continuar Lendo (Hero + Carrossel secundário)
                        if (filter == LibraryFilter.TODAS && query.isBlank() && continueReading.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Column(Modifier.fillMaxWidth()) {
                                    Text(
                                        "Continuar lendo",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        modifier = Modifier
                                            .padding(top = 4.dp, bottom = 8.dp)
                                            .semantics { heading() },
                                    )
                                    val hero = continueReading.first()
                                    ContinueHeroCard(
                                        pub = hero,
                                        cover = covers[hero.id]?.let { File(it) },
                                        onCoverVisible = onCoverVisible,
                                        onOpenClick = onOpenClick,
                                        coverImage = coverImage,
                                    )
                                    if (continueReading.size > 1) {
                                        ContinueStripRow(
                                            pubs = continueReading.drop(1),
                                            covers = covers,
                                            onCoverVisible = onCoverVisible,
                                            onOpenClick = onOpenClick,
                                            coverImage = coverImage,
                                        )
                                    }
                                }
                            }
                        }

                        // Cabeçalho da grade
                        if (groups.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Text(
                                    text = if (tab == LibraryTab.SERIES) "Séries" else "Publicações",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier
                                        .padding(top = 6.dp)
                                        .semantics { heading() },
                                )
                            }
                        }

                        // Grade de publicações ou estado vazio
                        if (groups.isEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) {
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 40.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        "Nada por aqui — importe uma HQ.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        } else {
                            items(groups, key = { it.key }) { group ->
                                val first = group.editions.first().pub
                                val coverFile = covers[first.id]?.let { File(it) }
                                LaunchedEffect(first.id, covers[first.id]) {
                                    if (coverFile == null) onCoverVisible(first)
                                }
                                SeriesCard(
                                    group = group,
                                    coverFile = coverFile,
                                    onSeriesClick = { openSeriesKey = it.key },
                                    coverImage = coverImage,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LibraryHeaderBar(
    onAddClick: () -> Unit,
    onAddFolderClick: () -> Unit,
    onOpenBookmarks: () -> Unit = {},
    onOpenStats: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Tactile Reader",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = "mesa editorial · estante local",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                onClick = onAddClick,
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)),
                modifier = Modifier.defaultMinSize(minHeight = 44.dp),
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = "+ HQ",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Surface(
                onClick = onAddFolderClick,
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.defaultMinSize(minHeight = 44.dp),
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = "+ Pasta",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}

@Composable
private fun ImportReportCard(
    report: ImportReport,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (report.cancelled) "Importação cancelada" else "Resultado da importação",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.semantics { heading() },
                )
                IconButton(onClick = onDismiss) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Fechar relatório",
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
            Text(
                text = "${report.imported} adicionadas com sucesso" +
                    if (report.failed.isNotEmpty()) ", ${report.failed.size} com falha" else "",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (report.failed.isNotEmpty()) {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (fail in report.failed.take(5)) {
                        Text(
                            text = "• ${fail.displayName}: ${fail.errorMessage ?: "Erro"}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (report.failed.size > 5) {
                        Text(
                            text = "+ mais ${report.failed.size - 5} arquivos com falha",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (report.recoverableFailures.isNotEmpty()) {
                    Button(
                        onClick = onRetry,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                    ) {
                        Text("Tentar novamente", color = MaterialTheme.colorScheme.onPrimary)
                    }
                }
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                ) {
                    Text("Dispensar", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** Texto de progresso para a retomada: páginas são a unidade honesta para HQs. */
internal fun readingProgressSummary(pub: Pub): String {
    if (pub.pageCount <= 0) return "Sem páginas disponíveis"
    val currentPage = (pub.progress.coerceIn(0.0, 1.0) * (pub.pageCount - 1))
        .roundToInt()
        .plus(1)
        .coerceIn(1, pub.pageCount)
    val remaining = (pub.pageCount - currentPage).coerceAtLeast(0)
    val pageText = ReadingMetrics.formatPageProgress(currentPage, pub.pageCount)
    val estimatedMinutes = pub.readingPagesPerMinute?.let {
        ReadingMetrics.estimateRemainingMinutes(remaining, it)
    }
    if (estimatedMinutes != null) {
        return ReadingMetrics.formatHeroProgress(currentPage, pub.pageCount, estimatedMinutes)
    }
    return if (remaining == 0) {
        "$pageText • Última página"
    } else {
        "$pageText • Faltam aprox. $remaining páginas"
    }
}

@Composable
private fun ContinueHeroCard(
    pub: Pub,
    cover: File?,
    onCoverVisible: (Pub) -> Unit,
    onOpenClick: (Pub) -> Unit,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
) {
    LaunchedEffect(pub.id, cover) {
        if (cover == null) onCoverVisible(pub)
    }
    Card(
        onClick = { onOpenClick(pub) },
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .width(106.dp)
                    .height(152.dp)
                    .clip(RoundedCornerShape(10.dp)),
            ) {
                coverImage(pub, cover, Modifier.fillMaxSize())
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    pub.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    readingProgressSummary(pub),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                LinearProgressIndicator(
                    progress = { pub.progress.toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.outlineVariant,
                )
                Spacer(Modifier.height(4.dp))
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.padding(vertical = 10.dp),
                    ) {
                        Text(
                            "Retomar",
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(selected: Boolean, label: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
        ),
        modifier = Modifier.defaultMinSize(minHeight = 44.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            "$count selecionado(s)",
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 4.dp),
        )
        Spacer(Modifier.weight(1f))
        TextButton(onClick = onMarkRead) { Text("Lido", color = MaterialTheme.colorScheme.onSurface) }
        TextButton(onClick = onClearProgress) { Text("Limpar", color = MaterialTheme.colorScheme.onSurface) }
        TextButton(onClick = onDelete) { Text("Excluir", color = MaterialTheme.colorScheme.error) }
        IconButton(onClick = onClear) {
            Icon(Icons.Filled.Close, contentDescription = "Limpar seleção", tint = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun ContinueStripRow(
    pubs: List<Pub>,
    covers: Map<String, String>,
    onCoverVisible: (Pub) -> Unit,
    onOpenClick: (Pub) -> Unit,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(top = 10.dp, bottom = 4.dp),
    ) {
        items(pubs.size) { index ->
            val pub = pubs[index]
            val file = covers[pub.id]?.let { File(it) }
            LaunchedEffect(pub.id, covers[pub.id]) {
                if (file == null) onCoverVisible(pub)
            }
            Card(
                onClick = { onOpenClick(pub) },
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.width(136.dp),
            ) {
                Column {
                    Box(
                        Modifier
                            .height(180.dp)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)),
                    ) {
                        coverImage(pub, file, Modifier.fillMaxSize())
                    }
                    Text(
                        pub.title,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                    )
                    LinearProgressIndicator(
                        progress = { pub.progress.toFloat().coerceIn(0f, 1f) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 8.dp, end = 8.dp, bottom = 8.dp)
                            .height(3.dp)
                            .clip(RoundedCornerShape(1.5.dp)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.outlineVariant,
                    )
                }
            }
        }
    }
}

/** Entrada física da aba Pastas: nome + contagem, sem mover originais. */
data class FolderEntry(val name: String, val count: Int, val path: String = "")

@Composable
internal fun DefaultCoverImage(pub: Pub, file: File?, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(200.dp)
            .background(placeholderColor(pub.id)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = pub.format.uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (file != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(file)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun SeriesCard(
    group: SeriesGroup,
    coverFile: File?,
    onSeriesClick: (SeriesGroup) -> Unit,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
) {
    val first = group.editions.first().pub
    Card(
        onClick = { onSeriesClick(group) },
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column {
            Box(
                Modifier
                    .height(200.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)),
            ) {
                coverImage(first, coverFile, Modifier.fillMaxSize())
            }
            Column(Modifier.padding(10.dp)) {
                Text(
                    text = group.title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = seriesSubtitle(group),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

private fun seriesSubtitle(group: SeriesGroup): String {
    val single = group.editions.singleOrNull()
    if (single != null && single.number == null) {
        return "${single.pub.pageCount} páginas"
    }
    val total = group.editions.size
    val read = group.editions.count { it.pub.progress >= 0.99 }
    return when {
        read == 0 -> "$total edições"
        read == total -> "$total edições · todas lidas"
        else -> "$total edições · $read lidas"
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
    selection: Set<String>,
    onToggleSelect: (String) -> Unit,
    onToggleFavorite: (Pub) -> Unit,
    onRequestDelete: (String) -> Unit,
    onSetRead: (Pub, Boolean) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = onBack,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.width(4.dp))
                Text("All series", color = MaterialTheme.colorScheme.onSurface)
            }
            Text(
                text = group.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 6.dp),
            )
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(group.editions, key = { it.pub.id }) { edition ->
                val pub = edition.pub
                val file = covers[pub.id]?.let { File(it) }
                LaunchedEffect(pub.id, covers[pub.id]) {
                    if (file == null) onCoverVisible(pub)
                }
                Column {
                    PubCard(
                        pub = pub,
                        coverFile = file,
                        onCoverVisible = onCoverVisible,
                        onOpenClick = onOpenClick,
                        coverImage = coverImage,
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
                            color = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.padding(top = 4.dp, start = 8.dp),
                        )
                    }
                }
            }
        }
    }
}

private fun editionLabel(edition: SeriesEdition): String {
    val issue = edition.number
    return if (issue != null) {
        "#$issue"
    } else {
        edition.pub.title
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PubCard(
    pub: Pub,
    coverFile: File?,
    onCoverVisible: (Pub) -> Unit,
    onOpenClick: (Pub) -> Unit,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
    selected: Boolean,
    onToggleSelect: (String) -> Unit,
    onToggleFavorite: (Pub) -> Unit,
    onRequestDelete: (String) -> Unit,
    onSetRead: (Pub, Boolean) -> Unit,
) {
    LaunchedEffect(pub.id, coverFile) {
        if (coverFile == null) onCoverVisible(pub)
    }
    var menu by remember(pub.id) { mutableStateOf(false) }
    Card(
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
        ),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
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
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                    .semantics(mergeDescendants = true) {}
                    .clickable {
                        if (selected || menu) onToggleSelect(pub.id) else onOpenClick(pub)
                    },
            ) {
                coverImage(pub, coverFile, Modifier.fillMaxSize())
                if (selected) {
                    Box(
                        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).padding(8.dp),
                        contentAlignment = Alignment.TopEnd,
                    ) {
                        Icon(Icons.Filled.Check, contentDescription = "Selecionado", tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            Column(Modifier.padding(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = pub.title,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = { onToggleFavorite(pub) },
                        modifier = Modifier.defaultMinSize(minWidth = 36.dp, minHeight = 36.dp),
                    ) {
                        Icon(
                            Icons.Filled.Star,
                            contentDescription = if (pub.isFavorite) "Remover dos favoritos" else "Favoritar",
                            tint = if (pub.isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    text = "${pub.pageCount} páginas",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (pub.progress > 0.0) {
                    LinearProgressIndicator(
                        progress = { pub.progress.toFloat().coerceIn(0f, 1f) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 6.dp)
                            .height(3.dp)
                            .clip(RoundedCornerShape(1.5.dp)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.outlineVariant,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.End,
                ) {
                    IconButton(
                        onClick = { menu = !menu },
                        modifier = Modifier.defaultMinSize(minWidth = 36.dp, minHeight = 36.dp),
                    ) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "Opções", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (menu) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp)
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                            .padding(4.dp),
                    ) {
                        TextButton(onClick = { onSetRead(pub, true); menu = false }, modifier = Modifier.fillMaxWidth()) {
                            Text("Marcar como lido", color = MaterialTheme.colorScheme.onSurface)
                        }
                        TextButton(onClick = { onSetRead(pub, false); menu = false }, modifier = Modifier.fillMaxWidth()) {
                            Text("Limpar progresso", color = MaterialTheme.colorScheme.onSurface)
                        }
                        TextButton(onClick = { onRequestDelete(pub.id); menu = false }, modifier = Modifier.fillMaxWidth()) {
                            Text("Excluir da estante", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }
}
