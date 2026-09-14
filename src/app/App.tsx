import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { createDemoPublication } from '../data/demo';
import { canRunActionWhileSettingsOpen, InputMap } from '../domain/input';
import { createPageSelectionCoordinator } from '../domain/pageSelection';
import { calculateProgress } from '../domain/reader';
import { type FormatFilter, type LibrarySort, type ReadingStatusFilter } from '../domain/library';
import { defaultReaderState, nextRotation } from '../domain/readerState';
import { findNextPublication } from '../domain/seriesMatching';
import type { ActionName, CacheInfo, Publication, ReadingProfile } from '../domain/types';
import { actionLabel, t } from '../i18n/catalog';
import '../i18n/register-locales';
import {
  isAndroidRuntime,
  isNativeRuntime,
  getNativeCacheInfo,
} from '../services/nativeLibrary';
import { useLibraryMetadata } from './hooks/useLibraryMetadata';
import { useReadingProfiles } from './hooks/useReadingProfiles';
import { useNativeLibraryBoot } from './hooks/useNativeLibraryBoot';
import { usePublicationActions } from './hooks/usePublicationActions';
import { useReadingSession } from './hooks/useReadingSession';
import { useLibraryImport } from './hooks/useLibraryImport';
import {
  loadFavorites,
  loadCustomCover,
  loadProgress,
} from '../services/storage';
import { LibraryView } from './LibraryView';
import { LiveAnnouncement } from './LiveAnnouncement';
import { ProfilePanel } from './ProfilePanel';
import { SmokeHarness } from './SmokeHarness';
import { isSmokeMode } from '../release/testModes';

// O leitor (Webtoon + page-turn + renderers) só carrega ao abrir uma
// publicação. A biblioteca — tela inicial no Android — não paga esse custo.
const ReaderView = lazy(() => import('./ReaderView').then((module) => ({ default: module.ReaderView })));

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
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const navigatorTriggerRef = useRef<HTMLButtonElement>(null);
  const pageSelectionCoordinatorRef = useRef(createPageSelectionCoordinator());
  const cancelPageSelection = useCallback(() => pageSelectionCoordinatorRef.current.cancel(), []);

  const activePublication = library.find((publication) => publication.id === activeId);
  const activePublicationIdRef = useRef<string | null>(activePublication?.id ?? null);
  activePublicationIdRef.current = activePublication?.id ?? null;
  const showProfileRef = useRef(showProfile);
  showProfileRef.current = showProfile;
  const navigatorVisibleRef = useRef(navigatorVisible);
  navigatorVisibleRef.current = navigatorVisible;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const getLibrary = useCallback(() => libraryRef.current, []);
  const getActivePublication = useCallback(
    () => libraryRef.current.find((publication) => publication.id === activeIdRef.current),
    [],
  );
  const getActiveId = useCallback(() => activeIdRef.current, []);
  const inputMap = useMemo(() => new InputMap(profile.bindings), [profile.bindings]);

  const refreshCacheInfo = useCallback(async () => {
    try {
      setCacheInfo(await getNativeCacheInfo());
    } catch {
      setDiagnostic(t('app.cacheUsageError'));
    }
  }, []);

  const {
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
  } = usePublicationActions({
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
    onError: setDiagnostic,
    onAnnounce: setAnnouncement,
  });

  const {
    persistReaderState,
    moveActivePage,
    dispatchPageTurn,
    registerReaderTurnRequest,
    selectActivePage,
    recordWebtoonVisiblePage,
    saveActiveReaderState,
    toggleActiveBookmark,
    updateActiveBookmarkLabel,
    openPublication,
  } = useReadingSession({
    nativeRuntime,
    profile,
    getLibrary,
    getActivePublication,
    getActivePublicationId,
    updatePublication,
    applyPreparedPages,
    setLibrary,
    setActiveId,
    setShowProfile,
    setBookmarks,
    setReaderStates,
    bookmarksRef,
    enqueueBookmarkWrite,
    pageSelectionCoordinatorRef,
    onError: setDiagnostic,
    onAnnounce: setAnnouncement,
  });

  const {
    isImporting,
    importProgress,
    setImportProgress,
    retryableNativePaths,
    smokeImportSequence,
    handleImport,
    handleNativeImport,
  } = useLibraryImport({
    nativeRuntime,
    profileDirection: profile.direction,
    openPublication,
    setLibrary,
    hydrateMetadata,
    refreshCacheInfo,
    onError: setDiagnostic,
    onAnnounce: setAnnouncement,
  });

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
