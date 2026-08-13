import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoPublication } from '../data/demo';
import { canRunActionWhileSettingsOpen, InputMap } from '../domain/input';
import { createPageSelectionCoordinator, selectLatestPage, type PageSelectionRequest } from '../domain/pageSelection';
import { calculateProgress, movePage, clamp } from '../domain/reader';
import { nextBookmark } from '../domain/library';
import { defaultReaderState } from '../domain/readerState';
import type { ActionName, Bookmark, CacheInfo, PageDescriptor, Publication, ReaderState, ReadingProfile } from '../domain/types';
import { importFiles } from '../services/importers';
import {
  chooseNativeFiles,
  chooseNativeFolder,
  importNativePaths,
  isNativeRuntime,
  listNativePublications,
  loadNativeProfile,
  saveNativeProfile,
  saveNativeProgress,
  clearNativeCache,
  deleteNativePublication,
  ensureNativePage,
  getNativeCacheInfo,
  setNativeCacheLimit,
} from '../services/nativeLibrary';
import {
  listBookmarksForPublication,
  loadReaderStateForPublication,
  removeBookmarkForPublication,
  saveBookmarkForPublication,
  saveReaderStateForPublication,
  toggleFavoriteForPublication,
} from '../services/readerState';
import { hasStoredProfile, loadFavorites, loadProfile, loadProgress, resetProfile, saveProfile, saveProgress } from '../services/storage';
import { LibraryView } from './LibraryView';
import { ProfilePanel } from './ProfilePanel';
import { ReaderView } from './ReaderView';

function initialLibrary(direction: ReadingProfile['direction']): Publication[] {
  const demo = createDemoPublication();
  demo.isFavorite = loadFavorites().includes(demo.id);
  const savedPage = loadProgress(demo.id);
  demo.currentPage = direction === 'rtl' && savedPage === 0 ? demo.pages.length - 1 : Math.min(savedPage, demo.pages.length - 1);
  demo.progress = calculateProgress(demo.currentPage, demo.pages.length, direction);
  return [demo];
}

const DEFAULT_CACHE_INFO: CacheInfo = {
  usedBytes: 0,
  maxBytes: 2 * 1024 * 1024 * 1024,
  entryCount: 0,
};

export function App() {
  const nativeRuntime = isNativeRuntime();
  const [profile, setProfile] = useState<ReadingProfile>(() => loadProfile());
  const [library, setLibrary] = useState<Publication[]>(() => initialLibrary(profile.direction));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [capturingAction, setCapturingAction] = useState<ActionName | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark[]>>({});
  const [readerStates, setReaderStates] = useState<Record<string, ReaderState>>({});
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>(DEFAULT_CACHE_INFO);
  const [isImporting, setIsImporting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState('Library ready.');
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const metadataGenerationRef = useRef(0);
  const favoriteInFlightRef = useRef(new Set<string>());
  const pageSelectionCoordinatorRef = useRef(createPageSelectionCoordinator());

  const activePublication = library.find((publication) => publication.id === activeId);
  const activePublicationIdRef = useRef<string | null>(activePublication?.id ?? null);
  activePublicationIdRef.current = activePublication?.id ?? null;
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const inputMap = useMemo(() => new InputMap(profile.bindings), [profile.bindings]);

  const refreshCacheInfo = useCallback(async () => {
    try {
      setCacheInfo(await getNativeCacheInfo());
    } catch {
      setDiagnostic('Cache usage could not be read. Your original files were not modified.');
    }
  }, []);

  const hydrateMetadata = useCallback(async (publications: Publication[]) => {
    const generation = ++metadataGenerationRef.current;
    const publicationIds = new Set(publications.map((publication) => publication.id));
    try {
      const metadata = await Promise.all(publications.map(async (publication) => {
        const [publicationBookmarks, readerState] = await Promise.all([
          listBookmarksForPublication(publication.id),
          loadReaderStateForPublication(publication.id),
        ]);
        return { id: publication.id, bookmarks: publicationBookmarks, readerState };
      }));
      if (generation !== metadataGenerationRef.current) {
        return;
      }
      setBookmarks(Object.fromEntries(metadata.filter((entry) => publicationIds.has(entry.id)).map((entry) => [entry.id, entry.bookmarks])));
      setReaderStates(Object.fromEntries(metadata.filter((entry) => publicationIds.has(entry.id)).map((entry) => [entry.id, entry.readerState])));
    } catch {
      if (generation === metadataGenerationRef.current) {
        setDiagnostic('Reader metadata could not be restored. Reading can continue in memory.');
      }
    }
  }, []);

  const reloadNativeLibraryWithEssentials = useCallback(async (direction: ReadingProfile['direction']) => {
    const initial = await listNativePublications(direction);
    let incomplete = false;
    const activePageId = activePublication?.pages[activePublication.currentPage]?.id;
    for (const publication of initial) {
      const pageIds = new Set([
        publication.pages[publication.currentPage]?.id,
        publication.pages.find((page) => page.id === publication.coverPageId)?.id,
      ].filter((pageId): pageId is string => Boolean(pageId)));
      for (const pageId of pageIds) {
        // Keep the page currently shown last so an LRU eviction cannot blank
        // the reader while the cache is being rebuilt.
        if (publication.id === activePublication?.id && pageId === activePageId) {
          continue;
        }
        try {
          const ensured = await ensureNativePage(publication.id, pageId);
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
        const ensured = await ensureNativePage(activePublication.id, activePageId);
        if (!ensured) {
          incomplete = true;
        }
      } catch {
        // A legacy publication may no longer have a rebuildable source. Keep
        // the rest of the library usable and surface that state to the UI.
        incomplete = true;
      }
    }
    const refreshed = await listNativePublications(direction);
    // The final native relist is authoritative: an earlier ensured descriptor
    // may already have been evicted by a later LRU rebuild step.
    if (refreshed.some((publication) => publication.pages.some((page) => !page.src))) {
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
  }, [activePublication]);

  useEffect(() => {
    if (!nativeRuntime) {
      return;
    }

    let cancelled = false;
    const bootNativeLibrary = async () => {
      try {
        const nativeProfile = await loadNativeProfile();
        const nextProfile = nativeProfile ?? profile;
        if (!nativeProfile) {
          await saveNativeProfile(hasStoredProfile() ? profile : nextProfile);
        }
        const nativeLibrary = await listNativePublications(nextProfile.direction);
        if (cancelled) {
          return;
        }
        if (nativeProfile) {
          setProfile(nativeProfile);
        }
        setLibrary(nativeLibrary);
        void hydrateMetadata(nativeLibrary);
        void refreshCacheInfo();
        setAnnouncement(nativeLibrary.length > 0 ? 'Native library ready.' : 'Native library is empty.');
      } catch {
        if (!cancelled) {
          setDiagnostic('The native library could not be opened. Your original files were not modified.');
          setAnnouncement('Native library unavailable.');
        }
      }
    };

    void bootNativeLibrary();
    return () => {
      cancelled = true;
      metadataGenerationRef.current += 1;
    };
  }, [hydrateMetadata, nativeRuntime, refreshCacheInfo]);

  useEffect(() => {
    if (nativeRuntime) {
      return;
    }
    void hydrateMetadata(library);
    void refreshCacheInfo();
  }, [hydrateMetadata, library, nativeRuntime, refreshCacheInfo]);

  const updateProfile = useCallback((patch: Partial<ReadingProfile>) => {
    setProfile((current) => {
      const next = { ...current, ...patch };
      saveProfile(next);
      if (nativeRuntime) {
        void saveNativeProfile(next).catch(() => {
          setDiagnostic('Reader preferences could not be saved to the native library.');
        });
      }
      return next;
    });
  }, [nativeRuntime]);

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
      setAnnouncement(nextFavorite ? `${publication.title} added to favorites.` : `${publication.title} removed from favorites.`);
    } catch {
      setDiagnostic('Favorite could not be saved. Your reading data was not changed.');
    } finally {
      favoriteInFlightRef.current.delete(publication.id);
    }
  }, [updatePublication]);

  const removePublication = useCallback(async (publication: Publication) => {
    metadataGenerationRef.current += 1;
    if (activeIdRef.current === publication.id) {
      pageSelectionCoordinatorRef.current.cancel();
    }
    try {
      await deleteNativePublication(publication.id);
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
      setAnnouncement(`${publication.title} removed. Original files were preserved.`);
    } catch {
      setDiagnostic('The publication could not be removed. Your original files were not modified.');
      throw new Error('delete-publication-failed');
    }
  }, [activeId, refreshCacheInfo]);

  const updateCacheLimit = useCallback(async (maxBytes: number) => {
    if (!nativeRuntime) {
      return;
    }
    let limitApplied = false;
    try {
      await setNativeCacheLimit(maxBytes);
      limitApplied = true;
      const { library: refreshedLibrary, incomplete } = await reloadNativeLibraryWithEssentials(profile.direction);
      setLibrary(refreshedLibrary);
      void hydrateMetadata(refreshedLibrary);
      await refreshCacheInfo();
      if (incomplete) {
        setDiagnostic('Some pages could not be rebuilt yet; the original files were preserved. They will retry when opened.');
        setAnnouncement('Cache limit saved with some pages unavailable until opened.');
      } else {
        setAnnouncement('Cache limit saved.');
      }
    } catch {
      if (limitApplied) {
        metadataGenerationRef.current += 1;
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        setDiagnostic('Cache limit was saved, but the library could not be refreshed. Reopen the app to reload it; original files were preserved.');
      } else {
        setDiagnostic('Cache limit could not be saved. Existing pages were kept.');
      }
    }
  }, [hydrateMetadata, nativeRuntime, profile.direction, refreshCacheInfo, reloadNativeLibraryWithEssentials]);

  const clearCache = useCallback(async () => {
    if (!nativeRuntime) {
      return;
    }
    let cacheCleared = false;
    try {
      await clearNativeCache();
      cacheCleared = true;
      const { library: readyLibrary, incomplete } = await reloadNativeLibraryWithEssentials(profile.direction);
      setLibrary(readyLibrary);
      void hydrateMetadata(readyLibrary);
      await refreshCacheInfo();
      if (incomplete) {
        setDiagnostic('Some pages could not be rebuilt yet; the original files were preserved. They will retry when opened.');
        setAnnouncement('Derived page cache cleared with some pages unavailable until opened.');
      } else {
        setAnnouncement('Derived page cache cleared. Original files were preserved.');
      }
    } catch {
      if (cacheCleared) {
        metadataGenerationRef.current += 1;
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        setDiagnostic('Cache was cleared, but the library could not be refreshed. Reopen the app to reload it; original files were preserved.');
      } else {
        setDiagnostic('Cache could not be cleared. Your original files were not modified.');
      }
    }
  }, [hydrateMetadata, nativeRuntime, profile.direction, refreshCacheInfo, reloadNativeLibraryWithEssentials]);

  const persistProgress = useCallback((publicationId: string, pageIndex: number) => {
    saveProgress(publicationId, pageIndex);
    if (nativeRuntime) {
      void saveNativeProgress(publicationId, pageIndex).catch(() => {
        setDiagnostic('Reading progress could not be saved to the native library.');
      });
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
      ) {
        return current;
      }
      return { ...current, [publicationId]: state };
    });
    try {
      await saveReaderStateForPublication(publicationId, state);
    } catch {
      setDiagnostic('Zoom and pan could not be saved. Reading can continue, but this change may not survive closing.');
    }
  }, []);

  const toggleBookmark = useCallback(async (publicationId: string, pageId: string) => {
    const current = bookmarks[publicationId] ?? [];
    const existing = current.find((bookmark) => bookmark.pageId === pageId);
    const next = nextBookmark(current, pageId, '', new Date().toISOString());
    setBookmarks((all) => ({ ...all, [publicationId]: next }));
    try {
      if (existing) {
        await removeBookmarkForPublication(publicationId, pageId);
      } else {
        const created = next.find((bookmark) => bookmark.pageId === pageId);
        if (created) {
          await saveBookmarkForPublication(publicationId, created);
        }
      }
    } catch {
      setBookmarks((all) => ({ ...all, [publicationId]: current }));
      setDiagnostic('Page bookmark could not be saved. Your other reading data was not changed.');
    }
  }, [bookmarks]);

  const selectPublicationPage = useCallback(async (
    publication: Publication,
    pageIndex: number,
    onCommit: (preparedPage: PageDescriptor | null, request: PageSelectionRequest) => void,
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
        if (!nativeRuntime) {
          return null;
        }
        const page = publication.pages[nextPage];
        const preparedPage = await ensureNativePage(publication.id, page?.id ?? '');
        if (!preparedPage) {
          throw new Error('page-unavailable');
        }
        return preparedPage;
      },
      onCommit,
      () => {
        setDiagnostic('This page could not be rebuilt from the original. Your file was not modified.');
      },
    );
  }, [nativeRuntime]);

  const moveActivePage = useCallback(
    async (delta: number) => {
      const current = activeIdRef.current
        ? libraryRef.current.find((publication) => publication.id === activeIdRef.current)
        : undefined;
      if (!current) {
        return;
      }

      const nextPage = movePage(current.currentPage, current.pages.length, profile.direction, delta);
      if (nextPage === current.currentPage) {
        pageSelectionCoordinatorRef.current.cancel();
        setAnnouncement(delta > 0 ? 'You are at the end of this publication.' : 'You are at the beginning of this publication.');
        return;
      }

      await selectPublicationPage(current, nextPage, (preparedPage, request) => {
        if (activePublicationIdRef.current !== request.publicationId) {
          return;
        }
        const latest = libraryRef.current.find((publication) => publication.id === request.publicationId);
        if (!latest) {
          return;
        }
        updatePublication(request.publicationId, (publication) => ({
          ...publication,
          pages: preparedPage
            ? publication.pages.map((page) => page.id === preparedPage.id ? preparedPage : page)
            : publication.pages,
          currentPage: request.pageIndex,
          progress: calculateProgress(request.pageIndex, publication.pages.length, profile.direction),
          updatedAt: new Date().toISOString(),
        }));
        persistProgress(request.publicationId, request.pageIndex);
        setAnnouncement(`Page ${request.pageIndex + 1} of ${latest.pages.length}.`);
      });
    },
    [profile.direction, persistProgress, selectPublicationPage, updatePublication],
  );

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
      await selectPublicationPage(current, nextPage, (preparedPage, request) => {
        if (activePublicationIdRef.current !== request.publicationId) {
          return;
        }
        const latest = libraryRef.current.find((publication) => publication.id === request.publicationId);
        if (!latest) {
          return;
        }
        updatePublication(request.publicationId, (publication) => ({
          ...publication,
          pages: preparedPage
            ? publication.pages.map((page) => page.id === preparedPage.id ? preparedPage : page)
            : publication.pages,
          currentPage: request.pageIndex,
          progress: calculateProgress(request.pageIndex, publication.pages.length, profile.direction),
          updatedAt: new Date().toISOString(),
        }));
        persistProgress(request.publicationId, request.pageIndex);
        setAnnouncement(`Page ${request.pageIndex + 1} of ${latest.pages.length}.`);
      });
    },
    [profile.direction, persistProgress, selectPublicationPage, updatePublication],
  );

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

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setAnnouncement('Fullscreen is not available in this environment.');
    }
  }, []);

  const handleAction = useCallback(
    (action: ActionName) => {
      switch (action) {
        case 'next_page':
          moveActivePage(1);
          break;
        case 'previous_page':
          moveActivePage(-1);
          break;
        case 'toggle_library':
          pageSelectionCoordinatorRef.current.cancel();
          setActiveId(null);
          setShowProfile(false);
          setAnnouncement('Library opened.');
          break;
        case 'toggle_fullscreen':
          void toggleFullscreen();
          break;
        case 'toggle_settings':
          setShowProfile((current) => !current);
          break;
        case 'toggle_spread':
          updateProfile({ mode: profile.mode === 'single' ? 'spread' : 'single' });
          setAnnouncement(`Reading mode: ${profile.mode === 'single' ? 'spread' : 'single'} pages.`);
          break;
        case 'cancel':
          pageSelectionCoordinatorRef.current.cancel();
          if (showProfile) {
            setShowProfile(false);
          } else {
            setActiveId(null);
          }
          setCapturingAction(null);
          break;
      }
    },
    [moveActivePage, profile.mode, showProfile, toggleFullscreen, updateProfile],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (capturingAction) {
        event.preventDefault();
        if (event.code === 'Escape') {
          setCapturingAction(null);
          setAnnouncement('Key capture cancelled.');
          return;
        }

        const result = inputMap.bind(capturingAction, event.code);
        if (!result.ok) {
          setAnnouncement(`${event.code} is already assigned to ${result.conflict.replace('_', ' ')}.`);
          return;
        }

        updateProfile({ bindings: inputMap.getBindings() });
        setCapturingAction(null);
        setAnnouncement(`${event.code} assigned to ${capturingAction.replace('_', ' ')}.`);
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

  const openPublication = async (publication: Publication) => {
    const startsAtFreshRtlPage =
      profile.direction === 'rtl' &&
      publication.currentPage === 0 &&
      publication.progress <= 1 / Math.max(publication.pages.length, 1);
    const openingPublication = startsAtFreshRtlPage
      ? {
          ...publication,
          currentPage: Math.max(publication.pages.length - 1, 0),
          progress: calculateProgress(Math.max(publication.pages.length - 1, 0), publication.pages.length, 'rtl'),
        }
      : publication;

    await selectPublicationPage(openingPublication, openingPublication.currentPage, (preparedPage, request) => {
      const readyPublication = {
        ...openingPublication,
        pages: preparedPage
          ? openingPublication.pages.map((page) => page.id === preparedPage.id ? preparedPage : page)
          : openingPublication.pages,
        currentPage: request.pageIndex,
        progress: calculateProgress(request.pageIndex, openingPublication.pages.length, profile.direction),
      };
      setLibrary((current) => {
        if (current.some((entry) => entry.id === readyPublication.id)) {
          return current.map((entry) => entry.id === readyPublication.id ? readyPublication : entry);
        }
        return [readyPublication, ...current];
      });
      if (readyPublication.currentPage !== publication.currentPage || readyPublication !== publication) {
        persistProgress(readyPublication.id, readyPublication.currentPage);
      }
      setActiveId(readyPublication.id);
      setShowProfile(false);
      setDiagnostic(undefined);
      setAnnouncement(`${readyPublication.title} opened. Page ${readyPublication.currentPage + 1} of ${readyPublication.pages.length}.`);
    });
  };

  const handleImport = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setIsImporting(true);
    setDiagnostic(undefined);
    const result = await importFiles(files);
    setIsImporting(false);

    if (!result.publication) {
      setDiagnostic(result.diagnostic ?? 'The publication could not be imported.');
      setAnnouncement(result.diagnostic ?? 'Import failed.');
      return;
    }

    const importedPublication = result.publication as Publication;
    const openingPublication = profile.direction === 'rtl'
      ? {
          ...importedPublication,
          currentPage: Math.max(importedPublication.pages.length - 1, 0),
          progress: calculateProgress(Math.max(importedPublication.pages.length - 1, 0), importedPublication.pages.length, 'rtl'),
        }
      : importedPublication;
    setLibrary((current) => [openingPublication, ...current]);
    void openPublication(openingPublication);
    setAnnouncement(`${openingPublication.title} imported locally.`);
  };

  const handleNativeImport = async (selectFolder: boolean) => {
    setIsImporting(true);
    setDiagnostic(undefined);
    try {
      const paths = selectFolder ? await chooseNativeFolder() : await chooseNativeFiles();
      if (paths.length === 0) {
        setAnnouncement('Import cancelled.');
        return;
      }

      const result = await importNativePaths(paths, profile.direction);
      const diagnosticMessage = result.diagnostics.length > 0 ? result.diagnostics.join(' ') : undefined;
      setDiagnostic(diagnosticMessage);
      if (result.publications.length === 0) {
        setAnnouncement(diagnosticMessage ?? 'No supported native publication was found.');
        return;
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
      void openPublication(openingPublication);
      setAnnouncement(`${openingPublication.title} imported into the native library.`);
    } catch {
      setDiagnostic('The native import failed. The original files were not modified.');
      setAnnouncement('Native import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleProfileReset = () => {
    const fresh = resetProfile();
    setProfile(fresh);
    if (nativeRuntime) {
      void saveNativeProfile(fresh).catch(() => {
        setDiagnostic('Reader preferences could not be reset in the native library.');
      });
    }
    setCapturingAction(null);
    setAnnouncement('Reader preferences reset.');
  };

  return (
    <div className="app-shell" data-contrast={profile.contrast}>
      <div className="ambient-mark ambient-mark--one" aria-hidden="true" />
      <div className="ambient-mark ambient-mark--two" aria-hidden="true" />

      <div className="app-content" inert={showProfile} aria-hidden={showProfile || undefined}>
        {activePublication ? (
          <ReaderView
            publication={activePublication}
            profile={profile}
            announcement={announcement}
            onBack={() => {
              pageSelectionCoordinatorRef.current.cancel();
              setActiveId(null);
            }}
            onNext={() => moveActivePage(1)}
            onPrevious={() => moveActivePage(-1)}
            onToggleSettings={() => setShowProfile((current) => !current)}
            onToggleFullscreen={() => void toggleFullscreen()}
            onFlowCorrected={() => setAnnouncement('Panel order corrected and saved for this publication.')}
            onFlowManualRoute={() => setAnnouncement('Full-page reading enabled for this page.')}
            nativeRuntime={nativeRuntime}
            settingsTriggerRef={settingsTriggerRef}
            bookmarks={bookmarks[activePublication.id] ?? []}
            readerState={readerStates[activePublication.id] ?? defaultReaderState}
            onSaveReaderState={saveActiveReaderState}
            onSelectPage={selectActivePage}
            onToggleBookmark={toggleActiveBookmark}
          />
        ) : (
          <LibraryView
            publications={library}
            query={query}
            sort={sort}
            diagnostic={diagnostic}
            isImporting={isImporting}
            onQueryChange={setQuery}
            onSortChange={setSort}
            onOpen={openPublication}
            onImport={handleImport}
            isNativeRuntime={nativeRuntime}
            onImportNative={() => void handleNativeImport(false)}
            onImportFolder={() => void handleNativeImport(true)}
            onOpenSettings={() => {
              void refreshCacheInfo();
              setShowProfile(true);
            }}
            onToggleFavorite={(publication) => void toggleFavorite(publication)}
            onDelete={(publication) => removePublication(publication)}
            favoriteOnly={favoriteOnly}
            onFavoriteOnlyChange={setFavoriteOnly}
            settingsTriggerRef={settingsTriggerRef}
          />
        )}
      </div>

      {showProfile && (
        <>
          <div className="profile-backdrop" aria-hidden="true" />
          <ProfilePanel
            profile={profile}
            capturingAction={capturingAction}
            onChange={updateProfile}
            onStartCapture={setCapturingAction}
            onReset={handleProfileReset}
            cacheInfo={cacheInfo}
            onSetCacheLimit={updateCacheLimit}
            onClearCache={clearCache}
            cacheAvailable={nativeRuntime}
            triggerRef={settingsTriggerRef}
            onClose={() => {
              setCapturingAction(null);
              setShowProfile(false);
            }}
          />
        </>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
