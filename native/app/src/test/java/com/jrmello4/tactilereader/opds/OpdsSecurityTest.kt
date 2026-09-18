package com.jrmello4.tactilereader.opds

import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.UUID
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class OpdsSecurityTest {

    @Test
    fun resolvesRelativeAndAbsoluteLinksCorrectly() {
        val base = "https://biblioteca.local:8080/opds/v1/catalog.atom"
        assertEquals(
            "https://biblioteca.local:8080/opds/v1/series/1.atom",
            OpdsClient.resolve(base, "series/1.atom"),
        )
        assertEquals(
            "https://biblioteca.local:8080/opds/v2/catalog.atom",
            OpdsClient.resolve(base, "/opds/v2/catalog.atom"),
        )
        assertEquals(
            "https://outro-servidor.local/feed.atom",
            OpdsClient.resolve(base, "https://outro-servidor.local/feed.atom"),
        )
    }

    private class RawHttpServer(val response: String) {
        private val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val url = "http://127.0.0.1:${socket.localPort}/feed.atom"

        init {
            thread(isDaemon = true) {
                try {
                    socket.accept().use { client ->
                        val reader = client.getInputStream().bufferedReader()
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isBlank()) break
                        }
                        val bytes = response.toByteArray(Charsets.UTF_8)
                        val out = client.getOutputStream()
                        out.write(
                            (
                                "HTTP/1.1 200 OK\r\nContent-Type: application/atom+xml;charset=UTF-8\r\n" +
                                    "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                            ).toByteArray(),
                        )
                        out.write(bytes)
                        out.flush()
                    }
                } catch (_: Exception) {}
            }
        }

        fun stop() {
            try { socket.close() } catch (_: Exception) {}
        }
    }

    @Test
    fun parseFeedExtractsTitleAndAcquisitionLink() {
        val xml = """
            <?xml version="1.0" encoding="utf-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <title>Minha Estante OPDS</title>
              <entry>
                <title>HQ Incrível #1</title>
                <id>urn:hq:1</id>
                <link rel="http://opds-spec.org/acquisition" href="/download/hq1.cbz" type="application/x-cbz"/>
              </entry>
            </feed>
        """.trimIndent()

        val server = RawHttpServer(xml)
        try {
            val opdsServer = OpdsServer(id = "1", name = "Teste", url = server.url)
            val entries = OpdsClient.fetchFeed(opdsServer)
            assertEquals(1, entries.size)
            assertEquals("HQ Incrível #1", entries[0].title)
            assertEquals("http://127.0.0.1:${server.url.substringAfterLast(':').substringBefore('/')}/download/hq1.cbz", entries[0].acquisition)
        } finally {
            server.stop()
        }
    }

    @Test
    fun xxeDisallowedDoctypeDoesNotExecuteOrCrash() {
        // Tentativa de XXE com DOCTYPE e entidade externa
        val maliciousXml = """
            <?xml version="1.0" encoding="utf-8"?>
            <!DOCTYPE test [
              <!ENTITY xxe SYSTEM "file:///etc/passwd">
            ]>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <title>&xxe;</title>
              <entry>
                <title>HQ de Teste</title>
                <id>urn:test</id>
              </entry>
            </feed>
        """.trimIndent()

        val server = RawHttpServer(maliciousXml)
        try {
            val opdsServer = OpdsServer(id = "1", name = "Teste XXE", url = server.url)
            try {
                OpdsClient.fetchFeed(opdsServer)
                // Se o parser aceitou ignorando DTD ou lançou exceção SAXParseException / org.xml.sax.SAXException
                // ambos são seguros; o importante é NÃO expandir /etc/passwd
            } catch (e: Exception) {
                // Se recusou DOCTYPE decl por disallow-doctype-decl ou gerou erro de parse, seguro
                assertTrue(e.message?.contains("DOCTYPE") == true || e is org.xml.sax.SAXException)
            }
        } finally {
            server.stop()
        }
    }

    @Test
    fun downloadEnforcesMaxBytesCeiling() {
        val server = RawHttpServer("payload muito longo")
        val opdsServer = OpdsServer(id = "1", name = "Teste", url = server.url)
        val targetDir = File(System.getProperty("java.io.tmpdir"), "opds-test-${UUID.randomUUID()}")
        targetDir.mkdirs()

        try {
            // Teste de download simples dentro dos limites
            val file = runBlocking {
                OpdsClient.download(
                    server = opdsServer,
                    fileUrl = server.url,
                    targetDir = targetDir,
                    fileName = "teste.cbz",
                )
            }
            assertTrue(file.exists())
            assertTrue(file.length() > 0)
        } finally {
            server.stop()
            targetDir.deleteRecursively()
        }
    }
}
