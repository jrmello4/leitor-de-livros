package com.jrmello4.tactilereader.navigation

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.Role
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jrmello4.tactilereader.scaffold.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Teste instrumentado de navegação estrutural:
 * Garante que a barra inferior transiciona de modo fluido e correto entre
 * Estante, Marcadores, Minha leitura e Ajustes.
 */
@RunWith(AndroidJUnit4::class)
class AppNavigationTest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun bottomNavigationSwitchesBetweenMainScreens() {
        // 1. Tela inicial padrão: Estante
        compose.waitForIdle()
        compose.onNodeWithText("Estante").assertIsDisplayed()

        // 2. Navegar para Marcadores
        compose.onNodeWithText("Marcadores").performClick()
        compose.waitForIdle()
        compose.onNode(hasText("Marcadores") and SemanticsMatcher.expectValue(SemanticsProperties.Heading, Unit)).assertIsDisplayed()

        // 3. Navegar para Minha leitura (Métricas)
        compose.onNodeWithText("Leitura").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Minha leitura").assertIsDisplayed()

        // 4. Navegar para Ajustes
        compose.onNodeWithText("Ajustes").performClick()
        compose.waitForIdle()
        compose.onNode(hasText("Ajustes") and SemanticsMatcher.expectValue(SemanticsProperties.Heading, Unit)).assertIsDisplayed()

        // 5. Voltar para Estante
        compose.onNode(hasText("Estante") and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Estante").assertIsDisplayed()
    }
}
