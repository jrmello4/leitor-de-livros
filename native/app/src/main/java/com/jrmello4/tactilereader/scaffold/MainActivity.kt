package com.jrmello4.tactilereader.scaffold

import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import com.jrmello4.tactilereader.library.LibraryScreen
import com.jrmello4.tactilereader.library.LibraryViewModel
import com.jrmello4.tactilereader.library.LibraryViewModelFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * Hospeda a estante Compose da fase 3. O conteúdo vem do núcleo via JNI;
 * a primeira abertura gera e importa a HQ de demonstração sozinha.
 * O botão "+ HQ" abre o seletor do sistema (SAF) e importa o arquivo
 * escolhido sem tocar no original.
 */
class MainActivity : ComponentActivity() {
    private lateinit var viewModel: LibraryViewModel

    private val pickComic = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            lifecycleScope.launch {
                val path = withContext(Dispatchers.IO) { copyPickedFile(uri)?.absolutePath }
                if (path != null) {
                    viewModel.importFile(path)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val factory = LibraryViewModelFactory(filesDir)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                viewModel = viewModel(factory = factory)
                LibraryScreen(viewModel, onAddClick = { pickComic.launch(arrayOf("*/*")) })
            }
        }
    }

    private fun copyPickedFile(uri: Uri): File? {
        val displayName = contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst() && index >= 0) cursor.getString(index) else null
        } ?: "hq-importada"
        val safe = displayName.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val target = File(File(filesDir, "imports").apply { mkdirs() }, "${System.currentTimeMillis()}-$safe")
        return try {
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            } ?: return null
            target
        } catch (error: Exception) {
            target.delete()
            null
        }
    }
}
