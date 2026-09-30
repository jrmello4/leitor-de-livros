package com.jrmello4.tactilereader.reader

import com.jrmello4.tactilereader.core.ReadingStateRules
import org.junit.Assert.*
import org.junit.Test

class ReaderModeTest {
    @Test fun panBoundsUseTheActualFittedPageNotItsLetterbox() {
        val transform = ReaderTransform().apply {
            viewport = androidx.compose.ui.unit.IntSize(1000, 1000)
            contentSize = androidx.compose.ui.unit.IntSize(100, 1000)
            zoom = 5f
        }
        assertEquals(androidx.compose.ui.geometry.Offset(0f, 2000f),
            transform.clamp(androidx.compose.ui.geometry.Offset(9000f, 9000f)))
        transform.toggle()
        assertEquals(1f, transform.zoom)
        assertEquals(androidx.compose.ui.geometry.Offset.Zero, transform.pan)
    }
    @Test fun coverAndOddCountsNeverDuplicateOrDropPages() {
        for (count in 0..201) for (cover in listOf(true, false)) {
            val spreads = pageSpreads(count, cover)
            assertEquals((0 until count).toList(), spreads.flatten())
            assertTrue(spreads.all { it.size in 1..2 })
            if (cover && count > 0) assertEquals(listOf(0), spreads.first())
        }
    }

    @Test fun coverPairingMatchesComicSpreads() {
        assertEquals(listOf(listOf(0), listOf(1, 2), listOf(3, 4), listOf(5, 6), listOf(7)), pageSpreads(8, true))
        assertEquals(listOf(listOf(0, 1), listOf(2, 3), listOf(4)), pageSpreads(5, false))
    }

    @Test fun rtlReversesSequenceAndVisualPairButNotLogicalAdvancement() {
        val rtl = ReadingDirection.RIGHT_TO_LEFT
        val pages = readingOrder((0..7).toList(), rtl)
        assertEquals(7, pages.first())
        assertEquals(listOf(5, 6), visualSpread(pageSpreads(8, true)[1], rtl).map { pages[it] })
        assertEquals(ReadingStateRules.finalPageIndex(8, "rtl"), pages.last())
        assertFalse(ReadingStateRules.isFinished(pages.first(), 8, "rtl"))
        assertTrue(ReadingStateRules.isFinished(pages.last(), 8, "rtl"))
    }

    @Test fun ltrSequenceEndsAtCentralTerminalPage() {
        val pages = readingOrder((0..7).toList(), ReadingDirection.LEFT_TO_RIGHT)
        assertEquals(listOf(1, 2), visualSpread(pageSpreads(8, true)[1], ReadingDirection.LEFT_TO_RIGHT))
        assertEquals(ReadingStateRules.finalPageIndex(8, "ltr"), pages.last())
    }

    @Test fun sideTapsAdvanceAndReverseWithDirection() {
        assertEquals(-1, tapStep(0.1f, ReadingDirection.LEFT_TO_RIGHT))
        assertEquals(1, tapStep(0.9f, ReadingDirection.LEFT_TO_RIGHT))
        assertEquals(1, tapStep(0.1f, ReadingDirection.RIGHT_TO_LEFT))
        assertEquals(-1, tapStep(0.9f, ReadingDirection.RIGHT_TO_LEFT))
        ReadingDirection.entries.forEach { assertEquals(0, tapStep(0.5f, it)) }
    }
}
