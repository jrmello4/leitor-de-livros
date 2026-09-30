package com.jrmello4.tactilereader.reader

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.jrmello4.tactilereader.core.ReaderPage
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4


@RunWith(AndroidJUnit4::class)

class ReaderDeviceInteractionTest {
    @get:Rule val compose = createComposeRule()
    private val pages = (0..4).map { ReaderPage("p$it", it, "$it.png", 800, 1200, null) }

    private fun open(settings: ReaderSettings, events: MutableList<String>, nextTitle: String? = null, onNext: () -> Unit = {}) {
        compose.setContent {
            MaterialTheme {
                ReaderContent(ReaderUiState(loading = false, title = "HQ", pages = pages), {},
                    settings = settings, onProgress = { id, _ -> events.add(id) }, nextTitle = nextTitle, onBingeOpenNext = onNext)
            }
        }
        compose.waitForIdle()
    }

    private fun sideTap(left: Boolean) {
        compose.onRoot().performTouchInput {
            click(Offset(width * if (left) 0.1f else 0.9f, height * 0.5f))
        }
        compose.mainClock.advanceTimeBy(400)
        compose.waitForIdle()
    }

    @Test fun singlePageSideTapSwipeAndZoomHaveDistinctOwnership() {
        val saved = mutableListOf<String>()
        open(ReaderSettings(mode = ReaderMode.SINGLE_PAGE), saved)
        assertEquals("p0", saved.last())
        sideTap(false)
        assertEquals("p1", saved.last())
        compose.onRoot().performTouchInput { swipeLeft() }
        compose.waitForIdle()
        assertEquals("p2", saved.last())
        compose.onRoot().performTouchInput { doubleClick() }
        compose.waitForIdle()
        sideTap(false)
        assertEquals("p2", saved.last())
        compose.onRoot().performTouchInput { swipeLeft() }
        compose.waitForIdle()
        assertEquals("p2", saved.last())
    }

    @Test fun rtlTapsAndSwipesAdvanceTowardIndexZero() {
        val saved = mutableListOf<String>()
        open(ReaderSettings(mode = ReaderMode.SINGLE_PAGE, direction = ReadingDirection.RIGHT_TO_LEFT), saved)
        assertEquals("p4", saved.last())
        sideTap(true)
        assertEquals("p3", saved.last())
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitForIdle()
        assertEquals("p2", saved.last())
    }

    @Test fun doublePagePersistsTheLastPageOfEachSpread() {
        val saved = mutableListOf<String>()
        open(ReaderSettings(mode = ReaderMode.DOUBLE_PAGE), saved)
        assertEquals("p0", saved.last())
        sideTap(false)
        assertEquals("p2", saved.last())
        sideTap(false)
        assertEquals("p4", saved.last())
        sideTap(false)
        assertEquals("p4", saved.last())
    }

    @Test fun pinchZoomConsumesTheGestureWithoutNavigating() {
        val saved = mutableListOf<String>()
        open(ReaderSettings(mode = ReaderMode.SINGLE_PAGE), saved)
        compose.onRoot().performTouchInput {
            down(0, center - Offset(50f, 0f))
            down(1, center + Offset(50f, 0f))
            moveTo(0, center - Offset(100f, 0f))
            moveTo(1, center + Offset(100f, 0f))
            up(0)
            up(1)
        }
        compose.waitForIdle()
        assertEquals("p0", saved.last())
        compose.onRoot().performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(400)
        compose.onNodeWithText("1:1").assertIsDisplayed()
    }

    @Test fun sliderDoesNotSaveIntermediateDragPositions() {
        val saved = mutableListOf<String>()
        open(ReaderSettings(mode = ReaderMode.SINGLE_PAGE), saved)
        compose.onRoot().performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(400)
        val slider = compose.onNodeWithContentDescription("Ir para página")
        val before = saved.size
        slider.performTouchInput {
            down(Offset(width * 0.2f, centerY))
            moveTo(Offset(width * 0.6f, centerY))
            moveTo(Offset(width * 0.8f, centerY))
        }
        compose.waitForIdle()
        assertEquals(before, saved.size)
        slider.performTouchInput { up() }
        compose.waitForIdle()
        assertEquals(before + 1, saved.size)
        assertNotEquals("p0", saved.last())
    }

    @Test fun bingeWaitsUntilNavigationShowsTheCardAndStopsWhenLeaving() {
        val saved = mutableListOf<String>()
        var opened = 0
        open(ReaderSettings(mode = ReaderMode.DOUBLE_PAGE, coverAlone = false), saved, "Próxima HQ") { opened++ }
        compose.mainClock.advanceTimeBy(7000)
        assertEquals(0, opened)
        repeat(3) { sideTap(false) }
        compose.onNodeWithText("Próxima HQ").assertIsDisplayed()
        compose.mainClock.advanceTimeBy(2000)
        sideTap(true)
        compose.mainClock.advanceTimeBy(7000)
        assertEquals(0, opened)
        sideTap(false)
        compose.mainClock.advanceTimeBy(7000)
        compose.waitForIdle()
        assertEquals(1, opened)
    }
}
