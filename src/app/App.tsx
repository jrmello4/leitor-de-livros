import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDemoPublication } from '../data/demo';
import { InputMap } from '../domain/input';
import { calculateProgress, movePage } from '../domain/reader';
import type { ActionName, Publication, ReadingProfile } from '../domain/types';
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
} from '../services/nativeLibrary';
import { hasStoredProfile, loadProfile, loadProgress, resetProfile, saveProfile, saveProgress } from '../services/storage';
import { LibraryView } from './LibraryView';
import { ProfilePanel } from './ProfilePanel';
import { ReaderView } from './ReaderView';

function initialLibrary(direction: ReadingProfile['direction']): Publication[] {
  const demo = createDemoPublication();
  const savedPage = loadProgress(demo.id);
  demo.currentPage = direction === 'rtl' && savedPage === 0 ? demo.pages.length - 1 : Math.min(savedPage, demo.pages.length - 1);
  demo.progress = calculateProgress(demo.currentPage, demo.pages.length, direction);
  return [demo];
}

export function App() {
  const nativeRuntime = isNativeRuntime();
  const [profile, setProfile] = useState<ReadingProfile>(() => loadProfile());
  const [library, setLibrary] = useState<Publication[]>(() => initialLibrary(profile.direction));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [capturingAction, setCapturingAction] = useState<ActionName | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [isImporting, setIsImporting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState('Library ready.');

  const activePublication = library.find((publication) => publication.id === activeId);
  const inputMap = useMemo(() => new InputMap(profile.bindings), [profile.bindings]);

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
    };
  }, [nativeRuntime]);

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

  const persistProgress = useCallback((publicationId: string, pageIndex: number) => {
    saveProgress(publicationId, pageIndex);
    if (nativeRuntime) {
      void saveNativeProgress(publicationId, pageIndex).catch(() => {
        setDiagnostic('Reading progress could not be saved to the native library.');
      });
    }
  }, [nativeRuntime]);

  const moveActivePage = useCallback(
    (delta: number) => {
      if (!activePublication) {
        return;
      }

      const nextPage = movePage(
        activePublication.currentPage,
        activePublication.pages.length,
        profile.direction,
        delta,
      );

      if (nextPage === activePublication.currentPage) {
        setAnnouncement(delta > 0 ? 'You are at the end of this publication.' : 'You are at the beginning of this publication.');
        return;
      }

      updatePublication(activePublication.id, (publication) => ({
        ...publication,
        currentPage: nextPage,
        progress: calculateProgress(nextPage, publication.pages.length, profile.direction),
        updatedAt: new Date().toISOString(),
      }));
      persistProgress(activePublication.id, nextPage);
      setAnnouncement(`Page ${nextPage + 1} of ${activePublication.pages.length}.`);
    },
    [activePublication, persistProgress, profile.direction, updatePublication],
  );

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

      event.preventDefault();
      handleAction(action);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [capturingAction, handleAction, inputMap, updateProfile]);

  const openPublication = (publication: Publication) => {
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

    if (openingPublication !== publication) {
      updatePublication(publication.id, () => openingPublication);
      persistProgress(publication.id, openingPublication.currentPage);
    }

    setActiveId(openingPublication.id);
    setShowProfile(false);
    setDiagnostic(undefined);
    setAnnouncement(`${openingPublication.title} opened. Page ${openingPublication.currentPage + 1} of ${openingPublication.pages.length}.`);
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
    openPublication(openingPublication);
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
      const openingPublication = result.publications[0];
      openPublication(openingPublication);
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

      {activePublication ? (
        <ReaderView
          publication={activePublication}
          profile={profile}
          announcement={announcement}
          onBack={() => setActiveId(null)}
          onNext={() => moveActivePage(1)}
          onPrevious={() => moveActivePage(-1)}
          onToggleSettings={() => setShowProfile((current) => !current)}
          onToggleFullscreen={() => void toggleFullscreen()}
          onFlowCorrected={() => setAnnouncement('Panel order corrected and saved for this publication.')}
          nativeRuntime={nativeRuntime}
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
          onOpenSettings={() => setShowProfile(true)}
        />
      )}

      {showProfile && (
        <ProfilePanel
          profile={profile}
          capturingAction={capturingAction}
          onChange={updateProfile}
          onStartCapture={setCapturingAction}
          onReset={handleProfileReset}
          onClose={() => {
            setCapturingAction(null);
            setShowProfile(false);
          }}
        />
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
