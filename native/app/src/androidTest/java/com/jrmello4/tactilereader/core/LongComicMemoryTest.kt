package com.jrmello4.tactilereader.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.os.Debug
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * Ensaio longo no aparelho: capítulo de 120 páginas longas (1080×2400).
 *
 * Mede o caminho do leitor — `ensurePage` para cada página e uma janela
 * deslizante de 5 bitmaps decodificados (a política da faixa: visível +
 * vizinhas) — com a mesma decodificação do Coil (`size(1080)`: maior lado
 * ≤ 1080). O que importa é o DELTA sobre a linha de base: uma janela
 * deslizante saudável não cresce com o tamanho do capítulo; o PSS absoluto
 * do processo de instrumentação (debug) não é o do app em release.
 */
@RunWith(AndroidJUnit4::class)
class LongComicMemoryTest {
    private val pageCount = 120
    private val windowSize = 5
    private val maxGrowthKb = 80 * 1024

    @Test
    fun slidingWindowOverLongChapterDoesNotGrowWithChapterLength() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "long-run-${UUID.randomUUID()}")
        root.mkdirs()
        LibraryDb.closeAll()
        val db = LibraryDb.open(File(root, "lib"), File(root, "imports"))

        val pagesDir = File(root, "chapter").apply { mkdirs() }
        repeat(pageCount) { index ->
            File(pagesDir, "%04d.jpg".format(index)).writeBytes(longPageJpeg(index))
        }
        val outcome = db.importPaths(listOf(pagesDir.absolutePath))
        assertTrue("diagnostics: ${outcome.diagnostics}", outcome.diagnostics.isEmpty())
        val pub = db.listPublications().single()
        assertEquals(pageCount, pub.pageCount)
        val pages = db.listPages(pub.id)

        // Linha de base "limpa": força coleta do que a geração de páginas deixou.
        settle()
        val baseline = pssKb()
        var peak = baseline
        val window = ArrayDeque<Bitmap>()
        for ((index, page) in pages.withIndex()) {
            val ensured = db.ensurePage(pub.id, page.id)
            val file = File(ensured.cachePath ?: error("página ${page.id} sem cache"))
            assertTrue("página ${index + 1} reconstruída", file.isFile)

            val bitmap = decodeLikeReader(file)
            window.addLast(bitmap)
            while (window.size > windowSize) {
                window.removeFirst().recycle()
            }
            if (index % 10 == 0 || index == pages.lastIndex) {
                peak = maxOf(peak, pssKb())
            }
        }
        val growthKb = peak - baseline
        window.forEach { it.recycle() }
        settle()

        val report = "PSS base=${baseline}KB pico=${peak}KB delta=${growthKb}KB limite=${maxGrowthKb}KB"
        android.util.Log.i("TactileMemory", report)
        assertTrue("Memória cresceu com o capítulo: $report", growthKb < maxGrowthKb)
    }

    /** Igual ao leitor: maior lado ≤ 1080 (o Coil usa `size(1080)`). */
    private fun decodeLikeReader(file: File): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= TARGET_MAX_SIDE ||
            bounds.outHeight / (sample * 2) >= TARGET_MAX_SIDE
        ) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val sampled = BitmapFactory.decodeFile(file.path, options)
            ?: error("falha ao decodificar ${file.name}")
        val longest = maxOf(sampled.width, sampled.height)
        if (longest <= TARGET_MAX_SIDE) {
            return sampled
        }
        val scale = TARGET_MAX_SIDE.toFloat() / longest
        val scaled = Bitmap.createScaledBitmap(
            sampled,
            (sampled.width * scale).toInt().coerceAtLeast(1),
            (sampled.height * scale).toInt().coerceAtLeast(1),
            true,
        )
        if (scaled !== sampled) {
            sampled.recycle()
        }
        return scaled
    }

    private fun settle() {
        repeat(3) {
            System.gc()
            Thread.sleep(120)
        }
    }

    private fun pssKb(): Int {
        val info = Debug.MemoryInfo()
        Debug.getMemoryInfo(info)
        return info.totalPss
    }

    /** Página longa com faixas e um bloco de texto — JPEG para tamanho realista. */
    private fun longPageJpeg(index: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(1080, 2400, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(12, 15, 20))
        val paint = android.graphics.Paint().apply { isAntiAlias = false }
        repeat(12) { band ->
            paint.color = Color.rgb(30 + band * 8, 40 + (index % 40), 60 + band * 5)
            canvas.drawRect(
                0f,
                band * 200f,
                1080f,
                band * 200f + 160f,
                paint,
            )
        }
        val text = android.graphics.Paint().apply {
            color = Color.WHITE
            textSize = 72f
            isAntiAlias = true
        }
        canvas.drawText("Página ${index + 1}", 60f, 1200f, text)
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
            bitmap.recycle()
            out.toByteArray()
        }
    }

    private companion object {
        /** Mesmo alvo do leitor: `size(1080)` no Coil. */
        const val TARGET_MAX_SIDE = 1080
    }
}
