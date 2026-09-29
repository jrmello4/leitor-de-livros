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
        cbz(path, (1..3).map { "%03d.png".format(it) })
    }

    private fun cbz(path: File, names: List<String>) {
        val bitmap = Bitmap.createBitmap(8, 12, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawColor(Color.BLUE)
        val png = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
        ZipOutputStream(path.outputStream()).use { zip ->
            for (name in names) {
                zip.putNextEntry(ZipEntry(name))
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
        val pub = db.publications.list().single()
        val pages = db.listPages(pub.id)

        db.publications.setFavorite(pub.id, true)
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
        db.publications.setFavorite(pub.id, false)
        db.markRead(pub.id, 0)
        db.removeBookmark(pub.id, pages[1].id)

        val summary = BackupManager.import(db, backupFile)
        assertEquals(1, summary.favorites)
        assertEquals(1, summary.progress)
        assertEquals(1, summary.bookmarks)

        val restored = db.publications.list().single()
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

    @Test
    fun portableBackupRestoresAfterDeleteAndReimportWithNewPublicationId() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val original = File(root, "old-location/HQ.cbz").apply {
            parentFile?.mkdirs()
            cbz(this)
        }
        db.importPaths(listOf(original.absolutePath))
        val previous = db.publications.list().single()
        val oldPages = db.listPages(previous.id)
        db.publications.setFavorite(previous.id, true)
        db.saveReaderState(previous.id, oldPages[2].id, 0.54)
        db.upsertBookmark(previous.id, oldPages[1].id, "retomar daqui")
        val backup = BackupManager.export(db, File(root, "backup.json"))

        db.deletePublication(previous.id)
        val reimported = File(root, "new-location/HQ.cbz").apply {
            parentFile?.mkdirs()
            original.copyTo(this)
        }
        db.importPaths(listOf(reimported.absolutePath))
        val current = db.publications.list().single()
        assertTrue("reimport deve ganhar outra identidade interna", current.id != previous.id)

        val summary = BackupManager.import(db, backup)
        assertEquals(1, summary.favorites)
        assertEquals(1, summary.progress)
        assertEquals(1, summary.bookmarks)
        assertTrue(db.publications.list().single().isFavorite)
        val newPages = db.listPages(current.id)
        val restored = db.loadReaderState(current.id)
        assertEquals(newPages[2].id, restored?.pageId)
        assertEquals(0.54, restored?.scrollRatio ?: 0.0, 0.0001)
        assertEquals(newPages[1].id, db.listBookmarks(current.id).single().pageId)
    }

    @Test
    fun portableBackupDoesNotGuessWhenMetadataMatchesMultiplePublications() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val original = File(root, "source/HQ.cbz").apply {
            parentFile?.mkdirs()
            cbz(this)
        }
        db.importPaths(listOf(original.absolutePath))
        val previous = db.publications.list().single()
        db.publications.setFavorite(previous.id, true)
        val backup = BackupManager.export(db, File(root, "backup.json"))
        db.deletePublication(previous.id)

        val candidates = listOf("one", "two").map { directory ->
            File(root, "$directory/HQ.cbz").apply {
                parentFile?.mkdirs()
                original.copyTo(this)
            }
        }
        db.importPaths(candidates.map { it.absolutePath })
        val summary = BackupManager.import(db, backup)
        assertEquals(0, summary.favorites)
        assertTrue(db.publications.list().none { it.isFavorite })
    }

    @Test
    fun portableBackupRejectsDifferentPageManifestWithSameTitleAndPageCount() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val original = File(root, "source/HQ.cbz").apply {
            parentFile?.mkdirs()
            cbz(this)
        }
        db.importPaths(listOf(original.absolutePath))
        val previous = db.publications.list().single()
        db.publications.setFavorite(previous.id, true)
        val backup = BackupManager.export(db, File(root, "backup.json"))
        db.deletePublication(previous.id)

        val replacement = File(root, "replacement/HQ.cbz").apply {
            parentFile?.mkdirs()
            cbz(this, listOf("cover.png", "middle.png", "last.png"))
        }
        db.importPaths(listOf(replacement.absolutePath))
        assertEquals("HQ", db.publications.list().single().title)
        assertEquals(3, db.publications.list().single().pageCount)

        val summary = BackupManager.import(db, backup)

        assertEquals(0, summary.favorites)
        assertTrue(db.publications.list().none { it.isFavorite })
    }

    @Test
    fun backupRestoresExplicitNotStartedStateByClearingExistingProgress() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val comic = File(root, "HQ.cbz").apply { cbz(this) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val firstPage = db.listPages(pub.id).first()
        db.saveReaderState(pub.id, firstPage.id, 0.75)
        db.clearReadingProgress(pub.id)
        val backup = BackupManager.export(db, File(root, "backup.json"))

        db.saveReaderState(pub.id, firstPage.id, 0.25)
        assertEquals(1, db.publications.list().single().readingStatus.databaseValue)
        BackupManager.import(db, backup)

        val restored = db.publications.list().single()
        assertEquals(0, restored.readingStatus.databaseValue)
        assertEquals(0.0, restored.progress, 0.0)
        assertEquals(null, db.loadReaderState(pub.id))
    }

    @Test
    fun backupRestoresFinishedWithoutReaderState() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val comic = File(root, "HQ.cbz").apply { cbz(this) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()

        db.markFinished(pub.id)
        assertEquals(null, db.loadReaderState(pub.id))
        val backup = BackupManager.export(db, File(root, "finished.json"))
        db.clearReadingProgress(pub.id)

        val summary = BackupManager.import(db, backup)

        assertEquals(1, summary.progress)
        assertEquals(com.jrmello4.tactilereader.core.ReadingStatus.FINISHED, db.publications.list().single().readingStatus)
        assertEquals(null, db.loadReaderState(pub.id))
    }

    @Test
    fun backupRestoresReadingPageFifteenAndScrollRatio() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val comic = File(root, "HQ.cbz").apply {
            cbz(this, (1..20).map { "%03d.png".format(it) })
        }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val pageFifteen = db.listPages(pub.id)[14]
        db.saveReaderState(pub.id, pageFifteen.id, 0.73)
        val backup = BackupManager.export(db, File(root, "reading.json"))
        db.clearReadingProgress(pub.id)

        val summary = BackupManager.import(db, backup)

        assertEquals(1, summary.progress)
        assertEquals(com.jrmello4.tactilereader.core.ReadingStatus.READING, db.publications.list().single().readingStatus)
        assertEquals(pageFifteen.id, db.loadReaderState(pub.id)?.pageId)
        assertEquals(0.73, db.loadReaderState(pub.id)?.scrollRatio ?: 0.0, 0.0001)
    }

    @Test
    fun backupPreservesReadingStatusCreatedByMarkReadWithoutReaderState() {
        val root = tempRoot()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val comic = File(root, "HQ.cbz").apply { cbz(this) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()

        db.markRead(pub.id, 1)
        val backup = BackupManager.export(db, File(root, "mark-read.json"))
        db.clearReadingProgress(pub.id)

        BackupManager.import(db, backup)

        assertEquals(com.jrmello4.tactilereader.core.ReadingStatus.READING, db.publications.list().single().readingStatus)
        assertEquals(db.listPages(pub.id)[1].id, db.loadReaderState(pub.id)?.pageId)
        assertEquals(0.0, db.loadReaderState(pub.id)?.scrollRatio ?: -1.0, 0.0)
    }
}
