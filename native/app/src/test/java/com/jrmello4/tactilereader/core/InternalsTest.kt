package com.jrmello4.tactilereader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Prova na JVM os utilitários do núcleo: identificadores determinísticos
 * (mesmo sha256 do antigo Rust), ordem natural, validação de nomes de
 * arquivo e o reparo de nomes legados de importação.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InternalsTest {
    @Test
    fun digestIdIsStableAndDeterministic() {
        val first = digestId("publication", "archive:/hq/A.cbz".toByteArray())
        val second = digestId("publication", "archive:/hq/A.cbz".toByteArray())
        assertEquals(first, second)
        assertTrue(first.startsWith("publication-"))
        assertEquals("publication-".length + 24, first.length)
        assertTrue(first.removePrefix("publication-").all { it.isDigit() || it in 'a'..'f' })
    }

    @Test
    fun naturalCompareOrdersNumbersByValue() {
        val names = mutableListOf("page10.png", "page2.png", "page1.png")
        names.sortWith { a, b -> naturalCompare(a, b) }
        assertEquals(listOf("page1.png", "page2.png", "page10.png"), names)
    }

    @Test
    fun archiveTraversalIsRejected() {
        var threw = false
        try {
            validateArchiveName("../page.png")
        } catch (_: IllegalArgumentException) {
            threw = true
        }
        assertTrue(threw)
        threw = false
        try {
            validateArchiveName("C:/page.png")
        } catch (_: IllegalArgumentException) {
            threw = true
        }
        assertTrue(threw)
        assertEquals("pages/page.png", validateArchiveName("pages\\page.png"))
    }

    @Test
    fun recoversEachLegacyImportLayout() {
        val managed = File("imports")
        for ((path, expected) in listOf(
            "imports/batch-1788979885761-684528334738766/0-Arqueiro Verde Absoluto #01.cbr" to
                "Arqueiro Verde Absoluto #01.cbr",
            "imports/batch-1788979885761-684528334738766/002-Batman Absoluto #10.cbr" to
                "Batman Absoluto #10.cbr",
            "imports/1788956256851-0-Batman Absoluto #00.cbz" to "Batman Absoluto #00.cbz",
            "HQ/collection-collection-0123456789abcdef01234567/0001-Arqueiro Verde Absoluto #02.cbr" to
                "Arqueiro Verde Absoluto #02.cbr",
            "imports/batch-123-456/2-2000 AD #01.cbr" to "2000 AD #01.cbr",
            "imports/batch-123-456/2-0-Arqueiro Verde #01.cbr" to "0-Arqueiro Verde #01.cbr",
        )) {
            assertEquals(expected, PublicationNames.originalImportName("cbr:$path", managed))
        }
    }

    @Test
    fun preservesOriginalNumbersAndNewLayouts() {        val managed = File("imports")
        for (path in listOf(
            "HQ/002 - Batman Absoluto #01.cbr",
            "HQ/100 Bullets #01.cbr",
            "HQ/1984.cbr",
            "imports/folder-123-456/0-Arqueiro Verde #01.cbr",
            "imports/batch-123-456/2/2000 AD #01.cbr",
            "HQ/collection-collection-0123456789abcdef01234567/0001/0-Arqueiro Verde #01.cbr",
            "HQ/collection-favorites/0001-Arqueiro Verde #01.cbr",
        )) {
            assertNull(path, PublicationNames.originalImportName("cbr:$path", managed))
        }
    }

    @Test
    fun repairsCopiesEvenWhenNameStartsWithDigits() {
        // O app copia como imports/<timestamp>-<índice>-<nome>; sem o índice,
        // "2000 AD #01.cbz" perderia o começo do próprio nome.
        assertEquals(
            "2000 AD #01.cbz",
            PublicationNames.originalImportName(
                "archive:imports/1788956256851-0-2000 AD #01.cbz",
                File("imports"),
            ),
        )
    }

    @Test
    fun androidPrimaryUserAliasMatchesLegacySources() {
        val root = File("/data/user/0/com.jrmello4.tactilereader/files/imports")
        val source =
            "archive:/data/data/com.jrmello4.tactilereader/files/imports/batch-1788980940132-685559126034362/0-Arqueiro Verde Absoluto #01.cbr"
        assertEquals(
            "Arqueiro Verde Absoluto #01.cbr",
            PublicationNames.originalImportName(source, root),
        )
        val otherUser =
            "archive:/data/user/10/com.jrmello4.tactilereader/files/imports/batch-123-456/0-Arqueiro Verde #01.cbr"
        assertNull(PublicationNames.originalImportName(otherUser, root))
    }

    @Test
    fun comicInfoTitlePrefersSeriesAndNumber() {
        val xml = """
            <ComicInfo>
              <Series>Arqueiro Verde</Series>
              <Number>12</Number>
              <Title>O retorno</Title>
            </ComicInfo>
        """.trimIndent()
        assertEquals(
            "Arqueiro Verde #12",
            Importer.readComicInfoTitle(xml.byteInputStream()),
        )
        val titleOnly = "<ComicInfo><Title>Só título</Title></ComicInfo>"
        assertEquals("Só título", Importer.readComicInfoTitle(titleOnly.byteInputStream()))
        assertNull(Importer.readComicInfoTitle("<ComicInfo/>".byteInputStream()))
    }
}
