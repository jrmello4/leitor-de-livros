package com.jrmello4.tactilereader.pdf

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileOutputStream

/**
 * PDF no Android via `PdfRenderer` do aparelho (API 21+).
 *
 * O núcleo não embarca runtime de PDF: esta ponte renderiza cada página do
 * PDF original em PNGs derivados sob `pdf-pages/<id>/` e devolve a pasta
 * para importar como conjunto de imagens — o mesmo fluxo de originais
 * somente-leitura dos outros formatos. Aceita arquivo local OU descritor do
 * SAF (`content://`), então o PDF nunca é copiado.
 *
 * Limites: 512 páginas, 25 MP por página, 512 MB derivados.
 */
object PdfImporter {
    private const val MAX_PAGES = 512
    private const val MAX_PIXELS_PER_PAGE = 25_000_000L
    private const val MAX_TOTAL_BYTES = 512L * 1024 * 1024
    private const val RENDER_WIDTH = 1080

    fun import(pdfFile: File, outputRoot: File): File? {
        if (!pdfFile.isFile) return null
        ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
            return import(descriptor, pdfFile.nameWithoutExtension, outputRoot)
        }
    }

    /** Renderiza direto do descritor (SAF): o original não é copiado. */
    fun import(
        descriptor: ParcelFileDescriptor,
        pdfName: String,
        outputRoot: File,
    ): File? {
        PdfRenderer(descriptor).use { renderer ->
            val count = renderer.pageCount
            if (count <= 0) {
                throw IllegalStateException("PDF sem páginas: $pdfName")
            }
            if (count > MAX_PAGES) {
                throw IllegalStateException("PDF com $count páginas excede o limite de $MAX_PAGES")
            }
            val id = "pdf-${pdfName.lowercase().replace(Regex("[^a-z0-9]+"), "-")}"
            val dir = File(outputRoot, id).apply { mkdirs() }
            var total = 0L
            for (index in 0 until count) {
                renderer.openPage(index).use { page ->
                    val ratio = if (page.width > 0) RENDER_WIDTH.toFloat() / page.width else 1f
                    val width = RENDER_WIDTH
                    val height = (page.height * ratio).toInt().coerceIn(1, 20000)
                    if (width.toLong() * height > MAX_PIXELS_PER_PAGE) {
                        throw IllegalStateException("Página $index excede o limite de pixels")
                    }
                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    try {
                        bitmap.eraseColor(android.graphics.Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        val target = File(dir, "%04d.png".format(index))
                        FileOutputStream(target).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.PNG, 90, out)
                        }
                        total += target.length()
                        if (total > MAX_TOTAL_BYTES) {
                            throw IllegalStateException("PDF excede o limite de 512 MB derivados")
                        }
                    } finally {
                        bitmap.recycle()
                    }
                }
            }
            return dir
        }
    }

    /** Renderiza uma página sob demanda (capa, folio). */
    fun renderPage(pdfFile: File, pageIndex: Int, maxWidth: Int = RENDER_WIDTH): Bitmap {
        ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { renderer ->
                if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
                    throw IllegalStateException("Página PDF fora do intervalo")
                }
                renderer.openPage(pageIndex).use { page ->
                    val ratio = if (page.width > 0) maxWidth.toFloat() / page.width else 1f
                    val bitmap = Bitmap.createBitmap(
                        maxWidth,
                        (page.height * ratio).toInt().coerceIn(1, 20000),
                        Bitmap.Config.ARGB_8888,
                    )
                    bitmap.eraseColor(android.graphics.Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    return bitmap
                }
            }
        }
    }
}
