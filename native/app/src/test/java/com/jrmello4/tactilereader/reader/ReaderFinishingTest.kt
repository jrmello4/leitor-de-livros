package com.jrmello4.tactilereader.reader

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.jrmello4.tactilereader.core.ReaderPage
import com.jrmello4.tactilereader.core.ReadingStateRules
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** Regressions at the boundary between stable reader chrome and keyed navigation. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReaderFinishingTest {
    @get:Rule val compose = createComposeRule()
    private val pages = (0..99).map { ReaderPage("p$it", it, "$it.png", 800, 1200, null) }

    @Test fun sheetAndHudSurviveModeDirectionCoverAndAppearanceChanges() {
        val settings = mutableStateOf(ReaderSettings(mode = ReaderMode.SINGLE_PAGE))
        val state = mutableStateOf(ReaderUiState(loading = false, title = "HQ", pages = pages, startPageId = "p49"))
        val saved = mutableListOf<String>()
        compose.setContent {
            MaterialTheme {
                ReaderContent(state.value, {}, settings = settings.value, initialHudVisible = true,
                    onSettingsChange = { settings.value = it; state.value = state.value.copy(direction = it.direction) },
                    onPositionChanged = { id, ratio -> state.value = state.value.copy(startPageId = id, startRatio = ratio) },
                    onProgress = { id, _ -> saved.add(id) })
            }
        }
        compose.onNodeWithText("Zoom").performClick()
        compose.onNodeWithText("1:1").assertIsDisplayed()
        compose.onNodeWithContentDescription("Configurações de leitura").performClick()
        fun choose(label: String) {
            compose.onNodeWithText(label).performScrollTo().performClick()
            compose.onNodeWithText("Configurações de leitura").assertExists()
        }
        choose("Página dupla")
        compose.onNodeWithContentDescription("Exibir capa separadamente").performScrollTo().performClick()
        compose.onNodeWithText("Configurações de leitura").assertExists()
        choose("Direita → esquerda")
        choose("Esquerda → direita")
        choose("Ajustar à largura")
        choose("Cinza escuro")
        choose("Vertical")
        choose("Webtoon")
        compose.onNodeWithText("Concluir").performScrollTo().performClick()
        compose.onNodeWithText("Configurações de leitura").assertDoesNotExist()
        compose.onNodeWithText("HQ").assertIsDisplayed()
        compose.onNodeWithText("Zoom").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(ReaderMode.WEBTOON, settings.value.mode)
            assertEquals("p49", state.value.startPageId)
            assertTrue(saved.all { it in setOf("p48", "p49", "p50") })
        }
    }

    @Test fun currentPageStaysInItsSpreadForAllModesDirectionsAndCoverPolicies() {
        val settings = mutableStateOf(ReaderSettings(mode = ReaderMode.SINGLE_PAGE))
        val state = mutableStateOf(ReaderUiState(loading = false, pages = pages, startPageId = "p49"))
        compose.setContent {
            MaterialTheme {
                ReaderContent(state.value, {}, settings = settings.value, initialHudVisible = false,
                    onPositionChanged = { id, ratio -> state.value = state.value.copy(startPageId = id, startRatio = ratio) })
            }
        }
        for (direction in ReadingDirection.entries) for (cover in listOf(true, false)) for (mode in ReaderMode.entries) {
            compose.runOnIdle {
                // A known physical page ID is the screen's anchor, independent of file-order direction.
                state.value = state.value.copy(startPageId = "p49", startRatio = 0.0, direction = direction)
                settings.value = settings.value.copy(mode = mode, direction = direction, coverAlone = cover)
            }
            compose.waitForIdle()
            compose.runOnIdle {
                val current = pages.first { it.id == state.value.startPageId }
                assertTrue("$mode/$direction/$cover lost page 50: ${current.index}", kotlin.math.abs(current.index - 49) <= 1)
                assertFalse(ReadingStateRules.isFinished(current.index, pages.size, direction.value))
            }
        }
    }

    @Test fun anotherSettingDoesNotOverwriteDirectionWhileItsSaveIsPending() {
        val requested = mutableStateOf(ReaderSettings(mode = ReaderMode.SINGLE_PAGE))
        val committed = mutableStateOf(ReadingDirection.LEFT_TO_RIGHT)
        compose.setContent {
            MaterialTheme {
                ReaderContent(ReaderUiState(loading = false, pages = pages), {}, initialHudVisible = true,
                    settings = requested.value.copy(direction = committed.value), settingsForSheet = requested.value,
                    onSettingsChange = { requested.value = it })
            }
        }
        compose.onNodeWithContentDescription("Configurações de leitura").performClick()
        compose.onNodeWithText("Direita → esquerda").performScrollTo().performClick()
        compose.onNodeWithText("Ajustar à largura").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals(ReadingDirection.RIGHT_TO_LEFT, requested.value.direction)
            assertEquals(FitMode.FIT_WIDTH, requested.value.fit)
            committed.value = requested.value.direction
        }
        compose.onNodeWithText("Configurações de leitura").assertExists()
    }

    @Test fun fittedPageHasOneAccessiblePageDescription() {
        val file = File.createTempFile("reader-semantics", ".png")
        val fitted = mutableStateOf(true)
        try {
            compose.setContent {
                MaterialTheme {
                    if (fitted.value) {
                        ReaderFittedImage(pages[14], file, ReaderSettings(mode = ReaderMode.SINGLE_PAGE), Modifier)
                    } else DefaultPageImage(pages[14], file)
                }
            }
            val page = compose.onAllNodesWithContentDescription("Página 15", useUnmergedTree = true)
            page.assertCountEquals(1)
            assertEquals(listOf("Página 15"), page.fetchSemanticsNodes().single().config[SemanticsProperties.ContentDescription])
            compose.runOnIdle { fitted.value = false }
            compose.onAllNodesWithContentDescription("Página 15", useUnmergedTree = true).assertCountEquals(1)
            compose.onNodeWithText("15", useUnmergedTree = true).assertDoesNotExist()
        } finally { file.delete() }
    }
}
