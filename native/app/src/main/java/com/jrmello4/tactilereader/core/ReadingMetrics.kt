package com.jrmello4.tactilereader.core

import kotlin.math.ceil

/**
 * Representa uma sessão ou intervalo de leitura registrado pelo aplicativo.
 *
 * @property durationMillis Duração total transcorrida na sessão em milissegundos.
 * @property pagesRead Quantidade de páginas avançadas nesta sessão.
 * @property pauseMillis Tempo de pausa ou inatividade acumulado em milissegundos.
 */
data class ReadingSession(
    val durationMillis: Long,
    val pagesRead: Int,
    val pauseMillis: Long = 0L,
)

/**
 * Agregação de velocidade de leitura calculada a partir de sessões válidas.
 *
 * @property totalEffectiveDurationMs Duração total útil (sem pausas) em milissegundos.
 * @property totalPagesRead Total de páginas lidas consideradas no cálculo.
 * @property pagesPerMinute Velocidade média em páginas por minuto (PPM).
 */
data class ReadingSpeed(
    val totalEffectiveDurationMs: Long,
    val totalPagesRead: Int,
    val pagesPerMinute: Double,
)

/**
 * Métricas e cálculos de estimativa de leitura do leitor (Revenue-Centric Design / Calm Tech).
 * API em Kotlin puro, sem dependências do Android SDK, testável na JVM.
 */
object ReadingMetrics {
    /**
     * Limite padrão de inatividade admitido por página lida: 2 minutos (120.000 ms).
     * Qualquer tempo líquido que exceda esse teto por página é considerado pausa longa e descartado.
     */
    const val DEFAULT_MAX_PAUSE_THRESHOLD_MS: Long = 120_000L

    /**
     * Calcula a duração efetiva em milissegundos de uma sessão,
     * subtraindo pausas explícitas e descartando tempo excedente de inatividade longa.
     *
     * @param session Sessão de leitura a ser avaliada.
     * @param maxPauseThresholdMs Limite máximo admitido por página lida.
     */
    fun effectiveDuration(
        session: ReadingSession,
        maxPauseThresholdMs: Long = DEFAULT_MAX_PAUSE_THRESHOLD_MS,
    ): Long {
        if (session.durationMillis <= 0L || session.pagesRead <= 0) return 0L
        val explicitPause = session.pauseMillis.coerceAtLeast(0L)
        val rawEffective = (session.durationMillis - explicitPause).coerceAtLeast(0L)
        if (rawEffective == 0L) return 0L

        if (maxPauseThresholdMs > 0L && maxPauseThresholdMs < Long.MAX_VALUE) {
            val maxAllowed = maxPauseThresholdMs.saturatingMultiply(session.pagesRead.toLong())
            return rawEffective.coerceAtMost(maxAllowed)
        }
        return rawEffective
    }

    private fun Long.saturatingMultiply(other: Long): Long {
        return try {
            Math.multiplyExact(this, other)
        } catch (_: ArithmeticException) {
            Long.MAX_VALUE
        }
    }

    /**
     * Calcula a velocidade média em páginas por minuto (PPM) a partir de uma lista de sessões.
     * Sessões com duração ou contagem de páginas inválidas (<= 0) são descartadas.
     */
    fun calculateSpeed(
        sessions: List<ReadingSession>,
        maxPauseThresholdMs: Long = DEFAULT_MAX_PAUSE_THRESHOLD_MS,
    ): ReadingSpeed {
        if (sessions.isEmpty()) {
            return ReadingSpeed(0L, 0, 0.0)
        }
        var totalMs = 0L
        var totalPages = 0
        for (session in sessions) {
            val eff = effectiveDuration(session, maxPauseThresholdMs)
            if (eff > 0L && session.pagesRead > 0) {
                totalMs += eff
                totalPages += session.pagesRead
            }
        }
        if (totalMs <= 0L || totalPages <= 0) {
            return ReadingSpeed(0L, 0, 0.0)
        }
        val minutes = totalMs.toDouble() / 60_000.0
        val ppm = if (minutes > 0.0) totalPages.toDouble() / minutes else 0.0
        return ReadingSpeed(
            totalEffectiveDurationMs = totalMs,
            totalPagesRead = totalPages,
            pagesPerMinute = ppm,
        )
    }

    /**
     * Sobrecarga de conveniência para calcular a velocidade de uma sessão individual.
     */
    fun calculateSpeed(
        session: ReadingSession,
        maxPauseThresholdMs: Long = DEFAULT_MAX_PAUSE_THRESHOLD_MS,
    ): ReadingSpeed = calculateSpeed(listOf(session), maxPauseThresholdMs)

    /**
     * Estima os minutos restantes com base na quantidade de páginas que faltam e na velocidade em PPM.
     *
     * @return 0 se já terminou ou páginas restantes <= 0.
     * @return null se a velocidade for desconhecida (<= 0.0, NaN ou Infinita).
     * @return Minutos inteiros arredondados para cima (no mínimo 1 se ainda restarem páginas).
     */
    fun estimateRemainingMinutes(
        pagesRemaining: Int,
        pagesPerMinute: Double,
    ): Int? {
        if (pagesRemaining <= 0) return 0
        if (pagesPerMinute <= 0.0 || pagesPerMinute.isNaN() || pagesPerMinute.isInfinite()) {
            return null
        }
        val minutes = pagesRemaining.toDouble() / pagesPerMinute
        return ceil(minutes).toInt().coerceAtLeast(1)
    }

    /**
     * Formata a posição atual e total no formato editorial PT-BR: "Página X de Y".
     */
    fun formatPageProgress(currentPage: Int, totalPages: Int): String {
        if (totalPages <= 0) {
            return if (currentPage > 0) "Página $currentPage" else "Sem páginas"
        }
        val current = currentPage.coerceIn(1, totalPages)
        return "Página $current de $totalPages"
    }

    /**
     * Formata a estimativa de tempo restante em PT-BR: "Faltam aprox. N min".
     * Retorna "Concluído" se 0 minutos e null se a estimativa for indefinida.
     */
    fun formatRemainingTime(minutes: Int?): String? {
        if (minutes == null) return null
        if (minutes <= 0) return "Concluído"
        return "Faltam aprox. $minutes min"
    }

    /**
     * Formata a linha humanizada de leitura para o Hero Card da estante:
     * - Em leitura: "Página 12 de 40 • Faltam aprox. 14 min"
     * - Concluído:  "Página 40 de 40 • Concluído"
     * - Sem tempo:  "Página 12 de 40"
     */
    fun formatHeroProgress(
        currentPage: Int,
        totalPages: Int,
        estimatedMinutesRemaining: Int?,
    ): String {
        val pageText = formatPageProgress(currentPage, totalPages)
        if (totalPages <= 0) return pageText

        val isComplete = currentPage >= totalPages
        if (isComplete) {
            return "$pageText • Concluído"
        }

        val timeText = formatRemainingTime(estimatedMinutesRemaining)
        return if (timeText != null) {
            "$pageText • $timeText"
        } else {
            pageText
        }
    }
}
