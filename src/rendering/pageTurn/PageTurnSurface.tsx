import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageTurnScene } from '../../domain/pageTurnScene';
import type { ReadingDirection } from '../../domain/types';
import type { RenderQuality } from '../contracts';
import { PAGE_TURN_MESH_VERSION } from './mesh';
import { PaperPhysicsSolver, type PageTurnPhysicsFrame } from './physics';
import {
  PAGE_TURN_LUMINANCE_BOUNDS,
  type PageTurnBackend,
  type PageTurnFailure,
  type PageTurnMetrics,
  type PageTurnRenderFrame,
  type PageTurnSettled,
  type PageTurnSurfaceState,
  type PageTurnViewport,
} from './contracts';
import { PageTurnTextureCache, type PreparedPageImage } from './textures';
import { createPageTurnWebGl2 } from './webgl2';

export type { PageTurnSurfaceState } from './contracts';

interface PageTurnSurfaceProps {
  scene: PageTurnScene;
  generation: number;
  state: PageTurnSurfaceState;
  quality: RenderQuality;
  onReady: (generation: number) => void;
  onSettled: (result: PageTurnSettled) => void;
  onFailure: (failure: PageTurnFailure) => void;
  onMetrics: (metrics: PageTurnMetrics) => void;
}

export function PageTurnSurface({
  scene,
  generation,
  state,
  quality,
  onReady,
  onSettled,
  onFailure,
  onMetrics,
}: PageTurnSurfaceProps) {
  const active = state.phase !== 'idle';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backendRef = useRef<PageTurnBackend | undefined>(undefined);
  const frameRef = useRef<PageTurnRenderFrame | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const configuredViewportRef = useRef<PageTurnViewport | undefined>(undefined);
  const textureMetaRef = useRef({ count: 0, bytes: 0 });
  const settledRef = useRef<string | undefined>(undefined);
  const [backendKind, setBackendKind] = useState<PageTurnBackend['kind']>('webgl2');
  const [preparedGeneration, setPreparedGeneration] = useState<number | undefined>(undefined);
  const textureCache = useMemo(
    () => new PageTurnTextureCache<PreparedPageImage>({ load: loadPreparedPageImage, dispose: disposePreparedPageImage }),
    [],
  );

  useEffect(() => () => textureCache.dispose(), [textureCache]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) {
      if (!active) {
        setPreparedGeneration(undefined);
        settledRef.current = undefined;
        configuredViewportRef.current = undefined;
      }
      return undefined;
    }

    let cancelled = false;
    let failed = false;
    let backend: PageTurnBackend | undefined;

    try {
      backend = backendRef.current ?? createPageTurnWebGl2(canvas);
      backendRef.current = backend;
      setBackendKind(backend.kind);
    } catch (error: unknown) {
      onFailure({
        reason: 'backend',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }

    const fail = (failure: PageTurnFailure) => {
      if (failed) {
        return;
      }

      failed = true;
      cancelled = true;
      cancelAnimationFrameSafe(rafRef.current);
      backendRef.current?.disposeScene();
      configuredViewportRef.current = undefined;
      textureMetaRef.current = { count: 0, bytes: 0 };
      textureCache.releaseGeneration(generation);
      setPreparedGeneration((current) => (current === generation ? undefined : current));
      onFailure(failure);
    };

    const handleContextLoss = (event: Event) => {
      event.preventDefault?.();
      fail({
        reason: 'backend',
        diagnostic: 'WebGL2 context lost during physical page turn.',
      });
    };

    canvas.addEventListener('webglcontextlost', handleContextLoss);

    void (async () => {
      const preparation = await textureCache.prepare(scene, generation, viewportForCanvas(canvas));
      if (cancelled) {
        return;
      }

      if (preparation.kind !== 'ready') {
        fail({
          reason: 'backend',
          diagnostic: preparation.kind === 'error'
            ? preparation.message
            : `Page-turn textures were not ready (${preparation.kind}).`,
        });
        return;
      }

      await backend.prepare(scene, preparation.textures);
      if (cancelled) {
        return;
      }
      ensureConfiguredViewport(backend, viewportForCanvas(canvas), configuredViewportRef);
      if (cancelled) {
        return;
      }

      textureMetaRef.current = {
        count: preparation.textures.count,
        bytes: preparation.textures.bytes,
      };
      setPreparedGeneration(generation);
      onReady(generation);
    })().catch((error: unknown) => {
      if (!cancelled) {
        fail({
          reason: 'backend',
          diagnostic: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => {
      cancelled = true;
      backend.disposeScene();
      configuredViewportRef.current = undefined;
      textureMetaRef.current = { count: 0, bytes: 0 };
      textureCache.releaseGeneration(generation);
      canvas.removeEventListener('webglcontextlost', handleContextLoss);
    };
  }, [active, generation, onFailure, onReady, scene, textureCache]);

  useEffect(() => {
    if (!active || preparedGeneration !== generation || !backendRef.current) {
      cancelAnimationFrameSafe(rafRef.current);
      return undefined;
    }

    let cancelled = false;

    const tick = () => {
      if (cancelled || !canvasRef.current || !backendRef.current) {
        return;
      }

      const viewport = viewportForCanvas(canvasRef.current);
      ensureConfiguredViewport(backendRef.current, viewport, configuredViewportRef);
      const physicsFrame = state.frame ?? syntheticPhysicsFrame(state.direction, quality, state.progress);
      const frame = buildFrame(state, quality, viewport, physicsFrame);
      frameRef.current = frame;

      if (physicsFrame?.invalidReason) {
        backendRef.current.disposeScene();
        onFailure({
          reason: 'solver',
          diagnostic: `Physical page-turn solver produced ${physicsFrame.invalidReason}.`,
        });
        return;
      }

      backendRef.current.render(frame);
      onMetrics({
        backend: backendRef.current.kind,
        generation,
        meshVersion: PAGE_TURN_MESH_VERSION,
        progress: frame.progress,
        quality,
        textureCount: textureMetaRef.current.count,
        textureBytes: textureMetaRef.current.bytes,
      });

      if (state.phase === 'settling' && physicsFrame.settled === state.outcome) {
        const token = `${generation}:${state.outcome}`;
        if (settledRef.current !== token) {
          settledRef.current = token;
          onSettled({ generation, outcome: state.outcome });
        }
        return;
      }

      rafRef.current = requestAnimationFrameSafe(tick);
    };

    rafRef.current = requestAnimationFrameSafe(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrameSafe(rafRef.current);
    };
  }, [active, generation, onFailure, onMetrics, onSettled, preparedGeneration, quality, state]);

  useEffect(() => () => backendRef.current?.dispose(), []);

  return active ? (
    <canvas
      ref={canvasRef}
      className="page-turn-canvas"
      data-testid="page-turn-canvas"
      data-turn-backend={backendKind}
      data-mesh-version={PAGE_TURN_MESH_VERSION}
      aria-hidden="true"
    />
  ) : null;
}

function buildFrame(
  state: PageTurnSurfaceState,
  quality: RenderQuality,
  viewport: PageTurnViewport,
  physics?: PageTurnPhysicsFrame,
): PageTurnRenderFrame {
  if (state.phase === 'idle') {
    return {
      meshVersion: PAGE_TURN_MESH_VERSION,
      controlPoints: new Float32Array(0),
      progress: 0,
      grabPoint: { x: 1, y: 0.5 },
      viewport,
      luminance: PAGE_TURN_LUMINANCE_BOUNDS,
      quality,
    };
  }

  const resolvedPhysics = physics ?? state.frame ?? syntheticPhysicsFrame(state.direction, quality, state.progress);

  return {
    meshVersion: PAGE_TURN_MESH_VERSION,
    controlPoints: resolvedPhysics.controlPoints,
    progress: state.progress,
    grabPoint: resolvedPhysics.grabPoint,
    viewport,
    luminance: PAGE_TURN_LUMINANCE_BOUNDS,
    quality,
  };
}

function syntheticPhysicsFrame(direction: ReadingDirection, quality: RenderQuality, progress: number) {
  const grab = direction === 'rtl' ? { x: 0, y: 0.5 } : { x: 1, y: 0.5 };
  const pointerX = direction === 'rtl'
    ? Math.min(1, Math.max(0, progress))
    : Math.min(1, Math.max(0, 1 - progress));
  return new PaperPhysicsSolver({ quality, direction }).begin(grab).step({
    pointer: { x: pointerX, y: 0.5 },
    elapsedMs: 16.7,
  });
}

function viewportForCanvas(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, bounds.width || canvas.clientWidth || canvas.width || 1),
    height: Math.max(1, bounds.height || canvas.clientHeight || canvas.height || 1),
    dpr: typeof window === 'undefined' ? 1 : Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
  };
}

export async function loadPreparedPageImage(request: { src: string; width: number; height: number }): Promise<PreparedPageImage> {
  const image = await loadImage(request.src);
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(image)
    : image as unknown as ImageBitmap;

  return {
    bitmap,
    width: request.width,
    height: request.height,
    bytes: request.width * request.height * 4,
  };
}

function disposePreparedPageImage(image: PreparedPageImage): void {
  const closable = image.bitmap as ImageBitmap & { close?: () => void };
  closable.close?.();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
  // Page images are served from the asset protocol, which is a different
  // origin from the app document. Without a CORS request the decoded image is
  // origin-tainted, and the first texture upload fails with "The ImageBitmap
  // contains cross-origin data" — which takes the whole physical page turn down
  // in the packaged app while every same-origin browser test still passes.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not decode page-turn image ${src}.`));
    image.src = src;
    if (image.complete && image.naturalWidth > 0) {
      resolve(image);
    }
  });
}

function requestAnimationFrameSafe(callback: FrameRequestCallback): number | undefined {
  return typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame(callback)
    : undefined;
}

function cancelAnimationFrameSafe(id: number | undefined): void {
  if (id !== undefined && typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(id);
  }
}

function ensureConfiguredViewport(
  backend: PageTurnBackend,
  viewport: PageTurnViewport,
  ref: { current: PageTurnViewport | undefined },
): void {
  if (sameViewport(ref.current, viewport)) {
    return;
  }

  backend.resize(viewport);
  ref.current = viewport;
}

function sameViewport(left: PageTurnViewport | undefined, right: PageTurnViewport): boolean {
  return left?.width === right.width
    && left?.height === right.height
    && left?.dpr === right.dpr;
}
