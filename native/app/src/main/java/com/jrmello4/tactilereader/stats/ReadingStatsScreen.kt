package com.jrmello4.tactilereader.stats

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.core.OverallReadingStats
import com.jrmello4.tactilereader.core.PublicationReadingStat
import com.jrmello4.tactilereader.core.ReadingStatus
import com.jrmello4.tactilereader.core.ReadingMetrics
import com.jrmello4.tactilereader.scaffold.AppSources
import com.jrmello4.tactilereader.scaffold.R
import com.jrmello4.tactilereader.ui.theme.DarkGraphite750
import com.jrmello4.tactilereader.ui.theme.DarkGraphite800
import com.jrmello4.tactilereader.ui.theme.DarkGraphite850
import com.jrmello4.tactilereader.ui.theme.DarkGraphite900
import com.jrmello4.tactilereader.ui.theme.EditorialIcons
import com.jrmello4.tactilereader.ui.theme.Paper300
import com.jrmello4.tactilereader.ui.theme.Paper50
import com.jrmello4.tactilereader.ui.theme.Paper500
import com.jrmello4.tactilereader.ui.theme.SageGreen
import com.jrmello4.tactilereader.ui.theme.SeamSubtle
import com.jrmello4.tactilereader.ui.theme.WarmAmber
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

/**
 * Tela Minha Leitura: apresenta estatísticas editoriais e métricas locais de leitura,
 * calculadas no dispositivo com respeito à privacidade e tempo do leitor (Calm Tech).
 * Design Dark-First Editorial Workbench com números tabulares e acabamento refinado.
 */
@Composable
fun ReadingStatsScreen(
    filesDir: File,
    onBack: () -> Unit,
    onOpenPub: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val db = remember(filesDir) {
        LibraryDb.open(File(filesDir, "lib"), File(filesDir, "imports"), AppSources.opener)
    }
    val scope = rememberCoroutineScope()
    var stats by remember { mutableStateOf<OverallReadingStats?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        scope.launch {
            val loaded = withContext(Dispatchers.IO) { db.loadOverallReadingStats() }
            stats = loaded
            loading = false
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkGraphite900)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        // Top Bar Editorial
        Surface(
            color = DarkGraphite900,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onBack,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = stringResource(R.string.settings_back_to_shelf),
                        tint = Paper50,
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.navigation_shelf), color = Paper50, style = MaterialTheme.typography.labelLarge)
                }
                Text(
                    text = stringResource(R.string.reading_stats_title),
                    style = MaterialTheme.typography.titleLarge,
                    color = Paper50,
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 4.dp)
                        .semantics { heading() },
                )
            }
        }

        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.reading_stats_loading),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Paper300,
                )
            }
            stats == null || (stats!!.totalMillis <= 0L && stats!!.totalPagesRead <= 0) -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = DarkGraphite800),
                        border = BorderStroke(1.dp, SeamSubtle),
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                        ) {
                            Icon(
                                imageVector = EditorialIcons.Metrics,
                                contentDescription = null,
                                tint = WarmAmber,
                                modifier = Modifier.defaultMinSize(minWidth = 36.dp, minHeight = 36.dp),
                            )
                            Spacer(Modifier.height(16.dp))
                            Text(
                                stringResource(R.string.reading_stats_empty_title),
                                style = MaterialTheme.typography.titleMedium,
                                color = Paper50,
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                stringResource(R.string.reading_stats_empty_description),
                                style = MaterialTheme.typography.bodySmall,
                                color = Paper300,
                            )
                        }
                    }
                }
            }
            else -> {
                val currentStats = stats!!
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    item {
                        // Painel resumo geral editorial
                        Column(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                stringResource(R.string.reading_stats_overview_heading),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    letterSpacing = 1.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                                color = Paper500,
                                modifier = Modifier
                                    .padding(bottom = 8.dp)
                                    .semantics { heading() },
                            )

                            Card(
                                colors = CardDefaults.cardColors(containerColor = DarkGraphite800),
                                border = BorderStroke(1.dp, SeamSubtle),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(20.dp),
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(24.dp),
                                    ) {
                                        StatItem(stringResource(R.string.reading_stats_total_time), formatDuration(currentStats.totalMillis))
                                        StatItem(stringResource(R.string.reading_stats_pages_read), "${currentStats.totalPagesRead}")
                                        StatItem(stringResource(R.string.reading_stats_sessions), "${currentStats.totalSessions}")
                                        if (currentStats.averagePpm > 0.0) {
                                            StatItem(
                                                stringResource(R.string.reading_stats_average_pace),
                                                stringResource(
                                                    R.string.reading_stats_pace_value,
                                                    String.format(Locale.US, "%.1f", currentStats.averagePpm),
                                                ),
                                            )
                                        }
                                    }

                                    Spacer(Modifier.height(16.dp))
                                    Text(
                                        text = stringResource(R.string.reading_stats_local_metrics),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Paper500,
                                    )
                                }
                            }
                        }
                    }

                    if (currentStats.publications.isNotEmpty()) {
                        item {
                            Text(
                                stringResource(R.string.reading_stats_history_heading),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    letterSpacing = 1.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                                color = Paper500,
                                modifier = Modifier
                                    .padding(top = 8.dp)
                                    .semantics { heading() },
                            )
                        }
                        items(currentStats.publications, key = { it.id }) { pub ->
                            PubStatCard(pub = pub, onOpen = { onOpenPub(pub.id) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatItem(label: String, value: String) {
    Column {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = FontWeight.Bold,
                color = WarmAmber,
            ),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = Paper300,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@Composable
private fun PubStatCard(
    pub: PublicationReadingStat,
    onOpen: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = DarkGraphite800),
        border = BorderStroke(1.dp, SeamSubtle),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            Text(
                text = pub.title,
                style = MaterialTheme.typography.titleMedium,
                color = Paper50,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            val remainingPages = ((1.0 - pub.progress.coerceIn(0.0, 1.0)) * pub.pageCount).toInt()
            val remainingText = if (pub.pagesPerMinute != null && remainingPages > 0) {
                val mins = ReadingMetrics.estimateRemainingMinutes(remainingPages, pub.pagesPerMinute)
                when {
                    mins == null -> ""
                    mins <= 0 -> stringResource(R.string.reading_stats_complete_suffix)
                    else -> stringResource(R.string.reading_stats_remaining_suffix, mins)
                }
            } else ""
            val paceText = if (pub.pagesPerMinute != null) {
                stringResource(
                    R.string.reading_stats_pace_suffix,
                    String.format(Locale.US, "%.1f", pub.pagesPerMinute),
                )
            } else ""

            Text(
                text = stringResource(
                    R.string.reading_stats_publication_summary,
                    pub.pagesRead,
                    formatDuration(pub.totalMillis),
                ) + paceText + remainingText,
                style = MaterialTheme.typography.bodySmall,
                color = Paper300,
                modifier = Modifier.padding(top = 4.dp),
            )

            val isComplete = pub.readingStatus == ReadingStatus.FINISHED
            LinearProgressIndicator(
                progress = { pub.progress.toFloat().coerceIn(0f, 1f) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 10.dp)
                    .height(4.dp),
                color = if (isComplete) SageGreen else WarmAmber,
                trackColor = DarkGraphite750,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                Button(
                    onClick = onOpen,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DarkGraphite750,
                        contentColor = Paper50,
                    ),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, SeamSubtle),
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text(stringResource(R.string.library_continue_reading), style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

@Composable
private fun formatDuration(millis: Long): String {
    val totalSeconds = (millis / 1000).coerceAtLeast(0)
    val totalMinutes = totalSeconds / 60
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    return when {
        hours > 0 && minutes > 0 -> stringResource(R.string.reading_stats_duration_hours_minutes, hours, minutes)
        hours > 0 -> stringResource(R.string.reading_stats_duration_hours, hours)
        minutes > 0 -> stringResource(R.string.reading_stats_duration_minutes, minutes)
        else -> stringResource(R.string.reading_stats_duration_under_minute)
    }
}
