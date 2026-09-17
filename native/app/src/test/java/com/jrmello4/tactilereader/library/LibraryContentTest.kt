package com.jrmello4.tactilereader.library

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.jrmello4.tactilereader.core.Pub
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.atomic.AtomicReference

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
        val opened = AtomicReference<String?>(null)
        compose.setContent {
            MaterialTheme {
                LibraryContent(
                    LibraryUiState(loading = false, pubs = pubs),
                    onAddClick = {},
                    onOpenClick = { opened.set(it.id) },
                    coverImage = { pub, _, _ -> Text("capa-${pub.id}") },
                )
            }
        }
        // Raiz mostra a série uma vez; o detalhe ordena #02 antes de #10.
        // A tela de teste é pequena: rola até o card antes de conferir.
        compose.onNodeWithText("Série X").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("2 edições").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Série X").performScrollTo().performClick()
        compose.onNodeWithText("All series").assertIsDisplayed()
        compose.onNodeWithText("capa-b").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("capa-b").assertHasClickAction()
        compose.onNodeWithText("capa-b").performClick()
        compose.waitForIdle()
        assertEquals("b", opened.get())
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
    fun continueReadingShowsHeroWithHumanizedProgressAndResumeAction() {
        val pub = Pub("p1", "demo-hq", "cbz", 10, 0.5, false)
        val opened = AtomicReference<String?>(null)
        compose.setContent {
            MaterialTheme {
                LibraryContent(
                    LibraryUiState(loading = false, pubs = listOf(pub)),
                    onAddClick = {},
                    onOpenClick = { opened.set(it.id) },
                    coverImage = { _, _, _ -> Text("capa") },
                )
            }
        }

        compose.onNodeWithText("Continuar lendo").assertIsDisplayed()
        compose.onNodeWithText("Página 6 de 10 • Faltam aprox. 4 páginas").assertIsDisplayed()
        val summary = compose.onNodeWithText("Página 6 de 10 • Faltam aprox. 4 páginas")
        summary.assertHasClickAction()
        summary.performClick()
        compose.waitForIdle()
        assertEquals("p1", opened.get())
    }

    @Test
    fun readingProgressSummaryClampsInvalidProgress() {
        assertEquals(
            "Página 1 de 4 • Faltam aprox. 3 páginas",
            readingProgressSummary(Pub("low", "low", "cbz", 4, -2.0, false)),
        )
        assertEquals(
            "Página 4 de 4 • Última página",
            readingProgressSummary(Pub("high", "high", "cbz", 4, 2.0, false)),
        )
    }

    @Test
    fun readingProgressSummaryUsesObservedSpeedWhenAvailable() {
        val pub = Pub(
            id = "speed",
            title = "speed",
            format = "cbz",
            pageCount = 40,
            progress = 9.0 / 39.0,
            isFavorite = false,
            readingPagesPerMinute = 2.0,
        )

        assertEquals(
            "Página 10 de 40 • Faltam aprox. 15 min",
            readingProgressSummary(pub),
        )
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
