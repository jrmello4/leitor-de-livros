package com.jrmello4.tactilereader.settings

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * Atualização in-app pela rolling `native-latest`: resolve o APK assinado
 * nos assets da release, baixa com progresso e cancelamento para o
 * sandbox (`updates/`) e entrega ao instalador do sistema via
 * FileProvider. Só HTTPS no GitHub, com teto de 200 MB; nenhum original
 * do usuário é tocado.
 */
object UpdateCheck {
    const val API = "https://api.github.com/repos/jrmello4/leitor-de-livros/releases/tags/native-latest"
    const val PAGE = "https://github.com/jrmello4/leitor-de-livros/releases/tag/native-latest"
    const val MAX_APK_BYTES = 200L * 1024 * 1024

    data class Asset(val name: String, val url: String, val size: Long)
    data class Release(val name: String, val body: String, val assets: List<Asset>)

    /** Baixa o JSON da release; I/O — chamar fora da main thread. */
    @Throws(IOException::class)
    fun fetchRelease(): Release {
        val connection = URL(API).openConnection() as HttpURLConnection
        connection.connectTimeout = 8000
        connection.readTimeout = 8000
        connection.setRequestProperty("Accept", "application/vnd.github+json")
        if (connection.responseCode != 200) {
            throw IOException("GitHub respondeu ${connection.responseCode}")
        }
        val body = connection.inputStream.bufferedReader().readText()
        val root = org.json.JSONObject(body)
        val assets = root.optJSONArray("assets")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val url = item.optString("browser_download_url", "")
                if (url.isBlank()) return@mapNotNull null
                Asset(
                    name = item.optString("name", "update.apk"),
                    url = url,
                    size = item.optLong("size", -1),
                )
            }
        }.orEmpty()
        return Release(
            name = root.optString("name", "native-latest").ifBlank { "native-latest" },
            body = root.optString("body", ""),
            assets = assets,
        )
    }

    /**
     * Escolhe o APK da release: prefere o assinado `tactile-native-*.apk`;
     * downloads de debug nunca entram sozinhos na fila de instalação.
     */
    fun pickApkAsset(assets: List<Asset>): Asset? {
        val apks = assets.filter { it.name.endsWith(".apk", ignoreCase = true) }
        return apks.firstOrNull {
            it.name.startsWith("tactile-native-", ignoreCase = true)
        } ?: apks.firstOrNull {
            !it.name.contains("-debug", ignoreCase = true)
        }
    }

    /** Lê `Version code: N` do corpo da rolling; -1 quando ausente. */
    fun parseVersionCode(body: String): Int {
        val match = Regex("""Version code:\s*`?(\d+)`?""").find(body)
        return match?.groupValues?.getOrNull(1)?.toIntOrNull() ?: -1
    }

    fun isUpdateAvailable(publishedCode: Int, installedCode: Int): Boolean =
        publishedCode > 0 && publishedCode > installedCode

    /** Orquestra consulta → resolução; todo erro vira mensagem em PT-BR. */
    fun check(installedCode: Int): UpdateState {
        return try {
            val release = fetchRelease()
            val asset = pickApkAsset(release.assets)
                ?: return UpdateState(message = "A release não tem APK para baixar. Tente de novo mais tarde.")
            val published = parseVersionCode(release.body)
            if (!isUpdateAvailable(published, installedCode)) {
                return UpdateState(
                    version = release.name,
                    message = "Você já está na versão mais recente.",
                )
            }
            UpdateState(
                version = release.name,
                apkUrl = asset.url,
                apkSizeBytes = asset.size.takeIf { it > 0 },
                apkName = asset.name,
                message = "Atualização disponível.",
            )
        } catch (error: IOException) {
            UpdateState(message = "Falha ao verificar: ${error.message ?: "sem rede"}")
        }
    }
}

/** Download com progresso e cancelamento cooperativo; parcial é descartado. */
object UpdateDownloader {
    @Throws(IOException::class)
    suspend fun download(
        apkUrl: String,
        target: File,
        maxBytes: Long = UpdateCheck.MAX_APK_BYTES,
        onProgress: (readBytes: Long, totalBytes: Long?) -> Unit = { _, _ -> },
    ): File = withContext(Dispatchers.IO) {
        requireSafeScheme(apkUrl)
        val connection = URL(apkUrl).openConnection() as HttpURLConnection
        connection.connectTimeout = 10000
        connection.readTimeout = 15000
        connection.instanceFollowRedirects = true
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IOException("download respondeu ${connection.responseCode}")
        }
        val total = connection.contentLengthLong.takeIf { it > 0 }
        if (total != null && total > maxBytes) {
            throw IOException("APK grande demais (${total / 1024 / 1024} MB)")
        }
        target.parentFile?.mkdirs()
        try {
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var read = 0L
                    while (true) {
                        ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        read += count
                        if (read > maxBytes) {
                            throw IOException("APK passou do limite de ${maxBytes / 1024 / 1024} MB")
                        }
                        onProgress(read, total)
                    }
                }
            }
        } catch (error: Exception) {
            target.delete()
            throw error
        }
        if (target.length() <= 0) {
            target.delete()
            throw IOException("download veio vazio")
        }
        target
    }
}

/** Entrega o APK ao instalador do sistema com grant único de leitura. */
object UpdateInstaller {
    fun authority(context: Context): String = "${context.packageName}.fileprovider"

    fun installIntent(context: Context, apk: File): Intent {
        val uri = FileProvider.getUriForFile(context, authority(context), apk)
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}

/** HTTPS em produção; HTTP aberto só em loopback (testes locais). */
internal fun requireSafeScheme(apkUrl: String) {
    val parsed = try {
        URL(apkUrl)
    } catch (_: Exception) {
        throw IllegalArgumentException("URL inválida")
    }
    val loopback = parsed.host.equals("localhost", ignoreCase = true) ||
        parsed.host == "127.0.0.1" || parsed.host == "::1" || parsed.host == "[::1]"
    require(parsed.protocol.equals("https", ignoreCase = true) || loopback) {
        "só HTTPS fora do aparelho"
    }
}

/** Nome seguro para o APK dentro de `updates/` (sem traversal). */
internal fun safeApkName(name: String): String {
    val base = name.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^A-Za-z0-9._-]"), "_")
    return base.ifBlank { "update.apk" }.takeLast(120)
}
