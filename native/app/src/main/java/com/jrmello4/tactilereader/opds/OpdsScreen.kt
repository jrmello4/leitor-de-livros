package com.jrmello4.tactilereader.opds

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Servidores OPDS / Komga / Kavita em PT-BR.
 * Cadastro múltiplo, navegação por feed, download offline com progresso e
 * cancelamento. O arquivo baixado vai para `imports/` e entra na estante
 * pelo núcleo — originais remotos nunca são alterados.
 */
@Composable
fun OpdsScreen(
    filesDir: File,
    onBack: () -> Unit,
    onDownloaded: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    androidx.activity.compose.BackHandler(onBack = onBack)
    var servers by remember { mutableStateOf(OpdsStore.list(context)) }
    var selectedId by remember { mutableStateOf(servers.firstOrNull()?.id) }
    var entries by remember { mutableStateOf<List<OpdsClient.Entry>>(emptyList()) }
    var trail by remember { mutableStateOf(listOf<String>()) }
    var notice by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Float?>(null) }
    var downloadJob by remember { mutableStateOf<Job?>(null) }
    var showForm by remember { mutableStateOf(servers.isEmpty()) }
    var formName by remember { mutableStateOf("") }
    var formUrl by remember { mutableStateOf("") }
    var formUser by remember { mutableStateOf("") }
    var formPass by remember { mutableStateOf("") }
    var formType by remember { mutableStateOf("opds") }

    val selected = servers.firstOrNull { it.id == selectedId }

    fun persist(next: List<OpdsServer>) {
        servers = next
        OpdsStore.save(context, next)
        if (selectedId == null || next.none { it.id == selectedId }) {
            selectedId = next.firstOrNull()?.id
        }
    }

    fun browse(feedUrl: String?, pushTrail: Boolean = true) {
        val server = selected ?: return
        scope.launch {
            loading = true
            notice = null
            try {
                val list = withContext(Dispatchers.IO) {
                    when {
                        server.type == "komga" && feedUrl == null -> OpdsClient.komgaSeries(server)
                        server.type == "komga" && feedUrl?.startsWith("komga:series:") == true ->
                            OpdsClient.komgaBooks(server, feedUrl.removePrefix("komga:series:"))
                        else -> OpdsClient.fetchFeed(server, feedUrl ?: server.url)
                    }
                }
                entries = list
                if (pushTrail && feedUrl != null) {
                    trail = trail + feedUrl
                }
                if (list.isEmpty()) {
                    notice = "Nada neste nível do catálogo."
                }
            } catch (error: Exception) {
                notice = "Falha no servidor: ${error.message ?: "erro"}"
            } finally {
                loading = false
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(18.dp)
            .navigationBarsPadding(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = onBack,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Voltar aos ajustes",
                    tint = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.width(4.dp))
                Text("Ajustes", color = MaterialTheme.colorScheme.onSurface)
            }
            Text(
                "Servidores",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 4.dp)
                    .semantics { heading() },
            )
            TextButton(
                onClick = { showForm = !showForm },
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
            ) {
                Text(
                    if (showForm) "Fechar" else "+ Servidor",
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        Text(
            "OPDS · Komga · Kavita (via OPDS) — só os seus servidores, sem telemetria.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
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
        if (showForm) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(formName, { formName = it }, label = { Text("Nome") }, singleLine = true)
                    OutlinedTextField(formUrl, { formUrl = it }, label = { Text("URL (https://…)") }, singleLine = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            formUser, { formUser = it }, label = { Text("Usuário") },
                            singleLine = true, modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            formPass, { formPass = it }, label = { Text("Senha") },
                            singleLine = true, modifier = Modifier.weight(1f),
                        )
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        for (type in listOf("opds", "komga", "kavita")) {
                            if (formType == type) {
                                Button(
                                    onClick = {},
                                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                ) { Text(type, color = MaterialTheme.colorScheme.onPrimary) }
                            } else {
                                TextButton(
                                    onClick = { formType = type },
                                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                ) { Text(type, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                    Button(
                        onClick = {
                            if (formName.isBlank() || formUrl.isBlank()) {
                                notice = "Dê um nome e a URL do servidor."
                                return@Button
                            }
                            persist(
                                servers + OpdsServer(
                                    name = formName.trim(),
                                    url = formUrl.trim(),
                                    user = formUser.trim(),
                                    pass = formPass,
                                    type = formType,
                                ),
                            )
                            formName = ""; formUrl = ""; formUser = ""; formPass = ""
                            showForm = false
                            entries = emptyList()
                            trail = emptyList()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = 48.dp),
                    ) { Text("Salvar", color = MaterialTheme.colorScheme.onPrimary) }
                }
            }
        }
        if (servers.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (server in servers) {
                    if (server.id == selectedId) {
                        Button(
                            onClick = {},
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) { Text(server.name, color = MaterialTheme.colorScheme.onPrimary) }
                    } else {
                        TextButton(
                            onClick = {
                                selectedId = server.id
                                entries = emptyList()
                                trail = emptyList()
                            },
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) { Text(server.name, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
            if (selected != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = { trail = emptyList(); browse(null, pushTrail = false) },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) {
                        Text("Abrir catálogo", color = MaterialTheme.colorScheme.onPrimary)
                    }
                    if (trail.isNotEmpty()) {
                        TextButton(
                            onClick = {
                                trail = trail.dropLast(1)
                                browse(trail.lastOrNull(), pushTrail = false)
                            },
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Voltar no catálogo",
                                tint = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(Modifier.width(4.dp))
                            Text("Voltar", color = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                    TextButton(
                        onClick = {
                            persist(servers.filterNot { it.id == selected.id })
                            entries = emptyList()
                            trail = emptyList()
                        },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) { Text("Remover", color = MaterialTheme.colorScheme.error) }
                }
                Text(
                    "Kavita: cadastre a URL OPDS dela (…/api/opds/…). Komga: cadastre a raiz e use o tipo komga.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        if (loading) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                color = MaterialTheme.colorScheme.secondary,
                trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.2f),
            )
        }
        if (progress != null) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LinearProgressIndicator(
                    progress = { progress ?: 0f },
                    modifier = Modifier
                        .weight(1f)
                        .padding(top = 8.dp),
                    color = MaterialTheme.colorScheme.secondary,
                    trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.2f),
                )
                TextButton(
                    onClick = {
                        downloadJob?.cancel()
                        progress = null
                        notice = "Download cancelado."
                    },
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) { Text("Cancelar", color = MaterialTheme.colorScheme.onSurface) }
            }
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(entries, key = { it.id.ifBlank { it.title } + (it.acquisition ?: it.subsection ?: "") }) { entry ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                        Text(
                            entry.title,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (entry.subsection != null) {
                                TextButton(
                                    onClick = { browse(entry.subsection) },
                                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                ) {
                                    Text("Abrir ›", color = MaterialTheme.colorScheme.onSurface)
                                }
                            }
                            if (entry.acquisition != null && selected != null) {
                                TextButton(
                                    onClick = {
                                        val server = selected
                                        downloadJob?.cancel()
                                        downloadJob = scope.launch {
                                            progress = 0f
                                            notice = null
                                            try {
                                                val file = OpdsClient.download(
                                                    server,
                                                    entry.acquisition,
                                                    File(filesDir, "imports"),
                                                    entry.title + extensionFor(entry),
                                                    onProgress = { progress = it },
                                                )
                                                progress = null
                                                notice = "Baixado: ${file.name}."
                                                onDownloaded(file.absolutePath)
                                            } catch (error: Exception) {
                                                progress = null
                                                if (error is kotlinx.coroutines.CancellationException) {
                                                    notice = "Download cancelado."
                                                } else {
                                                    notice = "Falha no download: ${error.message ?: "erro"}"
                                                }
                                            }
                                        }
                                    },
                                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                ) { Text("Baixar offline", color = MaterialTheme.colorScheme.secondary) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Extensão do arquivo baixado pelo tipo/URL: PDF baixado continua PDF. */
private fun extensionFor(entry: OpdsClient.Entry): String {
    val mime = entry.mime.orEmpty().lowercase()
    if (mime.contains("pdf")) return ".pdf"
    if (mime.contains("cbz") || mime.contains("comicbook+zip")) return ".cbz"
    if (mime.contains("cbr") || mime.contains("rar")) return ".cbr"
    if (mime.contains("7z")) return ".7z"
    val url = entry.acquisition.orEmpty().substringBefore('?').lowercase()
    return when {
        url.endsWith(".pdf") -> ".pdf"
        url.endsWith(".cbr") || url.endsWith(".rar") -> ".cbr"
        url.endsWith(".7z") -> ".7z"
        else -> ".cbz"
    }
}
