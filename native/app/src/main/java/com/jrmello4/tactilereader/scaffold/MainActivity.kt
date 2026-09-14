package com.jrmello4.tactilereader.scaffold

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import com.jrmello4.tactilereader.library.LibraryScreen
import com.jrmello4.tactilereader.library.LibraryViewModel
import com.jrmello4.tactilereader.library.LibraryViewModelFactory

/**
 * Hospeda a estante Compose da fase 3. O conteúdo vem do núcleo via JNI;
 * a primeira abertura gera e importa a HQ de demonstração sozinha.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val factory = LibraryViewModelFactory(filesDir)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                val vm: LibraryViewModel = viewModel(factory = factory)
                LibraryScreen(vm)
            }
        }
    }
}
