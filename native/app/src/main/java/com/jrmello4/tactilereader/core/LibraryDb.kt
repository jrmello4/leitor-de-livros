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
    internal val publications = PublicationRepository(this)
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

    /** Ordered page metadata used by the reader, without rendering page bytes. */
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
        require(publications.exists(publicationId)) { "publication does not exist" }

        val publicationOrigins = publications.originPaths(publicationId)
        val otherOrigins = publications.otherOriginPaths(publicationId)
        val cachePublicationDir = pageCacheManager.publicationCacheDir(publicationId)
        val legacySevenZipDir = File(dataDir, "7z-$publicationId")
        val staging = File(cacheDir, ".$publicationId.${System.nanoTime()}.delete")
        var staged = false
        if (cachePublicationDir.exists()) {
            cachePublicationDir.renameTo(staging)
            staged = true
        }

        try {
            publications.deleteRows(publicationId)
        } catch (error: Exception) {
            if (staged) staging.renameTo(cachePublicationDir)
            throw error
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
