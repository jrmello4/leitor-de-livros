package com.jrmello4.tactilereader.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jrmello4.tactilereader.core.ImportProgress
import com.jrmello4.tactilereader.core.ImportSource
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.scaffold.AppSources
import com.jrmello4.tactilereader.core.Pub
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean

/** Teto do mapa capa-em-memória: a grade monta só o visível + vizinhos. */
internal const val MAX_COVER_ENTRIES = 200

data class LibraryUiState(
    val loading: Boolean = true,
    val pubs: List<Pub> = emptyList(),
    val error: String? = null,
    val notice: String? = null,
    /** Importação em andamento: a estante continua visível com progresso. */
    val importing: ImportProgress? = null,
)

/**
 * Estante lendo do núcleo Kotlin puro, sempre fora da thread principal.
 * Na primeira abertura com biblioteca vazia, gera e importa a HQ de
 * demonstração para provar o pipeline importar→listar.
 *
 * Capas são preguiçosas: a listagem traz só identificadores + caminho já
 * materializado; `requestCover` garante os bytes do card visível via
 * `ensurePage` e guarda o arquivo em [covers] (máx. 200 entradas).
 */
class LibraryViewModel(private val filesDir: File) : ViewModel() {
    // Preguiçoso de propósito: abrir SQLite (migração/reconciliação) nunca na
    // main thread — o primeiro acesso acontece dentro de Dispatchers.IO.
    private val db: LibraryDb by lazy {
        LibraryDb.open(File(filesDir, "lib"), File(filesDir, "imports"), AppSources.opener)
    }
    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state
    private val _covers = MutableStateFlow<Map<String, String>>(emptyMap())
    val covers: StateFlow<Map<String, String>> = _covers
    private val inFlight = Collections.synchronizedSet(mutableSetOf<String>())
    private val cancelImport = AtomicBoolean(false)

    init {
        refresh()
    }

    fun refresh() {
        _state.value = LibraryUiState(loading = true)
        viewModelScope.launch {
            _state.value = try {
                val pubs = withContext(Dispatchers.IO) { loadOrSeed() }
                withContext(Dispatchers.IO) { primeImmediateCovers(pubs) }
                LibraryUiState(loading = false, pubs = pubs)
            } catch (error: Exception) {
                LibraryUiState(loading = false, error = error.message ?: "falha desconhecida")
            }
        }
    }

    /** Lista a estante; a importação entra por SAF/OPDS, nunca sozinha. */
    private fun loadOrSeed(): List<Pub> = db.listPublications()

    /** Importa um arquivo já copiado para o armazenamento do app e recarrega. */
    fun importFile(path: String) {
        importFiles(listOf(path))
    }

    /** Importa caminhos locais (cópias legadas, PDFs renderizados). */
    fun importFiles(paths: List<String>) {
        importSources(paths.map { ImportSource(it, File(it).name) })
    }

    /**
     * Importa origens (caminho ou `content://` do SAF) com progresso e
     * cancelamento. Ler direto do original evita duplicar o espaço.
     */
    fun importSources(sources: List<ImportSource>) {
        if (sources.isEmpty()) {
            return
        }
        cancelImport.set(false)
        _state.value = _state.value.copy(
            notice = null,
            importing = ImportProgress(0, sources.size, ""),
        )
        viewModelScope.launch {
            _state.value = try {
                val outcome = withContext(Dispatchers.IO) {
                    db.importSources(
                        sources,
                        onProgress = { progress ->
                            _state.value = _state.value.copy(importing = progress)
                        },
                        shouldCancel = { cancelImport.get() },
                    )
                }
                val notice = outcome.diagnostics.joinToString(" ").ifBlank { null }
                val pubs = withContext(Dispatchers.IO) { db.listPublications() }
                withContext(Dispatchers.IO) { primeImmediateCovers(pubs) }
                _state.value.copy(
                    loading = false,
                    pubs = pubs,
                    notice = notice,
                    importing = null,
                )
            } catch (error: Exception) {
                _state.value.copy(
                    loading = false,
                    error = error.message ?: "falha desconhecida",
                    importing = null,
                )
            }
        }
    }

    /** Pede o cancelamento do import em andamento (o que entrou fica). */
    fun cancelImport() {
        cancelImport.set(true)
    }

    /** Alterna favorito sem reescrever mais nada; otimista com rollback. */
    fun toggleFavorite(pub: Pub) {
        val current = _state.value.pubs
        val updated = current.map {
            if (it.id == pub.id) it.copy(isFavorite = !it.isFavorite) else it
        }
        _state.value = _state.value.copy(pubs = updated)
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { db.setFavorite(pub.id, !pub.isFavorite) }
            } catch (_: Exception) {
                _state.value = _state.value.copy(pubs = current)
            }
        }
    }

    /** Remove a publicação e o cache derivado; originais nunca são tocados. */
    fun deletePublication(pubId: String) {
        val current = _state.value.pubs
        _state.value = _state.value.copy(pubs = current.filterNot { it.id == pubId })
        _covers.value = _covers.value - pubId
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { db.deletePublication(pubId) }
            } catch (error: Exception) {
                _state.value = _state.value.copy(
                    pubs = current,
                    error = error.message ?: "falha desconhecida",
                )
            }
        }
    }

    /** Marca como lido (última página) ou limpa o progresso (0). */
    fun setRead(pub: Pub, read: Boolean) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val target = if (read) (pub.pageCount - 1).coerceAtLeast(0) else 0
                    db.markRead(pub.id, target)
                }
                val pubs = withContext(Dispatchers.IO) { db.listPublications() }
                _state.value = _state.value.copy(pubs = pubs)
            } catch (_: Exception) {
                // Melhor-esforço: a estante segue legível.
            }
        }
    }

    /** Limpa o cache derivado sem tocar em originais. */
    fun clearCache(onDone: (String) -> Unit = {}) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { db.clearCache() }
                _covers.value = emptyMap()
                onDone("Cache limpo.")
            } catch (error: Exception) {
                onDone("Falha ao limpar: ${error.message ?: "erro"}")
            }
        }
    }

    /**
     * Garante a capa do card visível: capa personalizada ou `coverSrc` já em
     * disco resolve sem reconstruir; import novo reconstrói só a primeira
     * página via núcleo, sem tocar no original.
     */
    fun requestCover(pub: Pub) {
        if (_covers.value.containsKey(pub.id) || !inFlight.add(pub.id)) {
            return
        }
        viewModelScope.launch {
            try {
                val immediate = withContext(Dispatchers.IO) { resolveImmediateCover(pub) }
                if (immediate != null) {
                    cacheCover(pub.id, immediate)
                    return@launch
                }
                if (pub.coverPageId.isBlank()) {
                    return@launch
                }
                val ensured = withContext(Dispatchers.IO) {
                    db.ensurePage(pub.id, pub.coverPageId).cachePath
                }
                if (ensured != null && withContext(Dispatchers.IO) { File(ensured).isFile }) {
                    cacheCover(pub.id, ensured)
                }
            } catch (_: Exception) {
                // Placeholder permanece; a próxima visibilidade tenta de novo.
            } finally {
                inFlight.remove(pub.id)
            }
        }
    }

    private fun primeImmediateCovers(pubs: List<Pub>) {
        val primed = mutableMapOf<String, String>()
        for (pub in pubs) {
            if (primed.size >= MAX_COVER_ENTRIES) {
                break
            }
            resolveImmediateCover(pub)?.let { primed[pub.id] = it }
        }
        _covers.value = primed
        inFlight.clear()
    }

    private fun cacheCover(pubId: String, path: String) {
        val current = _covers.value.toMutableMap()
        current.remove(pubId)
        current[pubId] = path
        while (current.size > MAX_COVER_ENTRIES) {
            current.remove(current.keys.first())
        }
        _covers.value = current
    }
}

/**
 * Capa já disponível sem reconstruir: prefere a personalizada válida, senão
 * o `coverSrc` já materializado. Arquivos inexistentes voltam a nulo.
 */
internal fun resolveImmediateCover(
    pub: Pub,
    exists: (String) -> Boolean = { File(it).isFile },
): String? {
    pub.customCoverPath?.takeIf { it.isNotBlank() && exists(it) }?.let { return it }
    pub.coverSrc?.takeIf { it.isNotBlank() && exists(it) }?.let { return it }
    return null
}

class LibraryViewModelFactory(private val filesDir: File) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return LibraryViewModel(filesDir) as T
    }
}
