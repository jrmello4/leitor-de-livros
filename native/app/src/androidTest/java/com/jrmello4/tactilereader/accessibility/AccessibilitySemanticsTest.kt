package com.jrmello4.tactilereader.accessibility

import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
    fun navigationIconsHaveContentDescriptions() {
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Estante").assertIsDisplayed()
        compose.onNodeWithContentDescription("Marcadores").assertIsDisplayed()
        compose.onNodeWithContentDescription("Minha leitura").assertIsDisplayed()
        compose.onNodeWithContentDescription("Ajustes").assertIsDisplayed()
    }

    @Test
    fun floatingActionButtonHasMinimumTouchTarget48dp() {
        compose.waitForIdle()
        // O FAB de adicionar/importar na Estante
        val fab = compose.onNodeWithContentDescription("Importar HQs")
        fab.assertIsDisplayed()
        fab.assertWidthIsAtLeast(48.dp)
        fab.assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun settingsScreenHeadingsAndActionButtonsMeetAccessibilityTarget() {
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Ajustes").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("Ajustes e dados").assertIsDisplayed()

        // Botões de ação em Ajustes com toque de 48dp mínimo
        val checkButton = compose.onNodeWithText("Verificar atualizações")
        checkButton.assertIsDisplayed()
        checkButton.assertHeightIsAtLeast(48.dp)
    }
}
