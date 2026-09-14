package com.jrmello4.tactilereader.core

/**
 * Ponte fina para o núcleo portátil (`tactile-core`, Rust via JNI).
 * As funções `external` casam 1:1 com `native-core/src/jni.rs`; a única
 * lógica aqui é carregar a biblioteca. Erros do Rust voltam como JSON
 * `{"error": ...}` — nunca como exceção JNI.
 */
object TactileCore {
    init {
        System.loadLibrary("tactile_core")
    }

    @JvmStatic
    external fun nativeVersion(): String

    @JvmStatic
    external fun nativeOpenLibrary(dir: String): String

    @JvmStatic
    external fun nativeListPublications(dir: String): String

    @JvmStatic
    external fun nativeImportPaths(dir: String, pathsJson: String): String

    /**
     * Garante os bytes derivados de uma capa (reconstrói do original
     * somente-leitura quando preciso). Retorna
     * `{"coverSrc":"<caminho>","width":W,"height":H}` ou `{"error":...}`.
     * Chamado sob demanda para os cards visíveis — nunca em lote no boot.
     */
    @JvmStatic
    external fun nativeEnsureCover(dir: String, publicationId: String, pageId: String): String
}
