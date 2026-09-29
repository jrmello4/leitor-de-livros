package com.jrmello4.tactilereader.core

/** Shared terminal-page rules for explicit reading-state updates. */
internal object ReadingStateRules {
    fun isFinished(pageIndex: Int, pageCount: Int, direction: String): Boolean =
        pageIndex == finalPageIndex(pageCount, direction)

    fun finalPageIndex(pageCount: Int, direction: String): Int? = when {
        pageCount <= 0 -> null
        direction == "rtl" -> 0
        else -> pageCount - 1
    }
}
