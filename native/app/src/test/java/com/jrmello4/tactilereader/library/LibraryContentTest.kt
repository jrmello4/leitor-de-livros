package com.jrmello4.tactilereader.library

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
    fun folderButtonFiresHandler() {
        var clicks = 0
        compose.setContent {
            MaterialTheme {
                LibraryContent(
                    LibraryUiState(loading = false),
                    onAddClick = {},
                    onAddFolderClick = { clicks++ },
                )
            }
        }
        compose.onNodeWithText("+ Pasta").performClick()
        assertEquals(1, clicks)
    }

    @Test
    fun seriesRootOpensDetailWithOrderedEditions() {
        val pubs = listOf(
            Pub("a", "Série X #10", "cbz", 20, 0.0, false),
            Pub("b", "Série X #02", "cbz", 20, 0.0, false),
        )
        var opened: String? = null
        compose.setContent {
            MaterialTheme {
                LibraryContent(
                    LibraryUiState(loading = false, pubs = pubs),
                    onAddClick = {},
                    onOpenClick = { opened = it.id },
                    coverImage = { pub, _, _ -> Text("capa-${pub.id}") },
                )
            }
        }
        // Raiz mostra a série uma vez; o detalhe ordena #02 antes de #10.
        compose.onNodeWithText("Série X").assertIsDisplayed()
        compose.onNodeWithText("2 edições").assertIsDisplayed()
        compose.onNodeWithText("Série X").performClick()
        compose.onNodeWithText("‹ All series").assertIsDisplayed()
        compose.onNodeWithText("capa-b").assertIsDisplayed()
        compose.onNodeWithText("capa-b").performClick()
        assertEquals("b", opened)
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

    @Test
    fun missingCoverRequestsEnsureAndKeepsPlaceholder() {
        val pub = Pub("p1", "nova-hq", "cbz", 2, 0.0, false, "p1-page-0", null, null)
        var requested: String? = null
        compose.setContent {
            MaterialTheme {
                LibraryContent(
                    LibraryUiState(loading = false, pubs = listOf(pub)),
                    onAddClick = {},
                    covers = emptyMap(),
                    onCoverVisible = { requested = it.id },
                    coverImage = { _, file, _ ->
                        // Slot fake: prova que sem arquivo o placeholder segue visível.
                        androidx.compose.material3.Text(if (file == null) "sem-capa" else "com-capa")
                    },
                )
            }
        }
        compose.onNodeWithText("sem-capa").assertIsDisplayed()
        assertEquals("p1", requested)
    }

    @Test
    fun presentCoverRendersImageSlotWithoutRequestingEnsure() {
        val pub = Pub("p1", "demo-hq", "cbz", 2, 0.0, false, "p1-page-0", "/cache/cover.png", null)
        var requested: String? = null
        compose.setContent {
            MaterialTheme {
                LibraryContent(
                    LibraryUiState(loading = false, pubs = listOf(pub)),
                    onAddClick = {},
                    covers = mapOf("p1" to "/cache/cover.png"),
                    onCoverVisible = { requested = it.id },
                    coverImage = { _, file, _ ->
                        androidx.compose.material3.Text(if (file == null) "sem-capa" else "com-capa")
                    },
                )
            }
        }
        compose.onNodeWithText("com-capa").assertIsDisplayed()
        assertEquals(null, requested)
    }

    @Test
    fun placeholderColorIsStable() {
        assertEquals(placeholderColor("demo-hq"), placeholderColor("demo-hq"))
    }
}
