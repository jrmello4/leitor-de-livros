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
 * Prova fim-a-fim do núcleo: o .so do `tactile-core` carrega no aparelho,
 * o SQLite abre, importar→listar funciona e a capa é garantida sob demanda.
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

    @Test
    fun ensureCoverRebuildsFirstPageOnDemand() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "jni-cover-${UUID.randomUUID()}")
        val dbDir = File(root, "lib").absolutePath

        val comic = TestComic.generate(File(root, "seed"))
        JSONObject(TactileCore.nativeImportPaths(dbDir, pathsJson(listOf(comic.absolutePath))))

        // Import novo indexa sem bytes derivados: a listagem chega sem capa.
        val listed = parsePublications(TactileCore.nativeListPublications(dbDir))
        assertTrue("expected one pub", listed.size == 1)
        val pub = listed[0]
        assertTrue("expected cover page id", pub.coverPageId.isNotBlank())

        val ensured = JSONObject(TactileCore.nativeEnsureCover(dbDir, pub.id, pub.coverPageId))
        assertFalse("ensure error: $ensured", ensured.has("error"))
        val coverSrc = ensured.getString("coverSrc")
        assertTrue("expected cover file, got: $ensured", File(coverSrc).isFile)

        // Após garantir, a listagem volta a cruzar a capa materializada.
        val relisted = parsePublications(TactileCore.nativeListPublications(dbDir))
        assertTrue("expected cover after ensure", relisted[0].coverSrc?.isNotBlank() == true)
    }

    @Test
    fun readerListsPagesEnsuresBytesAndRestoresProgress() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "jni-reader-${UUID.randomUUID()}")
        val dbDir = File(root, "lib").absolutePath

        val comic = TestComic.generate(File(root, "seed"))
        JSONObject(TactileCore.nativeImportPaths(dbDir, pathsJson(listOf(comic.absolutePath))))
        val pub = parsePublications(TactileCore.nativeListPublications(dbDir)).single()

        // Sem progresso salvo, o leitor começa da primeira página.
        assertTrue(
            "expected null state",
            JSONObject(TactileCore.nativeLoadReaderState(dbDir, pub.id)).isNull("state"),
        )

        val pages = parseReaderPages(TactileCore.nativeListPages(dbDir, pub.id))
        assertTrue("expected 2 pages, got ${pages.size}", pages.size == 2)

        val ensured = JSONObject(TactileCore.nativeEnsurePage(dbDir, pub.id, pages[1].id))
        assertFalse("ensure error: $ensured", ensured.has("error"))
        assertTrue("expected page file", File(ensured.getString("pageSrc")).isFile)

        val saved = JSONObject(TactileCore.nativeSaveReaderState(dbDir, pub.id, pages[1].id, 0.25))
        assertFalse("save error: $saved", saved.has("error"))

        val restored = parseReaderState(TactileCore.nativeLoadReaderState(dbDir, pub.id))
        assertTrue("expected progress, got $restored", restored?.pageId == pages[1].id)
        assertTrue("expected ratio 0.25", restored?.scrollRatio == 0.25)
    }
}
