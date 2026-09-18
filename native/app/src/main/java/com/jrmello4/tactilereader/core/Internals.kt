package com.jrmello4.tactilereader.core

import android.graphics.BitmapFactory
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Utilitários internos do núcleo: identificadores determinísticos (mesmo
 * algoritmo do núcleo Rust — `sha256` truncado em 12 bytes), limites de
 * segurança, nomes de importações legadas, validação de imagem e o formato
 * JSON de `source_ref` usado pelo SQLite.
 */

// --- Limites de segurança (idênticos ao núcleo anterior) ---
internal const val MAX_PAGE_BYTES: Long = 64L * 1024 * 1024
internal const val MAX_ARCHIVE_BYTES: Long = 1024L * 1024 * 1024
internal const val MAX_TOTAL_UNCOMPRESSED_BYTES: Long = 512L * 1024 * 1024
internal const val MAX_PAGE_COUNT: Int = 1024
internal const val MAX_COLLECTION_ITEMS: Int = 2048
internal const val MAX_COLLECTION_BYTES: Long = 64L * 1024 * 1024 * 1024
internal const val MAX_IMAGE_DIMENSION: Int = 20_000
internal const val MAX_IMAGE_PIXELS: Long = 100_000_000
internal const val DEFAULT_CACHE_LIMIT_BYTES: Long = 2L * 1024 * 1024 * 1024

internal const val CACHE_MISSING_DIAGNOSTIC =
    "Derived cache is unavailable; page reconstruction is required."
internal const val CUSTOM_COVER_MISSING_DIAGNOSTIC =
    "The custom cover is unavailable; the original publication cover is shown."
internal const val PDF_UNAVAILABLE_DIAGNOSTIC =
    "PDF ainda não está disponível no Android; use CBZ, ZIP ou imagens. O arquivo original foi preservado."

internal val IMAGE_EXTENSIONS = setOf("avif", "gif", "jpeg", "jpg", "png", "webp")

internal fun digestId(prefix: String, bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    val hex = StringBuilder(24)
    for (index in 0 until 12) {
        hex.append("%02x".format(digest[index]))
    }
    return "$prefix-$hex"
}

internal fun timestampMillis(): String = System.currentTimeMillis().toString()

internal fun extensionFromName(name: String): String? {
    val slash = name.lastIndexOfAny(charArrayOf('/', '\\'))
    val base = if (slash >= 0) name.substring(slash + 1) else name
    val dot = base.lastIndexOf('.')
    if (dot <= 0 || dot == base.length - 1) return null
    return base.substring(dot + 1).lowercase()
}

internal fun isImageExtension(extension: String): Boolean = IMAGE_EXTENSIONS.contains(extension)

/** Mesma ordem natural do núcleo: números comparados por valor, não lexicamente. */
internal fun naturalCompare(left: String, right: String): Int {
    val a = left.lowercase()
    val b = right.lowercase()
    var i = 0
    var j = 0
    while (i < a.length && j < b.length) {
        val aDigit = a[i].isDigit()
        val bDigit = b[j].isDigit()
        if (aDigit && bDigit) {
            var iStart = i
            var jStart = j
            while (i < a.length && a[i].isDigit()) i++
            while (j < b.length && b[j].isDigit()) j++
            val leftNumber = a.substring(iStart, i).trimStart('0').ifEmpty { "0" }
            val rightNumber = b.substring(jStart, j).trimStart('0').ifEmpty { "0" }
            val ordering = compareNumericStrings(leftNumber, rightNumber)
            if (ordering != 0) return ordering
            iStart = i
            jStart = j
            continue
        }
        val ordering = a[i].compareTo(b[j])
        if (ordering != 0) return ordering
        i++
        j++
    }
    return (a.length - i).compareTo(b.length - j)
}

private fun compareNumericStrings(left: String, right: String): Int {
    if (left.length != right.length) return left.length - right.length
    return left.compareTo(right)
}

/**
 * Valida o nome de um membro de arquivo: sem caminho absoluto, sem
 * traversal (`..`), sem prefixo de unidade Windows. Devolve o nome
 * normalizado (barras para `/`).
 */
internal fun validateArchiveName(rawName: String): String {
    val normalized = rawName.replace('\\', '/')
    require(normalized.isNotEmpty()) { "archive contains an absolute page path" }
    require(!normalized.startsWith("/")) { "archive contains an absolute page path" }
    require(!(normalized.length > 1 && normalized[1] == ':')) {
        "archive contains an absolute page path"
    }
    for (part in normalized.split('/')) {
        require(part != "..") { "archive contains a path traversal entry" }
    }
    return normalized
}

/** Lê as dimensões sem decodificar os pixels (rejeita bomba de dimensão). */
internal fun validateImageDimensions(bytes: ByteArray, label: String): Pair<Int, Int> {
    require(bytes.isNotEmpty()) { "$label: empty image" }
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    val width = options.outWidth
    val height = options.outHeight
    require(width > 0 && height > 0) { "$label: image dimensions are invalid" }
    require(width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
        "$label: image dimensions exceed the safety limit"
    }
    require(width.toLong() * height.toLong() <= MAX_IMAGE_PIXELS) {
        "$label: image pixel count exceeds the safety limit"
    }
    return width to height
}

/** Escreve um arquivo derivado com nome validado, de forma atômica. */
internal fun cachePage(cacheDir: File, pageId: String, extension: String, bytes: ByteArray): File {
    require(isSinglePathComponent(pageId) && isImageExtension(extension)) {
        "invalid derived cache file name"
    }
    cacheDir.mkdirs()
    val target = File(cacheDir, "$pageId.$extension")
    val temporary = File(cacheDir, ".$pageId.${System.nanoTime()}.tmp")
    temporary.writeBytes(bytes)
    if (target.exists()) {
        val backup = File(cacheDir, ".$pageId.${System.nanoTime()}.backup")
        target.renameTo(backup)
        if (!temporary.renameTo(target)) {
            temporary.delete()
            backup.renameTo(target)
            error("unable to move derived page cache into place")
        }
        backup.delete()
    } else {
        if (!temporary.renameTo(target)) {
            temporary.delete()
            error("unable to move derived page page cache into place")
        }
    }
    return target
}

private fun isSinglePathComponent(value: String): Boolean =
    value.isNotEmpty() && !value.contains('/') && !value.contains('\\') &&
        value != "." && value != ".."

/** `canonicalPath` sem lançar (arquivo pode ter sumido no meio do caminho). */
internal fun File.canonicalPathOrNull(): String? = try {
    canonicalPath
} catch (_: Exception) {
    null
}

// --- Formato JSON de source_ref (compatível com o que o Rust gravava) ---

internal sealed class PageSourceRef {
    data class Image(val path: String) : PageSourceRef()
    data class Archive(val path: String, val member: String) : PageSourceRef()
    data class Pdf(val path: String, val pageIndex: Int) : PageSourceRef()

    fun toJson(): String = when (this) {
        is Image -> JSONObject().put("kind", "image").put("path", path).toString()
        is Archive -> JSONObject().put("kind", "archive").put("path", path)
            .put("member", member).toString()
        is Pdf -> JSONObject().put("kind", "pdf").put("path", path)
            .put("pageIndex", pageIndex).toString()
    }

    val originPath: String
        get() = when (this) {
            is Image -> path
            is Archive -> path
            is Pdf -> path
        }

    companion object {
        fun fromJson(value: String?): PageSourceRef? {
            if (value.isNullOrBlank()) return null
            return try {
                val json = JSONObject(value)
                when (json.optString("kind")) {
                    "image" -> Image(json.getString("path"))
                    "archive" -> Archive(json.getString("path"), json.getString("member"))
                    "pdf" -> Pdf(json.getString("path"), json.optInt("pageIndex", 0))
                    else -> null
                }
            } catch (_: Exception) {
                null
            }
        }
    }
}

/**
 * Recupera somente prefixos cujo local de armazenamento prova que foram
 * criados por um importador antigo. Nunca remove números arbitrários de um
 * nome externo. Porta fiel de `publication_names.rs`.
 */
internal object PublicationNames {
    fun originalImportName(sourceKey: String, managedImportDir: File): String? {
        val raw = listOf("archive:", "cbr:", "7z:", "pdf:")
            .firstOrNull { sourceKey.startsWith(it) }
            ?.let { sourceKey.removePrefix(it) }
            ?: return null
        val source = storagePath(raw)
        val managed = storagePath(managedImportDir.path)
        val path = File(source)
        val parent = path.parentFile ?: return null
        val parentName = parent.name
        val filename = path.name
        val grandParent = parent.parentFile

        val original = when {
            grandParent != null && grandParent.path == managed &&
                parentName.startsWith("batch-") -> {
                val batch = parentName.removePrefix("batch-")
                val parts = batch.split('-', limit = 2)
                if (parts.size == 2 && digits(parts[0]) && digits(parts[1])) {
                    stripIndex(filename, null) ?: return null
                } else {
                    return null
                }
            }
            parent.path == managed -> {
                val split = filename.split('-', limit = 2)
                if (split.size != 2) return null
                val (timestamp, rest) = split
                if (timestamp.length != 13 || !digits(timestamp)) return null
                stripIndex(rest, null) ?: return null
            }
            parentName.startsWith("collection-collection-") -> {
                val hash = parentName.removePrefix("collection-collection-")
                if (hash.length == 24 && hash.all { it.isDigit() || it in 'a'..'f' }) {
                    stripIndex(filename, 4) ?: return null
                } else {
                    return null
                }
            }
            else -> return null
        }
        return original
    }

    @android.annotation.SuppressLint("SdCardPath")
    private fun storagePath(value: String): String {
        val stripped = value.removePrefix("\\\\?\\")
        return if (stripped.startsWith("/data/data/")) {
            "/data/user/0/" + stripped.removePrefix("/data/data/")
        } else {
            stripped
        }
    }

    private fun digits(value: String): Boolean = value.isNotEmpty() && value.all { it.isDigit() }

    private fun stripIndex(value: String, width: Int?): String? {
        val split = value.split('-', limit = 2)
        if (split.size != 2) return null
        val (index, original) = split
        if (!digits(index)) return null
        if (width != null && index.length != width) return null
        if (original.isEmpty()) return null
        return original
    }
}
