import { useCallback, useRef } from 'react';
import { warmWorkingSet } from '../../domain/pageSelection';
import { activeWorkingSetPageIds, calculateProgress } from '../../domain/reader';
import type { Bookmark, PageDescriptor, Publication, ReaderState, ReadingProfile } from '../../domain/types';
import { t } from '../../i18n/catalog';
import { revokePublicationBlobUrls } from '../../services/importers';
import {
  chooseNativeCover,
  clearNativeCover,
  clearNativeCache,
  deleteNativePublication,
  ensureNativePage,
  listNativePublications,
  loadNativePublicationPages,
  rebuildNativePublicationCache,
  setNativeCacheLimit,
  setNativeCover,
  saveNativeProgress,
} from '../../services/nativeLibrary';
import { toggleFavoriteForPublication } from '../../services/readerState';
import { clearCustomCover, readBrowserCover, saveCustomCover } from '../../services/covers';
import { saveProgress } from '../../services/storage';

export interface PublicationActionsDeps {
  nativeRuntime: boolean;
  profile: ReadingProfile;
  getActivePublication: () => Publication | undefined;
  getActiveId: () => string | null;
  cancelPageSelection: () => void;
  setLibrary: React.Dispatch<React.SetStateAction<Publication[]>>;
  setActiveId: (id: string | null) => void;
  setBookmarks: React.Dispatch<React.SetStateAction<Record<string, Bookmark[]>>>;
  setReaderStates: React.Dispatch<React.SetStateAction<Record<string, ReaderState>>>;
  hydrateMetadata: (publications: Publication[]) => void | Promise<void>;
  refreshCacheInfo: () => void | Promise<void>;
  invalidateMetadata: () => void;
  onError: (message: string) => void;
  onAnnounce: (message: string) => void;
}

/**
 * Fills in the page list of one publication. A native listing reports counts
 * and a cover but not the pages, so the reader loads the pages of the single
 * publication it opens rather than every page in the library.
 */
async function hydratePublicationPages(
  library: Publication[],
  publicationId: string,
): Promise<Publication[]> {
  const target = library.find((publication) => publication.id === publicationId);
  if (!target || target.pages.length > 0) {
    return library;
  }

  const pages = await loadNativePublicationPages(publicationId).catch(() => []);
  if (pages.length === 0) {
    return library;
  }

  return library.map((publication) => (
    publication.id === publicationId ? { ...publication, pages } : publication
  ));
}

/**
 * Mutações da biblioteca: favoritar, marcar lida, capas, remoção e cache.
 * Tudo que altera `library` fora da navegação mora aqui; o App só fia os
 * callbacks na LibraryView/ProfilePanel.
 */
export function usePublicationActions({
  nativeRuntime,
  profile,
  getActivePublication,
  getActiveId,
  cancelPageSelection,
  setLibrary,
  setActiveId,
  setBookmarks,
  setReaderStates,
  hydrateMetadata,
  refreshCacheInfo,
  invalidateMetadata,
  onError,
  onAnnounce,
}: PublicationActionsDeps) {
  const favoriteInFlightRef = useRef(new Set<string>());

  const applyPreparedPages = useCallback((publicationId: string, prepared: PageDescriptor[]) => {
    // A descriptor without a source is not a rebuilt page; merging it would
    // replace a working source with an empty one and break the very fold this
    // warm-up exists to keep alive.
    const byId = new Map(prepared.filter((page) => page.src).map((page) => [page.id, page]));
    if (byId.size === 0) {
      return;
    }
    setLibrary((current) => current.map((entry) => (
      entry.id === publicationId
        ? { ...entry, pages: entry.pages.map((page) => byId.get(page.id) ?? page) }
        : entry
    )));
  }, [setLibrary]);

  const reloadNativeLibraryWithEssentials = useCallback(async (direction: ReadingProfile['direction']) => {
    const activePublication = getActivePublication();
    const initial = await listNativePublications(direction);
    let incomplete = false;
    const activePageId = activePublication?.pages[activePublication.currentPage]?.id
      ?? activePublication?.currentPageId;
    const activeProtectedPageIds = activePublication
      ? activeWorkingSetPageIds(activePublication, profile, activePublication.currentPage)
      : [];
    for (const publication of initial) {
      // A listing does not carry pages, so the resume page and the cover come
      // from the identifiers the listing reports.
      const pageIds = new Set([
        publication.currentPageId,
        publication.coverPageId,
        ...(publication.id === activePublication?.id ? activeProtectedPageIds : []),
      ].filter((pageId): pageId is string => Boolean(pageId)));
      const protectedPageIds = publication.id === activePublication?.id
        ? [...new Set([...pageIds, ...activeProtectedPageIds])]
        : [...pageIds];
      for (const pageId of pageIds) {
        // Keep the page currently shown last so an LRU eviction cannot blank
        // the reader while the cache is being rebuilt.
        if (publication.id === activePublication?.id && pageId === activePageId) {
          continue;
        }
        try {
          const ensured = await ensureNativePage(publication.id, pageId, protectedPageIds);
          if (!ensured) {
            incomplete = true;
          }
        } catch {
          // A legacy publication may no longer have a rebuildable source. Keep
          // the rest of the library usable and surface that state to the UI.
          incomplete = true;
        }
      }
    }
    if (activePublication && activePageId) {
      try {
        const ensured = await ensureNativePage(activePublication.id, activePageId, activeProtectedPageIds);
        if (!ensured) {
          incomplete = true;
        }
      } catch {
        // A legacy publication may no longer have a rebuildable source. Keep
        // the rest of the library usable and surface that state to the UI.
        incomplete = true;
      }
    }
    const listed = await listNativePublications(direction);
    // The reader needs the pages of the publication it is showing, so the one
    // open publication is hydrated while the rest stay as summaries.
    const refreshed = activePublication
      ? await hydratePublicationPages(listed, activePublication.id)
      : listed;
    // The final native relist is authoritative: an earlier ensured descriptor
    // may already have been evicted by a later LRU rebuild step.
    if (refreshed.some((publication) => publication.pageCount > 0 && !publication.coverSrc)) {
      incomplete = true;
    }
    const activeRefreshed = activePublication
      ? refreshed.find((publication) => publication.id === activePublication.id)
      : undefined;
    if (activeRefreshed) {
      const current = activeRefreshed.pages[activeRefreshed.currentPage];
      const cover = activeRefreshed.pages.find((page) => page.id === activeRefreshed.coverPageId);
      if (!current?.src || !cover?.src) {
        // A spread/cover may still be unavailable for a legacy source; keep
        // the library usable and let the caller surface a non-destructive
        // diagnostic while opening/rebuilding can retry later.
        incomplete = true;
      }
    }
    return { library: refreshed, incomplete };
  }, [getActivePublication, profile]);

  const updatePublication = useCallback((id: string, updater: (publication: Publication) => Publication) => {
    setLibrary((current) => current.map((publication) => (publication.id === id ? updater(publication) : publication)));
  }, [setLibrary]);

  const toggleFavorite = useCallback(async (publication: Publication) => {
    if (favoriteInFlightRef.current.has(publication.id)) {
      return;
    }
    const nextFavorite = !publication.isFavorite;
    favoriteInFlightRef.current.add(publication.id);
    try {
      await toggleFavoriteForPublication(publication.id, nextFavorite);
      updatePublication(publication.id, (current) => ({ ...current, isFavorite: nextFavorite }));
      onAnnounce(nextFavorite ? t('app.favoriteAdded', { title: publication.title }) : t('app.favoriteRemoved', { title: publication.title }));
    } catch {
      onError(t('app.favoriteSaveError'));
    } finally {
      favoriteInFlightRef.current.delete(publication.id);
    }
  }, [onAnnounce, onError, updatePublication]);

  const markPublicationRead = useCallback(async (publication: Publication) => {
    const lastPage = Math.max(publication.pageCount - 1, 0);
    updatePublication(publication.id, (current) => ({
      ...current,
      currentPage: lastPage,
      currentPageId: current.pages[lastPage]?.id ?? current.currentPageId,
      progress: 1,
      updatedAt: new Date().toISOString(),
    }));
    saveProgress(publication.id, lastPage);
    if (nativeRuntime) {
      try {
        await saveNativeProgress(publication.id, lastPage);
      } catch {
        onError(t('app.progressSaveError'));
      }
    }
  }, [nativeRuntime, onError, updatePublication]);

  const replaceBrowserCover = useCallback(async (publication: Publication, file: File) => {
    try {
      const cover = await readBrowserCover(file);
      if (!saveCustomCover(publication.id, cover)) {
        onError(t('app.coverSaveError'));
        return;
      }
      updatePublication(publication.id, (current) => ({
        ...current,
        customCover: cover,
        updatedAt: new Date().toISOString(),
      }));
      onAnnounce(t('app.coverSaved', { title: publication.title }));
    } catch (error) {
      onError(error instanceof Error && ['tooLarge', 'unsupported', 'missing'].includes(error.message)
        ? t('app.coverInvalid')
        : t('app.coverSaveError'));
    }
  }, [onAnnounce, onError, updatePublication]);

  const replaceNativeCover = useCallback(async (publication: Publication) => {
    try {
      const sourcePath = await chooseNativeCover();
      if (!sourcePath) {
        return;
      }
      await setNativeCover(publication.id, sourcePath);
      const refreshed = await listNativePublications(profile.direction);
      setLibrary((current) => current.map((entry) => refreshed.find((candidate) => candidate.id === entry.id) ?? entry));
      onAnnounce(t('app.coverSaved', { title: publication.title }));
    } catch {
      onError(t('app.coverSaveError'));
    }
  }, [onAnnounce, onError, profile.direction, setLibrary]);

  const resetPublicationCover = useCallback(async (publication: Publication) => {
    try {
      if (nativeRuntime) {
        await clearNativeCover(publication.id);
        const refreshed = await listNativePublications(profile.direction);
        setLibrary((current) => current.map((entry) => refreshed.find((candidate) => candidate.id === entry.id) ?? entry));
      } else {
        if (!clearCustomCover(publication.id)) {
          onError(t('app.coverSaveError'));
          return;
        }
        updatePublication(publication.id, (current) => {
          const next = { ...current, updatedAt: new Date().toISOString() };
          delete next.customCover;
          return next;
        });
      }
      onAnnounce(t('app.coverReset', { title: publication.title }));
    } catch {
      onError(t('app.coverSaveError'));
    }
  }, [nativeRuntime, onAnnounce, onError, profile.direction, setLibrary, updatePublication]);

  const handleBrowserCoverError = useCallback((publication: Publication) => {
    if (nativeRuntime || !publication.customCover) {
      return;
    }
    if (!clearCustomCover(publication.id)) {
      onError(t('app.coverSaveError'));
      return;
    }
    updatePublication(publication.id, (current) => {
      const next = { ...current, updatedAt: new Date().toISOString() };
      delete next.customCover;
      return next;
    });
  }, [nativeRuntime, onError, updatePublication]);

  const removePublication = useCallback(async (publication: Publication) => {
    invalidateMetadata();
    if (getActiveId() === publication.id) {
      cancelPageSelection();
    }
    try {
      await deleteNativePublication(publication.id);
      revokePublicationBlobUrls(publication);
      setLibrary((current) => current.filter((entry) => entry.id !== publication.id));
      setBookmarks((current) => {
        const next = { ...current };
        delete next[publication.id];
        return next;
      });
      setReaderStates((current) => {
        const next = { ...current };
        delete next[publication.id];
        return next;
      });
      if (getActiveId() === publication.id) {
        setActiveId(null);
      }
      await refreshCacheInfo();
      onAnnounce(t('app.publicationRemoved', { title: publication.title }));
    } catch {
      onError(t('app.publicationRemoveError'));
      throw new Error('delete-publication-failed');
    }
  }, [cancelPageSelection, getActiveId, invalidateMetadata, onAnnounce, onError, refreshCacheInfo, setActiveId, setBookmarks, setLibrary, setReaderStates]);

  const updateCacheLimit = useCallback(async (maxBytes: number) => {
    if (!nativeRuntime) {
      return;
    }
    let limitApplied = false;
    try {
      const active = getActivePublication();
      await setNativeCacheLimit(maxBytes, active ? activeWorkingSetPageIds(active, profile, active.currentPage) : []);
      limitApplied = true;
      const { library: refreshedLibrary, incomplete } = await reloadNativeLibraryWithEssentials(profile.direction);
      setLibrary(refreshedLibrary);
      void hydrateMetadata(refreshedLibrary);
      await refreshCacheInfo();
      if (incomplete) {
        onError(t('app.cacheRebuildIncomplete'));
        onAnnounce(t('app.cacheLimitSavedIncomplete'));
      } else {
        onAnnounce(t('app.cacheLimitSaved'));
      }
    } catch {
      if (limitApplied) {
        invalidateMetadata();
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        onError(t('app.cacheRefreshError'));
      } else {
        onError(t('app.cacheLimitError'));
      }
    }
  }, [getActivePublication, hydrateMetadata, invalidateMetadata, nativeRuntime, onAnnounce, onError, profile, refreshCacheInfo, reloadNativeLibraryWithEssentials, setActiveId, setBookmarks, setLibrary, setReaderStates]);

  const clearCache = useCallback(async () => {
    if (!nativeRuntime) {
      return;
    }
    let cacheCleared = false;
    try {
      const active = getActivePublication();
      await clearNativeCache(active ? activeWorkingSetPageIds(active, profile, active.currentPage) : []);
      cacheCleared = true;
      const { library: readyLibrary, incomplete } = await reloadNativeLibraryWithEssentials(profile.direction);
      setLibrary(readyLibrary);
      // Clearing the cache deletes the images the fold draws from. Rebuilding
      // the pages around the reader here means the next turn still animates,
      // instead of failing to decode a file that was just removed.
      const refreshed = readyLibrary.find((publication) => publication.id === getActiveId());
      if (refreshed) {
        void warmWorkingSet(refreshed, profile, refreshed.currentPage, ensureNativePage)
          .then((warmed) => {
            if (warmed.length > 0) {
              applyPreparedPages(refreshed.id, warmed);
            }
          })
          .catch(() => undefined);
      }
      void hydrateMetadata(readyLibrary);
      await refreshCacheInfo();
      if (incomplete) {
        onError(t('app.cacheRebuildIncomplete'));
        onAnnounce(t('app.cacheClearedIncomplete'));
      } else {
        onAnnounce(t('app.cacheCleared'));
      }
    } catch {
      if (cacheCleared) {
        invalidateMetadata();
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        onError(t('app.cacheClearRefreshError'));
      } else {
        onError(t('app.cacheClearError'));
      }
    }
  }, [applyPreparedPages, getActiveId, getActivePublication, hydrateMetadata, invalidateMetadata, nativeRuntime, onAnnounce, onError, profile, refreshCacheInfo, reloadNativeLibraryWithEssentials, setActiveId, setBookmarks, setLibrary, setReaderStates]);

  const handleRebuildPublicationCache = async (publication: Publication) => {
    if (!nativeRuntime) {
      return;
    }
    try {
      await rebuildNativePublicationCache(publication.id);
      await refreshCacheInfo();
      onAnnounce(t('app.cacheRebuilt', { title: publication.title }));
    } catch {
      onError(t('app.pageRebuildError'));
    }
  };

  return {
    reloadNativeLibraryWithEssentials,
    updatePublication,
    applyPreparedPages,
    toggleFavorite,
    markPublicationRead,
    replaceBrowserCover,
    replaceNativeCover,
    resetPublicationCover,
    handleBrowserCoverError,
    removePublication,
    updateCacheLimit,
    clearCache,
    handleRebuildPublicationCache,
  };
}
