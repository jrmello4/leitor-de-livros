package com.jrmello4.tactilereader.reader

import android.content.Context
import android.os.SystemClock
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.core.TestComic
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Uses real ViewModel dispatch and SQLite, including RTL publications without resume state. */
@RunWith(AndroidJUnit4::class)
class ReaderMetricsDeviceTest {
    private val root = File(ApplicationProvider.getApplicationContext<Context>().cacheDir,
        "reader-metrics-${UUID.randomUUID()}").apply { mkdirs() }
    private val owner = object : ViewModelStoreOwner { override val viewModelStore = ViewModelStore() }
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @After fun cleanup() {
        instrumentation.runOnMainSync { owner.viewModelStore.clear() }
        LibraryDb.closeAll()
        root.deleteRecursively()
    }

    private fun verifySession(direction: ReadingDirection, restored: Boolean) {
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val comic = TestComic.generate(File(root, "seed"))
        assertEquals(1, db.importPaths(listOf(comic.absolutePath)).importedCount)
        val pub = db.publications.list().single()
        val pages = db.listPages(pub.id)
        db.setReadingDirection(pub.id, direction.value)
        val start = if (direction == ReadingDirection.LEFT_TO_RIGHT) pages.first() else pages.last()
        val end = if (direction == ReadingDirection.LEFT_TO_RIGHT) pages.last() else pages.first()
        if (restored) db.saveReaderState(pub.id, start.id, 0.4)
        lateinit var model: ReaderViewModel
        instrumentation.runOnMainSync {
            model = ViewModelProvider(owner, ReaderViewModelFactory(root, pub.id, pub.title))[ReaderViewModel::class.java]
        }
        await { !model.state.value.loading }
        assertNull(model.state.value.error)
        assertEquals(direction, model.state.value.direction)
        instrumentation.runOnMainSync { model.saveProgress(start.id, 0.0); model.saveProgress(end.id, 0.0); model.finishSession() }
        await { db.loadReaderState(pub.id)?.pageId == end.id }
        await { db.loadReadingStats(pub.id) != null }
        val stats = db.loadReadingStats(pub.id)!!
        assertEquals(1, stats.pagesRead)
        assertEquals(1, stats.sessions)
        assertTrue(stats.totalMillis > 0)
        instrumentation.runOnMainSync { model.finishSession() }
        instrumentation.waitForIdleSync()
        assertEquals("Finishing twice must not count the session twice", 1, db.loadReadingStats(pub.id)!!.sessions)
    }

    @Test fun newRtlPublicationCountsForwardReading() = verifySession(ReadingDirection.RIGHT_TO_LEFT, false)
    @Test fun resumedRtlPublicationCountsForwardReading() = verifySession(ReadingDirection.RIGHT_TO_LEFT, true)
    @Test fun newLtrPublicationCountsForwardReading() = verifySession(ReadingDirection.LEFT_TO_RIGHT, false)

    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 10000
        while (!condition() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(20)
        assertTrue("Timed out waiting for reader persistence", condition())
    }
}
