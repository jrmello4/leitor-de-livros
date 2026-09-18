package com.jrmello4.tactilereader.navigation

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
        compose.onNodeWithContentDescription("Marcadores").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Central de marcadores").assertIsDisplayed()

        // 3. Navegar para Minha leitura (Métricas)
        compose.onNodeWithContentDescription("Minha leitura").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Minha leitura").assertIsDisplayed()

        // 4. Navegar para Ajustes
        compose.onNodeWithContentDescription("Ajustes").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Ajustes e dados").assertIsDisplayed()

        // 5. Voltar para Estante
        compose.onNodeWithContentDescription("Estante").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Estante").assertIsDisplayed()
    }
}
