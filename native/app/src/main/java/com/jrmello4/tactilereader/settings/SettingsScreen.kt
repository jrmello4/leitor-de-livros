package com.jrmello4.tactilereader.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.scaffold.AppSources
import com.jrmello4.tactilereader.core.formatBytes
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Ajustes em PT-BR: backup local (sem nuvem), cache derivado e atualização
 * do app pela release rolling `native-latest`. Tudo melhor-esforço e com
 * mensagens claras; nenhum original é tocado aqui.
 */
@Composable
fun SettingsScreen(
    filesDir: File,
    onBack: () -> Unit,
    onOpenOpds: () -> Unit,
    onImportBackup: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    // Nada de abrir SQLite na composição: o banco nasce dentro de IO.
    val dbProvider: () -> LibraryDb = remember(filesDir) {
        { LibraryDb.open(File(filesDir, "lib"), File(filesDir, "imports"), AppSources.opener) }
    }
    var notice by remember { mutableStateOf<String?>(null) }
    var cacheText by remember { mutableStateOf("Consultando cache…") }
    var updateState by remember { mutableStateOf(UpdateState()) }

    LaunchedEffect(filesDir) {
        cacheText = withContext(Dispatchers.IO) {
            try {
                val info = dbProvider().cacheInfo()
                "Cache: ${formatBytes(info.usedBytes)} em ${info.entryCount} páginas"
            } catch (error: Exception) {
                "Cache indisponível: ${error.message ?: "erro"}"
            }
        }
    }

    androidx.activity.compose.BackHandler(onBack = onBack)

    Column(modifier = modifier.fillMaxSize().background(Color(0xFF0D1117)).padding(18.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) { Text("‹ Estante", color = Color.White) }
            Text(
                "Ajustes",
                style = MaterialTheme.typography.titleLarge,
                color = Color(0xFFF7F2E8),
                modifier = Modifier.weight(1f).padding(start = 4.dp),
            )
        }
        Text(
            "EDIÇÃO LOCAL PARA ANDROID · sem conta, sem nuvem",
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFFC8C0B3),
            modifier = Modifier.padding(bottom = 12.dp),
        )
        if (notice != null) {
            Text(
                notice!!,
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFFF2A900),
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23))) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Backup local", color = Color(0xFFF7F2E8))
                Text(
                    "Exporta favoritos, progresso e marcadores em JSON neste aparelho.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            scope.launch {
                                notice = withContext(Dispatchers.IO) {
                                    try {
                                        val target = BackupManager.defaultExportFile(filesDir)
                                        BackupManager.export(dbProvider(), target)
                                        "Backup salvo em ${target.name}."
                                    } catch (error: Exception) {
                                        "Falha no backup: ${error.message ?: "erro"}"
                                    }
                                }
                            }
                        },
                    ) { Text("Exportar", color = Color.White) }
                    Button(onClick = onImportBackup) { Text("Importar", color = Color.White) }
                }
                Text(
                    "O JSON fica neste aparelho; nada vai para a nuvem.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23)),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Cache derivado", color = Color(0xFFF7F2E8))
                Text(
                    cacheText,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                Button(
                    onClick = {
                        scope.launch {
                            notice = withContext(Dispatchers.IO) {
                                try {
                                    dbProvider().clearCache()
                                    cacheText = "Cache: 0 B em 0 páginas"
                                    "Cache limpo. As páginas reconstroem ao abrir."
                                } catch (error: Exception) {
                                    "Falha ao limpar: ${error.message ?: "erro"}"
                                }
                            }
                        }
                    },
                ) { Text("Limpar cache", color = Color.White) }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23)),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Servidores (OPDS / Komga / Kavita)", color = Color(0xFFF7F2E8))
                Text(
                    "Streaming sob demanda e download offline dos seus servidores.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                Button(onClick = onOpenOpds) { Text("Abrir servidores", color = Color.White) }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23)),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Atualização do app", color = Color(0xFFF7F2E8))
                Text(
                    "Canal rolling native-latest no GitHub. A instalação usa o instalador do sistema.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                if (updateState.checking) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                if (updateState.message != null) {
                    Text(
                        updateState.message!!,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFFF2A900),
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            scope.launch {
                                updateState = updateState.copy(checking = true, message = null)
                                updateState = withContext(Dispatchers.IO) {
                                    UpdateChecker.check()
                                }
                            }
                        },
                    ) { Text("Verificar", color = Color.White) }
                }
                if (updateState.version != null) {
                    Text(
                        "Disponível: ${updateState.version}",
                        color = Color(0xFFF7F2E8),
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
        Box(Modifier.weight(1f))
        Text(
            "Arquivos originais nunca são alterados pelo app.",
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFFC8C0B3),
        )
    }
}

data class UpdateState(
    val checking: Boolean = false,
    val message: String? = null,
    val version: String? = null,
    val url: String? = null,
)

/** Consulta a rolling `native-latest`; sem telemetria, só HTTPS ao GitHub. */
object UpdateChecker {
    private const val API = "https://api.github.com/repos/jrmello4/leitor-de-livros/releases/tags/native-latest"
    private const val PAGE = "https://github.com/jrmello4/leitor-de-livros/releases/tag/native-latest"

    fun check(): UpdateState {
        return try {
            val connection = java.net.URL(API).openConnection() as java.net.HttpURLConnection
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.setRequestProperty("Accept", "application/vnd.github+json")
            if (connection.responseCode != 200) {
                return UpdateState(message = "Sem resposta do GitHub (${connection.responseCode}). Tente de novo.")
            }
            val body = connection.inputStream.bufferedReader().readText()
            val root = org.json.JSONObject(body)
            val name = root.optString("name", "native-latest")
            UpdateState(
                version = name.ifBlank { "native-latest" },
                url = PAGE,
                message = "Abra a página da release para baixar o APK.",
            )
        } catch (error: Exception) {
            UpdateState(message = "Falha ao verificar: ${error.message ?: "sem rede"}")
        }
    }
}
