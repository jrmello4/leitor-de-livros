package com.jrmello4.tactilereader.core

import org.json.JSONArray
import org.json.JSONObject

/** Subconjunto do `NativePublication` do núcleo usado na estante. */
data class Pub(
    val id: String,
    val title: String,
    val format: String,
    val pageCount: Int,
    val progress: Double,
    val isFavorite: Boolean,
)

private fun JSONObject.optBooleanCompat(name: String): Boolean =
    if (has(name)) getBoolean(name) else false

/** Lança em JSON malformado ou `{"error": ...}` do núcleo. */
fun parsePublications(json: String): List<Pub> {
    val root = JSONObject(json)
    if (root.has("error")) {
        throw IllegalStateException(root.getString("error"))
    }
    val array = root.getJSONArray("publications")
    return List(array.length()) { index ->
        val item = array.getJSONObject(index)
        Pub(
            id = item.getString("id"),
            title = item.getString("title"),
            format = item.getString("format"),
            pageCount = item.getInt("pageCount"),
            progress = item.getDouble("progress"),
            isFavorite = item.optBooleanCompat("isFavorite"),
        )
    }
}

fun pathsJson(paths: List<String>): String {
    val array = JSONArray()
    paths.forEach { array.put(it) }
    return array.toString()
}
