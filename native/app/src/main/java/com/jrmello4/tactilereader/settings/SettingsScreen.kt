package com.jrmello4.tactilereader.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.pm.PackageInfoCompat
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.scaffold.AppSources
import com.jrmello4.tactilereader.core.formatBytes
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
    onOpenBookmarks: () -> Unit = {},
    onOpenStats: () -> Unit = {},
    onImportBackup: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    // Código instalado para comparar com o da rolling (0 = desconhecido).
    val installedCode = remember(context) {
        try {
            @Suppress("DEPRECATION")
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            PackageInfoCompat.getLongVersionCode(info).toInt()
        } catch (_: Exception) {
            0
        }
    }
    var downloadJob by remember { mutableStateOf<Job?>(null) }
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

    fun startDownload(checked: UpdateState) {
        val apkUrl = checked.apkUrl ?: return
        val name = safeApkName(checked.apkName ?: "update.apk")
        downloadJob?.cancel()
        downloadJob = scope.launch {
            updateState = checked.copy(
                downloading = true,
                progress = 0f,
                message = "Baixando…",
                downloadedPath = null,
            )
            try {
                val dir = File(filesDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val file = UpdateDownloader.download(apkUrl, File(dir, name)) { read, total ->
                    val fraction = total?.let { (read.toFloat() / it).coerceIn(0f, 1f) }
                    val detail = if (total != null) {
                        "${formatBytes(read)} de ${formatBytes(total)}"
                    } else {
                        formatBytes(read)
                    }
                    updateState = updateState.copy(progress = fraction, message = "Baixando… $detail")
                }
                updateState = updateState.copy(
                    downloading = false,
                    progress = null,
                    downloadedPath = file.absolutePath,
                    message = "Baixado: $name. Toque em Instalar e confirme no sistema.",
                )
            } catch (cancelled: CancellationException) {
                updateState = checked.copy(
                    downloading = false,
                    progress = null,
                    message = "Download cancelado.",
                )
            } catch (error: Exception) {
                updateState = checked.copy(
                    downloading = false,
                    progress = null,
                    message = "Falha no download: ${error.message ?: "erro"}",
                )
            } finally {
                downloadJob = null
            }
        }
    }

    fun installDownloaded(path: String) {
        val apk = File(path)
        if (!apk.exists()) {
            updateState = updateState.copy(
                downloadedPath = null,
                message = "O arquivo sumiu do aparelho. Baixe de novo.",
            )
            return
        }
        try {
            context.startActivity(UpdateInstaller.installIntent(context, apk))
        } catch (error: Exception) {
            updateState = updateState.copy(
                message = "Não abri o instalador: ${error.message ?: "erro"}",
            )
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .background(MaterialTheme.colorScheme.background)
            .padding(18.dp)
            .navigationBarsPadding(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
                Text("Estante", color = MaterialTheme.colorScheme.onSurface)
            }
            Text(
                "Ajustes",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 4.dp)
                    .semantics { heading() },
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
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier
                    .padding(bottom = 8.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Backup local", color = MaterialTheme.colorScheme.onSurface)
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
                    ) { Text("Exportar", color = MaterialTheme.colorScheme.onPrimary) }
                    Button(onClick = onImportBackup) { Text("Importar", color = MaterialTheme.colorScheme.onPrimary) }
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
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Cache derivado", color = MaterialTheme.colorScheme.onSurface)
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
                ) { Text("Limpar cache", color = MaterialTheme.colorScheme.onPrimary) }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Minha leitura", color = MaterialTheme.colorScheme.onSurface)
                Text(
                    "Tempo total, páginas avançadas, velocidade média e estimativas locais de leitura.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                Button(
                    onClick = onOpenStats,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) { Text("Ver estatísticas", color = MaterialTheme.colorScheme.onPrimary) }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Central de marcadores", color = MaterialTheme.colorScheme.onSurface)
                Text(
                    "Consulte todas as páginas marcadas nas suas HQs e gerencie seus pontos salvos.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                Button(
                    onClick = onOpenBookmarks,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) { Text("Abrir marcadores", color = MaterialTheme.colorScheme.onPrimary) }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Servidores (OPDS / Komga / Kavita)", color = MaterialTheme.colorScheme.onSurface)
                Text(
                    "Streaming sob demanda e download offline dos seus servidores.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                Button(
                    onClick = onOpenOpds,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) { Text("Abrir servidores", color = MaterialTheme.colorScheme.onPrimary) }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Text("Atualização do app", color = MaterialTheme.colorScheme.onSurface)
                Text(
                    "Canal rolling native-latest no GitHub. O APK baixa neste aparelho e a instalação usa o instalador do sistema.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                if (updateState.checking) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                if (updateState.downloading) {
                    LinearProgressIndicator(
                        progress = { updateState.progress ?: 0f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (updateState.message != null) {
                    Text(
                        updateState.message!!,
                        style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                val downloaded = updateState.downloadedPath
                when {
                    updateState.downloading -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { downloadJob?.cancel() }) {
                                Text("Cancelar", color = MaterialTheme.colorScheme.onPrimary)
                            }
                        }
                    }
                    downloaded != null -> {
                        Text(
                            "Pronto para instalar.",
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { installDownloaded(downloaded) }) {
                            Text("Instalar agora", color = MaterialTheme.colorScheme.onPrimary)
                            }
                            TextButton(
                                onClick = {
                                    scope.launch {
                                        updateState = updateState.copy(checking = true, message = null)
                                        updateState = withContext(Dispatchers.IO) {
                                            UpdateCheck.check(installedCode)
                                        }
                                    }
                                },
                            ) { Text("Verificar de novo", color = MaterialTheme.colorScheme.onSurface) }
                        }
                    }
                    updateState.apkUrl != null -> {
                        Text(
                            "Disponível: ${updateState.version ?: "nova versão"}" +
                                updateState.apkSizeBytes?.let { " (${formatBytes(it)})" }.orEmpty(),
                            color = Color(0xFFF7F2E8),
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { startDownload(updateState) }) {
                        Text("Baixar atualização", color = MaterialTheme.colorScheme.onPrimary)
                            }
                        }
                    }
                    else -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = {
                                    scope.launch {
                                        updateState = updateState.copy(checking = true, message = null)
                                        updateState = withContext(Dispatchers.IO) {
                                            UpdateCheck.check(installedCode)
                                        }
                                    }
                                },
                    ) { Text("Verificar", color = MaterialTheme.colorScheme.onPrimary) }
                        }
                        if (updateState.version != null) {
                            Text(
                                "Instalada: ${updateState.version}",
                                color = Color(0xFFF7F2E8),
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                    }
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
    val apkUrl: String? = null,
    val apkSizeBytes: Long? = null,
    val apkName: String? = null,
    val downloading: Boolean = false,
    val progress: Float? = null,
    val downloadedPath: String? = null,
)
