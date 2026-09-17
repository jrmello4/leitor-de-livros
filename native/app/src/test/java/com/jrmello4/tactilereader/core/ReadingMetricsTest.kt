package com.jrmello4.tactilereader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Testes unitários para [ReadingMetrics] (sessões, pausas, velocidade e Hero Card).
 * Executados como teste JVM puro em milissegundos.
 */
class ReadingMetricsTest {

    @Test
    fun emptySessionsReturnZeroSpeed() {
        val speed = ReadingMetrics.calculateSpeed(emptyList())
        assertEquals(0L, speed.totalEffectiveDurationMs)
        assertEquals(0, speed.totalPagesRead)
        assertEquals(0.0, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun invalidDurationsAndNegativePagesAreDiscarded() {
        val invalid = listOf(
            ReadingSession(durationMillis = 0L, pagesRead = 5),
            ReadingSession(durationMillis = -10_000L, pagesRead = 3),
            ReadingSession(durationMillis = 60_000L, pagesRead = 0),
            ReadingSession(durationMillis = 60_000L, pagesRead = -2),
        )
        val speed = ReadingMetrics.calculateSpeed(invalid)
        assertEquals(0L, speed.totalEffectiveDurationMs)
        assertEquals(0, speed.totalPagesRead)
        assertEquals(0.0, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun normalReadingCalculatesCorrectPagesPerMinute() {
        // 2 minutos de leitura (120.000 ms), 4 páginas lidas -> 2 páginas por minuto
        val session = ReadingSession(durationMillis = 120_000L, pagesRead = 4)
        val speed = ReadingMetrics.calculateSpeed(session)

        assertEquals(120_000L, speed.totalEffectiveDurationMs)
        assertEquals(4, speed.totalPagesRead)
        assertEquals(2.0, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun explicitPauseIsDeductedFromDuration() {
        // Sessão total de 3 minutos (180.000 ms), com 1 minuto (60.000 ms) de pausa e 4 páginas lidas
        // Duração útil = 2 minutos (120.000 ms) -> 2 páginas por minuto
        val session = ReadingSession(
            durationMillis = 180_000L,
            pagesRead = 4,
            pauseMillis = 60_000L,
        )
        val speed = ReadingMetrics.calculateSpeed(session)

        assertEquals(120_000L, speed.totalEffectiveDurationMs)
        assertEquals(4, speed.totalPagesRead)
        assertEquals(2.0, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun explicitPauseGreaterThanDurationYieldsZero() {
        val session = ReadingSession(
            durationMillis = 60_000L,
            pagesRead = 2,
            pauseMillis = 90_000L,
        )
        assertEquals(0L, ReadingMetrics.effectiveDuration(session))
        val speed = ReadingMetrics.calculateSpeed(session)
        assertEquals(0.0, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun untrackedLongPauseIsCappedByConfigurableThreshold() {
        // Usuário ficou 15 minutos (900.000 ms) com a tela ligada em 1 única página
        // Limite padrão é 2 minutos (120.000 ms) por página
        // O excesso (13 minutos) é descartado como pausa longa não rastreada
        val session = ReadingSession(durationMillis = 900_000L, pagesRead = 1)
        val effective = ReadingMetrics.effectiveDuration(session)

        assertEquals(120_000L, effective)
        val speed = ReadingMetrics.calculateSpeed(session)
        // 1 página em 2 minutos = 0.5 PPM
        assertEquals(0.5, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun customPauseThresholdIsRespected() {
        // Limite configurado para 45 segundos (45.000 ms) por página
        val customThreshold = 45_000L
        val session = ReadingSession(durationMillis = 200_000L, pagesRead = 2)

        // 2 páginas * 45s = 90s (90.000 ms) admitidos; 110s descartados
        val effective = ReadingMetrics.effectiveDuration(session, maxPauseThresholdMs = customThreshold)
        assertEquals(90_000L, effective)

        val speed = ReadingMetrics.calculateSpeed(session, maxPauseThresholdMs = customThreshold)
        // 2 páginas em 1.5 minutos = 1.3333 PPM
        assertEquals(2.0 / 1.5, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun multipleSessionsAggregateAccurately() {
        val sessions = listOf(
            ReadingSession(durationMillis = 60_000L, pagesRead = 3), // 1 min, 3 páginas
            ReadingSession(durationMillis = 120_000L, pagesRead = 3, pauseMillis = 60_000L), // 1 min útil, 3 páginas
        )
        val speed = ReadingMetrics.calculateSpeed(sessions)

        assertEquals(120_000L, speed.totalEffectiveDurationMs) // 2 min úteis
        assertEquals(6, speed.totalPagesRead)
        assertEquals(3.0, speed.pagesPerMinute, 0.0001)
    }

    @Test
    fun estimateRemainingMinutesReturnsZeroWhenDone() {
        assertEquals(0, ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 0, pagesPerMinute = 2.0))
        assertEquals(0, ReadingMetrics.estimateRemainingMinutes(pagesRemaining = -3, pagesPerMinute = 2.0))
    }

    @Test
    fun estimateRemainingMinutesReturnsNullOnZeroOrNegativeSpeed() {
        assertNull(ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 10, pagesPerMinute = 0.0))
        assertNull(ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 10, pagesPerMinute = -1.5))
        assertNull(ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 10, pagesPerMinute = Double.NaN))
        assertNull(ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 10, pagesPerMinute = Double.POSITIVE_INFINITY))
    }

    @Test
    fun estimateRemainingMinutesCalculatesCeiling() {
        // 5 páginas a 2.0 PPM = 2.5 minutos -> arredonda para cima: 3 min
        assertEquals(3, ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 5, pagesPerMinute = 2.0))
        // 1 página a 0.2 PPM = 5 minutos
        assertEquals(5, ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 1, pagesPerMinute = 0.2))
        // 1 página a 10.0 PPM = 0.1 minuto -> mínimo de 1 minuto
        assertEquals(1, ReadingMetrics.estimateRemainingMinutes(pagesRemaining = 1, pagesPerMinute = 10.0))
    }

    @Test
    fun formatPageProgressHandlesBoundariesAndEmptyTotal() {
        assertEquals("Página 1 de 20", ReadingMetrics.formatPageProgress(currentPage = 1, totalPages = 20))
        assertEquals("Página 12 de 20", ReadingMetrics.formatPageProgress(currentPage = 12, totalPages = 20))
        assertEquals("Página 20 de 20", ReadingMetrics.formatPageProgress(currentPage = 20, totalPages = 20))
        // Clamping gracioso
        assertEquals("Página 1 de 20", ReadingMetrics.formatPageProgress(currentPage = 0, totalPages = 20))
        assertEquals("Página 20 de 20", ReadingMetrics.formatPageProgress(currentPage = 25, totalPages = 20))
        // Total inválido/vazio
        assertEquals("Sem páginas", ReadingMetrics.formatPageProgress(currentPage = 0, totalPages = 0))
        assertEquals("Página 3", ReadingMetrics.formatPageProgress(currentPage = 3, totalPages = 0))
    }

    @Test
    fun formatRemainingTimeHandlesNullZeroAndPositive() {
        assertNull(ReadingMetrics.formatRemainingTime(null))
        assertEquals("Concluído", ReadingMetrics.formatRemainingTime(0))
        assertEquals("Concluído", ReadingMetrics.formatRemainingTime(-1))
        assertEquals("Faltam aprox. 1 min", ReadingMetrics.formatRemainingTime(1))
        assertEquals("Faltam aprox. 14 min", ReadingMetrics.formatRemainingTime(14))
    }

    @Test
    fun formatHeroProgressCombinesPageAndRemainingTime() {
        val formatted = ReadingMetrics.formatHeroProgress(
            currentPage = 12,
            totalPages = 40,
            estimatedMinutesRemaining = 14,
        )
        assertEquals("Página 12 de 40 • Faltam aprox. 14 min", formatted)
    }

    @Test
    fun formatHeroProgressShowsCompletedWhenDone() {
        val completed = ReadingMetrics.formatHeroProgress(
            currentPage = 40,
            totalPages = 40,
            estimatedMinutesRemaining = 0,
        )
        assertEquals("Página 40 de 40 • Concluído", completed)

        val overflow = ReadingMetrics.formatHeroProgress(
            currentPage = 45,
            totalPages = 40,
            estimatedMinutesRemaining = 0,
        )
        assertEquals("Página 40 de 40 • Concluído", overflow)
    }

    @Test
    fun formatHeroProgressOmitsTimeWhenSpeedIsUnknown() {
        val formatted = ReadingMetrics.formatHeroProgress(
            currentPage = 5,
            totalPages = 30,
            estimatedMinutesRemaining = null,
        )
        assertEquals("Página 5 de 30", formatted)
    }
}
