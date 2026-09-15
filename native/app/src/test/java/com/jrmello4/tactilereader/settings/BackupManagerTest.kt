package com.jrmello4.tactilereader.settings

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import com.jrmello4.tactilereader.core.LibraryDb
import org.junit.Assert.assertEquals
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
 * Prova o ciclo do backup local: exportar → mudar estado → importar →
 * favorito, progresso e marcadores voltam. Sem nuvem, sem JNI.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class BackupManagerTest {
    private fun tempRoot(): File {
        val root = File(System.getProperty("java.io.tmpdir"), "tactile-backup-${UUID.randomUUID()}")
        root.mkdirs()
        return root
    }

    private fun cbz(path: File) {
        val bitmap = Bitmap.createBitmap(8, 12, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawColor(Color.BLUE)
        val png = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
        ZipOutputStream(path.outputStream()).use { zip ->
            for (index in 1..3) {
                zip.putNextEntry(ZipEntry("%03d.png".format(index)))
                zip.write(png)
                zip.closeEntry()
            }
        }
    }

    @Test
    fun exportThenImportRestoresFavoritesProgressAndBookmarks() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val comic = File(root, "HQ.cbz").apply { cbz(this) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.listPublications().single()
        val pages = db.listPages(pub.id)

        db.setFavorite(pub.id, true)
        db.saveReaderState(pub.id, pages[2].id, 0.66)
        db.upsertBookmark(pub.id, pages[1].id, "marcado")

        val backupFile = BackupManager.defaultExportFile(root)
        BackupManager.export(db, backupFile)
        assertTrue("arquivo de backup em disco", backupFile.isFile)
        assertTrue(
            "backup precisa citar a publicação",
            backupFile.readText().contains(pub.title),
        )

        // Muda tudo de propósito para provar a restauração.
        db.setFavorite(pub.id, false)
        db.markRead(pub.id, 0)
        db.removeBookmark(pub.id, pages[1].id)

        val summary = BackupManager.import(db, backupFile)
        assertEquals(1, summary.favorites)
        assertEquals(1, summary.progress)
        assertEquals(1, summary.bookmarks)

        val restored = db.listPublications().single()
        assertTrue("favorito restaurado", restored.isFavorite)
        val state = db.loadReaderState(pub.id)
        assertEquals(pages[2].id, state?.pageId)
        assertEquals(0.66, state?.scrollRatio ?: 0.0, 0.0001)
        assertEquals("marcado", db.listBookmarks(pub.id).single().label)
    }

    @Test
    fun rejectsForeignJson() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val foreign = File(root, "outro.json").apply {
            writeText("""{"app":"outra-coisa","publications":[]}""")
        }
        var threw = false
        try {
            BackupManager.import(db, foreign)
        } catch (_: IllegalStateException) {
            threw = true
        }
        assertTrue(threw)
    }
}
