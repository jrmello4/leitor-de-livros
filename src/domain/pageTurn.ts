import type {
  PageTurnCancelReason,
  PageTurnDisabledReason,
  PageTurnEffect,
  PageTurnEvent,
  PageTurnState,
  TurnDirection,
  Vec2,
} from './pageTurnTypes';

export type { PageTurnCancelReason, PageTurnDisabledReason, PageTurnEffect, PageTurnEvent, PageTurnState, TurnDirection, Vec2 } from './pageTurnTypes';

export const PAGE_TURN_THRESHOLDS = {
  displacement: 0.45,
  flingVelocity: 0.65,
  minimumFlingDisplacement: 0.12,
} as const;

export function releaseOutcome(displacement: number, velocity: number): 'commit' | 'cancel' {
  return displacement >= PAGE_TURN_THRESHOLDS.displacement ||
    (displacement >= PAGE_TURN_THRESHOLDS.minimumFlingDisplacement &&
      velocity >= PAGE_TURN_THRESHOLDS.flingVelocity)
    ? 'commit'
    : 'cancel';
}

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

type TransitionResult = {
  state: PageTurnState;
  effects: PageTurnEffect[];
};

function copyVec(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

function isActiveState(state: PageTurnState): state is Extract<PageTurnState, { phase: 'preparing' | 'dragging' | 'settling' | 'committed' }> {
  return state.phase !== 'idle' && state.phase !== 'disabled';
}

function notMatchedGeneration(state: PageTurnState, generation: number): boolean {
  return 'generation' in state && state.generation !== generation;
}

function stateDirectionSign(direction: TurnDirection): number {
  return direction === 'forward' ? -1 : 1;
}

export function transitionPageTurn(state: PageTurnState, event: PageTurnEvent): TransitionResult {
  switch (event.type) {
    case 'request': {
      if (state.phase !== 'idle') {
        return { state, effects: [] };
      }

      return {
        state: { phase: 'preparing', generation: event.generation, direction: event.direction },
        effects: [{ type: 'prepare', direction: event.direction, generation: event.generation }],
      };
    }
    case 'textures-ready': {
      if (state.phase !== 'preparing' || notMatchedGeneration(state, event.generation)) {
        return { state, effects: [] };
      }

      return { state, effects: [] };
    }
    case 'pointer-down': {
      if (state.phase !== 'preparing' || notMatchedGeneration(state, event.generation)) {
        return { state, effects: [] };
      }

      return {
        state: {
          phase: 'dragging',
          generation: state.generation,
          direction: state.direction,
          pointerId: event.pointerId,
          grab: copyVec(event.grab),
          point: copyVec(event.grab),
          velocity: { x: 0, y: 0 },
        },
        effects: [],
      };
    }
    case 'pointer-move': {
      if (state.phase !== 'dragging' || state.pointerId !== event.pointerId) {
        return { state, effects: [] };
      }

      return {
        state: {
          ...state,
          point: copyVec(event.point),
          velocity: copyVec(event.velocity),
        },
        effects: [],
      };
    }
    case 'pointer-up': {
      if (state.phase !== 'dragging' || state.pointerId !== event.pointerId) {
        return { state, effects: [] };
      }

      return {
        state: {
          phase: 'settling',
          generation: state.generation,
          direction: state.direction,
          outcome: releaseOutcome(event.displacement, event.velocityTowardDestination),
        },
        effects: [{ type: 'release-pointer', pointerId: state.pointerId }],
      };
    }
    case 'finish-settle': {
      if (state.phase !== 'settling' || notMatchedGeneration(state, event.generation)) {
        return { state, effects: [] };
      }

      if (state.outcome === 'commit') {
        return {
          state: {
            phase: 'committed',
            generation: state.generation,
            direction: state.direction,
            navigated: true,
          },
          effects: [{ type: 'navigate', direction: state.direction, generation: state.generation }],
        };
      }

      return { state: { phase: 'idle' }, effects: [] };
    }
    case 'navigation-ack': {
      if (state.phase !== 'committed' || notMatchedGeneration(state, event.generation)) {
        return { state, effects: [] };
      }

      return { state: { phase: 'idle' }, effects: [] };
    }
    case 'cancel': {
      if (!isActiveState(state)) {
        return { state, effects: [] };
      }

      if (state.phase === 'dragging') {
        return { state: { phase: 'idle' }, effects: [{ type: 'release-pointer', pointerId: state.pointerId }] };
      }

      return { state: { phase: 'idle' }, effects: [] };
    }
    case 'disable': {
      return { state: { phase: 'disabled', reason: event.reason }, effects: [] };
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

type NavigationEffect = Extract<PageTurnEffect, { type: 'navigate' }>;

export class PageTurnController {
  private state: PageTurnState = { phase: 'idle' };
  /**
   * Turns asked for while one is already running. `pending` counts them: a
   * reader clicking faster than a fold settles must not lose pages, and a
   * single slot silently dropped every request past the second. Opposite
   * requests cancel each other, because a reader who goes back has undone the
   * page they just asked for.
   */
  private queuedTurn?: { generation: number; direction: TurnDirection; pending: number };
  private readonly effect?: (effect: PageTurnEffect) => void;
  private readonly navigate: (effect: NavigationEffect) => void;
  private generation = 0;
  private dragPointer?: {
    pointerId: number;
    grab: Vec2;
    point: Vec2;
    startedAt: number;
  };

  constructor(options: { effect?: (effect: PageTurnEffect) => void; navigate: (effect: NavigationEffect) => void }) {
    this.effect = options.effect;
    this.navigate = options.navigate;
  }

  snapshot(): PageTurnState {
    return this.state;
  }

  request(direction: TurnDirection, reducedMotion: boolean): number {
    const generation = ++this.generation;

    if (reducedMotion) {
      this.queuedTurn = undefined;
      this.state = { phase: 'idle' };
      this.navigate({ type: 'navigate', direction, generation });
      return generation;
    }

    if (this.state.phase === 'idle') {
      const result = transitionPageTurn(this.state, { type: 'request', direction, generation });
      this.applyResult(result);
      return generation;
    }

    if (this.state.phase !== 'disabled') {
      this.queuedTurn = this.queueTurn(this.queuedTurn, generation, direction);
    }

    return generation;
  }

  private queueTurn(
    queued: { generation: number; direction: TurnDirection; pending: number } | undefined,
    generation: number,
    direction: TurnDirection,
  ): { generation: number; direction: TurnDirection; pending: number } | undefined {
    if (!queued) {
      return { generation, direction, pending: 1 };
    }
    if (queued.direction === direction) {
      return { generation, direction, pending: queued.pending + 1 };
    }
    const pending = queued.pending - 1;
    return pending > 0 ? { ...queued, pending } : undefined;
  }

  texturesReady(generation: number): void {
    this.applyResult(transitionPageTurn(this.state, { type: 'textures-ready', generation }));
  }

  beginPointer(generation: number, pointerId: number, grab: Vec2, at: number): void {
    const result = transitionPageTurn(this.state, { type: 'pointer-down', generation, pointerId, grab, at });
    this.applyResult(result);

    if (this.state.phase === 'dragging' && this.state.pointerId === pointerId) {
      this.dragPointer = {
        pointerId,
        grab: { x: grab.x, y: grab.y },
        point: { x: grab.x, y: grab.y },
        startedAt: at,
      };
    }
  }

  movePointer(pointerId: number, point: Vec2, at: number): void {
    if (this.state.phase !== 'dragging' || this.state.pointerId !== pointerId || !this.dragPointer) {
      return;
    }

    const velocity = {
      x: (point.x - this.dragPointer.point.x) / Math.max(1, at - this.dragPointer.startedAt),
      y: (point.y - this.dragPointer.point.y) / Math.max(1, at - this.dragPointer.startedAt),
    };

    this.dragPointer.point = { x: point.x, y: point.y };
    this.applyResult(transitionPageTurn(this.state, { type: 'pointer-move', pointerId, point, velocity }));
  }

  releasePointer(pointerId: number, at: number): void {
    if (this.state.phase !== 'dragging' || this.state.pointerId !== pointerId || !this.dragPointer) {
      return;
    }

    const elapsedSeconds = Math.max((at - this.dragPointer.startedAt) / 1000, Number.EPSILON);
    const signedDisplacement =
      stateDirectionSign(this.state.phase === 'dragging' ? this.state.direction : 'forward')
      * (this.dragPointer.point.x - this.dragPointer.grab.x);
    const velocityTowardDestination = signedDisplacement / elapsedSeconds;
    this.applyResult(
      transitionPageTurn(this.state, {
        type: 'pointer-up',
        pointerId,
        displacement: signedDisplacement,
        velocityTowardDestination,
      }),
    );
    this.dragPointer = undefined;
  }

  finishSettle(generation: number): void {
    const result = transitionPageTurn(this.state, { type: 'finish-settle', generation });
    this.applyResult(result);
    if (this.state.phase === 'idle') {
      this.promoteQueuedTurn();
    }
  }

  navigationAck(generation: number): void {
    this.applyResult(transitionPageTurn(this.state, { type: 'navigation-ack', generation }));
    if (this.state.phase === 'idle') {
      this.promoteQueuedTurn();
    }
  }

  cancel(reason: PageTurnCancelReason): void {
    const result = transitionPageTurn(this.state, { type: 'cancel', reason });
    this.applyResult(result);
    this.dragPointer = undefined;
    if (this.state.phase === 'idle') {
      this.promoteQueuedTurn();
    }
  }

  disable(reason: PageTurnDisabledReason): void {
    this.queuedTurn = undefined;
    this.dragPointer = undefined;
    this.applyResult(transitionPageTurn(this.state, { type: 'disable', reason }));
  }

  private applyResult(result: TransitionResult): void {
    this.state = result.state;
    for (const effect of result.effects) {
      this.effect?.(effect);
      if (effect.type === 'navigate') {
        this.navigate(effect);
      }
    }
  }

  private promoteQueuedTurn(): void {
    if (!this.queuedTurn || this.state.phase !== 'idle') {
      return;
    }

    const queued = this.queuedTurn;
    this.queuedTurn = undefined;
    // Everything that piled up beyond the next fold takes its page at once;
    // animating a backlog one fold at a time would leave the reader watching
    // the pages they already asked to pass.
    for (let surplus = 1; surplus < queued.pending; surplus += 1) {
      this.navigate({ type: 'navigate', direction: queued.direction, generation: queued.generation });
    }
    this.applyResult(
      transitionPageTurn(this.state, {
        type: 'request',
        direction: queued.direction,
        generation: queued.generation,
      }),
    );
  }
}
