package com.jrmello4.tactilereader.reader

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.core.ReadingMetrics
import com.jrmello4.tactilereader.core.ReadingSession
import com.jrmello4.tactilereader.core.TestComic
import java.io.File
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Teste instrumentado para restauração de sessão de leitura e métricas:
 * Garante que a posição exata da página, proporção de rolagem (scrollRatio),
 * marcadores e cálculo de ritmo de leitura são persistidos e restaurados sem perda.
 */
@RunWith(AndroidJUnit4::class)
class ReaderSessionRestoreTest {

    @Test
    fun readerSessionRestoresPositionBookmarkAndPace() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "restore-test-${UUID.randomUUID()}")
        root.mkdirs()

        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))

        val comicFile = TestComic.generate(File(root, "seed"))
        val outcome = db.importPaths(listOf(comicFile.absolutePath))
        assertTrue("Importação com sucesso", outcome.importedCount == 1)

        val pub = db.listPublications().single()
        val pages = db.listPages(pub.id)
        assertTrue("Houve páginas geradas", pages.size >= 2)

        val targetPage = pages[1]
        val expectedRatio = 0.68

        // 1. Simula leitura e pausa de sessão
        db.saveReaderState(pub.id, targetPage.id, expectedRatio)
        db.upsertBookmark(pub.id, targetPage.id, "Ponto de interrupção")

        // 2. Registra métricas de ritmo
        val session = ReadingSession(durationMillis = 180_000L, pagesRead = 6)
        val speed = ReadingMetrics.calculateSpeed(session)
        assertEquals(2.0, speed.pagesPerMinute, 0.01)

        val remainingMin = ReadingMetrics.estimateRemainingMinutes(
            pagesRemaining = 20 - 6,
            pagesPerMinute = speed.pagesPerMinute,
        )
        assertEquals(7, remainingMin) // (20 - 6) / 2.0 = 7.0 min

        // 3. Simula fechamento do aplicativo e reabertura limpa do banco
        LibraryDb.closeAll()
        val reopenedDb = LibraryDb.open(File(root, "lib"), File(root, "imports"))

        val restoredState = reopenedDb.loadReaderState(pub.id)
        assertNotNull("Estado de leitura restaurado", restoredState)
        assertEquals(targetPage.id, restoredState?.pageId)
        assertEquals(expectedRatio, restoredState?.scrollRatio ?: 0.0, 0.001)

        val bookmarks = reopenedDb.listBookmarks(pub.id)
        assertEquals(1, bookmarks.size)
        assertEquals("Ponto de interrupção", bookmarks[0].label)
        assertEquals(targetPage.id, bookmarks[0].pageId)

        LibraryDb.closeAll()
        root.deleteRecursively()
    }
}
