package com.jrmello4.tactilereader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A listagem do núcleo agora cruza `coverPageId`, `coverSrc` e
 * `customCoverPath`. Import novo (sem bytes derivados) chega sem capa; a
 * estante garante sob demanda via `nativeEnsureCover`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LibraryJsonTest {
    @Test
    fun parsesCoverFieldsWhenPresent() {
        val json = """
            {"publications":[{
                "id":"p1","title":"demo-hq","format":"cbz",
                "pageCount":2,"progress":0.5,"isFavorite":true,
                "coverPageId":"p1-page-0",
                "coverSrc":"/data/covers/p1.png",
                "customCoverPath":"/data/covers/custom.png"
            }]}
        """.trimIndent()
        val pubs = parsePublications(json)
        assertEquals(1, pubs.size)
        assertEquals("p1-page-0", pubs[0].coverPageId)
        assertEquals("/data/covers/p1.png", pubs[0].coverSrc)
        assertEquals("/data/covers/custom.png", pubs[0].customCoverPath)
    }

    @Test
    fun blankCoverIsNullSoShelfEnsuresOnDemand() {
        val json = """
            {"publications":[{
                "id":"p1","title":"nova-hq","format":"cbz",
                "pageCount":2,"progress":0.0,"isFavorite":false,
                "coverPageId":"p1-page-0","coverSrc":"","customCoverPath":null
            }]}
        """.trimIndent()
        val pubs = parsePublications(json)
        assertNull(pubs[0].coverSrc)
        assertNull(pubs[0].customCoverPath)
    }

    @Test
    fun legacyListingWithoutCoverFieldsStillParses() {
        val json = """
            {"publications":[{
                "id":"p1","title":"demo-hq","format":"cbz",
                "pageCount":2,"progress":0.0,"isFavorite":false
            }]}
        """.trimIndent()
        val pubs = parsePublications(json)
        assertEquals("", pubs[0].coverPageId)
        assertNull(pubs[0].coverSrc)
        assertNull(pubs[0].customCoverPath)
    }

    @Test
    fun parseEnsureCoverReturnsPath() {
        assertEquals("/cache/cover.png", parseEnsureCover("""{"coverSrc":"/cache/cover.png","width":800,"height":1200}"""))
    }

    @Test
    fun parseEnsureCoverBlankIsNull() {
        assertNull(parseEnsureCover("""{"coverSrc":""}"""))
    }

    @Test(expected = IllegalStateException::class)
    fun parseEnsureCoverErrorThrows() {
        parseEnsureCover("""{"error":"page does not belong to the publication"}""")
    }

    @Test
    fun resolvePrefersCustomCover() {
        val pub = Pub("p1", "t", "cbz", 2, 0.0, false, "p1-page-0", "/cache/cover.png", "/cache/custom.png")
        assertEquals("/cache/custom.png", resolveImmediateCover(pub) { true })
    }

    @Test
    fun resolveFallsBackToCoverSrc() {
        val pub = Pub("p1", "t", "cbz", 2, 0.0, false, "p1-page-0", "/cache/cover.png", null)
        assertEquals("/cache/cover.png", resolveImmediateCover(pub) { true })
    }

    @Test
    fun resolveIgnoresMissingFiles() {
        val pub = Pub("p1", "t", "cbz", 2, 0.0, false, "p1-page-0", "/cache/cover.png", "/cache/custom.png")
        assertNull(resolveImmediateCover(pub) { false })
    }
}
