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
    /** Página de onde a capa é desenhada; usada para garantir bytes sob demanda. */
    val coverPageId: String = "",
    /** Caminho de cache já materializado (pode ser nulo/vazio em import novo). */
    val coverSrc: String? = null,
    /** Capa personalizada válida (arquivo no cache derivado), se houver. */
    val customCoverPath: String? = null,
)

private fun JSONObject.optStringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) {
        optString(name, "").ifBlank { null }
    } else {
        null
    }

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
            coverPageId = item.optString("coverPageId", ""),
            coverSrc = item.optStringOrNull("coverSrc"),
            customCoverPath = item.optStringOrNull("customCoverPath"),
        )
    }
}

fun pathsJson(paths: List<String>): String {
    val array = JSONArray()
    paths.forEach { array.put(it) }
    return array.toString()
}

/**
 * Interpreta a resposta de `nativeEnsureCover`: `{"coverSrc":...}` vira o
 * caminho, `{"error":...}` lança, caminho vazio vira nulo (capa indisponível,
 * mantém placeholder sem quebrar a estante).
 */
fun parseEnsureCover(json: String): String? {
    val root = JSONObject(json)
    if (root.has("error")) {
        throw IllegalStateException(root.getString("error"))
    }
    return root.optStringOrNull("coverSrc")
}

/**
 * Capa já disponível sem JNI: prefere a personalizada válida, senão o
 * `coverSrc` já materializado. Arquivos inexistentes voltam a nulo para que
 * o chamador garanta via `nativeEnsureCover`. Pura e testável na JVM.
 */
fun resolveImmediateCover(pub: Pub, exists: (String) -> Boolean = { java.io.File(it).isFile() }): String? {
    pub.customCoverPath?.takeIf { it.isNotBlank() && exists(it) }?.let { return it }
    pub.coverSrc?.takeIf { it.isNotBlank() && exists(it) }?.let { return it }
    return null
}
