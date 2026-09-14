package com.jrmello4.tactilereader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A faixa de leitura lista só metadados e garante bytes por página visível;
 * o progresso `{pageId, scrollRatio}` volta ao reabrir.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReaderJsonTest {
    @Test
    fun parsesPagesInNaturalOrder() {
        val json = """
            {"pages":[
                {"id":"p-page-1","index":1,"name":"002.png","width":800,"height":1200,"cachePath":""},
                {"id":"p-page-0","index":0,"name":"001.png","width":800,"height":1200,"cachePath":null}
            ]}
        """.trimIndent()
        val pages = parseReaderPages(json)
        assertEquals(2, pages.size)
        assertEquals("p-page-0", pages[0].id)
        assertEquals("p-page-1", pages[1].id)
        assertNull(pages[0].cachePath)
    }

    @Test
    fun keepsMaterializedCachePathWhenPresent() {
        val json = """
            {"pages":[
                {"id":"p-page-0","index":0,"name":"001.png","width":800,"height":1200,"cachePath":"/data/p0.png"}
            ]}
        """.trimIndent()
        assertEquals("/data/p0.png", parseReaderPages(json)[0].cachePath)
    }

    @Test(expected = IllegalStateException::class)
    fun pagesErrorThrows() {
        parseReaderPages("""{"error":"unknown publication"}""")
    }

    @Test
    fun parseEnsurePageReturnsPath() {
        assertEquals("/cache/p1.png", parseEnsurePage("""{"pageSrc":"/cache/p1.png","width":800,"height":1200}"""))
    }

    @Test
    fun parseEnsurePageBlankIsNull() {
        assertNull(parseEnsurePage("""{"pageSrc":""}"""))
    }

    @Test(expected = IllegalStateException::class)
    fun parseEnsurePageErrorThrows() {
        parseEnsurePage("""{"error":"page does not belong to the publication"}""")
    }

    @Test
    fun nullStateMeansStartFromFirstPage() {
        assertNull(parseReaderState("""{"state":null}"""))
    }

    @Test
    fun parsesSavedProgress() {
        val progress = parseReaderState("""{"state":{"pageId":"p-page-3","scrollRatio":0.5}}""")
        assertEquals("p-page-3", progress?.pageId)
        assertEquals(0.5, progress?.scrollRatio)
    }

    @Test
    fun blankPageIdStateIsNull() {
        assertNull(parseReaderState("""{"state":{"pageId":"","scrollRatio":0.0}}"""))
    }

    @Test
    fun resolveUsesExistingCachePath() {
        val page = ReaderPage("p0", 0, "001.png", 800, 1200, "/cache/p0.png")
        assertEquals("/cache/p0.png", resolveImmediatePage(page) { true })
    }

    @Test
    fun resolveIgnoresMissingCacheFile() {
        val page = ReaderPage("p0", 0, "001.png", 800, 1200, "/cache/p0.png")
        assertNull(resolveImmediatePage(page) { false })
    }

    @Test
    fun resolveWithoutCachePathIsNull() {
        val page = ReaderPage("p0", 0, "001.png", 800, 1200, null)
        assertNull(resolveImmediatePage(page) { true })
    }
}
