package com.jrmello4.tactilereader.reader

import android.os.SystemClock
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
    private val filesDir: File,
    private val publicationId: String,
    title: String,
    private val initialPageId: String? = null,
) : ViewModel() {
    private val db: LibraryDb by lazy {
        LibraryDb.open(File(filesDir, "lib"), File(filesDir, "imports"), AppSources.opener)
    }
    private val _state = MutableStateFlow(ReaderUiState(loading = true, title = title))
    val state: StateFlow<ReaderUiState> = _state
    private val _paths = MutableStateFlow<Map<String, String>>(emptyMap())
    val paths: StateFlow<Map<String, String>> = _paths
    private val _bookmarks = MutableStateFlow<Set<String>>(emptySet())
    val bookmarks: StateFlow<Set<String>> = _bookmarks
    private val inFlight = Collections.synchronizedSet(mutableSetOf<String>())
    private var sessionStartedAt = 0L
    private var sessionStartPageIndex = 0
    private var furthestPageIndex = 0
    private var pausedAt = 0L
    private var pausedMillis = 0L
    private var sessionRecorded = false

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = try {
                val title = _state.value.title
                val (pages, progress) = withContext(Dispatchers.IO) { loadPagesAndState() }
                val effectiveStartId = initialPageId ?: progress?.pageId
                val restoredIndex = effectiveStartId?.let { id -> pages.indexOfFirst { it.id == id } }
                    ?.takeIf { it >= 0 }
                    ?: 0
                sessionStartedAt = SystemClock.elapsedRealtime()
                sessionStartPageIndex = restoredIndex
                furthestPageIndex = restoredIndex
                pausedAt = 0L
                pausedMillis = 0L
                sessionRecorded = false
                withContext(Dispatchers.IO) { primeImmediatePages(pages) }
                ReaderUiState(
                    loading = false,
                    title = title,
                    pages = pages,
                    startPageId = effectiveStartId,
                    startRatio = if (initialPageId != null) 0.0 else (progress?.scrollRatio ?: 0.0),
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
        _state.value.pages.indexOfFirst { it.id == pageId }
            .takeIf { it >= 0 }
            ?.let { furthestPageIndex = maxOf(furthestPageIndex, it) }
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

    /**
     * Fecha a sessão local e acumula uma amostra de velocidade. O cálculo só
     * considera páginas realmente avançadas; reabrir uma HQ sem navegar não
     * cria uma métrica artificial.
     */
    @Synchronized
    fun finishSession() {
        if (sessionRecorded) return
        sessionRecorded = true
        val startedAt = sessionStartedAt
        val now = SystemClock.elapsedRealtime()
        val pauseAtExit = pausedAt.takeIf { it > 0L }?.let { (now - it).coerceAtLeast(0L) } ?: 0L
        val totalPaused = saturatingAdd(pausedMillis, pauseAtExit)
        val duration = (now - startedAt - totalPaused).coerceAtLeast(0L)
        val pagesRead = (furthestPageIndex - sessionStartPageIndex).coerceAtLeast(0)
        if (startedAt <= 0L || pagesRead <= 0) return
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    db.recordReadingSession(publicationId, duration, pagesRead)
                }
            } catch (_: Exception) {
                // Estatística é melhor-esforço; progresso e marcadores já foram salvos.
            }
        }
    }

    /** Suspende o relógio quando o app perde o primeiro plano. */
    @Synchronized
    fun pauseSession() {
        if (sessionRecorded || sessionStartedAt <= 0L || pausedAt > 0L) return
        pausedAt = SystemClock.elapsedRealtime()
    }

    /** Retoma o relógio sem transformar tempo em segundo plano em leitura. */
    @Synchronized
    fun resumeSession() {
        if (sessionRecorded || pausedAt <= 0L) return
        pausedMillis = saturatingAdd(
            pausedMillis,
            (SystemClock.elapsedRealtime() - pausedAt).coerceAtLeast(0L),
        )
        pausedAt = 0L
    }

    private fun saturatingAdd(left: Long, right: Long): Long {
        return if (Long.MAX_VALUE - left < right) Long.MAX_VALUE else left + right
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
    private val initialPageId: String? = null,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ReaderViewModel(filesDir, publicationId, title, initialPageId) as T
    }
}
