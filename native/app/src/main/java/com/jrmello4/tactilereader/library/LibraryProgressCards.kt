package com.jrmello4.tactilereader.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import com.jrmello4.tactilereader.core.ReadingMetrics
import com.jrmello4.tactilereader.scaffold.R
import java.io.File
import kotlin.math.roundToInt

/** Texto de progresso para a retomada: páginas são a unidade honesta para HQs. */
@Composable
internal fun readingProgressSummary(pub: Pub): String {
    if (pub.pageCount <= 0) return stringResource(R.string.library_no_pages_available)
    val currentPage = (pub.progress.coerceIn(0.0, 1.0) * pub.pageCount)
        .roundToInt()
        .coerceIn(1, pub.pageCount)
    val remaining = (pub.pageCount - currentPage).coerceAtLeast(0)
    val pageText = stringResource(R.string.library_page_progress, currentPage, pub.pageCount)
    val estimatedMinutes = pub.readingPagesPerMinute?.let {
        ReadingMetrics.estimateRemainingMinutes(remaining, it)
    }
    if (estimatedMinutes != null) {
        val timeText = if (currentPage >= pub.pageCount || estimatedMinutes <= 0) {
            stringResource(R.string.library_progress_complete)
        } else {
            stringResource(R.string.library_progress_remaining_time, estimatedMinutes)
        }
        return stringResource(R.string.library_progress_summary, pageText, timeText)
    }
    return if (remaining == 0) {
        stringResource(R.string.library_progress_last_page, pageText)
    } else {
        stringResource(R.string.library_progress_remaining_pages, pageText, remaining)
    }
}

@Composable
internal fun ContinueHeroCard(
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
                            stringResource(R.string.library_resume),
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
