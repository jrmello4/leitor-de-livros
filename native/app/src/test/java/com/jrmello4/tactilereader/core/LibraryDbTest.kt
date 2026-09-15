package com.jrmello4.tactilereader.core

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Prova na JVM o núcleo Kotlin puro: importar CBZ (ZIP), listar, garantir
 * bytes sob demanda com reconstrução do original somente-leitura, progresso,
 * marcadores, favorito, capa e remoção. Robolectric em modo NATIVE para
 * SQLite e BitmapFactory reais.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LibraryDbTest {
    private fun tempRoot(label: String): File {
        val root = File(
            System.getProperty("java.io.tmpdir"),
            "tactile-core-$label-${UUID.randomUUID()}",
        )
        root.mkdirs()
        return root
    }

    private fun pngBytes(width: Int = 8, height: Int = 12): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawColor(Color.RED)
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    }

    private fun cbzBytes(pages: Int = 3, comicInfo: String? = null): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            if (comicInfo != null) {
                zip.putNextEntry(ZipEntry("ComicInfo.xml"))
                zip.write(comicInfo.toByteArray())
                zip.closeEntry()
            }
            for (index in 1..pages) {
                zip.putNextEntry(ZipEntry("%03d.png".format(index)))
                zip.write(pngBytes(8, 12 + index))
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    private fun openDb(root: File): LibraryDb {
        LibraryDb.closeAll()
        return LibraryDb.open(File(root, "lib"), File(root, "imports"))
    }

    @Test
    fun importCbzIndexesWithoutDerivedBytesAndListsIt() {
        val root = tempRoot("import")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(3)) }

        val outcome = db.importPaths(listOf(comic.absolutePath))
        assertEquals("diagnostics: ${outcome.diagnostics}", 0, outcome.diagnostics.size)
        assertEquals(1, outcome.importedCount)

        val pub = db.listPublications().single()
        assertEquals("HQ", pub.title)
        assertEquals("cbz", pub.format)
        assertEquals(3, pub.pageCount)
        assertNull("Import novo não materializa capa", pub.coverSrc)

        // Reimportar o mesmo caminho não duplica (mesmo source key → mesmo id).
        assertEquals(1, db.importPaths(listOf(comic.absolutePath)).importedCount)
        assertEquals(1, db.listPublications().size)
    }

    @Test
    fun comicInfoXmlTitlesThePublication() {
        val root = tempRoot("comicinfo")
        val db = openDb(root)
        val xml = "<ComicInfo><Series>Arqueiro Verde</Series><Number>7</Number></ComicInfo>"
        val comic = File(root, "sem-nome-bom.cbz").apply { writeBytes(cbzBytes(2, xml)) }
        db.importPaths(listOf(comic.absolutePath))
        assertEquals("Arqueiro Verde #7", db.listPublications().single().title)
    }

    @Test
    fun ensurePageRebuildsFromReadOnlyOriginalAndKeepsItIntact() {
        val root = tempRoot("ensure")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(2)) }
        val originalBytes = comic.readBytes()
        db.importPaths(listOf(comic.absolutePath))

        val pub = db.listPublications().single()
        val pages = db.listPages(pub.id)
        assertEquals(2, pages.size)
        assertNull(pages[0].cachePath)

        val ensured = db.ensurePage(pub.id, pages[1].id)
        val cacheFile = File(ensured.cachePath ?: "")
        assertTrue("capa/página derivada em disco", cacheFile.isFile)
        assertEquals(8, ensured.width)
        assertEquals(14, ensured.height)
        // Original intocado (somente leitura).
        assertTrue(originalBytes.contentEquals(comic.readBytes()))

        // A segunda garantia usa o cache (não muda o caminho).
        assertEquals(ensured.cachePath, db.ensurePage(pub.id, pages[1].id).cachePath)
    }

    @Test
    fun progressBookmarksAndFavoriteRoundTrip() {
        val root = tempRoot("progress")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(3)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()
        val pages = db.listPages(pub.id)

        assertNull(db.loadReaderState(pub.id))
        db.saveReaderState(pub.id, pages[2].id, 0.42)
        val restored = db.loadReaderState(pub.id)
        assertEquals(pages[2].id, restored?.pageId)
        assertEquals(0.42, restored?.scrollRatio ?: 0.0, 0.0001)

        db.upsertBookmark(pub.id, pages[0].id, "começo")
        assertEquals("começo", db.listBookmarks(pub.id).single().label)
        db.removeBookmark(pub.id, pages[0].id)
        assertTrue(db.listBookmarks(pub.id).isEmpty())

        db.setFavorite(pub.id, true)
        assertTrue(db.listPublications().single().isFavorite)
    }

    @Test
    fun markReadSetsAndClearsProgress() {
        val root = tempRoot("markread")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(4)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()

        db.markRead(pub.id, pub.pageCount - 1)
        assertEquals(1.0, db.listPublications().single().progress, 0.0001)

        db.markRead(pub.id, 0)
        assertEquals(0.25, db.listPublications().single().progress, 0.0001)
    }

    @Test
    fun deleteRemovesPublicationAndCacheButKeepsOriginal() {
        val root = tempRoot("delete")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(2)) }
        val originalBytes = comic.readBytes()
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()
        val page = db.listPages(pub.id).first()
        val cacheFile = File(db.ensurePage(pub.id, page.id).cachePath ?: "")

        db.deletePublication(pub.id)

        assertTrue(db.listPublications().isEmpty())
        assertTrue("cache derivado removido", !cacheFile.exists())
        assertTrue("original preservado", originalBytes.contentEquals(comic.readBytes()))
    }

    @Test
    fun cacheInfoCountsDerivedEntriesAndClearEmptiesThem() {
        val root = tempRoot("cache")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(2)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()
        db.ensurePage(pub.id, db.listPages(pub.id).first().id)

        val info = db.cacheInfo()
        assertEquals(1, info.entryCount)
        assertTrue(info.usedBytes > 0)
        assertEquals(DEFAULT_CACHE_LIMIT_BYTES, info.maxBytes)

        db.clearCache()
        assertEquals(0, db.cacheInfo().entryCount)
    }

    @Test
    fun snapshotCarriesReaderStatesInOneCall() {
        val root = tempRoot("snapshot")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(2)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()
        val page = db.listPages(pub.id).first()
        db.saveReaderState(pub.id, page.id, 0.75)

        val snapshot = db.librarySnapshot()
        assertEquals(page.id, snapshot[pub.id]?.pageId)
        assertEquals(0.75, snapshot[pub.id]?.scrollRatio ?: 0.0, 0.0001)
    }

    @Test
    fun malformedArchiveLeavesLibraryEmptyWithDiagnostic() {
        val root = tempRoot("malformed")
        val db = openDb(root)
        val bad = File(root, "quebrado.cbz").apply { writeBytes("não é zip".toByteArray()) }
        val outcome = db.importPaths(listOf(bad.absolutePath))
        assertEquals(0, outcome.importedCount)
        assertTrue(outcome.diagnostics.isNotEmpty())
        assertTrue(db.listPublications().isEmpty())
    }

    @Test
    fun cancelledImportReportsProgressAndKeepsWhatEntered() {
        val root = tempRoot("cancel")
        val db = openDb(root)
        val first = File(root, "A.cbz").apply { writeBytes(cbzBytes(2)) }
        val second = File(root, "B.cbz").apply { writeBytes(cbzBytes(2)) }
        val cancel = java.util.concurrent.atomic.AtomicBoolean(false)
        val progress = mutableListOf<ImportProgress>()

        val outcome = db.importPaths(
            listOf(first.absolutePath, second.absolutePath),
            onProgress = { event ->
                progress.add(event)
                if (event.processed >= 1) cancel.set(true)
            },
            shouldCancel = { cancel.get() },
        )

        assertTrue("cancelamento sinalizado", outcome.cancelled)
        assertTrue("o primeiro arquivo ficou", db.listPublications().isNotEmpty())
        assertTrue("progresso reportado", progress.any { it.total == 2 })
        assertTrue(outcome.diagnostics.any { it.contains("cancelada", ignoreCase = true) })
    }

    @Test
    fun librarySurvivesReopenWithSameData() {
        val root = tempRoot("reopen")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(3)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()
        val page = db.listPages(pub.id)[1]
        db.saveReaderState(pub.id, page.id, 0.5)
        db.setFavorite(pub.id, true)

        LibraryDb.closeAll()
        val reopened = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val restored = reopened.listPublications().single()
        assertEquals(pub.id, restored.id)
        assertEquals(3, restored.pageCount)
        assertTrue(restored.isFavorite)
        assertEquals(page.id, reopened.loadReaderState(pub.id)?.pageId)
    }
}
