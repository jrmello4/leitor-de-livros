package com.jrmello4.tactilereader.reader

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Barramento simples para as teclas físicas de volume rolarem a faixa sem
 * tocar na tela. A `MainActivity` emite; o `ReaderContent` consome e rola
 * um bloco. Sem fila persistente: `extraBufferCapacity = 1`.
 */
object VolumeScrollBus {
    private val _events = MutableSharedFlow<Int>(extraBufferCapacity = 1)
    val events: SharedFlow<Int> = _events.asSharedFlow()

    /** Direção: -1 sobe um bloco, +1 desce um bloco. */
    fun emit(direction: Int) {
        _events.tryEmit(if (direction >= 0) 1 else -1)
    }
}
