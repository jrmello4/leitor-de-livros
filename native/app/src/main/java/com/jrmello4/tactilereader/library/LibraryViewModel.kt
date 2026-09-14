package com.jrmello4.tactilereader.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jrmello4.tactilereader.core.TactileCore
import com.jrmello4.tactilereader.core.TestComic
import com.jrmello4.tactilereader.core.parsePublications
import com.jrmello4.tactilereader.core.Pub
import com.jrmello4.tactilereader.core.pathsJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

data class LibraryUiState(
    val loading: Boolean = true,
    val pubs: List<Pub> = emptyList(),
    val error: String? = null,
)

/**
 * Estante lendo do núcleo via JNI, sempre fora da thread principal.
 * Na primeira abertura com biblioteca vazia, gera e importa a HQ de
 * demonstração para provar o pipeline importar→listar no aparelho.
 */
class LibraryViewModel(private val filesDir: File) : ViewModel() {
    private val dbDir: String = File(filesDir, "lib").absolutePath
    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        _state.value = LibraryUiState(loading = true)
        viewModelScope.launch {
            _state.value = try {
                val pubs = withContext(Dispatchers.IO) { loadOrSeed() }
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
}

class LibraryViewModelFactory(private val filesDir: File) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return LibraryViewModel(filesDir) as T
    }
}
