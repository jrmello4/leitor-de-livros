import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, InputMap } from './input';

describe('named input map', () => {
  it('resolves actions without coupling readers to physical keys', () => {
    const input = new InputMap();
    expect(input.resolve('ArrowRight')).toBe('next_page');
    expect(input.resolve('KeyF')).toBe('toggle_fullscreen');
    expect(input.resolve('Unknown')).toBeUndefined();
  });

  it('rejects conflicts while allowing a deliberate rebind', () => {
    const input = new InputMap();
    expect(input.bind('next_page', 'KeyF')).toEqual({ ok: false, conflict: 'toggle_fullscreen' });
    expect(input.bind('next_page', 'KeyN')).toEqual({ ok: true });
    expect(input.resolve('KeyN')).toBe('next_page');
  });

  it('can restore the default route back to the library', () => {
    const input = new InputMap();
    input.bind('cancel', 'KeyX');
    input.reset();
    expect(input.getBindings()).toEqual(DEFAULT_BINDINGS);
  });
});
