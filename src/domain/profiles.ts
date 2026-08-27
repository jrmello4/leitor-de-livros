import { cloneBindings, DEFAULT_BINDINGS } from './input';
import type {
  ActionName,
  BindingMap,
  ContrastMode,
  LayoutZone,
  ReadingDirection,
  ReadingMode,
  ReadingProfile,
  ZoomMode,
} from './types';

export const PROFILE_STORE_VERSION = 2 as const;
export const DEFAULT_PROFILE_ID = 'paper-atelier';

export interface NamedReadingProfile extends ReadingProfile {
  id: string;
}

export interface ProfileStore {
  version: typeof PROFILE_STORE_VERSION;
  activeProfileId: string;
  profiles: NamedReadingProfile[];
}

export const PROFILE_TRANSFER_KIND = 'tactile-reading-profiles' as const;

export interface ProfileTransferDocument {
  kind: typeof PROFILE_TRANSFER_KIND;
  version: typeof PROFILE_STORE_VERSION;
  activeProfileId: string;
  profiles: NamedReadingProfile[];
}

export type ProfileErrorKey =
  | 'profile.errorStoreVersion'
  | 'profile.errorActiveId'
  | 'profile.errorAtLeastOne'
  | 'profile.errorIdsUnique'
  | 'profile.errorActiveExists'
  | 'profile.errorObject'
  | 'profile.errorVersion'
  | 'profile.errorId'
  | 'profile.errorName'
  | 'profile.errorVisual'
  | 'profile.errorMotion'
  | 'profile.errorDuration'
  | 'profile.errorZoomKeys'
  | 'profile.errorSelectedMissing'
  | 'profile.errorDuplicateMissing'
  | 'profile.errorNameTaken'
  | 'profile.errorRenameMissing'
  | 'profile.errorLastDelete'
  | 'profile.errorDeleteMissing'
  | 'profile.errorUpdateMissing';

export type ProfileValidation =
  | { ok: true; value: ProfileStore }
  | { ok: false; error: ProfileErrorKey };

export type ProfileMutation =
  | { ok: true; store: ProfileStore }
  | { ok: false; error: ProfileErrorKey };

const ACTION_NAMES: ActionName[] = [
  'next_page',
  'previous_page',
  'toggle_library',
  'toggle_fullscreen',
  'toggle_settings',
  'toggle_spread',
  'toggle_navigator',
  'toggle_bookmark',
  'rotate_clockwise',
  'cancel',
];

const PROFILE_NAME_LIMIT = 80;
const MIN_TURN_DURATION = 120;
const MAX_TURN_DURATION = 1200;
const MIN_ZOOM_SCALE = 0.5;
const MAX_ZOOM_SCALE = 3;

export function createDefaultProfile(): NamedReadingProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    version: 1,
    name: 'Paper Atelier',
    mode: 'single',
    direction: 'ltr',
    contrast: 'standard',
    reducedMotion: false,
    pageTurnDuration: 420,
    layoutZone: 'top',
    zoomMode: 'page',
    zoomScale: 1,
    bindings: cloneBindings(DEFAULT_BINDINGS),
  };
}

export function createDefaultProfileStore(): ProfileStore {
  const profile = createDefaultProfile();
  return {
    version: PROFILE_STORE_VERSION,
    activeProfileId: profile.id,
    profiles: [profile],
  };
}

export function cloneProfile(profile: NamedReadingProfile): NamedReadingProfile {
  return { ...profile, bindings: cloneBindings(profile.bindings) };
}

export function getActiveProfile(store: ProfileStore): NamedReadingProfile {
  return cloneProfile(
    store.profiles.find((profile) => profile.id === store.activeProfileId)
      ?? store.profiles[0]
      ?? createDefaultProfile(),
  );
}

export function getProfile(store: ProfileStore, profileId: string): NamedReadingProfile | undefined {
  const profile = store.profiles.find((candidate) => candidate.id === profileId);
  return profile ? cloneProfile(profile) : undefined;
}

export function validateProfileStore(value: unknown): ProfileValidation {
  if (!isRecord(value) || value.version !== PROFILE_STORE_VERSION) {
    return { ok: false, error: 'profile.errorStoreVersion' };
  }
  if (typeof value.activeProfileId !== 'string' || value.activeProfileId.length === 0) {
    return { ok: false, error: 'profile.errorActiveId' };
  }
  if (!Array.isArray(value.profiles) || value.profiles.length === 0) {
    return { ok: false, error: 'profile.errorAtLeastOne' };
  }

  const profiles: NamedReadingProfile[] = [];
  const ids = new Set<string>();
  for (const candidate of value.profiles) {
    const validated = validateProfile(candidate);
    if (!validated.ok) {
      return validated;
    }
    if (ids.has(validated.value.id)) {
      return { ok: false, error: 'profile.errorIdsUnique' };
    }
    ids.add(validated.value.id);
    profiles.push(validated.value);
  }
  if (!ids.has(value.activeProfileId)) {
    return { ok: false, error: 'profile.errorActiveExists' };
  }

  return {
    ok: true,
    value: { version: PROFILE_STORE_VERSION, activeProfileId: value.activeProfileId, profiles },
  };
}

export function serializeProfileTransfer(store: ProfileStore): string {
  const validation = validateProfileStore(store);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const document: ProfileTransferDocument = {
    kind: PROFILE_TRANSFER_KIND,
    version: PROFILE_STORE_VERSION,
    activeProfileId: validation.value.activeProfileId,
    profiles: validation.value.profiles.map(cloneProfile),
  };
  return JSON.stringify(document, null, 2);
}

export function parseProfileTransfer(value: unknown): ProfileValidation {
  const parsed = typeof value === 'string' ? parseTransferText(value) : value;
  if (!isRecord(parsed) || parsed.kind !== PROFILE_TRANSFER_KIND || parsed.version !== PROFILE_STORE_VERSION) {
    return { ok: false, error: 'profile.errorStoreVersion' };
  }
  return validateProfileStore({
    version: PROFILE_STORE_VERSION,
    activeProfileId: parsed.activeProfileId,
    profiles: parsed.profiles,
  });
}

export function mergeProfileStore(current: ProfileStore, imported: ProfileStore): ProfileMutation {
  const currentValidation = validateProfileStore(current);
  if (!currentValidation.ok) return currentValidation;
  const importedValidation = validateProfileStore(imported);
  if (!importedValidation.ok) return importedValidation;

  const profiles = currentValidation.value.profiles.map(cloneProfile);
  const usedIds = new Set(profiles.map((profile) => profile.id));
  const usedNames = new Set(profiles.map((profile) => profile.name.toLocaleLowerCase()));

  for (const importedProfile of importedValidation.value.profiles) {
    const name = uniqueImportedName(importedProfile.name, usedNames);
    const id = uniqueImportedId(importedProfile.id, usedIds);
    const profile = { ...cloneProfile(importedProfile), id, name };
    profiles.push(profile);
    usedIds.add(id);
    usedNames.add(name.toLocaleLowerCase());
  }

  return {
    ok: true,
    store: {
      version: PROFILE_STORE_VERSION,
      activeProfileId: currentValidation.value.activeProfileId,
      profiles,
    },
  };
}

export function validateProfile(value: unknown): { ok: true; value: NamedReadingProfile } | { ok: false; error: ProfileErrorKey } {
  if (!isRecord(value)) {
    return { ok: false, error: 'profile.errorObject' };
  }
  if (value.version !== 1) {
    return { ok: false, error: 'profile.errorVersion' };
  }
  if (typeof value.id !== 'string' || !isValidId(value.id)) {
    return { ok: false, error: 'profile.errorId' };
  }
  if (!isValidProfileName(value.name)) {
    return { ok: false, error: 'profile.errorName' };
  }
  if (!isOneOf(value.mode, ['single', 'spread', 'webtoon'])
    || !isOneOf(value.direction, ['ltr', 'rtl'])
    || !isOneOf(value.contrast, ['standard', 'high'])
    || !isOneOf(value.layoutZone, ['top', 'bottom', 'left', 'right'])
    || !isOneOf(value.zoomMode, ['page', 'width', 'manual'])) {
    return { ok: false, error: 'profile.errorVisual' };
  }
  if (typeof value.reducedMotion !== 'boolean') {
    return { ok: false, error: 'profile.errorMotion' };
  }
  if (!isValidTurnDuration(value.pageTurnDuration)) {
    return { ok: false, error: 'profile.errorDuration' };
  }
  if (!isValidZoomScale(value.zoomScale) || !isValidBindings(value.bindings)) {
    return { ok: false, error: 'profile.errorZoomKeys' };
  }

  return {
    ok: true,
    value: {
      id: value.id,
      version: 1,
      name: value.name.trim(),
      mode: value.mode,
      direction: value.direction,
      contrast: value.contrast,
      reducedMotion: value.reducedMotion,
      pageTurnDuration: value.pageTurnDuration,
      layoutZone: value.layoutZone,
      zoomMode: value.zoomMode,
      zoomScale: value.zoomScale,
      bindings: cloneBindings(value.bindings),
    },
  };
}

export function migrateProfileStore(value: unknown): ProfileStore {
  return tryMigrateProfileStore(value) ?? createDefaultProfileStore();
}

/**
 * Migrates a persisted payload without silently replacing an invalid native
 * store. Callers can then choose a valid fallback from another persistence
 * layer (for example browser storage) before writing anything back.
 */
export function tryMigrateProfileStore(value: unknown): ProfileStore | null {
  const current = validateProfileStore(value);
  if (current.ok) {
    return current.value;
  }

  if (isRecord(value) && value.version === 1) {
    const legacy = normalizeLegacyProfile(value);
    return {
      version: PROFILE_STORE_VERSION,
      activeProfileId: legacy.id,
      profiles: [legacy],
    };
  }

  return null;
}

export function selectProfile(store: ProfileStore, profileId: string): ProfileMutation {
  const valid = validateProfileStore(store);
  if (!valid.ok) return valid;
  if (!valid.value.profiles.some((profile) => profile.id === profileId)) {
    return { ok: false, error: 'profile.errorSelectedMissing' };
  }
  return { ok: true, store: { ...valid.value, activeProfileId: profileId } };
}

export function createProfile(store: ProfileStore, name: string): ProfileMutation {
  const valid = validateProfileStore(store);
  if (!valid.ok) return valid;
  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) return { ok: false, error: 'profile.errorName' };
  if (hasProfileName(valid.value, normalizedName)) return { ok: false, error: 'profile.errorNameTaken' };

  const profile: NamedReadingProfile = {
    ...createDefaultProfile(),
    id: createProfileId(),
    name: normalizedName,
  };
  return {
    ok: true,
    store: {
      ...valid.value,
      activeProfileId: profile.id,
      profiles: [...valid.value.profiles, profile],
    },
  };
}

export function duplicateProfile(store: ProfileStore, profileId: string, name?: string): ProfileMutation {
  const valid = validateProfileStore(store);
  if (!valid.ok) return valid;
  const source = valid.value.profiles.find((profile) => profile.id === profileId);
  if (!source) return { ok: false, error: 'profile.errorDuplicateMissing' };
  const normalizedName = normalizeProfileName(name ?? `${source.name} copy`);
  if (!normalizedName) return { ok: false, error: 'profile.errorName' };
  if (hasProfileName(valid.value, normalizedName)) return { ok: false, error: 'profile.errorNameTaken' };

  const profile = { ...cloneProfile(source), id: createProfileId(), name: normalizedName };
  return {
    ok: true,
    store: {
      ...valid.value,
      activeProfileId: profile.id,
      profiles: [...valid.value.profiles, profile],
    },
  };
}

export function renameProfile(store: ProfileStore, profileId: string, name: string): ProfileMutation {
  const valid = validateProfileStore(store);
  if (!valid.ok) return valid;
  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) return { ok: false, error: 'profile.errorName' };
  if (valid.value.profiles.some((profile) => profile.id !== profileId && profile.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
    return { ok: false, error: 'profile.errorNameTaken' };
  }
  if (!valid.value.profiles.some((profile) => profile.id === profileId)) {
    return { ok: false, error: 'profile.errorRenameMissing' };
  }
  return {
    ok: true,
    store: {
      ...valid.value,
      profiles: valid.value.profiles.map((profile) => profile.id === profileId ? { ...profile, name: normalizedName } : profile),
    },
  };
}

export function deleteProfile(store: ProfileStore, profileId: string): ProfileMutation {
  const valid = validateProfileStore(store);
  if (!valid.ok) return valid;
  if (valid.value.profiles.length === 1) return { ok: false, error: 'profile.errorLastDelete' };
  if (!valid.value.profiles.some((profile) => profile.id === profileId)) {
    return { ok: false, error: 'profile.errorDeleteMissing' };
  }
  const profiles = valid.value.profiles.filter((profile) => profile.id !== profileId);
  const activeProfileId = valid.value.activeProfileId === profileId
    ? profiles[0]!.id
    : valid.value.activeProfileId;
  return { ok: true, store: { ...valid.value, activeProfileId, profiles } };
}

export function updateProfile(store: ProfileStore, profileId: string, patch: Partial<ReadingProfile>): ProfileMutation {
  const valid = validateProfileStore(store);
  if (!valid.ok) return valid;
  const current = valid.value.profiles.find((profile) => profile.id === profileId);
  if (!current) return { ok: false, error: 'profile.errorUpdateMissing' };
  const candidate = { ...current, ...patch, id: current.id, version: 1 };
  const validated = validateProfile(candidate);
  if (!validated.ok) return validated;
  return {
    ok: true,
    store: {
      ...valid.value,
      profiles: valid.value.profiles.map((profile) => profile.id === profileId ? validated.value : profile),
    },
  };
}

function normalizeLegacyProfile(value: Record<string, unknown>): NamedReadingProfile {
  const fallback = createDefaultProfile();
  const candidate = {
    ...fallback,
    ...value,
    id: typeof value.id === 'string' && isValidId(value.id) ? value.id : fallback.id,
    version: 1,
    name: typeof value.name === 'string' ? value.name : fallback.name,
    mode: isOneOf(value.mode, ['single', 'spread', 'webtoon']) ? value.mode : fallback.mode,
    direction: isOneOf(value.direction, ['ltr', 'rtl']) ? value.direction : fallback.direction,
    contrast: isOneOf(value.contrast, ['standard', 'high']) ? value.contrast : fallback.contrast,
    layoutZone: isOneOf(value.layoutZone, ['top', 'bottom', 'left', 'right']) ? value.layoutZone : fallback.layoutZone,
    zoomMode: isOneOf(value.zoomMode, ['page', 'width', 'manual']) ? value.zoomMode : fallback.zoomMode,
    reducedMotion: typeof value.reducedMotion === 'boolean' ? value.reducedMotion : fallback.reducedMotion,
    pageTurnDuration: isValidTurnDuration(value.pageTurnDuration) ? value.pageTurnDuration : fallback.pageTurnDuration,
    zoomScale: isValidZoomScale(value.zoomScale) ? value.zoomScale : fallback.zoomScale,
    bindings: normalizeLegacyBindings(value.bindings, fallback.bindings),
  };
  const validated = validateProfile(candidate);
  return validated.ok ? validated.value : fallback;
}

function parseTransferText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function uniqueImportedName(baseName: string, usedNames: Set<string>): string {
  const normalizedBase = baseName.trim();
  let suffix = 1;
  while (true) {
    const suffixText = suffix === 1 ? ' (imported)' : ` (imported ${suffix})`;
    const availableBaseLength = Math.max(1, PROFILE_NAME_LIMIT - suffixText.length);
    const truncatedBase = normalizedBase.slice(0, availableBaseLength).trim();
    const candidate = `${truncatedBase}${suffixText}`;
    if (!usedNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
    suffix += 1;
  }
}

function uniqueImportedId(baseId: string, usedIds: Set<string>): string {
  const normalizedBase = `imported-${baseId}`.slice(0, 80);
  let candidate = normalizedBase;
  let suffix = 2;
  while (usedIds.has(candidate) || !isValidId(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${normalizedBase.slice(0, 80 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeLegacyBindings(value: unknown, fallback: BindingMap): BindingMap {
  if (!isRecord(value)) {
    return cloneBindings(fallback);
  }
  const merged = cloneBindings(fallback);
  for (const action of ACTION_NAMES) {
    const candidate = value[action];
    if (Array.isArray(candidate)
      && candidate.length <= 2
      && candidate.every((code) => typeof code === 'string' && code.length > 0 && code.length <= 64)) {
      merged[action] = [...candidate];
    }
  }
  return merged;
}

function hasProfileName(store: ProfileStore, name: string): boolean {
  return store.profiles.some((profile) => profile.name.toLocaleLowerCase() === name.toLocaleLowerCase());
}

function normalizeProfileName(value: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return isValidProfileName(normalized) ? normalized : null;
}

function isValidProfileName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= PROFILE_NAME_LIMIT;
}

function isValidId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,79}$/i.test(value);
}

function isValidTurnDuration(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_TURN_DURATION
    && value <= MAX_TURN_DURATION;
}

function isValidZoomScale(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_ZOOM_SCALE
    && value <= MAX_ZOOM_SCALE;
}

function isValidBindings(value: unknown): value is BindingMap {
  if (!isRecord(value)) return false;
  return ACTION_NAMES.every((action) => (
    value[action] === undefined
      || (Array.isArray(value[action])
        && value[action].length <= 2
        && value[action].every((code) => typeof code === 'string' && code.length > 0 && code.length <= 64))
  ));
}

function createProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `profile-${crypto.randomUUID()}`;
  }
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Keep the domain imports self-documenting when the persisted schema grows.
export type { ContrastMode, LayoutZone, ReadingDirection, ReadingMode, ZoomMode };
