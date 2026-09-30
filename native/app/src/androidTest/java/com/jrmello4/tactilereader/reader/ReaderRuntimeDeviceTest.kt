package com.jrmello4.tactilereader.reader

import android.content.Context
import android.graphics.Bitmap
import android.os.Debug
import android.util.Log
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jrmello4.tactilereader.core.ReaderPage
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Exercises the real Coil image path and scrolling on the physical device. */
@RunWith(AndroidJUnit4::class)
class ReaderRuntimeDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val root = File(ApplicationProvider.getApplicationContext<Context>().cacheDir,
        "reader-runtime-${UUID.randomUUID()}").apply { mkdirs() }

    @After fun cleanup() { root.deleteRecursively() }

    private fun pages(count: Int, height: Int = 1200): List<ReaderPage> {
        val bitmap = Bitmap.createBitmap(800, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.BLUE)
        val seed = File(root, "seed.png")
        seed.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        return (0 until count).map { index ->
            val file = File(root, "$index.png")
            seed.copyTo(file)
            ReaderPage("${root.name}-$index", index, file.name, 800, height, file.absolutePath)
        }
    }

    private fun assertRealImage() {
        compose.waitUntil(10000) {
            val pixels = compose.onRoot().captureToImage().toPixelMap()
            val sample = pixels[pixels.width / 2, pixels.height / 2]
            sample.blue > 0.9f && sample.red < 0.1f && sample.green < 0.1f
        }
    }

    @Test fun allModesAndFitsDisplayRealImagesAndKeepTheSavedPage() {
        val pages = pages(8)
        val settings = mutableStateOf(ReaderSettings(mode = ReaderMode.SINGLE_PAGE))
        var position: String? = null
        compose.setContent {
            MaterialTheme {
                key(settings.value.mode, settings.value.fit, settings.value.direction) {
                    ReaderContent(ReaderUiState(loading = false, pages = pages, startPageId = pages[4].id), {},
                        paths = pages.associate { it.id to it.cachePath!! }, settings = settings.value,
                        initialHudVisible = false, onPositionChanged = { id, _ -> position = id })
                }
            }
        }
        for (mode in ReaderMode.values()) for (fit in FitMode.values()) {
            compose.runOnIdle { settings.value = settings.value.copy(mode = mode, fit = fit) }
            compose.waitForIdle()
            assertRealImage()
            compose.runOnIdle { assertEquals("$mode / $fit", pages[4].id, position) }
        }
        compose.runOnIdle { settings.value = ReaderSettings(mode = ReaderMode.SINGLE_PAGE,
            direction = ReadingDirection.RIGHT_TO_LEFT) }
        compose.waitForIdle()
        assertRealImage()
        compose.runOnIdle { assertEquals(pages[4].id, position) }
    }

    @Test fun longWebtoonRendersScrolledPagesWithinMemoryBudget() {
        val pages = pages(120)
        var position = -1
        compose.setContent {
            MaterialTheme {
                ReaderContent(ReaderUiState(loading = false, pages = pages), {},
                    paths = pages.associate { it.id to it.cachePath!! }, settings = ReaderSettings(),
                    initialHudVisible = false, onPositionChanged = { id, _ -> position = pages.indexOfFirst { it.id == id } })
            }
        }
        assertRealImage()
        val baseline = pss()
        var peak = baseline
        repeat(30) {
            compose.onRoot().performTouchInput { swipeUp(durationMillis = 250) }
            compose.waitForIdle()
            if (it % 5 == 0) assertRealImage()
            peak = maxOf(peak, pss())
        }
        compose.runOnIdle { assertTrue("Scrolled page index: $position", position >= 20) }
        val delta = peak - baseline
        Log.i("ReaderRuntimeMemory", "120-page real Coil UI: base=${baseline}KB peak=${peak}KB delta=${delta}KB")
        assertTrue("UI PSS grew by ${delta}KB (budget 120 MiB)", delta < 120 * 1024)
    }

    @Test fun volumeEventsAdvanceAndReturnInAllModesIncludingRtl() {
        val pages = pages(8)
        val settings = mutableStateOf(ReaderSettings())
        var position: String? = null
        compose.setContent {
            MaterialTheme {
                key(settings.value.mode, settings.value.direction) {
                    ReaderContent(ReaderUiState(loading = false, pages = pages), {},
                        paths = pages.associate { it.id to it.cachePath!! }, settings = settings.value,
                        initialHudVisible = false, onPositionChanged = { id, _ -> position = id })
                }
            }
        }
        for (direction in ReadingDirection.values()) for (mode in ReaderMode.values()) {
            compose.runOnIdle { settings.value = ReaderSettings(mode = mode, direction = direction) }
            compose.waitForIdle()
            val start = if (direction == ReadingDirection.LEFT_TO_RIGHT) 0 else 7
            compose.runOnIdle { assertEquals(pages[start].id, position); VolumeScrollBus.emit(1) }
            compose.waitForIdle()
            val step = if (mode == ReaderMode.DOUBLE_PAGE) 2 else 1
            val target = if (direction == ReadingDirection.LEFT_TO_RIGHT) step else 7 - step
            compose.runOnIdle { assertEquals("$mode / $direction forward", pages[target].id, position); VolumeScrollBus.emit(-1) }
            compose.waitForIdle()
            compose.runOnIdle { assertEquals("$mode / $direction back", pages[start].id, position) }
        }
    }

    @Test fun loadingThenReadyRestoresRealLongPageScrollOffset() {
        val pages = pages(4, height = 2800)
        val state = mutableStateOf(ReaderUiState())
        var position: Pair<String, Double>? = null
        compose.setContent {
            MaterialTheme {
                ReaderContent(state.value, {}, paths = pages.associate { it.id to it.cachePath!! },
                    initialHudVisible = false, onPositionChanged = { id, ratio -> position = id to ratio })
            }
        }
        compose.runOnIdle { state.value = ReaderUiState(loading = false, pages = pages,
            startPageId = pages[0].id, startRatio = 0.6) }
        compose.waitForIdle()
        assertRealImage()
        compose.runOnIdle {
            assertEquals(pages[0].id, position?.first)
            assertEquals(0.6, position?.second ?: -1.0, 0.01)
        }
    }

    private fun pss(): Int = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }.totalPss
}
