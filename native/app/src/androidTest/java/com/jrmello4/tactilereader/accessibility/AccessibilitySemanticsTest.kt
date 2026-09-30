package com.jrmello4.tactilereader.accessibility

import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jrmello4.tactilereader.scaffold.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Teste de acessibilidade e semântica TalkBack:
 * Garante alvos de toque mínimos de 48dp em botões essenciais,
 * descrições textuais em ícones de navegação e semântica clara.
 */
@RunWith(AndroidJUnit4::class)
class AccessibilitySemanticsTest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun navigationTabsHaveAccessibleLabels() {
        compose.waitForIdle()
        // Material navigation merges the visible label into the actionable tab.
        compose.onNodeWithText("Estante").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Marcadores").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Leitura").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Ajustes").assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun floatingActionButtonHasMinimumTouchTarget48dp() {
        compose.waitForIdle()
        // O FAB de adicionar/importar na Estante
        val fab = compose.onNodeWithText("Importar")
        fab.assertIsDisplayed()
        fab.assertWidthIsAtLeast(48.dp)
        fab.assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun settingsScreenHeadingsAndActionButtonsMeetAccessibilityTarget() {
        compose.waitForIdle()
        compose.onNodeWithText("Ajustes").performClick()
        compose.waitForIdle()

        compose.onNode(hasText("Ajustes") and SemanticsMatcher.expectValue(SemanticsProperties.Heading, Unit)).assertIsDisplayed()

        // Botões de ação em Ajustes com toque de 48dp mínimo
        val checkButton = compose.onNodeWithText("Verificar").performScrollTo()
        checkButton.assertIsDisplayed()
        checkButton.assertHeightIsAtLeast(48.dp)
    }
}
