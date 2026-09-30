package com.jrmello4.tactilereader.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.jrmello4.tactilereader.scaffold.R
import com.jrmello4.tactilereader.core.ReaderPage
import com.jrmello4.tactilereader.ui.theme.DarkGraphite750
import com.jrmello4.tactilereader.ui.theme.DarkGraphite950
import java.io.File

@Composable
internal fun DefaultPageImage(page: ReaderPage, file: File?, modifier: Modifier = Modifier) {
    val pageDescription = stringResource(R.string.reader_page_content_description, page.index + 1)
    val ratio = if (page.width > 0 && page.height > 0) {
        page.width.toFloat() / page.height
    } else {
        2f / 3f
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .background(DarkGraphite950)
            .semantics(mergeDescendants = true) {
                contentDescription = pageDescription
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = stringResource(R.string.reader_page_number, page.index + 1),
            style = MaterialTheme.typography.labelLarge,
            color = DarkGraphite750,
            modifier = Modifier.padding(48.dp).clearAndSetSemantics {},
        )
        if (file != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(file)
                    .size(1080)
                    .memoryCacheKey("page-${page.id}")
                    .crossfade(false)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
