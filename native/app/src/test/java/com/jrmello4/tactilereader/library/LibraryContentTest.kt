package com.jrmello4.tactilereader.library

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jrmello4.tactilereader.core.Pub
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Prova na JVM (Robolectric) que a estante renderiza por estado e que o
 * botão "+ HQ" dispara o seletor — sem aparelho, sem JNI.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LibraryContentTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun addButtonFiresHandler() {
        var clicks = 0
        compose.setContent {
            MaterialTheme {
                LibraryContent(LibraryUiState(loading = false), onAddClick = { clicks++ })
            }
        }
        compose.onNodeWithText("+ HQ").performClick()
        assertEquals(1, clicks)
    }

    @Test
    fun gridShowsPublicationTitleAndPages() {
        val pubs = listOf(Pub("p1", "demo-hq", "cbz", 2, 0.0, false))
        compose.setContent {
            MaterialTheme {
                LibraryContent(LibraryUiState(loading = false, pubs = pubs), onAddClick = {})
            }
        }
        compose.onNodeWithText("demo-hq").assertIsDisplayed()
        compose.onNodeWithText("2 páginas").assertIsDisplayed()
    }

    @Test
    fun loadingStateShowsProgressMessage() {
        compose.setContent {
            MaterialTheme {
                LibraryContent(LibraryUiState(loading = true), onAddClick = {})
            }
        }
        compose.onNodeWithText("Lendo biblioteca…").assertIsDisplayed()
    }
}
