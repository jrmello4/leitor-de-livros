package com.jrmello4.tactilereader.reader

import androidx.activity.compose.BackHandler
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import com.jrmello4.tactilereader.scaffold.R

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
    val context = LocalContext.current
    val activity = context.readerActivity()
    val store = remember(context) { ReaderSettingsStore(context) }
    var settings by remember { mutableStateOf(store.load()) }
    var anchor by remember(viewModel) { mutableStateOf<Pair<String, Double>?>(null) }
    var spreadProgress by remember(viewModel) { mutableStateOf<Pair<String, Double>?>(null) }
    var settingsError by remember { mutableStateOf<String?>(null) }
    var configuredDirection by remember(viewModel) { mutableStateOf<ReadingDirection?>(null) }
    // Closing a spread keeps its terminal-page progress; the navigation anchor can be either page.
    val exitPosition = if (settings.mode == ReaderMode.SINGLE_PAGE || settings.mode == ReaderMode.DOUBLE_PAGE) {
        spreadProgress ?: anchor
    } else anchor
    val currentExitPosition by rememberUpdatedState(exitPosition)
    LaunchedEffect(viewModel, settings.direction) {
        try {
            viewModel.configureDirection(settings.direction)
            configuredDirection = settings.direction
            settingsError = null
        } catch (error: Exception) { settingsError = error.message ?: context.getString(R.string.reader_direction_save_error) }
    }
    val finishAndBack = {
        exitPosition?.let { viewModel.saveProgress(it.first, it.second) }
        viewModel.finishSession()
        onBack()
    }
    BackHandler(onBack = finishAndBack)
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(viewModel, lifecycleOwner) {
        viewModel.resumeSession()
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> viewModel.resumeSession()
                Lifecycle.Event.ON_STOP -> { currentExitPosition?.let { viewModel.saveProgress(it.first, it.second) }; viewModel.pauseSession() }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            currentExitPosition?.let { viewModel.saveProgress(it.first, it.second) }
            if (activity?.isChangingConfigurations != true) viewModel.finishSession()
        }
    }
    ReaderContent(
        state = state.copy(startPageId = anchor?.first ?: state.startPageId, startRatio = anchor?.second ?: state.startRatio,
            loading = state.loading || (configuredDirection != settings.direction && settingsError == null),
            error = settingsError ?: state.error),
        onBack = finishAndBack,
        modifier = modifier,
        paths = paths,
        onPageVisible = viewModel::requestPage,
        onProgress = { id, ratio -> spreadProgress = id to ratio; viewModel.saveProgress(id, ratio) },
        onPositionChanged = { id, ratio -> anchor = id to ratio },
        settings = settings.copy(direction = state.direction),
        // Keep requested direction in the sheet while its database update is still pending.
        settingsForSheet = settings,
        onSettingsChange = { settings = it; store.save(it) },
        initialHudVisible = false,
        bookmarks = bookmarks,
        onToggleBookmark = viewModel::toggleBookmark,
        nextTitle = nextTitle,
        onBingeOpenNext = onBingeOpenNext,
        navigationKey = viewModel,
    )
}
