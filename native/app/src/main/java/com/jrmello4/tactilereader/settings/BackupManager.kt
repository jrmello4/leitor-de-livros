package com.jrmello4.tactilereader.settings

import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.core.Pub
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Local JSON backup: metadata, favorites, portable page positions and bookmarks. */
object BackupManager {
    private const val APP = "tactile-reader"
    private const val VERSION = 2

    /** Stable metadata fingerprint; matching still requires a unique candidate. */
    internal fun publicationFingerprint(pub: Pub, pageManifestFingerprint: String? = null): String {
        val identity = listOf(
            pub.format,
            pub.title,
            pub.sourceName,
            pub.pageCount.toString(),
            pageManifestFingerprint.orEmpty(),
        )
            .joinToString("\u0000")
        val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun export(db: LibraryDb, target: File): File {
        val publications = db.listPublications()
        val snapshot = db.backupSnapshot()
        val root = JSONObject()
            .put("app", APP)
            .put("version", VERSION)
            .put("exportedAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date()))
        val items = JSONArray()
        for (pub in publications) {
            val state = snapshot[pub.id]
            val item = JSONObject()
                .put("id", pub.id) // Retained for restores from older installations.
                .put("title", pub.title)
                .put("sourceName", pub.sourceName)
                .put("format", pub.format)
                .put("pageCount", pub.pageCount)
                .put("publicationFingerprint", publicationFingerprint(pub, state?.pageManifestFingerprint))
                .put("pageManifestFingerprint", state?.pageManifestFingerprint)
                .put("isFavorite", pub.isFavorite)
                .put("progress", pub.progress)
                .put("readingStatus", pub.readingStatus.name)

            state?.position?.let { position ->
                val stateJson = JSONObject()
                    .put("pageIndex", position.pageIndex)
                    .put("scrollRatio", position.scrollRatio)
                item.put("readerState", stateJson)
            }
            if (!state?.bookmarks.isNullOrEmpty()) {
                val bookmarks = JSONArray()
                state!!.bookmarks.forEach { bookmark ->
                    bookmarks.put(
                        JSONObject()
                            .put("pageIndex", bookmark.pageIndex)
                            .put("pageId", bookmark.pageId) // Legacy fallback only.
                            .put("label", bookmark.label),
                    )
                }
                item.put("bookmarks", bookmarks)
            }
            items.put(item)
        }
        root.put("publications", items)
        target.parentFile?.mkdirs()
        target.writeText(root.toString(2), Charsets.UTF_8)
        return target
    }

    data class RestoreSummary(val favorites: Int, val progress: Int, val bookmarks: Int)

    fun import(db: LibraryDb, backup: File): RestoreSummary {
        val root = JSONObject(backup.readText(Charsets.UTF_8))
        if (root.optString("app") != APP) {
            throw IllegalStateException("Arquivo não é um backup do Tactile Reader.")
        }
        val current = db.listPublications()
        val snapshot = db.backupSnapshot()
        val byId = current.associateBy { it.id }
        val byFingerprint = current.groupBy { publicationFingerprint(it, snapshot[it.id]?.pageManifestFingerprint) }
        val items = root.optJSONArray("publications") ?: JSONArray()
        var favorites = 0
        var progress = 0
        var bookmarks = 0

        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val fingerprint = item.optString("publicationFingerprint", "")
            val target = byFingerprint[fingerprint]?.singleOrNull()
                ?: byId[item.optString("id", "")]
                    ?.takeIf {
                        fingerprint.isBlank() ||
                            publicationFingerprint(it, snapshot[it.id]?.pageManifestFingerprint) == fingerprint
                    }
                ?: current.singleOrNull { candidate ->
                    item.has("title") && item.has("sourceName") && item.has("format") && item.has("pageCount") &&
                        candidate.title == item.optString("title") &&
                        candidate.sourceName == item.optString("sourceName") &&
                        candidate.format == item.optString("format") &&
                        candidate.pageCount == item.optInt("pageCount", -1) &&
                        (!item.has("pageManifestFingerprint") ||
                            snapshot[candidate.id]?.pageManifestFingerprint == item.optString("pageManifestFingerprint"))
                }
                ?: continue

            if (item.has("isFavorite")) {
                db.setFavorite(target.id, item.optBoolean("isFavorite"))
                favorites++
            }

            val pages = db.listPages(target.id)
            val state = item.optJSONObject("readerState")
            if (item.optString("readingStatus") == "NOT_STARTED") {
                db.clearReadingProgress(target.id)
            } else if (state != null) {
                val pageIndex = state.optInt("pageIndex", -1)
                val pageId = if (pageIndex in pages.indices) {
                    pages[pageIndex].id
                } else {
                    // v1 backups stored only pageId; accept it only if it belongs to this publication.
                    val legacyId = state.optString("pageId", "")
                    legacyId.takeIf { id -> pages.any { it.id == id } }
                }
                if (pageId != null) {
                    db.saveReaderState(target.id, pageId, state.optDouble("scrollRatio", 0.0))
                    progress++
                }
            }

            item.optJSONArray("bookmarks")?.let { marks ->
                for (j in 0 until marks.length()) {
                    val mark = marks.optJSONObject(j) ?: continue
                    val pageIndex = mark.optInt("pageIndex", -1)
                    val pageId = if (pageIndex in pages.indices) {
                        pages[pageIndex].id
                    } else {
                        val legacyId = mark.optString("pageId", "")
                        legacyId.takeIf { id -> pages.any { it.id == id } }
                    } ?: continue
                    db.upsertBookmark(target.id, pageId, mark.optString("label", ""))
                    bookmarks++
                }
            }
        }
        return RestoreSummary(favorites, progress, bookmarks)
    }

    fun defaultExportFile(filesDir: File): File {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        return File(File(filesDir, "backups").apply { mkdirs() }, "tactile-reader-backup-$stamp.json")
    }
}
