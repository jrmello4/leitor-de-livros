package com.jrmello4.tactilereader.library

import com.jrmello4.tactilereader.core.Pub

/** Uma edição dentro da série, com o número extraído do título (`#01`). */
data class SeriesEdition(
    val pub: Pub,
    /** Número da edição; nulo quando o título não marca edição explícita. */
    val number: Int?,
    /** Mesma série + edição + páginas: sugestão de revisão manual. */
    val possibleDuplicate: Boolean = false,
)

/** Uma série na estante: edições em ordem numérica, nunca mescladas. */
data class SeriesGroup(
    val key: String,
    val title: String,
    val editions: List<SeriesEdition>,
)

private val ISSUE_MARK = Regex("#\\s*(\\d{1,4})")

private fun normalizeKey(raw: String): String =
    raw.lowercase().trim().split(Regex("\\s+")).joinToString(" ")

/**
 * Agrupa publicações por série. A chave ignora maiúsculas e espaços; só o
 * marcador explícito `#NN` abre número de edição (números legítimos como
 * em `2000 AD` nunca viram edição). Edições ordenadas numericamente;
 * entradas sem marcador viram grupo próprio de uma edição. Nada é
 * removido ou combinado: duplicatas viram só um hint.
 */
fun groupBySeries(pubs: List<Pub>): List<SeriesGroup> {
    val groups = linkedMapOf<String, MutableList<SeriesEdition>>()
    val titles = mutableMapOf<String, String>()
    for (pub in pubs) {
        val match = ISSUE_MARK.find(pub.title)
        val rawName = if (match != null) pub.title.substring(0, match.range.first) else pub.title
        val key = normalizeKey(rawName).ifBlank { normalizeKey(pub.title) }
        titles.putIfAbsent(key, rawName.trim().ifBlank { pub.title })
        groups.getOrPut(key) { mutableListOf() }.add(
            SeriesEdition(pub, match?.groupValues?.get(1)?.toIntOrNull()),
        )
    }
    return groups.map { (key, editions) ->
        val ordered = editions.sortedWith(compareBy<SeriesEdition> { it.number == null }.thenBy { it.number })
        val dupCounts = ordered
            .filter { it.number != null }
            .groupingBy { it.number to it.pub.pageCount }
            .eachCount()
        SeriesGroup(
            key = key,
            title = titles[key] ?: key,
            editions = ordered.map { edition ->
                val dup = edition.number != null &&
                    (dupCounts[edition.number to edition.pub.pageCount] ?: 0) > 1
                edition.copy(possibleDuplicate = dup)
            },
        )
    }.sortedBy { it.title.lowercase() }
}
