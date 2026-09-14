package com.jrmello4.tactilereader.reader

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jrmello4.tactilereader.core.ReaderPage
import com.jrmello4.tactilereader.core.ReaderProgress
import com.jrmello4.tactilereader.core.TactileCore
import com.jrmello4.tactilereader.core.parseEnsurePage
import com.jrmello4.tactilereader.core.parseReaderPages
import com.jrmello4.tactilereader.core.parseReaderState
import com.jrmello4.tactilereader.core.resolveImmediatePage
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
 * Faixa de leitura lendo do núcleo via JNI, sempre fora da thread principal.
 *
 * Páginas são preguiçosas: a abertura lista só metadados (+ caminho já
 * materializado); `requestPage` garante os bytes da página visível via
 * `nativeEnsurePage` e guarda o arquivo em [paths] (máx. 400 entradas).
 * `saveProgress` persiste `{pageId, scrollRatio}` sem bloquear a rolagem.
 */
class ReaderViewModel(
    filesDir: File,
    val publicationId: String,
    title: String,
) : ViewModel() {
    private val dbDir: String = File(filesDir, "lib").absolutePath
    private val _state = MutableStateFlow(ReaderUiState(title = title))
    val state: StateFlow<ReaderUiState> = _state
    private val _paths = MutableStateFlow<Map<String, String>>(emptyMap())
    val paths: StateFlow<Map<String, String>> = _paths
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
        val pages = parseReaderPages(TactileCore.nativeListPages(dbDir, publicationId))
        val progress = try {
            parseReaderState(TactileCore.nativeLoadReaderState(dbDir, publicationId))
        } catch (_: Exception) {
            null
        }
        val known = pages.map { it.id }.toSet()
        val start = progress?.takeIf { known.contains(it.pageId) }
        return pages to start
    }

    /**
     * Garante a página visível. `cachePath` já em disco resolve sem JNI;
     * página nova reconstrói só aqueles bytes do original somente-leitura.
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
                    parseEnsurePage(TactileCore.nativeEnsurePage(dbDir, publicationId, page.id))
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
                    TactileCore.nativeSaveReaderState(dbDir, publicationId, pageId, scrollRatio)
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
