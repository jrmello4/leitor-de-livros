package com.jrmello4.tactilereader.reader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BingeVisibilityTest {
    @Test
    fun cardMustBeSignificantlyVisibleBeforeCountdownCanStart() {
        assertEquals(0f, visibleFraction(1100, 100, 0, 1000), 0.0001f)
        assertEquals(0.39f, visibleFraction(961, 100, 0, 1000), 0.0001f)
        assertEquals(0.4f, visibleFraction(960, 100, 0, 1000), 0.0001f)
        assertEquals(0.4f, visibleFraction(-60, 100, 0, 1000), 0.0001f)
        assertFalse(isBingeCardActive(visibleFraction(961, 100, 0, 1000)))
        assertTrue(isBingeCardActive(visibleFraction(960, 100, 0, 1000)))
    }

    @Test
    fun invalidViewportOrItemIsNeverActive() {
        assertEquals(0f, visibleFraction(0, 0, 0, 100), 0f)
        assertEquals(0f, visibleFraction(0, 10, 100, 100), 0f)
        assertFalse(isBingeCardActive(0f))
    }
}
