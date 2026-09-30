package com.jrmello4.tactilereader.reader

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.jrmello4.tactilereader.scaffold.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReaderSettingsSheet(settings: ReaderSettings, onChange: (ReaderSettings) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp)) {
            Text(stringResource(R.string.reader_settings_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            Choices(stringResource(R.string.reader_mode_title), settings.mode, listOf(
                ReaderMode.SINGLE_PAGE to stringResource(R.string.reader_mode_single_page), ReaderMode.DOUBLE_PAGE to stringResource(R.string.reader_mode_double_page),
                ReaderMode.VERTICAL to stringResource(R.string.reader_mode_vertical), ReaderMode.WEBTOON to stringResource(R.string.reader_mode_webtoon),
            )) { onChange(settings.copy(mode = it)) }
            Choices(stringResource(R.string.reader_direction_title), settings.direction, listOf(
                ReadingDirection.LEFT_TO_RIGHT to stringResource(R.string.reader_direction_ltr), ReadingDirection.RIGHT_TO_LEFT to stringResource(R.string.reader_direction_rtl),
            )) { onChange(settings.copy(direction = it)) }
            Text(stringResource(R.string.reader_direction_rtl_file_order), style = MaterialTheme.typography.bodySmall)
            Choices(stringResource(R.string.reader_fit_title), settings.fit, listOf(
                FitMode.FIT_SCREEN to stringResource(R.string.reader_fit_screen), FitMode.FIT_WIDTH to stringResource(R.string.reader_fit_width), FitMode.FIT_HEIGHT to stringResource(R.string.reader_fit_height),
            ), enabled = settings.mode != ReaderMode.WEBTOON) { onChange(settings.copy(fit = it)) }
            if (settings.mode == ReaderMode.WEBTOON) Text(stringResource(R.string.reader_webtoon_fit_width), style = MaterialTheme.typography.bodySmall)
            val coverLabel = stringResource(R.string.reader_cover_alone)
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(coverLabel, Modifier.weight(1f))
                Switch(settings.coverAlone, { onChange(settings.copy(coverAlone = it)) }, enabled = settings.mode == ReaderMode.DOUBLE_PAGE,
                    modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = coverLabel })
            }
            Choices(stringResource(R.string.reader_orientation_title), settings.orientation, listOf(
                ReaderOrientation.SYSTEM to stringResource(R.string.reader_orientation_system), ReaderOrientation.PORTRAIT to stringResource(R.string.reader_orientation_portrait), ReaderOrientation.LANDSCAPE to stringResource(R.string.reader_orientation_landscape),
            )) { onChange(settings.copy(orientation = it)) }
            Choices(stringResource(R.string.reader_background_title), settings.background, listOf(
                ReaderBackground.BLACK to stringResource(R.string.reader_background_black), ReaderBackground.GRAY to stringResource(R.string.reader_background_gray), ReaderBackground.WHITE to stringResource(R.string.reader_background_white),
            )) { onChange(settings.copy(background = it)) }
            val keepScreenLabel = stringResource(R.string.reader_keep_screen_on)
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(keepScreenLabel, Modifier.weight(1f))
                Switch(settings.keepScreenOn, { onChange(settings.copy(keepScreenOn = it)) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = keepScreenLabel })
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.reader_settings_done)) }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun <T> Choices(title: String, selected: T, choices: List<Pair<T, String>>, enabled: Boolean = true, onSelect: (T) -> Unit) {
    Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp).semantics { heading() })
    choices.forEach { (value, label) ->
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected == value, enabled = enabled, role = Role.RadioButton) { onSelect(value) },
            verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected == value, onClick = null, enabled = enabled)
            Text(label, Modifier.padding(start = 12.dp), color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
