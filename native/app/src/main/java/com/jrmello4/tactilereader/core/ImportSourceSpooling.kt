package com.jrmello4.tactilereader.core

import java.io.File
import java.io.FileOutputStream

/** Spools a SAF stream only for the duration of formats that require file access. */
internal fun spoolSourceToTemp(db: LibraryDb, reference: String, extension: String): File {
    val tempDir = File(db.dataDir, "tmp").apply { mkdirs() }
    val target = File(tempDir, "spool-${System.nanoTime()}.$extension")
    var total = 0L
    db.opener.openStream(reference).use { input ->
        FileOutputStream(target).use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                total += read
                if (total > MAX_ARCHIVE_BYTES) {
                    target.delete()
                    error("$extension source exceeds the archive size safety limit")
                }
                output.write(buffer, 0, read)
            }
        }
    }
    return target
}
