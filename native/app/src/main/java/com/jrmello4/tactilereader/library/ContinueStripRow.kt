package com.jrmello4.tactilereader.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.core.Pub
import java.io.File

@Composable
internal fun ContinueStripRow(
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
