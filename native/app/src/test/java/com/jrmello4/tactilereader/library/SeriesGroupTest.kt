package com.jrmello4.tactilereader.library

import com.jrmello4.tactilereader.core.Pub
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Regras da estante: chave insensível, ordem numérica, hint sem mesclar. */
class SeriesGroupTest {
    private fun pub(id: String, title: String, pages: Int = 20) =
        Pub(id, title, "cbz", pages, 0.0, false)

    @Test
    fun groupsBySeriesIgnoringCaseAndSpaces() {
        val groups = groupBySeries(
            listOf(
                pub("a", "Arqueiro Verde Absoluto #02"),
                pub("b", "arqueiro  verde absoluto #01"),
            ),
        )
        assertEquals(1, groups.size)
        assertEquals("Arqueiro Verde Absoluto", groups[0].title)
        assertEquals(listOf(1, 2), groups[0].editions.map { it.number })
        assertEquals("b", groups[0].editions[0].pub.id)
    }

    @Test
    fun ordersNumericallyNotLexicographically() {
        val groups = groupBySeries(
            listOf(
                pub("a", "Série X #10"),
                pub("b", "Série X #2"),
            ),
        )
        assertEquals(listOf(2, 10), groups[0].editions.map { it.number })
    }

    @Test
    fun legitNumbersNeverBecomeEditions() {
        val groups = groupBySeries(listOf(pub("a", "2000 AD")))
        assertEquals(1, groups.size)
        assertEquals(1, groups[0].editions.size)
        assertEquals(null, groups[0].editions[0].number)
        assertFalse(groups[0].editions[0].possibleDuplicate)
    }

    @Test
    fun flagsSameSeriesEditionAndPageCount() {
        val groups = groupBySeries(
            listOf(
                pub("a", "Arqueiro Verde Absoluto #01", 36),
                pub("b", "Arqueiro Verde Absoluto #01", 36),
                pub("c", "Arqueiro Verde Absoluto #02", 36),
            ),
        )
        val editions = groups.single().editions
        assertTrue(editions[0].possibleDuplicate)
        assertTrue(editions[1].possibleDuplicate)
        assertFalse(editions[2].possibleDuplicate)
    }

    @Test
    fun differentPageCountIsNotDuplicate() {
        val groups = groupBySeries(
            listOf(
                pub("a", "Série X #01", 20),
                pub("b", "Série X #01", 22),
            ),
        )
        assertFalse(groups.single().editions.any { it.possibleDuplicate })
    }

    @Test
    fun untitledSeriesKeepEveryPublication() {
        val groups = groupBySeries(
            listOf(
                pub("a", "One Shot A"),
                pub("b", "One Shot B"),
            ),
        )
        assertEquals(2, groups.size)
        assertEquals(listOf("One Shot A", "One Shot B"), groups.map { it.title })
    }
}
