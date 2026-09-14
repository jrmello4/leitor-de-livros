package com.jrmello4.tactilereader.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
) {
    val state by viewModel.state.collectAsState()
    val covers by viewModel.covers.collectAsState()
    LibraryContent(
        state = state,
        onAddClick = onAddClick,
        onOpenClick = onOpenClick,
        modifier = modifier,
        covers = covers,
        onCoverVisible = viewModel::requestCover,
    )
}

/** Conteúdo puro por estado — testável na JVM sem JNI nem ViewModel. */
@Composable
fun LibraryContent(
    state: LibraryUiState,
    onAddClick: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenClick: (Pub) -> Unit = {},
    covers: Map<String, String> = emptyMap(),
    onCoverVisible: (Pub) -> Unit = {},
    coverImage: @Composable (Pub, File?, Modifier) -> Unit = { pub, file, mod ->
        DefaultCoverImage(pub, file, mod)
    },
) {
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
            Button(onClick = onAddClick) {
                Text("+ HQ", color = Color.White)
            }
        }
        Text(
            text = "estante local · núcleo nativo",
            style = MaterialTheme.typography.labelMedium,
            color = Color(0xFFC8C0B3),
            modifier = Modifier.padding(18.dp, 0.dp, 18.dp, 4.dp),
        )
        if (state.notice != null) {
            Text(
                text = state.notice!!,
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFFF2A900),
                modifier = Modifier.padding(18.dp, 0.dp, 18.dp, 8.dp),
            )
        }
        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Lendo biblioteca…", color = Color(0xFFC8C0B3))
            }
            state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Falha: ${state.error}", color = Color(0xFFC96F4A))
            }
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(18.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(state.pubs, key = { it.id }) { pub ->
                    val coverFile = covers[pub.id]?.let { File(it) }
                    LaunchedEffect(pub.id, covers[pub.id]) {
                        if (coverFile == null) {
                            onCoverVisible(pub)
                        }
                    }
                    PubCard(pub, coverFile, coverImage, onOpenClick)
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
private fun PubCard(
    pub: Pub,
    coverFile: File?,
    coverImage: @Composable (Pub, File?, Modifier) -> Unit,
    onOpenClick: (Pub) -> Unit,
) {
    Card(
        onClick = { onOpenClick(pub) },
        colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23)),
    ) {
        Column {
            coverImage(pub, coverFile, Modifier)
            Column(Modifier.padding(10.dp)) {
                Text(
                    text = pub.title,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFFF7F2E8),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
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
            }
        }
    }
}
