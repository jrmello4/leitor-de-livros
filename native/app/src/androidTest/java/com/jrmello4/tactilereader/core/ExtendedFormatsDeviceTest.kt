package com.jrmello4.tactilereader.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfDocument
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Real Android rendering, archive decoding and cache reconstruction, with isolated fixtures. */
@RunWith(AndroidJUnit4::class)
class ExtendedFormatsDeviceTest {
    private val root = File(ApplicationProvider.getApplicationContext<Context>().cacheDir,
        "extended-formats-${UUID.randomUUID()}").apply { mkdirs() }

    private fun db(): LibraryDb {
        LibraryDb.closeAll()
        return LibraryDb.open(File(root, "lib"), File(root, "imports"))
    }

    @After fun cleanup() {
        LibraryDb.closeAll()
        root.deleteRecursively()
    }

    private fun pdf(file: File, color: Int) {
        file.parentFile?.mkdirs()
        val document = PdfDocument()
        try {
            repeat(3) { index ->
                val page = document.startPage(PdfDocument.PageInfo.Builder(300, 450, index + 1).create())
                page.canvas.drawColor(color)
                document.finishPage(page)
            }
            file.outputStream().use { document.writeTo(it) }
        } finally {
            document.close()
        }
    }

    @Test fun pdfIndexesLazilyRendersAndRebuildsAfterCacheClear() {
        val db = db()
        val original = File(root, "QA.pdf").apply { pdf(this, Color.BLUE) }
        val originalBytes = original.readBytes()
        val result = db.importPaths(listOf(original.absolutePath))
        assertEquals(result.diagnostics.toString(), 1, result.importedCount)
        val pub = db.publications.list().single()
        assertEquals("pdf", pub.format)
        assertEquals(3, pub.pageCount)
        assertTrue(db.listPages(pub.id).all { it.cachePath.isNullOrEmpty() })
        val page = db.listPages(pub.id)[1]
        val rendered = db.ensurePage(pub.id, page.id)
        val firstPath = File(rendered.cachePath!!)
        val bitmap = BitmapFactory.decodeFile(firstPath.absolutePath)
        assertNotNull(bitmap)
        assertEquals(1080, bitmap.width)
        assertEquals(1620, bitmap.height)
        assertEquals(Color.BLUE, bitmap.getPixel(540, 810))
        bitmap.recycle()
        db.saveReaderState(pub.id, page.id, 0.6)
        db.upsertBookmark(pub.id, page.id, "PDF bookmark")
        db.clearCache()
        assertFalse(firstPath.exists())
        assertTrue(File(db.ensurePage(pub.id, page.id).cachePath!!).isFile)
        assertEquals(page.id, db.loadReaderState(pub.id)?.pageId)
        assertEquals(0.6, db.loadReaderState(pub.id)?.scrollRatio ?: -1.0, 0.0001)
        assertEquals("PDF bookmark", db.listBookmarks(pub.id).single().label)
        assertArrayEquals(originalBytes, original.readBytes())
    }

    @Test fun sameNamedRealPdfsHaveIndependentPixelsAndProgress() {
        val db = db()
        val blue = File(root, "blue/QA.pdf").apply { pdf(this, Color.BLUE) }
        val red = File(root, "red/QA.pdf").apply { pdf(this, Color.RED) }
        assertEquals(2, db.importPaths(listOf(blue.absolutePath, red.absolutePath)).importedCount)
        val pubs = db.publications.list()
        assertEquals(2, pubs.size)
        val pixels = pubs.map { pub ->
            val page = db.ensurePage(pub.id, db.listPages(pub.id).first().id)
            BitmapFactory.decodeFile(page.cachePath).let { bitmap ->
                bitmap.getPixel(bitmap.width / 2, bitmap.height / 2).also { bitmap.recycle() }
            }
        }.toSet()
        assertEquals(setOf(Color.BLUE, Color.RED), pixels)
        db.saveReaderState(pubs[0].id, db.listPages(pubs[0].id)[1].id, 0.4)
        assertNull(db.loadReaderState(pubs[1].id))
    }

    @Test fun sevenZipUsesNaturalOrderAndRebuildsOnlyRequestedPage() {
        val db = db()
        val bitmap = Bitmap.createBitmap(32, 48, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        val png = File(root, "page.png")
        png.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        val archive = File(root, "QA.7z")
        SevenZOutputFile(archive).use { output ->
            listOf("10.png", "2.png", "1.png").forEach { name ->
                output.putArchiveEntry(output.createArchiveEntry(png, name))
                output.write(png.readBytes())
                output.closeArchiveEntry()
            }
        }
        val original = archive.readBytes()
        val result = db.importPaths(listOf(archive.absolutePath))
        assertEquals(result.diagnostics.toString(), 1, result.importedCount)
        val pub = db.publications.list().single()
        assertEquals("7z", pub.format)
        val pages = db.listPages(pub.id)
        assertEquals(listOf("1.png", "2.png", "10.png"), pages.map { it.name })
        assertTrue(pages.all { it.cachePath.isNullOrEmpty() })
        val ensured = db.ensurePage(pub.id, pages[1].id)
        assertEquals(32, ensured.width)
        assertEquals(48, ensured.height)
        assertEquals(1, db.listPages(pub.id).count { !it.cachePath.isNullOrEmpty() })
        db.clearCache()
        assertTrue(File(db.ensurePage(pub.id, pages[1].id).cachePath!!).isFile)
        assertArrayEquals(original, archive.readBytes())
    }

    @Test fun corruptBatchReportsFailuresAndStillImportsValidPdf() {
        val db = db()
        val badPdf = File(root, "broken.pdf").apply { writeText("%PDF-1.4 truncated") }
        val bad7z = File(root, "broken.7z").apply { writeText("truncated") }
        val good = File(root, "good.pdf").apply { pdf(this, Color.WHITE) }
        val result = db.importPaths(listOf(badPdf.absolutePath, bad7z.absolutePath, good.absolutePath))
        assertEquals(1, result.importedCount)
        assertEquals(2, result.fileResults.count { !it.success })
        assertEquals(1, db.publications.list().size)
        assertEquals("good", db.publications.list().single().title)
    }
}
