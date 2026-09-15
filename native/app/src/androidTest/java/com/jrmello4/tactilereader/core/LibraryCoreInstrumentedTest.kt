package com.jrmello4.tactilereader.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Prova fim-a-fim do núcleo Kotlin no aparelho: SQLite abre, importar→listar
 * funciona, capas/páginas são garantidas sob demanda e o progresso volta.
 */
@RunWith(AndroidJUnit4::class)
class LibraryCoreInstrumentedTest {
    private fun freshDb(root: File): LibraryDb {
        LibraryDb.closeAll()
        return LibraryDb.open(File(root, "lib"), File(root, "imports"))
    }

    @Test
    fun openLibraryStartsEmptyAndReopensIdempotently() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "core-proof-${UUID.randomUUID()}")
        val first = freshDb(root)
        assertTrue(first.listPublications().isEmpty())
        LibraryDb.closeAll()
        val second = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        assertTrue(second.listPublications().isEmpty())
    }

    @Test
    fun importGeneratedCbzAndListItBack() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "core-import-${UUID.randomUUID()}")
        val db = freshDb(root)

        val comic = TestComic.generate(File(root, "seed"))
        val outcome = db.importPaths(listOf(comic.absolutePath))
        assertTrue("diagnostics: ${outcome.diagnostics}", outcome.diagnostics.isEmpty())
        assertTrue("expected one import, got ${outcome.importedCount}", outcome.importedCount == 1)

        val pubs = db.listPublications()
        assertTrue("expected one listed pub", pubs.size == 1)
        val pub = pubs.single()
        assertTrue("expected cbz, got ${pub.format}", pub.format == "cbz")
        assertTrue("expected 2 pages, got ${pub.pageCount}", pub.pageCount == 2)
        assertTrue("title mismatch", pub.title.isNotBlank())
    }

    @Test
    fun ensureCoverRebuildsFirstPageOnDemand() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "core-cover-${UUID.randomUUID()}")
        val db = freshDb(root)

        val comic = TestComic.generate(File(root, "seed"))
        db.importPaths(listOf(comic.absolutePath))

        // Import novo indexa sem bytes derivados: a listagem chega sem capa.
        val pub = db.listPublications().single()
        assertNull("expected no cover before ensure", pub.coverSrc)
        assertTrue("expected cover page id", pub.coverPageId.isNotBlank())

        val ensured = db.ensurePage(pub.id, pub.coverPageId)
        assertTrue("expected cover file", File(ensured.cachePath ?: "").isFile)

        val relisted = db.listPublications().single()
        assertTrue("expected cover after ensure", !relisted.coverSrc.isNullOrBlank())
    }

    @Test
    fun readerListsPagesEnsuresBytesAndRestoresProgress() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "core-reader-${UUID.randomUUID()}")
        val db = freshDb(root)

        val comic = TestComic.generate(File(root, "seed"))
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()

        assertNull("expected null state", db.loadReaderState(pub.id))

        val pages = db.listPages(pub.id)
        assertTrue("expected 2 pages, got ${pages.size}", pages.size == 2)

        val ensured = db.ensurePage(pub.id, pages[1].id)
        assertTrue("expected page file", File(ensured.cachePath ?: "").isFile)

        db.saveReaderState(pub.id, pages[1].id, 0.25)
        val restored = db.loadReaderState(pub.id)
        assertTrue("expected progress, got $restored", restored?.pageId == pages[1].id)
        assertTrue("expected ratio 0.25", restored?.scrollRatio == 0.25)

        db.upsertBookmark(pub.id, pages[0].id, "marcado")
        assertTrue(db.listBookmarks(pub.id).single().pageId == pages[0].id)
        db.removeBookmark(pub.id, pages[0].id)
        assertFalse(db.listBookmarks(pub.id).isNotEmpty())
    }

    @Test
    fun importsRealRar5ArchiveOnDeviceAndRebuildsPages() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "core-rar5-${UUID.randomUUID()}")
        val db = freshDb(root)

        val bytes = InstrumentationRegistry.getInstrumentation().context.assets
            .open("rar5-fixture.cbr")
            .use { it.readBytes() }
        val archive = File(root, "fixture.cbr").apply { writeBytes(bytes) }

        val outcome = db.importPaths(listOf(archive.absolutePath))
        assertTrue("diagnostics: ${outcome.diagnostics}", outcome.diagnostics.isEmpty())
        val pub = db.listPublications().single()
        assertEquals("cbr", pub.format)
        assertEquals(3, pub.pageCount)

        val pages = db.listPages(pub.id)
        assertEquals(listOf("001.png", "002.png", "003.png"), pages.map { it.name })
        val ensured = db.ensurePage(pub.id, pages[2].id)
        assertTrue("página RAR5 reconstruída", File(ensured.cachePath ?: "").isFile)
        assertEquals(8, ensured.width)
        assertEquals(14, ensured.height)
        assertTrue("original intacto", bytes.contentEquals(archive.readBytes()))
    }
}
