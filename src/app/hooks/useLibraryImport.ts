import { useState } from 'react';
import { calculateProgress } from '../../domain/reader';
import type { Publication } from '../../domain/types';
import { t } from '../../i18n/catalog';
import { loadCustomCover } from '../../services/covers';
import { importFiles } from '../../services/importers';
import {
  chooseNativeFiles,
  chooseNativeFolder,
  importNativePaths,
  listNativePublications,
} from '../../services/nativeLibrary';
import type { ImportProgress } from '../LibraryView';
import { resolveNativeImportRequest, type NativeImportRequest } from '../nativeImportFlow';

export interface LibraryImportDeps {
  nativeRuntime: boolean;
  profileDirection: 'ltr' | 'rtl';
  openPublication: (summary: Publication) => Promise<void>;
  setLibrary: React.Dispatch<React.SetStateAction<Publication[]>>;
  hydrateMetadata: (publications: Publication[]) => void | Promise<void>;
  refreshCacheInfo: () => void | Promise<void>;
  onError: (message: string | undefined) => void;
  onAnnounce: (message: string) => void;
}

/**
 * Importação browser (arquivos) e nativa (SAF). Guarda o progresso,
 * os caminhos para repetição e a sequência do smoke harness.
 */
export function useLibraryImport({
  nativeRuntime,
  profileDirection,
  openPublication,
  setLibrary,
  hydrateMetadata,
  refreshCacheInfo,
  onError,
  onAnnounce,
}: LibraryImportDeps) {
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [retryableNativePaths, setRetryableNativePaths] = useState<string[] | null>(null);
  const [smokeImportSequence, setSmokeImportSequence] = useState(0);

  const handleImport = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setIsImporting(true);
    setImportProgress({ phase: 'processing', total: files.length, completed: 0 });
    onError(undefined);
    const result = await importFiles(files);
    setImportProgress({ phase: 'finishing', total: files.length, completed: files.length });
    setIsImporting(false);

    if (!result.publication) {
      setImportProgress(null);
      onError(result.diagnostic ?? t('app.importError'));
      onAnnounce(result.diagnostic ?? t('app.importFailed'));
      return;
    }

    setRetryableNativePaths(null);

    const importedPublication = {
      ...(result.publication as Publication),
      customCover: loadCustomCover(result.publication.id),
    };
    const openingPublication = profileDirection === 'rtl'
      ? {
          ...importedPublication,
          currentPage: Math.max(importedPublication.pageCount - 1, 0),
          progress: calculateProgress(Math.max(importedPublication.pageCount - 1, 0), importedPublication.pageCount, 'rtl'),
        }
      : importedPublication;
    setLibrary((current) => [openingPublication, ...current]);
    void openPublication(openingPublication);
    setImportProgress(null);
    onAnnounce(t('app.publicationImportedBrowser', { title: openingPublication.title }));
  };

  const handleNativeImport = async (request: NativeImportRequest): Promise<boolean> => {
    setIsImporting(true);
    setImportProgress({ phase: 'selecting' });
    onError(undefined);
    try {
      const resolution = await resolveNativeImportRequest(request, {
        chooseFiles: chooseNativeFiles,
        chooseFolder: chooseNativeFolder,
      });
      if (resolution.kind === 'cancelled') {
        setImportProgress(null);
        onAnnounce(t('app.importCancelled'));
        return false;
      }

      setImportProgress({ phase: 'processing', total: resolution.paths.length, completed: 0 });
      setRetryableNativePaths(resolution.paths);
      const result = await importNativePaths(resolution.paths, profileDirection);
      setImportProgress({ phase: 'finishing', total: Math.max(resolution.paths.length, result.publications.length), completed: Math.max(resolution.paths.length, result.publications.length) });
      setSmokeImportSequence((current) => current + 1);
      const diagnosticMessage = result.diagnostics.length > 0 ? result.diagnostics.join(' ') : undefined;
      onError(diagnosticMessage);
      if (result.publications.length === 0) {
        setImportProgress(null);
        onAnnounce(t('app.nativeNoPublication'));
        return false;
      }

      if (result.diagnostics.length === 0) {
        setRetryableNativePaths(null);
      }

      setLibrary((current) => {
        const importedIds = new Set(result.publications.map((publication) => publication.id));
        return [...result.publications, ...current.filter((publication) => !importedIds.has(publication.id))];
      });
      const nextLibrary = await listNativePublications(profileDirection);
      setLibrary(nextLibrary);
      void hydrateMetadata(nextLibrary);
      await refreshCacheInfo();
      const openingPublication = result.publications[0];
      await openPublication(openingPublication);
      setImportProgress(null);
      onAnnounce(t('app.publicationImportedNative', { title: openingPublication.title }));
      return true;
    } catch {
      setImportProgress(null);
      onError(t('app.nativeImportError'));
      onAnnounce(t('app.nativeImportFailed'));
      return false;
    } finally {
      setIsImporting(false);
    }
  };

  return {
    isImporting,
    importProgress,
    setImportProgress,
    retryableNativePaths,
    smokeImportSequence,
    handleImport,
    handleNativeImport,
  };
}
