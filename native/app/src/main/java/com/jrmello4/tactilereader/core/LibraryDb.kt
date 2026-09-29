package com.jrmello4.tactilereader.core

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.security.MessageDigest

/**
 * Banco da biblioteca em Kotlin puro (SQLite do Android), com migrações
 * incrementais desde o schema v6 e identificadores estáveis para os bancos
 * existentes no aparelho.
 *
 * Uma instância por diretório (cache em processo); operações SQLite são
 * serializadas por instância e reconstruções de página usam locks em faixas.
 */
class LibraryDb private constructor(
    val dataDir: File,
    val managedImportsDir: File,
    /** De onde vêm os bytes dos originais: caminho local ou `content://`. */
    val opener: SourceOpener,
) {
    val cacheDir: File = File(dataDir, "cache/pages")
    internal val database: SQLiteDatabase
    private val readingStateRepository = ReadingStateRepository(this)
    private val readingStatsRepository = ReadingStatsRepository(this)
    private val bookmarkRepository = BookmarkRepository(this)
    private val pageRepository = PageRepository(this)
    private val pageCacheManager = PageCacheManager(this)
    private val importLock = java.util.concurrent.locks.ReentrantLock()
    internal val pageLockStripes = Array(64) { Any() }
    @Volatile internal var queryObserverForTests: ((String) -> Unit)? = null

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
        pageCacheManager.cleanTombstones()
        pageCacheManager.reconcileCacheEntries()
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
        if (current < 8) {
            if (!columnExists("progress", "reading_status")) {
                execBatch("ALTER TABLE progress ADD COLUMN reading_status INTEGER NOT NULL DEFAULT 0")
            }
            // A linha criada durante a importação não significa leitura iniciada.
            // Recupera estados legados apenas quando a posição salva é posterior
            // à primeira página ou o estado do leitor foi salvo depois do progresso.
            execBatch(
                """
                UPDATE progress
                   SET reading_status = CASE
                       WHEN (
                           SELECT COUNT(*) FROM pages
                            WHERE pages.publication_id = progress.publication_id
                       ) > 1
                       AND (
                           (
                               (SELECT direction FROM publications
                                 WHERE publications.id = progress.publication_id) = 'rtl'
                               AND progress.current_page = 0
                           )
                           OR
                           (
                               (SELECT direction FROM publications
                                 WHERE publications.id = progress.publication_id) <> 'rtl'
                               AND progress.current_page >= (
                                   SELECT COUNT(*) - 1 FROM pages
                                    WHERE pages.publication_id = progress.publication_id
                               )
                           )
                       )
                       AND (
                           progress.current_page > 0
                           OR EXISTS (
                               SELECT 1 FROM reader_states
                                WHERE reader_states.publication_id = progress.publication_id
                                  AND reader_states.page_id IS NOT NULL
                                  AND reader_states.updated_at >= progress.updated_at
                           )
                       ) THEN 2
                       WHEN progress.current_page > 0
                         OR EXISTS (
                             SELECT 1 FROM reader_states
                              WHERE reader_states.publication_id = progress.publication_id
                                AND reader_states.page_id IS NOT NULL
                                AND reader_states.updated_at >= progress.updated_at
                         ) THEN 1
                       ELSE 0
                   END
                """.trimIndent(),
            )
            markMigration(8)
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

    /** Resumo completo da estante em uma consulta, sem materializar páginas. */
    @Synchronized
    fun listPublications(): List<Pub> {
        val publications = mutableListOf<Pub>()
        rawQuery(
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
    fun listPages(publicationId: String): List<ReaderPage> = pageRepository.list(publicationId)

    /**
     * Garante os bytes derivados de uma página (reconstruindo do original
     * somente-leitura quando preciso) e devolve o caminho de cache.
     */
    fun ensurePage(publicationId: String, pageId: String): ReaderPage =
        pageCacheManager.ensurePage(publicationId, pageId)

    @Synchronized
    fun loadReaderState(publicationId: String): ReaderProgress? =
        readingStateRepository.loadReaderState(publicationId)

    @Synchronized
    fun saveReaderState(publicationId: String, pageId: String, scrollRatio: Double) =
        readingStateRepository.saveReaderState(publicationId, pageId, scrollRatio)

    /** Retorna as métricas locais acumuladas de uma publicação. */
    @Synchronized
    fun loadReadingStats(publicationId: String): ReadingStats? = readingStatsRepository.load(publicationId)

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
    ): ReadingSpeed? = readingStatsRepository.recordSession(publicationId, durationMillis, pagesRead)

    /**
     * Consolida as métricas locais de leitura de todas as publicações
     * para a tela Minha Leitura, sem depender de nuvem ou contas.
     */
    @Synchronized
    fun loadOverallReadingStats(): OverallReadingStats = readingStatsRepository.loadOverall()

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

    /** Snapshot for portable backups; both queries are independent of shelf size. */
    @Synchronized
    internal fun backupSnapshot(): Map<String, PublicationBackupSnapshot> {
        val positions = mutableMapOf<String, BackupPagePosition>()
        rawQuery(
            """
            SELECT rs.publication_id, pg.page_index, rs.scroll_ratio
              FROM reader_states rs
              JOIN pages pg ON pg.publication_id = rs.publication_id AND pg.id = rs.page_id
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                positions[cursor.getString(0)] =
                    BackupPagePosition(cursor.getInt(1), cursor.getDouble(2).coerceIn(0.0, 1.0))
            }
        }

        // `markRead` can create a READING position without opening the reader.
        // Preserve that page in backups while exact reader states remain preferred.
        rawQuery(
            """
            SELECT progress.publication_id, pages.page_index
              FROM progress
              JOIN pages ON pages.publication_id = progress.publication_id
                         AND pages.page_index = progress.current_page
             WHERE progress.reading_status = ?
            """.trimIndent(),
            arrayOf(ReadingStatus.READING.databaseValue),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val publicationId = cursor.getString(0)
                positions.putIfAbsent(publicationId, BackupPagePosition(cursor.getInt(1), 0.0))
            }
        }

        val bookmarks = mutableMapOf<String, MutableList<BackupBookmarkPosition>>()
        rawQuery(
            """
            SELECT b.publication_id, pg.page_index, b.page_id, b.label
              FROM bookmarks b
              JOIN pages pg ON pg.publication_id = b.publication_id AND pg.id = b.page_id
             ORDER BY b.created_at ASC, b.page_id ASC
            """.trimIndent(),
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                bookmarks.getOrPut(cursor.getString(0)) { mutableListOf() }.add(
                    BackupBookmarkPosition(
                        pageIndex = cursor.getInt(1),
                        pageId = cursor.getString(2),
                        label = cursor.getString(3) ?: "",
                    ),
                )
            }
        }

        val pageDigests = mutableMapOf<String, MessageDigest>()
        rawQuery(
            "SELECT publication_id, page_index, name, width, height FROM pages ORDER BY publication_id, page_index",
            emptyArray(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val publicationId = cursor.getString(0)
                val name = cursor.getString(2) ?: ""
                val digest = pageDigests.getOrPut(publicationId) { MessageDigest.getInstance("SHA-256") }
                digest.update("${cursor.getInt(1)}:${cursor.getInt(3)}:${cursor.getInt(4)}:${name.length}:".toByteArray(Charsets.UTF_8))
                digest.update(name.toByteArray(Charsets.UTF_8))
                digest.update(0)
            }
        }
        val manifestFingerprints = pageDigests.mapValues { (_, digest) ->
            digest.digest().joinToString("") { byte -> "%02x".format(byte) }
        }

        return (positions.keys + bookmarks.keys + manifestFingerprints.keys).associateWith { publicationId ->
            PublicationBackupSnapshot(
                position = positions[publicationId],
                bookmarks = bookmarks[publicationId].orEmpty(),
                pageManifestFingerprint = manifestFingerprints[publicationId],
            )
        }
    }

    @Synchronized
    fun setFavorite(publicationId: String, favorite: Boolean) {
        execInsert(
            "UPDATE publications SET is_favorite = ?, updated_at = ? WHERE id = ?",
            arrayOf(if (favorite) 1 else 0, timestampMillis(), publicationId),
        )
    }

    /** Define a página lida; use [clearReadingProgress] para voltar a NOT_STARTED. */
    @Synchronized
    fun markRead(publicationId: String, currentPage: Int) =
        readingStateRepository.markRead(publicationId, currentPage)

    @Synchronized
    fun markFinished(publicationId: String) = readingStateRepository.markFinished(publicationId)

    @Synchronized
    fun clearReadingProgress(publicationId: String) = readingStateRepository.clearReadingProgress(publicationId)

    @Synchronized
    fun listBookmarks(publicationId: String): List<Bookmark> = bookmarkRepository.list(publicationId)

    @Synchronized
    fun upsertBookmark(publicationId: String, pageId: String, label: String) =
        bookmarkRepository.upsert(publicationId, pageId, label)

    @Synchronized
    fun removeBookmark(publicationId: String, pageId: String) = bookmarkRepository.remove(publicationId, pageId)

    /**
     * Lista todos os marcadores de todas as publicações na biblioteca,
     * incluindo o título da HQ e o índice humano da página (0-based).
     */
    @Synchronized
    fun listAllBookmarks(): List<BookmarkItem> = bookmarkRepository.listAll()

    @Synchronized
    fun cacheInfo(): CacheInfo = pageCacheManager.cacheInfo()

    /** Limpa o cache derivado sem tocar em originais. */
    @Synchronized
    fun clearCache() = pageCacheManager.clearCache()

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
        val cachePublicationDir = pageCacheManager.publicationCacheDir(publicationId)
        val legacySevenZipDir = File(dataDir, "7z-$publicationId")
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
        // Compatibilidade com publicações 7z da versão que mantinha uma
        // extração completa fora do cache por publicação.
        legacySevenZipDir.deleteRecursively()
        pageCacheManager.removeEmptyDirectories(cacheDir)
        for (origin in publicationOrigins) {
            if (otherOrigins.contains(origin)) continue
            val file = File(origin)
            val legacyPdfRoot = File(dataDir.parentFile, "pdf-pages")
            if (isInside(legacyPdfRoot, file)) {
                val pdfDirectory = file.parentFile
                if (pdfDirectory != null && otherOrigins.none { isInside(pdfDirectory, File(it)) }) {
                    pdfDirectory.deleteRecursively()
                }
            }
            if (isInside(managedImportsDir, file) && file.isFile) {
                file.delete()
            }
        }
        pageCacheManager.removeEmptyDirectories(managedImportsDir)
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
        val (currentPage, readingStatus) = rawQuery(
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
            readingStatus = readingStatus,
            sourceName = normalized.sourceLabel,
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

    internal fun writeProgress(
        publicationId: String,
        currentPage: Int,
        status: ReadingStatus,
        updatedAt: String,
    ) {
        val updated = update(
            "UPDATE progress SET current_page = ?, reading_status = ?, updated_at = ? WHERE publication_id = ?",
            arrayOf(currentPage, status.databaseValue, updatedAt, publicationId),
        )
        if (updated == 0) {
            execInsert(
                "INSERT INTO progress (publication_id, current_page, reading_status, updated_at) VALUES (?, ?, ?, ?)",
                arrayOf(publicationId, currentPage, status.databaseValue, updatedAt),
            )
        }
    }

    private fun validCustomCover(path: String): Boolean {
        val file = File(path)
        if (!file.isFile) return false
        return isInside(cacheDir, file)
    }

    internal fun appendDiagnostic(publicationId: String, diagnostic: String) {
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

    internal fun legacyOriginPath(sourcePath: String): String? =
        listOf("archive:", "cbr:", "7z:", "pdf:", "image:")
            .firstOrNull { sourcePath.startsWith(it) }
            ?.let { sourcePath.removePrefix(it) }

    // ------------------------------------------------------------ SQL helpers

    private class DatabaseLock

    internal fun rawQuery(sql: String, args: Array<Any?>): Cursor {
        queryObserverForTests?.invoke(sql)
        return database.rawQuery(sql, args.map { it?.toString() }.toTypedArray())
    }

    internal fun queryLong(sql: String, args: Array<Any?>): Long =
        rawQuery(sql, args).use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0) else 0L
        }

    internal fun execInsert(sql: String, args: Array<Any?>) {
        database.execSQL(sql, args)
    }

    /** UPDATE via statement compilado; devolve quantas linhas mudaram. */
    internal fun update(sql: String, args: Array<Any?>): Int =
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

    internal fun isInside(directory: File, file: File): Boolean {
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
                "INSERT INTO progress (publication_id, current_page, updated_at, reading_status) VALUES (?, 0, ?, 0)",
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
