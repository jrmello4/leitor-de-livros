import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { createDemoPublication } from '../data/demo';
import { canRunActionWhileSettingsOpen, InputMap } from '../domain/input';
import { createPageSelectionCoordinator, preparePageSelection, selectLatestPage, warmWorkingSet, type PageSelectionRequest } from '../domain/pageSelection';
import { activeWorkingSetPageIds, calculateProgress, movePage, clamp } from '../domain/reader';
import { nextBookmark, type FormatFilter, type LibrarySort, type ReadingStatusFilter } from '../domain/library';
import { defaultReaderState, nextRotation } from '../domain/readerState';
import { findNextPublication } from '../domain/seriesMatching';
import type { ActionName, Bookmark, CacheInfo, PageDescriptor, Publication, ReaderState, ReadingProfile } from '../domain/types';
import { actionLabel, t } from '../i18n/catalog';
import '../i18n/register-locales';
import { importFiles, revokePublicationBlobUrls } from '../services/importers';
import {
  chooseNativeFiles,
  chooseNativeCover,
  chooseNativeFolder,
  clearNativeCover,
  ensureRuntimePlatformLoaded,
  importNativePaths,
  isAndroidRuntime,
  isNativeRuntime,
  listNativePublications,
  loadNativePublicationPages,
  saveNativeProgress,
  clearNativeCache,
  deleteNativePublication,
  ensureNativePage,
  getNativeCacheInfo,
  rebuildNativePublicationCache,
  setNativeCacheLimit,
  setNativeCover,
} from '../services/nativeLibrary';
import { useLibraryMetadata } from './hooks/useLibraryMetadata';
import { useReadingProfiles } from './hooks/useReadingProfiles';
import { useNativeLibraryBoot } from './hooks/useNativeLibraryBoot';
import {
  removeBookmarkForPublication,
  saveBookmarkForPublication,
  saveReaderStateForPublication,
  toggleFavoriteForPublication,
} from '../services/readerState';
import { clearCustomCover, readBrowserCover, saveCustomCover } from '../services/covers';
import {
  loadFavorites,
  loadCustomCover,
  loadProgress,
  saveProgress,
} from '../services/storage';
import { LibraryView, type ImportProgress } from './LibraryView';
import { LiveAnnouncement } from './LiveAnnouncement';
import { ProfilePanel } from './ProfilePanel';
import { SmokeHarness } from './SmokeHarness';
import { isSmokeMode } from '../release/testModes';
import { resolveNativeImportRequest, type NativeImportRequest } from './nativeImportFlow';

// O leitor (Webtoon + page-turn + renderers) só carrega ao abrir uma
// publicação. A biblioteca — tela inicial no Android — não paga esse custo.
const ReaderView = lazy(() => import('./ReaderView').then((module) => ({ default: module.ReaderView })));

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

function initialLibrary(direction: ReadingProfile['direction']): Publication[] {
  const demo = createDemoPublication();
  demo.isFavorite = loadFavorites().includes(demo.id);
  demo.customCover = loadCustomCover(demo.id);
  const savedPage = loadProgress(demo.id);
  demo.currentPage = direction === 'rtl' && savedPage === 0 ? demo.pageCount - 1 : Math.min(savedPage, demo.pageCount - 1);
  demo.progress = calculateProgress(demo.currentPage, demo.pageCount, direction);
  return [demo];
}

const DEFAULT_CACHE_INFO: CacheInfo = {
  usedBytes: 0,
  maxBytes: 2 * 1024 * 1024 * 1024,
  entryCount: 0,
};

function sameBookmark(left: Bookmark | undefined, right: Bookmark | undefined): boolean {
  return left?.pageId === right?.pageId
    && left?.label === right?.label
    && left?.createdAt === right?.createdAt
    && left?.updatedAt === right?.updatedAt;
}

function restoreBookmark(bookmarks: Bookmark[], pageId: string, previous: Bookmark | undefined, previousIndex: number): Bookmark[] {
  const index = bookmarks.findIndex((bookmark) => bookmark.pageId === pageId);
  const restored = bookmarks.filter((bookmark) => bookmark.pageId !== pageId);
  if (!previous) {
    return restored;
  }
  restored.splice(Math.min(previousIndex < 0 ? (index < 0 ? restored.length : index) : previousIndex, restored.length), 0, previous);
  return restored;
}

export function App() {
  const nativeRuntime = isNativeRuntime();
  const [diagnostic, setDiagnostic] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState(() => t('app.libraryReady'));
  const {
    bookmarks,
    readerStates,
    setBookmarks,
    setReaderStates,
    bookmarksRef,
    hydrateMetadata,
    invalidateMetadata,
    enqueueBookmarkWrite,
  } = useLibraryMetadata(setDiagnostic);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  const getActivePublicationId = useCallback(() => activeIdRef.current, []);
  const {
    profileStore,
    profile,
    profilePreview,
    getProfileStore,
    replaceProfileStore,
    updateProfile,
    previewProfile,
    saveProfilePreview,
    undoProfilePreview,
    importProfiles,
    exportProfiles,
    exportData,
    importData,
    selectReadingProfile,
    createReadingProfile,
    duplicateReadingProfile,
    renameReadingProfile,
    deleteReadingProfile,
    handleProfileReset,
  } = useReadingProfiles({
    nativeRuntime,
    getActivePublicationId,
    setBookmarks,
    setReaderStates,
    bookmarks,
    readerStates,
    onError: setDiagnostic,
    onAnnounce: setAnnouncement,
  });
  const [library, setLibrary] = useState<Publication[]>(() => initialLibrary(profile.direction));
  const [navigatorVisible, setNavigatorVisible] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [capturingAction, setCapturingAction] = useState<ActionName | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ReadingStatusFilter>('all');
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>(DEFAULT_CACHE_INFO);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [retryableNativePaths, setRetryableNativePaths] = useState<string[] | null>(null);
  const [smokeImportSequence, setSmokeImportSequence] = useState(0);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const navigatorTriggerRef = useRef<HTMLButtonElement>(null);
  const readerTurnRequestRef = useRef<((delta: number) => void) | null>(null);
  const favoriteInFlightRef = useRef(new Set<string>());
  const pageSelectionCoordinatorRef = useRef(createPageSelectionCoordinator());
  const boundaryAnnouncementRef = useRef(false);

  const activePublication = library.find((publication) => publication.id === activeId);
  const activePublicationIdRef = useRef<string | null>(activePublication?.id ?? null);
  activePublicationIdRef.current = activePublication?.id ?? null;
  const showProfileRef = useRef(showProfile);
  showProfileRef.current = showProfile;
  const navigatorVisibleRef = useRef(navigatorVisible);
  navigatorVisibleRef.current = navigatorVisible;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const inputMap = useMemo(() => new InputMap(profile.bindings), [profile.bindings]);

  const refreshCacheInfo = useCallback(async () => {
    try {
      setCacheInfo(await getNativeCacheInfo());
    } catch {
      setDiagnostic(t('app.cacheUsageError'));
    }
  }, []);

  const { nativeLibraryReady } = useNativeLibraryBoot(nativeRuntime, {
    getProfileStore,
    replaceProfileStore,
    setLibrary,
    hydrateMetadata,
    refreshCacheInfo,
    invalidateMetadata,
    setImportProgress,
    onError: setDiagnostic,
    onAnnounce: setAnnouncement,
  });

  const reloadNativeLibraryWithEssentials = useCallback(async (direction: ReadingProfile['direction']) => {
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
  }, [activePublication, profile]);

  useEffect(() => {
    if (!isAndroidRuntime()) {
      return undefined;
    }
    let disposed = false;
    let pluginListener: PluginListener | undefined;
    const handleAndroidBack = (event?: Event) => {
      if (!isAndroidRuntime()) {
        return;
      }
      if (showProfileRef.current) {
        event?.preventDefault();
        event?.stopImmediatePropagation?.();
        setShowProfile(false);
        setCapturingAction(null);
        return;
      }
      // ReaderView owns the local reader surfaces and the final exit while a
      // publication is open. The library only needs to consume Back when a
      // navigation drawer/modal is active at this level.
      if (!activeIdRef.current && navigatorVisibleRef.current) {
        event?.preventDefault();
        event?.stopImmediatePropagation?.();
        setNavigatorVisible(false);
      }
    };
    window.addEventListener('backbutton', handleAndroidBack);
    if (nativeRuntime) {
      void addPluginListener('app', 'back-button', () => handleAndroidBack()).then((listener) => {
        if (disposed) {
          void listener.unregister();
        } else {
          pluginListener = listener;
        }
      }).catch(() => undefined);
    }
    return () => {
      disposed = true;
      window.removeEventListener('backbutton', handleAndroidBack);
      void pluginListener?.unregister();
    };
  }, [nativeRuntime]);

  useEffect(() => {
    if (nativeRuntime) {
      return;
    }
    void hydrateMetadata(library);
    void refreshCacheInfo();
  }, [hydrateMetadata, library, nativeRuntime, refreshCacheInfo]);

  const updatePublication = useCallback((id: string, updater: (publication: Publication) => Publication) => {
    setLibrary((current) => current.map((publication) => (publication.id === id ? updater(publication) : publication)));
  }, []);

  const toggleFavorite = useCallback(async (publication: Publication) => {
    if (favoriteInFlightRef.current.has(publication.id)) {
      return;
    }
    const nextFavorite = !publication.isFavorite;
    favoriteInFlightRef.current.add(publication.id);
    try {
      await toggleFavoriteForPublication(publication.id, nextFavorite);
      updatePublication(publication.id, (current) => ({ ...current, isFavorite: nextFavorite }));
      setAnnouncement(nextFavorite ? t('app.favoriteAdded', { title: publication.title }) : t('app.favoriteRemoved', { title: publication.title }));
    } catch {
      setDiagnostic(t('app.favoriteSaveError'));
    } finally {
      favoriteInFlightRef.current.delete(publication.id);
    }
  }, [updatePublication]);

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
        setDiagnostic(t('app.progressSaveError'));
      }
    }
  }, [nativeRuntime, updatePublication]);

  const replaceBrowserCover = useCallback(async (publication: Publication, file: File) => {
    try {
      const cover = await readBrowserCover(file);
      if (!saveCustomCover(publication.id, cover)) {
        setDiagnostic(t('app.coverSaveError'));
        return;
      }
      updatePublication(publication.id, (current) => ({
        ...current,
        customCover: cover,
        updatedAt: new Date().toISOString(),
      }));
      setAnnouncement(t('app.coverSaved', { title: publication.title }));
      setDiagnostic(undefined);
    } catch (error) {
      setDiagnostic(error instanceof Error && ['tooLarge', 'unsupported', 'missing'].includes(error.message)
        ? t('app.coverInvalid')
        : t('app.coverSaveError'));
    }
  }, [updatePublication]);

  const replaceNativeCover = useCallback(async (publication: Publication) => {
    try {
      const sourcePath = await chooseNativeCover();
      if (!sourcePath) {
        return;
      }
      await setNativeCover(publication.id, sourcePath);
      const refreshed = await listNativePublications(profile.direction);
      setLibrary((current) => current.map((entry) => refreshed.find((candidate) => candidate.id === entry.id) ?? entry));
      setAnnouncement(t('app.coverSaved', { title: publication.title }));
      setDiagnostic(undefined);
    } catch {
      setDiagnostic(t('app.coverSaveError'));
    }
  }, [profile.direction]);

  const resetPublicationCover = useCallback(async (publication: Publication) => {
    try {
      if (nativeRuntime) {
        await clearNativeCover(publication.id);
        const refreshed = await listNativePublications(profile.direction);
        setLibrary((current) => current.map((entry) => refreshed.find((candidate) => candidate.id === entry.id) ?? entry));
      } else {
        if (!clearCustomCover(publication.id)) {
          setDiagnostic(t('app.coverSaveError'));
          return;
        }
        updatePublication(publication.id, (current) => {
          const next = { ...current, updatedAt: new Date().toISOString() };
          delete next.customCover;
          return next;
        });
      }
      setAnnouncement(t('app.coverReset', { title: publication.title }));
      setDiagnostic(undefined);
    } catch {
      setDiagnostic(t('app.coverSaveError'));
    }
  }, [nativeRuntime, profile.direction, updatePublication]);

  const handleBrowserCoverError = useCallback((publication: Publication) => {
    if (nativeRuntime || !publication.customCover) {
      return;
    }
    if (!clearCustomCover(publication.id)) {
      setDiagnostic(t('app.coverSaveError'));
      return;
    }
    updatePublication(publication.id, (current) => {
      const next = { ...current, updatedAt: new Date().toISOString() };
      delete next.customCover;
      return next;
    });
    setDiagnostic(t('app.coverInvalid'));
  }, [nativeRuntime, updatePublication]);

  const removePublication = useCallback(async (publication: Publication) => {
    invalidateMetadata();
    if (activeIdRef.current === publication.id) {
      pageSelectionCoordinatorRef.current.cancel();
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
      if (activeId === publication.id) {
        setActiveId(null);
      }
      await refreshCacheInfo();
      setAnnouncement(t('app.publicationRemoved', { title: publication.title }));
    } catch {
      setDiagnostic(t('app.publicationRemoveError'));
      throw new Error('delete-publication-failed');
    }
  }, [activeId, invalidateMetadata, refreshCacheInfo]);

  const updateCacheLimit = useCallback(async (maxBytes: number) => {
    if (!nativeRuntime) {
      return;
    }
    let limitApplied = false;
    try {
      const active = activeIdRef.current
        ? libraryRef.current.find((publication) => publication.id === activeIdRef.current)
        : undefined;
      await setNativeCacheLimit(maxBytes, active ? activeWorkingSetPageIds(active, profile, active.currentPage) : []);
      limitApplied = true;
      const { library: refreshedLibrary, incomplete } = await reloadNativeLibraryWithEssentials(profile.direction);
      setLibrary(refreshedLibrary);
      void hydrateMetadata(refreshedLibrary);
      await refreshCacheInfo();
      if (incomplete) {
        setDiagnostic(t('app.cacheRebuildIncomplete'));
        setAnnouncement(t('app.cacheLimitSavedIncomplete'));
      } else {
        setAnnouncement(t('app.cacheLimitSaved'));
      }
    } catch {
      if (limitApplied) {
        invalidateMetadata();
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        setDiagnostic(t('app.cacheRefreshError'));
      } else {
        setDiagnostic(t('app.cacheLimitError'));
      }
    }
  }, [hydrateMetadata, invalidateMetadata, nativeRuntime, profile.direction, profile.mode, refreshCacheInfo, reloadNativeLibraryWithEssentials]);

  const clearCache = useCallback(async () => {
    if (!nativeRuntime) {
      return;
    }
    let cacheCleared = false;
    try {
      const active = activeIdRef.current
        ? libraryRef.current.find((publication) => publication.id === activeIdRef.current)
        : undefined;
      await clearNativeCache(active ? activeWorkingSetPageIds(active, profile, active.currentPage) : []);
      cacheCleared = true;
      const { library: readyLibrary, incomplete } = await reloadNativeLibraryWithEssentials(profile.direction);
      setLibrary(readyLibrary);
      // Clearing the cache deletes the images the fold draws from. Rebuilding
      // the pages around the reader here means the next turn still animates,
      // instead of failing to decode a file that was just removed.
      const refreshed = readyLibrary.find((publication) => publication.id === activeIdRef.current);
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
        setDiagnostic(t('app.cacheRebuildIncomplete'));
        setAnnouncement(t('app.cacheClearedIncomplete'));
      } else {
        setAnnouncement(t('app.cacheCleared'));
      }
    } catch {
      if (cacheCleared) {
        invalidateMetadata();
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        setDiagnostic(t('app.cacheClearRefreshError'));
      } else {
        setDiagnostic(t('app.cacheClearError'));
      }
    }
  }, [hydrateMetadata, invalidateMetadata, nativeRuntime, profile.direction, profile.mode, refreshCacheInfo, reloadNativeLibraryWithEssentials]);

  const persistProgress = useCallback(async (publicationId: string, pageIndex: number): Promise<void> => {
    saveProgress(publicationId, pageIndex);
    if (nativeRuntime) {
      try {
        await saveNativeProgress(publicationId, pageIndex);
      } catch {
        setDiagnostic(t('app.progressSaveError'));
      }
    }
  }, [nativeRuntime]);

  const persistReaderState = useCallback(async (publicationId: string, state: ReaderState) => {
    setReaderStates((current) => {
      const previous = current[publicationId];
      if (
        previous
        && previous.zoomMode === state.zoomMode
        && previous.zoomScale === state.zoomScale
        && previous.panX === state.panX
        && previous.panY === state.panY
        && previous.pageId === state.pageId
        && previous.scrollRatio === state.scrollRatio
      ) {
        return current;
      }
      return { ...current, [publicationId]: state };
    });
    try {
      await saveReaderStateForPublication(publicationId, state);
    } catch {
      setDiagnostic(t('app.readerStateSaveError'));
    }
  }, []);

  const toggleBookmark = useCallback(async (publicationId: string, pageId: string) => {
    const current = bookmarksRef.current[publicationId] ?? [];
    const existing = current.find((bookmark) => bookmark.pageId === pageId);
    const next = nextBookmark(current, pageId, '', new Date().toISOString());
    const nextState = { ...bookmarksRef.current, [publicationId]: next };
    bookmarksRef.current = nextState;
    setBookmarks(nextState);
    const key = `${publicationId}:${pageId}`;
    try {
      await enqueueBookmarkWrite(key, () => existing
        ? removeBookmarkForPublication(publicationId, pageId)
        : saveBookmarkForPublication(publicationId, next.find((bookmark) => bookmark.pageId === pageId)!));
    } catch {
      setBookmarks((all) => {
        const latest = all[publicationId] ?? [];
        const expected = next.find((bookmark) => bookmark.pageId === pageId);
        const actual = latest.find((bookmark) => bookmark.pageId === pageId);
        if (!sameBookmark(actual, expected)) {
          return all;
        }
        const restored = {
          ...all,
          [publicationId]: restoreBookmark(latest, pageId, current.find((bookmark) => bookmark.pageId === pageId), current.findIndex((bookmark) => bookmark.pageId === pageId)),
        };
        bookmarksRef.current = restored;
        return restored;
      });
      setDiagnostic(t('app.bookmarkSaveError'));
    }
  }, [enqueueBookmarkWrite]);

  const selectPublicationPage = useCallback(async (
    publication: Publication,
    pageIndex: number,
    onCommit: (preparedPage: PageDescriptor | null, request: PageSelectionRequest) => void | Promise<void>,
  ): Promise<boolean> => {
    if (publication.pages.length === 0) {
      return false;
    }
    const nextPage = clamp(pageIndex, 0, publication.pages.length - 1);
    return selectLatestPage(
      pageSelectionCoordinatorRef.current,
      publication.id,
      nextPage,
      async () => {
        // Files selected through the Android HTML picker are already decoded
        // into blob URLs. They must follow the browser path even in the Tauri
        // runtime; asking Rust to prepare a blob descriptor makes the tap look
        // like it did nothing because there is no filesystem path to rebuild.
        if (!nativeRuntime || publication.pages[0]?.src?.startsWith('blob:')) {
          return null;
        }
        const prepared = await preparePageSelection(publication, profile, nextPage, ensureNativePage);
        // The page on screen is ready; its neighbours are what the next fold is
        // drawn from, so they warm up behind it rather than holding it back.
        // Rebuilding a page can move it in the derived cache, so the refreshed
        // descriptors are merged back — a stale source is exactly what makes
        // the fold fail to decode after the cache is cleared.
        void warmWorkingSet(publication, profile, nextPage, ensureNativePage)
          .then((warmed) => {
            if (warmed.length > 0) {
              applyPreparedPages(publication.id, warmed);
            }
          })
          .catch(() => undefined);
        return prepared;
      },
      onCommit,
      () => {
        setDiagnostic(t('app.pageRebuildError'));
      },
    );
  }, [nativeRuntime, profile]);

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
  }, []);

  const commitActivePageSelection = useCallback(async (
    preparedPage: PageDescriptor | null,
    request: PageSelectionRequest,
  ): Promise<void> => {
    if (activePublicationIdRef.current !== request.publicationId) {
      return;
    }
    const latest = libraryRef.current.find((publication) => publication.id === request.publicationId);
    if (!latest) {
      return;
    }
    await persistProgress(request.publicationId, request.pageIndex);
    updatePublication(request.publicationId, (publication) => ({
      ...publication,
      pages: preparedPage
        ? publication.pages.map((page) => page.id === preparedPage.id ? preparedPage : page)
        : publication.pages,
      currentPage: request.pageIndex,
      progress: calculateProgress(request.pageIndex, publication.pageCount, profile.direction),
      updatedAt: new Date().toISOString(),
    }));
    // A completed persistence from the preceding turn must not overwrite the
    // more recent boundary feedback.
    if (!boundaryAnnouncementRef.current) {
      setAnnouncement(t('app.pageReady', { page: request.pageIndex + 1, count: latest.pageCount }));
    }
  }, [persistProgress, profile.direction, updatePublication]);

  const moveActivePage = useCallback(
    async (delta: number) => {
      const current = activeIdRef.current
        ? libraryRef.current.find((publication) => publication.id === activeIdRef.current)
        : undefined;
      if (!current) {
        return;
      }

      const nextPage = movePage(current.currentPage, current.pageCount, profile.direction, delta);
      if (nextPage === current.currentPage) {
        pageSelectionCoordinatorRef.current.cancel();
        boundaryAnnouncementRef.current = true;
        setAnnouncement(delta > 0 ? t('app.endOfPublication') : t('app.beginningOfPublication'));
        return;
      }

      boundaryAnnouncementRef.current = false;
      await selectPublicationPage(current, nextPage, commitActivePageSelection);
    },
    [commitActivePageSelection, profile.direction, selectPublicationPage],
  );

  const dispatchPageTurn = useCallback((delta: number) => {
    if (readerTurnRequestRef.current) {
      readerTurnRequestRef.current(delta);
      return;
    }
    void moveActivePage(delta);
  }, [moveActivePage]);

  const registerReaderTurnRequest = useCallback((request: ((delta: number) => void) | null) => {
    readerTurnRequestRef.current = request;
  }, []);

  const selectActivePage = useCallback(
    async (pageIndex: number) => {
      const current = activeIdRef.current
        ? libraryRef.current.find((publication) => publication.id === activeIdRef.current)
        : undefined;
      if (!current || current.pages.length === 0) {
        return;
      }
      const nextPage = clamp(pageIndex, 0, current.pages.length - 1);
      if (nextPage === current.currentPage) {
        pageSelectionCoordinatorRef.current.cancel();
        return;
      }
      await selectPublicationPage(current, nextPage, commitActivePageSelection);
    },
    [commitActivePageSelection, selectPublicationPage],
  );

  // Continuous scrolling already has the page in its DOM. Treating every
  // IntersectionObserver update as a page-selection request rebuilt native
  // cache entries during a pinch zoom, which could evict nearby images and
  // make the reader appear to jump. Record progress without preparing pages.
  const recordWebtoonVisiblePage = useCallback((pageIndex: number) => {
    const publicationId = activeIdRef.current;
    const current = publicationId
      ? libraryRef.current.find((publication) => publication.id === publicationId)
      : undefined;
    if (!current || current.pages.length === 0) {
      return;
    }
    const nextPage = clamp(pageIndex, 0, current.pages.length - 1);
    if (nextPage === current.currentPage) {
      return;
    }
    updatePublication(current.id, (publication) => ({
      ...publication,
      currentPage: nextPage,
      progress: calculateProgress(nextPage, publication.pageCount, profile.direction),
      updatedAt: new Date().toISOString(),
    }));
    void persistProgress(current.id, nextPage);
  }, [persistProgress, profile.direction, updatePublication]);

  const saveActiveReaderState = useCallback((state: ReaderState) => {
    if (activePublication) {
      void persistReaderState(activePublication.id, state);
    }
  }, [activePublication?.id, persistReaderState]);

  const toggleActiveBookmark = useCallback((pageId: string) => {
    if (activePublication) {
      void toggleBookmark(activePublication.id, pageId);
    }
  }, [activePublication?.id, toggleBookmark]);

  const updateActiveBookmarkLabel = useCallback((pageId: string, label: string) => {
    const publicationId = activePublicationIdRef.current;
    if (!publicationId) {
      return;
    }
    const current = bookmarksRef.current[publicationId] ?? [];
    const existing = current.find((bookmark) => bookmark.pageId === pageId);
    if (!existing) {
      return;
    }
    const normalizedLabel = label.trim().slice(0, 120) || t('navigator.defaultBookmark');
    const next = current.map((bookmark) => bookmark.pageId === pageId
      ? { ...bookmark, label: normalizedLabel, updatedAt: new Date().toISOString() }
      : bookmark);
    const nextState = { ...bookmarksRef.current, [publicationId]: next };
    bookmarksRef.current = nextState;
    setBookmarks(nextState);
    const expected = next.find((bookmark) => bookmark.pageId === pageId)!;
    void enqueueBookmarkWrite(`${publicationId}:${pageId}`, () => saveBookmarkForPublication(publicationId, expected)).catch(() => {
      setBookmarks((all) => {
        const latest = all[publicationId] ?? [];
        const actual = latest.find((bookmark) => bookmark.pageId === pageId);
        if (!sameBookmark(actual, expected)) {
          return all;
        }
        const restored = {
          ...all,
          [publicationId]: restoreBookmark(latest, pageId, current.find((bookmark) => bookmark.pageId === pageId), current.findIndex((bookmark) => bookmark.pageId === pageId)),
        };
        bookmarksRef.current = restored;
        return restored;
      });
      setDiagnostic(t('app.bookmarkSaveError'));
    });
  }, [enqueueBookmarkWrite]);

  const toggleNavigator = useCallback(() => {
    setNavigatorVisible((current) => !current);
  }, []);

  const closeNavigator = useCallback(() => {
    setNavigatorVisible(false);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setAnnouncement(t('app.fullscreenUnavailable'));
    }
  }, []);

  const handleAction = useCallback(
    (action: ActionName) => {
      switch (action) {
        case 'next_page':
          dispatchPageTurn(1);
          break;
        case 'previous_page':
          dispatchPageTurn(-1);
          break;
        case 'toggle_navigator':
          if (activePublication) {
            toggleNavigator();
          }
          break;
        case 'toggle_bookmark':
          if (activePublication) {
            const page = activePublication.pages[activePublication.currentPage];
            if (page) {
              toggleActiveBookmark(page.id);
            }
          }
          break;
        case 'toggle_library':
          pageSelectionCoordinatorRef.current.cancel();
          setActiveId(null);
          setNavigatorVisible(false);
          setShowProfile(false);
          setAnnouncement(t('app.libraryOpened'));
          break;
        case 'toggle_fullscreen':
          void toggleFullscreen();
          break;
        case 'toggle_settings':
          setNavigatorVisible(false);
          setShowProfile((current) => !current);
          break;
        case 'toggle_spread': {
          const nextMode: ReadingProfile['mode'] =
            profile.mode === 'single' ? 'spread' : profile.mode === 'spread' ? 'webtoon' : 'single';
          updateProfile({ mode: nextMode });
          const modeName =
            nextMode === 'spread'
              ? t('profile.spread').toLowerCase()
              : nextMode === 'webtoon'
                ? t('profile.webtoon').toLowerCase()
                : t('profile.single').toLowerCase();
          setAnnouncement(t('app.readingMode', { mode: modeName }));
          break;
        }
        case 'rotate_clockwise':
          if (activePublication) {
            const currentReaderState = readerStates[activePublication.id] ?? defaultReaderState;
            const newRot = nextRotation(currentReaderState.rotation);
            const nextState = { ...currentReaderState, rotation: newRot };
            void persistReaderState(activePublication.id, nextState);
            setAnnouncement(t('reader.rotation', { degrees: newRot }));
          }
          break;
        case 'cancel':
          pageSelectionCoordinatorRef.current.cancel();
          if (navigatorVisible) {
            setNavigatorVisible(false);
            setCapturingAction(null);
            break;
          }
          setNavigatorVisible(false);
          if (showProfile) {
            setShowProfile(false);
          } else {
            setActiveId(null);
          }
          setCapturingAction(null);
          break;
      }
    },
    [activePublication, dispatchPageTurn, navigatorVisible, persistReaderState, profile.mode, readerStates, showProfile, toggleActiveBookmark, toggleFullscreen, toggleNavigator, updateProfile],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (capturingAction) {
        event.preventDefault();
        if (event.code === 'Escape') {
          setCapturingAction(null);
          setAnnouncement(t('app.keyCaptureCancelled'));
          return;
        }

        const result = inputMap.bind(capturingAction, event.code);
        if (!result.ok) {
          setAnnouncement(t('app.keyConflict', { code: event.code, action: actionLabel(result.conflict) }));
          return;
        }

        updateProfile({ bindings: inputMap.getBindings() });
        setCapturingAction(null);
        setAnnouncement(t('app.keyAssigned', { code: event.code, action: actionLabel(capturingAction) }));
        return;
      }

      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) {
        return;
      }

      const action = inputMap.resolve(event.code);
      if (!action) {
        return;
      }

      if (showProfile && !canRunActionWhileSettingsOpen(action)) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      handleAction(action);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [capturingAction, handleAction, inputMap, updateProfile]);

  const openPublication = async (summary: Publication) => {
    // The library lists summaries; reading needs the actual pages, so they are
    // loaded for this one publication as it opens.
    const publication = summary.pages.length > 0 || !nativeRuntime
      ? summary
      : { ...summary, pages: await loadNativePublicationPages(summary.id).catch(() => []) };

    if (publication.pages.length === 0 && publication.pageCount > 0) {
      setDiagnostic(t('app.publicationPagesError'));
      return;
    }

    const lastPage = Math.max(publication.pageCount - 1, 0);
    const startsAtFreshRtlPage =
      profile.direction === 'rtl' &&
      publication.currentPage === 0 &&
      publication.progress <= 1 / Math.max(publication.pageCount, 1);
    const openingPublication = startsAtFreshRtlPage
      ? {
          ...publication,
          currentPage: lastPage,
          progress: calculateProgress(lastPage, publication.pageCount, 'rtl'),
        }
      : publication;

    const commitOpenedPublication = async (preparedPage: PageDescriptor | null, request: PageSelectionRequest) => {
      const readyPublication = {
        ...openingPublication,
        pages: preparedPage
          ? openingPublication.pages.map((page) => page.id === preparedPage.id ? preparedPage : page)
          : openingPublication.pages,
        currentPage: request.pageIndex,
        progress: calculateProgress(request.pageIndex, openingPublication.pageCount, profile.direction),
      };
      setLibrary((current) => {
        if (current.some((entry) => entry.id === readyPublication.id)) {
          return current.map((entry) => entry.id === readyPublication.id ? readyPublication : entry);
        }
        return [readyPublication, ...current];
      });
      if (readyPublication.currentPage !== summary.currentPage || readyPublication !== summary) {
        await persistProgress(readyPublication.id, readyPublication.currentPage);
      }
      setActiveId(readyPublication.id);
      setShowProfile(false);
      setDiagnostic(undefined);
      setAnnouncement(t('app.publicationOpened', { title: readyPublication.title, page: readyPublication.currentPage + 1, count: readyPublication.pageCount }));
    };

    // A cold native cache may need to decompress a PDF/CBZ page. Enter the
    // reader first, then rebuild that page in the background; otherwise a tap
    // on a library card appears frozen until I/O and decoding have finished.
    const openingPage = openingPublication.pages[openingPublication.currentPage];
    if (nativeRuntime && !openingPage?.src) {
      await commitOpenedPublication(null, {
        publicationId: openingPublication.id,
        pageIndex: openingPublication.currentPage,
        sequence: 0,
      });
      void selectPublicationPage(openingPublication, openingPublication.currentPage, commitOpenedPublication);
      return;
    }

    await selectPublicationPage(openingPublication, openingPublication.currentPage, commitOpenedPublication);
  };

  const handleImport = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setIsImporting(true);
    setImportProgress({ phase: 'processing', total: files.length, completed: 0 });
    setDiagnostic(undefined);
    const result = await importFiles(files);
    setImportProgress({ phase: 'finishing', total: files.length, completed: files.length });
    setIsImporting(false);

    if (!result.publication) {
      setImportProgress(null);
      setDiagnostic(result.diagnostic ?? t('app.importError'));
      setAnnouncement(result.diagnostic ?? t('app.importFailed'));
      return;
    }

    setRetryableNativePaths(null);

    const importedPublication = {
      ...(result.publication as Publication),
      customCover: loadCustomCover(result.publication.id),
    };
    const openingPublication = profile.direction === 'rtl'
      ? {
          ...importedPublication,
          currentPage: Math.max(importedPublication.pageCount - 1, 0),
          progress: calculateProgress(Math.max(importedPublication.pageCount - 1, 0), importedPublication.pageCount, 'rtl'),
        }
      : importedPublication;
    setLibrary((current) => [openingPublication, ...current]);
    void openPublication(openingPublication);
    setImportProgress(null);
    setAnnouncement(t('app.publicationImportedBrowser', { title: openingPublication.title }));
  };

  const handleNativeImport = async (request: NativeImportRequest): Promise<boolean> => {
    setIsImporting(true);
    setImportProgress({ phase: 'selecting' });
    setDiagnostic(undefined);
    try {
      const resolution = await resolveNativeImportRequest(request, {
        chooseFiles: chooseNativeFiles,
        chooseFolder: chooseNativeFolder,
      });
      if (resolution.kind === 'cancelled') {
        setImportProgress(null);
        setAnnouncement(t('app.importCancelled'));
        return false;
      }

      setImportProgress({ phase: 'processing', total: resolution.paths.length, completed: 0 });
      setRetryableNativePaths(resolution.paths);
      const result = await importNativePaths(resolution.paths, profile.direction);
      setImportProgress({ phase: 'finishing', total: Math.max(resolution.paths.length, result.publications.length), completed: Math.max(resolution.paths.length, result.publications.length) });
      setSmokeImportSequence((current) => current + 1);
      const diagnosticMessage = result.diagnostics.length > 0 ? result.diagnostics.join(' ') : undefined;
      setDiagnostic(diagnosticMessage);
      if (result.publications.length === 0) {
        setImportProgress(null);
        setAnnouncement(t('app.nativeNoPublication'));
        return false;
      }

      if (result.diagnostics.length === 0) {
        setRetryableNativePaths(null);
      }

      setLibrary((current) => {
        const importedIds = new Set(result.publications.map((publication) => publication.id));
        return [...result.publications, ...current.filter((publication) => !importedIds.has(publication.id))];
      });
      const nextLibrary = await listNativePublications(profile.direction);
      setLibrary(nextLibrary);
      void hydrateMetadata(nextLibrary);
      await refreshCacheInfo();
      const openingPublication = result.publications[0];
      await openPublication(openingPublication);
      setImportProgress(null);
      setAnnouncement(t('app.publicationImportedNative', { title: openingPublication.title }));
      return true;
    } catch {
      setImportProgress(null);
      setDiagnostic(t('app.nativeImportError'));
      setAnnouncement(t('app.nativeImportFailed'));
      return false;
    } finally {
      setIsImporting(false);
    }
  };

  const handleRebuildPublicationCache = async (publication: Publication) => {
    if (!nativeRuntime) {
      return;
    }
    try {
      await rebuildNativePublicationCache(publication.id);
      await refreshCacheInfo();
      setAnnouncement(t('app.cacheRebuilt', { title: publication.title }));
    } catch {
      setDiagnostic(t('app.pageRebuildError'));
    }
  };

  const nextPublication = useMemo(() => {
    if (!activePublication) return undefined;
    return findNextPublication(activePublication, library);
  }, [activePublication, library]);

  return (
    <div className="app-shell" data-contrast={profile.contrast}>
      {isSmokeMode(import.meta.env.VITE_SMOKE_TEST === '1', nativeRuntime) && (
        <span className="sr-only" data-testid="native-library-ready" data-ready={nativeLibraryReady ? 'true' : 'false'} />
      )}
      <div className="ambient-mark ambient-mark--one" aria-hidden="true" />
      <div className="ambient-mark ambient-mark--two" aria-hidden="true" />

      <div className="app-content" inert={showProfile} aria-hidden={showProfile || undefined}>
        {activePublication ? (
          <Suspense fallback={<p className="reader-loading" role="status">{t('reader.preparingPage')}</p>}>
          <ReaderView
            publication={activePublication}
            profile={profile}
            announcement={announcement}
            onBack={() => {
              pageSelectionCoordinatorRef.current.cancel();
              setNavigatorVisible(false);
              setActiveId(null);
            }}
            onNext={() => moveActivePage(1)}
            onPrevious={() => moveActivePage(-1)}
            onToggleSettings={() => {
              setNavigatorVisible(false);
              setShowProfile((current) => !current);
            }}
            settingsOpen={showProfile}
            onToggleFullscreen={() => void toggleFullscreen()}
            onFlowCorrected={() => setAnnouncement(t('app.panelOrderCorrected'))}
            onFlowManualRoute={() => setAnnouncement(t('app.fullPageReadingEnabled'))}
            nativeRuntime={nativeRuntime}
            settingsTriggerRef={settingsTriggerRef}
            bookmarks={bookmarks[activePublication.id] ?? []}
            readerState={readerStates[activePublication.id] ?? {
              ...defaultReaderState,
              zoomMode: profile.zoomMode,
              zoomScale: profile.zoomScale,
            }}
            onSaveReaderState={saveActiveReaderState}
            onSelectPage={selectActivePage}
            onWebtoonPageVisible={recordWebtoonVisiblePage}
            onToggleBookmark={toggleActiveBookmark}
            navigatorVisible={navigatorVisible}
            navigatorTriggerRef={navigatorTriggerRef}
            onToggleNavigator={toggleNavigator}
            onCloseNavigator={closeNavigator}
            onUpdateBookmarkLabel={updateActiveBookmarkLabel}
            onRegisterTurnRequest={registerReaderTurnRequest}
            onNextVolume={nextPublication ? () => void openPublication(nextPublication) : undefined}
            nextVolumeTitle={nextPublication?.title}
          />
          </Suspense>
        ) : (
          <LibraryView
            publications={library}
            query={query}
            sort={sort}
            diagnostic={diagnostic}
            isImporting={isImporting}
            importProgress={importProgress}
            canRetryImport={retryableNativePaths !== null && retryableNativePaths.length > 0}
            onQueryChange={setQuery}
            onSortChange={setSort}
            onOpen={openPublication}
            onImport={handleImport}
            isNativeRuntime={nativeRuntime}
            onImportNative={() => void handleNativeImport({ kind: 'files' })}
            onImportFolder={() => void handleNativeImport({ kind: 'folder' })}
            onRetryImport={() => {
              if (retryableNativePaths && retryableNativePaths.length > 0) {
                void handleNativeImport({ kind: 'paths', paths: retryableNativePaths });
              }
            }}
            onOpenSettings={() => {
              void refreshCacheInfo();
              setShowProfile(true);
            }}
            onToggleFavorite={(publication) => void toggleFavorite(publication)}
            onMarkRead={markPublicationRead}
            onDelete={(publication) => removePublication(publication)}
            onReplaceCover={replaceBrowserCover}
            onCoverError={handleBrowserCoverError}
            onChooseNativeCover={replaceNativeCover}
            onResetCover={resetPublicationCover}
            onRebuildCache={handleRebuildPublicationCache}
            favoriteOnly={favoriteOnly}
            onFavoriteOnlyChange={setFavoriteOnly}
            formatFilter={formatFilter}
            onFormatFilterChange={setFormatFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            settingsTriggerRef={settingsTriggerRef}
          />
        )}
      </div>

      {isSmokeMode(import.meta.env.VITE_SMOKE_TEST === '1', nativeRuntime) && (
        <SmokeHarness
          onImportPath={async (path) => {
            const imported = await handleNativeImport({ kind: 'paths', paths: [path] });
            if (!imported) {
              throw new Error('Native import did not create a publication.');
            }
          }}
          diagnostic={diagnostic ?? null}
          importSequence={smokeImportSequence}
        />
      )}

      {showProfile && (
        <>
          <div className="profile-backdrop" aria-hidden="true" />
          <ProfilePanel
            profile={profile}
            profiles={profileStore.profiles}
            activeProfileId={profileStore.activeProfileId}
            capturingAction={capturingAction}
            onChange={previewProfile}
            onSelectProfile={selectReadingProfile}
            onCreateProfile={createReadingProfile}
            onDuplicateProfile={duplicateReadingProfile}
            onRenameProfile={renameReadingProfile}
            onDeleteProfile={deleteReadingProfile}
            onStartCapture={setCapturingAction}
            onReset={() => {
              handleProfileReset();
              setCapturingAction(null);
            }}
            cacheInfo={cacheInfo}
            onSetCacheLimit={updateCacheLimit}
            onClearCache={clearCache}
            cacheAvailable={nativeRuntime}
            isPreviewing={profilePreview?.id === profileStore.activeProfileId}
            onSavePreview={saveProfilePreview}
            onUndoPreview={undoProfilePreview}
            onImportProfiles={importProfiles}
            onExportProfiles={exportProfiles}
            onLocaleChange={() => setAnnouncement(t('app.libraryReady'))}
            onExportData={exportData}
            onImportData={importData}
            triggerRef={settingsTriggerRef}
            onClose={() => {
              setCapturingAction(null);
              setShowProfile(false);
            }}
          />
        </>
      )}

      <LiveAnnouncement message={announcement} />
    </div>
  );
}
