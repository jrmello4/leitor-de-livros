package com.jrmello4.tactilereader.core

/** Persists and lists publication bookmarks. */
internal class BookmarkRepository(private val db: LibraryDb) {
    fun list(publicationId: String): List<Bookmark> {
        val bookmarks = mutableListOf<Bookmark>()
        db.rawQuery(
            "SELECT page_id, label FROM bookmarks WHERE publication_id = ? ORDER BY created_at ASC, page_id ASC",
            arrayOf(publicationId),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                bookmarks.add(Bookmark(cursor.getString(0), cursor.getString(1) ?: ""))
            }
        }
        return bookmarks
    }

    fun upsert(publicationId: String, pageId: String, label: String) {
        if (publicationId.isBlank() || pageId.isBlank()) {
            error("publication id and page id must not be empty")
        }
        val belongs = db.rawQuery(
            "SELECT 1 FROM pages WHERE id = ? AND publication_id = ?",
            arrayOf(pageId, publicationId),
        ).use { it.moveToFirst() }
        require(belongs) { "bookmark page does not belong to the publication" }
        val now = timestampMillis()
        // UPDATE preserves created_at; INSERT only for a new bookmark.
        val updated = db.update(
            "UPDATE bookmarks SET label = ?, updated_at = ? WHERE publication_id = ? AND page_id = ?",
            arrayOf(label, now, publicationId, pageId),
        )
        if (updated == 0) {
            db.execInsert(
                "INSERT INTO bookmarks (publication_id, page_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                arrayOf(publicationId, pageId, label, now, now),
            )
        }
    }

    fun remove(publicationId: String, pageId: String) {
        db.execInsert(
            "DELETE FROM bookmarks WHERE publication_id = ? AND page_id = ?",
            arrayOf(publicationId, pageId),
        )
    }

    fun listAll(): List<BookmarkItem> {
        val list = mutableListOf<BookmarkItem>()
        db.rawQuery(
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
                    ),
                )
            }
        }
        return list
    }
}
