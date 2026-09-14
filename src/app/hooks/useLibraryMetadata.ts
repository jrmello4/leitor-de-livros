import { useCallback, useRef, useState } from 'react';
import type { Bookmark, Publication, ReaderState } from '../../domain/types';
import { t } from '../../i18n/catalog';
import { listNativeLibrarySnapshot } from '../../services/nativeLibrary';
import {
  listBookmarksForPublication,
  loadReaderStateForPublication,
} from '../../services/readerState';

/**
 * Bookmarks + estados de leitura (zoom/scroll) de toda a biblioteca.
 * O boot usa o snapshot em lote (`list_library_snapshot`, 1 IPC) e cai para
 * o lote de 8 chamadas em caso de falha. A geração invalida hidratações
 * antigas quando a biblioteca é removida/limpa no meio do voo.
 */
export function useLibraryMetadata(onError: (message: string) => void) {
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark[]>>({});
  const [readerStates, setReaderStates] = useState<Record<string, ReaderState>>({});
  const generationRef = useRef(0);
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const bookmarkWriteQueuesRef = useRef(new Map<string, Promise<void>>());

  const enqueueBookmarkWrite = useCallback((key: string, write: () => Promise<void>) => {
    const previous = bookmarkWriteQueuesRef.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(write);
    bookmarkWriteQueuesRef.current.set(key, next);
    const cleanup = () => {
      if (bookmarkWriteQueuesRef.current.get(key) === next) {
        bookmarkWriteQueuesRef.current.delete(key);
      }
    };
    void next.then(cleanup, cleanup);
    return next;
  }, []);

  const hydrateMetadata = useCallback(async (publications: Publication[]) => {
    const generation = ++generationRef.current;
    const publicationIds = new Set(publications.map((publication) => publication.id));
    try {
      // Caminho rápido: 1 IPC para toda a biblioteca (snapshot em lote).
      // Substitui o N×2 anterior e cai para o lote de 8 em caso de falha.
      const snapshot = await listNativeLibrarySnapshot().catch(() => null);
      if (snapshot && generation === generationRef.current) {
        const nextBookmarks: Record<string, Bookmark[]> = {};
        const nextStates: Record<string, ReaderState> = {};
        for (const publication of publications) {
          if (snapshot.bookmarks[publication.id] !== undefined) {
            nextBookmarks[publication.id] = snapshot.bookmarks[publication.id];
          }
          const state = snapshot.readerStates[publication.id];
          if (state !== undefined) {
            nextStates[publication.id] = state;
          } else {
            try {
              const fallback = await loadReaderStateForPublication(publication.id);
              if (fallback) nextStates[publication.id] = fallback;
            } catch {
              // Estado ausente não bloqueia a biblioteca.
            }
          }
          if (generation !== generationRef.current) {
            return;
          }
        }
        setBookmarks((current) => ({ ...current, ...Object.fromEntries(Object.entries(nextBookmarks).filter(([id]) => publicationIds.has(id))) }));
        setReaderStates((current) => ({ ...current, ...Object.fromEntries(Object.entries(nextStates).filter(([id]) => publicationIds.has(id))) }));
        return;
      }
      const metadata: Array<{ id: string; bookmarks: Bookmark[]; readerState: ReaderState }> = [];
      // Fallback: lote de 8 para não criar rajada de 200+ chamadas.
      for (let start = 0; start < publications.length; start += 8) {
        const batch = publications.slice(start, start + 8);
        const resolved = await Promise.all(batch.map(async (publication) => {
          const [publicationBookmarks, readerState] = await Promise.all([
            listBookmarksForPublication(publication.id),
            loadReaderStateForPublication(publication.id),
          ]);
          return { id: publication.id, bookmarks: publicationBookmarks, readerState };
        }));
        metadata.push(...resolved);
      }
      if (generation !== generationRef.current) {
        return;
      }
      setBookmarks(Object.fromEntries(metadata.filter((entry) => publicationIds.has(entry.id)).map((entry) => [entry.id, entry.bookmarks])));
      setReaderStates(Object.fromEntries(metadata.filter((entry) => publicationIds.has(entry.id)).map((entry) => [entry.id, entry.readerState])));
    } catch {
      if (generation === generationRef.current) {
        onError(t('app.metadataError'));
      }
    }
  }, [onError]);

  const invalidateMetadata = useCallback(() => {
    generationRef.current += 1;
  }, []);

  return {
    bookmarks,
    readerStates,
    setBookmarks,
    setReaderStates,
    bookmarksRef,
    hydrateMetadata,
    invalidateMetadata,
    enqueueBookmarkWrite,
  };
}
