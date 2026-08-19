export interface Vec2 {
  x: number;
  y: number;
}

export type TurnDirection = 'forward' | 'backward';

export type PageTurnDisabledReason = 'reduced-motion' | 'backend' | 'performance' | 'texture';

export type PageTurnCancelReason =
  | 'resize'
  | 'fullscreen'
  | 'profile'
  | 'publication'
  | 'publication-change'
  | 'overtaken'
  | 'hidden'
  | 'unmount'
  | 'backend'
  | 'solver';

export type PageTurnState =
  | { phase: 'idle'; queued?: TurnDirection }
  | { phase: 'preparing'; generation: number; direction: TurnDirection }
  | {
      phase: 'dragging';
      generation: number;
      direction: TurnDirection;
      pointerId: number;
      grab: Vec2;
      point: Vec2;
      velocity: Vec2;
    }
  | { phase: 'settling'; generation: number; direction: TurnDirection; outcome: 'commit' | 'cancel' }
  | { phase: 'committed'; generation: number; direction: TurnDirection; navigated: boolean }
  | { phase: 'disabled'; reason: PageTurnDisabledReason };

export type PageTurnEvent =
  | { type: 'request'; direction: TurnDirection; generation: number }
  | { type: 'textures-ready'; generation: number }
  | { type: 'pointer-down'; generation: number; pointerId: number; grab: Vec2; at: number }
  | { type: 'pointer-move'; pointerId: number; point: Vec2; velocity: Vec2 }
  | { type: 'pointer-up'; pointerId: number; displacement: number; velocityTowardDestination: number }
  | { type: 'finish-settle'; generation: number }
  | { type: 'navigation-ack'; generation: number }
  | { type: 'cancel'; reason: PageTurnCancelReason }
  | { type: 'disable'; reason: PageTurnDisabledReason };

export type PageTurnEffect =
  | { type: 'navigate'; direction: TurnDirection; generation: number }
  | { type: 'release-pointer'; pointerId: number }
  | { type: 'prepare'; direction: TurnDirection; generation: number };
