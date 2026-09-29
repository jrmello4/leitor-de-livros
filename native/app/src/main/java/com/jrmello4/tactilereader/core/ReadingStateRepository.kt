package com.jrmello4.tactilereader.core

/** Owns explicit reading status, resume position, and scroll persistence. */
internal class ReadingStateRepository(private val db: LibraryDb) {
    fun loadReaderState(publicationId: String): ReaderProgress? = db.rawQuery(
        "SELECT page_id, scroll_ratio FROM reader_states WHERE publication_id = ?",
        arrayOf(publicationId),
    ).use { cursor ->
        if (!cursor.moveToFirst()) return null
        val pageId = cursor.getString(0)?.ifBlank { null } ?: return null
        ReaderProgress(pageId, cursor.getDouble(1).coerceIn(0.0, 1.0))
    }

    fun saveReaderState(publicationId: String, pageId: String, scrollRatio: Double) {
        if (publicationId.isBlank() || pageId.isBlank()) {
            error("publication id and page id must not be empty")
        }
        val position = db.rawQuery(
            """
            SELECT pages.page_index,
                   (SELECT COUNT(*) FROM pages AS all_pages
                     WHERE all_pages.publication_id = pages.publication_id),
                   publications.direction
              FROM pages
              JOIN publications ON publications.id = pages.publication_id
             WHERE pages.publication_id = ? AND pages.id = ?
            """.trimIndent(),
            arrayOf(publicationId, pageId),
        ).use { cursor ->
            if (!cursor.moveToFirst()) error("page does not belong to the publication")
            ReadingPosition(
                pageIndex = cursor.getInt(0).coerceAtLeast(0),
                pageCount = cursor.getInt(1).coerceAtLeast(0),
                direction = cursor.getString(2),
            )
        }
        val ratio = if (scrollRatio.isNaN()) 0.0 else scrollRatio.coerceIn(0.0, 1.0)
        val now = timestampMillis()
        // Sem UPSERT: o SQLite do sistema é 3.18 no Android 8 (UPSERT pede 3.24).
        db.database.beginTransaction()
        try {
            val updated = db.update(
                "UPDATE reader_states SET page_id = ?, scroll_ratio = ?, updated_at = ? WHERE publication_id = ?",
                arrayOf(pageId, ratio, now, publicationId),
            )
            if (updated == 0) {
                db.execInsert(
                    """
                    INSERT INTO reader_states
                        (publication_id, zoom_mode, zoom_scale, pan_x, pan_y, page_id, scroll_ratio, updated_at)
                    VALUES (?, 'page', 1.0, 0.0, 0.0, ?, ?, ?)
                    """.trimIndent(),
                    arrayOf(publicationId, pageId, ratio, now),
                )
            }
            // The shelf reads this lightweight status without materializing reader state.
            val status = if (
                ReadingStateRules.isFinished(position.pageIndex, position.pageCount, position.direction)
            ) {
                ReadingStatus.FINISHED
            } else {
                ReadingStatus.READING
            }
            db.writeProgress(publicationId, position.pageIndex, status, now)
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
    }

    fun markRead(publicationId: String, currentPage: Int) {
        val pageCount = db.queryLong(
            "SELECT COUNT(*) FROM pages WHERE publication_id = ?",
            arrayOf(publicationId),
        ).toInt()
        val direction = db.rawQuery(
            "SELECT direction FROM publications WHERE id = ?",
            arrayOf(publicationId),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else "ltr" }
        val page = currentPage.coerceIn(0, (pageCount - 1).coerceAtLeast(0))
        val status = if (ReadingStateRules.isFinished(page, pageCount, direction)) {
            ReadingStatus.FINISHED
        } else {
            ReadingStatus.READING
        }
        val now = timestampMillis()
        db.database.beginTransaction()
        try {
            db.writeProgress(publicationId, page, status, now)
            db.execInsert("UPDATE publications SET updated_at = ? WHERE id = ?", arrayOf(now, publicationId))
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
    }

    fun markFinished(publicationId: String) {
        val position = db.rawQuery(
            """
            SELECT COUNT(*), direction FROM pages
              JOIN publications ON publications.id = pages.publication_id
             WHERE publications.id = ?
            """.trimIndent(),
            arrayOf(publicationId),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return
            cursor.getInt(0) to cursor.getString(1)
        }
        val terminalPage = ReadingStateRules.finalPageIndex(position.first, position.second) ?: return
        val now = timestampMillis()
        db.database.beginTransaction()
        try {
            db.writeProgress(publicationId, terminalPage, ReadingStatus.FINISHED, now)
            db.execInsert("UPDATE publications SET updated_at = ? WHERE id = ?", arrayOf(now, publicationId))
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
    }

    fun clearReadingProgress(publicationId: String) {
        val now = timestampMillis()
        db.database.beginTransaction()
        try {
            db.writeProgress(publicationId, 0, ReadingStatus.NOT_STARTED, now)
            // Preserve zoom and pan settings while discarding the resumable position.
            db.execInsert(
                "UPDATE reader_states SET page_id = NULL, scroll_ratio = 0.0, updated_at = ? WHERE publication_id = ?",
                arrayOf(now, publicationId),
            )
            db.execInsert("UPDATE publications SET updated_at = ? WHERE id = ?", arrayOf(now, publicationId))
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
    }

    private data class ReadingPosition(
        val pageIndex: Int,
        val pageCount: Int,
        val direction: String,
    )
}
