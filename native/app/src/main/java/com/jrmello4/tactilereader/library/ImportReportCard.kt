package com.jrmello4.tactilereader.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.scaffold.R

@Composable
internal fun ImportReportCard(
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
                    text = if (report.cancelled) {
                        stringResource(R.string.library_report_cancelled)
                    } else {
                        stringResource(R.string.library_report_result)
                    },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.semantics { heading() },
                )
                IconButton(onClick = onDismiss) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = stringResource(R.string.library_report_close),
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
            Text(
                text = stringResource(R.string.library_report_imported_count, report.imported) +
                    if (report.failed.isNotEmpty()) {
                        ", ${stringResource(R.string.library_report_failed_count, report.failed.size)}"
                    } else "",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (report.failed.isNotEmpty()) {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (fail in report.failed.take(5)) {
                        Text(
                            text = stringResource(
                                R.string.library_report_item_error,
                                fail.displayName,
                                fail.errorMessage ?: stringResource(R.string.common_error_capitalized),
                            ),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (report.failed.size > 5) {
                        Text(
                            text = stringResource(R.string.library_report_more_failures, report.failed.size - 5),
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
                        Text(stringResource(R.string.library_import_retry), color = MaterialTheme.colorScheme.onPrimary)
                    }
                }
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                ) {
                    Text(stringResource(R.string.library_report_dismiss), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
