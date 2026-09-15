package com.jrmello4.tactilereader.core

/**
 * Modelos do núcleo nativo em Kotlin puro. Substituem o marshalling JSON
 * que existia quando o núcleo era Rust (JNI). Os campos espelham as colunas
 * do SQLite (schema v6) para manter bancos existentes legíveis.
 */

/** Uma publicação na estante (resumo; páginas vêm sob demanda). */
data class Pub(
    val id: String,
    val title: String,
    val format: String,
    val pageCount: Int,
    val progress: Double,
    val isFavorite: Boolean,
    /** Página de onde a capa é desenhada; usada para garantir bytes sob demanda. */
    val coverPageId: String = "",
    /** Caminho de cache já materializado (pode vir vazio em import novo). */
    val coverSrc: String? = null,
    /** Capa personalizada válida (arquivo no cache derivado), se houver. */
    val customCoverPath: String? = null,
    /** Diagnóstico acumulado do núcleo (cache ausente, capa personalizada etc). */
    val diagnostic: String? = null,
    /** Última página lida (id), para retomar sem carregar todas as páginas. */
    val currentPageId: String? = null,
    /** Metadados do `ComicInfo.xml`, quando existirem. */
    val author: String? = null,
    val year: Int? = null,
    val genre: String? = null,
    /** Série declarada no `ComicInfo.xml`; melhora o agrupamento da estante. */
    val seriesName: String? = null,
    /** Última leitura (para a ordenação "Lidos"). */
    val lastReadAt: String? = null,
)

/** Uma página da faixa de leitura: metadados sempre, bytes sob demanda. */
data class ReaderPage(
    val id: String,
    val index: Int,
    val name: String,
    val width: Int,
    val height: Int,
    /** Caminho de cache já materializado (nulo/vazio = garantir sob demanda). */
    val cachePath: String? = null,
)

/** Progresso `{pageId, scrollRatio}` — a posição exata volta ao reabrir. */
data class ReaderProgress(
    val pageId: String,
    val scrollRatio: Double,
)

/** Marcador de página. */
data class Bookmark(
    val pageId: String,
    val label: String = "",
)

/** Resultado de uma importação em lote. */
data class ImportOutcome(
    val importedCount: Int,
    val diagnostics: List<String>,
    /** Verdadeiro quando o usuário cancelou no meio (o que entrou fica). */
    val cancelled: Boolean = false,
)

/** Progresso da importação para a estante não parecer travada. */
data class ImportProgress(
    val processed: Int,
    val total: Int,
    val currentName: String,
)

/** Info do cache derivado. */
data class CacheInfo(
    val usedBytes: Long = 0L,
    val maxBytes: Long = 0L,
    val entryCount: Int = 0,
)

/** Tamanho legível em PT-BR (Base 1024). */
fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return if (unit == 0) "$bytes B" else "%.1f %s".format(value, units[unit])
}
