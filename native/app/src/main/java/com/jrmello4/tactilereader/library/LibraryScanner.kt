package com.jrmello4.tactilereader.library

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.jrmello4.tactilereader.core.ImportSource
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Scanner de origens: arquivos locais já copiados em versões antigas,
 * pastas SAF autorizadas e candidatos para reimportação.
 *
 * Com a leitura direta de `content://`, a pasta escolhida NÃO é mais copiada:
 * a varredura devolve as referências (URI + nome) para o núcleo importar.
 */
object LibraryScanner {
    private val SUPPORTED = setOf(
        "cbz", "cbr", "zip", "7z", "rar", "pdf",
        "png", "jpg", "jpeg", "webp", "gif", "avif",
    )

    /** Resultado da varredura de uma pasta SAF. */
    data class SafScanResult(
        val sources: List<ImportSource>,
        val accessDenied: Boolean,
        val truncated: Boolean,
    )

    fun isSupportedFile(name: String): Boolean {
        val extension = name.substringAfterLast('.', "").lowercase()
        return extension in SUPPORTED
    }

    /**
     * Percorre a pasta autorizada (recursivo, com teto) e devolve as origens
     * suportadas sem copiar nada. `accessDenied` separa "sem acesso" de "vazia".
     */
    suspend fun collectSafSources(
        context: Context,
        treeUri: Uri,
        maxFiles: Int = 500,
        shouldCancel: () -> Boolean = { false },
    ): SafScanResult = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        try {
            resolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        } catch (_: SecurityException) {
            // Melhor-esforço: a concessão de sessão continua valendo agora.
        }
        try {
            context.getSharedPreferences("tactile-folders", Context.MODE_PRIVATE)
                .edit()
                .putString("folder-${treeUri.hashCode()}", treeUri.toString())
                .apply()
        } catch (_: Exception) {
        }

        val out = mutableListOf<ImportSource>()
        var truncated = false
        val stack = ArrayDeque<String>()
        try {
            stack.add(DocumentsContract.getTreeDocumentId(treeUri))
        } catch (_: Exception) {
            return@withContext SafScanResult(emptyList(), accessDenied = true, truncated = false)
        }
        var rootQueried = false
        var rootQueryFailed = false
        while (stack.isNotEmpty()) {
            if (shouldCancel()) break
            val parentId = stack.removeLast()
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
            val rows = mutableListOf<Triple<String, String, String?>>()
            try {
                val cursor = resolver.query(
                    childrenUri,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                    ),
                    null,
                    null,
                    null,
                )
                if (cursor == null) {
                    if (!rootQueried) rootQueryFailed = true
                } else {
                    cursor.use {
                        while (it.moveToNext()) {
                            rows.add(
                                Triple(
                                    it.getString(0) ?: continue,
                                    it.getString(1) ?: continue,
                                    it.getString(2),
                                ),
                            )
                        }
                    }
                }
            } catch (_: Exception) {
                if (!rootQueried) rootQueryFailed = true
            }
            rootQueried = true
            for ((docId, name, mime) in rows) {
                if (shouldCancel()) break
                if (out.size >= maxFiles) {
                    truncated = true
                    break
                }
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    if (stack.size < 64) stack.add(docId)
                    continue
                }
                if (!isSupportedFile(name)) {
                    continue
                }
                val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
                out.add(ImportSource(docUri.toString(), name))
            }
        }
        SafScanResult(
            sources = out,
            accessDenied = out.isEmpty() && rootQueryFailed,
            truncated = truncated,
        )
    }

    /** Fontes SAF já autorizadas, para a revarredura pegar novidades. */
    fun persistedTreeUris(context: Context): List<Uri> {
        val prefs = context.getSharedPreferences("tactile-folders", Context.MODE_PRIVATE)
        return prefs.all.values.mapNotNull { value ->
            (value as? String)?.let { runCatching { Uri.parse(it) }.getOrNull() }
        }
    }

    fun localFolders(filesDir: File): List<FolderEntry> {
        val out = mutableListOf<FolderEntry>()
        val imports = File(filesDir, "imports")
        if (imports.isDirectory) {
            val files = imports.listFiles()?.filter { it.isFile } ?: emptyList()
            out.add(FolderEntry("imports", files.size, imports.absolutePath))
        }
        val pdf = File(filesDir, "pdf-pages")
        if (pdf.isDirectory) {
            val dirs = pdf.listFiles()?.filter { it.isDirectory } ?: emptyList()
            out.add(FolderEntry("pdf-pages", dirs.size, pdf.absolutePath))
        }
        return out
    }

    fun safFolders(context: Context): List<FolderEntry> {
        return persistedTreeUris(context).map { uri ->
            val name = try {
                DocumentsContract.getTreeDocumentId(uri)
                    ?.substringAfterLast(':')
                    ?.ifBlank { "pasta SAF" }
                    ?: "pasta SAF"
            } catch (_: Exception) {
                "pasta SAF"
            }
            FolderEntry("SAF · $name", -1, uri.toString())
        }
    }

    fun allFolders(context: Context, filesDir: File): List<FolderEntry> {
        return localFolders(filesDir) + safFolders(context)
    }

    /** Arquivos locais novos para importar (cópias legadas; o núcleo deduplica). */
    suspend fun collectLocalCandidates(filesDir: File): List<String> = withContext(Dispatchers.IO) {
        val out = mutableListOf<String>()
        val imports = File(filesDir, "imports")
        imports.listFiles()?.forEach { file ->
            if (file.isFile && SUPPORTED.contains(file.extension.lowercase()) &&
                !file.extension.equals("pdf", ignoreCase = true)
            ) {
                out.add(file.absolutePath)
            }
        }
        File(filesDir, "pdf-pages").listFiles()
            ?.filter { it.isDirectory }
            ?.forEach { dir -> out.add(dir.absolutePath) }
        out
    }
}
