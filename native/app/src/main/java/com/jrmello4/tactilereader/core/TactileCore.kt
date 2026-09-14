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

    /**
     * Lista as páginas de uma publicação em ordem natural:
     * `{"pages":[{id,index,name,width,height,cachePath}]}` ou `{"error":...}`.
     * Só metadados — os bytes de cada página visível vêm de
     * `nativeEnsurePage`, nunca em lote na abertura.
     */
    @JvmStatic
    external fun nativeListPages(dir: String, publicationId: String): String

    /**
     * Garante os bytes derivados de uma página da faixa de leitura.
     * Retorna `{"pageSrc":"<caminho>","width":W,"height":H}` ou
     * `{"error":...}`.
     */
    @JvmStatic
    external fun nativeEnsurePage(dir: String, publicationId: String, pageId: String): String

    /**
     * Carrega o progresso `{pageId, scrollRatio}`:
     * `{"state":null}` (nunca leu) ou `{"state":{...}}`.
     */
    @JvmStatic
    external fun nativeLoadReaderState(dir: String, publicationId: String): String

    /**
     * Salva o progresso `{pageId, scrollRatio}` (proporção fixada em
     * 0..1 no núcleo). Retorna `{"ok":true}` ou `{"error":...}`.
     */
    @JvmStatic
    external fun nativeSaveReaderState(
        dir: String,
        publicationId: String,
        pageId: String,
        scrollRatio: Double,
    ): String
}
