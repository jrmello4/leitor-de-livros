package com.jrmello4.tactilereader.core

import com.github.junrar.Archive
import com.github.junrar.rarfile.FileHeader
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipException
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream

/**
 * Importadores do núcleo: CBZ (ZIP), CBR/RAR (junrar 8 — RAR4 e RAR5), 7z
 * (commons-compress), pastas de imagens e coleções ZIP aninhadas.
 *
 * As origens vêm do [SourceOpener]: caminho local (ZipFile com acesso
 * aleatório) ou `content://` do SAF (streaming, sem copiar a HQ para dentro
 * do app). Os originais permanecem somente-leitura; os bytes derivados
 * nascem sob demanda em `ensurePage`.
 */
internal object Importer {

    data class RebuiltPage(
        val extension: String,
        val bytes: ByteArray,
        val width: Int,
        val height: Int,
    )

    private enum class Container { Zip, Rar, SevenZip, Unknown }

    /** Cancelamento cooperativo: interrompe entre unidades e a cada 16 itens. */
    private class Cancelled : Exception()

    private fun ensureNotCancelled(shouldCancel: () -> Boolean) {
        if (shouldCancel()) throw Cancelled()
    }

    private sealed class Work(val source: ImportSource, val label: String) {
        class Images(source: ImportSource, val paths: List<ImportSource>) :
            Work(source, "conjunto de imagens")
        class Cbz(source: ImportSource) : Work(source, source.displayName ?: "CBZ")
        class Cbr(source: ImportSource) : Work(source, source.displayName ?: "CBR")
        class SevenZ(source: ImportSource) : Work(source, source.displayName ?: "7z")
        class Collection(source: ImportSource) : Work(source, source.displayName ?: "coleção")
    }

    // ------------------------------------------------------------- entrypoint

    fun importSources(
        db: LibraryDb,
        sources: List<ImportSource>,
        onProgress: (ImportProgress) -> Unit = {},
        shouldCancel: () -> Boolean = { false },
    ): ImportOutcome {
        val opener = db.opener
        val imageSources = mutableListOf<ImportSource>()
        val imageKeys = mutableListOf<String>()
        val archiveSources = mutableListOf<ImportSource>()
        val cbrSources = mutableListOf<ImportSource>()
        val sevenZSources = mutableListOf<ImportSource>()
        val collectionSources = mutableListOf<ImportSource>()
        val diagnostics = mutableListOf<String>()

        val expanded = mutableListOf<ImportSource>()
        for (source in sources) {
            if (shouldCancel()) {
                return ImportOutcome(0, diagnostics, cancelled = true)
            }
            val local = opener.localPath(source.reference)
            if (local != null && File(local).isDirectory) {
                val files = mutableListOf<File>()
                try {
                    collectPublicationFiles(File(local), files)
                } catch (error: Exception) {
                    diagnostics.add("${source.reference}: ${error.message}")
                    continue
                }
                if (files.isEmpty()) {
                    diagnostics.add("${source.reference}: no supported comics or raster images were found.")
                    continue
                }
                files.forEach { expanded.add(ImportSource(it.absolutePath, it.name)) }
            } else {
                expanded.add(source)
            }
        }

        for (source in expanded) {
            if (!opener.isAvailable(source.reference)) {
                diagnostics.add("${source.reference}: source is not available")
                continue
            }
            val name = source.name(opener)
            when (val extension = extensionFromName(name).orEmpty()) {
                in IMAGE_EXTENSIONS -> {
                    imageSources.add(source)
                    imageKeys.add("image:${source.reference}")
                }
                "cbz", "cbr", "rar", "7z" -> when (detectContainer(opener, source.reference)) {
                    Container.Zip -> archiveSources.add(source)
                    Container.Rar -> cbrSources.add(source)
                    Container.SevenZip -> sevenZSources.add(source)
                    Container.Unknown -> diagnostics.add(
                        "$name: file contents are not a supported ZIP/CBZ, RAR/CBR, or 7z archive.",
                    )
                }
                "zip" -> collectionSources.add(source)
                "pdf" -> diagnostics.add(
                    "$name: $PDF_UNAVAILABLE_DIAGNOSTIC",
                )
                else -> diagnostics.add("$name: unsupported publication file.")
            }
        }

        val works = mutableListOf<Work>()
        if (imageSources.isNotEmpty()) {
            works.add(Work.Images(imageSources.first(), imageSources.toList()))
        }
        archiveSources.forEach { works.add(Work.Cbz(it)) }
        cbrSources.forEach { works.add(Work.Cbr(it)) }
        sevenZSources.forEach { works.add(Work.SevenZ(it)) }
        collectionSources.forEach { works.add(Work.Collection(it)) }

        var imported = 0
        var cancelled = false
        for ((index, work) in works.withIndex()) {
            if (shouldCancel()) {
                cancelled = true
                break
            }
            onProgress(ImportProgress(index, works.size, work.label))
            try {
                when (work) {
                    is Work.Images -> {
                        val key = sourceKey("images", imageKeys)
                        importImageSet(db, key, work.paths)
                    }
                    is Work.Cbz -> importCbz(db, "archive:${work.source.reference}", work.source, shouldCancel)
                    is Work.Cbr -> importCbr(db, "cbr:${work.source.reference}", work.source, shouldCancel)
                    is Work.SevenZ -> importSevenZip(db, work.source, shouldCancel)
                    is Work.Collection -> {
                        val nested = importCollectionZip(db, work.source, shouldCancel)
                        imported += nested.importedCount
                        diagnostics.addAll(nested.diagnostics)
                        if (nested.cancelled) {
                            cancelled = true
                            break
                        }
                        onProgress(ImportProgress(index + 1, works.size, work.label))
                        continue
                    }
                }
                imported++
            } catch (_: Cancelled) {
                cancelled = true
                break
            } catch (error: Exception) {
                diagnostics.add("${work.label}: ${error.message}")
            }
            onProgress(ImportProgress(index + 1, works.size, work.label))
        }
        if (cancelled) {
            diagnostics.add("Importação cancelada; o que já entrou ficou na estante.")
        }
        return ImportOutcome(imported, diagnostics, cancelled)
    }

    // ------------------------------------------------------- ZIP unificado

    /** Lê entradas de um ZIP com acesso aleatório (arquivo) ou streaming (SAF). */
    private class ZipReader : AutoCloseable {
        private val file: ZipFile?
        private val stream: ZipInputStream?
        private var entries: java.util.Enumeration<out ZipEntry>? = null

        constructor(file: ZipFile) {
            this.file = file
            this.stream = null
            this.entries = file.entries()
        }

        constructor(stream: ZipInputStream) {
            this.file = null
            this.stream = stream
        }

        /**
         * Próxima entrada. Para streaming, leia `data.read()` ANTES de
         * chamar `next()` de novo (a entrada corrente termina no stream).
         */
        fun next(): ZipEntryData? {
            if (file != null) {
                val header = entries?.takeIf { it.hasMoreElements() }?.nextElement() ?: return null
                return ZipEntryData(header.name, header.size) {
                    file.getInputStream(header).use { it.readBytes() }
                }
            }
            val header = stream?.nextEntry ?: return null
            return ZipEntryData(header.name, header.size) {
                stream.readBytes()
            }
        }

        override fun close() {
            file?.close()
            stream?.close()
        }
    }

    private class ZipEntryData(
        val name: String,
        val declaredSize: Long,
        val read: () -> ByteArray,
    )

    private fun entryBytes(reader: ZipReader, data: ZipEntryData, label: String): ByteArray {
        if (data.declaredSize > MAX_PAGE_BYTES) {
            error("$label exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit")
        }
        val bytes = try {
            data.read()
        } catch (_: ZipException) {
            error("encrypted CBZ entries are not supported")
        }
        if (bytes.size.toLong() > MAX_PAGE_BYTES) {
            error("$label exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit after extraction")
        }
        return bytes
    }

    // ------------------------------------------------------------------ CBZ

    private fun importCbz(
        db: LibraryDb,
        sourceKey: String,
        source: ImportSource,
        shouldCancel: () -> Boolean = { false },
    ): Pub {
        db.findPublicationBySourcePath(sourceKey)?.let { return it }
        val opener = db.opener
        if (opener.sizeBytes(source.reference) > MAX_ARCHIVE_BYTES) {
            error("CBZ exceeds the archive size safety limit")
        }
        val publicationId = digestId("publication", sourceKey.toByteArray())
        val pages = mutableListOf<LibraryDb.NewPage>()
        var totalBytes = 0L
        var comicInfoTitle: String? = null
        val local = opener.localPath(source.reference)
        val reader = if (local != null) {
            ZipReader(ZipFile(File(local)))
        } else {
            ZipReader(ZipInputStream(opener.openStream(source.reference)))
        }
        try {
            while (true) {
                if (pages.size % 16 == 0) ensureNotCancelled(shouldCancel)
                val entry = reader.next() ?: break
                if (entry.name.endsWith("/")) continue
                val normalized = validateArchiveName(entry.name)
                if (!isImageExtension(extensionFromName(normalized).orEmpty())) {
                    if (normalized.lowercase().endsWith("comicinfo.xml") &&
                        entry.declaredSize in 1..(256 * 1024)
                    ) {
                        comicInfoTitle = runCatching {
                            readComicInfoTitle(entry.read().inputStream())
                        }.getOrNull()
                    }
                    continue
                }
                if (pages.size >= MAX_PAGE_COUNT) {
                    error("CBZ exceeds the $MAX_PAGE_COUNT page safety limit")
                }
                val bytes = entryBytes(reader, entry, normalized)
                totalBytes += bytes.size
                if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                    error("CBZ exceeds the total uncompressed size safety limit")
                }
                val (width, height) = validateImageDimensions(bytes, normalized)
                pages.add(
                    LibraryDb.NewPage(
                        id = "$publicationId-page-%04d".format(pages.size),
                        index = pages.size,
                        name = fileNameOf(normalized),
                        cachePath = File(""),
                        sourceRef = PageSourceRef.Archive(source.reference, normalized),
                        width = width,
                        height = height,
                    ),
                )
            }
        } finally {
            reader.close()
        }
        if (pages.isEmpty()) error("CBZ contains no supported raster image pages")
        val ordered = pages.sortedWith(compareBy({ it.name }, { it.index })).let { list ->
            list.mapIndexed { index, page -> page.copy(index = index) }
        }
        val title = comicInfoTitle
            ?: stemOf(source.name(opener)).ifBlank { "Imported CBZ" }
        return persist(
            db,
            LibraryDb.NewPublication(
                id = publicationId,
                title = title,
                sourceLabel = source.name(opener),
                sourcePath = sourceKey,
                format = "cbz",
                pages = ordered,
                coverPageId = ordered.first().id,
                addedAt = timestampMillis(),
                updatedAt = timestampMillis(),
            ),
        )
    }

    // ------------------------------------------------------------------ CBR

    private fun importCbr(
        db: LibraryDb,
        sourceKey: String,
        source: ImportSource,
        shouldCancel: () -> Boolean = { false },
    ): Pub {
        db.findPublicationBySourcePath(sourceKey)?.let { return it }
        val opener = db.opener
        if (opener.sizeBytes(source.reference) > MAX_ARCHIVE_BYTES) {
            error("CBR exceeds the ${MAX_ARCHIVE_BYTES / 1024 / 1024 / 1024} GiB document size safety limit")
        }
        val publicationId = digestId("publication", sourceKey.toByteArray())
        val pages = mutableListOf<LibraryDb.NewPage>()
        val seenNames = mutableSetOf<String>()
        var totalBytes = 0L
        val local = opener.localPath(source.reference)
        val archive = try {
            if (local != null) Archive(File(local)) else Archive(opener.openStream(source.reference))
        } catch (error: Exception) {
            error("Unable to read CBR/RAR: ${error.message}")
        }
        archive.use { rar ->
            val headers = mutableListOf<FileHeader>()
            while (true) {
                val header = rar.nextFileHeader() ?: break
                headers.add(header)
            }
            for ((entryIndex, header) in headers.withIndex()) {
                if (entryIndex % 16 == 0) ensureNotCancelled(shouldCancel)
                val normalized = validateArchiveName(header.fileName)
                if (header.isEncrypted) {
                    error("encrypted CBR entry is not supported: $normalized")
                }
                if (header.isSplitBefore || header.isSplitAfter) {
                    error("split CBR entries are not supported: $normalized")
                }
                if (header.isDirectory ||
                    !isImageExtension(extensionFromName(normalized).orEmpty())
                ) {
                    continue
                }
                if (!seenNames.add(normalized.lowercase())) {
                    error("CBR contains duplicate page names")
                }
                if (pages.size >= MAX_PAGE_COUNT) {
                    error("CBR exceeds the $MAX_PAGE_COUNT page safety limit")
                }
                val unpacked = header.fullUnpackSize
                if (unpacked > MAX_PAGE_BYTES) {
                    error("CBR page $normalized exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit")
                }
                totalBytes += unpacked
                if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                    error("CBR exceeds the total uncompressed size safety limit")
                }
                val bytes = java.io.ByteArrayOutputStream().use { out ->
                    rar.extractFile(header, out)
                    out.toByteArray()
                }
                if (bytes.size.toLong() > MAX_PAGE_BYTES) {
                    error("CBR page $normalized exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit after extraction")
                }
                val (width, height) = validateImageDimensions(bytes, normalized)
                pages.add(
                    LibraryDb.NewPage(
                        id = "$publicationId-page-%04d".format(pages.size),
                        index = pages.size,
                        name = fileNameOf(normalized),
                        cachePath = File(""),
                        sourceRef = PageSourceRef.Archive(source.reference, normalized),
                        width = width,
                        height = height,
                    ),
                )
            }
        }
        if (pages.isEmpty()) error("CBR contains no supported raster image pages")
        val ordered = pages.sortedWith(compareBy({ it.name }, { it.index })).let { list ->
            list.mapIndexed { index, page -> page.copy(index = index) }
        }
        return persist(
            db,
            LibraryDb.NewPublication(
                id = publicationId,
                title = stemOf(source.name(opener)).ifBlank { "Imported CBR" },
                sourceLabel = source.name(opener),
                sourcePath = sourceKey,
                format = "cbr",
                pages = ordered,
                coverPageId = ordered.first().id,
                addedAt = timestampMillis(),
                updatedAt = timestampMillis(),
            ),
        )
    }

    // ------------------------------------------------------------------- 7z

    private fun importSevenZip(
        db: LibraryDb,
        source: ImportSource,
        shouldCancel: () -> Boolean = { false },
    ): Pub {
        val sourceKey = "7z:${source.reference}"
        db.findPublicationBySourcePath(sourceKey)?.let { return it }
        val opener = db.opener
        if (opener.sizeBytes(source.reference) > MAX_ARCHIVE_BYTES) {
            error("7z exceeds the archive size safety limit")
        }
        val publicationId = digestId("publication", sourceKey.toByteArray())
        val extractDir = File(db.dataDir, "7z-$publicationId")
        extractDir.mkdirs()
        val imagePaths = mutableListOf<File>()
        var totalBytes = 0L
        // Streaming (SAF) é spoolado para um temporário e removido no fim:
        // as páginas viram imagens extraídas, o arquivo 7z não é mais preciso.
        var spooled: File? = null
        try {
            val local = opener.localPath(source.reference)
            val sevenZ = try {
                if (local != null) {
                    SevenZFile.builder().setFile(File(local)).get()
                } else {
                    spooled = spoolToTemp(db, source.reference)
                    SevenZFile.builder().setFile(spooled).get()
                }
            } catch (error: Exception) {
                error("Unable to read 7z comic: ${error.message}")
            }
            sevenZ.use { zip ->
                var entry: SevenZArchiveEntry? = zip.nextEntry
                var entryIndex = 0
                while (entry != null) {
                    if (entryIndex % 16 == 0) ensureNotCancelled(shouldCancel)
                    entryIndex++
                    val current = entry
                    if (!current.isDirectory) {
                        val normalized = validateArchiveName(current.name)
                        val extension = extensionFromName(normalized).orEmpty()
                        if (isImageExtension(extension)) {
                            if (imagePaths.size >= MAX_PAGE_COUNT) {
                                error("7z exceeds the $MAX_PAGE_COUNT page safety limit")
                            }
                            if (current.size > MAX_PAGE_BYTES) {
                                error("7z page $normalized exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit")
                            }
                            totalBytes += current.size
                            if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                                error("7z exceeds the total uncompressed size safety limit")
                            }
                            val bytes = readSevenZEntry(zip, current.size)
                            validateImageDimensions(bytes, normalized)
                            val target = File(
                                extractDir,
                                "%04d-%s".format(imagePaths.size, fileNameOf(normalized)),
                            )
                            target.writeBytes(bytes)
                            imagePaths.add(target)
                        } else {
                            drainSevenZEntry(zip)
                        }
                    }
                    entry = zip.nextEntry
                }
            }
        } catch (error: Exception) {
            extractDir.deleteRecursively()
            throw error
        } finally {
            spooled?.delete()
        }
        if (imagePaths.isEmpty()) {
            extractDir.deleteRecursively()
            error("7z contains no supported raster image pages")
        }
        imagePaths.sortWith(compareBy({ it.name }, { it.path }))
        return try {
            importImageSet(
                db,
                sourceKey,
                imagePaths.map { ImportSource(it.absolutePath, it.name) },
                title = stemOf(source.name(opener)),
            )
        } catch (error: Exception) {
            extractDir.deleteRecursively()
            throw error
        }
    }

    private fun spoolToTemp(db: LibraryDb, reference: String): File {
        val tempDir = File(db.dataDir, "tmp").apply { mkdirs() }
        val target = File(tempDir, "spool-${System.nanoTime()}.7z")
        var total = 0L
        db.opener.openStream(reference).use { input ->
            FileOutputStream(target).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    total += read
                    if (total > MAX_ARCHIVE_BYTES) {
                        target.delete()
                        error("7z exceeds the archive size safety limit")
                    }
                    output.write(buffer, 0, read)
                }
            }
        }
        return target
    }

    private fun readSevenZEntry(zip: SevenZFile, size: Long): ByteArray {
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

    private fun drainSevenZEntry(zip: SevenZFile) {
        val buffer = ByteArray(64 * 1024)
        while (zip.read(buffer, 0, buffer.size) > 0) {
            // Descarta o conteúdo não-imagem para posicionar no próximo entry.
        }
    }

    // -------------------------------------------------------------- imagens

    private fun importImageSet(
        db: LibraryDb,
        sourceKey: String,
        paths: List<ImportSource>,
        title: String? = null,
    ): Pub {
        db.findPublicationBySourcePath(sourceKey)?.let { return it }
        val opener = db.opener
        val sorted = paths.distinctBy { it.reference }.sortedWith(
            compareBy({ it.name(opener) }, { it.reference }),
        )
        if (sorted.size > MAX_PAGE_COUNT) {
            error("image set exceeds the $MAX_PAGE_COUNT page safety limit")
        }
        val publicationId = digestId("publication", sourceKey.toByteArray())
        val pages = mutableListOf<LibraryDb.NewPage>()
        var totalBytes = 0L
        for ((index, source) in sorted.withIndex()) {
            val size = opener.sizeBytes(source.reference)
            if (size > MAX_PAGE_BYTES) {
                error("${source.name(opener)} exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit")
            }
            totalBytes += size
            if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                error("image set exceeds the total size safety limit")
            }
            val bytes = opener.openStream(source.reference).use { it.readBytes() }
            val label = source.name(opener)
            val (width, height) = validateImageDimensions(bytes, label)
            pages.add(
                LibraryDb.NewPage(
                    id = "$publicationId-page-%04d".format(index),
                    index = index,
                    name = label,
                    cachePath = File(""),
                    sourceRef = PageSourceRef.Image(source.reference),
                    width = width,
                    height = height,
                ),
            )
        }
        val derivedTitle = title
            ?: sorted.firstOrNull()?.let { stemOf(it.name(opener)) }
            ?: "Imported pages"
        val sourceLabel = if (sorted.size == 1) {
            sorted[0].name(opener)
        } else {
            "${sorted.size} raster image files"
        }
        return persist(
            db,
            LibraryDb.NewPublication(
                id = publicationId,
                title = derivedTitle,
                sourceLabel = sourceLabel,
                sourcePath = sourceKey,
                format = "images",
                pages = pages,
                coverPageId = pages.first().id,
                addedAt = timestampMillis(),
                updatedAt = timestampMillis(),
            ),
        )
    }

    // ------------------------------------------------------------ coleções

    private fun importCollectionZip(
        db: LibraryDb,
        source: ImportSource,
        shouldCancel: () -> Boolean = { false },
    ): ImportOutcome {
        val opener = db.opener
        val collectionId = digestId("collection", source.reference.toByteArray())
        val targetDir = File(db.dataDir, "collection-$collectionId")
        targetDir.mkdirs()
        val nestedPaths = mutableListOf<String>()
        var totalBytes = 0L
        ZipInputStream(opener.openStream(source.reference)).use { stream ->
            var index = 0
            while (true) {
                if (index % 16 == 0) ensureNotCancelled(shouldCancel)
                val entry = stream.nextEntry ?: break
                if (entry.isDirectory) {
                    index++
                    continue
                }
                val normalized = validateArchiveName(entry.name)
                val nestedExtension = extensionFromName(normalized).orEmpty()
                if (nestedExtension !in setOf("cbr", "rar", "cbz", "7z", "pdf")) {
                    index++
                    continue
                }
                if (entry.size > MAX_ARCHIVE_BYTES) {
                    error("collection item exceeds the 1 GiB safety limit: $normalized")
                }
                if (index >= MAX_COLLECTION_ITEMS) {
                    error("collection exceeds the $MAX_COLLECTION_ITEMS item safety limit")
                }
                val fileName = fileNameOf(normalized)
                val legacyTarget = File(targetDir, "%04d-%s".format(index, fileName))
                val itemDir = File(targetDir, "%04d".format(index))
                val target = if (legacyTarget.isFile) {
                    legacyTarget
                } else {
                    itemDir.mkdirs()
                    File(itemDir, fileName)
                }
                val temporary = File(targetDir, ".%04d.tmp".format(index))
                var written = 0L
                FileOutputStream(temporary).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = stream.read(buffer)
                        if (read <= 0) break
                        written += read
                        totalBytes += read
                        if (totalBytes > MAX_COLLECTION_BYTES) {
                            temporary.delete()
                            error("collection exceeds the 64 GiB extracted size safety limit")
                        }
                        output.write(buffer, 0, read)
                    }
                }
                if (written == 0L) {
                    temporary.delete()
                    index++
                    continue
                }
                temporary.renameTo(target)
                nestedPaths.add(target.path)
                index++
            }
        }
        if (nestedPaths.isEmpty()) {
            error("collection ZIP contains no CBR, CBZ, or PDF publications")
        }
        return importSources(
            db,
            nestedPaths.map { ImportSource(it, File(it).name) },
            shouldCancel = shouldCancel,
        )
    }

    // ------------------------------------------------------------ rebuild

    /** Reconstrói os bytes de uma página a partir do original somente-leitura. */
    fun rebuildPage(db: LibraryDb, format: String, sourceRef: PageSourceRef): RebuiltPage =
        when (sourceRef) {
            is PageSourceRef.Image -> rebuildImagePage(db, sourceRef.path)
            is PageSourceRef.Archive -> {
                when (format) {
                    "cbz" -> rebuildCbzPage(db, sourceRef.path, sourceRef.member)
                    "cbr" -> rebuildCbrPage(db, sourceRef.path, sourceRef.member)
                    else -> error("page source reference does not match the publication format")
                }
            }
            is PageSourceRef.Pdf -> error(PDF_UNAVAILABLE_DIAGNOSTIC)
        }

    private fun rebuildImagePage(db: LibraryDb, reference: String): RebuiltPage {
        val opener = db.opener
        if (!opener.isAvailable(reference)) error("image source is missing: $reference")
        if (opener.sizeBytes(reference) > MAX_PAGE_BYTES) {
            error("$reference exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit")
        }
        val bytes = opener.openStream(reference).use { it.readBytes() }
        val label = opener.displayName(reference) ?: reference
        val (width, height) = validateImageDimensions(bytes, label)
        val extension = extensionFromName(label).orEmpty()
        return RebuiltPage(extension, bytes, width, height)
    }

    private fun rebuildCbzPage(db: LibraryDb, reference: String, member: String): RebuiltPage {
        val opener = db.opener
        if (opener.sizeBytes(reference) > MAX_ARCHIVE_BYTES) {
            error("CBZ exceeds the archive size safety limit")
        }
        val normalizedMember = validateArchiveName(member)
        val local = opener.localPath(reference)
        val reader = if (local != null) {
            ZipReader(ZipFile(File(local)))
        } else {
            ZipReader(ZipInputStream(opener.openStream(reference)))
        }
        try {
            while (true) {
                val entry = reader.next() ?: break
                if (entry.name.endsWith("/")) continue
                if (validateArchiveName(entry.name) != normalizedMember) continue
                val bytes = entryBytes(reader, entry, normalizedMember)
                val (width, height) = validateImageDimensions(bytes, normalizedMember)
                val extension = extensionFromName(normalizedMember)
                    ?: error("CBZ image extension missing")
                return RebuiltPage(extension, bytes, width, height)
            }
        } finally {
            reader.close()
        }
        error("CBZ page source is missing: $normalizedMember")
    }

    private fun rebuildCbrPage(db: LibraryDb, reference: String, member: String): RebuiltPage {
        val opener = db.opener
        if (opener.sizeBytes(reference) > MAX_ARCHIVE_BYTES) {
            error("CBR exceeds the archive size safety limit")
        }
        val normalizedMember = validateArchiveName(member)
        val local = opener.localPath(reference)
        val archive = try {
            if (local != null) Archive(File(local)) else Archive(opener.openStream(reference))
        } catch (error: Exception) {
            error("Unable to read CBR/RAR: ${error.message}")
        }
        archive.use { rar ->
            while (true) {
                val header = rar.nextFileHeader() ?: break
                val current = validateArchiveName(header.fileName)
                if (current != normalizedMember) continue
                if (header.isDirectory || header.isEncrypted || header.isSplitBefore || header.isSplitAfter) {
                    error("CBR page source cannot be reconstructed")
                }
                val unpacked = header.fullUnpackSize
                if (unpacked > MAX_PAGE_BYTES) {
                    error("CBR page $normalizedMember exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit")
                }
                val bytes = java.io.ByteArrayOutputStream().use { out ->
                    rar.extractFile(header, out)
                    out.toByteArray()
                }
                if (bytes.size.toLong() > MAX_PAGE_BYTES) {
                    error("CBR page $normalizedMember exceeds the ${MAX_PAGE_BYTES / 1024 / 1024} MiB page limit after extraction")
                }
                val (width, height) = validateImageDimensions(bytes, normalizedMember)
                val extension = extensionFromName(normalizedMember)
                    ?: error("CBR image extension missing")
                return RebuiltPage(extension, bytes, width, height)
            }
        }
        error("CBR page source is missing: $normalizedMember")
    }

    // ------------------------------------------------------------- helpers

    private fun persist(db: LibraryDb, publication: LibraryDb.NewPublication): Pub {
        val existing = db.findPublicationBySourcePath(publication.sourcePath)
        if (existing != null) return existing
        return db.insertPublication(publication)
    }

    private fun sourceKey(prefix: String, values: List<String>): String {
        val joined = values.sorted().joinToString("\n")
        return "$prefix:${digestId("source", joined.toByteArray())}"
    }

    private fun detectContainer(opener: SourceOpener, reference: String): Container {
        val signature = ByteArray(8)
        val read = try {
            opener.openStream(reference).use { it.read(signature) }
        } catch (_: Exception) {
            0
        }
        val bytes = signature.copyOf(read.coerceAtLeast(0))
        return when {
            bytes.size >= 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte() &&
                (bytes[2] == 3.toByte() || bytes[2] == 5.toByte() || bytes[2] == 7.toByte()) ->
                Container.Zip
            bytes.size >= 7 && bytes[0] == 'R'.code.toByte() && bytes[1] == 'a'.code.toByte() &&
                bytes[2] == 'r'.code.toByte() && bytes[3] == '!'.code.toByte() -> Container.Rar
            bytes.size >= 6 && bytes[0] == '7'.code.toByte() && bytes[1] == 'z'.code.toByte() &&
                bytes[2] == 0xBC.toByte() && bytes[3] == 0xAF.toByte() -> Container.SevenZip
            else -> Container.Unknown
        }
    }

    private fun collectPublicationFiles(root: File, output: MutableList<File>) {
        val children = root.listFiles() ?: return
        for (child in children) {
            if (child.isDirectory) {
                collectPublicationFiles(child, output)
                continue
            }
            if (!child.isFile) continue
            val extension = extensionFromName(child.name).orEmpty()
            if (isImageExtension(extension) ||
                extension in setOf("cbz", "cbr", "rar", "7z", "pdf", "zip")
            ) {
                val canonical = child.canonicalFile
                require(canonical.path.startsWith(root.canonicalFile.path)) {
                    "publication path escaped the selected folder"
                }
                output.add(canonical)
            }
        }
    }

    private fun fileNameOf(normalized: String): String =
        normalized.substringAfterLast('/').ifBlank { normalized }

    private fun stemOf(name: String): String {
        val base = name.substringAfterLast('/')
        return base.substringBeforeLast('.', base)
    }

    /** Título a partir do `ComicInfo.xml` (Série #NN > Título > Série). */
    internal fun readComicInfoTitle(stream: InputStream): String? {
        val xml = stream.bufferedReader(Charsets.UTF_8).readText()
        if (xml.isBlank()) return null
        val fields = readComicInfoFields(xml)
        val series = fields["Series"]
        val title = fields["Title"]
        val number = fields["Number"]
        val volume = fields["Volume"]
        return when {
            series != null && !number.isNullOrBlank() -> "$series #$number"
            series != null && !volume.isNullOrBlank() -> "$series v$volume"
            title != null -> title
            series != null -> series
            else -> null
        }
    }

    /** Metadados do `ComicInfo.xml` usados pela estante (título/autor/ano/gênero). */
    internal fun readComicInfoFields(xml: String): Map<String, String> {
        if (xml.isBlank()) return emptyMap()
        val out = mutableMapOf<String, String>()
        for (name in listOf("Series", "Title", "Number", "Volume", "Writer", "Year", "Genre")) {
            val match = Regex(
                "<$name(?:\\s[^>]*)?>(.*?)</$name>",
                setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
            ).find(xml) ?: continue
            val value = match.groupValues[1].trim()
            if (value.isNotEmpty()) {
                out[name] = value
            }
        }
        return out
    }
}
