package com.jrmello4.tactilereader.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.core.Pub
import com.jrmello4.tactilereader.core.ReadingStatus
import com.jrmello4.tactilereader.scaffold.R
import java.io.File

@Composable
internal fun SeriesCard(
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

@Composable
internal fun seriesSubtitle(group: SeriesGroup): String {
    val single = group.editions.singleOrNull()
    if (single != null && single.number == null) {
        return stringResource(R.string.library_page_count, single.pub.pageCount)
    }
    val total = group.editions.size
    val read = group.editions.count { it.pub.readingStatus == ReadingStatus.FINISHED }
    return when {
        read == 0 -> stringResource(R.string.library_edition_count, total)
        read == total -> stringResource(R.string.library_edition_all_read, total)
        else -> stringResource(R.string.library_edition_read_count, total, read)
    }
}

@Composable
internal fun SeriesDetail(
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
                Text(stringResource(R.string.library_all_series), color = MaterialTheme.colorScheme.onSurface)
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
            columns = GridCells.Adaptive(minSize = 136.dp),
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
                            text = stringResource(R.string.library_possible_duplicate),
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

internal fun editionLabel(edition: SeriesEdition): String {
    val issue = edition.number
    return if (issue != null) {
        "#$issue"
    } else {
        edition.pub.title
    }
}
