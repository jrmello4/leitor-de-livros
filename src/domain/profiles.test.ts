import { describe, expect, it } from 'vitest';
import {
  createDefaultProfileStore,
  createProfile,
  deleteProfile,
  duplicateProfile,
  getActiveProfile,
  migrateProfileStore,
  renameProfile,
  selectProfile,
  validateProfileStore,
} from './profiles';

describe('named reading profiles', () => {
  it('migrates the legacy flat profile without losing settings', () => {
    const migrated = migrateProfileStore({
      version: 1,
      name: 'Right-to-left study',
      mode: 'spread',
      direction: 'rtl',
      contrast: 'high',
      reducedMotion: true,
      pageTurnDuration: 720,
      layoutZone: 'bottom',
      bindings: { next_page: ['KeyN'] },
    });

    expect(migrated.version).toBe(2);
    expect(migrated.profiles).toHaveLength(1);
    expect(migrated.activeProfileId).toBe(migrated.profiles[0]?.id);
    expect(migrated.profiles[0]).toMatchObject({
      name: 'Right-to-left study',
      mode: 'spread',
      direction: 'rtl',
      contrast: 'high',
      reducedMotion: true,
      pageTurnDuration: 720,
      layoutZone: 'bottom',
      zoomMode: 'page',
      zoomScale: 1,
    });
    expect(migrated.profiles[0]?.bindings.next_page).toEqual(['KeyN']);
  });

  it('supports selection, creation, duplication, rename, and safe deletion', () => {
    const initial = createDefaultProfileStore();
    const created = createProfile(initial, 'Night study');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const selected = selectProfile(created.store, created.store.profiles[1]!.id);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(getActiveProfile(selected.store).name).toBe('Night study');

    const renamed = renameProfile(selected.store, selected.store.activeProfileId, 'Late night study');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;

    const duplicated = duplicateProfile(renamed.store, renamed.store.activeProfileId);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    expect(duplicated.store.profiles).toHaveLength(3);
    expect(duplicated.store.profiles[2]?.name).toBe('Late night study copy');

    const deleted = deleteProfile(duplicated.store, duplicated.store.activeProfileId);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.store.profiles).toHaveLength(2);
    expect(deleted.store.profiles.some((profile) => profile.id === deleted.store.activeProfileId)).toBe(true);

    const cannotDeleteLast = deleteProfile({
      ...deleted.store,
      profiles: [deleted.store.profiles[0]!],
      activeProfileId: deleted.store.profiles[0]!.id,
    }, deleted.store.profiles[0]!.id);
    expect(cannotDeleteLast.ok).toBe(false);
  });

  it('rejects invalid persisted direction, zoom, and layout values', () => {
    const store = createDefaultProfileStore();
    for (const [field, value] of [
      ['direction', 'diagonal'],
      ['zoomMode', 'warp'],
      ['layoutZone', 'center'],
    ] as const) {
      const candidate = {
        ...store,
        profiles: [{ ...store.profiles[0], [field]: value }],
      };
      expect(validateProfileStore(candidate).ok).toBe(false);
    }
  });
});
