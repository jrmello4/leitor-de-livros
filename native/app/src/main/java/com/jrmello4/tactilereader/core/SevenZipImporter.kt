package com.jrmello4.tactilereader.core

import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import java.io.File

/** Indexes 7z metadata and reconstructs only the requested page. */
internal object SevenZipImporter {
    private data class Page(
        val member: String,
        val name: String,
        val archiveIndex: Int,
        val width: Int,
        val height: Int,
    )

    fun importPublication(
        db: LibraryDb,
        source: ImportSource,
        shouldCancel: () -> Boolean,
    ): Pub {
        val sourceKey = "7z:${source.reference}"
        db.publications.findBySourcePath(sourceKey)?.let { return it }
        val opener = db.opener
        if (opener.sizeBytes(source.reference) > MAX_ARCHIVE_BYTES) {
            error("7z exceeds the archive size safety limit")
        }
        val publicationId = digestId("publication", sourceKey.toByteArray())
        val indexedPages = mutableListOf<Page>()
        var totalBytes = 0L
        // A SAF stream is spooled only during indexing and removed when indexing ends.
        var spooled: File? = null
        try {
            val local = opener.localPath(source.reference)
            val sevenZ = try {
                if (local != null) {
                    SevenZFile.builder().setFile(File(local)).get()
                } else {
                    spooled = spoolSourceToTemp(db, source.reference, "7z")
                    SevenZFile.builder().setFile(spooled).get()
                }
            } catch (error: Exception) {
                error("Unable to read 7z comic: ${error.message}")
            }
            sevenZ.use { zip ->
                var entry: SevenZArchiveEntry? = zip.nextEntry
                var entryIndex = 0
                while (entry != null) {
                    if (entryIndex % 16 == 0) Importer.ensureNotCancelled(shouldCancel)
                    entryIndex++
                    val current = entry
                    if (!current.isDirectory) {
                        val normalized = validateArchiveName(current.name)
                        val extension = extensionFromName(normalized).orEmpty()
                        if (isImageExtension(extension)) {
                            if (indexedPages.size >= MAX_PAGE_COUNT) {
                                error("7z exceeds the $MAX_PAGE_COUNT page safety limit")
                            }
                            if (current.size > MAX_PAGE_BYTES) {
                                error("7z page $normalized exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit")
                            }
                            totalBytes += current.size
                            if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                                error("7z exceeds the total uncompressed size safety limit")
                            }
                            val bytes = readEntry(zip, current.size)
                            val (width, height) = validateImageDimensions(bytes, normalized)
                            indexedPages.add(
                                Page(
                                    member = normalized,
                                    name = Importer.fileNameOf(normalized),
                                    archiveIndex = entryIndex,
                                    width = width,
                                    height = height,
                                ),
                            )
                        } else {
                            drainEntry(zip)
                        }
                    }
                    entry = zip.nextEntry
                }
            }
        } finally {
            spooled?.delete()
        }
        if (indexedPages.isEmpty()) error("7z contains no supported raster image pages")
        val ordered = indexedPages.sortedWith { left, right ->
            naturalCompare(left.name, right.name).takeIf { it != 0 }
                ?: left.archiveIndex.compareTo(right.archiveIndex)
        }
        val pages = ordered.mapIndexed { index, page ->
            PublicationRepository.NewPage(
                id = "$publicationId-page-%04d".format(index),
                index = index,
                name = page.name,
                cachePath = File(""),
                sourceRef = PageSourceRef.SevenZip(source.reference, page.member),
                width = page.width,
                height = page.height,
            )
        }
        return Importer.persist(
            db,
            PublicationRepository.NewPublication(
                id = publicationId,
                title = Importer.stemOf(source.name(opener)).ifBlank { "Imported 7z" },
                sourceLabel = source.name(opener),
                sourcePath = sourceKey,
                format = "7z",
                pages = pages,
                coverPageId = pages.first().id,
                addedAt = timestampMillis(),
                updatedAt = timestampMillis(),
            ),
        )
    }

    fun rebuildPage(db: LibraryDb, reference: String, member: String): Importer.RebuiltPage {
        val opener = db.opener
        if (!opener.isAvailable(reference)) error("7z source is missing: $reference")
        if (opener.sizeBytes(reference) > MAX_ARCHIVE_BYTES) {
            error("7z exceeds the archive size safety limit")
        }
        val expected = validateArchiveName(member)
        val local = opener.localPath(reference)
        var spooled: File? = null
        try {
            val sevenZ = try {
                if (local != null) {
                    SevenZFile.builder().setFile(File(local)).get()
                } else {
                    spooled = spoolSourceToTemp(db, reference, "7z")
                    SevenZFile.builder().setFile(spooled).get()
                }
            } catch (error: Exception) {
                error("Unable to open 7z page source: ${error.message}")
            }
            sevenZ.use { archive ->
                var entry = archive.nextEntry
                var expandedBytes = 0L
                var entryCount = 0
                while (entry != null) {
                    if (entryCount++ >= MAX_PAGE_COUNT * 4) error("7z has too many entries")
                    val current = entry
                    if (!current.isDirectory) {
                        val name = validateArchiveName(current.name)
                        val size = current.size.coerceAtLeast(0L)
                        expandedBytes += size
                        if (expandedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                            error("7z exceeds the total uncompressed size safety limit")
                        }
                        if (name == expected) {
                            if (size > MAX_PAGE_BYTES) error("7z page $name exceeds the page size safety limit")
                            val bytes = readEntry(archive, size)
                            val (width, height) = validateImageDimensions(bytes, name)
                            return Importer.RebuiltPage(extensionFromName(name).orEmpty(), bytes, width, height)
                        }
                        drainEntry(archive)
                    }
                    entry = archive.nextEntry
                }
            }
        } finally {
            spooled?.delete()
        }
        error("7z page is missing from the original archive: $expected")
    }

    private fun readEntry(zip: SevenZFile, size: Long): ByteArray {
        val out = java.io.ByteArrayOutputStream(size.coerceAtMost(MAX_PAGE_BYTES).toInt())
        val buffer = ByteArray(64 * 1024)
        var remaining = size
        while (remaining > 0) {
            val read = zip.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            if (read < 0) break
            out.write(buffer, 0, read)
            remaining -= read
        }
        return out.toByteArray()
    }

    private fun drainEntry(zip: SevenZFile) {
        val buffer = ByteArray(64 * 1024)
        while (zip.read(buffer, 0, buffer.size) > 0) {
            // Drain non-image entries so the next member can be read.
        }
    }
}
