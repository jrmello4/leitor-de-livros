package com.jrmello4.tactilereader.core

/** Queries the ordered page metadata used by the reader. */
internal class PageRepository(private val db: LibraryDb) {
    fun list(publicationId: String): List<ReaderPage> {
        val pages = mutableListOf<ReaderPage>()
        db.rawQuery(
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
}
