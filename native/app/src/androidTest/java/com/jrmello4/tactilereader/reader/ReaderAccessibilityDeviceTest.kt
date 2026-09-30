package com.jrmello4.tactilereader.reader

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReaderAccessibilityDeviceTest {
    @get:Rule val compose = createComposeRule()

    @Test fun hudControlsKeepTouchTargetsWithDoubleSizeSystemFont() {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                MaterialTheme {
                    ReaderControls("Título comprido da publicação", 1f, 200, 400, true, false, {}, {}, {})
                }
            }
        }
        compose.onNodeWithContentDescription("Configurações de leitura").assertIsDisplayed()
            .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        compose.onNodeWithContentDescription("Marcar página").assertIsDisplayed()
            .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        val slider = compose.onNodeWithContentDescription("Ir para página").assertIsDisplayed().fetchSemanticsNode()
        org.junit.Assert.assertTrue("Slider touch height: ${slider.touchBoundsInRoot.height}px",
            slider.touchBoundsInRoot.height >= 48f * compose.density.density)
        compose.onNodeWithText("página 200 de 400").assertIsDisplayed()
    }

    @Test fun settingsRemainScrollableAndOperableWithDoubleSizeFont() {
        var changed: ReaderSettings? = null
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                MaterialTheme { ReaderSettingsSheet(ReaderSettings(), { changed = it }, {}) }
            }
        }
        compose.onNodeWithText("Página única").performScrollTo().performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(ReaderMode.SINGLE_PAGE, changed?.mode) }
        compose.onNodeWithContentDescription("Manter tela ligada").performScrollTo().assertIsDisplayed()
            .assertHeightIsAtLeast(48.dp).performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(false, changed?.keepScreenOn) }
    }
}
