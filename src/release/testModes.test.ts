import { describe, expect, it } from 'vitest';
import { isSmokeMode, parseVisualBackend } from './testModes';

describe('test build modes', () => {
  it('ignores backend query parameters in a normal build', () => {
    expect(parseVisualBackend('?renderBackend=webgpu', false)).toBe('auto');
  });

  it('accepts only documented backend overrides in a visual build', () => {
    expect(parseVisualBackend('?renderBackend=static', true)).toBe('static');
    expect(parseVisualBackend('?renderBackend=webgl2', true)).toBe('webgl2');
    expect(parseVisualBackend('?renderBackend=webgpu', true)).toBe('webgpu');
    expect(parseVisualBackend('?renderBackend=canvas', true)).toBe('auto');
  });

  it('requires both the smoke flag and native runtime', () => {
    expect(isSmokeMode(true, true)).toBe(true);
    expect(isSmokeMode(true, false)).toBe(false);
    expect(isSmokeMode(false, true)).toBe(false);
  });
});
