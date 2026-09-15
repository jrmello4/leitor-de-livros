package com.jrmello4.tactilereader.core

import com.jrmello4.tactilereader.library.resolveImmediateCover
import com.jrmello4.tactilereader.reader.resolveImmediatePage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Prova na JVM as resoluções "sem reconstruir": capa personalizada >
 * coverSrc já materializado; página só quando o arquivo existe mesmo.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ResolveHelpersTest {
    @Test
    fun coverPrefersCustomThenCoverSrc() {
        val pub = Pub(
            id = "p1",
            title = "HQ",
            format = "cbz",
            pageCount = 2,
            progress = 0.0,
            isFavorite = false,
            coverSrc = "/cache/cover.png",
            customCoverPath = "/cache/custom.png",
        )
        assertEquals("/cache/custom.png", resolveImmediateCover(pub) { true })
        assertEquals(
            "/cache/cover.png",
            resolveImmediateCover(pub) { it == "/cache/cover.png" },
        )
        assertNull(resolveImmediateCover(pub) { false })
    }

    @Test
    fun coverIgnoresBlankOrMissingFiles() {
        val blank = Pub("p1", "HQ", "cbz", 2, 0.0, false, coverSrc = "  ")
        assertNull(resolveImmediateCover(blank) { true })
        val missing = Pub("p1", "HQ", "cbz", 2, 0.0, false, coverSrc = "/nope.png")
        assertNull(resolveImmediateCover(missing) { false })
    }

    @Test
    fun pageResolvesOnlyWhenFileExists() {
        val page = ReaderPage("pg1", 0, "001.png", 800, 1200, "/cache/pg1.png")
        assertEquals("/cache/pg1.png", resolveImmediatePage(page) { true })
        assertNull(resolveImmediatePage(page) { false })
        val blank = ReaderPage("pg1", 0, "001.png", 800, 1200, null)
        assertNull(resolveImmediatePage(blank) { true })
    }
}
