package com.jrmello4.tactilereader.opds

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
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

    Column(modifier = modifier.fillMaxSize().background(Color(0xFF0D1117)).padding(18.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Ajustes", color = Color.White) }
            Text(
                "Servidores",
                style = MaterialTheme.typography.titleLarge,
                color = Color(0xFFF7F2E8),
                modifier = Modifier.weight(1f).padding(start = 4.dp),
            )
            TextButton(onClick = { showForm = !showForm }) {
                Text(if (showForm) "Fechar" else "+ Servidor", color = Color.White)
            }
        }
        Text(
            "OPDS · Komga · Kavita (via OPDS) — só os seus servidores, sem telemetria.",
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFFC8C0B3),
            modifier = Modifier.padding(bottom = 8.dp),
        )
        if (notice != null) {
            Text(notice!!, color = Color(0xFFF2A900), modifier = Modifier.padding(bottom = 8.dp))
        }
        if (showForm) {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23))) {
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
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (type in listOf("opds", "komga", "kavita")) {
                            if (formType == type) {
                                Button(onClick = {}) { Text(type, color = Color.White) }
                            } else {
                                TextButton(onClick = { formType = type }) { Text(type, color = Color(0xFFC8C0B3)) }
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
                    ) { Text("Salvar", color = Color.White) }
                }
            }
        }
        if (servers.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (server in servers) {
                    if (server.id == selectedId) {
                        Button(onClick = {}) { Text(server.name, color = Color.White) }
                    } else {
                        TextButton(
                            onClick = {
                                selectedId = server.id
                                entries = emptyList()
                                trail = emptyList()
                            },
                        ) { Text(server.name, color = Color(0xFFC8C0B3)) }
                    }
                }
            }
            if (selected != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { trail = emptyList(); browse(null, pushTrail = false) }) {
                        Text("Abrir catálogo", color = Color.White)
                    }
                    if (trail.isNotEmpty()) {
                        TextButton(
                            onClick = {
                                trail = trail.dropLast(1)
                                browse(trail.lastOrNull(), pushTrail = false)
                            },
                        ) { Text("‹ Voltar", color = Color.White) }
                    }
                    TextButton(
                        onClick = {
                            persist(servers.filterNot { it.id == selected.id })
                            entries = emptyList()
                            trail = emptyList()
                        },
                    ) { Text("Remover", color = Color(0xFFC96F4A)) }
                }
                Text(
                    "Kavita: cadastre a URL OPDS dela (…/api/opds/…). Komga: cadastre a raiz e use o tipo komga.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFFC8C0B3),
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        if (loading) {
            LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
        }
        if (progress != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LinearProgressIndicator(
                    progress = { progress ?: 0f },
                    modifier = Modifier.weight(1f).padding(top = 8.dp),
                )
                TextButton(
                    onClick = {
                        downloadJob?.cancel()
                        progress = null
                        notice = "Download cancelado."
                    },
                ) { Text("Cancelar", color = Color.White) }
            }
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(entries, key = { it.id.ifBlank { it.title } + (it.acquisition ?: it.subsection ?: "") }) { entry ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF151B23))) {
                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                        Text(entry.title, color = Color(0xFFF7F2E8))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (entry.subsection != null) {
                                TextButton(onClick = { browse(entry.subsection) }) {
                                    Text("Abrir ›", color = Color.White)
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
                                ) { Text("Baixar offline", color = Color(0xFFF2A900)) }
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
