package com.jrmello4.tactilereader.core

import java.io.File

/** Rebuilds, tracks, bounds, and removes derived page files. */
internal class PageCacheManager(private val db: LibraryDb) {
    fun ensurePage(publicationId: String, pageId: String): ReaderPage {
        val stripes = db.pageLockStripes
        val stripeIndex = (31 * publicationId.hashCode() + pageId.hashCode()) and (stripes.size - 1)
        synchronized(stripes[stripeIndex]) {
            val (data, protectedIds) = synchronized(db) {
                val pageData = db.rawQuery(
                    """
                    SELECT p.id, p.page_index, p.name, p.cache_path, p.source_ref,
                           p.width, p.height, publications.format
                      FROM pages p
                      JOIN publications ON publications.id = p.publication_id
                     WHERE p.publication_id = ? AND p.id = ?
                    """.trimIndent(),
                    arrayOf(publicationId, pageId),
                ).use { cursor ->
                    if (!cursor.moveToFirst()) error("page does not belong to the publication")
                    PageData(
                        id = cursor.getString(0),
                        index = cursor.getInt(1),
                        name = cursor.getString(2),
                        cachePath = cursor.getString(3),
                        sourceRef = PageSourceRef.fromJson(cursor.getString(4)),
                        width = cursor.getInt(5),
                        height = cursor.getInt(6),
                        format = cursor.getString(7),
                    )
                }
                pageData to protectedPageIds(publicationId, pageData.index)
            }
            val cacheFile = validCacheFile(data.cachePath)
            if (cacheFile != null) {
                val reused = synchronized(db) {
                    if (!cacheFile.isFile) {
                        false
                    } else {
                        touchCacheEntry(pageId, cacheFile.path, cacheFile.length())
                        enforceCacheLimit(protectedIds)
                        true
                    }
                }
                if (reused) return data.toReaderPage(cacheFile.path)
            }

            val sourceRef = data.sourceRef
                ?: throw IllegalStateException(CACHE_MISSING_DIAGNOSTIC)
            // Reopening archives, rendering, validating and writing happen without
            // the database-wide monitor. Other pages can progress concurrently.
            val rebuilt = Importer.rebuildPage(db, data.format, sourceRef)
            val file = cachePage(publicationCacheDir(publicationId), pageId, rebuilt.extension, rebuilt.bytes)
            val path = file.path
            try {
                synchronized(db) {
                    val stillExists = db.queryLong(
                        "SELECT COUNT(*) FROM pages WHERE publication_id = ? AND id = ?",
                        arrayOf(publicationId, pageId),
                    ) > 0
                    if (!stillExists) error("page was deleted while its cache was being built")
                    db.database.beginTransaction()
                    try {
                        db.execInsert(
                            "UPDATE pages SET cache_path = ?, width = ?, height = ? WHERE publication_id = ? AND id = ?",
                            arrayOf(path, rebuilt.width, rebuilt.height, publicationId, pageId),
                        )
                        touchCacheEntry(pageId, path, file.length())
                        db.database.setTransactionSuccessful()
                    } finally {
                        db.database.endTransaction()
                    }
                    enforceCacheLimit(protectedIds)
                }
            } catch (error: Exception) {
                file.delete()
                throw error
            }
            return data.copy(cachePath = path, width = rebuilt.width, height = rebuilt.height)
                .toReaderPage(path)
        }
    }

    fun cacheInfo(): CacheInfo {
        val (used, count) = db.rawQuery(
            "SELECT COALESCE(SUM(byte_size), 0), COUNT(*) FROM cache_entries",
            emptyArray(),
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0) to cursor.getInt(1)
        }
        val max = db.queryLong("SELECT max_bytes FROM cache_settings WHERE id = 'default'", emptyArray())
        return CacheInfo(usedBytes = used, maxBytes = max, entryCount = count)
    }

    fun clearCache() {
        val originPaths = canonicalOriginPaths()
        val entries = mutableListOf<Triple<String, String, String>>()
        db.rawQuery("SELECT page_id, publication_id, cache_path FROM cache_entries", emptyArray())
            .use { cursor ->
                while (cursor.moveToNext()) {
                    entries.add(Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2)))
                }
            }
        val affected = entries.map { it.second }.toSet()
        db.database.beginTransaction()
        try {
            for ((pageId, _, path) in entries) {
                val file = File(path)
                if (file.exists() && !originPaths.contains(file.canonicalPath)) {
                    file.delete()
                }
                db.execInsert("DELETE FROM cache_entries WHERE page_id = ?", arrayOf(pageId))
                db.execInsert("UPDATE pages SET cache_path = '' WHERE id = ?", arrayOf(pageId))
            }
            for (publicationId in affected) {
                db.publications.appendDiagnostic(publicationId, CACHE_MISSING_DIAGNOSTIC)
            }
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
        removeEmptyDirectories(db.cacheDir)
    }

    fun publicationCacheDir(publicationId: String): File {
        require(!publicationId.contains('/') && !publicationId.contains('\\')) {
            "invalid publication id for cache deletion"
        }
        val dir = File(db.cacheDir, publicationId)
        if (dir.exists()) {
            require(db.isInside(db.cacheDir, dir)) { "cache path escapes the cache directory" }
        }
        return dir
    }

    fun reconcileCacheEntries() {
        val rows = mutableListOf<Triple<String, String, String>>()
        db.rawQuery("SELECT id, publication_id, cache_path FROM pages", emptyArray()).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2)))
            }
        }
        db.database.beginTransaction()
        try {
            for ((pageId, publicationId, path) in rows) {
                val file = validCacheFile(path)
                if (file != null) {
                    touchCacheEntry(pageId, path, file.length())
                } else {
                    db.execInsert("DELETE FROM cache_entries WHERE page_id = ?", arrayOf(pageId))
                    db.execInsert("UPDATE pages SET cache_path = '' WHERE id = ?", arrayOf(pageId))
                    if (path.isNotBlank()) {
                        db.publications.appendDiagnostic(publicationId, CACHE_MISSING_DIAGNOSTIC)
                    }
                }
            }
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
    }

    fun cleanTombstones() {
        val root = db.cacheDir
        if (!root.isDirectory) return
        val stack = ArrayDeque<File>()
        stack.add(root)
        while (stack.isNotEmpty()) {
            val dir = stack.removeLast()
            val children = dir.listFiles() ?: continue
            for (child in children) {
                val name = child.name
                if (child.isDirectory) {
                    if (name.startsWith(".") && name.endsWith(".delete")) {
                        child.deleteRecursively()
                    } else {
                        stack.add(child)
                    }
                } else if (name.startsWith(".") &&
                    (name.endsWith(".tmp") || name.endsWith(".backup") || name.endsWith(".evict"))
                ) {
                    child.delete()
                }
            }
        }
    }

    fun removeEmptyDirectories(directory: File) {
        val children = directory.listFiles() ?: return
        for (child in children) {
            if (child.isDirectory) {
                removeEmptyDirectories(child)
                if ((child.listFiles()?.isEmpty() ?: true)) {
                    child.delete()
                }
            }
        }
    }

    private fun protectedPageIds(publicationId: String, pageIndex: Int): List<String> {
        val lower = (pageIndex - 1).coerceAtLeast(0)
        val upper = pageIndex + 1
        val ids = mutableListOf<String>()
        db.rawQuery(
            "SELECT id FROM pages WHERE publication_id = ? AND page_index BETWEEN ? AND ?",
            arrayOf(publicationId, lower, upper),
        ).use { cursor ->
            while (cursor.moveToNext()) ids.add(cursor.getString(0))
        }
        return ids
    }

    private fun enforceCacheLimit(protectedIds: List<String>) {
        val (used, max) = db.rawQuery(
            """
            SELECT (SELECT COALESCE(SUM(byte_size), 0) FROM cache_entries),
                   (SELECT max_bytes FROM cache_settings WHERE id = 'default')
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0) to cursor.getLong(1)
        }
        if (used <= max) return
        var remaining = used
        val candidates = mutableListOf<CacheCandidate>()
        db.rawQuery(
            """
            SELECT page_id, publication_id, cache_path, byte_size
              FROM cache_entries WHERE pinned = 0
             ORDER BY last_accessed_at ASC, page_id ASC
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                candidates.add(
                    CacheCandidate(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getLong(3)),
                )
            }
        }
        for (candidate in candidates) {
            if (remaining <= max) break
            if (protectedIds.contains(candidate.pageId)) continue
            val file = File(candidate.cachePath)
            if (file.isFile && db.isInside(db.cacheDir, file)) file.delete()
            db.execInsert("DELETE FROM cache_entries WHERE page_id = ?", arrayOf(candidate.pageId))
            db.execInsert("UPDATE pages SET cache_path = '' WHERE id = ?", arrayOf(candidate.pageId))
            db.publications.appendDiagnostic(candidate.publicationId, CACHE_MISSING_DIAGNOSTIC)
            remaining -= candidate.byteSize.coerceAtLeast(0)
        }
    }

    private fun touchCacheEntry(pageId: String, cachePath: String, byteSize: Long) {
        val now = timestampMillis()
        val updated = db.update(
            """
            UPDATE cache_entries SET cache_path = ?, byte_size = ?, last_accessed_at = ?
             WHERE page_id = ?
            """.trimIndent(),
            arrayOf(cachePath, byteSize, now, pageId),
        )
        if (updated == 0) {
            db.execInsert(
                """
                INSERT INTO cache_entries
                    (page_id, publication_id, cache_path, byte_size, last_accessed_at, pinned)
                SELECT id, publication_id, ?, ?, ?, 0 FROM pages WHERE id = ?
                """.trimIndent(),
                arrayOf(cachePath, byteSize, now, pageId),
            )
        }
    }

    private fun validCacheFile(path: String?): File? {
        if (path.isNullOrBlank()) return null
        val file = File(path)
        if (!file.isFile) return null
        return if (db.isInside(db.cacheDir, file)) file else null
    }

    private fun canonicalOriginPaths(): Set<String> {
        val out = mutableSetOf<String>()
        db.rawQuery("SELECT source_ref FROM pages WHERE source_ref <> ''", emptyArray()).use { cursor ->
            while (cursor.moveToNext()) {
                PageSourceRef.fromJson(cursor.getString(0))?.originPath?.let { path ->
                    File(path).canonicalPathOrNull()?.let(out::add)
                }
            }
        }
        db.rawQuery("SELECT source_path FROM publications", emptyArray()).use { cursor ->
            while (cursor.moveToNext()) {
                db.publications.legacyOriginPath(cursor.getString(0))?.let { path ->
                    File(path).canonicalPathOrNull()?.let(out::add)
                }
            }
        }
        db.rawQuery(
            "SELECT custom_cover_source FROM publications WHERE custom_cover_source IS NOT NULL AND custom_cover_source <> ''",
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                cursor.getString(0)?.let { path -> File(path).canonicalPathOrNull()?.let(out::add) }
            }
        }
        return out
    }

    private fun PageData.toReaderPage(path: String?) = ReaderPage(
        id = id,
        index = index,
        name = name,
        width = width,
        height = height,
        cachePath = path?.ifBlank { null },
    )

    private data class PageData(
        val id: String,
        val index: Int,
        val name: String,
        val cachePath: String?,
        val sourceRef: PageSourceRef?,
        val width: Int,
        val height: Int,
        val format: String,
    )

    private data class CacheCandidate(
        val pageId: String,
        val publicationId: String,
        val cachePath: String,
        val byteSize: Long,
    )
}
