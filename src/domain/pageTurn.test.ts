import { describe, expect, it } from 'vitest';
import { resolvePageTurn } from './pageTurn';

describe('resolvePageTurn', () => {
  it('commits an available turn with the configured duration', () => {
    expect(resolvePageTurn('idle', true, false, 420)).toEqual({
      kind: 'commit',
      immediate: false,
      duration: 420,
    });
  });

  it('cancels at a boundary and clamps short tactile feedback', () => {
    expect(resolvePageTurn('idle', false, false, 90)).toEqual({
      kind: 'cancel',
      immediate: false,
      duration: 160,
    });
  });

  it('ignores a request while another turn is active', () => {
    expect(resolvePageTurn('committing', true, false, 420)).toEqual({ kind: 'ignored' });
    expect(resolvePageTurn('cancelling', false, false, 420)).toEqual({ kind: 'ignored' });
  });

  it('makes reduced-motion turns immediate', () => {
    expect(resolvePageTurn('idle', true, true, 420)).toEqual({
      kind: 'commit',
      immediate: true,
      duration: 0,
    });
  });
});
