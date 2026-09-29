package com.jrmello4.tactilereader.library

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.jrmello4.tactilereader.core.Pub

@Composable
fun LibraryScreen(
    viewModel: LibraryViewModel,
    onAddClick: () -> Unit,
    onOpenClick: (Pub) -> Unit,
    modifier: Modifier = Modifier,
    onAddFolderClick: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenBookmarks: () -> Unit = {},
    onOpenStats: () -> Unit = {},
    onOpenOpds: () -> Unit = {},
    folders: List<FolderEntry> = emptyList(),
    onRescan: () -> Unit = {},
) {
    val state by viewModel.state.collectAsState()
    val covers by viewModel.covers.collectAsState()
    LibraryContent(
        state = state,
        onAddClick = onAddClick,
        onOpenClick = onOpenClick,
        modifier = modifier,
        onAddFolderClick = onAddFolderClick,
        onOpenSettings = onOpenSettings,
        onOpenBookmarks = onOpenBookmarks,
        onOpenStats = onOpenStats,
        onOpenOpds = onOpenOpds,
        covers = covers,
        onCoverVisible = viewModel::requestCover,
        onToggleFavorite = viewModel::toggleFavorite,
        onDelete = viewModel::deletePublication,
        onSetRead = viewModel::setRead,
        onCancelImport = viewModel::cancelImport,
        onRetryImport = viewModel::retryFailedImports,
        onDismissImportReport = viewModel::dismissImportReport,
        folders = folders,
        onRescan = onRescan,
    )
}
