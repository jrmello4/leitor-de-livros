package com.jrmello4.tactilereader.scaffold

import android.content.Context
import android.net.Uri
import com.jrmello4.tactilereader.core.LibraryDb
import com.jrmello4.tactilereader.settings.BackupManager
import java.io.File
import java.io.FileOutputStream

/** Coordinates local backup file staging and restoration outside the activity. */
internal object BackupImportCoordinator {
    fun copyToSandbox(context: Context, filesDir: File, uri: Uri, displayName: String?): String? {
        val name = displayName ?: "backup.json"
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val target = File(File(filesDir, "backups").apply { mkdirs() }, "import-$safe")
        return try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            } ?: return null
            target.absolutePath
        } catch (_: Exception) {
            target.delete()
            null
        }
    }

    fun restore(filesDir: File, path: String): BackupManager.RestoreSummary =
        BackupManager.import(
            LibraryDb.open(
                File(filesDir, "lib"),
                File(filesDir, "imports"),
                AppSources.opener,
            ),
            File(path),
        )
}
