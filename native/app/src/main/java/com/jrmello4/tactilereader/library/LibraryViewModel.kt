package com.jrmello4.tactilereader.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jrmello4.tactilereader.core.TactileCore
import com.jrmello4.tactilereader.core.TestComic
import com.jrmello4.tactilereader.core.parseEnsureCover
import com.jrmello4.tactilereader.core.parsePublications
import com.jrmello4.tactilereader.core.Pub
import com.jrmello4.tactilereader.core.pathsJson
import com.jrmello4.tactilereader.core.resolveImmediateCover
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Collections

/** Teto do mapa capa-em-memória: a grade monta só o visível + vizinhos. */
internal const val MAX_COVER_ENTRIES = 200

data class LibraryUiState(
    val loading: Boolean = true,
    val pubs: List<Pub> = emptyList(),
    val error: String? = null,
    val notice: String? = null,
)

/**
 * Estante lendo do núcleo via JNI, sempre fora da thread principal.
 * Na primeira abertura com biblioteca vazia, gera e importa a HQ de
 * demonstração para provar o pipeline importar→listar no aparelho.
 *
 * Capas são preguiçosas: a listagem traz só identificadores + caminho já
 * materializado; `requestCover` garante os bytes do card visível via
 * `nativeEnsureCover` e guarda o arquivo em [covers] (máx. 200 entradas).
 */
class LibraryViewModel(private val filesDir: File) : ViewModel() {
    private val dbDir: String = File(filesDir, "lib").absolutePath
    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state
    private val _covers = MutableStateFlow<Map<String, String>>(emptyMap())
    val covers: StateFlow<Map<String, String>> = _covers
    private val inFlight = Collections.synchronizedSet(mutableSetOf<String>())

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

    private fun loadOrSeed(): List<Pub> {
        var pubs = parsePublications(TactileCore.nativeListPublications(dbDir))
        if (pubs.isEmpty()) {
            val demo = TestComic.generate(File(filesDir, "seed"))
            TactileCore.nativeImportPaths(dbDir, pathsJson(listOf(demo.absolutePath)))
            pubs = parsePublications(TactileCore.nativeListPublications(dbDir))
        }
        return pubs
    }

    /** Importa um arquivo já copiado para o armazenamento do app e recarrega. */
    fun importFile(path: String) {
        _state.value = _state.value.copy(loading = true, notice = null)
        viewModelScope.launch {
            _state.value = try {
                val outcome = withContext(Dispatchers.IO) {
                    TactileCore.nativeImportPaths(dbDir, pathsJson(listOf(path)))
                }
                val diagnostics = org.json.JSONObject(outcome).optJSONArray("diagnostics")
                val notice = if (diagnostics != null && diagnostics.length() > 0) {
                    (0 until diagnostics.length()).joinToString(" ") { diagnostics.getString(it) }
                } else null
                val pubs = withContext(Dispatchers.IO) {
                    parsePublications(TactileCore.nativeListPublications(dbDir))
                }
                withContext(Dispatchers.IO) { primeImmediateCovers(pubs) }
                LibraryUiState(loading = false, pubs = pubs, notice = notice)
            } catch (error: Exception) {
                _state.value.copy(loading = false, error = error.message ?: "falha desconhecida")
            }
        }
    }

    /**
     * Garante a capa do card visível. Capa personalizada ou `coverSrc` já em
     * disco resolve sem JNI; import novo (sem bytes derivados) reconstrói só
     * a primeira página via núcleo, sem tocar no original.
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
                    parseEnsureCover(TactileCore.nativeEnsureCover(dbDir, pub.id, pub.coverPageId))
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

class LibraryViewModelFactory(private val filesDir: File) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return LibraryViewModel(filesDir) as T
    }
}
