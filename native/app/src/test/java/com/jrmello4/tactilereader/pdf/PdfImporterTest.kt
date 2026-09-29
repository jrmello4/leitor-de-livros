package com.jrmello4.tactilereader.pdf

import java.io.File
import java.util.UUID
import com.jrmello4.tactilereader.core.digestId
import com.jrmello4.tactilereader.core.pdfSourceKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PdfImporterTest {
    @Test
    fun sameNamedPdfsWithDifferentOriginsAndContentsNeverShareIdentity() {
        val root = File(System.getProperty("java.io.tmpdir"), "tactile-pdf-${UUID.randomUUID()}")
        val downloads = File(root, "Downloads").apply { mkdirs() }
        val comics = File(root, "Comics").apply { mkdirs() }
        val firstPdf = File(downloads, "Batman.pdf")
        val secondPdf = File(comics, "Batman.pdf")
        firstPdf.writeBytes("%PDF-1.4 downloads version".toByteArray())
        secondPdf.writeBytes("%PDF-1.4 comics version with different content".toByteArray())
        assertFalse("fixture PDFs have different contents", firstPdf.readBytes().contentEquals(secondPdf.readBytes()))

        assertEquals(firstPdf.name, secondPdf.name)
        val firstKey = pdfSourceKey(firstPdf.absolutePath, firstPdf.length(), firstPdf.lastModified())
        val secondKey = pdfSourceKey(secondPdf.absolutePath, secondPdf.length(), secondPdf.lastModified())
        val firstPageId = "${digestId("publication", firstKey.toByteArray())}-page-0000"
        val secondPageId = "${digestId("publication", secondKey.toByteArray())}-page-0000"
        assertNotEquals("identical basenames have isolated source identities", firstKey, secondKey)
        assertNotEquals("isolated source identities produce isolated cache page IDs", firstPageId, secondPageId)

        val smallerPdfKey = pdfSourceKey(firstPdf.absolutePath, firstPdf.length() - 1, firstPdf.lastModified())
        assertNotEquals("a smaller revision cannot reuse the older PDF cache", firstKey, smallerPdfKey)
    }
}
