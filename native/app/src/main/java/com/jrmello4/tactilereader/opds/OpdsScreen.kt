package com.jrmello4.tactilereader.opds

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jrmello4.tactilereader.ui.theme.DarkGraphite750
import com.jrmello4.tactilereader.ui.theme.DarkGraphite800
import com.jrmello4.tactilereader.ui.theme.DarkGraphite900
import com.jrmello4.tactilereader.ui.theme.OxideRed
import com.jrmello4.tactilereader.ui.theme.Paper300
import com.jrmello4.tactilereader.ui.theme.Paper50
import com.jrmello4.tactilereader.ui.theme.Paper500
import com.jrmello4.tactilereader.ui.theme.SeamStrong
import com.jrmello4.tactilereader.ui.theme.SeamSubtle
import com.jrmello4.tactilereader.ui.theme.WarmAmber
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Servidores OPDS / Komga / Kavita em estilo Dark-First Editorial Workbench.
 * Cadastro múltiplo, navegação hierárquica por feeds, download offline com
 * progresso e cancelamento. Originais remotos nunca são alterados.
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
    BackHandler(onBack = onBack)
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
                        contentDescription = "Voltar aos ajustes",
                        tint = Paper50,
                    )
                    Spacer(Modifier.width(4.dp))
                    Text("Ajustes", color = Paper50, style = MaterialTheme.typography.labelLarge)
                }
                Text(
                    "Servidores",
                    style = MaterialTheme.typography.titleLarge,
                    color = Paper50,
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
                        color = WarmAmber,
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                    )
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 4.dp),
        ) {
            Text(
                "OPDS · KOMGA · KAVITA · APENAS CONEXÕES DIRETAS LOCAIS",
                style = MaterialTheme.typography.labelSmall.copy(
                    letterSpacing = 1.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = Paper500,
                modifier = Modifier.padding(bottom = 8.dp),
            )

            if (notice != null) {
                Text(
                    notice!!,
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                    color = WarmAmber,
                    modifier = Modifier
                        .padding(bottom = 8.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }

            // Formulário de novo servidor
            if (showForm) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DarkGraphite800),
                    border = BorderStroke(1.dp, SeamStrong),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        val fieldColors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = WarmAmber,
                            unfocusedBorderColor = SeamSubtle,
                            focusedTextColor = Paper50,
                            unfocusedTextColor = Paper50,
                            focusedLabelColor = WarmAmber,
                            unfocusedLabelColor = Paper300,
                        )

                        OutlinedTextField(
                            value = formName,
                            onValueChange = { formName = it },
                            label = { Text("Nome da conexão") },
                            singleLine = true,
                            colors = fieldColors,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = formUrl,
                            onValueChange = { formUrl = it },
                            label = { Text("URL (ex: https://meu-servidor:8080/opds/v1.2/catalog)") },
                            singleLine = true,
                            colors = fieldColors,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = formUser,
                                onValueChange = { formUser = it },
                                label = { Text("Usuário") },
                                singleLine = true,
                                colors = fieldColors,
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = formPass,
                                onValueChange = { formPass = it },
                                label = { Text("Senha") },
                                singleLine = true,
                                colors = fieldColors,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        // Tipo de servidor
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            for (type in listOf("opds", "komga", "kavita")) {
                                val isSelected = formType == type
                                Button(
                                    onClick = { formType = type },
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (isSelected) WarmAmber else DarkGraphite750,
                                        contentColor = if (isSelected) DarkGraphite900 else Paper300,
                                    ),
                                    shape = RoundedCornerShape(8.dp),
                                    border = if (isSelected) null else BorderStroke(1.dp, SeamSubtle),
                                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                ) {
                                    Text(type.uppercase(), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold))
                                }
                            }
                        }

                        Button(
                            onClick = {
                                if (formName.isBlank() || formUrl.isBlank()) {
                                    notice = "Informe o nome e a URL do servidor."
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
                            colors = ButtonDefaults.buttonColors(
                                containerColor = WarmAmber,
                                contentColor = DarkGraphite900,
                            ),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text("Salvar servidor", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
                        }
                    }
                }
            }

            // Seleção de servidores cadastrados
            if (servers.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    for (server in servers) {
                        val isSelected = server.id == selectedId
                        Button(
                            onClick = {
                                selectedId = server.id
                                entries = emptyList()
                                trail = emptyList()
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (isSelected) DarkGraphite750 else DarkGraphite800,
                                contentColor = if (isSelected) WarmAmber else Paper300,
                            ),
                            shape = RoundedCornerShape(8.dp),
                            border = BorderStroke(1.dp, if (isSelected) WarmAmber else SeamSubtle),
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text(server.name, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
                        }
                    }
                }

                if (selected != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Button(
                            onClick = { trail = emptyList(); browse(null, pushTrail = false) },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = DarkGraphite750,
                                contentColor = Paper50,
                            ),
                            shape = RoundedCornerShape(8.dp),
                            border = BorderStroke(1.dp, SeamSubtle),
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text("Abrir catálogo", style = MaterialTheme.typography.labelLarge)
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
                                    tint = Paper50,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text("Voltar", color = Paper50)
                            }
                        }

                        TextButton(
                            onClick = {
                                persist(servers.filterNot { it.id == selected.id })
                                entries = emptyList()
                                trail = emptyList()
                            },
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text("Remover servidor", color = OxideRed)
                        }
                    }
                }
            }

            if (loading) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp)
                        .height(4.dp),
                    color = WarmAmber,
                    trackColor = DarkGraphite750,
                )
            }

            if (progress != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(vertical = 4.dp),
                ) {
                    LinearProgressIndicator(
                        progress = { progress ?: 0f },
                        modifier = Modifier
                            .weight(1f)
                            .height(4.dp),
                        color = WarmAmber,
                        trackColor = DarkGraphite750,
                    )
                    TextButton(
                        onClick = {
                            downloadJob?.cancel()
                            progress = null
                            notice = "Download cancelado."
                        },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) {
                        Text("Cancelar", color = OxideRed)
                    }
                }
            }

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(entries, key = { it.id.ifBlank { it.title } + (it.acquisition ?: it.subsection ?: "") }) { entry ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = DarkGraphite800),
                        border = BorderStroke(1.dp, SeamSubtle),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                        ) {
                            Text(
                                text = entry.title,
                                style = MaterialTheme.typography.titleMedium,
                                color = Paper50,
                            )
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp)
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                if (entry.subsection != null) {
                                    Button(
                                        onClick = { browse(entry.subsection) },
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor = DarkGraphite750,
                                            contentColor = Paper50,
                                        ),
                                        shape = RoundedCornerShape(8.dp),
                                        border = BorderStroke(1.dp, SeamSubtle),
                                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                    ) {
                                        Text("Explorar pasta ›", style = MaterialTheme.typography.labelMedium)
                                    }
                                }
                                if (entry.acquisition != null && selected != null) {
                                    Button(
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
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor = WarmAmber,
                                            contentColor = DarkGraphite900,
                                        ),
                                        shape = RoundedCornerShape(8.dp),
                                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                    ) {
                                        Text("Baixar offline", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold))
                                    }
                                }
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
