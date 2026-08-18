export type PageTurnPhase = 'idle' | 'dragging' | 'committing' | 'cancelling';

export type PageTurnDecision =
  | { kind: 'commit'; immediate: boolean; duration: number }
  | { kind: 'cancel'; immediate: boolean; duration: number }
  | { kind: 'ignored' };

const MIN_TACTILE_DURATION = 160;

export function resolvePageTurn(
  phase: PageTurnPhase,
  available: boolean,
  reducedMotion: boolean,
  duration: number,
): PageTurnDecision {
  if (phase !== 'idle') {
    return { kind: 'ignored' };
  }

  if (reducedMotion) {
    return {
      kind: available ? 'commit' : 'cancel',
      immediate: true,
      duration: 0,
    };
  }

  return {
    kind: available ? 'commit' : 'cancel',
    immediate: false,
    duration: Math.max(duration, MIN_TACTILE_DURATION),
  };
}
