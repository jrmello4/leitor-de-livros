package com.jrmello4.tactilereader.core

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Gera uma HQ CBZ mínima (2 páginas PNG desenhadas em código) para provar o
 * pipeline importar→listar sem fixtures externas, permissões ou rede.
 * Uso exclusivo de desenvolvimento/teste — nunca artwork real.
 */
object TestComic {
    fun generate(dir: File, name: String = "demo-hq.cbz"): File {
        dir.mkdirs()
        val target = File(dir, name)
        ZipOutputStream(FileOutputStream(target)).use { zip ->
            pagePng(1, "PAGINA 1", Color.rgb(21, 27, 35)).let { bytes ->
                zip.putNextEntry(ZipEntry("001.png"))
                zip.write(bytes)
                zip.closeEntry()
            }
            pagePng(2, "PAGINA 2", Color.rgb(64, 42, 18)).let { bytes ->
                zip.putNextEntry(ZipEntry("002.png"))
                zip.write(bytes)
                zip.closeEntry()
            }
        }
        return target
    }

    private fun pagePng(number: Int, label: String, background: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(800, 1200, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(background)
        val paint = Paint().apply {
            color = Color.WHITE
            textSize = 96f
            textAlign = Paint.Align.CENTER
            isAntiAlias = true
        }
        canvas.drawText(label, 400f, 580f, paint)
        paint.textSize = 48f
        canvas.drawText("nucleo tactile-core #$number", 400f, 660f, paint)
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }.also { bitmap.recycle() }
    }
}
