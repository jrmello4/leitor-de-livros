package com.jrmello4.tactilereader.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.jrmello4.tactilereader.core.Pub
import com.jrmello4.tactilereader.core.ReadingStatus
import com.jrmello4.tactilereader.core.isContinueCandidate
import com.jrmello4.tactilereader.scaffold.R
import java.io.File

enum class LibraryFilter { TODAS, FAVORITAS, NAO_LIDAS, LIDAS, CONTINUAR }
enum class LibrarySort { RECENTES, TITULO, PROGRESSO }
enum class LibraryTab { SERIES, PASTAS }

/** Cor estável por publicação — placeholder e fundo enquanto a capa carrega. */
internal fun placeholderColor(id: String): Color {
    val hue = (id.hashCode() and 0x7fffffff) % 360
    return Color.hsl(hue.toFloat(), 0.45f, 0.28f)
}

@OptIn(ExperimentalMaterial3Api::class)
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
    onOpenOpds: () -> Unit = {},
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
    var importSheetVisible by rememberSaveable { mutableStateOf(false) }

    val filtered = remember(state.pubs, query, filter, sort) {
        var list = state.pubs
        if (query.isNotBlank()) {
            val q = query.lowercase()
            list = list.filter { it.title.lowercase().contains(q) }
        }
        list = when (filter) {
            LibraryFilter.TODAS -> list
            LibraryFilter.FAVORITAS -> list.filter { it.isFavorite }
            LibraryFilter.NAO_LIDAS -> list.filter { it.readingStatus == ReadingStatus.NOT_STARTED }
            LibraryFilter.LIDAS -> list.filter { it.readingStatus == ReadingStatus.FINISHED }
            LibraryFilter.CONTINUAR -> list.filter { it.isContinueCandidate() }
        }
        when (sort) {
            LibrarySort.RECENTES -> list
            LibrarySort.TITULO -> list.sortedBy { it.title.lowercase() }
            LibrarySort.PROGRESSO -> list.sortedByDescending { it.progress }
        }
    }
    val continueReading = remember(state.pubs) {
        state.pubs.filter { it.isContinueCandidate() }.take(5)
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
                    title = { Text(stringResource(R.string.library_remove_confirm_title), color = MaterialTheme.colorScheme.onSurface) },
                    text = {
                        Text(
                            stringResource(R.string.library_remove_confirmation_message),
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
                        ) { Text(stringResource(R.string.action_remove), color = MaterialTheme.colorScheme.error) }
                    },
                    dismissButton = {
                        TextButton(onClick = { pendingDelete = emptySet() }) {
                            Text(stringResource(R.string.action_cancel), color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                title = { Text(stringResource(R.string.library_remove_confirm_title), color = MaterialTheme.colorScheme.onSurface) },
                text = {
                    Text(
                        stringResource(R.string.library_remove_confirmation_message),
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
                    ) { Text(stringResource(R.string.action_remove), color = MaterialTheme.colorScheme.error) }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDelete = emptySet() }) {
                        Text(stringResource(R.string.action_cancel), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
            )
        }

        if (importSheetVisible) {
            ModalBottomSheet(onDismissRequest = { importSheetVisible = false }) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(stringResource(R.string.library_import), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                    Button(
                        onClick = { importSheetVisible = false; onAddClick() },
                        modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
                    ) { Text(stringResource(R.string.library_import_file)) }
                    Button(
                        onClick = { importSheetVisible = false; onAddFolderClick() },
                        modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
                    ) { Text(stringResource(R.string.library_import_folder)) }
                    Button(
                        onClick = { importSheetVisible = false; onOpenOpds() },
                        modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
                    ) { Text(stringResource(R.string.library_import_opds)) }
                }
            }
        }

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.library_loading),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.common_error_detail, state.error),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
            }
            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 136.dp),
                    modifier = Modifier
                        .fillMaxSize()
                        .navigationBarsPadding(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    // Header unificado (título, ações rápidas e importação de arquivo/pasta)
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
                                onImportClick = { importSheetVisible = true },
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
                                    stringResource(R.string.library_search_hint),
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
                            FilterChip(filter == LibraryFilter.TODAS, stringResource(R.string.library_filter_all)) { filter = LibraryFilter.TODAS }
                            FilterChip(filter == LibraryFilter.CONTINUAR, stringResource(R.string.library_filter_continue)) { filter = LibraryFilter.CONTINUAR }
                            FilterChip(filter == LibraryFilter.FAVORITAS, stringResource(R.string.library_filter_favorites)) { filter = LibraryFilter.FAVORITAS }
                            FilterChip(filter == LibraryFilter.NAO_LIDAS, stringResource(R.string.library_filter_new)) { filter = LibraryFilter.NAO_LIDAS }

                            Box(
                                modifier = Modifier
                                    .width(1.dp)
                                    .height(20.dp)
                                    .background(MaterialTheme.colorScheme.outlineVariant),
                            )

                            FilterChip(tab == LibraryTab.SERIES, stringResource(R.string.library_filter_series)) { tab = LibraryTab.SERIES }
                            FilterChip(tab == LibraryTab.PASTAS, stringResource(R.string.library_filter_folders)) { tab = LibraryTab.PASTAS }

                            Box(
                                modifier = Modifier
                                    .width(1.dp)
                                    .height(20.dp)
                                    .background(MaterialTheme.colorScheme.outlineVariant),
                            )

                            FilterChip(sort == LibrarySort.RECENTES, stringResource(R.string.library_sort_recent)) { sort = LibrarySort.RECENTES }
                            FilterChip(sort == LibrarySort.TITULO, stringResource(R.string.library_sort_title)) { sort = LibrarySort.TITULO }
                            FilterChip(sort == LibrarySort.PROGRESSO, stringResource(R.string.library_sort_progress)) { sort = LibrarySort.PROGRESSO }
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
                                            stringResource(R.string.library_importing_count, progress.processed, progress.total) +
                                                progress.currentName.takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty()
                                        } else {
                                            stringResource(R.string.library_import_preparing)
                                        },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.secondary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    TextButton(onClick = onCancelImport) {
                                        Text(stringResource(R.string.action_cancel), color = MaterialTheme.colorScheme.onSurface)
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
                                    stringResource(R.string.library_folders_title),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.semantics { heading() },
                                )
                                TextButton(onClick = onRescan) {
                                    Text(stringResource(R.string.library_rescan), color = MaterialTheme.colorScheme.primary)
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
                                        stringResource(R.string.library_empty_folders),
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
                                                if (folder.count < 0) stringResource(R.string.library_folder_authorized)
                                                else stringResource(R.string.library_folder_file_count, folder.count),
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
                                        stringResource(R.string.library_continue_reading),
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
                                    text = if (tab == LibraryTab.SERIES) {
                                        stringResource(R.string.library_filter_series)
                                    } else {
                                        stringResource(R.string.library_publications)
                                    },
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
                                        stringResource(R.string.library_empty),
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
