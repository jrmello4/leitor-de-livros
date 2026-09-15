package com.jrmello4.tactilereader.core

import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/**
 * Abstrai de ONDE os bytes de um original vêm: caminho de arquivo local ou
 * URI de conteúdo (`content://`) do SAF. Assim o núcleo importa e reconstrói
 * páginas direto do original, sem copiar a HQ para dentro do app.
 */
interface SourceOpener {
    /** O original ainda está acessível? */
    fun isAvailable(reference: String): Boolean

    /** Tamanho em bytes (0 quando desconhecido). */
    fun sizeBytes(reference: String): Long

    fun openStream(reference: String): InputStream

    /** Nome de exibição (com extensão), quando conhecido. */
    fun displayName(reference: String): String?

    /**
     * Caminho local quando a referência é um arquivo de verdade; nulo para
     * `content://`. Leitores com acesso aleatório (ZipFile) usam isto quando
     * disponível e caem para streaming quando não.
     */
    fun localPath(reference: String): String? =
        reference.takeIf { !it.startsWith("content://") && File(it).isFile }?.let {
            File(it).absolutePath
        }
}

/** Implementação padrão: tudo é caminho de arquivo local (host e testes). */
object FileSourceOpener : SourceOpener {
    override fun isAvailable(reference: String): Boolean = File(reference).isFile

    override fun sizeBytes(reference: String): Long = File(reference).length()

    override fun openStream(reference: String): InputStream = FileInputStream(reference)

    override fun displayName(reference: String): String? = File(reference).name
}

/** Referência de origem para importar: caminho local ou URI do SAF. */
data class ImportSource(
    val reference: String,
    val displayName: String? = null,
) {
    /** Nome com extensão, usado para extensão, título e detecção de formato. */
    fun name(opener: SourceOpener): String =
        displayName?.takeIf { it.isNotBlank() }
            ?: opener.displayName(reference)
            ?: reference.substringAfterLast('/')
}
