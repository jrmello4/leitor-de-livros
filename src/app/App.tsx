import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoPublication } from '../data/demo';
import { canRunActionWhileSettingsOpen, InputMap } from '../domain/input';
import { createPageSelectionCoordinator, selectLatestPage, type PageSelectionRequest } from '../domain/pageSelection';
import { calculateProgress, movePage, clamp, visiblePageIndexes } from '../domain/reader';
import { nextBookmark, type LibrarySort } from '../domain/library';
import {
  createDefaultProfile,
  createProfile,
  deleteProfile,
  duplicateProfile,
  getActiveProfile,
  mergeProfileStore,
  parseProfileTransfer,
  renameProfile,
  serializeProfileTransfer,
  selectProfile,
  updateProfile as updateNamedProfile,
  type ProfileMutation,
  type ProfileStore,
  type NamedReadingProfile,
} from '../domain/profiles';
import { defaultReaderState } from '../domain/readerState';
import type { ActionName, Bookmark, CacheInfo, PageDescriptor, Publication, ReaderState, ReadingProfile } from '../domain/types';
import { actionLabel, t } from '../i18n/catalog';
import { importFiles } from '../services/importers';
import {
  chooseNativeFiles,
  chooseNativeCover,
  chooseNativeFolder,
  clearNativeCover,
  importNativePaths,
  isNativeRuntime,
  listNativePublications,
  loadNativeProfileStore,
  saveNativeProfileStore,
  saveNativeProgress,
  clearNativeCache,
  deleteNativePublication,
  ensureNativePage,
  getNativeCacheInfo,
  setNativeCacheLimit,
  setNativeCover,
} from '../services/nativeLibrary';
import {
  listBookmarksForPublication,
  loadReaderStateForPublication,
  removeBookmarkForPublication,
  saveBookmarkForPublication,
  saveReaderStateForPublication,
  toggleFavoriteForPublication,
} from '../services/readerState';
import { clearCustomCover, readBrowserCover, saveCustomCover } from '../services/covers';
import {
  loadFavorites,
  loadCustomCover,
  loadProfileStore,
  loadProgress,
  saveProfileStore,
  saveProgress,
} from '../services/storage';
import { LibraryView } from './LibraryView';
import { ProfilePanel } from './ProfilePanel';
import { ReaderView } from './ReaderView';

function initialLibrary(direction: ReadingProfile['direction']): Publication[] {
  const demo = createDemoPublication();
  demo.isFavorite = loadFavorites().includes(demo.id);
  demo.customCover = loadCustomCover(demo.id);
  const savedPage = loadProgress(demo.id);
  demo.currentPage = direction === 'rtl' && savedPage === 0 ? demo.pages.length - 1 : Math.min(savedPage, demo.pages.length - 1);
  demo.progress = calculateProgress(demo.currentPage, demo.pages.length, direction);
  return [demo];
}

function activeWorkingSetPageIds(publication: Publication, profile: ReadingProfile): string[] {
  const indexes = new Set([
    ...visiblePageIndexes(publication.currentPage, publication.pages, profile.mode, profile.direction),
    publication.currentPage - 1,
    publication.currentPage,
    publication.currentPage + 1,
  ]);
  return [...indexes]
    .filter((index) => index >= 0 && index < publication.pages.length)
    .map((index) => publication.pages[index]?.id)
    .filter((id): id is string => Boolean(id));
}

const DEFAULT_CACHE_INFO: CacheInfo = {
  usedBytes: 0,
  maxBytes: 2 * 1024 * 1024 * 1024,
  entryCount: 0,
};

export function App() {
  const nativeRuntime = isNativeRuntime();
  const [profileStore, setProfileStore] = useState<ProfileStore>(() => loadProfileStore());
  const [profilePreview, setProfilePreview] = useState<NamedReadingProfile | null>(null);
  const profile = useMemo(() => {
    const saved = getActiveProfile(profileStore);
    return profilePreview?.id === saved.id ? profilePreview : saved;
  }, [profilePreview, profileStore]);
  const [library, setLibrary] = useState<Publication[]>(() => initialLibrary(profile.direction));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [navigatorVisible, setNavigatorVisible] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [capturingAction, setCapturingAction] = useState<ActionName | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark[]>>({});
  const [readerStates, setReaderStates] = useState<Record<string, ReaderState>>({});
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>(DEFAULT_CACHE_INFO);
  const [isImporting, setIsImporting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState(() => t('app.libraryReady'));
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const navigatorTriggerRef = useRef<HTMLButtonElement>(null);
  const readerTurnRequestRef = useRef<((delta: number) => void) | null>(null);
  const metadataGenerationRef = useRef(0);
  const favoriteInFlightRef = useRef(new Set<string>());
  const pageSelectionCoordinatorRef = useRef(createPageSelectionCoordinator());
  const profileStoreRef = useRef(profileStore);
  profileStoreRef.current = profileStore;

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
      setDiagnostic(t('app.cacheUsageError'));
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
        setDiagnostic(t('app.metadataError'));
      }
    }
  }, []);

  const reloadNativeLibraryWithEssentials = useCallback(async (direction: ReadingProfile['direction']) => {
    const initial = await listNativePublications(direction);
    let incomplete = false;
    const activePageId = activePublication?.pages[activePublication.currentPage]?.id;
    const activeProtectedPageIds = activePublication
      ? activeWorkingSetPageIds(activePublication, profile)
      : [];
    for (const publication of initial) {
      const pageIds = new Set([
        publication.pages[publication.currentPage]?.id,
        publication.pages.find((page) => page.id === publication.coverPageId)?.id,
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
  }, [activePublication, profile]);

  useEffect(() => {
    if (!nativeRuntime) {
      return;
    }

    let cancelled = false;
    const bootNativeLibrary = async () => {
      try {
        const nativeProfileStore = await loadNativeProfileStore();
        const nextProfileStore = nativeProfileStore ?? profileStoreRef.current;
        const nextProfile = getActiveProfile(nextProfileStore);
        // Saving the normalized store also upgrades a legacy flat native row
        // after it has been migrated in memory.
        await saveNativeProfileStore(nextProfileStore);
        const nativeLibrary = await listNativePublications(nextProfile.direction);
        if (cancelled) {
          return;
        }
        if (nativeProfileStore) {
          setProfileStore(nativeProfileStore);
          profileStoreRef.current = nativeProfileStore;
        }
        setLibrary(nativeLibrary);
        void hydrateMetadata(nativeLibrary);
        void refreshCacheInfo();
        setAnnouncement(nativeLibrary.length > 0 ? t('app.nativeLibraryReady') : t('app.nativeLibraryEmpty'));
      } catch {
        if (!cancelled) {
          setDiagnostic(t('app.nativeOpenError'));
          setAnnouncement(t('app.nativeUnavailable'));
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

  const persistProfileStore = useCallback((store: ProfileStore) => {
    if (!saveProfileStore(store)) {
      setDiagnostic(t('app.profileSaveError'));
    }
    if (nativeRuntime) {
      void saveNativeProfileStore(store).catch(() => {
        setDiagnostic(t('app.nativeProfileSaveError'));
      });
    }
  }, [nativeRuntime]);

  const applyProfileZoom = useCallback((nextProfile: ReadingProfile) => {
    const currentId = activeIdRef.current;
    if (!currentId) {
      return;
    }
    setReaderStates((current) => ({
      ...current,
      [currentId]: {
        ...(current[currentId] ?? defaultReaderState),
        zoomMode: nextProfile.zoomMode,
        zoomScale: nextProfile.zoomScale,
        panX: 0,
        panY: 0,
      },
    }));
  }, []);

  const commitProfileMutation = useCallback((mutation: ProfileMutation, message: string): string | undefined => {
    if (!mutation.ok) {
      const errorMessage = t(mutation.error);
      setDiagnostic(errorMessage);
      return errorMessage;
    }
    setProfileStore(mutation.store);
    setProfilePreview(null);
    profileStoreRef.current = mutation.store;
    persistProfileStore(mutation.store);
    applyProfileZoom(getActiveProfile(mutation.store));
    setCapturingAction(null);
    setAnnouncement(message);
    return undefined;
  }, [applyProfileZoom, persistProfileStore]);

  const updateProfile = useCallback((patch: Partial<ReadingProfile>) => {
    const mutation = updateNamedProfile(
      profileStoreRef.current,
      profileStoreRef.current.activeProfileId,
      patch,
    );
    commitProfileMutation(mutation, t('app.profileUpdated'));
  }, [commitProfileMutation]);

  const previewProfile = useCallback((patch: Partial<ReadingProfile>) => {
    const savedStore = profileStoreRef.current;
    const activeId = savedStore.activeProfileId;
    const baseStore: ProfileStore = profilePreview?.id === activeId
      ? {
          ...savedStore,
          profiles: savedStore.profiles.map((candidate) => candidate.id === activeId ? profilePreview : candidate),
        }
      : savedStore;
    const mutation = updateNamedProfile(baseStore, activeId, patch);
    if (!mutation.ok) {
      const errorMessage = t(mutation.error);
      setDiagnostic(errorMessage);
      return errorMessage;
    }
    const nextPreview = getActiveProfile(mutation.store);
    setProfilePreview(nextPreview);
    applyProfileZoom(nextPreview);
    setDiagnostic(undefined);
    return undefined;
  }, [applyProfileZoom, profilePreview]);

  const saveProfilePreview = useCallback(() => {
    if (!profilePreview || profilePreview.id !== profileStoreRef.current.activeProfileId) {
      return;
    }
    commitProfileMutation(
      updateNamedProfile(profileStoreRef.current, profilePreview.id, profilePreview),
      t('app.profilePreviewSaved'),
    );
  }, [commitProfileMutation, profilePreview]);

  const undoProfilePreview = useCallback(() => {
    if (!profilePreview) {
      return;
    }
    setProfilePreview(null);
    applyProfileZoom(getActiveProfile(profileStoreRef.current));
    setAnnouncement(t('app.profilePreviewUndone'));
  }, [applyProfileZoom, profilePreview]);

  const importProfiles = useCallback((text: string) => {
    const parsed = parseProfileTransfer(text);
    if (!parsed.ok) {
      const errorMessage = t(parsed.error);
      setDiagnostic(errorMessage);
      return errorMessage;
    }
    return commitProfileMutation(
      mergeProfileStore(profileStoreRef.current, parsed.value),
      t('app.profileImported'),
    );
  }, [commitProfileMutation]);

  const exportProfiles = useCallback(() => {
    try {
      const blob = new Blob([serializeProfileTransfer(profileStoreRef.current)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tactile-reading-profiles.json';
      link.click();
      URL.revokeObjectURL(url);
      setAnnouncement(t('app.profileExported'));
    } catch {
      setDiagnostic(t('app.profileTransferError'));
    }
  }, []);

  const selectReadingProfile = useCallback((profileId: string) => (
    commitProfileMutation(
      selectProfile(profileStoreRef.current, profileId),
      t('app.profileSelected'),
    )
  ), [commitProfileMutation]);

  const createReadingProfile = useCallback((name: string) => (
    commitProfileMutation(
      createProfile(profileStoreRef.current, name),
      t('app.profileCreated'),
    )
  ), [commitProfileMutation]);

  const duplicateReadingProfile = useCallback(() => (
    commitProfileMutation(
      duplicateProfile(profileStoreRef.current, profileStoreRef.current.activeProfileId),
      t('app.profileDuplicated'),
    )
  ), [commitProfileMutation]);

  const renameReadingProfile = useCallback((name: string) => (
    commitProfileMutation(
      renameProfile(profileStoreRef.current, profileStoreRef.current.activeProfileId, name),
      t('app.profileRenamed'),
    )
  ), [commitProfileMutation]);

  const deleteReadingProfile = useCallback(() => (
    commitProfileMutation(
      deleteProfile(profileStoreRef.current, profileStoreRef.current.activeProfileId),
      t('app.profileDeleted'),
    )
  ), [commitProfileMutation]);

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

  const replaceBrowserCover = useCallback(async (publication: Publication, file: File) => {
    try {
      const cover = await readBrowserCover(file);
      saveCustomCover(publication.id, cover);
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
        clearCustomCover(publication.id);
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
      setAnnouncement(t('app.publicationRemoved', { title: publication.title }));
    } catch {
      setDiagnostic(t('app.publicationRemoveError'));
      throw new Error('delete-publication-failed');
    }
  }, [activeId, refreshCacheInfo]);

  const updateCacheLimit = useCallback(async (maxBytes: number) => {
    if (!nativeRuntime) {
      return;
    }
    let limitApplied = false;
    try {
      const active = activeIdRef.current
        ? libraryRef.current.find((publication) => publication.id === activeIdRef.current)
        : undefined;
      await setNativeCacheLimit(maxBytes, active ? activeWorkingSetPageIds(active, profile) : []);
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
        metadataGenerationRef.current += 1;
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        setDiagnostic(t('app.cacheRefreshError'));
      } else {
        setDiagnostic(t('app.cacheLimitError'));
      }
    }
  }, [hydrateMetadata, nativeRuntime, profile.direction, profile.mode, refreshCacheInfo, reloadNativeLibraryWithEssentials]);

  const clearCache = useCallback(async () => {
    if (!nativeRuntime) {
      return;
    }
    let cacheCleared = false;
    try {
      const active = activeIdRef.current
        ? libraryRef.current.find((publication) => publication.id === activeIdRef.current)
        : undefined;
      await clearNativeCache(active ? activeWorkingSetPageIds(active, profile) : []);
      cacheCleared = true;
      const { library: readyLibrary, incomplete } = await reloadNativeLibraryWithEssentials(profile.direction);
      setLibrary(readyLibrary);
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
        metadataGenerationRef.current += 1;
        setActiveId(null);
        setLibrary([]);
        setBookmarks({});
        setReaderStates({});
        setDiagnostic(t('app.cacheClearRefreshError'));
      } else {
        setDiagnostic(t('app.cacheClearError'));
      }
    }
  }, [hydrateMetadata, nativeRuntime, profile.direction, profile.mode, refreshCacheInfo, reloadNativeLibraryWithEssentials]);

  const persistProgress = useCallback((publicationId: string, pageIndex: number) => {
    saveProgress(publicationId, pageIndex);
    if (nativeRuntime) {
      void saveNativeProgress(publicationId, pageIndex).catch(() => {
        setDiagnostic(t('app.progressSaveError'));
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
      setDiagnostic(t('app.readerStateSaveError'));
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
      setDiagnostic(t('app.bookmarkSaveError'));
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
        const protectedPageIds = page
          ? [...new Set([...activeWorkingSetPageIds(publication, profile), page.id])]
          : activeWorkingSetPageIds(publication, profile);
        const preparedPage = await ensureNativePage(publication.id, page?.id ?? '', protectedPageIds);
        if (!preparedPage) {
          throw new Error('page-unavailable');
        }
        return preparedPage;
      },
      onCommit,
      () => {
        setDiagnostic(t('app.pageRebuildError'));
      },
    );
  }, [nativeRuntime, profile]);

  const commitActivePageSelection = useCallback((
    preparedPage: PageDescriptor | null,
    request: PageSelectionRequest,
  ) => {
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
    setAnnouncement(t('app.pageReady', { page: request.pageIndex + 1, count: latest.pages.length }));
  }, [persistProgress, profile.direction, updatePublication]);

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
        setAnnouncement(delta > 0 ? t('app.endOfPublication') : t('app.beginningOfPublication'));
        return;
      }

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
    if (!activePublication) {
      return;
    }
    const current = bookmarks[activePublication.id] ?? [];
    const existing = current.find((bookmark) => bookmark.pageId === pageId);
    if (!existing) {
      return;
    }
    const normalizedLabel = label.trim().slice(0, 120) || t('navigator.defaultBookmark');
    const next = current.map((bookmark) => bookmark.pageId === pageId
      ? { ...bookmark, label: normalizedLabel, updatedAt: new Date().toISOString() }
      : bookmark);
    setBookmarks((all) => ({ ...all, [activePublication.id]: next }));
    void saveBookmarkForPublication(activePublication.id, next.find((bookmark) => bookmark.pageId === pageId)!).catch(() => {
      setBookmarks((all) => ({ ...all, [activePublication.id]: current }));
      setDiagnostic(t('app.bookmarkSaveError'));
    });
  }, [activePublication?.id, bookmarks]);

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
          setShowProfile((current) => !current);
          break;
        case 'toggle_spread':
          updateProfile({ mode: profile.mode === 'single' ? 'spread' : 'single' });
          setAnnouncement(t('app.readingMode', { mode: profile.mode === 'single' ? t('profile.spread').toLowerCase() : t('profile.single').toLowerCase() }));
          break;
        case 'cancel':
          pageSelectionCoordinatorRef.current.cancel();
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
    [activePublication, dispatchPageTurn, profile.mode, showProfile, toggleActiveBookmark, toggleFullscreen, toggleNavigator, updateProfile],
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
      setAnnouncement(t('app.publicationOpened', { title: readyPublication.title, page: readyPublication.currentPage + 1, count: readyPublication.pages.length }));
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
      setDiagnostic(result.diagnostic ?? t('app.importError'));
      setAnnouncement(result.diagnostic ?? t('app.importFailed'));
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
    setAnnouncement(t('app.publicationImportedBrowser', { title: openingPublication.title }));
  };

  const handleNativeImport = async (selectFolder: boolean) => {
    setIsImporting(true);
    setDiagnostic(undefined);
    try {
      const paths = selectFolder ? await chooseNativeFolder() : await chooseNativeFiles();
      if (paths.length === 0) {
        setAnnouncement(t('app.importCancelled'));
        return;
      }

      const result = await importNativePaths(paths, profile.direction);
      const diagnosticMessage = result.diagnostics.length > 0 ? result.diagnostics.join(' ') : undefined;
      setDiagnostic(diagnosticMessage);
      if (result.publications.length === 0) {
        setAnnouncement(t('app.nativeNoPublication'));
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
      setAnnouncement(t('app.publicationImportedNative', { title: openingPublication.title }));
    } catch {
      setDiagnostic(t('app.nativeImportError'));
      setAnnouncement(t('app.nativeImportFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleProfileReset = () => {
    const current = profileStoreRef.current;
    const defaults = createDefaultProfile();
    commitProfileMutation(
      updateNamedProfile(current, current.activeProfileId, {
        mode: defaults.mode,
        direction: defaults.direction,
        contrast: defaults.contrast,
        reducedMotion: defaults.reducedMotion,
        pageTurnDuration: defaults.pageTurnDuration,
        layoutZone: defaults.layoutZone,
        zoomMode: defaults.zoomMode,
        zoomScale: defaults.zoomScale,
        bindings: defaults.bindings,
      }),
      t('app.profileReset'),
    );
    setCapturingAction(null);
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
              setNavigatorVisible(false);
              setActiveId(null);
            }}
            onNext={() => moveActivePage(1)}
            onPrevious={() => moveActivePage(-1)}
            onToggleSettings={() => setShowProfile((current) => !current)}
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
            onToggleBookmark={toggleActiveBookmark}
            navigatorVisible={navigatorVisible}
            navigatorTriggerRef={navigatorTriggerRef}
            onToggleNavigator={toggleNavigator}
            onCloseNavigator={closeNavigator}
            onUpdateBookmarkLabel={updateActiveBookmarkLabel}
            onRegisterTurnRequest={registerReaderTurnRequest}
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
            onReplaceCover={replaceBrowserCover}
            onChooseNativeCover={replaceNativeCover}
            onResetCover={resetPublicationCover}
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
            onReset={handleProfileReset}
            cacheInfo={cacheInfo}
            onSetCacheLimit={updateCacheLimit}
            onClearCache={clearCache}
            cacheAvailable={nativeRuntime}
            isPreviewing={profilePreview?.id === profileStore.activeProfileId}
            onSavePreview={saveProfilePreview}
            onUndoPreview={undoProfilePreview}
            onImportProfiles={importProfiles}
            onExportProfiles={exportProfiles}
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
