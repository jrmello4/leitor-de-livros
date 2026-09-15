package com.jrmello4.tactilereader.reader

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.scaffold.AppSources
import com.jrmello4.tactilereader.core.ReaderPage
import com.jrmello4.tactilereader.core.ReaderProgress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Collections

/** Teto do mapa página-em-memória: a faixa monta só o visível + vizinhos. */
internal const val MAX_PAGE_ENTRIES = 400

data class ReaderUiState(
    val loading: Boolean = true,
    val title: String = "",
    val pages: List<ReaderPage> = emptyList(),
    /** Página salva para retomar; nulo = começar da primeira. */
    val startPageId: String? = null,
    /** Deslocamento salvo dentro da página (0..1). */
    val startRatio: Double = 0.0,
    val error: String? = null,
)

/**
 * Faixa de leitura lendo do núcleo Kotlin puro, sempre fora da thread
 * principal.
 *
 * Páginas são preguiçosas: a abertura lista só metadados (+ caminho já
 * materializado); `requestPage` garante os bytes da página visível via
 * `ensurePage` e guarda o arquivo em [paths] (máx. 400 entradas).
 * `saveProgress` persiste `{pageId, scrollRatio}` sem bloquear a rolagem.
 */
class ReaderViewModel(
    filesDir: File,
    val publicationId: String,
    title: String,
) : ViewModel() {
    // Preguiçoso de propósito: abrir SQLite nunca na main thread.
    private val db: LibraryDb by lazy {
        LibraryDb.open(File(filesDir, "lib"), File(filesDir, "imports"), AppSources.opener)
    }
    private val _state = MutableStateFlow(ReaderUiState(title = title))
    val state: StateFlow<ReaderUiState> = _state
    private val _paths = MutableStateFlow<Map<String, String>>(emptyMap())
    val paths: StateFlow<Map<String, String>> = _paths
    private val _bookmarks = MutableStateFlow<Set<String>>(emptySet())
    val bookmarks: StateFlow<Set<String>> = _bookmarks
    private val inFlight = Collections.synchronizedSet(mutableSetOf<String>())

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = try {
                val title = _state.value.title
                val (pages, progress) = withContext(Dispatchers.IO) { loadPagesAndState() }
                withContext(Dispatchers.IO) { primeImmediatePages(pages) }
                ReaderUiState(
                    loading = false,
                    title = title,
                    pages = pages,
                    startPageId = progress?.pageId,
                    startRatio = progress?.scrollRatio ?: 0.0,
                )
            } catch (error: Exception) {
                _state.value.copy(loading = false, error = error.message ?: "falha desconhecida")
            }
        }
    }

    private fun loadPagesAndState(): Pair<List<ReaderPage>, ReaderProgress?> {
        val pages = db.listPages(publicationId)
        val progress = try {
            db.loadReaderState(publicationId)
        } catch (_: Exception) {
            null
        }
        try {
            _bookmarks.value = db.listBookmarks(publicationId).map { it.pageId }.toSet()
        } catch (_: Exception) {
            // Marcadores são melhor-esforço.
        }
        val known = pages.map { it.id }.toSet()
        val start = progress?.takeIf { known.contains(it.pageId) }
        return pages to start
    }

    /** Alterna marcador na página atual; otimista com rollback. */
    fun toggleBookmark(pageId: String, label: String = "") {
        if (pageId.isBlank()) return
        val had = _bookmarks.value.contains(pageId)
        _bookmarks.value = if (had) _bookmarks.value - pageId else _bookmarks.value + pageId
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (had) {
                        db.removeBookmark(publicationId, pageId)
                    } else {
                        db.upsertBookmark(publicationId, pageId, label)
                    }
                }
            } catch (_: Exception) {
                _bookmarks.value = if (had) _bookmarks.value + pageId else _bookmarks.value - pageId
            }
        }
    }

    fun isBookmarked(pageId: String): Boolean = _bookmarks.value.contains(pageId)

    /**
     * Garante a página visível. `cachePath` já em disco resolve sem tocar no
     * original; página nova reconstrói só aqueles bytes do original.
     */
    fun requestPage(page: ReaderPage) {
        if (_paths.value.containsKey(page.id) || !inFlight.add(page.id)) {
            return
        }
        viewModelScope.launch {
            try {
                val immediate = withContext(Dispatchers.IO) { resolveImmediatePage(page) }
                if (immediate != null) {
                    cachePath(page.id, immediate)
                    return@launch
                }
                val ensured = withContext(Dispatchers.IO) {
                    db.ensurePage(publicationId, page.id).cachePath
                }
                if (ensured != null && withContext(Dispatchers.IO) { File(ensured).isFile }) {
                    cachePath(page.id, ensured)
                }
            } catch (_: Exception) {
                // Placeholder permanece; a próxima visibilidade tenta de novo.
            } finally {
                inFlight.remove(page.id)
            }
        }
    }

    /** Persiste `{pageId, scrollRatio}` fora da thread principal, sem travar a rolagem. */
    fun saveProgress(pageId: String, scrollRatio: Double) {
        if (pageId.isBlank()) {
            return
        }
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    db.saveReaderState(publicationId, pageId, scrollRatio)
                }
            } catch (_: Exception) {
                // Progresso é melhor-esforço; a próxima parada tenta de novo.
            }
        }
    }

    private fun primeImmediatePages(pages: List<ReaderPage>) {
        val primed = mutableMapOf<String, String>()
        for (page in pages) {
            if (primed.size >= MAX_PAGE_ENTRIES) {
                break
            }
            resolveImmediatePage(page)?.let { primed[page.id] = it }
        }
        _paths.value = primed
        inFlight.clear()
    }

    private fun cachePath(pageId: String, path: String) {
        val current = _paths.value.toMutableMap()
        current.remove(pageId)
        current[pageId] = path
        while (current.size > MAX_PAGE_ENTRIES) {
            current.remove(current.keys.first())
        }
        _paths.value = current
    }
}

/**
 * Página já disponível sem reconstruir: o `cachePath` listado resolve quando
 * o arquivo existe em disco. Pura e testável na JVM.
 */
internal fun resolveImmediatePage(
    page: ReaderPage,
    exists: (String) -> Boolean = { File(it).isFile },
): String? {
    val path = page.cachePath
    if (!path.isNullOrBlank() && exists(path)) {
        return path
    }
    return null
}

class ReaderViewModelFactory(
    private val filesDir: File,
    private val publicationId: String,
    private val title: String,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ReaderViewModel(filesDir, publicationId, title) as T
    }
}
