package com.jrmello4.tactilereader.core

/** Stores completed sessions and aggregates local reading metrics. */
internal class ReadingStatsRepository(private val db: LibraryDb) {
    fun load(publicationId: String): ReadingStats? = db.rawQuery(
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

    fun recordSession(
        publicationId: String,
        durationMillis: Long,
        pagesRead: Int,
    ): ReadingSpeed? {
        if (publicationId.isBlank()) return null
        val pages = pagesRead.coerceAtLeast(0)
        val effective = ReadingMetrics.effectiveDuration(
            ReadingSession(durationMillis = durationMillis, pagesRead = pages),
        )
        val previous = db.loadReadingStats(publicationId)
        if (effective <= 0L || pages <= 0) {
            return previous?.let(::speedForStats)
        }
        val previousMillis = previous?.totalMillis ?: 0L
        val previousPages = previous?.pagesRead ?: 0
        val previousSessions = previous?.sessions ?: 0
        val totalMillis = saturatingAdd(previousMillis, effective)
        val totalPages = (previousPages.toLong() + pages)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        val sessions = (previousSessions.toLong() + 1L)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        val now = timestampMillis()
        db.database.beginTransaction()
        try {
            val updated = db.update(
                "UPDATE reading_stats SET total_millis = ?, pages_read = ?, sessions = ?, last_read_at = ? WHERE publication_id = ?",
                arrayOf(totalMillis, totalPages, sessions, now, publicationId),
            )
            if (updated == 0) {
                db.execInsert(
                    "INSERT INTO reading_stats (publication_id, total_millis, pages_read, sessions, last_read_at) VALUES (?, ?, ?, ?, ?)",
                    arrayOf(publicationId, totalMillis, totalPages, sessions, now),
                )
            }
            db.database.setTransactionSuccessful()
        } finally {
            db.database.endTransaction()
        }
        return speedForStats(ReadingStats(totalMillis, totalPages, sessions, now))
    }

    fun loadOverall(): OverallReadingStats {
        var totalMillis = 0L
        var totalPages = 0
        var totalSessions = 0
        val pubStats = mutableListOf<PublicationReadingStat>()

        for (pub in db.publications.list()) {
            val stats = db.loadReadingStats(pub.id)
            if (stats != null && (stats.totalMillis > 0L || stats.pagesRead > 0)) {
                totalMillis = saturatingAdd(totalMillis, stats.totalMillis)
                totalPages = (totalPages.toLong() + stats.pagesRead)
                    .coerceAtMost(Int.MAX_VALUE.toLong())
                    .toInt()
                totalSessions = (totalSessions.toLong() + stats.sessions)
                    .coerceAtMost(Int.MAX_VALUE.toLong())
                    .toInt()
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
                        readingStatus = pub.readingStatus,
                    ),
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

    private fun speedForStats(stats: ReadingStats): ReadingSpeed? {
        if (stats.totalMillis <= 0L || stats.pagesRead <= 0) return null
        return ReadingMetrics.calculateSpeed(
            ReadingSession(stats.totalMillis, stats.pagesRead),
            maxPauseThresholdMs = Long.MAX_VALUE,
        )
    }

    private fun saturatingAdd(a: Long, b: Long): Long =
        if (Long.MAX_VALUE - a < b) Long.MAX_VALUE else a + b
}
