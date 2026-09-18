package com.jrmello4.tactilereader.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.pm.PackageInfoCompat
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.core.formatBytes
import com.jrmello4.tactilereader.scaffold.AppSources
import com.jrmello4.tactilereader.ui.theme.DarkGraphite750
import com.jrmello4.tactilereader.ui.theme.DarkGraphite800
import com.jrmello4.tactilereader.ui.theme.DarkGraphite900
import com.jrmello4.tactilereader.ui.theme.OxideRed
import com.jrmello4.tactilereader.ui.theme.Paper300
import com.jrmello4.tactilereader.ui.theme.Paper50
import com.jrmello4.tactilereader.ui.theme.Paper500
import com.jrmello4.tactilereader.ui.theme.SeamSubtle
import com.jrmello4.tactilereader.ui.theme.WarmAmber
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Ajustes do aplicativo em PT-BR no estilo Dark-First Editorial Workbench.
 * Seções estruturadas por temas, sem visual de card soup disperso:
 * Armazenamento & Cache, Backup Local, Servidores Remotos e Atualização do App.
 * Nenhum arquivo original é modificado; tudo estritamente local e sem nuvem.
 */
@Composable
fun SettingsScreen(
    filesDir: File,
    onBack: () -> Unit,
    onOpenOpds: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenBookmarks: () -> Unit = {},
    onOpenStats: () -> Unit = {},
    onImportBackup: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
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

    BackHandler(onBack = onBack)

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
                val file = UpdateDownloader.download(
                    apkUrl = apkUrl,
                    target = File(dir, name),
                    expectedSha256 = checked.expectedSha256,
                ) { read, total ->
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
            } catch (error: SecurityException) {
                updateState = checked.copy(
                    downloading = false,
                    progress = null,
                    message = "Segurança: ${error.message}",
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
        } catch (error: SecurityException) {
            updateState = updateState.copy(
                message = "Instalação bloqueada por segurança: ${error.message}",
            )
        } catch (error: Exception) {
            updateState = updateState.copy(
                message = "Não abri o instalador: ${error.message ?: "erro"}",
            )
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkGraphite900)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        // Top Bar Editorial
        Surface(
            color = DarkGraphite900,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onBack,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Voltar para a estante",
                        tint = Paper50,
                    )
                    Spacer(Modifier.width(4.dp))
                    Text("Estante", color = Paper50, style = MaterialTheme.typography.labelLarge)
                }
                Text(
                    "Ajustes",
                    style = MaterialTheme.typography.titleLarge,
                    color = Paper50,
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 4.dp)
                        .semantics { heading() },
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                "MESA EDITORIAL LOCAL · SEM CONTA · SEM NUVEM",
                style = MaterialTheme.typography.labelSmall.copy(
                    letterSpacing = 1.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = Paper500,
            )

            if (notice != null) {
                Text(
                    notice!!,
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                    color = WarmAmber,
                    modifier = Modifier
                        .padding(bottom = 4.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }

            // SEÇÃO: ARMAZENAMENTO & CACHE
            SettingsSection(title = "ARMAZENAMENTO & CACHE") {
                Text(
                    "Páginas renderizadas em cache temporário para aceleração de abertura.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Paper300,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    cacheText,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        color = Paper50,
                    ),
                )
                Spacer(Modifier.height(12.dp))
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
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DarkGraphite750,
                        contentColor = Paper50,
                    ),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, SeamSubtle),
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text("Limpar cache", style = MaterialTheme.typography.labelLarge)
                }
            }

            // SEÇÃO: BACKUP LOCAL
            SettingsSection(title = "BACKUP LOCAL") {
                Text(
                    "Exporta favoritos, progresso e marcadores em JSON no armazenamento deste aparelho.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Paper300,
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
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
                        colors = ButtonDefaults.buttonColors(
                            containerColor = DarkGraphite750,
                            contentColor = Paper50,
                        ),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, SeamSubtle),
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) {
                        Text("Exportar", style = MaterialTheme.typography.labelLarge)
                    }

                    Button(
                        onClick = onImportBackup,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = DarkGraphite750,
                            contentColor = Paper50,
                        ),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, SeamSubtle),
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) {
                        Text("Importar", style = MaterialTheme.typography.labelLarge)
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "O arquivo JSON fica exclusivamente neste aparelho; nada trafega para a nuvem.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Paper500,
                )
            }

            // SEÇÃO: SERVIDORES REMOTOS
            SettingsSection(title = "SERVIDORES REMOTOS") {
                Text(
                    "Conecte instâncias de OPDS, Komga ou Kavita para streaming e download offline.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Paper300,
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = onOpenOpds,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DarkGraphite750,
                        contentColor = Paper50,
                    ),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, SeamSubtle),
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text("Abrir servidores", style = MaterialTheme.typography.labelLarge)
                }
            }

            // SEÇÃO: ATUALIZAÇÃO DO APLICATIVO
            SettingsSection(title = "ATUALIZAÇÃO DO APLICATIVO") {
                Text(
                    "Canal rolling native-latest no GitHub. O pacote baixa neste dispositivo e instala via sistema operacional.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Paper300,
                )
                Spacer(Modifier.height(12.dp))

                if (updateState.checking) {
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp),
                        color = WarmAmber,
                        trackColor = DarkGraphite750,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                if (updateState.downloading) {
                    LinearProgressIndicator(
                        progress = { updateState.progress ?: 0f },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp),
                        color = WarmAmber,
                        trackColor = DarkGraphite750,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                if (updateState.message != null) {
                    Text(
                        updateState.message!!,
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                        color = WarmAmber,
                        modifier = Modifier.padding(bottom = 10.dp),
                    )
                }

                val downloaded = updateState.downloadedPath
                when {
                    updateState.downloading -> {
                        Button(
                            onClick = { downloadJob?.cancel() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = DarkGraphite750,
                                contentColor = OxideRed,
                            ),
                            shape = RoundedCornerShape(8.dp),
                            border = BorderStroke(1.dp, SeamSubtle),
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text("Cancelar download", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                    downloaded != null -> {
                        Text(
                            "Pacote pronto para instalação.",
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = Paper50,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { installDownloaded(downloaded) },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = WarmAmber,
                                    contentColor = DarkGraphite900,
                                ),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                            ) {
                                Text("Instalar agora", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
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
                                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                            ) {
                                Text("Verificar de novo", color = Paper300)
                            }
                        }
                    }
                    updateState.apkUrl != null -> {
                        Text(
                            "Disponível: ${updateState.version ?: "nova versão"}" +
                                updateState.apkSizeBytes?.let { " (${formatBytes(it)})" }.orEmpty(),
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = Paper50,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                        Button(
                            onClick = { startDownload(updateState) },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = WarmAmber,
                                contentColor = DarkGraphite900,
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text("Baixar atualização", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
                        }
                    }
                    else -> {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Button(
                                onClick = {
                                    scope.launch {
                                        updateState = updateState.copy(checking = true, message = null)
                                        updateState = withContext(Dispatchers.IO) {
                                            UpdateCheck.check(installedCode)
                                        }
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = DarkGraphite750,
                                    contentColor = Paper50,
                                ),
                                shape = RoundedCornerShape(8.dp),
                                border = BorderStroke(1.dp, SeamSubtle),
                                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                            ) {
                                Text("Verificar", style = MaterialTheme.typography.labelLarge)
                            }
                            if (updateState.version != null) {
                                Text(
                                    "Instalada: ${updateState.version}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Paper300,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "Arquivos originais nunca são alterados pelo app · Sem conta, sem nuvem",
                style = MaterialTheme.typography.labelSmall,
                color = Paper500,
                modifier = Modifier.padding(bottom = 16.dp),
            )
        }
    }
}

@Composable
private fun SettingsSection(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelSmall.copy(
                letterSpacing = 1.sp,
                fontWeight = FontWeight.Bold,
            ),
            color = Paper500,
            modifier = Modifier
                .padding(bottom = 8.dp)
                .semantics { heading() },
        )
        Card(
            colors = CardDefaults.cardColors(containerColor = DarkGraphite800),
            border = BorderStroke(1.dp, SeamSubtle),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
            ) {
                content()
            }
        }
    }
}

data class UpdateState(
    val checking: Boolean = false,
    val message: String? = null,
    val version: String? = null,
    val apkUrl: String? = null,
    val apkSizeBytes: Long? = null,
    val apkName: String? = null,
    val expectedSha256: String? = null,
    val downloading: Boolean = false,
    val progress: Float? = null,
    val downloadedPath: String? = null,
)
