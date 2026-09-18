package com.jrmello4.tactilereader.opds

import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import javax.xml.parsers.DocumentBuilderFactory
import kotlinx.coroutines.isActive
import org.w3c.dom.Element
import kotlin.coroutines.coroutineContext

/**
 * Cliente mínimo OPDS 1.2 + Komga REST.
 *
 * - OPDS/Kavita-via-OPDS: navega feeds Atom, segue `subsection` e baixa
 *   links `acquisition` com progresso e cancelamento.
 * - Komga: lista séries (`/api/v2/series`) e livros (`/api/v2/series/{id}/books`),
 *   baixa o arquivo (`/api/v2/books/{id}/file`) para leitura offline.
 * - Streaming v1 = download sob demanda + abrir no leitor; o arquivo completo
 *   fica em `imports/` sem tocar em originais remotos.
 *
 * Sem telemetria: só fala com os servidores cadastrados, sempre HTTPS
 * quando o usuário cadastrar https.
 */
object OpdsClient {
    private val counter = java.util.concurrent.atomic.AtomicInteger(0)

    data class Entry(
        val title: String,
        val id: String = "",
        val subsection: String? = null,
        val acquisition: String? = null,
        val mime: String? = null,
    )

    const val MAX_FEED_ENTRIES = 500
    const val MAX_DOWNLOAD_BYTES = 500L * 1024 * 1024 // 500 MB

    private fun authHeader(server: OpdsServer): String? {
        if (server.user.isBlank()) return null
        val token = "${server.user}:${server.pass}"
        return "Basic " + Base64.encodeToString(token.toByteArray(), Base64.NO_WRAP)
    }

    private fun open(url: String, server: OpdsServer, timeout: Int = 12000): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = timeout
        connection.readTimeout = timeout
        connection.instanceFollowRedirects = true
        authHeader(server)?.let { connection.setRequestProperty("Authorization", it) }
        return connection
    }

    fun resolve(base: String, href: String): String {
        return try {
            URL(URL(base), href).toString()
        } catch (_: Exception) {
            href
        }
    }

    /** Feed OPDS → entradas (título, navegação, aquisição). Protegido contra XXE e feeds gigantes. */
    fun fetchFeed(server: OpdsServer, feedUrl: String = server.url): List<Entry> {
        val connection = open(feedUrl, server)
        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("Servidor respondeu ${connection.responseCode}")
        }
        val stream = connection.inputStream
        return try {
            val factory = DocumentBuilderFactory.newInstance().apply {
                isExpandEntityReferences = false
                isNamespaceAware = true
                runCatching { setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
                runCatching { setFeature("http://xml.org/sax/features/external-general-entities", false) }
                runCatching { setFeature("http://xml.org/sax/features/external-parameter-entities", false) }
                runCatching { setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false) }
                runCatching { isXIncludeAware = false }
            }
            val doc = factory.newDocumentBuilder().parse(stream)
            doc.documentElement.normalize()
            val nodes = doc.getElementsByTagName("entry")
            val count = minOf(nodes.length, MAX_FEED_ENTRIES)
            List(count) { i ->
                val element = nodes.item(i) as Element
                val title = element.getElementsByTagName("title").item(0)?.textContent?.trim().orEmpty()
                val id = element.getElementsByTagName("id").item(0)?.textContent?.trim().orEmpty()
                var subsection: String? = null
                var acquisition: String? = null
                var mime: String? = null
                val links = element.getElementsByTagName("link")
                for (j in 0 until links.length) {
                    val link = links.item(j) as Element
                    val rel = link.getAttribute("rel")
                    val href = link.getAttribute("href")
                    if (href.isBlank()) continue
                    val absolute = resolve(feedUrl, href)
                    when {
                        rel.contains("subsection") || rel.contains("navigation") -> {
                            if (subsection == null) subsection = absolute
                        }
                        rel.contains("acquisition") || rel == "http://opds-spec.org/acquisition" -> {
                            if (acquisition == null) {
                                acquisition = absolute
                                mime = link.getAttribute("type").ifBlank { null }
                            }
                        }
                        acquisition == null && link.getAttribute("type").contains("zip", true) -> {
                            acquisition = absolute
                        }
                    }
                }
                // Fallback: alguns feeds usam rel genérico p/ navegar.
                if (subsection == null && acquisition == null) {
                    for (j in 0 until links.length) {
                        val link = links.item(j) as Element
                        val href = link.getAttribute("href")
                        if (href.isNotBlank() && link.getAttribute("type").contains("atom", true)) {
                            subsection = resolve(feedUrl, href)
                            break
                        }
                    }
                }
                Entry(title.ifBlank { "Sem título" }, id, subsection, acquisition, mime)
            }
        } finally {
            try { stream.close() } catch (_: Exception) {
            }
            connection.disconnect()
        }
    }

    /** Komga: séries paginadas (título + id). */
    fun komgaSeries(server: OpdsServer, page: Int = 0, size: Int = 50): List<Entry> {
        val base = server.url.trimEnd('/')
        val url = "$base/api/v2/series?page=$page&size=$size&sort=name,asc"
        val connection = open(url, server)
        connection.setRequestProperty("Accept", "application/json")
        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("Komga respondeu ${connection.responseCode}")
        }
        return try {
            val body = connection.inputStream.bufferedReader().readText()
            val root = org.json.JSONObject(body)
            val content = root.optJSONArray("content") ?: return emptyList()
            val count = minOf(content.length(), MAX_FEED_ENTRIES)
            List(count) { i ->
                val o = content.getJSONObject(i)
                val id = o.optString("id", "")
                val name = o.optJSONObject("metadata")?.optString("title", "")?.ifBlank { o.optString("name", "Série") } ?: "Série"
                Entry(name, id, subsection = "komga:series:$id")
            }
        } finally {
            connection.disconnect()
        }
    }

    /** Komga: livros de uma série. */
    fun komgaBooks(server: OpdsServer, seriesId: String): List<Entry> {
        val base = server.url.trimEnd('/')
        val url = "$base/api/v2/series/$seriesId/books?sort=metadata.numberSort,asc"
        val connection = open(url, server)
        connection.setRequestProperty("Accept", "application/json")
        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("Komga respondeu ${connection.responseCode}")
        }
        return try {
            val body = connection.inputStream.bufferedReader().readText()
            val root = org.json.JSONObject(body)
            val content = root.optJSONArray("content") ?: return emptyList()
            val count = minOf(content.length(), MAX_FEED_ENTRIES)
            List(count) { i ->
                val o = content.getJSONObject(i)
                val id = o.optString("id", "")
                val meta = o.optJSONObject("metadata")
                val title = meta?.optString("title", "")?.ifBlank { "Edição ${i + 1}" } ?: "Edição ${i + 1}"
                Entry(title, id, acquisition = "$base/api/v2/books/$id/file")
            }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Baixa um arquivo com progresso 0..1 e cancelamento cooperativo.
     * Retorna o arquivo em `targetDir`; nunca executa nem abre nada sozinho.
     */
    suspend fun download(
        server: OpdsServer,
        fileUrl: String,
        targetDir: File,
        fileName: String,
        onProgress: (Float) -> Unit = {},
    ): File {
        targetDir.mkdirs()
        val safe = fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "opds-download" }
        var target: File
        do {
            target = File(
                targetDir,
                "${System.currentTimeMillis()}-${counter.getAndIncrement()}-$safe",
            )
        } while (target.exists())
        val connection = with(kotlinx.coroutines.Dispatchers.IO) {
            open(fileUrl, server, timeout = 15000)
        }
        if (connection.responseCode !in 200..299) {
            connection.disconnect()
            throw IllegalStateException("Download falhou (${connection.responseCode})")
        }
        val total = connection.contentLengthLong.takeIf { it > 0 }
        if (total != null && total > MAX_DOWNLOAD_BYTES) {
            connection.disconnect()
            throw IllegalStateException("Arquivo excede limite de segurança de ${MAX_DOWNLOAD_BYTES / (1024 * 1024)} MB")
        }
        try {
            with(kotlinx.coroutines.Dispatchers.IO) {
                connection.inputStream.use { input ->
                    FileOutputStream(target).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var done = 0L
                        while (true) {
                            if (!coroutineContext.isActive) {
                                throw kotlinx.coroutines.CancellationException("Download cancelado")
                            }
                            val read = input.read(buffer)
                            if (read <= 0) break
                            output.write(buffer, 0, read)
                            done += read
                            if (done > MAX_DOWNLOAD_BYTES) {
                                throw IllegalStateException("Download excedeu limite de segurança de ${MAX_DOWNLOAD_BYTES / (1024 * 1024)} MB")
                            }
                            if (total != null) {
                                onProgress((done.toFloat() / total).coerceIn(0f, 1f))
                            }
                        }
                    }
                }
            }
        } catch (error: Exception) {
            try { target.delete() } catch (_: Exception) {
            }
            throw error
        } finally {
            connection.disconnect()
        }
        onProgress(1f)
        return target
    }
}
