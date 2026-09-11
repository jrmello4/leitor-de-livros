import { invoke } from '@tauri-apps/api/core';

export type RuntimePlatform = 'android' | 'windows' | 'macos' | 'linux' | 'web';

let platform: RuntimePlatform | null = null;
let loadPromise: Promise<RuntimePlatform> | null = null;

export function isNativeRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function uaFallback(): RuntimePlatform {
  if (typeof navigator === 'undefined') {
    return 'web';
  }
  if (/Android/i.test(navigator.userAgent)) {
    return 'android';
  }
  return 'web';
}

export function ensureRuntimePlatformLoaded(): Promise<RuntimePlatform> {
  if (!loadPromise) {
    loadPromise = (async () => {
      if (!isNativeRuntime()) {
        platform = uaFallback();
        return platform;
      }
      try {
        const value = await invoke<string>('runtime_platform');
        platform = value === 'android' || value === 'windows' || value === 'macos' || value === 'linux'
          ? value
          : uaFallback();
      } catch {
        platform = uaFallback();
      }
      return platform;
    })();
  }
  return loadPromise;
}

/** Synchronous view after boot (or UA fallback until the native command resolves). */
export function getRuntimePlatform(): RuntimePlatform {
  return platform ?? uaFallback();
}

export function isAndroidRuntime(): boolean {
  return getRuntimePlatform() === 'android';
}
