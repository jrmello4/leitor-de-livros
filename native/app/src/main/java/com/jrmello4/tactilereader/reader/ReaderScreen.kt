package com.jrmello4.tactilereader.reader

import androidx.activity.compose.BackHandler
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier

@Composable
fun ReaderScreen(
    viewModel: ReaderViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    nextTitle: String? = null,
    onBingeOpenNext: () -> Unit = {},
) {
    val state by viewModel.state.collectAsState()
    val paths by viewModel.paths.collectAsState()
    val bookmarks by viewModel.bookmarks.collectAsState()
    val finishAndBack = {
        viewModel.finishSession()
        onBack()
    }
    BackHandler(onBack = finishAndBack)
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(viewModel, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> viewModel.resumeSession()
                Lifecycle.Event.ON_STOP -> viewModel.pauseSession()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            viewModel.finishSession()
        }
    }
    ReaderContent(
        state = state,
        onBack = finishAndBack,
        modifier = modifier,
        paths = paths,
        onPageVisible = viewModel::requestPage,
        onProgress = viewModel::saveProgress,
        bookmarks = bookmarks,
        onToggleBookmark = viewModel::toggleBookmark,
        nextTitle = nextTitle,
        onBingeOpenNext = onBingeOpenNext,
    )
}
