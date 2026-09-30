package com.jrmello4.tactilereader.reader

import androidx.compose.foundation.gestures.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntSize
import kotlin.math.abs

/** One coordinated transform for the current page/spread, discarded on navigation. */
internal class ReaderTransform {
    var zoom by mutableFloatStateOf(1f)
    var pan by mutableStateOf(Offset.Zero)
    var viewport by mutableStateOf(IntSize.Zero)
    var contentSize by mutableStateOf(IntSize.Zero)
    fun clamp(offset: Offset): Offset {
        val content = if (contentSize == IntSize.Zero) viewport else contentSize
        val x = ((content.width * zoom - viewport.width) / 2f).coerceAtLeast(0f)
        val y = ((content.height * zoom - viewport.height) / 2f).coerceAtLeast(0f)
        return Offset(offset.x.coerceIn(-x, x), offset.y.coerceIn(-y, y))
    }
    fun toggle(point: Offset = Offset(viewport.width / 2f, viewport.height / 2f)) {
        zoom = if (zoom > 1f) 1f else 2f
        pan = if (zoom == 1f) Offset.Zero else clamp(Offset(viewport.width / 2f - point.x, viewport.height / 2f - point.y))
    }
}

internal fun Modifier.readerGestures(transform: ReaderTransform, direction: ReadingDirection, onHud: () -> Unit, onStep: (Int) -> Unit): Modifier =
    pointerInput(transform, direction) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            var distance = Offset.Zero
            var transformed = transform.zoom > 1f
            var horizontal = false
            do {
                val event = awaitPointerEvent()
                val pan = event.calculatePan()
                if (event.changes.count { it.pressed } > 1) {
                    transformed = true
                    transform.zoom = (transform.zoom * event.calculateZoom()).coerceIn(1f, 5f)
                    transform.pan = transform.clamp(transform.pan + pan)
                    event.changes.forEach { it.consume() }
                } else if (transform.zoom > 1f) {
                    transformed = true
                    transform.pan = transform.clamp(transform.pan + pan)
                    event.changes.forEach { it.consume() }
                } else {
                    // Fit-width/height scrolling owns consumed drags at normal scale.
                    if (event.changes.any { it.isConsumed && it.position != it.previousPosition }) transformed = true
                    distance += pan
                    if (abs(distance.x) > viewConfiguration.touchSlop && abs(distance.x) > abs(distance.y)) horizontal = true
                    if (horizontal) event.changes.forEach { it.consume() }
                }
            } while (event.changes.any { it.pressed })
            if (!transformed && horizontal && abs(distance.x) >= 64 * density) {
                val step = if (distance.x < 0f) 1 else -1
                onStep(if (direction == ReadingDirection.RIGHT_TO_LEFT) -step else step)
            }
        }
    }.pointerInput(transform, direction) {
        detectTapGestures(onTap = { point ->
            val step = tapStep(if (size.width > 0) point.x / size.width else 0.5f, direction)
            if (step == 0) onHud() else if (transform.zoom == 1f) onStep(step)
        }, onDoubleTap = transform::toggle)
    }
