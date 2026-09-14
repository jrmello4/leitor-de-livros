package com.jrmello4.tactilereader.core

import org.json.JSONObject

/** Uma página da faixa de leitura: metadados sempre, bytes sob demanda. */
data class ReaderPage(
    val id: String,
    val index: Int,
    val name: String,
    val width: Int,
    val height: Int,
    /** Caminho de cache já materializado (nulo/vazio = garantir via JNI). */
    val cachePath: String? = null,
)

/** Progresso `{pageId, scrollRatio}` — a posição exata volta ao reabrir. */
data class ReaderProgress(
    val pageId: String,
    val scrollRatio: Double,
)

private fun JSONObject.optStringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) {
        optString(name, "").ifBlank { null }
    } else {
        null
    }

private fun JSONObject.optDoubleCompat(name: String): Double =
    if (has(name)) optDouble(name, 0.0) else 0.0

private fun failIfError(root: JSONObject) {
    if (root.has("error")) {
        throw IllegalStateException(root.getString("error"))
    }
}

/** Interpreta `nativeListPages`: `{"pages":[...]}` em ordem natural. */
fun parseReaderPages(json: String): List<ReaderPage> {
    val root = JSONObject(json)
    failIfError(root)
    val array = root.getJSONArray("pages")
    return List(array.length()) { i ->
        val item = array.getJSONObject(i)
        ReaderPage(
            id = item.getString("id"),
            index = item.optInt("index", i),
            name = item.optString("name", ""),
            width = item.optInt("width", 0),
            height = item.optInt("height", 0),
            cachePath = item.optStringOrNull("cachePath"),
        )
    }.sortedBy { it.index }
}

/**
 * Interpreta `nativeEnsurePage`: `{"pageSrc":...}` vira o caminho,
 * `{"error":...}` lança, caminho vazio vira nulo (placeholder segue).
 */
fun parseEnsurePage(json: String): String? {
    val root = JSONObject(json)
    failIfError(root)
    return root.optStringOrNull("pageSrc")
}

/**
 * Interpreta `nativeLoadReaderState`: `{"state":null}` vira nulo (começa
 * da primeira página); `{"error":...}` lança.
 */
fun parseReaderState(json: String): ReaderProgress? {
    val root = JSONObject(json)
    failIfError(root)
    if (root.isNull("state")) {
        return null
    }
    val state = root.getJSONObject("state")
    val pageId = state.optStringOrNull("pageId") ?: return null
    if (pageId.isBlank()) {
        return null
    }
    return ReaderProgress(
        pageId = pageId,
        scrollRatio = state.optDoubleCompat("scrollRatio").coerceIn(0.0, 1.0),
    )
}

/**
 * Página já disponível sem JNI: o `cachePath` listado resolve quando o
 * arquivo existe em disco. Pura e testável na JVM.
 */
fun resolveImmediatePage(page: ReaderPage, exists: (String) -> Boolean = { java.io.File(it).isFile() }): String? {
    val path = page.cachePath
    if (!path.isNullOrBlank() && exists(path)) {
        return path
    }
    return null
}
