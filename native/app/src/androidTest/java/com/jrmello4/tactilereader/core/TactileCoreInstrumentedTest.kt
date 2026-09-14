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
import org.json.JSONObject

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

    @Test
    fun importGeneratedCbzAndListItBack() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "jni-phase3-${UUID.randomUUID()}")
        val dbDir = File(root, "lib").absolutePath

        val comic = TestComic.generate(File(root, "seed"))
        val imported = JSONObject(TactileCore.nativeImportPaths(dbDir, pathsJson(listOf(comic.absolutePath))))
        assertFalse("import error: $imported", imported.has("error"))
        assertTrue("expected no diagnostics: $imported", imported.getJSONArray("diagnostics").length() == 0)
        val pubs = imported.getJSONArray("publications")
        assertTrue("expected one publication, got: $imported", pubs.length() == 1)
        val pub0 = pubs.getJSONObject(0)
        assertTrue("expected cbz, got: $imported", pub0.getString("format") == "cbz")
        assertTrue("expected 2 pages, got: $imported", pub0.getInt("pageCount") == 2)

        val listed = parsePublications(TactileCore.nativeListPublications(dbDir))
        assertTrue("expected one listed pub", listed.size == 1)
        assertTrue("title mismatch", listed[0].title.isNotBlank())
        assertTrue("expected 2 pages listed", listed[0].pageCount == 2)
    }
}
