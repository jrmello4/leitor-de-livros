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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReaderSettingsSheet(settings: ReaderSettings, onChange: (ReaderSettings) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp)) {
            Text("Configurações de leitura", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            Choices("Modo", settings.mode, listOf(
                ReaderMode.SINGLE_PAGE to "Página única", ReaderMode.DOUBLE_PAGE to "Página dupla",
                ReaderMode.VERTICAL to "Vertical", ReaderMode.WEBTOON to "Webtoon",
            )) { onChange(settings.copy(mode = it)) }
            Choices("Direção", settings.direction, listOf(
                ReadingDirection.LEFT_TO_RIGHT to "Esquerda → direita", ReadingDirection.RIGHT_TO_LEFT to "Direita → esquerda",
            )) { onChange(settings.copy(direction = it)) }
            Text("Em RTL, a sequência começa na última página do arquivo.", style = MaterialTheme.typography.bodySmall)
            Choices("Ajuste", settings.fit, listOf(
                FitMode.FIT_SCREEN to "Ajustar à tela", FitMode.FIT_WIDTH to "Ajustar à largura", FitMode.FIT_HEIGHT to "Ajustar à altura",
            ), enabled = settings.mode != ReaderMode.WEBTOON) { onChange(settings.copy(fit = it)) }
            if (settings.mode == ReaderMode.WEBTOON) Text("Webtoon sempre ajusta à largura.", style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Exibir capa separadamente", Modifier.weight(1f))
                Switch(settings.coverAlone, { onChange(settings.copy(coverAlone = it)) }, enabled = settings.mode == ReaderMode.DOUBLE_PAGE,
                    modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Exibir capa separadamente" })
            }
            Choices("Orientação", settings.orientation, listOf(
                ReaderOrientation.SYSTEM to "Sistema", ReaderOrientation.PORTRAIT to "Retrato", ReaderOrientation.LANDSCAPE to "Paisagem",
            )) { onChange(settings.copy(orientation = it)) }
            Choices("Fundo", settings.background, listOf(
                ReaderBackground.BLACK to "Preto", ReaderBackground.GRAY to "Cinza escuro", ReaderBackground.WHITE to "Branco",
            )) { onChange(settings.copy(background = it)) }
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Manter tela ligada", Modifier.weight(1f))
                Switch(settings.keepScreenOn, { onChange(settings.copy(keepScreenOn = it)) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Manter tela ligada" })
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Concluir") }
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
