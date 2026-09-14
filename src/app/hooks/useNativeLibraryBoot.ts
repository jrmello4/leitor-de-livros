import { useEffect, useState } from 'react';
import type { ProfileStore } from '../../domain/profiles';
import { getActiveProfile } from '../../domain/profiles';
import type { Publication } from '../../domain/types';
import { t } from '../../i18n/catalog';
import {
  listenNativeImportProgress,
  listNativePublications,
  loadNativeProfileStore,
  saveNativeProfileStore,
} from '../../services/nativeLibrary';
import type { ImportProgress } from '../LibraryView';

export interface NativeLibraryBootDeps {
  getProfileStore: () => ProfileStore;
  replaceProfileStore: (store: ProfileStore) => void;
  setLibrary: (publications: Publication[]) => void;
  hydrateMetadata: (publications: Publication[]) => void | Promise<void>;
  refreshCacheInfo: () => void | Promise<void>;
  invalidateMetadata: () => void;
  setImportProgress: (progress: ImportProgress | null) => void;
  onError: (message: string) => void;
  onAnnounce: (message: string) => void;
}

/**
 * Boot da biblioteca nativa com retry (o SQLite pode terminar de abrir/migrar
 * depois da WebView) + escuta do progresso de importação. Sem runtime nativo,
 * só sinaliza pronto para a biblioteca demo do navegador.
 */
export function useNativeLibraryBoot(nativeRuntime: boolean, deps: NativeLibraryBootDeps) {
  const [nativeLibraryReady, setNativeLibraryReady] = useState(!nativeRuntime);
  const {
    getProfileStore,
    replaceProfileStore,
    setLibrary,
    hydrateMetadata,
    refreshCacheInfo,
    invalidateMetadata,
    setImportProgress,
    onError,
    onAnnounce,
  } = deps;

  useEffect(() => {
    if (!nativeRuntime) {
      return;
    }

    let cancelled = false;
    const bootNativeLibrary = async () => {
      setNativeLibraryReady(false);
      try {
        // Android can finish opening/migrating the SQLite store just after the
        // WebView starts. Retry the complete boot transaction so a transient
        // "state not managed"/database-open error does not strand the reader
        // on the demo library until the next manual reload.
        let mobileProfileStore: ProfileStore | undefined;
        let nativeLibrary: Publication[] | undefined;
        let lastBootError: unknown;
        for (let attempt = 0; attempt < 3 && !nativeLibrary; attempt += 1) {
          if (cancelled) {
            return;
          }
          try {
            const nativeProfileStore = await loadNativeProfileStore();
            const nextProfileStore = nativeProfileStore ?? getProfileStore();
            // This build is a personal mobile reader: keep the continuous vertical
            // layout as the single reading mode, including for profiles saved by
            // an earlier desktop-oriented version.
            const normalizedProfileStore: ProfileStore = {
              ...nextProfileStore,
              profiles: nextProfileStore.profiles.map((candidate) => ({ ...candidate, mode: 'webtoon' as const })),
            };
            const nextProfile = getActiveProfile(normalizedProfileStore);
            // Saving the normalized store also upgrades a legacy flat native row
            // after it has been migrated in memory.
            await saveNativeProfileStore(normalizedProfileStore);
            nativeLibrary = await listNativePublications(nextProfile.direction);
            mobileProfileStore = normalizedProfileStore;
          } catch (error) {
            lastBootError = error;
            if (attempt < 2) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
            }
          }
        }
        if (!mobileProfileStore || !nativeLibrary) {
          throw lastBootError ?? new Error('native-library-boot-failed');
        }
        if (cancelled) {
          return;
        }
        replaceProfileStore(mobileProfileStore);
        setLibrary(nativeLibrary);
        setNativeLibraryReady(true);
        void hydrateMetadata(nativeLibrary);
        void refreshCacheInfo();
        onAnnounce(nativeLibrary.length > 0 ? t('app.nativeLibraryReady') : t('app.nativeLibraryEmpty'));
      } catch {
        if (!cancelled) {
          setNativeLibraryReady(true);
          onError(t('app.nativeOpenError'));
          onAnnounce(t('app.nativeUnavailable'));
        }
      }
    };

    void bootNativeLibrary();
    return () => {
      cancelled = true;
      invalidateMetadata();
    };
  }, [nativeRuntime, getProfileStore, replaceProfileStore, setLibrary, hydrateMetadata, refreshCacheInfo, invalidateMetadata, onError, onAnnounce]);

  useEffect(() => {
    if (!nativeRuntime) {
      return undefined;
    }
    let unlisten: (() => void) | undefined;
    void listenNativeImportProgress((progress) => {
      setImportProgress({
        phase: progress.processed >= progress.total && progress.total > 0 ? 'finishing' : 'processing',
        total: progress.total,
        completed: progress.processed,
        currentName: progress.currentName,
        failed: progress.failed,
      });
    }).then((dispose) => {
      unlisten = dispose;
    }).catch(() => undefined);
    return () => unlisten?.();
  }, [nativeRuntime, setImportProgress]);

  return { nativeLibraryReady };
}
