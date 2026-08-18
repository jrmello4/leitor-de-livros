import { describe, expect, it } from 'vitest';
import { isSmokeMode, parseVisualBackend } from './testModes';

describe('test build modes', () => {
  it('ignores backend query parameters in a normal build', () => {
    expect(parseVisualBackend('?renderBackend=webgpu', false)).toBe('auto');
  });

  it('returns auto for an explicit auto backend in a visual build', () => {
    expect(parseVisualBackend('?renderBackend=auto', true)).toBe('auto');
  });

  it('returns auto when a visual build has no backend query', () => {
    expect(parseVisualBackend('', true)).toBe('auto');
  });

  it('accepts documented non-auto backend overrides in a visual build', () => {
    expect(parseVisualBackend('?renderBackend=static', true)).toBe('static');
    expect(parseVisualBackend('?renderBackend=webgl2', true)).toBe('webgl2');
    expect(parseVisualBackend('?renderBackend=webgpu', true)).toBe('webgpu');
  });

  it('returns auto for an invalid backend value in a visual build', () => {
    expect(parseVisualBackend('?renderBackend=canvas', true)).toBe('auto');
  });

  it('keeps explicit and valid backend queries behind the visual-build guard', () => {
    expect(parseVisualBackend('?renderBackend=auto', false)).toBe('auto');
    expect(parseVisualBackend('?renderBackend=static', false)).toBe('auto');
    expect(parseVisualBackend('?renderBackend=webgl2', false)).toBe('auto');
    expect(parseVisualBackend('?renderBackend=webgpu', false)).toBe('auto');
  });

  it('requires both the smoke flag and native runtime', () => {
    expect(isSmokeMode(true, true)).toBe(true);
    expect(isSmokeMode(true, false)).toBe(false);
    expect(isSmokeMode(false, true)).toBe(false);
  });
});
