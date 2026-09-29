package com.jrmello4.tactilereader.reader

internal const val BINGE_VISIBILITY_THRESHOLD = 0.4f

internal fun visibleFraction(
    itemOffset: Int,
    itemSize: Int,
    viewportStart: Int,
    viewportEnd: Int,
): Float {
    if (itemSize <= 0 || viewportEnd <= viewportStart) return 0f
    val itemStart = itemOffset.toLong()
    val itemEnd = itemStart + itemSize
    val visibleStart = maxOf(itemStart, viewportStart.toLong())
    val visibleEnd = minOf(itemEnd, viewportEnd.toLong())
    return ((visibleEnd - visibleStart).coerceAtLeast(0L).toFloat() / itemSize)
        .coerceIn(0f, 1f)
}

internal fun isBingeCardActive(fraction: Float): Boolean =
    fraction >= BINGE_VISIBILITY_THRESHOLD
