package com.jrmello4.tactilereader.scaffold

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.memory.MemoryCache

/**
 * Configura o carregador de imagens único do app.
 *
 * O padrão do Coil reserva 25% da RAM disponível para bitmaps decodificados;
 * num celular de 4 GB isso pode passar de 1 GB e estourar o alvo de 180 MB
 * de PSS do leitor. Aqui o cache fica limitado a um teto explícito, suficiente
 * para as páginas visíveis + vizinhas e para uma tela de capas.
 */
class TactileApp : Application(), SingletonImageLoader.Factory {
    override fun onCreate() {
        super.onCreate()
        // O núcleo lê os originais direto da URI do SAF (sem copiar).
        AppSources.opener = ContentSourceOpener(contentResolver)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .memoryCache {
                MemoryCache.Builder()
                    .maxSizeBytes(MEMORY_CACHE_BYTES)
                    .build()
            }
            .build()

    private companion object {
        /** Teto do cache em memória: ~5 páginas longas de 1080px. */
        const val MEMORY_CACHE_BYTES = 64L * 1024 * 1024
    }
}
