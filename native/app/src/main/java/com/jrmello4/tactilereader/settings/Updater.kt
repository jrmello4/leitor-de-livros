package com.jrmello4.tactilereader.settings

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * Atualização in-app segura pela rolling release `native-latest`.
 *
 * Princípios de segurança rigorosos:
 * 1. HTTPS obrigatório e estrito em todos os estágios (HTTP permitido somente em loopback nos testes locais).
 * 2. Allowlist estrita de domínios permitidos (inclusive em TODOS os redirects).
 * 3. Validação de integridade SHA-256 (a partir do manifesto/release body).
 * 4. Validação pré-instalação no dispositivo:
 *    - Rejeição de arquivo truncado/corrompido.
 *    - Validação de identificador do pacote (Package Name).
 *    - Rejeição estrita de downgrade (Version Code).
 *    - Validação de certificados de assinatura (Signature / Signing Certificate).
 */
object UpdateSecurity {
    val ALLOWED_HOSTS = setOf(
        "github.com",
        "api.github.com",
        "raw.githubusercontent.com",
        "objects.githubusercontent.com",
        "github-releases.githubusercontent.com",
        "githubusercontent.com",
    )

    fun isLoopback(host: String): Boolean {
        return host.equals("localhost", ignoreCase = true) ||
            host == "127.0.0.1" || host == "::1" || host == "[::1]"
    }

    /** Verifica se uma string representa um hash SHA-256 válido (64 caracteres hexadecimais). */
    fun isValidSha256(sha: String?): Boolean {
        if (sha == null || sha.length != 64) return false
        return sha.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }
    }

    /** Valida esquema e domínio contra allowlist estrita, sem tolerância a bypass. */
    fun validateSafeUrl(urlStr: String): URL {
        val parsed = try {
            URL(urlStr)
        } catch (_: Exception) {
            throw IllegalArgumentException("URL inválida: $urlStr")
        }
        val host = parsed.host.lowercase()
        val protocol = parsed.protocol.lowercase()

        val isLocal = isLoopback(host)
        if (!isLocal && protocol != "https") {
            throw IllegalArgumentException("Protocolo inseguro: somente HTTPS é permitido fora de loopback")
        }

        if (!isLocal && host !in ALLOWED_HOSTS && !ALLOWED_HOSTS.any { host.endsWith(".$it") }) {
            throw SecurityException("Domínio não autorizado na allowlist de atualização: $host")
        }

        return parsed
    }

    /** Calcula o digest SHA-256 de um arquivo em formato hexadecimal minúsculo. */
    fun computeSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(16384)
            while (true) {
                val read = stream.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}

object UpdateCheck {
    const val API = "https://api.github.com/repos/jrmello4/leitor-de-livros/releases/tags/native-latest"
    const val PAGE = "https://github.com/jrmello4/leitor-de-livros/releases/tag/native-latest"
    const val MAX_APK_BYTES = 200L * 1024 * 1024

    data class Asset(val name: String, val url: String, val size: Long)
    data class Release(val name: String, val body: String, val assets: List<Asset>, val sha256: String? = null)

    /** Baixa o JSON da release via HTTPS auditado. */
    @Throws(IOException::class)
    fun fetchRelease(apiUrl: String = API): Release {
        val targetUrl = UpdateSecurity.validateSafeUrl(apiUrl)
        val connection = targetUrl.openConnection() as HttpURLConnection
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

        val releaseBody = root.optString("body", "")
        val sha = parseSha256(releaseBody)

        return Release(
            name = root.optString("name", "native-latest").ifBlank { "native-latest" },
            body = releaseBody,
            assets = assets,
            sha256 = sha,
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

    /** Lê `Version code: N` do corpo da release; -1 quando ausente. */
    fun parseVersionCode(body: String): Int {
        val match = Regex("""Version code:\s*`?(\d+)`?""").find(body)
        return match?.groupValues?.getOrNull(1)?.toIntOrNull() ?: -1
    }

    /** Extrai hash SHA-256 do corpo da release se declarado. */
    fun parseSha256(body: String): String? {
        val match = Regex("""(?:SHA-?256|sha256):\s*`?([a-fA-F0-9]{64})`?""").find(body)
            ?: Regex("""`?([a-fA-F0-9]{64})`?\s+[\w.-]+\.apk""").find(body)
        return match?.groupValues?.getOrNull(1)?.lowercase()
    }

    fun isUpdateAvailable(publishedCode: Int, installedCode: Int): Boolean =
        publishedCode > 0 && publishedCode > installedCode

    /** Orquestra consulta → resolução com verificação de segurança. */
    fun check(installedCode: Int, apiUrl: String = API): UpdateState {
        return try {
            val release = fetchRelease(apiUrl)
            val asset = pickApkAsset(release.assets)
                ?: return UpdateState(message = "A release não tem APK para baixar. Tente de novo mais tarde.")
            val published = parseVersionCode(release.body)
            if (!isUpdateAvailable(published, installedCode)) {
                return UpdateState(
                    version = release.name,
                    message = "Você já está na versão mais recente.",
                )
            }
            val sha = release.sha256
            if (sha.isNullOrBlank() || !UpdateSecurity.isValidSha256(sha)) {
                return UpdateState(
                    version = release.name,
                    message = "Atualização bloqueada por segurança: release sem hash SHA-256 válido.",
                )
            }
            UpdateState(
                version = release.name,
                apkUrl = asset.url,
                apkSizeBytes = asset.size.takeIf { it > 0 },
                apkName = asset.name,
                expectedSha256 = sha,
                message = "Atualização disponível.",
            )
        } catch (error: IOException) {
            UpdateState(message = "Falha ao verificar: ${error.message ?: "sem rede"}")
        } catch (error: SecurityException) {
            UpdateState(message = "Segurança: ${error.message}")
        }
    }
}

/** Download seguro com limite de tamanho, validação de redirects e cálculo de SHA-256. */
object UpdateDownloader {
    @Throws(IOException::class)
    suspend fun download(
        apkUrl: String,
        target: File,
        maxBytes: Long = UpdateCheck.MAX_APK_BYTES,
        expectedSha256: String?,
        onProgress: (readBytes: Long, totalBytes: Long?) -> Unit = { _, _ -> },
    ): File = withContext(Dispatchers.IO) {
        if (expectedSha256.isNullOrBlank() || !UpdateSecurity.isValidSha256(expectedSha256)) {
            throw SecurityException("Hash SHA-256 obrigatório ausente ou inválido. Download bloqueado antes de gravar em disco.")
        }
        var currentUrl = apkUrl
        var hops = 0
        val maxHops = 5

        var connection: HttpURLConnection
        while (true) {
            val safeUrl = UpdateSecurity.validateSafeUrl(currentUrl)
            connection = safeUrl.openConnection() as HttpURLConnection
            connection.connectTimeout = 10000
            connection.readTimeout = 15000
            connection.instanceFollowRedirects = false

            val status = connection.responseCode
            if (status in 300..399) {
                hops++
                if (hops > maxHops) {
                    throw IOException("Muitos redirecionamentos ($hops)")
                }
                val location = connection.getHeaderField("Location")
                    ?: throw IOException("Redirecionamento $status sem cabeçalho Location")
                val nextUrl = URL(safeUrl, location).toString()
                connection.disconnect()
                currentUrl = nextUrl
                continue
            }
            break
        }

        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
            throw IOException("Download respondeu ${connection.responseCode}")
        }

        val total = connection.contentLengthLong.takeIf { it > 0 }
        if (total != null && total > maxBytes) {
            throw IOException("APK grande demais (${total / 1024 / 1024} MB)")
        }

        target.parentFile?.mkdirs()
        val digest = MessageDigest.getInstance("SHA-256")

        try {
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(16384)
                    var read = 0L
                    while (true) {
                        ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
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
        } finally {
            connection.disconnect()
        }

        if (target.length() <= 0) {
            target.delete()
            throw IOException("Download veio vazio")
        }

        val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
        if (!expectedSha256.equals(actualSha256, ignoreCase = true)) {
            target.delete()
            throw SecurityException("Integridade violada: SHA-256 esperado ($expectedSha256) diferente do obtido ($actualSha256)")
        }

        target
    }
}

/**
 * Validação prévia à instalação no Android:
 * Garante que o arquivo é um APK íntegro, corresponde ao mesmo packageName,
 * não tenta downgrade de versionCode e possui assinatura criptográfica válida.
 * Falha estritamente fechado (fail-closed) se certificados não puderem ser validados.
 */
object UpdateValidator {
    @Throws(SecurityException::class)
    fun validateBeforeInstall(context: Context, apkFile: File) {
        if (!apkFile.exists() || apkFile.length() < 100_000L) {
            throw SecurityException("Arquivo de atualização inválido ou truncado.")
        }

        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }

        val archiveInfo = pm.getPackageArchiveInfo(apkFile.absolutePath, flags)
            ?: throw SecurityException("Pacote APK inválido ou corrompido.")

        // 1. Verificação de identidade do pacote
        if (archiveInfo.packageName != context.packageName) {
            throw SecurityException("Pacote incorreto: esperado '${context.packageName}', recebido '${archiveInfo.packageName}'.")
        }

        // 2. Prevenção de downgrade de versão
        val installedPackageInfo = try {
            pm.getPackageInfo(context.packageName, 0)
        } catch (e: Exception) {
            null
        } ?: throw SecurityException("Falha fechada: não foi possível obter informações do aplicativo instalado.")

        val installedCode = getVersionCode(installedPackageInfo)
        val archiveCode = getVersionCode(archiveInfo)
        if (archiveCode <= installedCode) {
            throw SecurityException("Downgrade rejeitado: versão instalada ($installedCode) é maior ou igual à versão baixada ($archiveCode).")
        }

        // 3. Validação de assinatura / certificado (falha fechada)
        validateSignatures(context, installedPackageInfo, archiveInfo)
    }

    private fun getVersionCode(packageInfo: PackageInfo): Long {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }
    }

    fun validateSignatures(context: Context, installedInfo: PackageInfo, archiveInfo: PackageInfo) {
        val installedSignatures = getSignatures(context, context.packageName)
        if (installedSignatures.isEmpty()) {
            throw SecurityException("Falha fechada: não foi possível obter os certificados do aplicativo instalado.")
        }
        val archiveSignatures = getArchiveSignatures(archiveInfo)
        if (archiveSignatures.isEmpty()) {
            throw SecurityException("Falha fechada: não foi possível obter os certificados do pacote APK baixado.")
        }

        val match = installedSignatures.any { inst ->
            archiveSignatures.any { arc -> inst.contentEquals(arc) }
        }
        if (!match) {
            throw SecurityException("Assinatura do APK baixado não corresponde ao certificado do aplicativo instalado.")
        }
    }

    fun getSignatures(context: Context, packageName: String): List<ByteArray> {
        val pm = context.packageManager
        val sigs = mutableListOf<ByteArray>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                info.signingInfo?.apkContentsSigners?.forEach { sigs.add(it.toByteArray()) }
                if (sigs.isEmpty()) {
                    info.signingInfo?.signingCertificateHistory?.forEach { sigs.add(it.toByteArray()) }
                }
            } catch (_: Exception) {}
        }
        if (sigs.isEmpty()) {
            try {
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                info.signatures?.forEach { sigs.add(it.toByteArray()) }
            } catch (_: Exception) {}
        }
        return sigs
    }

    fun getArchiveSignatures(archiveInfo: PackageInfo): List<ByteArray> {
        val sigs = mutableListOf<ByteArray>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            archiveInfo.signingInfo?.apkContentsSigners?.forEach { sigs.add(it.toByteArray()) }
            if (sigs.isEmpty()) {
                archiveInfo.signingInfo?.signingCertificateHistory?.forEach { sigs.add(it.toByteArray()) }
            }
        }
        if (sigs.isEmpty()) {
            @Suppress("DEPRECATION")
            archiveInfo.signatures?.forEach { sigs.add(it.toByteArray()) }
        }
        return sigs
    }
}

/** Entrega o APK ao instalador do sistema após validação estrita. */
object UpdateInstaller {
    fun authority(context: Context): String = "${context.packageName}.fileprovider"

    fun installIntent(context: Context, apk: File): Intent {
        UpdateValidator.validateBeforeInstall(context, apk)
        val uri = FileProvider.getUriForFile(context, authority(context), apk)
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}

/** Compatibilidade para chamadas internas legadas. */
internal fun requireSafeScheme(apkUrl: String) {
    UpdateSecurity.validateSafeUrl(apkUrl)
}

/** Nome seguro para o APK dentro de `updates/` (sem traversal). */
internal fun safeApkName(name: String): String {
    val base = name.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^A-Za-z0-9._-]"), "_")
    return base.ifBlank { "update.apk" }.takeLast(120)
}
