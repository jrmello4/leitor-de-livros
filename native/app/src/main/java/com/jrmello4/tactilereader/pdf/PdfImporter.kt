package com.jrmello4.tactilereader.pdf

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File

/**
 * A ponte `PdfRenderer` indexa metadados e renderiza somente a página pedida.
 * O original permanece a origem; PNGs aparecem no cache gerenciado pelo núcleo.
 * Limites: 512 páginas e 25 MP por página.
 */
object PdfImporter {
    private const val MAX_PAGES = 512
    private const val MAX_PIXELS_PER_PAGE = 25_000_000L
    private const val RENDER_WIDTH = 1080

    data class PageDimensions(val width: Int, val height: Int)

    /** Renderiza uma página sob demanda (capa, folio). */
    fun renderPage(pdfFile: File, pageIndex: Int, maxWidth: Int = RENDER_WIDTH): Bitmap {
        ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            return renderPage(fd, pageIndex, maxWidth)
        }
    }

    /** Índice leve de páginas; não cria PNGs nem retém os bytes renderizados. */
    fun inspect(descriptor: ParcelFileDescriptor): List<PageDimensions> {
        PdfRenderer(descriptor).use { renderer ->
            val count = renderer.pageCount
            if (count <= 0) throw IllegalStateException("PDF sem páginas")
            if (count > MAX_PAGES) {
                throw IllegalStateException("PDF com $count páginas excede o limite de $MAX_PAGES")
            }
            return List(count) { index ->
                renderer.openPage(index).use { page ->
                    val ratio = if (page.width > 0) RENDER_WIDTH.toFloat() / page.width else 1f
                    val height = (page.height * ratio).toInt().coerceIn(1, 20000)
                    if (RENDER_WIDTH.toLong() * height > MAX_PIXELS_PER_PAGE) {
                        throw IllegalStateException("Página $index excede o limite de pixels")
                    }
                    PageDimensions(RENDER_WIDTH, height)
                }
            }
        }
    }

    /** Renderiza uma única página a partir de um descritor aberto da origem. */
    fun renderPage(
        descriptor: ParcelFileDescriptor,
        pageIndex: Int,
        maxWidth: Int = RENDER_WIDTH,
    ): Bitmap {
        PdfRenderer(descriptor).use { renderer ->
            if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
                throw IllegalStateException("Página PDF fora do intervalo")
            }
            renderer.openPage(pageIndex).use { page ->
                val ratio = if (page.width > 0) maxWidth.toFloat() / page.width else 1f
                val height = (page.height * ratio).toInt().coerceIn(1, 20000)
                if (maxWidth.toLong() * height > MAX_PIXELS_PER_PAGE) {
                    throw IllegalStateException("Página $pageIndex excede o limite de pixels")
                }
                val bitmap = Bitmap.createBitmap(maxWidth, height, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(android.graphics.Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                return bitmap
            }
        }
    }

}
