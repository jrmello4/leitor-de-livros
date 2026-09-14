package com.jrmello4.tactilereader.reader

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jrmello4.tactilereader.core.ReaderPage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Prova na JVM (Robolectric) que a faixa renderiza por estado, pede os
 * bytes da página visível sob demanda e alterna o HUD no toque —
 * sem aparelho, sem JNI.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReaderContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val pages = listOf(
        ReaderPage("p-page-0", 0, "001.png", 800, 1200, null),
        ReaderPage("p-page-1", 1, "002.png", 800, 1200, "/cache/p1.png"),
    )

    @Test
    fun loadingStateShowsOpeningMessage() {
        compose.setContent {
            MaterialTheme {
                ReaderContent(ReaderUiState(loading = true), onBack = {})
            }
        }
        compose.onNodeWithText("Abrindo HQ…").assertIsDisplayed()
    }

    @Test
    fun missingPageRequestsEnsureAndKeepsPlaceholder() {
        val requested = mutableSetOf<String>()
        compose.setContent {
            MaterialTheme {
                ReaderContent(
                    ReaderUiState(loading = false, title = "demo", pages = pages),
                    onBack = {},
                    paths = emptyMap(),
                    onPageVisible = { requested.add(it.id) },
                    pageImage = { page, file, _ ->
                        Text(if (file == null) "sem-bytes-${page.id}" else "com-bytes-${page.id}")
                    },
                )
            }
        }
        compose.onNodeWithText("sem-bytes-p-page-0").assertIsDisplayed()
        compose.onNodeWithText("sem-bytes-p-page-1").assertIsDisplayed()
        assertEquals(setOf("p-page-0", "p-page-1"), requested)
    }

    @Test
    fun presentPathRendersWithoutRequestingEnsure() {
        var requested: String? = null
        compose.setContent {
            MaterialTheme {
                ReaderContent(
                    ReaderUiState(loading = false, title = "demo", pages = pages),
                    onBack = {},
                    paths = mapOf("p-page-1" to "/cache/p1.png"),
                    onPageVisible = { requested = it.id },
                    pageImage = { page, file, _ ->
                        Text(if (file == null) "sem-bytes" else "com-bytes-${page.id}")
                    },
                )
            }
        }
        compose.onNodeWithText("com-bytes-p-page-1").assertIsDisplayed()
        // A primeira página visível sem bytes ainda pede; a garantida não.
        assertEquals("p-page-0", requested)
    }

    @Test
    fun tapTogglesHud() {
        compose.setContent {
            MaterialTheme {
                ReaderContent(
                    ReaderUiState(loading = false, title = "demo-hq", pages = pages),
                    onBack = {},
                    pageImage = { page, _, _ -> Text("pagina-${page.id}") },
                )
            }
        }
        compose.onNodeWithText("demo-hq").assertIsDisplayed()
        compose.onNodeWithText("pagina-p-page-0").performClick()
        assertEquals(0, compose.onAllNodesWithText("demo-hq").fetchSemanticsNodes().size)
        compose.onNodeWithText("pagina-p-page-0").performClick()
        compose.onNodeWithText("demo-hq").assertIsDisplayed()
    }

    @Test
    fun folioShowsPosition() {
        compose.setContent {
            MaterialTheme {
                ReaderContent(
                    ReaderUiState(loading = false, title = "demo", pages = pages),
                    onBack = {},
                    pageImage = { page, _, _ -> Text("pagina-${page.id}") },
                )
            }
        }
        compose.onNodeWithText("página 1 de 2").assertIsDisplayed()
    }

    @Test
    fun backButtonFiresHandler() {
        var backs = 0
        compose.setContent {
            MaterialTheme {
                ReaderContent(
                    ReaderUiState(loading = false, title = "demo", pages = pages),
                    onBack = { backs++ },
                    pageImage = { page, _, _ -> Text("pagina-${page.id}") },
                )
            }
        }
        compose.onNodeWithText("‹ Biblioteca").performClick()
        assertEquals(1, backs)
    }
}
