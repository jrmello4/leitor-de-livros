package com.jrmello4.tactilereader.reader

import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jrmello4.tactilereader.core.ReaderPage
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReaderLifecycleDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun leavingReaderRestoresOrientationAndKeepScreenOn() {
        val reading = mutableStateOf(true)
        var readerView: android.view.View? = null
        compose.setContent {
            MaterialTheme {
                if (reading.value) {
                    readerView = LocalView.current
                    ReaderContent(ReaderUiState(loading = false), {}, settings = ReaderSettings(
                        orientation = ReaderOrientation.PORTRAIT), initialHudVisible = false)
                } else Text("Library")
            }
        }
        compose.waitForIdle()
        compose.runOnIdle {
            assertTrue(readerView!!.keepScreenOn)
            assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT, compose.activity.requestedOrientation)
            reading.value = false
        }
        compose.waitForIdle()
        compose.runOnIdle {
            assertFalse(readerView!!.keepScreenOn)
            assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, compose.activity.requestedOrientation)
        }
    }

    @Test fun backgroundingCancelsBingeUntilReaderResumes() {
        val pages = (0..2).map { ReaderPage("binge-$it", it, "$it.png", 800, 1200) }
        var opened = 0
        compose.setContent {
            MaterialTheme {
                ReaderContent(ReaderUiState(loading = false, pages = pages), {},
                    settings = ReaderSettings(mode = ReaderMode.SINGLE_PAGE), nextTitle = "Next comic",
                    onBingeOpenNext = { opened++ })
            }
        }
        repeat(3) {
            compose.runOnIdle { VolumeScrollBus.emit(1) }
            compose.waitForIdle()
        }
        compose.onNodeWithText("Next comic").assertIsDisplayed()
        compose.mainClock.advanceTimeBy(2000)
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.mainClock.advanceTimeBy(10000)
        assertEquals(0, opened)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.mainClock.advanceTimeBy(7000)
        compose.waitForIdle()
        assertEquals(1, opened)
    }
}
