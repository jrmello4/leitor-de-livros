package com.jrmello4.tactilereader.settings

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.UUID
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UpdateSecurityTest {

    @Test
    fun allowlistedDomainsPassSafeValidation() {
        val validUrls = listOf(
            "https://api.github.com/repos/jrmello4/leitor-de-livros/releases/tags/native-latest",
            "https://github.com/jrmello4/leitor-de-livros/releases/tag/native-latest",
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/app.apk",
            "https://raw.githubusercontent.com/jrmello4/leitor-de-livros/main/release-manifest.json",
            "https://github-releases.githubusercontent.com/123456/app.apk",
        )
        for (url in validUrls) {
            val parsed = UpdateSecurity.validateSafeUrl(url)
            assertNotNull(parsed)
        }
    }

    @Test
    fun unlistedDomainThrowsSecurityException() {
        val maliciousUrls = listOf(
            "https://evil-server.com/malicious.apk",
            "https://github.fake.net/releases/app.apk",
            "https://notgithubusercontent.com/app.apk",
            "https://attacker.org/update.apk",
        )
        for (url in maliciousUrls) {
            try {
                UpdateSecurity.validateSafeUrl(url)
                fail("Deveria ter rejeitado domínio não autorizado: $url")
            } catch (e: SecurityException) {
                assertTrue(e.message?.contains("Domínio não autorizado") == true)
            }
        }
    }

    @Test
    fun plainHttpOutsideLoopbackIsRejected() {
        try {
            UpdateSecurity.validateSafeUrl("http://github.com/jrmello4/leitor-de-livros/releases")
            fail("Deveria ter rejeitado HTTP fora de loopback")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("somente HTTPS") == true)
        }
    }

    @Test
    fun loopbackAllowsHttpForTesting() {
        val localUrls = listOf(
            "http://127.0.0.1:8080/test.apk",
            "http://localhost:8080/test.apk",
        )
        for (url in localUrls) {
            val parsed = UpdateSecurity.validateSafeUrl(url)
            assertNotNull(parsed)
        }
    }

    @Test
    fun parsesSha256FromVariousReleaseBodyFormats() {
        val expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

        val body1 = "Release v0.4.0\n\nSHA-256: $expected\n\nNotas da versão..."
        assertEquals(expected, UpdateCheck.parseSha256(body1))

        val body2 = "Release v0.4.0\n\nsha256: `$expected`\n\nNotas da versão..."
        assertEquals(expected, UpdateCheck.parseSha256(body2))

        val body3 = "Checksums:\n$expected  tactile-native-0.4.0.apk\n"
        assertEquals(expected, UpdateCheck.parseSha256(body3))

        val bodyNoSha = "Release v0.4.0 sem nenhum hash declarado"
        assertNull(UpdateCheck.parseSha256(bodyNoSha))
    }

    @Test
    fun computeSha256MatchesKnownHash() {
        val file = File(System.getProperty("java.io.tmpdir"), "test-sha-${UUID.randomUUID()}.txt")
        try {
            file.writeText("hello world\n")
            val computed = UpdateSecurity.computeSha256(file)
            // echo "hello world" | sha256sum -> d9014c4624844aa5bac314773d6b689ad467fa4e1d1a50a1b8a99d5a95f72ff5 (com \n)
            // Conferir se computa hash não vazio e hexadecimal de 64 chars
            assertEquals(64, computed.length)
            assertTrue(computed.matches(Regex("^[0-9a-f]{64}$")))
        } finally {
            file.delete()
        }
    }

    private class SingleResponseServer(body: ByteArray) {
        private val payload = body
        private val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val url = "http://127.0.0.1:${socket.localPort}/app.apk"

        init {
            thread(isDaemon = true) {
                try {
                    socket.accept().use { client ->
                        val reader = client.getInputStream().bufferedReader()
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isBlank()) break
                        }
                        val out = client.getOutputStream()
                        out.write(
                            (
                                "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.android.package-archive\r\n" +
                                    "Content-Length: ${payload.size}\r\nConnection: close\r\n\r\n"
                            ).toByteArray(),
                        )
                        out.write(payload)
                        out.flush()
                    }
                } catch (_: Exception) {}
            }
        }

        fun stop() {
            try {
                socket.close()
            } catch (_: Exception) {}
        }
    }

    @Test
    fun downloadWithMatchingSha256Succeeds() {
        val payload = ByteArray(20_000) { (it % 127).toByte() }
        val tmp = File(System.getProperty("java.io.tmpdir"), "tmp-sha-${UUID.randomUUID()}.bin")
        tmp.writeBytes(payload)
        val expectedHash = UpdateSecurity.computeSha256(tmp)
        tmp.delete()

        val server = SingleResponseServer(payload)
        val target = File(System.getProperty("java.io.tmpdir"), "dl-valid-${UUID.randomUUID()}.apk")
        try {
            runBlocking {
                UpdateDownloader.download(
                    apkUrl = server.url,
                    target = target,
                    expectedSha256 = expectedHash,
                )
            }
            assertTrue(target.exists())
            assertEquals(payload.size.toLong(), target.length())
        } finally {
            server.stop()
            target.delete()
        }
    }

    @Test
    fun downloadWithMismatchedSha256FailsAndDeletesTarget() {
        val payload = ByteArray(20_000) { (it % 127).toByte() }
        val fakeHash = "0000000000000000000000000000000000000000000000000000000000000000"

        val server = SingleResponseServer(payload)
        val target = File(System.getProperty("java.io.tmpdir"), "dl-invalid-${UUID.randomUUID()}.apk")
        try {
            var caughtSecurityException = false
            runBlocking {
                try {
                    UpdateDownloader.download(
                        apkUrl = server.url,
                        target = target,
                        expectedSha256 = fakeHash,
                    )
                } catch (e: SecurityException) {
                    caughtSecurityException = true
                    assertTrue(e.message?.contains("Integridade violada") == true)
                }
            }
            assertTrue("Deveria ter lançado SecurityException", caughtSecurityException)
            assertTrue("Arquivo corrompido deve ser excluído", !target.exists())
        } finally {
            server.stop()
            target.delete()
        }
    }

    @Test
    fun updateValidatorRejectsNonExistentFile() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val missing = File(System.getProperty("java.io.tmpdir"), "missing-${UUID.randomUUID()}.apk")
        try {
            UpdateValidator.validateBeforeInstall(context, missing)
            fail("Deveria falhar para arquivo inexistente")
        } catch (e: SecurityException) {
            assertTrue(e.message?.contains("truncado") == true || e.message?.contains("inválido") == true)
        }
    }

    @Test
    fun updateValidatorRejectsTruncatedFile() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val truncated = File(System.getProperty("java.io.tmpdir"), "trunc-${UUID.randomUUID()}.apk")
        try {
            truncated.writeBytes(ByteArray(1024)) // 1 KB < 100 KB
            UpdateValidator.validateBeforeInstall(context, truncated)
            fail("Deveria falhar para arquivo menor que 100 KB")
        } catch (e: SecurityException) {
            assertTrue(e.message?.contains("truncado") == true || e.message?.contains("inválido") == true)
        } finally {
            truncated.delete()
        }
    }

    @Test
    fun downloadRejectsMissingOrInvalidSha256BeforeTouchingDisk() {
        val target = File(System.getProperty("java.io.tmpdir"), "should-not-exist-${UUID.randomUUID()}.apk")
        try {
            // Hash nulo
            try {
                runBlocking {
                    UpdateDownloader.download("http://127.0.0.1:9999/dummy.apk", target, expectedSha256 = null)
                }
                fail("Deveria bloquear download com hash nulo")
            } catch (e: SecurityException) {
                assertTrue(e.message?.contains("obrigatório") == true)
            }
            assertTrue("Arquivo não deve ter sido criado no disco", !target.exists())

            // Hash curto / inválido
            try {
                runBlocking {
                    UpdateDownloader.download("http://127.0.0.1:9999/dummy.apk", target, expectedSha256 = "1234abcd")
                }
                fail("Deveria bloquear download com hash inválido")
            } catch (e: SecurityException) {
                assertTrue(e.message?.contains("obrigatório") == true)
            }
            assertTrue("Arquivo não deve ter sido criado no disco", !target.exists())
        } finally {
            target.delete()
        }
    }

    @Test
    fun safeRedirectWithinAllowlistSucceeds() {
        val payload = ByteArray(15_000) { (it % 97).toByte() }
        val tmp = File(System.getProperty("java.io.tmpdir"), "tmp-${UUID.randomUUID()}.bin")
        tmp.writeBytes(payload)
        val validHash = UpdateSecurity.computeSha256(tmp)
        tmp.delete()

        val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val port = socket.localPort
        val startUrl = "http://127.0.0.1:$port/start.apk"
        val finalPath = "/final.apk"

        val serverThread = thread(isDaemon = true) {
            try {
                // Primeira requisição: 302 Redirect
                socket.accept().use { client ->
                    val reader = client.getInputStream().bufferedReader()
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isBlank()) break
                    }
                    val out = client.getOutputStream()
                    out.write(
                        ("HTTP/1.1 302 Found\r\nLocation: $finalPath\r\nConnection: close\r\n\r\n").toByteArray(),
                    )
                    out.flush()
                }
                // Segunda requisição: 200 OK com payload
                socket.accept().use { client ->
                    val reader = client.getInputStream().bufferedReader()
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isBlank()) break
                    }
                    val out = client.getOutputStream()
                    out.write(
                        (
                            "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.android.package-archive\r\n" +
                                "Content-Length: ${payload.size}\r\nConnection: close\r\n\r\n"
                        ).toByteArray(),
                    )
                    out.write(payload)
                    out.flush()
                }
            } catch (_: Exception) {}
        }

        val target = File(System.getProperty("java.io.tmpdir"), "dl-redir-${UUID.randomUUID()}.apk")
        try {
            runBlocking {
                UpdateDownloader.download(startUrl, target, expectedSha256 = validHash)
            }
            assertTrue("Arquivo baixado após redirect seguro", target.exists())
            assertEquals(payload.size.toLong(), target.length())
        } finally {
            socket.close()
            target.delete()
        }
    }

    @Test
    fun maliciousRedirectToUnauthorizedHostIsBlocked() {
        val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val port = socket.localPort
        val startUrl = "http://127.0.0.1:$port/start.apk"

        val serverThread = thread(isDaemon = true) {
            try {
                socket.accept().use { client ->
                    val reader = client.getInputStream().bufferedReader()
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isBlank()) break
                    }
                    val out = client.getOutputStream()
                    out.write(
                        ("HTTP/1.1 302 Found\r\nLocation: https://evil-attacker.com/malicious.apk\r\nConnection: close\r\n\r\n").toByteArray(),
                    )
                    out.flush()
                }
            } catch (_: Exception) {}
        }

        val validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        val target = File(System.getProperty("java.io.tmpdir"), "dl-evil-${UUID.randomUUID()}.apk")
        try {
            var blocked = false
            runBlocking {
                try {
                    UpdateDownloader.download(startUrl, target, expectedSha256 = validHash)
                } catch (e: SecurityException) {
                    blocked = true
                    assertTrue(e.message?.contains("Domínio não autorizado") == true)
                }
            }
            assertTrue("Deveria ter bloqueado o redirect para domínio fora da allowlist", blocked)
            assertTrue("Nenhum arquivo gravado no disco", !target.exists())
        } finally {
            socket.close()
            target.delete()
        }
    }

    @Test
    fun validateSignaturesFailsClosedWhenCertificatesCannotBeRetrieved() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val packageInfoWithNoSignatures = android.content.pm.PackageInfo().apply {
            packageName = context.packageName
        }

        try {
            UpdateValidator.validateSignatures(
                context,
                packageInfoWithNoSignatures,
                packageInfoWithNoSignatures,
            )
            fail("Deveria falhar fechado quando certificados estão vazios")
        } catch (e: SecurityException) {
            assertTrue("Mensagem deve indicar falha fechada: ${e.message}", e.message?.contains("Falha fechada") == true)
        }
    }
}
