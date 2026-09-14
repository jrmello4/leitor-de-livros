import { useCallback, useMemo, useRef, useState } from 'react';
import type { Bookmark, ReaderState, ReadingProfile } from '../../domain/types';
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
} from '../../domain/profiles';
import { defaultReaderState, normalizeReaderState } from '../../domain/readerState';
import { t } from '../../i18n/catalog';
import { saveNativeProfileStore } from '../../services/nativeLibrary';
import {
  saveBookmarkForPublication,
  saveReaderStateForPublication,
  toggleFavoriteForPublication,
} from '../../services/readerState';
import { loadFavorites, loadProfileStore, saveProfileStore } from '../../services/storage';

export interface ReadingProfilesDeps {
  nativeRuntime: boolean;
  getActivePublicationId: () => string | null;
  setBookmarks: React.Dispatch<React.SetStateAction<Record<string, Bookmark[]>>>;
  setReaderStates: React.Dispatch<React.SetStateAction<Record<string, ReaderState>>>;
  bookmarks: Record<string, Bookmark[]>;
  readerStates: Record<string, ReaderState>;
  onError: (message: string) => void;
  onAnnounce: (message: string) => void;
}

/**
 * Perfis de leitura nomeados + backup/restauração de dados locais.
 * Todo o bloco de mutações de perfil que vivia no App mora aqui; o App só
 * fia os callbacks no ProfilePanel e lê `profile`/`profileStore`.
 */
export function useReadingProfiles({
  nativeRuntime,
  getActivePublicationId,
  setBookmarks,
  setReaderStates,
  bookmarks,
  readerStates,
  onError,
  onAnnounce,
}: ReadingProfilesDeps) {
  const [profileStore, setProfileStore] = useState<ProfileStore>(() => loadProfileStore());
  const [profilePreview, setProfilePreview] = useState<NamedReadingProfile | null>(null);
  const profile = useMemo(() => {
    const saved = getActiveProfile(profileStore);
    return profilePreview?.id === saved.id ? profilePreview : saved;
  }, [profilePreview, profileStore]);
  const profileStoreRef = useRef(profileStore);
  profileStoreRef.current = profileStore;

  const getProfileStore = useCallback(() => profileStoreRef.current, []);

  const replaceProfileStore = useCallback((store: ProfileStore) => {
    profileStoreRef.current = store;
    setProfileStore(store);
  }, []);

  const persistProfileStore = useCallback((store: ProfileStore) => {
    if (!saveProfileStore(store)) {
      onError(t('app.profileSaveError'));
    }
    if (nativeRuntime) {
      void saveNativeProfileStore(store).catch(() => {
        onError(t('app.nativeProfileSaveError'));
      });
    }
  }, [nativeRuntime, onError]);

  const applyProfileZoom = useCallback((nextProfile: ReadingProfile) => {
    const currentId = getActivePublicationId();
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
  }, [getActivePublicationId, setReaderStates]);

  const commitProfileMutation = useCallback((mutation: ProfileMutation, message: string): string | undefined => {
    if (!mutation.ok) {
      const errorMessage = t(mutation.error);
      onError(errorMessage);
      return errorMessage;
    }
    setProfileStore(mutation.store);
    setProfilePreview(null);
    profileStoreRef.current = mutation.store;
    persistProfileStore(mutation.store);
    applyProfileZoom(getActiveProfile(mutation.store));
    onAnnounce(message);
    return undefined;
  }, [applyProfileZoom, onAnnounce, onError, persistProfileStore]);

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
      onError(errorMessage);
      return errorMessage;
    }
    const nextPreview = getActiveProfile(mutation.store);
    setProfilePreview(nextPreview);
    applyProfileZoom(nextPreview);
    return undefined;
  }, [applyProfileZoom, onError, profilePreview]);

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
    onAnnounce(t('app.profilePreviewUndone'));
  }, [applyProfileZoom, onAnnounce, profilePreview]);

  const importProfiles = useCallback((text: string) => {
    const parsed = parseProfileTransfer(text);
    if (!parsed.ok) {
      const errorMessage = t(parsed.error);
      onError(errorMessage);
      return errorMessage;
    }
    return commitProfileMutation(
      mergeProfileStore(profileStoreRef.current, parsed.value),
      t('app.profileImported'),
    );
  }, [commitProfileMutation, onError]);

  const exportProfiles = useCallback(() => {
    try {
      const blob = new Blob([serializeProfileTransfer(profileStoreRef.current)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tactile-reading-profiles.json';
      link.click();
      URL.revokeObjectURL(url);
      onAnnounce(t('app.profileExported'));
    } catch {
      onError(t('app.profileTransferError'));
    }
  }, [onAnnounce, onError]);

  const exportData = useCallback(() => {
    try {
      const backupDoc = {
        kind: 'tactile-library-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        favorites: loadFavorites(),
        bookmarks,
        readerStates,
        profileStore: profileStoreRef.current,
      };
      const blob = new Blob([JSON.stringify(backupDoc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tactile-library-backup.json';
      link.click();
      URL.revokeObjectURL(url);
      onAnnounce(t('profile.dataExported'));
    } catch {
      onError(t('profile.dataTransferError'));
    }
  }, [bookmarks, onAnnounce, onError, readerStates]);

  const importData = useCallback(async (text: string): Promise<string | undefined> => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (!parsed || parsed.kind !== 'tactile-library-backup' || parsed.version !== 1) {
        return t('profile.dataTransferError');
      }

      if (Array.isArray(parsed.favorites)) {
        for (const favId of parsed.favorites) {
          if (typeof favId === 'string') {
            await toggleFavoriteForPublication(favId, true);
          }
        }
      }

      if (parsed.bookmarks && typeof parsed.bookmarks === 'object') {
        const importedBookmarks = parsed.bookmarks as Record<string, Bookmark[]>;
        setBookmarks((current) => ({ ...current, ...importedBookmarks }));
        for (const [pubId, bList] of Object.entries(importedBookmarks)) {
          if (Array.isArray(bList)) {
            for (const b of bList) {
              await saveBookmarkForPublication(pubId, b);
            }
          }
        }
      }

      if (parsed.readerStates && typeof parsed.readerStates === 'object') {
        const importedReaderStates = parsed.readerStates as Record<string, ReaderState>;
        setReaderStates((current) => ({ ...current, ...importedReaderStates }));
        for (const [pubId, rState] of Object.entries(importedReaderStates)) {
          await saveReaderStateForPublication(pubId, normalizeReaderState(rState));
        }
      }

      if (parsed.profileStore) {
        const validated = parseProfileTransfer({ kind: 'tactile-reading-profiles', ...(parsed.profileStore as Record<string, unknown>) });
        if (validated.ok) {
          commitProfileMutation(
            mergeProfileStore(profileStoreRef.current, validated.value),
            t('profile.dataImported'),
          );
        }
      }

      onAnnounce(t('profile.dataImported'));
      return undefined;
    } catch {
      return t('profile.dataTransferError');
    }
  }, [commitProfileMutation, onAnnounce, setBookmarks, setReaderStates]);

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

  const handleProfileReset = useCallback(() => {
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
  }, [commitProfileMutation]);

  return {
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
  };
}
