import { cloneBindings, DEFAULT_BINDINGS } from '../domain/input';
import type { BindingMap, ReadingProfile } from '../domain/types';

const PROFILE_KEY = 'tactile-reader/profile/v1';
const PROGRESS_KEY = 'tactile-reader/progress/v1';

const defaultProfile: ReadingProfile = {
  version: 1,
  name: 'Paper Atelier',
  mode: 'single',
  direction: 'ltr',
  contrast: 'standard',
  reducedMotion: false,
  pageTurnDuration: 420,
  layoutZone: 'top',
  bindings: cloneBindings(DEFAULT_BINDINGS),
};

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(): ReadingProfile {
  const storage = getStorage();
  if (!storage) {
    return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
  }

  try {
    const stored = JSON.parse(storage.getItem(PROFILE_KEY) ?? 'null') as Partial<ReadingProfile> | null;
    if (!stored || stored.version !== 1) {
      return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
    }

    return {
      ...defaultProfile,
      ...stored,
      bindings: cloneBindings((stored.bindings as BindingMap | undefined) ?? defaultProfile.bindings),
    };
  } catch {
    return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
  }
}

export function saveProfile(profile: ReadingProfile): void {
  getStorage()?.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function hasStoredProfile(): boolean {
  return getStorage()?.getItem(PROFILE_KEY) !== null;
}

export function loadProgress(publicationId: string): number {
  const storage = getStorage();
  if (!storage) {
    return 0;
  }

  try {
    const progress = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>;
    return Number.isInteger(progress[publicationId]) ? Math.max(0, progress[publicationId]) : 0;
  } catch {
    return 0;
  }
}

export function saveProgress(publicationId: string, pageIndex: number): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const progress = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>;
    progress[publicationId] = pageIndex;
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    return;
  }
}

export function resetProfile(): ReadingProfile {
  const storage = getStorage();
  storage?.removeItem(PROFILE_KEY);
  return { ...defaultProfile, bindings: cloneBindings(defaultProfile.bindings) };
}
