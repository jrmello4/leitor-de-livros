import { invoke } from '@tauri-apps/api/core';
import { isAndroidRuntime, isNativeRuntime } from './platform';

export const DEFAULT_UPDATE_MANIFEST_URL =
  'https://github.com/jrmello4/leitor-de-livros/releases/download/android-latest/latest.json';

export interface UpdateManifest {
  version: string;
  versionCode: number;
  url: string;
  notes: string;
}

export function isUpdaterAvailable(): boolean {
  return isNativeRuntime() && isAndroidRuntime();
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const cleaned = value.replace(/^v/i, '');
    const [core, ...rest] = cleaned.split('-');
    const nums = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
    return { nums, prerelease: rest.length > 0 ? rest.join('-') : null };
  };
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.nums.length, right.nums.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left.nums[index] ?? 0) - (right.nums[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  // Same core version: a prerelease is older than the final release.
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  return 0;
}

export async function getInstalledVersionCode(): Promise<number> {
  if (!isUpdaterAvailable()) {
    return -1;
  }
  try {
    const info = await invoke<{ versionCode?: unknown }>(
      'plugin:app-updater|get_installed_version',
    );
    return typeof info.versionCode === 'number' ? info.versionCode : -1;
  } catch {
    return -1;
  }
}

export function shouldOfferUpdate(
  currentVersion: string,
  manifest: UpdateManifest,
  installedVersionCode: number,
): boolean {
  const versionDelta = compareVersions(manifest.version, currentVersion);
  if (versionDelta !== 0) {
    return versionDelta > 0;
  }
  return (
    manifest.versionCode > 0 &&
    installedVersionCode >= 0 &&
    manifest.versionCode > installedVersionCode
  );
}

export async function checkForUpdate(
  currentVersion: string,
  manifestUrl = DEFAULT_UPDATE_MANIFEST_URL,
): Promise<UpdateManifest | null> {
  if (!isUpdaterAvailable()) {
    return null;
  }
  const raw = await invoke<Partial<UpdateManifest>>('plugin:app-updater|check_update', {
    manifestUrl,
  });
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!version || !url.startsWith('https://')) {
    return null;
  }
  const manifest: UpdateManifest = {
    version,
    versionCode: typeof raw.versionCode === 'number' ? raw.versionCode : -1,
    url,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
  const installedVersionCode = await getInstalledVersionCode();
  if (!shouldOfferUpdate(currentVersion, manifest, installedVersionCode)) {
    return null;
  }
  return manifest;
}

export async function downloadAndInstallUpdate(apkUrl: string): Promise<{ path: string; bytes: number }> {
  if (!isUpdaterAvailable()) {
    throw new Error('Updater is only available on the Android build');
  }
  return invoke('plugin:app-updater|download_and_install', { apkUrl });
}
