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
import java.io.ByteArrayInputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile

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
    @Test
    fun readerDirectionUsesExistingColumnAndCentralFinishRules() {
        val root = tempRoot("reader-direction")
        LibraryDb.closeAll()
        try {
            val cbz = File(root, "reader.cbz").apply { writeBytes(cbzBytes(5)) }
            val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))
            db.importPaths(listOf(cbz.absolutePath))
            val pub = db.publications.list().single()
            val pages = db.listPages(pub.id)
            db.setReadingDirection(pub.id, "rtl")
            assertEquals("rtl", db.readingDirection(pub.id))
            assertNull(db.loadReaderState(pub.id))
            db.saveReaderState(pub.id, pages.last().id, 0.35)
            assertEquals(ReadingStatus.READING, db.publications.list().single().readingStatus)
            db.saveReaderState(pub.id, pages.first().id, 0.0)
            assertEquals(ReadingStatus.FINISHED, db.publications.list().single().readingStatus)
            db.setReadingDirection(pub.id, "ltr")
            assertEquals(ReadingStatus.READING, db.publications.list().single().readingStatus)
            assertEquals(pages.first().id, db.loadReaderState(pub.id)?.pageId)
            db.clearReadingProgress(pub.id)
            assertEquals(ReadingStatus.NOT_STARTED, db.publications.list().single().readingStatus)
            LibraryDb.closeAll()
            val reopened = LibraryDb.open(File(root, "lib"), File(root, "imports"))
            assertEquals("ltr", reopened.readingDirection(pub.id))
        } finally {
            LibraryDb.closeAll()
            root.deleteRecursively()
        }
    }
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

    private fun cbzBytesWithNames(names: List<String>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            for (name in names) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(pngBytes())
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    private fun sevenZipWithPages(root: File, names: List<String>): File {
        val archiveFile = File(root, "natural.7z")
        SevenZOutputFile(archiveFile).use { archive ->
            for ((index, name) in names.withIndex()) {
                val page = File(root, "source-$index.png").apply { writeBytes(pngBytes()) }
                archive.putArchiveEntry(archive.createArchiveEntry(page, name))
                archive.write(page.readBytes())
                archive.closeArchiveEntry()
            }
        }
        return archiveFile
    }

    private fun openDb(root: File): LibraryDb {
        LibraryDb.closeAll()
        return LibraryDb.open(File(root, "lib"), File(root, "imports"))
    }

    @Test
    fun shelfListingUsesOneQueryFor10_100And500Publications() {
        for (targetCount in listOf(10, 100, 500)) {
            val root = tempRoot("shelf-scale-$targetCount")
            val db = openDb(root)
            repeat(targetCount) { index ->
                val publicationId = "publication-$index"
                val pageId = "$publicationId-page-0000"
                db.publications.insert(
                    PublicationRepository.NewPublication(
                        id = publicationId,
                        title = "HQ $index",
                        sourceLabel = "HQ $index.cbz",
                        sourcePath = "archive:${File(root, "$index.cbz").absolutePath}",
                        format = "cbz",
                        pages = listOf(
                            PublicationRepository.NewPage(
                                id = pageId,
                                index = 0,
                                name = "1.png",
                                cachePath = File(""),
                                sourceRef = PageSourceRef.Image("missing-$index.png"),
                                width = 8,
                                height = 12,
                            ),
                        ),
                        coverPageId = pageId,
                        addedAt = "1",
                        updatedAt = "1",
                    ),
                )
            }

            var queryCount = 0
            db.queryObserverForTests = { queryCount++ }
            val publications = db.publications.list()
            db.queryObserverForTests = null

            assertEquals("$targetCount publications returned", targetCount, publications.size)
            assertEquals("$targetCount publications use a constant query count", 1, queryCount)
            assertTrue(publications.all { it.readingStatus == ReadingStatus.NOT_STARTED && it.progress == 0.0 })
        }
        LibraryDb.closeAll()
    }

    @Test
    fun importCbzIndexesWithoutDerivedBytesAndListsIt() {
        val root = tempRoot("import")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(3)) }

        val outcome = db.importPaths(listOf(comic.absolutePath))
        assertEquals("diagnostics: ${outcome.diagnostics}", 0, outcome.diagnostics.size)
        assertEquals(1, outcome.importedCount)

        val pub = db.publications.list().single()
        assertEquals("HQ", pub.title)
        assertEquals("cbz", pub.format)
        assertEquals(3, pub.pageCount)
        assertNull("Import novo não materializa capa", pub.coverSrc)

        // Reimportar o mesmo caminho não duplica (mesmo source key → mesmo id).
        assertEquals(1, db.importPaths(listOf(comic.absolutePath)).importedCount)
        assertEquals(1, db.publications.list().size)
    }

    @Test
    fun comicInfoXmlTitlesThePublication() {
        val root = tempRoot("comicinfo")
        val db = openDb(root)
        val xml = "<ComicInfo><Series>Arqueiro Verde</Series><Number>7</Number></ComicInfo>"
        val comic = File(root, "sem-nome-bom.cbz").apply { writeBytes(cbzBytes(2, xml)) }
        db.importPaths(listOf(comic.absolutePath))
        assertEquals("Arqueiro Verde #7", db.publications.list().single().title)
    }

    @Test
    fun ensurePageRebuildsFromReadOnlyOriginalAndKeepsItIntact() {
        val root = tempRoot("ensure")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(2)) }
        val originalBytes = comic.readBytes()
        db.importPaths(listOf(comic.absolutePath))

        val pub = db.publications.list().single()
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
    fun differentPagesCanRebuildWithoutHoldingTheDatabaseMonitor() {
        val root = tempRoot("parallel-pages")
        LibraryDb.closeAll()
        val bytes = pngBytes()
        val bothPagesOpened = CountDownLatch(2)
        val opener = object : SourceOpener {
            override fun isAvailable(reference: String) = true
            override fun sizeBytes(reference: String) = bytes.size.toLong()
            override fun openStream(reference: String) = ByteArrayInputStream(bytes).also {
                bothPagesOpened.countDown()
                check(bothPagesOpened.await(3, TimeUnit.SECONDS)) {
                    "page extraction waited behind another page on the database monitor"
                }
            }
            override fun displayName(reference: String) = "$reference.png"
        }
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"), opener)
        val pages = listOf("one", "two").mapIndexed { index, name ->
            PublicationRepository.NewPage(
                id = "page-$name",
                index = index,
                name = "$name.png",
                cachePath = File(""),
                sourceRef = PageSourceRef.Image("remote:$name"),
                width = 8,
                height = 12,
            )
        }
        val publication = PublicationRepository.NewPublication(
            id = "parallel-publication",
            title = "Parallel",
            sourceLabel = "parallel-images",
            sourcePath = "images:parallel",
            format = "images",
            pages = pages,
            coverPageId = pages.first().id,
            addedAt = "1",
            updatedAt = "1",
        )
        db.publications.insert(publication)

        val pool = Executors.newFixedThreadPool(2)
        try {
            val first = pool.submit<ReaderPage> { db.ensurePage(publication.id, pages[0].id) }
            val second = pool.submit<ReaderPage> { db.ensurePage(publication.id, pages[1].id) }
            assertTrue("both pages enter extraction at once", bothPagesOpened.await(2, TimeUnit.SECONDS))
            assertTrue(File(first.get(5, TimeUnit.SECONDS).cachePath ?: "").isFile)
            assertTrue(File(second.get(5, TimeUnit.SECONDS).cachePath ?: "").isFile)
        } finally {
            pool.shutdownNow()
            LibraryDb.closeAll()
        }
    }

    @Test
    fun progressBookmarksAndFavoriteRoundTrip() {
        val root = tempRoot("progress")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(3)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
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

        db.publications.setFavorite(pub.id, true)
        assertTrue(db.publications.list().single().isFavorite)
    }

    @Test
    fun markReadSetsAndClearsProgress() {
        val root = tempRoot("markread")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(4)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        assertEquals(ReadingStatus.NOT_STARTED, pub.readingStatus)
        assertEquals(0.0, pub.progress, 0.0001)

        db.markRead(pub.id, 0)
        val firstPage = db.publications.list().single()
        assertEquals(ReadingStatus.READING, firstPage.readingStatus)
        assertEquals(0.25, firstPage.progress, 0.0001)
        assertTrue(firstPage.isContinueCandidate())

        db.markRead(pub.id, pub.pageCount - 1)
        val finished = db.publications.list().single()
        assertEquals(ReadingStatus.FINISHED, finished.readingStatus)
        assertEquals(1.0, finished.progress, 0.0001)

        db.clearReadingProgress(pub.id)
        val cleared = db.publications.list().single()
        assertEquals(ReadingStatus.NOT_STARTED, cleared.readingStatus)
        assertEquals(0.0, cleared.progress, 0.0001)
        assertNull(db.loadReaderState(pub.id))
        assertTrue("publicação limpa sai de Continuar", !cleared.isContinueCandidate())
    }

    @Test
    fun singlePagePublicationFinishesWhenOpenedOrMarkedReadAndCanBeCleared() {
        val root = tempRoot("single-page-reading")
        val db = openDb(root)
        val comic = File(root, "one-page.cbz").apply {
            writeBytes(cbzBytesWithNames(listOf("only.png")))
        }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val onlyPage = db.listPages(pub.id).single()

        assertEquals(ReadingStatus.NOT_STARTED, pub.readingStatus)

        db.saveReaderState(pub.id, onlyPage.id, 0.4)
        assertEquals(ReadingStatus.FINISHED, db.publications.list().single().readingStatus)

        db.clearReadingProgress(pub.id)
        assertEquals(ReadingStatus.NOT_STARTED, db.publications.list().single().readingStatus)
        assertNull(db.loadReaderState(pub.id))

        db.markRead(pub.id, 0)
        assertEquals(ReadingStatus.FINISHED, db.publications.list().single().readingStatus)
    }

    @Test
    fun openingFirstOfTwoPagesReadsAndOpeningSecondFinishes() {
        val root = tempRoot("two-page-reading")
        val db = openDb(root)
        val comic = File(root, "two-pages.cbz").apply { writeBytes(cbzBytes(2)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val pages = db.listPages(pub.id)

        db.saveReaderState(pub.id, pages[0].id, 0.2)
        assertEquals(ReadingStatus.READING, db.publications.list().single().readingStatus)

        db.saveReaderState(pub.id, pages[1].id, 0.0)
        assertEquals(ReadingStatus.FINISHED, db.publications.list().single().readingStatus)
    }

    @Test
    fun cbzAndImageFolderUseNaturalPageOrder() {
        val root = tempRoot("natural-order")
        val db = openDb(root)
        val names = listOf(
            "page1.jpg", "page2.jpg", "page9.jpg", "page10.jpg", "page11.jpg", "page20.jpg",
            "001.jpg", "002.jpg", "010.jpg",
        )
        val comic = File(root, "natural.cbz").apply { writeBytes(cbzBytesWithNames(names)) }
        db.importPaths(listOf(comic.absolutePath))

        val cbzNames = db.listPages(db.publications.list().single().id).map { it.name }
        assertEquals(
            listOf("001.jpg", "002.jpg", "010.jpg", "page1.jpg", "page2.jpg", "page9.jpg", "page10.jpg", "page11.jpg", "page20.jpg"),
            cbzNames,
        )

        LibraryDb.closeAll()
        val folderDb = LibraryDb.open(File(root, "folder-lib"), File(root, "folder-imports"))
        val folder = File(root, "images").apply { mkdirs() }
        val imageFiles = names.map { File(folder, it).apply { writeBytes(pngBytes()) } }
        folderDb.importPaths(imageFiles.map { it.absolutePath })
        val imageNames = folderDb.listPages(folderDb.publications.list().single().id).map { it.name }
        assertEquals(cbzNames, imageNames)
    }

    @Test
    fun sevenZipExtractsPagesOnDemandAndDeleteRemovesDerivedCache() {
        val root = tempRoot("seven-zip-lifecycle")
        val db = openDb(root)
        val names = listOf("page1.png", "page10.png", "page2.png")
        val archive = sevenZipWithPages(root, names)

        val result = db.importPaths(listOf(archive.absolutePath))
        assertEquals("7z import diagnostics: ${result.diagnostics}", 0, result.diagnostics.size)
        val pub = db.publications.list().single()
        assertEquals("7z", pub.format)
        assertEquals(listOf("page1.png", "page2.png", "page10.png"), db.listPages(pub.id).map { it.name })
        assertTrue("não mantém pasta de extração integral", !File(db.dataDir, "7z-${pub.id}").exists())
        assertEquals(0, db.cacheInfo().entryCount)

        val page = db.listPages(pub.id).first()
        val cachedPath = File(db.ensurePage(pub.id, page.id).cachePath ?: "")
        assertTrue("página pedida é extraída para o cache", cachedPath.isFile)
        assertEquals(1, db.cacheInfo().entryCount)
        db.clearCache()
        assertTrue("limpeza remove a extração derivada", !cachedPath.exists())

        val rebuilt = File(db.ensurePage(pub.id, page.id).cachePath ?: "")
        assertTrue("página continua reconstruível a partir do original", rebuilt.isFile)
        db.deletePublication(pub.id)
        assertTrue("exclusão remove o cache derivado", !rebuilt.exists())
        assertTrue("arquivo original preservado", archive.isFile)
    }

    @Test
    fun sevenZipPageRebuildTimingProbe() {
        val root = tempRoot("seven-zip-rebuild-probe")
        for (pageCount in listOf(50, 100, 200)) {
            val caseRoot = File(root, "pages-$pageCount").apply { mkdirs() }
            val archive = sevenZipWithPages(
                caseRoot,
                (1..pageCount).map { "page-%03d.png".format(it) },
            )
            val db = openDb(caseRoot)
            val outcome = db.importPaths(listOf(archive.absolutePath))
            assertEquals(outcome.diagnostics.toString(), 0, outcome.diagnostics.size)
            val publication = db.publications.list().single()
            val pages = db.listPages(publication.id)
            assertEquals(pageCount, pages.size)

            val indices = listOf(0, pageCount / 2, pageCount / 2 + 1)
            val elapsedMillis = indices.map { index ->
                val startedAt = System.nanoTime()
                val page = db.ensurePage(publication.id, pages[index].id)
                assertTrue(File(page.cachePath ?: "").isFile)
                (System.nanoTime() - startedAt) / 1_000_000.0
            }
            println(
                "7z-page-probe pages=$pageCount first_ms=${elapsedMillis[0]} " +
                    "middle_ms=${elapsedMillis[1]} next_ms=${elapsedMillis[2]}",
            )
            LibraryDb.closeAll()
        }
    }

    @Test
    fun readingTheFirstPagePersistsAnExactContinuePosition() {
        val root = tempRoot("first-page-reading")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(4)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val firstPage = db.listPages(pub.id).first()

        db.saveReaderState(pub.id, firstPage.id, 0.35)

        val updated = db.publications.list().single()
        assertEquals(ReadingStatus.READING, updated.readingStatus)
        assertTrue("primeira página tem progresso positivo", updated.progress > 0.0)
        assertTrue(updated.isContinueCandidate())
        assertEquals(firstPage.id, db.loadReaderState(pub.id)?.pageId)
        assertEquals(0.35, db.loadReaderState(pub.id)?.scrollRatio ?: 0.0, 0.0001)
    }

    @Test
    fun deleteRemovesPublicationAndCacheButKeepsOriginal() {
        val root = tempRoot("delete")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(2)) }
        val originalBytes = comic.readBytes()
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val page = db.listPages(pub.id).first()
        val cacheFile = File(db.ensurePage(pub.id, page.id).cachePath ?: "")

        db.deletePublication(pub.id)

        assertTrue(db.publications.list().isEmpty())
        assertTrue("cache derivado removido", !cacheFile.exists())
        assertTrue("original preservado", originalBytes.contentEquals(comic.readBytes()))
    }

    @Test
    fun cacheInfoCountsDerivedEntriesAndClearEmptiesThem() {
        val root = tempRoot("cache")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(2)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
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
        val pub = db.publications.list().single()
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
        assertTrue(db.publications.list().isEmpty())
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
        assertTrue("o primeiro arquivo ficou", db.publications.list().isNotEmpty())
        assertTrue("progresso reportado", progress.any { it.total == 2 })
        assertTrue(outcome.diagnostics.any { it.contains("cancelada", ignoreCase = true) })
    }

    @Test
    fun librarySurvivesReopenWithSameData() {
        val root = tempRoot("reopen")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(3)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val page = db.listPages(pub.id)[1]
        db.saveReaderState(pub.id, page.id, 0.5)
        db.publications.setFavorite(pub.id, true)

        LibraryDb.closeAll()
        val reopened = LibraryDb.open(File(root, "lib"), File(root, "imports"))
        val restored = reopened.publications.list().single()
        assertEquals(pub.id, restored.id)
        assertEquals(3, restored.pageCount)
        assertTrue(restored.isFavorite)
        assertEquals(page.id, reopened.loadReaderState(pub.id)?.pageId)
    }

    @Test
    fun savingReaderStateUpdatesShelfProgressWithoutLosingRatio() {
        val root = tempRoot("shelf-progress")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(4)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()
        val page = db.listPages(pub.id)[2]

        db.saveReaderState(pub.id, page.id, 0.42)

        assertEquals(0.75, db.publications.list().single().progress, 0.0001)
        assertEquals(0.42, db.loadReaderState(pub.id)?.scrollRatio ?: 0.0, 0.0001)
    }

    @Test
    fun readingSessionIsStoredAndExposedAsShelfSpeed() {
        val root = tempRoot("reading-stats")
        val db = openDb(root)
        val comic = File(root, "HQ.cbz").apply { writeBytes(cbzBytes(4)) }
        db.importPaths(listOf(comic.absolutePath))
        val pub = db.publications.list().single()

        val speed = db.recordReadingSession(pub.id, durationMillis = 120_000, pagesRead = 4)

        assertEquals(2.0, speed?.pagesPerMinute ?: 0.0, 0.0001)
        assertEquals(2.0, db.publications.list().single().readingPagesPerMinute ?: 0.0, 0.0001)
        assertEquals(120_000L, db.loadReadingStats(pub.id)?.totalMillis)
        assertEquals(4, db.loadReadingStats(pub.id)?.pagesRead)
        assertEquals(1, db.loadReadingStats(pub.id)?.sessions)
    }
}
