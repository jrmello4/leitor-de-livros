package com.jrmello4.tactilereader.scaffold

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.ui.theme.EditorialIcons

@Composable
internal fun MainNavigationBar(
    selectedScreen: String,
    onNavigate: (String) -> Unit,
) {
    val itemColors = NavigationBarItemDefaults.colors(
        selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
        selectedTextColor = MaterialTheme.colorScheme.primary,
        indicatorColor = MaterialTheme.colorScheme.primaryContainer,
        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = 2.dp,
    ) {
        NavigationBarItem(
            selected = selectedScreen == "library",
            onClick = { onNavigate("library") },
            icon = { Icon(EditorialIcons.Book, contentDescription = stringResource(R.string.navigation_shelf)) },
            label = { androidx.compose.material3.Text(stringResource(R.string.navigation_shelf)) },
            colors = itemColors,
        )
        NavigationBarItem(
            selected = selectedScreen == "bookmarks",
            onClick = { onNavigate("bookmarks") },
            icon = { Icon(EditorialIcons.Bookmark, contentDescription = stringResource(R.string.navigation_bookmarks)) },
            label = { androidx.compose.material3.Text(stringResource(R.string.navigation_bookmarks)) },
            colors = itemColors,
        )
        NavigationBarItem(
            selected = selectedScreen == "stats",
            onClick = { onNavigate("stats") },
            icon = { Icon(EditorialIcons.Metrics, contentDescription = stringResource(R.string.navigation_reading)) },
            label = { androidx.compose.material3.Text(stringResource(R.string.navigation_reading)) },
            colors = itemColors,
        )
        NavigationBarItem(
            selected = selectedScreen == "settings",
            onClick = { onNavigate("settings") },
            icon = { Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.navigation_settings)) },
            label = { androidx.compose.material3.Text(stringResource(R.string.navigation_settings)) },
            colors = itemColors,
        )
    }
}
