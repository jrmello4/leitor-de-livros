package com.jrmello4.tactilereader.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.core.Pub
import com.jrmello4.tactilereader.scaffold.R
import java.io.File

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun PubCard(
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
                        Icon(Icons.Filled.Check, contentDescription = stringResource(R.string.library_selected), tint = MaterialTheme.colorScheme.primary)
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
                            contentDescription = stringResource(
                                if (pub.isFavorite) R.string.library_remove_favorite else R.string.library_add_favorite,
                            ),
                            tint = if (pub.isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    text = stringResource(R.string.library_page_count, pub.pageCount),
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
                        Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.library_options), tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
                            Text(stringResource(R.string.library_mark_as_read), color = MaterialTheme.colorScheme.onSurface)
                        }
                        TextButton(onClick = { onSetRead(pub, false); menu = false }, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.library_clear_progress), color = MaterialTheme.colorScheme.onSurface)
                        }
                        TextButton(onClick = { onRequestDelete(pub.id); menu = false }, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.library_remove_publication), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }
}
