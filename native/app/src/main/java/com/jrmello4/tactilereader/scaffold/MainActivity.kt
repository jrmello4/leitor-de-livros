package com.jrmello4.tactilereader.scaffold

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.TextView
import com.jrmello4.tactilereader.core.TactileCore
import java.io.File

/**
 * Tela de prova da fase 2: abre o banco do núcleo e mostra o resultado.
 * Sem Compose de propósito — o scaffold prova o JNI, não o toolkit de UI.
 * (No app real, chamadas ao núcleo rodam fora da thread principal.)
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val report = try {
            TactileCore.nativeOpenLibrary(File(filesDir, "lib").absolutePath)
        } catch (error: UnsatisfiedLinkError) {
            """{"error":"native library not packaged: ${error.message}"}"""
        }
        setContentView(
            TextView(this).apply {
                text = "Tactile Reader (nativo, prova JNI)\n$report"
                textSize = 16f
                gravity = Gravity.CENTER
                setPadding(48, 48, 48, 48)
            },
        )
    }
}
