package com.jrmello4.tactilereader.core

import android.database.Cursor
import java.io.File

/** Owns publication records and their SQLite queries. */
internal class PublicationRepository(private val db: LibraryDb) {

    fun list(): List<Pub> = synchronized(db) { listInternal() }

    fun findBySourcePath(sourcePath: String): Pub? =
        synchronized(db) { findBySourcePathInternal(sourcePath) }

    fun setFavorite(publicationId: String, favorite: Boolean) =
        synchronized(db) { setFavoriteInternal(publicationId, favorite) }

    fun appendDiagnostic(publicationId: String, diagnostic: String) =
        synchronized(db) { appendDiagnosticInternal(publicationId, diagnostic) }

    fun originPaths(publicationId: String): Set<String> =
        synchronized(db) { publicationOriginPathsInternal(publicationId) }

    fun otherOriginPaths(publicationId: String): Set<String> =
        synchronized(db) { otherOriginPathsInternal(publicationId) }

    fun insert(publication: NewPublication): Pub = synchronized(db) { insertInternal(publication) }

    fun exists(publicationId: String): Boolean = synchronized(db) { existsInternal(publicationId) }

    /** Removes the publication row and its indexed data in one SQLite transaction. */
    fun deleteRows(publicationId: String) = synchronized(db) {
        require(existsInternal(publicationId)) { "publication does not exist" }
        db.database.beginTransaction()
        try {
            for (table in listOf(
                "bookmarks",
                "reader_states",
                "cache_entries",
                "panel_graphs",
                "progress",
                "pages",
            )) {
                db.execInsert("DELETE FROM $table WHERE publication_id = ?", arrayOf(publicationId))
            }
            db.execInsert("DELETE FROM publications WHERE id = ?", arrayOf(publicationId))
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
    }

    internal data class NewPage(
        val id: String,
        val index: Int,
        val name: String,
        val cachePath: File,
        val sourceRef: PageSourceRef,
        val width: Int,
        val height: Int,
    )

    internal data class NewPublication(
        val id: String,
        val title: String,
        val sourceLabel: String,
        val sourcePath: String,
        val format: String,
        val pages: List<NewPage>,
        val coverPageId: String,
        val direction: String = "ltr",
        val addedAt: String,
        val updatedAt: String,
        val diagnostic: String? = null,
        val author: String? = null,
        val year: Int? = null,
        val genre: String? = null,
        val seriesName: String? = null,
    )

    /** Insere a publicação indexada; os bytes derivados nascem sob demanda. */
    private fun insertInternal(publication: NewPublication): Pub {
        db.database.beginTransaction()
        try {
            db.execInsert(
                """
                INSERT INTO publications
                    (id, title, source_label, format, source_path, cover_page_id,
                     direction, added_at, updated_at, diagnostic,
                     custom_cover_source, custom_cover_cache, custom_cover_name,
                     author, year, genre, series_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
                """.trimIndent(),
                arrayOf(
                    publication.id,
                    publication.title,
                    publication.sourceLabel,
                    publication.format,
                    publication.sourcePath,
                    publication.coverPageId,
                    publication.direction,
                    publication.addedAt,
                    publication.updatedAt,
                    publication.diagnostic,
                    publication.author,
                    publication.year,
                    publication.genre,
                    publication.seriesName,
                ),
            )
            for (page in publication.pages) {
                val pageCachePath = page.cachePath.takeIf { it.isFile && db.isInside(db.cacheDir, it) }
                db.execInsert(
                    """
                    INSERT INTO pages
                        (id, publication_id, page_index, name, cache_path, source_ref, width, height)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    arrayOf(
                        page.id,
                        publication.id,
                        page.index,
                        page.name,
                        pageCachePath?.path ?: "",
                        page.sourceRef.toJson(),
                        page.width,
                        page.height,
                    ),
                )
                if (pageCachePath != null) {
                    db.execInsert(
                        """
                        INSERT INTO cache_entries
                            (page_id, publication_id, cache_path, byte_size, last_accessed_at, pinned)
                        VALUES (?, ?, ?, ?, ?, 0)
                        """.trimIndent(),
                        arrayOf(
                            page.id,
                            publication.id,
                            pageCachePath.path,
                            pageCachePath.length(),
                            publication.updatedAt,
                        ),
                    )
                }
            }
            db.execInsert(
                "INSERT INTO progress (publication_id, current_page, updated_at, reading_status) VALUES (?, 0, ?, 0)",
                arrayOf(publication.id, publication.updatedAt),
            )
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
        return findBySourcePathInternal(publication.sourcePath)
            ?: error("publication disappeared after insert")
    }

    private fun existsInternal(publicationId: String): Boolean =
        db.queryLong("SELECT COUNT(*) FROM publications WHERE id = ?", arrayOf(publicationId)) > 0


    private fun listInternal(): List<Pub> {
        val publications = mutableListOf<Pub>()
        db.rawQuery(
            """
            SELECT p.id, p.title, p.source_label, p.format, p.cover_page_id,
                   p.added_at, p.updated_at, p.is_favorite, p.diagnostic,
                   p.custom_cover_cache, p.custom_cover_name, p.source_path, p.direction,
                   p.author, p.year, p.genre, p.series_name,
                   rs.last_read_at,
                   CASE WHEN rs.total_millis > 0 AND rs.pages_read > 0
                        THEN rs.pages_read * 60000.0 / rs.total_millis ELSE NULL END,
                   COALESCE(page_summary.page_count, 0),
                   COALESCE(pr.current_page, 0),
                   COALESCE(pr.reading_status, 0),
                   COALESCE(page_summary.first_page_id, ''),
                   page_summary.cover_src,
                   current_read_page.id
              FROM publications AS p
              LEFT JOIN reading_stats AS rs ON rs.publication_id = p.id
              LEFT JOIN progress AS pr ON pr.publication_id = p.id
              LEFT JOIN (
                    SELECT publication_id,
                           COUNT(*) AS page_count,
                           MAX(CASE WHEN page_index = 0 THEN id END) AS first_page_id,
                           MAX(CASE WHEN page_index = 0 THEN NULLIF(cache_path, '') END) AS cover_src
                      FROM pages
                     GROUP BY publication_id
              ) AS page_summary ON page_summary.publication_id = p.id
              LEFT JOIN pages AS current_read_page
                ON current_read_page.publication_id = p.id
               AND current_read_page.page_index = CASE
                    WHEN COALESCE(pr.current_page, 0) < 0 THEN 0
                    WHEN COALESCE(pr.current_page, 0) >= COALESCE(page_summary.page_count, 0)
                    THEN MAX(COALESCE(page_summary.page_count, 0) - 1, 0)
                    ELSE COALESCE(pr.current_page, 0)
               END
             ORDER BY p.updated_at DESC, p.title COLLATE NOCASE ASC
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                publications.add(cursor.toShelfPublication())
            }
        }
        return publications
    }

    private fun findBySourcePathInternal(sourcePath: String): Pub? {
        val row = db.rawQuery(
            """
            SELECT id, title, source_label, format, cover_page_id,
                   added_at, updated_at, is_favorite, diagnostic,
                   custom_cover_cache, custom_cover_name, source_path, direction,
                   author, year, genre, series_name,
                   (SELECT last_read_at FROM reading_stats WHERE publication_id = publications.id),
                   (SELECT CASE
                       WHEN total_millis > 0 AND pages_read > 0
                       THEN pages_read * 60000.0 / total_millis
                       ELSE NULL
                    END FROM reading_stats WHERE publication_id = publications.id)
              FROM publications WHERE source_path = ?
            """.trimIndent(),
            arrayOf(sourcePath),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toPublicationRow() else null }
        return row?.let { readPublicationSummary(it, full = true) }
    }


    private fun setFavoriteInternal(publicationId: String, favorite: Boolean) {
        db.execInsert(
            "UPDATE publications SET is_favorite = ?, updated_at = ? WHERE id = ?",
            arrayOf(if (favorite) 1 else 0, timestampMillis(), publicationId),
        )
    }

    /** Define a página lida; use [clearReadingProgress] para voltar a NOT_STARTED. */

    private fun validCustomCover(path: String): Boolean {
        val file = File(path)
        if (!file.isFile) return false
        return db.isInside(db.cacheDir, file)
    }

    private fun appendDiagnosticInternal(publicationId: String, diagnostic: String) {
        db.execInsert(
            """
            UPDATE publications
               SET diagnostic = CASE
                   WHEN diagnostic IS NULL OR diagnostic = '' THEN ?
                   WHEN instr(diagnostic, ?) > 0 THEN diagnostic
                   ELSE diagnostic || ' ' || ?
               END
             WHERE id = ?
            """.trimIndent(),
            arrayOf(diagnostic, diagnostic, diagnostic, publicationId),
        )
    }

    private fun publicationOriginPathsInternal(publicationId: String): Set<String> {
        val out = mutableSetOf<String>()
        db.rawQuery(
            "SELECT source_ref FROM pages WHERE publication_id = ? AND source_ref <> ''",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                PageSourceRef.fromJson(cursor.getString(0))?.originPath?.let { out.add(it) }
            }
        }
        db.rawQuery(
            "SELECT source_path FROM publications WHERE id = ?",
            arrayOf(publicationId),
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                legacyOriginPath(cursor.getString(0))?.let { out.add(it) }
            }
        }
        return out
    }

    private fun otherOriginPathsInternal(publicationId: String): Set<String> {
        val out = mutableSetOf<String>()
        db.rawQuery(
            "SELECT source_ref FROM pages WHERE publication_id <> ? AND source_ref <> ''",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                PageSourceRef.fromJson(cursor.getString(0))?.originPath?.let { out.add(it) }
            }
        }
        db.rawQuery(
            "SELECT source_path FROM publications WHERE id <> ?",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                legacyOriginPath(cursor.getString(0))?.let { out.add(it) }
            }
        }
        return out
    }

    internal fun legacyOriginPath(sourcePath: String): String? =
        listOf("archive:", "cbr:", "7z:", "pdf:", "image:")
            .firstOrNull { sourcePath.startsWith(it) }
            ?.let { sourcePath.removePrefix(it) }


    private fun readPublicationSummary(row: PublicationRow, full: Boolean = false): Pub {
        val normalized = normalizeImportNames(row)
        val pageCount = if (full) {
            db.rawQuery(
                "SELECT COUNT(*) FROM pages WHERE publication_id = ?",
                arrayOf(normalized.id),
            ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
        } else {
            db.queryLong(
                "SELECT COUNT(*) FROM pages WHERE publication_id = ?",
                arrayOf(normalized.id),
            ).toInt()
        }
        val (currentPage, readingStatus) = db.rawQuery(
            "SELECT current_page, reading_status FROM progress WHERE publication_id = ?",
            arrayOf(normalized.id),
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getInt(0).coerceAtLeast(0) to ReadingStatus.fromDatabase(cursor.getInt(1))
            } else {
                0 to ReadingStatus.NOT_STARTED
            }
        }
        val safeCurrentPage = currentPage.coerceAtMost((pageCount - 1).coerceAtLeast(0))

        val coverPageId = db.rawQuery(
            """
            SELECT cover_page_id FROM publications WHERE id = ?
            """.trimIndent(),
            arrayOf(normalized.id),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) ?: "" else "" }

        val coverSrc = db.rawQuery(
            "SELECT cache_path FROM pages WHERE publication_id = ? ORDER BY page_index ASC LIMIT 1",
            arrayOf(normalized.id),
        ).use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0)?.ifBlank { null } else null
        }
        val currentPageId = db.rawQuery(
            "SELECT id FROM pages WHERE publication_id = ? ORDER BY page_index ASC LIMIT 1 OFFSET ?",
            arrayOf(normalized.id, safeCurrentPage),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

        var diagnostic = normalized.diagnostic
        val customCoverPath = normalized.customCoverCache
            ?.takeIf { validCustomCover(it) }
        if (normalized.customCoverCache != null && customCoverPath == null) {
            diagnostic = diagnostic
                ?.takeUnless { it.contains(CUSTOM_COVER_MISSING_DIAGNOSTIC) }
                ?.plus(" ").plus(CUSTOM_COVER_MISSING_DIAGNOSTIC)
                ?: CUSTOM_COVER_MISSING_DIAGNOSTIC
        }

        return Pub(
            id = normalized.id,
            title = normalized.title,
            format = normalized.format,
            pageCount = pageCount,
            progress = when (readingStatus) {
                ReadingStatus.NOT_STARTED -> 0.0
                ReadingStatus.READING -> calculateProgress(safeCurrentPage, pageCount, normalized.direction)
                ReadingStatus.FINISHED -> 1.0
            },
            isFavorite = normalized.isFavorite,
            coverPageId = if (coverPageId.isBlank()) {
                db.rawQuery(
                    "SELECT id FROM pages WHERE publication_id = ? ORDER BY page_index ASC LIMIT 1",
                    arrayOf(normalized.id),
                ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) ?: "" else "" }
            } else {
                coverPageId
            },
            coverSrc = coverSrc,
            customCoverPath = customCoverPath,
            diagnostic = diagnostic,
            currentPageId = currentPageId,
            author = normalized.author,
            year = normalized.year,
            genre = normalized.genre,
            seriesName = normalized.seriesName,
            lastReadAt = normalized.lastReadAt,
            readingPagesPerMinute = normalized.readingPagesPerMinute,
            readingStatus = readingStatus,
            sourceName = normalized.sourceLabel,
        )
    }

    private fun normalizeImportNames(row: PublicationRow): PublicationRow {
        val original = PublicationNames.originalImportName(row.sourcePath, db.managedImportsDir)
            ?: return row
        val storedStem = File(row.sourceLabel).nameWithoutExtension
        var title = row.title
        if (storedStem == row.title) {
            title = File(original).nameWithoutExtension
        }
        return row.copy(title = title, sourceLabel = original)
    }

    private fun calculateProgress(currentPage: Int, pageCount: Int, direction: String): Double {
        if (pageCount == 0) return 0.0
        if (pageCount == 1) return 1.0
        val safePage = currentPage.coerceIn(0, pageCount - 1)
        val logical = if (direction == "rtl") pageCount - 1 - safePage else safePage
        return (logical + 1).toDouble() / pageCount.toDouble()
    }


    private data class PublicationRow(
        val id: String,
        val title: String,
        val sourceLabel: String,
        val format: String,
        val coverPageId: String,
        val addedAt: String,
        val updatedAt: String,
        val isFavorite: Boolean,
        val diagnostic: String?,
        val customCoverCache: String?,
        val customCoverName: String?,
        val sourcePath: String,
        val direction: String,
        val author: String?,
        val year: Int?,
        val genre: String?,
        val seriesName: String?,
        val lastReadAt: String?,
        val readingPagesPerMinute: Double?,
    )

    private fun Cursor.toPublicationRow() = PublicationRow(
        id = getString(0),
        title = getString(1),
        sourceLabel = getString(2),
        format = getString(3),
        coverPageId = getString(4) ?: "",
        addedAt = getString(5),
        updatedAt = getString(6),
        isFavorite = getInt(7) != 0,
        diagnostic = getString(8),
        customCoverCache = getString(9),
        customCoverName = getString(10),
        sourcePath = getString(11),
        direction = getString(12) ?: "ltr",
        author = getString(13)?.ifBlank { null },
        year = if (isNull(14)) null else getInt(14),
        genre = getString(15)?.ifBlank { null },
        seriesName = getString(16)?.ifBlank { null },
        lastReadAt = getString(17),
        readingPagesPerMinute = if (isNull(18)) null else getDouble(18),
    )

    /** Colunas 0..18 são PublicationRow; as restantes são o agregado da estante. */
    private fun Cursor.toShelfPublication(): Pub {
        val row = normalizeImportNames(toPublicationRow())
        val pageCount = getInt(19).coerceAtLeast(0)
        val currentPage = getInt(20).coerceAtLeast(0).coerceAtMost((pageCount - 1).coerceAtLeast(0))
        val readingStatus = ReadingStatus.fromDatabase(getInt(21))
        val firstPageId = getString(22).orEmpty()
        val coverSrc = getString(23)?.ifBlank { null }
        val currentPageId = getString(24)?.ifBlank { null }
        var diagnostic = row.diagnostic
        val customCoverPath = row.customCoverCache?.takeIf { validCustomCover(it) }
        if (row.customCoverCache != null && customCoverPath == null) {
            diagnostic = diagnostic
                ?.takeUnless { it.contains(CUSTOM_COVER_MISSING_DIAGNOSTIC) }
                ?.plus(" ").plus(CUSTOM_COVER_MISSING_DIAGNOSTIC)
                ?: CUSTOM_COVER_MISSING_DIAGNOSTIC
        }
        return Pub(
            id = row.id,
            title = row.title,
            format = row.format,
            pageCount = pageCount,
            progress = when (readingStatus) {
                ReadingStatus.NOT_STARTED -> 0.0
                ReadingStatus.READING -> calculateProgress(currentPage, pageCount, row.direction)
                ReadingStatus.FINISHED -> 1.0
            },
            isFavorite = row.isFavorite,
            coverPageId = row.coverPageId.ifBlank { firstPageId },
            coverSrc = coverSrc,
            customCoverPath = customCoverPath,
            diagnostic = diagnostic,
            currentPageId = currentPageId,
            author = row.author,
            year = row.year,
            genre = row.genre,
            seriesName = row.seriesName,
            lastReadAt = row.lastReadAt,
            readingPagesPerMinute = row.readingPagesPerMinute,
            readingStatus = readingStatus,
            sourceName = row.sourceLabel,
        )
    }

}
