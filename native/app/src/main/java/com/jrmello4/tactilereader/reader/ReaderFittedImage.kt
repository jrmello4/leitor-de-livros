package com.jrmello4.tactilereader.reader

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.jrmello4.tactilereader.core.ReaderPage
import java.io.File

@Composable
internal fun ReaderFittedImage(page: ReaderPage, file: File?, settings: ReaderSettings, modifier: Modifier, continuous: Boolean = false) {
    val ratio = if (page.width > 0 && page.height > 0) page.width.toFloat() / page.height else 2f / 3f
    val screenHeight = LocalConfiguration.current.screenHeightDp.dp
    val fit = if (settings.mode == ReaderMode.WEBTOON) FitMode.FIT_WIDTH else settings.fit
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val width = maxWidth
        val height = if (continuous) screenHeight else maxHeight
        val imageModifier = when {
            continuous && fit == FitMode.FIT_WIDTH -> Modifier.fillMaxWidth().aspectRatio(ratio)
            fit == FitMode.FIT_WIDTH -> Modifier.width(width).height(width / ratio)
            fit == FitMode.FIT_HEIGHT -> Modifier.width(height * ratio).height(height)
            else -> Modifier.width(width).height(height)
        }
        val scrollModifier = when (fit) {
            FitMode.FIT_WIDTH -> if (continuous) Modifier else Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            FitMode.FIT_HEIGHT -> Modifier.height(height).horizontalScroll(rememberScrollState())
            FitMode.FIT_SCREEN -> Modifier
        }
        Box(scrollModifier, contentAlignment = Alignment.Center) {
            Box(imageModifier.semantics(mergeDescendants = true) { contentDescription = "Página ${page.index + 1}" }, contentAlignment = Alignment.Center) {
                if (file == null) {
                    CircularProgressIndicator(Modifier.size(24.dp), color = if (settings.background == ReaderBackground.WHITE)
                        androidx.compose.ui.graphics.Color.DarkGray else MaterialTheme.colorScheme.primary)
                } else {
                    AsyncImage(
                        model = ImageRequest.Builder(LocalContext.current).data(file).size(1080)
                            .memoryCacheKey("page-${page.id}").build(),
                        contentDescription = "Página ${page.index + 1}",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }
}
