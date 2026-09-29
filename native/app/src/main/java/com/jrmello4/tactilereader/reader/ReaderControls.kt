package com.jrmello4.tactilereader.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jrmello4.tactilereader.scaffold.R
import com.jrmello4.tactilereader.ui.theme.Paper300
import com.jrmello4.tactilereader.ui.theme.Paper50
import com.jrmello4.tactilereader.ui.theme.Paper500
import com.jrmello4.tactilereader.ui.theme.WarmAmber

@Composable
internal fun ReaderControls(
    title: String,
    zoom: Float,
    pageNumber: Int,
    pageCount: Int,
    bookmarkEnabled: Boolean,
    isBookmarked: Boolean,
    onBack: () -> Unit,
    onToggleZoom: () -> Unit,
    onToggleBookmark: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xF2101318))
                .statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = onBack,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = null,
                    tint = Paper50,
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    stringResource(R.string.reader_back_to_library),
                    color = Paper50,
                    style = MaterialTheme.typography.labelLarge,
                )
            }

            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = Paper50,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 4.dp),
            )

            val zoomDescription = stringResource(
                if (zoom > 1f) R.string.reader_zoom_restore else R.string.reader_zoom_enlarge,
            )
            val zoomStateDescription = stringResource(
                if (zoom > 1f) R.string.reader_zoomed else R.string.reader_zoom_normal,
            )
            TextButton(
                onClick = onToggleZoom,
                modifier = Modifier
                    .defaultMinSize(minHeight = 48.dp)
                    .semantics {
                        contentDescription = zoomDescription
                        stateDescription = zoomStateDescription
                    },
            ) {
                Text(
                    if (zoom > 1f) "1:1" else stringResource(R.string.reader_zoom),
                    color = if (zoom > 1f) WarmAmber else Paper50,
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                )
            }

            IconButton(
                onClick = onToggleBookmark,
                enabled = bookmarkEnabled,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
            ) {
                Icon(
                    Icons.Filled.Star,
                    contentDescription = stringResource(
                        if (isBookmarked) R.string.reader_remove_bookmark else R.string.reader_add_bookmark,
                    ),
                    tint = if (isBookmarked) WarmAmber else Paper500,
                )
            }
        }

        Box(Modifier.weight(1f))

        if (pageCount > 0) {
            val pagePosition = stringResource(R.string.reader_page_position, pageNumber, pageCount)
            val pageState = stringResource(R.string.reader_page_state, pageNumber, pageCount)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xF2101318))
                    .navigationBarsPadding()
                    .padding(12.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = pagePosition,
                    style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 0.5.sp),
                    color = Paper300,
                    modifier = Modifier.semantics { stateDescription = pageState },
                )
            }
        }
    }
}
