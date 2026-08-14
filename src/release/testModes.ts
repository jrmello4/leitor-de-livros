export type VisualBackend = 'auto' | 'static' | 'webgl2' | 'webgpu';

export function parseVisualBackend(search: string, enabled: boolean): VisualBackend {
  if (!enabled) {
    return 'auto';
  }

  const value = new URLSearchParams(search).get('renderBackend');
  return value === 'static' || value === 'webgl2' || value === 'webgpu' ? value : 'auto';
}

export function isSmokeMode(enabled: boolean, nativeRuntime: boolean): boolean {
  return enabled && nativeRuntime;
}
