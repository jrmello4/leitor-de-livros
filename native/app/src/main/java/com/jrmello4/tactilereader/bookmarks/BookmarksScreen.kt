package com.jrmello4.tactilereader.bookmarks

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.core.BookmarkItem
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.scaffold.AppSources
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Central de Marcadores: lista todas as páginas marcadas na biblioteca inteira,
 * permite abrir diretamente na página salva, excluir marcadores ou acionar backup local.
 */
@Composable
fun BookmarksScreen(
    filesDir: File,
    onBack: () -> Unit,
    onOpenBookmark: (publicationId: String, pageId: String) -> Unit,
    modifier: Modifier = Modifier,
    onExportBackup: () -> Unit = {},
    onImportBackup: () -> Unit = {},
) {
    val db = remember(filesDir) {
        LibraryDb.open(File(filesDir, "lib"), File(filesDir, "imports"), AppSources.opener)
    }
    val scope = rememberCoroutineScope()
    var bookmarks by remember { mutableStateOf<List<BookmarkItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var query by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf<String?>(null) }

    fun refreshBookmarks() {
        loading = true
        scope.launch {
            val list = withContext(Dispatchers.IO) { db.listAllBookmarks() }
            bookmarks = list
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        refreshBookmarks()
    }

    val filtered = remember(bookmarks, query) {
        if (query.isBlank()) {
            bookmarks
        } else {
            val q = query.lowercase().trim()
            bookmarks.filter {
                it.publicationTitle.lowercase().contains(q) || it.label.lowercase().contains(q)
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        // Top Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = onBack,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Voltar para a estante",
                    tint = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.width(4.dp))
                Text("Estante", color = MaterialTheme.colorScheme.onSurface)
            }
            Text(
                text = "Marcadores",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 4.dp)
                    .semantics { heading() },
            )
            Icon(
                Icons.Filled.Star,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.padding(end = 8.dp),
            )
        }

        // Subtítulo editorial e ações de backup
        Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
            Text(
                text = "Páginas marcadas em todas as suas publicações locais.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onExportBackup,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text("Exportar backup", color = MaterialTheme.colorScheme.onPrimary)
                }
                Button(
                    onClick = onImportBackup,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text("Importar backup", color = MaterialTheme.colorScheme.onPrimary)
                }
            }
        }

        // Campo de busca quando houver itens
        if (bookmarks.size > 2) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Buscar marcador ou HQ") },
                singleLine = true,
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { query = "" }) {
                            Icon(Icons.Filled.Close, contentDescription = "Limpar busca")
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }

        if (notice != null) {
            Text(
                text = notice!!,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        // Conteúdo
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Carregando marcadores…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            bookmarks.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(24.dp),
                ) {
                    Icon(
                        Icons.Filled.Star,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    )
                    Spacer(Modifier.padding(top = 8.dp))
                    Text(
                        "Nenhum marcador salvo ainda.",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.padding(top = 4.dp))
                    Text(
                        "Durante a leitura, toque no ícone de estrela na barra superior para marcar uma página.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            filtered.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Nenhum marcador encontrado para \"$query\".", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(filtered, key = { "${it.publicationId}:${it.pageId}" }) { item ->
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                                Text(
                                    text = item.publicationTitle,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = "Página ${item.pageIndex + 1}" +
                                        if (item.label.isNotBlank()) " • ${item.label}" else "",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.secondary,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .horizontalScroll(rememberScrollState())
                                        .padding(top = 8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Button(
                                        onClick = { onOpenBookmark(item.publicationId, item.pageId) },
                                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                    ) {
                                        Text("Abrir página", color = MaterialTheme.colorScheme.onPrimary)
                                    }
                                    TextButton(
                                        onClick = {
                                            scope.launch {
                                                withContext(Dispatchers.IO) {
                                                    db.removeBookmark(item.publicationId, item.pageId)
                                                }
                                                notice = "Marcador da página ${item.pageIndex + 1} removido."
                                                refreshBookmarks()
                                            }
                                        },
                                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                    ) {
                                        Text("Remover", color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
