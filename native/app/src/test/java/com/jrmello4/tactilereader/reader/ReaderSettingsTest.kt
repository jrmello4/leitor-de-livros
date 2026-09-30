package com.jrmello4.tactilereader.reader

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReaderSettingsTest {
    @Test fun settingsSurviveStoreRecreationAndUnknownValuesFallBack() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences("reader-settings", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        assertEquals(ReaderSettings(), ReaderSettingsStore(context).load())
        val selected = ReaderSettings(ReaderMode.DOUBLE_PAGE, ReadingDirection.RIGHT_TO_LEFT, FitMode.FIT_HEIGHT,
            false, ReaderOrientation.LANDSCAPE, ReaderBackground.WHITE, false)
        ReaderSettingsStore(context).save(selected)
        assertEquals(selected, ReaderSettingsStore(context).load())
        prefs.edit().putString("mode", "future-mode").commit()
        assertEquals(ReaderMode.WEBTOON, ReaderSettingsStore(context).load().mode)
    }
}
