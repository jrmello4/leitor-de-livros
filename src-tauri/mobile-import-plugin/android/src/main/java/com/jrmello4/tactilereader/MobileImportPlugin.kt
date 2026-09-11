package com.jrmello4.tactilereader.mobileimport

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Android's Storage Access Framework returns content URIs, while the Rust
 * importer works with paths. This bridge keeps the user-granted URI permission
 * and imports a private read-only copy, leaving every original untouched.
 */
@TauriPlugin
class MobileImportPlugin(private val host: Activity) : Plugin(host) {
  companion object {
    private const val MAX_BATCH_BYTES = 64L * 1024L * 1024L * 1024L
  }

  @Command
  fun pickFiles(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    startActivityForResult(invoke, intent, "pickFilesResult")
  }

  @Command
  fun pickFolder(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    startActivityForResult(invoke, intent, "pickFolderResult")
  }

  @ActivityCallback
  fun pickFilesResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.resolve(JSObject().put("paths", JSArray()))
      return
    }
    try {
      val intent = result.data ?: throw IOException("No document was returned")
      val uris = buildList {
        intent.data?.let(::add)
        intent.clipData?.let { clip ->
          for (index in 0 until clip.itemCount) add(clip.getItemAt(index).uri)
        }
      }
      val batch = createImportDirectory("batch")
      val budget = CopyBudget(MAX_BATCH_BYTES)
      val paths = try {
        uris.mapIndexed { index, uri -> copyFile(uri, index, batch, budget) }
      } catch (error: Exception) {
        batch.deleteRecursively()
        throw error
      }
      invoke.resolve(JSObject().put("paths", JSArray.from(paths.toTypedArray())))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not import the selected file")
    }
  }

  @ActivityCallback
  fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
      invoke.resolve(JSObject().put("paths", JSArray()))
      return
    }
    try {
      val uri = result.data!!.data!!
      persistReadPermission(uri, result.data!!.flags)
      val source = DocumentFile.fromTreeUri(host, uri) ?: throw IOException("The selected folder is unavailable")
      val target = createImportDirectory("folder")
      try {
        copyTree(source, target, CopyBudget(MAX_BATCH_BYTES))
      } catch (error: Exception) {
        target.deleteRecursively()
        throw error
      }
      invoke.resolve(JSObject().put("paths", JSArray.from(arrayOf(target.absolutePath))))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not import the selected folder")
    }
  }

  private fun copyFile(uri: Uri, index: Int, targetDir: File, budget: CopyBudget): String {
    persistReadPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val displayName = DocumentFile.fromSingleUri(host, uri)?.name ?: "comic-$index"
    // Isolate duplicate basenames by directory, not by changing the title.
    val itemDir = File(targetDir, index.toString())
    if (!itemDir.mkdirs() && !itemDir.isDirectory) throw IOException("Could not prepare the selected file")
    val target = File(itemDir, safeName(displayName))
    try {
      host.contentResolver.openInputStream(uri)?.use { input ->
        FileOutputStream(target).use { output -> copyBounded(input, output, budget) }
      } ?: throw IOException("The selected file cannot be read")
    } catch (error: Exception) {
      target.delete()
      throw error
    }
    return target.absolutePath
  }

  private fun copyTree(source: DocumentFile, target: File, budget: CopyBudget) {
    for (child in source.listFiles()) {
      val destination = File(target, safeName(child.name ?: "item"))
      if (child.isDirectory) {
        destination.mkdirs()
        copyTree(child, destination, budget)
      } else if (child.isFile && isSupportedPublication(child.name)) {
        host.contentResolver.openInputStream(child.uri)?.use { input ->
          FileOutputStream(destination).use { output -> copyBounded(input, output, budget) }
        } ?: throw IOException("${child.name ?: "A file"} cannot be read")
      }
    }
  }

  private fun copyBounded(input: java.io.InputStream, output: FileOutputStream, budget: CopyBudget) {
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) return
      budget.consume(read.toLong())
      output.write(buffer, 0, read)
    }
  }

  private fun persistReadPermission(uri: Uri, resultFlags: Int) {
    val flags = resultFlags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    try {
      host.contentResolver.takePersistableUriPermission(uri, flags and Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
      // Some providers do not support persisted grants. The copy below is still
      // made while the picker grant is active, so importing remains reliable.
    }
  }

  private fun importRoot(): File = File(host.filesDir, "imports").also { it.mkdirs() }

  private fun createImportDirectory(prefix: String): File {
    val root = importRoot()
    return File(root, "$prefix-${System.currentTimeMillis()}-${System.nanoTime()}").also { it.mkdirs() }
  }

  private class CopyBudget(private val limit: Long) {
    private var copied = 0L

    fun consume(bytes: Long) {
      if (bytes < 0 || copied > limit - bytes) {
        throw IOException("Selected files exceed the 64 GiB temporary import limit")
      }
      copied += bytes
    }
  }

  private fun safeName(name: String): String = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")

  private fun isSupportedPublication(name: String?): Boolean {
    val extension = name?.substringAfterLast('.', "")?.lowercase() ?: return false
    return extension in setOf("cbz", "cbr", "rar", "pdf", "avif", "gif", "jpeg", "jpg", "png", "webp")
  }
}
