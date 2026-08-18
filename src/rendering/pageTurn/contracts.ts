import type { PageTurnScene } from '../../domain/pageTurnScene';
import type { Vec2 } from '../../domain/pageTurnTypes';
import type { ReadingDirection } from '../../domain/types';
import type { RenderQuality } from '../contracts';
import type { PageTurnPhysicsFrame } from './physics';
import type { PreparedPageImage, PreparedPageTurnTextures } from './textures';
import { PAGE_TURN_MESH_VERSION } from './mesh';

export const PAGE_TURN_LUMINANCE_BOUNDS = {
  minimum: 0.72,
  maximum: 1.08,
} as const;

export interface PageTurnViewport {
  width: number;
  height: number;
  dpr: number;
}

export interface PageTurnRenderFrame {
  meshVersion: typeof PAGE_TURN_MESH_VERSION;
  controlPoints: Float32Array;
  progress: number;
  grabPoint: Vec2;
  viewport: PageTurnViewport;
  luminance: typeof PAGE_TURN_LUMINANCE_BOUNDS;
  quality: RenderQuality;
}

export interface PageTurnBackend {
  readonly kind: 'webgl2' | 'webgpu';
  prepare(scene: PageTurnScene, textures: PreparedPageTurnTextures<PreparedPageImage>): Promise<void>;
  resize(viewport: PageTurnViewport): void;
  render(frame: PageTurnRenderFrame): void;
  disposeScene(): void;
  dispose(): void;
}

export interface PageTurnMetrics {
  backend: PageTurnBackend['kind'];
  generation: number;
  meshVersion: typeof PAGE_TURN_MESH_VERSION;
  progress: number;
  quality: RenderQuality;
  textureCount: number;
  textureBytes: number;
}

export interface PageTurnFailure {
  reason: 'backend' | 'solver';
  diagnostic: string;
}

export interface PageTurnSettled {
  generation: number;
  outcome: 'commit' | 'cancel';
}

export type PageTurnSurfaceState =
  | { phase: 'idle' }
  | {
      phase: 'preparing' | 'dragging';
      direction: ReadingDirection;
      progress: number;
      frame?: PageTurnPhysicsFrame;
    }
  | {
      phase: 'settling';
      direction: ReadingDirection;
      progress: number;
      outcome: 'commit' | 'cancel';
      frame?: PageTurnPhysicsFrame;
    };
