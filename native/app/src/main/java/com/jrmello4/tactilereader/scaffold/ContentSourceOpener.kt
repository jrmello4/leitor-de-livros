package com.jrmello4.tactilereader.scaffold

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import com.jrmello4.tactilereader.core.FileSourceOpener
import com.jrmello4.tactilereader.core.SourceOpener
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Fonte do núcleo no Android: caminho local ou URI `content://` do SAF.
 * Lê direto do original — sem copiar a HQ para dentro do app.
 */
class ContentSourceOpener(private val resolver: ContentResolver) : SourceOpener {
    override fun isAvailable(reference: String): Boolean {
        if (!reference.startsWith("content://")) {
            return File(reference).isFile
        }
        return try {
            resolver.openAssetFileDescriptor(Uri.parse(reference), "r")?.use { true } ?: false
        } catch (_: Exception) {
            false
        }
    }

    override fun sizeBytes(reference: String): Long {
        if (!reference.startsWith("content://")) {
            return File(reference).length()
        }
        return try {
            resolver.openAssetFileDescriptor(Uri.parse(reference), "r")?.use {
                it.length.coerceAtLeast(0L)
            } ?: 0L
        } catch (_: Exception) {
            0L
        }
    }

    override fun openStream(reference: String): InputStream {
        if (!reference.startsWith("content://")) {
            return FileInputStream(reference)
        }
        return resolver.openInputStream(Uri.parse(reference))
            ?: throw IOException("sem acesso à origem: $reference")
    }

    override fun displayName(reference: String): String? {
        if (!reference.startsWith("content://")) {
            return File(reference).name
        }
        return try {
            resolver.query(
                Uri.parse(reference),
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0)?.ifBlank { null } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    override fun localPath(reference: String): String? =
        if (reference.startsWith("content://")) null else FileSourceOpener.localPath(reference)
}

/** Mantém a fonte do processo: definida uma vez no [TactileApp]. */
object AppSources {
    @Volatile
    var opener: SourceOpener = FileSourceOpener
}
