package com.jrmello4.tactilereader.settings

import com.jrmello4.tactilereader.core.LibraryDb
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Backup local honesto: JSON no aparelho, sem nuvem, sem conta.
 * Guarda favoritos, progresso `{pageId, scrollRatio}` e marcadores por
 * publicação. Originais nunca entram no backup — só metadados.
 */
object BackupManager {
    private const val APP = "tactile-reader"
    private const val VERSION = 1

    fun export(db: LibraryDb, target: File): File {
        val pubs = db.listPublications()
        val snapshot = try {
            db.librarySnapshot()
        } catch (_: Exception) {
            emptyMap()
        }
        val root = JSONObject()
        root.put("app", APP)
        root.put("version", VERSION)
        root.put(
            "exportedAt",
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date()),
        )
        val pubsArray = JSONArray()
        for (pub in pubs) {
            val item = JSONObject()
            item.put("id", pub.id)
            item.put("title", pub.title)
            item.put("format", pub.format)
            item.put("isFavorite", pub.isFavorite)
            item.put("progress", pub.progress)
            val prog = snapshot[pub.id]
            if (prog?.pageId != null) {
                val state = JSONObject()
                state.put("pageId", prog.pageId)
                state.put("scrollRatio", prog.scrollRatio)
                item.put("readerState", state)
            }
            try {
                val marks = db.listBookmarks(pub.id)
                if (marks.isNotEmpty()) {
                    val arr = JSONArray()
                    for (mark in marks) {
                        val m = JSONObject()
                        m.put("pageId", mark.pageId)
                        m.put("label", mark.label)
                        arr.put(m)
                    }
                    item.put("bookmarks", arr)
                }
            } catch (_: Exception) {
            }
            pubsArray.put(item)
        }
        root.put("publications", pubsArray)
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
        val pubs = db.listPublications()
        val byId = pubs.associateBy { it.id }
        val byTitle = pubs.associateBy { it.title }
        val array = root.optJSONArray("publications") ?: JSONArray()
        var favorites = 0
        var progress = 0
        var bookmarks = 0
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val id = item.optString("id", "")
            val title = item.optString("title", "")
            val target = byId[id] ?: byTitle[title] ?: continue
            if (item.has("isFavorite")) {
                try {
                    db.setFavorite(target.id, item.optBoolean("isFavorite"))
                    favorites++
                } catch (_: Exception) {
                }
            }
            val state = item.optJSONObject("readerState")
            if (state != null) {
                val pageId = state.optString("pageId", "")
                val ratio = state.optDouble("scrollRatio", 0.0)
                if (pageId.isNotBlank()) {
                    try {
                        db.saveReaderState(target.id, pageId, ratio)
                        progress++
                    } catch (_: Exception) {
                    }
                }
            }
            val marks = item.optJSONArray("bookmarks")
            if (marks != null) {
                for (j in 0 until marks.length()) {
                    val m = marks.optJSONObject(j) ?: continue
                    val pageId = m.optString("pageId", "")
                    if (pageId.isBlank()) continue
                    try {
                        db.upsertBookmark(target.id, pageId, m.optString("label", ""))
                        bookmarks++
                    } catch (_: Exception) {
                    }
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
