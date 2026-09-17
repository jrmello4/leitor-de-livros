package com.jrmello4.tactilereader.scaffold

import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jrmello4.tactilereader.core.ImportSource
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.library.LibraryScreen
import com.jrmello4.tactilereader.library.LibraryScanner
import com.jrmello4.tactilereader.library.LibraryViewModel
import com.jrmello4.tactilereader.library.LibraryViewModelFactory
import com.jrmello4.tactilereader.library.groupBySeries
import com.jrmello4.tactilereader.reader.ReaderScreen
import com.jrmello4.tactilereader.reader.ReaderViewModelFactory
import com.jrmello4.tactilereader.reader.VolumeScrollBus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * Hospeda o app: estante Compose, leitor, ajustes e servidores.
 *
 * Com a leitura direta de `content://`, importar NÃO copia a HQ: o núcleo
 * abre o original via [ContentSourceOpener]. Só o JSON de backup e os PNGs
 * derivados de PDF ficam no sandbox do app.
 */
class MainActivity : ComponentActivity() {
    private lateinit var viewModel: LibraryViewModel

    /** Só sequestra o volume físico enquanto o leitor está aberto. */
    @Volatile
    private var readerOpen = false

    /** Aviso visível durante trabalho longo (fora da main thread). */
    private data class BusyState(val text: String, val cancellable: Boolean = false)

    private val busy = kotlinx.coroutines.flow.MutableStateFlow<BusyState?>(null)
    private val cancelWork = java.util.concurrent.atomic.AtomicBoolean(false)

    /** Paleta Paper Atelier: elimina o roxo/azul padrão do Material. */
    private val paperAtelierScheme = androidx.compose.material3.darkColorScheme(
        primary = Color(0xFF3D2F23),
        onPrimary = Color(0xFFF7F2E8),
        primaryContainer = Color(0xFF5A4633),
        onPrimaryContainer = Color(0xFFFFE6C6),
        secondary = Color(0xFFF2A900),
        onSecondary = Color(0xFF080B0F),
        secondaryContainer = Color(0xFF5C4300),
        onSecondaryContainer = Color(0xFFFFE08A),
        tertiary = Color(0xFFC96F4A),
        onTertiary = Color(0xFF080B0F),
        background = Color(0xFF0D1117),
        onBackground = Color(0xFFF7F2E8),
        surface = Color(0xFF151B23),
        onSurface = Color(0xFFF7F2E8),
        surfaceVariant = Color(0xFF252A31),
        onSurfaceVariant = Color(0xFFC8C0B3),
        outline = Color(0xFF8B8174),
        error = Color(0xFFC96F4A),
        onError = Color(0xFF080B0F),
    )

    /** Teclas de volume passam a página no leitor; fora dele, volume normal. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (readerOpen) {
            when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> {
                    VolumeScrollBus.emit(-1)
                    return true
                }
                KeyEvent.KEYCODE_VOLUME_DOWN -> {
                    VolumeScrollBus.emit(1)
                    return true
                }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private val pickBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            lifecycleScope.launch {
                val path = withContext(Dispatchers.IO) { copyToSandbox(uri) }
                if (path != null) {
                    applyBackup(path)
                }
            }
        }
    }

    /** Seleção múltipla: cada URI entra como origem e é lida sem cópia. */
    private val pickComics = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNullOrEmpty()) {
            return@registerForActivityResult
        }
        lifecycleScope.launch {
            cancelWork.set(false)
            busy.value = BusyState("Preparando ${uris.size} arquivos…", cancellable = true)
            val sources = withContext(Dispatchers.IO) { uris.mapNotNull { sourceForUri(it) } }
            busy.value = null
            if (sources.isNotEmpty()) {
                viewModel.importSources(sources)
            } else {
                android.widget.Toast.makeText(
                    this@MainActivity,
                    "Nenhum arquivo suportado foi selecionado.",
                    android.widget.Toast.LENGTH_LONG,
                ).show()
            }
        }
    }

    /** Pasta SAF: varredura sem cópia; PDF é renderizado do descritor. */
    private val pickFolder = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            lifecycleScope.launch {
                cancelWork.set(false)
                busy.value = BusyState("Lendo a pasta escolhida…", cancellable = true)
                val scan = withContext(Dispatchers.IO) {
                    LibraryScanner.collectSafSources(
                        this@MainActivity,
                        uri,
                        shouldCancel = { cancelWork.get() },
                    )
                }
                val sources = withContext(Dispatchers.IO) {
                    scan.sources.mapNotNull { source ->
                        if (source.displayName?.lowercase()?.endsWith(".pdf") == true) {
                            renderPdfSource(source)
                        } else {
                            source
                        }
                    }
                }
                busy.value = null
                when {
                    sources.isNotEmpty() -> {
                        viewModel.importSources(sources)
                        if (scan.truncated) {
                            android.widget.Toast.makeText(
                                this@MainActivity,
                                "Pasta grande: importamos os primeiros 500 arquivos. Repita em subpastas para o resto.",
                                android.widget.Toast.LENGTH_LONG,
                            ).show()
                        }
                    }
                    scan.accessDenied -> android.widget.Toast.makeText(
                        this@MainActivity,
                        "Sem acesso a essa pasta. Se for raiz do armazenamento ou Downloads, escolha uma subpasta ou use \"+ HQ\".",
                        android.widget.Toast.LENGTH_LONG,
                    ).show()
                    cancelWork.get() -> android.widget.Toast.makeText(
                        this@MainActivity,
                        "Importação cancelada.",
                        android.widget.Toast.LENGTH_SHORT,
                    ).show()
                    else -> android.widget.Toast.makeText(
                        this@MainActivity,
                        "Nenhum arquivo suportado foi encontrado nessa pasta (nem nas subpastas).",
                        android.widget.Toast.LENGTH_LONG,
                    ).show()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val factory = LibraryViewModelFactory(filesDir)
        setContent {
            MaterialTheme(colorScheme = paperAtelierScheme) {
                viewModel = viewModel(factory = factory)
                var openPubId by rememberSaveable { mutableStateOf<String?>(null) }
                var openPageId by rememberSaveable { mutableStateOf<String?>(null) }
                var screen by rememberSaveable { mutableStateOf("library") }
                val pubs by viewModel.state.collectAsState()
                val current = pubs.pubs.firstOrNull { it.id == openPubId }
                val busyText by busy.collectAsState()
                androidx.compose.runtime.SideEffect { readerOpen = current != null }
                androidx.compose.foundation.layout.Box(
                    modifier = androidx.compose.ui.Modifier.fillMaxSize(),
                ) {
                    when {
                        current != null -> {
                            val reader: com.jrmello4.tactilereader.reader.ReaderViewModel = viewModel(
                                key = "reader-${current.id}-${openPageId ?: "last"}",
                                factory = ReaderViewModelFactory(filesDir, current.id, current.title, openPageId),
                            )
                            val next = nextEdition(pubs.pubs.map { it }, current.id)
                            ReaderScreen(
                                reader,
                                onBack = {
                                    openPubId = null
                                    openPageId = null
                                    viewModel.refresh()
                                },
                                nextTitle = next?.title,
                                onBingeOpenNext = {
                                    reader.finishSession()
                                    if (next != null) {
                                        openPubId = next.id
                                        openPageId = null
                                    }
                                },
                            )
                        }
                        screen == "bookmarks" -> {
                            com.jrmello4.tactilereader.bookmarks.BookmarksScreen(
                                filesDir = filesDir,
                                onBack = { screen = "library" },
                                onOpenBookmark = { pubId, pageId ->
                                    openPubId = pubId
                                    openPageId = pageId
                                },
                                onExportBackup = {
                                    lifecycleScope.launch {
                                        busy.value = BusyState("Exportando backup…", cancellable = false)
                                        val out = withContext(Dispatchers.IO) {
                                            try {
                                                val file = com.jrmello4.tactilereader.settings.BackupManager.export(
                                                    LibraryDb.open(File(filesDir, "lib"), File(filesDir, "imports"), AppSources.opener),
                                                    File(filesDir, "backups"),
                                                )
                                                "Backup gerado em ${file.name}"
                                            } catch (e: Exception) {
                                                "Falha ao exportar: ${e.message}"
                                            }
                                        }
                                        busy.value = null
                                        android.widget.Toast.makeText(this@MainActivity, out, android.widget.Toast.LENGTH_LONG).show()
                                    }
                                },
                                onImportBackup = { pickBackup.launch(arrayOf("*/*")) },
                            )
                        }
                        screen == "stats" -> {
                            com.jrmello4.tactilereader.stats.ReadingStatsScreen(
                                filesDir = filesDir,
                                onBack = { screen = "library" },
                                onOpenPub = { pubId ->
                                    openPubId = pubId
                                    openPageId = null
                                },
                            )
                        }
                        screen == "settings" -> {
                            com.jrmello4.tactilereader.settings.SettingsScreen(
                                filesDir = filesDir,
                                onBack = { screen = "library" },
                                onOpenOpds = { screen = "opds" },
                                onOpenBookmarks = { screen = "bookmarks" },
                                onOpenStats = { screen = "stats" },
                                onImportBackup = { pickBackup.launch(arrayOf("*/*")) },
                            )
                        }
                        screen == "opds" -> {
                            com.jrmello4.tactilereader.opds.OpdsScreen(
                                filesDir = filesDir,
                                onBack = { screen = "settings" },
                                onDownloaded = { path -> importLocalPath(path) },
                            )
                        }
                        else -> {
                            if (openPubId != null && !pubs.loading) {
                                openPubId = null
                                openPageId = null
                            }
                            var folders by androidx.compose.runtime.remember {
                                mutableStateOf<List<com.jrmello4.tactilereader.library.FolderEntry>>(emptyList())
                            }
                            androidx.compose.runtime.LaunchedEffect(pubs.pubs.size) {
                                folders = withContext(Dispatchers.IO) {
                                    LibraryScanner.allFolders(this@MainActivity, filesDir)
                                }
                            }
                            LibraryScreen(
                                viewModel,
                                onAddClick = { pickComics.launch(arrayOf("*/*")) },
                                onOpenClick = {
                                    openPubId = it.id
                                    openPageId = null
                                },
                                onAddFolderClick = { pickFolder.launch(null) },
                                onOpenSettings = { screen = "settings" },
                                onOpenBookmarks = { screen = "bookmarks" },
                                onOpenStats = { screen = "stats" },
                                folders = folders,
                                onRescan = {
                                    lifecycleScope.launch {
                                        cancelWork.set(false)
                                        busy.value = BusyState("Revarrendo origens…", cancellable = true)
                                        val sources = withContext(Dispatchers.IO) {
                                            val local = LibraryScanner.collectLocalCandidates(filesDir)
                                                .map { ImportSource(it, File(it).name) }
                                            val saf = LibraryScanner.persistedTreeUris(this@MainActivity)
                                                .flatMap { tree ->
                                                    LibraryScanner.collectSafSources(
                                                        this@MainActivity,
                                                        tree,
                                                        shouldCancel = { cancelWork.get() },
                                                    ).sources
                                                }
                                            local + saf
                                        }
                                        busy.value = null
                                        if (sources.isNotEmpty()) {
                                            viewModel.importSources(sources)
                                        }
                                        folders = withContext(Dispatchers.IO) {
                                            LibraryScanner.allFolders(this@MainActivity, filesDir)
                                        }
                                    }
                                },
                            )
                        }
                    }
                    busyText?.let { state ->
                        androidx.compose.foundation.layout.Column(
                            modifier = androidx.compose.ui.Modifier
                                .fillMaxSize()
                                .background(androidx.compose.ui.graphics.Color(0xCC080B0F)),
                            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                            horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                        ) {
                            androidx.compose.material3.Text(
                                state.text,
                                color = androidx.compose.ui.graphics.Color(0xFFF7F2E8),
                            )
                            androidx.compose.material3.LinearProgressIndicator(
                                modifier = androidx.compose.ui.Modifier.padding(top = 12.dp),
                            )
                            if (state.cancellable) {
                                androidx.compose.material3.TextButton(
                                    onClick = { cancelWork.set(true) },
                                ) {
                                    androidx.compose.material3.Text(
                                        "Cancelar",
                                        color = androidx.compose.ui.graphics.Color.White,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /** Nome de exibição + URI persistível viram uma origem do núcleo. */
    private fun sourceForUri(uri: Uri): ImportSource? {
        val name = displayName(uri) ?: return null
        if (!LibraryScanner.isSupportedFile(name)) {
            return null
        }
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        } catch (_: SecurityException) {
            // Melhor-esforço; a origem segue válida nesta sessão.
        }
        if (name.lowercase().endsWith(".pdf")) {
            return renderPdfSource(ImportSource(uri.toString(), name))
        }
        return ImportSource(uri.toString(), name)
    }

    /** PDF: renderiza do descritor SAF para `pdf-pages/` (derivado, não cópia). */
    private fun renderPdfSource(source: ImportSource): ImportSource? {
        return try {
            val descriptor = contentResolver.openFileDescriptor(Uri.parse(source.reference), "r")
                ?: return null
            val name = source.displayName ?: "pdf"
            val rendered = descriptor.use {
                com.jrmello4.tactilereader.pdf.PdfImporter.import(
                    it,
                    name.substringBeforeLast('.'),
                    File(filesDir, "pdf-pages"),
                )
            } ?: return null
            ImportSource(rendered.absolutePath, rendered.name)
        } catch (error: Exception) {
            android.widget.Toast.makeText(
                this@MainActivity,
                "PDF indisponível: ${error.message ?: "erro"}",
                android.widget.Toast.LENGTH_LONG,
            ).show()
            null
        }
    }

    /** Importa um caminho já dentro do sandbox (ex.: download OPDS). */
    private fun importLocalPath(path: String) {
        lifecycleScope.launch {
            if (path.lowercase().endsWith(".pdf")) {
                val rendered = withContext(Dispatchers.IO) {
                    try {
                        com.jrmello4.tactilereader.pdf.PdfImporter
                            .import(File(path), File(filesDir, "pdf-pages"))
                            ?.absolutePath
                    } catch (error: Exception) {
                        android.widget.Toast.makeText(
                            this@MainActivity,
                            "PDF indisponível: ${error.message ?: "erro"}",
                            android.widget.Toast.LENGTH_LONG,
                        ).show()
                        null
                    }
                }
                if (rendered != null) {
                    viewModel.importSources(listOf(ImportSource(rendered, File(rendered).name)))
                }
                return@launch
            }
            viewModel.importSources(listOf(ImportSource(path, File(path).name)))
        }
    }

    /** Próxima edição da mesma série (ordem numérica); nulo = fim da série. */
    private fun nextEdition(
        pubs: List<com.jrmello4.tactilereader.core.Pub>,
        currentId: String,
    ): com.jrmello4.tactilereader.core.Pub? {
        val groups = groupBySeries(pubs)
        for (group in groups) {
            val index = group.editions.indexOfFirst { it.pub.id == currentId }
            if (index >= 0 && index + 1 < group.editions.size) {
                return group.editions[index + 1].pub
            }
        }
        return null
    }

    private fun displayName(uri: Uri): String? =
        contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst() && index >= 0) cursor.getString(index) else null
        }

    /** Só o backup JSON é copiado: o resto é lido do original. */
    private fun copyToSandbox(uri: Uri): String? {
        val name = displayName(uri) ?: "backup.json"
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val target = File(File(filesDir, "backups").apply { mkdirs() }, "import-$safe")
        return try {
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            } ?: return null
            target.absolutePath
        } catch (_: Exception) {
            target.delete()
            null
        }
    }

    private fun applyBackup(path: String) {
        lifecycleScope.launch {
            try {
                val summary = withContext(Dispatchers.IO) {
                    com.jrmello4.tactilereader.settings.BackupManager.import(
                        com.jrmello4.tactilereader.core.LibraryDb.open(
                            File(filesDir, "lib"),
                            File(filesDir, "imports"),
                            AppSources.opener,
                        ),
                        File(path),
                    )
                }
                viewModel.refresh()
                android.widget.Toast.makeText(
                    this@MainActivity,
                    "Backup aplicado: ${summary.favorites} favoritos, ${summary.progress} progressos, ${summary.bookmarks} marcadores.",
                    android.widget.Toast.LENGTH_LONG,
                ).show()
            } catch (error: Exception) {
                android.widget.Toast.makeText(
                    this@MainActivity,
                    "Falha no backup: ${error.message ?: "erro"}",
                    android.widget.Toast.LENGTH_LONG,
                ).show()
            }
        }
    }
}
