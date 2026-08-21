import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoPublication } from '../data/demo';
import { canRunActionWhileSettingsOpen, InputMap } from '../domain/input';
import { createPageSelectionCoordinator, preparePageSelection, selectLatestPage, warmWorkingSet, type PageSelectionRequest } from '../domain/pageSelection';
import { activeWorkingSetPageIds, calculateProgress, movePage, clamp } from '../domain/reader';
import { nextBookmark, type FormatFilter, type LibrarySort, type ReadingStatusFilter } from '../domain/library';
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
import '../i18n/register-locales';
import { importFiles } from '../services/importers';
import {
  chooseNativeFiles,
  chooseNativeCover,
  chooseNativeFolder,
  clearNativeCover,
  importNativePaths,
  isNativeRuntime,
  listNativePublications,
  loadNativePublicationPages,
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
import { LiveAnnouncement } from './LiveAnnouncement';
import { ProfilePanel } from './ProfilePanel';
import { ReaderView } from './ReaderView';
import { SmokeHarness } from './SmokeHarness';
import { isSmokeMode } from '../release/testModes';
import { resolveNativeImportRequest, type NativeImportRequest } from './nativeImportFlow';

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
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ReadingStatusFilter>('all');
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark[]>>({});
  const [readerStates, setReaderStates] = useState<Record<string, ReaderState>>({});
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>(DEFAULT_CACHE_INFO);
  const [isImporting, setIsImporting] = useState(false);
  const [smokeImportSequence, setSmokeImportSequence] = useState(0);
  const [nativeLibraryReady, setNativeLibraryReady] = useState(!nativeRuntime);
  const [diagnostic, setDiagnostic] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState(() => t('app.libraryReady'));
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const navigatorTriggerRef = useRef<HTMLButtonElement>(null);
  const readerTurnRequestRef = useRef<((delta: number) => void) | null>(null);
  const metadataGenerationRef = useRef(0);
  const favoriteInFlightRef = useRef(new Set<string>());
  const bookmarkWriteQueuesRef = useRef(new Map<string, Promise<void>>());
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
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const inputMap = useMemo(() => new InputMap(profile.bindings), [profile.bindings]);

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
    if (!nativeRuntime) {
      return;
    }

    let cancelled = false;
    const bootNativeLibrary = async () => {
      setNativeLibraryReady(false);
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
        setNativeLibraryReady(true);
        void hydrateMetadata(nativeLibrary);
        void refreshCacheInfo();
        setAnnouncement(nativeLibrary.length > 0 ? t('app.nativeLibraryReady') : t('app.nativeLibraryEmpty'));
      } catch {
        if (!cancelled) {
          setNativeLibraryReady(true);
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
        if (!nativeRuntime) {
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
    setAnnouncement(t('app.pageReady', { page: request.pageIndex + 1, count: latest.pageCount }));
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
        case 'toggle_spread':
          updateProfile({ mode: profile.mode === 'single' ? 'spread' : 'single' });
          setAnnouncement(t('app.readingMode', { mode: profile.mode === 'single' ? t('profile.spread').toLowerCase() : t('profile.single').toLowerCase() }));
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
    [activePublication, dispatchPageTurn, navigatorVisible, profile.mode, showProfile, toggleActiveBookmark, toggleFullscreen, toggleNavigator, updateProfile],
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

    await selectPublicationPage(openingPublication, openingPublication.currentPage, async (preparedPage, request) => {
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
    setAnnouncement(t('app.publicationImportedBrowser', { title: openingPublication.title }));
  };

  const handleNativeImport = async (request: NativeImportRequest): Promise<boolean> => {
    setIsImporting(true);
    setDiagnostic(undefined);
    try {
      const resolution = await resolveNativeImportRequest(request, {
        chooseFiles: chooseNativeFiles,
        chooseFolder: chooseNativeFolder,
      });
      if (resolution.kind === 'cancelled') {
        setAnnouncement(t('app.importCancelled'));
        return false;
      }

      const result = await importNativePaths(resolution.paths, profile.direction);
      setSmokeImportSequence((current) => current + 1);
      const diagnosticMessage = result.diagnostics.length > 0 ? result.diagnostics.join(' ') : undefined;
      setDiagnostic(diagnosticMessage);
      if (result.publications.length === 0) {
        setAnnouncement(t('app.nativeNoPublication'));
        return false;
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
      setAnnouncement(t('app.publicationImportedNative', { title: openingPublication.title }));
      return true;
    } catch {
      setDiagnostic(t('app.nativeImportError'));
      setAnnouncement(t('app.nativeImportFailed'));
      return false;
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
      {isSmokeMode(import.meta.env.VITE_SMOKE_TEST === '1', nativeRuntime) && (
        <span className="sr-only" data-testid="native-library-ready" data-ready={nativeLibraryReady ? 'true' : 'false'} />
      )}
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
            onToggleSettings={() => {
              setNavigatorVisible(false);
              setShowProfile((current) => !current);
            }}
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
            onImportNative={() => void handleNativeImport({ kind: 'files' })}
            onImportFolder={() => void handleNativeImport({ kind: 'folder' })}
            onOpenSettings={() => {
              void refreshCacheInfo();
              setShowProfile(true);
            }}
            onToggleFavorite={(publication) => void toggleFavorite(publication)}
            onDelete={(publication) => removePublication(publication)}
            onReplaceCover={replaceBrowserCover}
            onCoverError={handleBrowserCoverError}
            onChooseNativeCover={replaceNativeCover}
            onResetCover={resetPublicationCover}
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

      <LiveAnnouncement message={announcement} />
    </div>
  );
}
