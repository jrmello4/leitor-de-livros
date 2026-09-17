package com.jrmello4.tactilereader.core

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.io.File

/**
 * Banco da biblioteca em Kotlin puro (SQLite do Android), com o MESMO
 * schema v6 e os MESMOS identificadores do núcleo Rust anterior — bancos
 * existentes no aparelho continuam válidos.
 *
 * Uma instância por diretório (cache em processo); todos os métodos são
 * sincronizados porque o app chama de várias coroutines de IO.
 */
class LibraryDb private constructor(
    val dataDir: File,
    val managedImportsDir: File,
    /** De onde vêm os bytes dos originais: caminho local ou `content://`. */
    val opener: SourceOpener,
) {
    val cacheDir: File = File(dataDir, "cache/pages")
    private val database: SQLiteDatabase
    private val lock = Any()
    private val importLock = java.util.concurrent.locks.ReentrantLock()

    init {
        dataDir.mkdirs()
        cacheDir.mkdirs()
        database = SQLiteDatabase.openOrCreateDatabase(File(dataDir, "reader.sqlite3"), null)
        database.execSQL("PRAGMA foreign_keys = ON")
        // `journal_mode` devolve uma linha: em Android real (e no Robolectric
        // nativo) execSQL recusa statements que retornam dados.
        rawQuery("PRAGMA journal_mode = WAL", emptyArray()).use { cursor ->
            cursor.moveToFirst()
        }
        database.execSQL("PRAGMA synchronous = NORMAL")
        migrate()
        cleanTombstones()
        reconcileCacheEntries()
    }

    // ---------------------------------------------------------------- schema

    private fun migrate() {
        execBatch(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                 version INTEGER PRIMARY KEY,
                 applied_at TEXT NOT NULL
             )
            """.trimIndent(),
        )
        val current = queryLong("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", emptyArray())
        if (current < 1) {
            execBatch(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                     version INTEGER PRIMARY KEY,
                     applied_at TEXT NOT NULL
                 );
                CREATE TABLE IF NOT EXISTS publications (
                     id TEXT PRIMARY KEY,
                     title TEXT NOT NULL,
                     source_label TEXT NOT NULL,
                     format TEXT NOT NULL,
                     source_path TEXT NOT NULL UNIQUE,
                     cover_page_id TEXT NOT NULL,
                     direction TEXT NOT NULL DEFAULT 'ltr',
                     added_at TEXT NOT NULL,
                     updated_at TEXT NOT NULL,
                     diagnostic TEXT
                 );
                CREATE TABLE IF NOT EXISTS pages (
                     id TEXT PRIMARY KEY,
                     publication_id TEXT NOT NULL,
                     page_index INTEGER NOT NULL,
                     name TEXT NOT NULL,
                     cache_path TEXT NOT NULL,
                     width INTEGER NOT NULL,
                     height INTEGER NOT NULL,
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
                     UNIQUE(publication_id, page_index)
                 );
                CREATE TABLE IF NOT EXISTS progress (
                     publication_id TEXT PRIMARY KEY,
                     current_page INTEGER NOT NULL DEFAULT 0,
                     updated_at TEXT NOT NULL,
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
                 );
                CREATE TABLE IF NOT EXISTS profiles (
                     id TEXT PRIMARY KEY,
                     version INTEGER NOT NULL,
                     payload_json TEXT NOT NULL,
                     updated_at TEXT NOT NULL
                 );
                CREATE INDEX IF NOT EXISTS pages_publication_index
                     ON pages(publication_id, page_index);
                """.trimIndent(),
            )
            markMigration(1)
        }
        if (current < 2) {
            execBatch(
                """
                CREATE TABLE IF NOT EXISTS panel_graphs (
                     publication_id TEXT NOT NULL,
                     page_id TEXT NOT NULL,
                     schema_version INTEGER NOT NULL,
                     payload_json TEXT NOT NULL,
                     updated_at TEXT NOT NULL,
                     PRIMARY KEY (publication_id, page_id),
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
                 );
                CREATE INDEX IF NOT EXISTS panel_graphs_publication_index
                     ON panel_graphs(publication_id, updated_at DESC);
                """.trimIndent(),
            )
            markMigration(2)
        }
        if (current < 3) {
            if (!columnExists("publications", "is_favorite")) {
                execBatch("ALTER TABLE publications ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;")
            }
            if (!columnExists("pages", "source_ref")) {
                execBatch("ALTER TABLE pages ADD COLUMN source_ref TEXT NOT NULL DEFAULT '';")
            }
            execBatch(
                """
                CREATE TABLE IF NOT EXISTS reader_states (
                     publication_id TEXT PRIMARY KEY,
                     zoom_mode TEXT NOT NULL DEFAULT 'page',
                     zoom_scale REAL NOT NULL DEFAULT 1.0,
                     pan_x REAL NOT NULL DEFAULT 0.0,
                     pan_y REAL NOT NULL DEFAULT 0.0,
                     page_id TEXT,
                     scroll_ratio REAL NOT NULL DEFAULT 0.0,
                     updated_at TEXT NOT NULL,
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
                 );
                CREATE TABLE IF NOT EXISTS bookmarks (
                     publication_id TEXT NOT NULL,
                     page_id TEXT NOT NULL,
                     label TEXT NOT NULL DEFAULT '',
                     created_at TEXT NOT NULL,
                     updated_at TEXT NOT NULL,
                     PRIMARY KEY(publication_id, page_id),
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
                     FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
                 );
                CREATE TABLE IF NOT EXISTS cache_entries (
                     page_id TEXT PRIMARY KEY,
                     publication_id TEXT NOT NULL,
                     cache_path TEXT NOT NULL,
                     byte_size INTEGER NOT NULL,
                     last_accessed_at TEXT NOT NULL,
                     pinned INTEGER NOT NULL DEFAULT 0,
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
                     FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
                 );
                CREATE TABLE IF NOT EXISTS cache_settings (
                     id TEXT PRIMARY KEY,
                     max_bytes INTEGER NOT NULL,
                     updated_at TEXT NOT NULL
                 );
                CREATE INDEX IF NOT EXISTS bookmarks_publication_index
                     ON bookmarks(publication_id, created_at ASC);
                CREATE INDEX IF NOT EXISTS cache_entries_publication_index
                     ON cache_entries(publication_id, last_accessed_at ASC);
                """.trimIndent(),
            )
            execInsert(
                "INSERT OR IGNORE INTO cache_settings (id, max_bytes, updated_at) VALUES ('default', ?, ?)",
                arrayOf(DEFAULT_CACHE_LIMIT_BYTES, timestampMillis()),
            )
            markMigration(3)
        }
        if (current < 4) {
            backfillDeterministicSourceRefs()
            markMigration(4)
        }
        if (current < 5) {
            for (column in listOf("custom_cover_source", "custom_cover_cache", "custom_cover_name")) {
                if (!columnExists("publications", column)) {
                    execBatch("ALTER TABLE publications ADD COLUMN $column TEXT")
                }
            }
            markMigration(5)
        }
        if (current < 6) {
            execBatch(
                """
                CREATE TABLE IF NOT EXISTS reader_states (
                     publication_id TEXT PRIMARY KEY,
                     zoom_mode TEXT NOT NULL DEFAULT 'page',
                     zoom_scale REAL NOT NULL DEFAULT 1.0,
                     pan_x REAL NOT NULL DEFAULT 0.0,
                     pan_y REAL NOT NULL DEFAULT 0.0,
                     page_id TEXT,
                     scroll_ratio REAL NOT NULL DEFAULT 0.0,
                     updated_at TEXT NOT NULL,
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
                 );
                """.trimIndent(),
            )
            if (!columnExists("reader_states", "page_id")) {
                execBatch("ALTER TABLE reader_states ADD COLUMN page_id TEXT")
            }
            if (!columnExists("reader_states", "scroll_ratio")) {
                execBatch("ALTER TABLE reader_states ADD COLUMN scroll_ratio REAL NOT NULL DEFAULT 0.0")
            }
            markMigration(6)
        }
        if (current < 7) {
            for ((column, definition) in listOf(
                "author" to "TEXT",
                "year" to "INTEGER",
                "genre" to "TEXT",
                "series_name" to "TEXT",
            )) {
                if (!columnExists("publications", column)) {
                    execBatch("ALTER TABLE publications ADD COLUMN $column $definition")
                }
            }
            execBatch(
                """
                CREATE TABLE IF NOT EXISTS collections (
                     id TEXT PRIMARY KEY,
                     name TEXT NOT NULL UNIQUE,
                     created_at TEXT NOT NULL
                 );
                CREATE TABLE IF NOT EXISTS collection_publications (
                     collection_id TEXT NOT NULL,
                     publication_id TEXT NOT NULL,
                     added_at TEXT NOT NULL,
                     PRIMARY KEY(collection_id, publication_id),
                     FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
                 );
                CREATE TABLE IF NOT EXISTS reading_stats (
                     publication_id TEXT PRIMARY KEY,
                     total_millis INTEGER NOT NULL DEFAULT 0,
                     pages_read INTEGER NOT NULL DEFAULT 0,
                     sessions INTEGER NOT NULL DEFAULT 0,
                     last_read_at TEXT,
                     FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
                 );
                """.trimIndent(),
            )
            markMigration(7)
        }
    }

    private fun backfillDeterministicSourceRefs() {
        // Porta o backfill do núcleo anterior: repara source_ref de bancos
        // antigos (PDF por prefixo `pdf:`, imagem única por `image:`).
        val rows = mutableListOf<Triple<String, String, String>>()
        rawQuery(
            """
            SELECT pages.id, publications.format, publications.source_path
              FROM pages
              JOIN publications ON publications.id = pages.publication_id
             WHERE pages.source_ref = ''
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2)))
            }
        }
        for ((pageId, format, sourcePath) in rows) {
            val pageIndex = rawQuery(
                "SELECT page_index FROM pages WHERE id = ?",
                arrayOf(pageId),
            ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else -1 }
            if (pageIndex < 0) continue
            val sourceRef = when {
                format == "pdf" && sourcePath.startsWith("pdf:") ->
                    PageSourceRef.Pdf(sourcePath.removePrefix("pdf:"), pageIndex)
                format == "images" && sourcePath.startsWith("image:") ->
                    PageSourceRef.Image(sourcePath.removePrefix("image:"))
                else -> null
            } ?: continue
            execInsert(
                "UPDATE pages SET source_ref = ? WHERE id = ?",
                arrayOf(sourceRef.toJson(), pageId),
            )
        }
    }

    private fun markMigration(version: Int) {
        execInsert(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            arrayOf(version, timestampMillis()),
        )
    }

    /**
     * Importa origens (caminhos ou `content://`) sem segurar o monitor geral
     * do banco: capas e páginas continuam respondendo durante um import longo.
     */
    fun importSources(
        sources: List<ImportSource>,
        onProgress: (ImportProgress) -> Unit = {},
        shouldCancel: () -> Boolean = { false },
    ): ImportOutcome {
        importLock.lock()
        try {
            return Importer.importSources(this, sources, onProgress, shouldCancel)
        } finally {
            importLock.unlock()
        }
    }

    /** Atalho para caminhos locais (testes, varredura, coleções). */
    fun importPaths(
        paths: List<String>,
        onProgress: (ImportProgress) -> Unit = {},
        shouldCancel: () -> Boolean = { false },
    ): ImportOutcome = importSources(
        paths.map { ImportSource(it, File(it).name) },
        onProgress,
        shouldCancel,
    )

    // ------------------------------------------------------------ public API

    /** Resumo da estante: uma consulta leve, sem materializar páginas. */
    @Synchronized
    fun listPublications(): List<Pub> {
        val rows = mutableListOf<PublicationRow>()
        rawQuery(
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
              FROM publications
             ORDER BY updated_at DESC, title COLLATE NOCASE ASC
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(cursor.toPublicationRow())
            }
        }
        return rows.map { readPublicationSummary(it) }
    }

    @Synchronized
    fun findPublicationBySourcePath(sourcePath: String): Pub? {
        val row = rawQuery(
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

    @Synchronized
    fun listPages(publicationId: String): List<ReaderPage> {
        val pages = mutableListOf<ReaderPage>()
        rawQuery(
            """
            SELECT id, page_index, name, cache_path, width, height
              FROM pages WHERE publication_id = ? ORDER BY page_index ASC
            """.trimIndent(),
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                pages.add(
                    ReaderPage(
                        id = cursor.getString(0),
                        index = cursor.getInt(1),
                        name = cursor.getString(2),
                        width = cursor.getInt(4),
                        height = cursor.getInt(5),
                        cachePath = cursor.getString(3)?.ifBlank { null },
                    ),
                )
            }
        }
        return pages
    }

    /**
     * Garante os bytes derivados de uma página (reconstruindo do original
     * somente-leitura quando preciso) e devolve o caminho de cache.
     */
    @Synchronized
    fun ensurePage(publicationId: String, pageId: String): ReaderPage {
        val data = rawQuery(
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
        val protectedIds = protectedPageIds(publicationId, data.index)
        validCacheFile(data.cachePath)?.let { file ->
            touchCacheEntry(pageId, data.cachePath, file.length())
            enforceCacheLimit(protectedIds)
            return data.toReaderPage(file.path)
        }
        val sourceRef = data.sourceRef
            ?: throw IllegalStateException(CACHE_MISSING_DIAGNOSTIC)
        val rebuilt = Importer.rebuildPage(this, data.format, sourceRef)
        val publicationCacheDir = publicationCacheDir(publicationId)
        val file = cachePage(publicationCacheDir, pageId, rebuilt.extension, rebuilt.bytes)
        val path = file.path
        database.beginTransaction()
        try {
            execInsert(
                "UPDATE pages SET cache_path = ?, width = ?, height = ? WHERE publication_id = ? AND id = ?",
                arrayOf(path, rebuilt.width, rebuilt.height, publicationId, pageId),
            )
            touchCacheEntry(pageId, path, file.length())
            database.setTransactionSuccessful()
        } catch (error: Exception) {
            file.delete()
            throw error
        } finally {
            database.endTransaction()
        }
        enforceCacheLimit(protectedIds)
        return data.copy(cachePath = path, width = rebuilt.width, height = rebuilt.height)
            .toReaderPage(path)
    }

    @Synchronized
    fun loadReaderState(publicationId: String): ReaderProgress? {
        return rawQuery(
            "SELECT page_id, scroll_ratio FROM reader_states WHERE publication_id = ?",
            arrayOf(publicationId),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val pageId = cursor.getString(0)?.ifBlank { null } ?: return null
            ReaderProgress(pageId, cursor.getDouble(1).coerceIn(0.0, 1.0))
        }
    }

    @Synchronized
    fun saveReaderState(publicationId: String, pageId: String, scrollRatio: Double) {
        if (publicationId.isBlank() || pageId.isBlank()) {
            error("publication id and page id must not be empty")
        }
        val pageIndex = rawQuery(
            "SELECT page_index FROM pages WHERE publication_id = ? AND id = ?",
            arrayOf(publicationId, pageId),
        ).use { cursor ->
            if (!cursor.moveToFirst()) error("page does not belong to the publication")
            cursor.getInt(0).coerceAtLeast(0)
        }
        val ratio = if (scrollRatio.isNaN()) 0.0 else scrollRatio.coerceIn(0.0, 1.0)
        val now = timestampMillis()
        // Sem UPSERT: o SQLite do sistema é 3.18 no Android 8 (UPSERT pede 3.24).
        database.beginTransaction()
        try {
            val updated = update(
                "UPDATE reader_states SET page_id = ?, scroll_ratio = ?, updated_at = ? WHERE publication_id = ?",
                arrayOf(pageId, ratio, now, publicationId),
            )
            if (updated == 0) {
                execInsert(
                    """
                    INSERT INTO reader_states
                        (publication_id, zoom_mode, zoom_scale, pan_x, pan_y, page_id, scroll_ratio, updated_at)
                    VALUES (?, 'page', 1.0, 0.0, 0.0, ?, ?, ?)
                    """.trimIndent(),
                    arrayOf(publicationId, pageId, ratio, now),
                )
            }
            // A estante usa esta tabela leve para exibir o progresso sem
            // materializar o estado completo do leitor.
            update(
                "UPDATE progress SET current_page = ?, updated_at = ? WHERE publication_id = ?",
                arrayOf(pageIndex, now, publicationId),
            )
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    /** Retorna as métricas locais acumuladas de uma publicação. */
    @Synchronized
    fun loadReadingStats(publicationId: String): ReadingStats? {
        return rawQuery(
            "SELECT total_millis, pages_read, sessions, last_read_at FROM reading_stats WHERE publication_id = ?",
            arrayOf(publicationId),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            ReadingStats(
                totalMillis = cursor.getLong(0).coerceAtLeast(0L),
                pagesRead = cursor.getInt(1).coerceAtLeast(0),
                sessions = cursor.getInt(2).coerceAtLeast(0),
                lastReadAt = cursor.getString(3),
            )
        }
    }

    /**
     * Persiste uma sessão já encerrada e devolve a velocidade acumulada.
     * O tempo de cada sessão passa pelo mesmo filtro de pausa longa usado
     * pelo formatador, sem armazenar eventos detalhados ou telemetria.
     */
    @Synchronized
    fun recordReadingSession(
        publicationId: String,
        durationMillis: Long,
        pagesRead: Int,
    ): ReadingSpeed? {
        if (publicationId.isBlank()) return null
        val pages = pagesRead.coerceAtLeast(0)
        val effective = ReadingMetrics.effectiveDuration(
            ReadingSession(durationMillis = durationMillis, pagesRead = pages),
        )
        val previous = loadReadingStats(publicationId)
        if (effective <= 0L || pages <= 0) {
            return previous?.let { speedForStats(it) }
        }
        val previousMillis = previous?.totalMillis ?: 0L
        val previousPages = previous?.pagesRead ?: 0
        val previousSessions = previous?.sessions ?: 0
        val totalMillis = if (Long.MAX_VALUE - previousMillis < effective) {
            Long.MAX_VALUE
        } else {
            previousMillis + effective
        }
        val totalPages = (previousPages.toLong() + pages)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        val sessions = (previousSessions.toLong() + 1L)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        val now = timestampMillis()
        database.beginTransaction()
        try {
            val updated = update(
                "UPDATE reading_stats SET total_millis = ?, pages_read = ?, sessions = ?, last_read_at = ? WHERE publication_id = ?",
                arrayOf(totalMillis, totalPages, sessions, now, publicationId),
            )
            if (updated == 0) {
                execInsert(
                    "INSERT INTO reading_stats (publication_id, total_millis, pages_read, sessions, last_read_at) VALUES (?, ?, ?, ?, ?)",
                    arrayOf(publicationId, totalMillis, totalPages, sessions, now),
                )
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        return speedForStats(ReadingStats(totalMillis, totalPages, sessions, now))
    }

    private fun speedForStats(stats: ReadingStats): ReadingSpeed? {
        if (stats.totalMillis <= 0L || stats.pagesRead <= 0) return null
        return ReadingMetrics.calculateSpeed(
            ReadingSession(stats.totalMillis, stats.pagesRead),
            maxPauseThresholdMs = Long.MAX_VALUE,
        )
    }

    /**
     * Consolida as métricas locais de leitura de todas as publicações
     * para a tela Minha Leitura, sem depender de nuvem ou contas.
     */
    @Synchronized
    fun loadOverallReadingStats(): OverallReadingStats {
        var totalMillis = 0L
        var totalPages = 0
        var totalSessions = 0
        val pubStats = mutableListOf<PublicationReadingStat>()

        val pubs = listPublications()
        for (pub in pubs) {
            val stats = loadReadingStats(pub.id)
            if (stats != null && (stats.totalMillis > 0L || stats.pagesRead > 0)) {
                totalMillis = saturatingAdd(totalMillis, stats.totalMillis)
                totalPages = (totalPages.toLong() + stats.pagesRead).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                totalSessions = (totalSessions.toLong() + stats.sessions).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                pubStats.add(
                    PublicationReadingStat(
                        id = pub.id,
                        title = pub.title,
                        format = pub.format,
                        pageCount = pub.pageCount,
                        progress = pub.progress,
                        totalMillis = stats.totalMillis,
                        pagesRead = stats.pagesRead,
                        sessions = stats.sessions,
                        pagesPerMinute = pub.readingPagesPerMinute,
                        lastReadAt = stats.lastReadAt,
                    )
                )
            }
        }
        val minutes = totalMillis.toDouble() / 60_000.0
        val avgPpm = if (minutes > 0.0) totalPages.toDouble() / minutes else 0.0
        return OverallReadingStats(
            totalMillis = totalMillis,
            totalPagesRead = totalPages,
            totalSessions = totalSessions,
            averagePpm = avgPpm,
            publications = pubStats.sortedByDescending { it.lastReadAt ?: "" },
        )
    }

    private fun saturatingAdd(a: Long, b: Long): Long =
        if (Long.MAX_VALUE - a < b) Long.MAX_VALUE else a + b

    /** Snapshot em lote: bookmarks + reader states em 2 consultas. */
    @Synchronized
    fun librarySnapshot(): Map<String, ReaderProgress> {
        val out = mutableMapOf<String, ReaderProgress>()
        rawQuery(
            "SELECT publication_id, page_id, scroll_ratio FROM reader_states",
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val pageId = cursor.getString(1)?.ifBlank { null } ?: continue
                out[cursor.getString(0)] = ReaderProgress(pageId, cursor.getDouble(2))
            }
        }
        return out
    }

    @Synchronized
    fun setFavorite(publicationId: String, favorite: Boolean) {
        execInsert(
            "UPDATE publications SET is_favorite = ?, updated_at = ? WHERE id = ?",
            arrayOf(if (favorite) 1 else 0, timestampMillis(), publicationId),
        )
    }

    /** Marca como lido (última página) ou limpa o progresso (0). */
    @Synchronized
    fun markRead(publicationId: String, currentPage: Int) {
        val page = currentPage.coerceAtLeast(0)
        val now = timestampMillis()
        database.beginTransaction()
        try {
            val updated = update(
                "UPDATE progress SET current_page = ?, updated_at = ? WHERE publication_id = ?",
                arrayOf(page, now, publicationId),
            )
            if (updated == 0) {
                execInsert(
                    "INSERT INTO progress (publication_id, current_page, updated_at) VALUES (?, ?, ?)",
                    arrayOf(publicationId, page, now),
                )
            }
            execInsert(
                "UPDATE publications SET updated_at = ? WHERE id = ?",
                arrayOf(now, publicationId),
            )
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    @Synchronized
    fun listBookmarks(publicationId: String): List<Bookmark> {
        val bookmarks = mutableListOf<Bookmark>()
        rawQuery(
            "SELECT page_id, label FROM bookmarks WHERE publication_id = ? ORDER BY created_at ASC, page_id ASC",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                bookmarks.add(Bookmark(cursor.getString(0), cursor.getString(1) ?: ""))
            }
        }
        return bookmarks
    }

    @Synchronized
    fun upsertBookmark(publicationId: String, pageId: String, label: String) {
        if (publicationId.isBlank() || pageId.isBlank()) {
            error("publication id and page id must not be empty")
        }
        val belongs = rawQuery(
            "SELECT 1 FROM pages WHERE id = ? AND publication_id = ?",
            arrayOf(pageId, publicationId),
        ).use { it.moveToFirst() }
        require(belongs) { "bookmark page does not belong to the publication" }
        val now = timestampMillis()
        // UPDATE preserva created_at; INSERT só quando o marcador é novo.
        val updated = update(
            "UPDATE bookmarks SET label = ?, updated_at = ? WHERE publication_id = ? AND page_id = ?",
            arrayOf(label, now, publicationId, pageId),
        )
        if (updated == 0) {
            execInsert(
                "INSERT INTO bookmarks (publication_id, page_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                arrayOf(publicationId, pageId, label, now, now),
            )
        }
    }

    @Synchronized
    fun removeBookmark(publicationId: String, pageId: String) {
        execInsert(
            "DELETE FROM bookmarks WHERE publication_id = ? AND page_id = ?",
            arrayOf(publicationId, pageId),
        )
    }

    /**
     * Lista todos os marcadores de todas as publicações na biblioteca,
     * incluindo o título da HQ e o índice humano da página (0-based).
     */
    @Synchronized
    fun listAllBookmarks(): List<BookmarkItem> {
        val list = mutableListOf<BookmarkItem>()
        rawQuery(
            """
            SELECT b.publication_id, p.title, b.page_id, pg.page_index, b.label, b.created_at
              FROM bookmarks b
              JOIN publications p ON b.publication_id = p.id
              JOIN pages pg ON b.publication_id = pg.publication_id AND b.page_id = pg.id
             ORDER BY b.created_at DESC, p.title COLLATE NOCASE ASC
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                list.add(
                    BookmarkItem(
                        publicationId = cursor.getString(0),
                        publicationTitle = cursor.getString(1),
                        pageId = cursor.getString(2),
                        pageIndex = cursor.getInt(3),
                        label = cursor.getString(4) ?: "",
                        createdAt = cursor.getString(5) ?: "",
                    )
                )
            }
        }
        return list
    }

    @Synchronized
    fun cacheInfo(): CacheInfo {
        val (used, count) = rawQuery(
            "SELECT COALESCE(SUM(byte_size), 0), COUNT(*) FROM cache_entries",
            emptyArray(),
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0) to cursor.getInt(1)
        }
        val max = queryLong(
            "SELECT max_bytes FROM cache_settings WHERE id = 'default'",
            emptyArray(),
        )
        return CacheInfo(usedBytes = used, maxBytes = max, entryCount = count)
    }

    /** Limpa o cache derivado sem tocar em originais. */
    @Synchronized
    fun clearCache() {
        val originPaths = canonicalOriginPaths()
        val entries = mutableListOf<Triple<String, String, String>>()
        rawQuery("SELECT page_id, publication_id, cache_path FROM cache_entries", emptyArray())
            .use { cursor ->
                while (cursor.moveToNext()) {
                    entries.add(
                        Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2)),
                    )
                }
            }
        val affected = entries.map { it.second }.toSet()
        database.beginTransaction()
        try {
            for ((pageId, _, path) in entries) {
                val file = File(path)
                if (file.exists() && !originPaths.contains(file.canonicalPath)) {
                    file.delete()
                }
                execInsert("DELETE FROM cache_entries WHERE page_id = ?", arrayOf(pageId))
                execInsert("UPDATE pages SET cache_path = '' WHERE id = ?", arrayOf(pageId))
            }
            for (publicationId in affected) {
                appendDiagnostic(publicationId, CACHE_MISSING_DIAGNOSTIC)
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        removeEmptyDirectories(cacheDir)
    }

    /**
     * Remove a publicação e o cache derivado. Os originais externos nunca
     * são tocados; cópias privadas de importação sem outro dono saem junto.
     */
    @Synchronized
    fun deletePublication(publicationId: String) {
        val exists = queryLong(
            "SELECT COUNT(*) FROM publications WHERE id = ?",
            arrayOf(publicationId),
        ) > 0
        require(exists) { "publication does not exist" }

        val publicationOrigins = publicationOriginPaths(publicationId)
        val otherOrigins = allOtherOriginPaths(publicationId)
        val cachePublicationDir = publicationCacheDir(publicationId)
        val staging = File(cacheDir, ".$publicationId.${System.nanoTime()}.delete")
        var staged = false
        if (cachePublicationDir.exists()) {
            cachePublicationDir.renameTo(staging)
            staged = true
        }

        database.beginTransaction()
        try {
            for (table in listOf(
                "bookmarks",
                "reader_states",
                "cache_entries",
                "panel_graphs",
                "progress",
                "pages",
            )) {
                execInsert("DELETE FROM $table WHERE publication_id = ?", arrayOf(publicationId))
            }
            execInsert("DELETE FROM publications WHERE id = ?", arrayOf(publicationId))
            database.setTransactionSuccessful()
        } catch (error: Exception) {
            if (staged) staging.renameTo(cachePublicationDir)
            throw error
        } finally {
            database.endTransaction()
        }

        if (staged) {
            staging.deleteRecursively()
        }
        removeEmptyDirectories(cacheDir)
        for (origin in publicationOrigins) {
            if (otherOrigins.contains(origin)) continue
            val file = File(origin)
            if (isInside(managedImportsDir, file) && file.isFile) {
                file.delete()
            }
        }
        removeEmptyDirectories(managedImportsDir)
    }

    // -------------------------------------------------------------- internals

    private fun readPublicationSummary(row: PublicationRow, full: Boolean = false): Pub {
        val normalized = normalizeImportNames(row)
        val pageCount = if (full) {
            rawQuery(
                "SELECT COUNT(*) FROM pages WHERE publication_id = ?",
                arrayOf(normalized.id),
            ).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
        } else {
            queryLong(
                "SELECT COUNT(*) FROM pages WHERE publication_id = ?",
                arrayOf(normalized.id),
            ).toInt()
        }
        val currentPage = rawQuery(
            "SELECT current_page FROM progress WHERE publication_id = ?",
            arrayOf(normalized.id),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0).coerceAtLeast(0) else 0 }
            .coerceAtMost((pageCount - 1).coerceAtLeast(0))

        val coverPageId = rawQuery(
            """
            SELECT cover_page_id FROM publications WHERE id = ?
            """.trimIndent(),
            arrayOf(normalized.id),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) ?: "" else "" }

        val coverSrc = rawQuery(
            "SELECT cache_path FROM pages WHERE publication_id = ? ORDER BY page_index ASC LIMIT 1",
            arrayOf(normalized.id),
        ).use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0)?.ifBlank { null } else null
        }
        val currentPageId = rawQuery(
            "SELECT id FROM pages WHERE publication_id = ? ORDER BY page_index ASC LIMIT 1 OFFSET ?",
            arrayOf(normalized.id, currentPage),
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
            progress = calculateProgress(currentPage, pageCount, normalized.direction),
            isFavorite = normalized.isFavorite,
            coverPageId = if (coverPageId.isBlank()) {
                rawQuery(
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
        )
    }

    private fun normalizeImportNames(row: PublicationRow): PublicationRow {
        val original = PublicationNames.originalImportName(row.sourcePath, managedImportsDir)
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

    private fun validCustomCover(path: String): Boolean {
        val file = File(path)
        if (!file.isFile) return false
        return isInside(cacheDir, file)
    }

    private fun protectedPageIds(publicationId: String, pageIndex: Int): List<String> {
        val lower = (pageIndex - 1).coerceAtLeast(0)
        val upper = pageIndex + 1
        val ids = mutableListOf<String>()
        rawQuery(
            "SELECT id FROM pages WHERE publication_id = ? AND page_index BETWEEN ? AND ?",
            arrayOf(publicationId, lower, upper),
        ).use { cursor ->
            while (cursor.moveToNext()) ids.add(cursor.getString(0))
        }
        return ids
    }

    private fun enforceCacheLimit(protectedIds: List<String>) {
        val (used, max) = rawQuery(
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
        rawQuery(
            """
            SELECT page_id, publication_id, cache_path, byte_size
              FROM cache_entries WHERE pinned = 0
             ORDER BY last_accessed_at ASC, page_id ASC
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                candidates.add(
                    CacheCandidate(
                        pageId = cursor.getString(0),
                        publicationId = cursor.getString(1),
                        cachePath = cursor.getString(2),
                        byteSize = cursor.getLong(3),
                    ),
                )
            }
        }
        for (candidate in candidates) {
            if (remaining <= max) break
            if (protectedIds.contains(candidate.pageId)) continue
            val file = File(candidate.cachePath)
            if (file.isFile && isInside(cacheDir, file)) {
                file.delete()
            }
            execInsert("DELETE FROM cache_entries WHERE page_id = ?", arrayOf(candidate.pageId))
            execInsert("UPDATE pages SET cache_path = '' WHERE id = ?", arrayOf(candidate.pageId))
            appendDiagnostic(candidate.publicationId, CACHE_MISSING_DIAGNOSTIC)
            remaining -= candidate.byteSize.coerceAtLeast(0)
        }
    }

    private fun touchCacheEntry(pageId: String, cachePath: String, byteSize: Long) {
        val now = timestampMillis()
        val updated = update(
            """
            UPDATE cache_entries SET cache_path = ?, byte_size = ?, last_accessed_at = ?
             WHERE page_id = ?
            """.trimIndent(),
            arrayOf(cachePath, byteSize, now, pageId),
        )
        if (updated == 0) {
            execInsert(
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
        return if (isInside(cacheDir, file)) file else null
    }

    private fun appendDiagnostic(publicationId: String, diagnostic: String) {
        execInsert(
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

    private fun publicationCacheDir(publicationId: String): File {
        require(!publicationId.contains('/') && !publicationId.contains('\\')) {
            "invalid publication id for cache deletion"
        }
        val dir = File(cacheDir, publicationId)
        if (dir.exists()) {
            require(isInside(cacheDir, dir)) { "cache path escapes the cache directory" }
        }
        return dir
    }

    private fun canonicalOriginPaths(): Set<String> {
        val out = mutableSetOf<String>()
        rawQuery("SELECT source_ref FROM pages WHERE source_ref <> ''", emptyArray()).use { cursor ->
            while (cursor.moveToNext()) {
                PageSourceRef.fromJson(cursor.getString(0))?.originPath?.let { path ->
                    File(path).canonicalPathOrNull()?.let { out.add(it) }
                }
            }
        }
        rawQuery("SELECT source_path FROM publications", emptyArray()).use { cursor ->
            while (cursor.moveToNext()) {
                legacyOriginPath(cursor.getString(0))?.let { path ->
                    File(path).canonicalPathOrNull()?.let { out.add(it) }
                }
            }
        }
        rawQuery(
            "SELECT custom_cover_source FROM publications WHERE custom_cover_source IS NOT NULL AND custom_cover_source <> ''",
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                cursor.getString(0)?.let { File(it).canonicalPathOrNull()?.let { p -> out.add(p) } }
            }
        }
        return out
    }

    private fun publicationOriginPaths(publicationId: String): Set<String> {
        val out = mutableSetOf<String>()
        rawQuery(
            "SELECT source_ref FROM pages WHERE publication_id = ? AND source_ref <> ''",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                PageSourceRef.fromJson(cursor.getString(0))?.originPath?.let { out.add(it) }
            }
        }
        rawQuery(
            "SELECT source_path FROM publications WHERE id = ?",
            arrayOf(publicationId),
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                legacyOriginPath(cursor.getString(0))?.let { out.add(it) }
            }
        }
        return out
    }

    private fun allOtherOriginPaths(publicationId: String): Set<String> {
        val out = mutableSetOf<String>()
        rawQuery(
            "SELECT source_ref FROM pages WHERE publication_id <> ? AND source_ref <> ''",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                PageSourceRef.fromJson(cursor.getString(0))?.originPath?.let { out.add(it) }
            }
        }
        rawQuery(
            "SELECT source_path FROM publications WHERE id <> ?",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                legacyOriginPath(cursor.getString(0))?.let { out.add(it) }
            }
        }
        return out
    }

    private fun legacyOriginPath(sourcePath: String): String? =
        listOf("archive:", "cbr:", "pdf:", "image:")
            .firstOrNull { sourcePath.startsWith(it) }
            ?.let { sourcePath.removePrefix(it) }

    private fun reconcileCacheEntries() {
        val rows = mutableListOf<Triple<String, String, String>>()
        rawQuery("SELECT id, publication_id, cache_path FROM pages", emptyArray()).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2)))
            }
        }
        database.beginTransaction()
        try {
            for ((pageId, publicationId, path) in rows) {
                val file = validCacheFile(path)
                if (file != null) {
                    touchCacheEntry(pageId, path, file.length())
                } else {
                    execInsert("DELETE FROM cache_entries WHERE page_id = ?", arrayOf(pageId))
                    execInsert("UPDATE pages SET cache_path = '' WHERE id = ?", arrayOf(pageId))
                    if (path.isNotBlank()) {
                        appendDiagnostic(publicationId, CACHE_MISSING_DIAGNOSTIC)
                    }
                }
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    private fun cleanTombstones() {
        val root = cacheDir
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

    // ------------------------------------------------------------ SQL helpers

    private class DatabaseLock

    private fun rawQuery(sql: String, args: Array<Any?>): Cursor =
        database.rawQuery(sql, args.map { it?.toString() }.toTypedArray())

    private fun queryLong(sql: String, args: Array<Any?>): Long =
        rawQuery(sql, args).use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0) else 0L
        }

    private fun execInsert(sql: String, args: Array<Any?>) {
        database.execSQL(sql, args)
    }

    /** UPDATE via statement compilado; devolve quantas linhas mudaram. */
    private fun update(sql: String, args: Array<Any?>): Int =
        database.compileStatement(sql).use { statement ->
            args.forEachIndexed { index, value ->
                when (value) {
                    null -> statement.bindNull(index + 1)
                    is Long, is Int -> statement.bindLong(index + 1, (value as Number).toLong())
                    is Double, is Float -> statement.bindDouble(index + 1, (value as Number).toDouble())
                    else -> statement.bindString(index + 1, value.toString())
                }
            }
            statement.executeUpdateDelete()
        }

    private fun execBatch(sql: String) {
        // execSQL do Android executa um único statement; os batches do schema
        // (sem literais com ';') são divididos aqui.
        for (statement in sql.split(';')) {
            val trimmed = statement.trim()
            if (trimmed.isNotEmpty()) {
                database.execSQL(trimmed)
            }
        }
    }

    private fun columnExists(table: String, column: String): Boolean =
        rawQuery("SELECT 1 FROM pragma_table_info(?) WHERE name = ?", arrayOf(table, column))
            .use { it.moveToFirst() }

    private fun isInside(directory: File, file: File): Boolean {
        val root = try {
            directory.canonicalFile
        } catch (_: Exception) {
            return false
        }
        val target = try {
            file.canonicalFile
        } catch (_: Exception) {
            return false
        }
        return target.path == root.path || target.path.startsWith(root.path + File.separator)
    }

    private fun removeEmptyDirectories(directory: File) {
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

    // ----------------------------------------------------------- data holders

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
    @Synchronized
    internal fun insertPublication(publication: NewPublication): Pub {
        database.beginTransaction()
        try {
            execInsert(
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
                val pageCachePath = page.cachePath.takeIf { it.isFile && isInside(cacheDir, it) }
                execInsert(
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
                    execInsert(
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
            execInsert(
                "INSERT INTO progress (publication_id, current_page, updated_at) VALUES (?, 0, ?)",
                arrayOf(publication.id, publication.updatedAt),
            )
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        return findPublicationBySourcePath(publication.sourcePath)
            ?: error("publication disappeared after insert")
    }

    @Synchronized
    internal fun publicationExists(publicationId: String): Boolean =
        queryLong("SELECT COUNT(*) FROM publications WHERE id = ?", arrayOf(publicationId)) > 0

    private data class PageData(
        val id: String,
        val index: Int,
        val name: String,
        val cachePath: String,
        val sourceRef: PageSourceRef?,
        val width: Int,
        val height: Int,
        val format: String,
    ) {
        fun toReaderPage(path: String?) = ReaderPage(
            id = id,
            index = index,
            name = name,
            width = width,
            height = height,
            cachePath = path?.ifBlank { null },
        )
    }

    private data class CacheCandidate(
        val pageId: String,
        val publicationId: String,
        val cachePath: String,
        val byteSize: Long,
    )

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

    companion object {
        private val instances = mutableMapOf<String, LibraryDb>()

        /** Mesma instância por diretório; bancos grandes não abrem duas vezes. */
        @Synchronized
        fun open(
            dataDir: File,
            managedImportsDir: File,
            opener: SourceOpener = FileSourceOpener,
        ): LibraryDb {
            val key = dataDir.absolutePath
            return instances.getOrPut(key) { LibraryDb(dataDir, managedImportsDir, opener) }
        }

        /** Fecha e esquece a instância (usado por testes). */
        @Synchronized
        internal fun closeAll() {
            instances.values.forEach { it.database.close() }
            instances.clear()
        }
    }
}
