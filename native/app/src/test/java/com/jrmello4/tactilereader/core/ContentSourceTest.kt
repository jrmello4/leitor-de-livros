package com.jrmello4.tactilereader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Prova a leitura direta de `content://` (SAF) sem copiar a HQ: um opener
 * em memória serve os bytes como URI, forçando o caminho de STREAMING
 * (ZipInputStream/junrar InputStream) do núcleo — o mesmo usado no aparelho.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ContentSourceTest {
    /** Opener fake: URIs servidas de memória, nunca arquivos locais. */
    private class MemoryOpener(private val files: Map<String, ByteArray>) : SourceOpener {
        override fun isAvailable(reference: String): Boolean = files.containsKey(reference)
        override fun sizeBytes(reference: String): Long = files[reference]?.size?.toLong() ?: 0L
        override fun openStream(reference: String): InputStream =
            ByteArrayInputStream(files[reference] ?: error("missing $reference"))
        override fun displayName(reference: String): String = reference.substringAfterLast('/')
        override fun localPath(reference: String): String? = null
    }

    private fun cbzBytes(pages: Int = 3): ByteArray {
        val png = ByteArrayOutputStream().use { out ->
            android.graphics.Bitmap.createBitmap(8, 12, android.graphics.Bitmap.Config.ARGB_8888)
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
        val zip = ByteArrayOutputStream()
        ZipOutputStream(zip).use { stream ->
            for (index in 1..pages) {
                stream.putNextEntry(ZipEntry("%03d.png".format(index)))
                stream.write(png)
                stream.closeEntry()
            }
        }
        return zip.toByteArray()
    }

    private fun openDb(opener: SourceOpener): Pair<LibraryDb, File> {
        val root = File(System.getProperty("java.io.tmpdir"), "tactile-saf-${UUID.randomUUID()}")
        root.mkdirs()
        LibraryDb.closeAll()
        return LibraryDb.open(File(root, "lib"), File(root, "imports"), opener) to root
    }

    @Test
    fun importsZipFromContentUriWithoutCopyingAndRebuildsPage() {
        val uri = "content://com.exemplo.documents/document/hq%3A001.cbz"
        val opener = MemoryOpener(mapOf(uri to cbzBytes(3)))
        val (db, root) = openDb(opener)

        val outcome = db.importSources(listOf(ImportSource(uri, "HQ.cbz")))
        assertEquals("diagnostics: ${outcome.diagnostics}", 0, outcome.diagnostics.size)
        val pub = db.listPublications().single()
        assertEquals("cbz", pub.format)
        assertEquals(3, pub.pageCount)

        // Reimportar a mesma URI não duplica.
        db.importSources(listOf(ImportSource(uri, "HQ.cbz")))
        assertEquals(1, db.listPublications().size)

        // Nada foi copiado para o sandbox: imports/ continua vazio.
        assertEquals(0, File(root, "imports").listFiles()?.size ?: 0)

        val page = db.listPages(pub.id)[1]
        val ensured = db.ensurePage(pub.id, page.id)
        val cache = File(ensured.cachePath ?: "")
        assertTrue("página reconstruída do stream", cache.isFile)
        assertEquals(8, ensured.width)
        assertEquals(12, ensured.height)
    }

    @Test
    fun importsRealRar5FromContentUriStream() {
        val bytes = javaClass.getResourceAsStream("/rar5-fixture.cbr")?.readBytes()
            ?: error("rar5-fixture.cbr missing")
        val uri = "content://com.exemplo.documents/document/fixture%3A001.cbr"
        val opener = MemoryOpener(mapOf(uri to bytes))
        val (db, _) = openDb(opener)

        val outcome = db.importSources(listOf(ImportSource(uri, "fixture.cbr")))
        assertEquals("diagnostics: ${outcome.diagnostics}", 0, outcome.diagnostics.size)
        val pub = db.listPublications().single()
        assertEquals("cbr", pub.format)
        assertEquals(3, pub.pageCount)

        val pages = db.listPages(pub.id)
        val ensured = db.ensurePage(pub.id, pages[2].id)
        assertTrue("RAR5 por stream reconstruído", File(ensured.cachePath ?: "").isFile)
        assertEquals(8, ensured.width)
        assertEquals(14, ensured.height)
    }

    @Test
    fun unavailableUriBecomesDiagnosticInsteadOfCrash() {
        val opener = MemoryOpener(emptyMap())
        val (db, _) = openDb(opener)
        val outcome = db.importSources(listOf(ImportSource("content://x/y", "sumiu.cbz")))
        assertEquals(0, outcome.importedCount)
        assertTrue(outcome.diagnostics.isNotEmpty())
        assertNull(db.listPublications().firstOrNull())
    }
}
