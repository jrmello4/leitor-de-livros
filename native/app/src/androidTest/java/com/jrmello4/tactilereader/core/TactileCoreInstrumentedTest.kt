package com.jrmello4.tactilereader.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Prova fim-a-fim da fase 2: o .so do `tactile-core` carrega no aparelho,
 * o SQLite abre e a contagem de publicações volta pelo JNI.
 */
@RunWith(AndroidJUnit4::class)
class TactileCoreInstrumentedTest {
    @Test
    fun versionLooksLikeSemver() {
        assertTrue(TactileCore.nativeVersion().matches(Regex("\\d+\\.\\d+\\.\\d+")))
    }

    @Test
    fun openLibraryOpensAndReportsZeroPublications() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val dir = File(context.cacheDir, "jni-proof-${UUID.randomUUID()}").absolutePath

        val first = TactileCore.nativeOpenLibrary(dir)
        assertTrue("expected zero publications, got: $first", first.contains("\"publications\":0"))
        assertFalse("unexpected error: $first", first.contains("\"error\""))

        // Reabrir o mesmo diretório não pode falhar nem duplicar nada.
        val second = TactileCore.nativeOpenLibrary(dir)
        assertTrue("reopen failed: $second", second.contains("\"publications\":0"))
    }
}
