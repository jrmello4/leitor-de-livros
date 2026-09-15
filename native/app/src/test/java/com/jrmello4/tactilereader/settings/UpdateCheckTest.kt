package com.jrmello4.tactilereader.settings

import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.UUID
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Prova a lógica pura do updater (sem rede real, sem aparelho): escolha
 * do asset assinado, leitura do version code, comparação e o download
 * com progresso, teto e descarte do parcial.
 */
class UpdateCheckTest {
    private fun asset(name: String) =
        UpdateCheck.Asset(name, "https://example.test/$name", 10_000)

    @Test
    fun picksSignedApkOverDebugAndOthers() {
        val assets = listOf(
            asset("tactile-reader-0.3.0-debug.apk"),
            asset("notas.txt"),
            asset("tactile-native-0.3.0.apk"),
        )
        assertEquals("tactile-native-0.3.0.apk", UpdateCheck.pickApkAsset(assets)?.name)
    }

    @Test
    fun skipsDebugWhenItIsTheOnlyApk() {
        assertNull(UpdateCheck.pickApkAsset(listOf(asset("app-debug.apk"))))
    }

    @Test
    fun picksNothingWithoutApk() {
        assertTrue(UpdateCheck.pickApkAsset(emptyList()) == null)
        assertTrue(UpdateCheck.pickApkAsset(listOf(asset("notas.txt"))) == null)
    }

    @Test
    fun parsesVersionCodeFromRollingBody() {
        val body = "Rolling build from `main`.\n\n- Version code: `123`\n- Commit: `abc`"
        assertEquals(123, UpdateCheck.parseVersionCode(body))
    }

    @Test
    fun versionCodeMissingReadsAsMinusOne() {
        assertEquals(-1, UpdateCheck.parseVersionCode("sem código aqui"))
    }

    @Test
    fun updateAvailableOnlyWhenPublishedIsNewer() {
        assertTrue(UpdateCheck.isUpdateAvailable(124, 123))
        assertTrue(!UpdateCheck.isUpdateAvailable(123, 123))
        assertTrue(!UpdateCheck.isUpdateAvailable(122, 123))
        assertTrue(!UpdateCheck.isUpdateAvailable(-1, 1))
    }

    @Test
    fun safeApkNameStripsTraversal() {
        assertEquals("update.apk", safeApkName("../../update.apk"))
        assertEquals("hq_nova.apk", safeApkName("hq nova.apk"))
        assertEquals("update.apk", safeApkName(""))
    }

    /**
     * HTTP mínimo em socket puro: `com.sun.net.httpserver` não está no
     * bootclasspath dos testes (android.jar). Uma requisição por teste.
     */
    private class FakeApkServer(body: ByteArray, declaredLength: Long) {
        private val payload = body
        private val length = declaredLength
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
                                    "Content-Length: $length\r\nConnection: close\r\n\r\n"
                                ).toByteArray(),
                        )
                        out.write(payload)
                        out.flush()
                    }
                } catch (_: Exception) {
                    // Fechamento no stop(): esperado.
                }
            }
        }

        fun stop() {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    @Test
    fun downloadsBytesWithProgress() {
        val bytes = ByteArray(50_000) { (it % 251).toByte() }
        val server = FakeApkServer(bytes, bytes.size.toLong())
        try {
            val target = File(System.getProperty("java.io.tmpdir"), "upd-${UUID.randomUUID()}.apk")
            var lastRead = 0L
            var lastTotal: Long? = null
            runBlocking {
                UpdateDownloader.download(server.url, target) { read, total ->
                    lastRead = read
                    lastTotal = total
                }
            }
            assertTrue(target.exists())
            assertEquals(bytes.size.toLong(), target.length())
            assertEquals(bytes.size.toLong(), lastRead)
            assertEquals(bytes.size.toLong(), lastTotal)
            assertTrue(target.readBytes().contentEquals(bytes))
            target.delete()
        } finally {
            server.stop()
        }
    }

    @Test
    fun rejectsPlainHttpOutsideLoopback() {
        var failed = false
        runBlocking {
            try {
                UpdateDownloader.download(
                    "http://example.test/app.apk",
                    File(System.getProperty("java.io.tmpdir"), "upd-${UUID.randomUUID()}.apk"),
                )
            } catch (_: IllegalArgumentException) {
                failed = true
            }
        }
        assertTrue(failed)
    }

    @Test
    fun rejectsOversizedContentLengthAndLeavesNoPartial() {
        val bytes = ByteArray(10) { 1 }
        // Declara 1 GB: o teto de 200 MB barra antes de ler.
        val server = FakeApkServer(bytes, 1024L * 1024 * 1024)
        try {
            val target = File(System.getProperty("java.io.tmpdir"), "upd-${UUID.randomUUID()}.apk")
            var failed = false
            runBlocking {
                try {
                    UpdateDownloader.download(server.url, target)
                } catch (_: Exception) {
                    failed = true
                }
            }
            assertTrue(failed)
            assertTrue(!target.exists())
        } finally {
            server.stop()
        }
    }
}
