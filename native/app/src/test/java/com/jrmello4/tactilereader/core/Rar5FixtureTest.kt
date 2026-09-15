package com.jrmello4.tactilereader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.UUID

/**
 * Prova o caminho RAR5 de verdade: o fixture `rar5-fixture.cbr` foi criado
 * pelo WinRAR com `-ma5` (assinatura `Rar!\x1a\x07\x01\x00`), então este
 * teste exercita o decoder RAR5 do junrar — nenhuma biblioteca Java cria
 * RAR, por isso o arquivo é versionado como fixture.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class Rar5FixtureTest {
    private fun fixture(): File {
        val bytes = javaClass.getResourceAsStream("/rar5-fixture.cbr")?.readBytes()
            ?: error("rar5-fixture.cbr missing from test resources")
        val directory = File(
            System.getProperty("java.io.tmpdir"),
            "tactile-rar5-fixture-${UUID.randomUUID()}",
        ).apply { mkdirs() }
        val target = File(directory, "fixture.cbr")
        target.writeBytes(bytes)
        return target
    }

    @Test
    fun importsRealRar5ArchiveAndRebuildsPages() {
        val root = File(System.getProperty("java.io.tmpdir"), "tactile-rar5-db-${UUID.randomUUID()}")
        root.mkdirs()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))

        val archive = fixture()
        val originalBytes = archive.readBytes()
        // Confirma a assinatura RAR5 antes de depender do decoder.
        assertTrue("fixture precisa ser RAR5", originalBytes.size >= 8 &&
            originalBytes[6] == 0x01.toByte() && originalBytes[7] == 0x00.toByte())

        val outcome = db.importPaths(listOf(archive.absolutePath))
        assertEquals("diagnostics: ${outcome.diagnostics}", 0, outcome.diagnostics.size)
        assertEquals(1, outcome.importedCount)

        val pub = db.listPublications().single()
        assertEquals("cbr", pub.format)
        assertEquals("fixture", pub.title)
        assertEquals(3, pub.pageCount)

        val pages = db.listPages(pub.id)
        assertEquals(listOf("001.png", "002.png", "003.png"), pages.map { it.name })

        // Extrai cada página do RAR5 e confere as dimensões gravadas no import.
        val expectedHeights = listOf(12, 13, 14)
        pages.forEachIndexed { index, page ->
            val ensured = db.ensurePage(pub.id, page.id)
            assertTrue("página ${page.name} reconstruída", File(ensured.cachePath ?: "").isFile)
            assertEquals(8, ensured.width)
            assertEquals(expectedHeights[index], ensured.height)
        }

        // O original nunca é tocado.
        assertTrue(originalBytes.contentEquals(archive.readBytes()))
    }
}
