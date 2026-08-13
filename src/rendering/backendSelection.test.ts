import { describe, expect, it } from 'vitest';
import { resolveBackendPreference } from './backendSelection';

describe('visual renderer backend selection', () => {
  it('does not allow a normal build to select a query-forced backend', () => {
    expect(resolveBackendPreference('?renderBackend=webgl2', false)).toBe('auto');
  });

  it('selects a documented backend only in a visual build', () => {
    expect(resolveBackendPreference('?renderBackend=webgpu', true)).toBe('webgpu');
    expect(resolveBackendPreference('?renderBackend=static', true)).toBe('static');
  });

  it('ignores unknown backend values', () => {
    expect(resolveBackendPreference('?renderBackend=canvas', true)).toBe('auto');
  });
});
