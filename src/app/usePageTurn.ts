import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { buildPageTurnScene, type PageTurnScene } from '../domain/pageTurnScene';
import { PageTurnController, type PageTurnCancelReason, type PageTurnDisabledReason, type TurnDirection, type Vec2 } from '../domain/pageTurn';
import { clientToPagePoint, isVisibleOuterEdgeHit, turnDisplacement } from '../domain/pageTurnGeometry';
import type { Publication, ReadingDirection, ReadingMode } from '../domain/types';
import type { RenderQuality } from '../rendering/contracts';
import { PaperPhysicsSolver, type PageTurnPhysicsFrame } from '../rendering/pageTurn/physics';
import type { PageTurnFailure, PageTurnMetrics, PageTurnSettled, PageTurnSurfaceState } from '../rendering/pageTurn/contracts';

type PointerLike = {
  clientX: number;
  clientY: number;
  button: number;
  pointerId: number;
  isPrimary?: boolean;
  pointerType?: string;
  currentTarget: {
    setPointerCapture(pointerId: number): void;
    releasePointerCapture(pointerId: number): void;
    hasPointerCapture(pointerId: number): boolean;
    getBoundingClientRect?(): DOMRect | { left: number; top: number; right: number; bottom: number };
  };
};

type PendingPointer = {
  pointerId: number;
  grab: Vec2;
  pointerType?: string;
};

type SyntheticTrajectory = {
  direction: TurnDirection;
  grab: Vec2;
  point: Vec2;
};

type PlannedTurn = {
  generation: number;
  direction: TurnDirection;
  scene: PageTurnScene;
  kind: 'pointer' | 'automatic';
  grab: Vec2;
  pendingPointer?: PendingPointer;
  syntheticTrajectory?: SyntheticTrajectory;
};

export interface UsePageTurnOptions {
  publication: Publication;
  mode: ReadingMode;
  readingDirection: ReadingDirection;
  reducedMotion: boolean;
  transformedPage: RefObject<HTMLDivElement | null>;
  zoom: {
    scale: number;
    panX: number;
    panY: number;
  };
  canNext: boolean;
  canPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
}

export interface UsePageTurnResult {
  state:
    | { phase: 'idle' }
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
  scene?: PageTurnScene;
  surfaceInput?: {
    scene: PageTurnScene;
    generation: number;
    state: PageTurnSurfaceState;
    progress: number;
    quality: RenderQuality;
    onMetrics: (metrics: PageTurnMetrics) => void;
  };
  edgeProps: {
    onPointerDown?: (event: PointerLike) => void;
    onPointerMove?: (event: PointerLike) => void;
    onPointerUp?: (event: PointerLike) => void;
    onPointerCancel?: () => void;
  };
  requestTurn: (delta: number) => void;
  cancelTurn: (reason: PageTurnCancelReason) => void;
  acknowledgeNavigation: (generation?: number) => void;
  onTexturesAndBackendReady: (generation: number) => void;
  onSettled: (result: PageTurnSettled) => void;
  onFailure: (failure: PageTurnFailure) => void;
  pendingPointer?: PendingPointer;
  syntheticTrajectory?: SyntheticTrajectory;
  failure?: PageTurnFailure;
}

const SURFACE_QUALITY: RenderQuality = 'balanced';
const SYNTHETIC_GRAB_Y = 0.62;
const HOVER_PROGRESS_LIMIT = 0.03;
const AUTOMATIC_POINTER_ID = -1;
const SYNTHETIC_DURATION_MS = 180;
const FOLD_FAILURES_BEFORE_RETIRING = 3;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function logicalDeltaToTurnDirection(delta: number, readingDirection: ReadingDirection): TurnDirection {
  const sourceDelta = readingDirection === 'rtl' ? -Math.sign(delta) : Math.sign(delta);
  return sourceDelta >= 0 ? 'forward' : 'backward';
}

function turnDirectionToCallback(direction: TurnDirection, readingDirection: ReadingDirection, onNext: () => void, onPrevious: () => void) {
  const delta = readingDirection === 'rtl'
    ? direction === 'forward' ? -1 : 1
    : direction === 'forward' ? 1 : -1;
  return delta > 0 ? onNext : onPrevious;
}

/**
 * The sheet is grabbed at the corner it leaves from and must travel toward the
 * destination the controller signs its release against: a `forward` turn sweeps
 * left, a `backward` turn sweeps right. Reading direction is already folded in
 * by `logicalDeltaToTurnDirection`, so applying it again here would sweep the
 * page away from its destination and every release would read as a cancel.
 */
function automaticGrabX(turnDirection: TurnDirection): number {
  return turnDirection === 'forward' ? 1 : 0;
}

function automaticPoint(turnDirection: TurnDirection, grab: Vec2, progress: number): Vec2 {
  const destinationX = turnDirection === 'forward' ? 0.16 : 0.84;
  const curveHeight = turnDirection === 'forward' ? 0.04 : -0.04;
  return {
    x: grab.x + (destinationX - grab.x) * progress,
    y: clamp(grab.y + Math.sin(progress * Math.PI) * curveHeight, 0, 1),
  };
}

function pageFrameFor(
  element: HTMLDivElement | null,
  stage?: PointerLike['currentTarget'],
): {
  left: number;
  top: number;
  width: number;
  height: number;
  clipLeft?: number;
  clipTop?: number;
  clipRight?: number;
  clipBottom?: number;
} | undefined {
  const bounds = element?.getBoundingClientRect();
  if (!bounds) {
    return undefined;
  }

  const stageBounds = stage?.getBoundingClientRect?.();
  const width = element?.offsetWidth || bounds.width;
  const height = element?.offsetHeight || bounds.height;

  return {
    left: bounds.left,
    top: bounds.top,
    width,
    height,
    clipLeft: stageBounds?.left,
    clipTop: stageBounds?.top,
    clipRight: stageBounds?.right,
    clipBottom: stageBounds?.bottom,
  };
}

function hoverProgressFor(clientX: number, frame: { left: number; width: number }, direction: ReadingDirection): number {
  const pageWidth = Math.max(frame.width, 1);
  const distanceFromEdge = direction === 'rtl'
    ? clientX - frame.left
    : frame.left + frame.width - clientX;
  return clamp(distanceFromEdge / pageWidth, 0, HOVER_PROGRESS_LIMIT);
}

export function usePageTurn(options: UsePageTurnOptions): UsePageTurnResult {
  const { publication, mode, readingDirection, reducedMotion, transformedPage, zoom, canNext, canPrevious } = options;
  const onNextRef = useRef(options.onNext);
  const onPreviousRef = useRef(options.onPrevious);
  const plannedTurnsRef = useRef(new Map<number, PlannedTurn>());
  const physicsRef = useRef<PaperPhysicsSolver | undefined>(undefined);
  const stageTargetRef = useRef<PointerLike['currentTarget'] | undefined>(undefined);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const animationTokenRef = useRef<string | undefined>(undefined);
  const awaitingNavigationGenerationRef = useRef<number | undefined>(undefined);
  const previousPageRef = useRef(publication.currentPage);
  const previousPublicationIdRef = useRef(publication.id);
  const previousModeRef = useRef(mode);
  const previousDirectionRef = useRef(readingDirection);
  const controllerRef = useRef<PageTurnController | undefined>(undefined);
  const startedGenerationRef = useRef(0);
  /**
   * Consecutive fold failures. A page that failed to prepare once may prepare
   * next time, so retiring the surface on the first failure costs the reader
   * every remaining animation of the session for what is often a transient
   * stall. Repeated failures are a different story and do retire it.
   */
  const foldFailuresRef = useRef(0);

  const [state, setState] = useState<UsePageTurnResult['state']>({ phase: 'idle' });
  const [scene, setScene] = useState<PageTurnScene | undefined>(undefined);
  const [surfaceState, setSurfaceState] = useState<PageTurnSurfaceState>({ phase: 'idle' });
  const [surfaceGeneration, setSurfaceGeneration] = useState<number | undefined>(undefined);
  const [pendingPointer, setPendingPointer] = useState<PendingPointer | undefined>(undefined);
  const [syntheticTrajectory, setSyntheticTrajectory] = useState<SyntheticTrajectory | undefined>(undefined);
  const [failure, setFailure] = useState<PageTurnFailure | undefined>(undefined);

  onNextRef.current = options.onNext;
  onPreviousRef.current = options.onPrevious;

  const clearAnimation = useCallback(() => {
    if (animationFrameRef.current !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = undefined;
    animationTokenRef.current = undefined;
  }, []);

  const clearSurface = useCallback(() => {
    setScene(undefined);
    setSurfaceGeneration(undefined);
    setSurfaceState({ phase: 'idle' });
    setPendingPointer(undefined);
    setSyntheticTrajectory(undefined);
    physicsRef.current = undefined;
  }, []);

  const releasePointerCapture = useCallback((pointerId?: number) => {
    if (pointerId === undefined || !stageTargetRef.current) {
      return;
    }

    if (stageTargetRef.current.hasPointerCapture(pointerId)) {
      stageTargetRef.current.releasePointerCapture(pointerId);
    }
    stageTargetRef.current = undefined;
  }, []);

  const syncFromController = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }

    const snapshot = controller.snapshot();
    setState(snapshot as UsePageTurnResult['state']);

    if (snapshot.phase === 'idle' || snapshot.phase === 'disabled') {
      if (snapshot.phase === 'disabled') {
        setState(snapshot as UsePageTurnResult['state']);
      }
      clearSurface();
      return;
    }

    const planned = 'generation' in snapshot ? plannedTurnsRef.current.get(snapshot.generation) : undefined;
    if (planned) {
      setScene(planned.scene);
      setSurfaceGeneration(planned.generation);
      setPendingPointer(planned.pendingPointer);
      setSyntheticTrajectory(planned.syntheticTrajectory);
    }

    if (snapshot.phase === 'preparing' && planned) {
      const previewFrame = new PaperPhysicsSolver({ quality: SURFACE_QUALITY, direction: readingDirection })
        .begin(planned.grab)
        .step({ pointer: planned.grab, elapsedMs: 16.7 });
      setSurfaceState({
        phase: 'preparing',
        direction: readingDirection,
        progress: 0,
        frame: previewFrame,
      });
      return;
    }

    if (snapshot.phase === 'committed') {
      setSurfaceState((current) => current.phase === 'idle'
        ? current
        : {
            phase: 'settling',
            direction: readingDirection,
            progress: 1,
            outcome: 'commit',
            frame: current.frame,
          });
    }
  }, [clearSurface, readingDirection]);

  if (!controllerRef.current) {
    controllerRef.current = new PageTurnController({
      navigate: ({ direction, generation }) => {
        awaitingNavigationGenerationRef.current = generation;
        turnDirectionToCallback(direction, readingDirection, onNextRef.current, onPreviousRef.current)();
      },
    });
  }

  const cancelTurn = useCallback((reason: PageTurnCancelReason) => {
    clearAnimation();
    releasePointerCapture(
      state.phase === 'dragging' ? state.pointerId : pendingPointer?.pointerId,
    );
    controllerRef.current?.cancel(reason);
    if (controllerRef.current?.snapshot().phase === 'idle') {
      const latestQueued = [...plannedTurnsRef.current.values()]
        .sort((left, right) => left.generation - right.generation)
        .at(-1);
      if (latestQueued) {
        const replayedGeneration = controllerRef.current.request(latestQueued.direction, false);
        if (replayedGeneration) {
          plannedTurnsRef.current.set(replayedGeneration, {
            ...latestQueued,
            generation: replayedGeneration,
          });
        }
      }
    }
    syncFromController();
  }, [clearAnimation, pendingPointer?.pointerId, releasePointerCapture, state, syncFromController]);

  const updateSurfaceState = useCallback((
    grab: Vec2,
    frame: PageTurnPhysicsFrame,
    phase: 'dragging' | 'settling',
    outcome?: 'commit' | 'cancel',
  ) => {
    const progress = clamp(turnDisplacement(grab, frame.grabPoint, 1, readingDirection), 0, 1);

    if (phase === 'dragging') {
      setSurfaceState({
        phase,
        direction: readingDirection,
        progress,
        frame,
      });
      return;
    }

    setSurfaceState({
      phase,
      direction: readingDirection,
      progress,
      outcome: outcome ?? 'cancel',
      frame,
    });
  }, [readingDirection]);

  const updateDragSurface = useCallback((grab: Vec2, point: Vec2, elapsedMs = 16.7) => {
    const solver = physicsRef.current ?? new PaperPhysicsSolver({ quality: SURFACE_QUALITY, direction: readingDirection }).begin(grab);
    physicsRef.current = solver;
    const frame = solver.step({ pointer: point, elapsedMs });
    updateSurfaceState(grab, frame, 'dragging');
    return frame;
  }, [readingDirection, updateSurfaceState]);

  const animateSettle = useCallback((
    generation: number,
    grab: Vec2,
    outcome: 'commit' | 'cancel',
  ) => {
    clearAnimation();
    const solver = physicsRef.current ?? new PaperPhysicsSolver({ quality: SURFACE_QUALITY, direction: readingDirection }).begin(grab);
    physicsRef.current = solver;
    solver.settle(outcome);
    updateSurfaceState(grab, solver.snapshot(), 'settling', outcome);

    const token = `settle:${generation}:${outcome}`;
    animationTokenRef.current = token;
    let previousNow = performance.now();

    const tick = (now: number) => {
      if (animationTokenRef.current !== token) {
        return;
      }

      const frame = solver.step({ elapsedMs: Math.max(0, now - previousNow) });
      previousNow = now;
      updateSurfaceState(grab, frame, 'settling', outcome);

      if (frame.settled === outcome) {
        clearAnimation();
        return;
      }

      if (typeof requestAnimationFrame === 'function') {
        animationFrameRef.current = requestAnimationFrame(tick);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      animationFrameRef.current = requestAnimationFrame(tick);
    }
  }, [clearAnimation, readingDirection, updateSurfaceState]);

  const beginAutomaticTurn = useCallback((planned: PlannedTurn) => {
    clearAnimation();
    physicsRef.current = new PaperPhysicsSolver({ quality: SURFACE_QUALITY, direction: readingDirection }).begin(planned.grab);
    controllerRef.current?.texturesReady(planned.generation);
    controllerRef.current?.beginPointer(planned.generation, AUTOMATIC_POINTER_ID, planned.grab, performance.now());
    syncFromController();

    const token = `auto:${planned.generation}`;
    animationTokenRef.current = token;
    const start = performance.now();

    const tick = (now: number) => {
      if (animationTokenRef.current !== token) {
        return;
      }

      const progress = clamp((now - start) / SYNTHETIC_DURATION_MS, 0, 1);
      const point = automaticPoint(planned.direction, planned.grab, progress);
      controllerRef.current?.movePointer(AUTOMATIC_POINTER_ID, point, now);
      updateDragSurface(planned.grab, point);
      setSyntheticTrajectory({ direction: planned.direction, grab: planned.grab, point });

      if (progress >= 1) {
        clearAnimation();
        controllerRef.current?.releasePointer(AUTOMATIC_POINTER_ID, now);
        syncFromController();
        animateSettle(planned.generation, planned.grab, 'commit');
        return;
      }

      if (typeof requestAnimationFrame === 'function') {
        animationFrameRef.current = requestAnimationFrame(tick);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      animationFrameRef.current = requestAnimationFrame(tick);
    } else {
      controllerRef.current?.releasePointer(AUTOMATIC_POINTER_ID, performance.now());
      syncFromController();
      animateSettle(planned.generation, planned.grab, 'commit');
    }
  }, [animateSettle, clearAnimation, readingDirection, syncFromController, updateDragSurface]);

  const requestTurn = useCallback((delta: number) => {
    if (delta === 0) {
      return;
    }

    setFailure(undefined);

    const available = delta > 0 ? canNext : canPrevious;
    const callback = delta > 0 ? onNextRef.current : onPreviousRef.current;

    if (!available) {
      callback();
      clearSurface();
      return;
    }

    if (reducedMotion || state.phase === 'disabled') {
      callback();
      clearSurface();
      return;
    }


    const direction = logicalDeltaToTurnDirection(delta, readingDirection);
    const nextScene = buildPageTurnScene({
      pages: publication.pages,
      currentIndex: publication.currentPage,
      mode,
      readingDirection,
      turnDirection: direction,
    });

    if (!nextScene) {
      callback();
      clearSurface();
      return;
    }

    const generation = controllerRef.current?.request(direction, false);
    if (!generation) {
      return;
    }


    plannedTurnsRef.current.set(generation, {
      generation,
      direction,
      scene: nextScene,
      kind: 'automatic',
      grab: { x: automaticGrabX(direction), y: SYNTHETIC_GRAB_Y },
      syntheticTrajectory: {
        direction,
        grab: { x: automaticGrabX(direction), y: SYNTHETIC_GRAB_Y },
        point: { x: automaticGrabX(direction), y: SYNTHETIC_GRAB_Y },
      },
    });
    syncFromController();
  }, [canNext, canPrevious, clearSurface, mode, publication.currentPage, publication.pages, readingDirection, reducedMotion, state.phase, syncFromController]);

  const onTexturesAndBackendReady = useCallback((generation: number) => {
    const planned = plannedTurnsRef.current.get(generation);
    if (!planned) {
      return;
    }

    // The surface re-runs its preparation effect whenever it re-renders, and
    // it re-reports readiness each time. Driving a turn is not idempotent —
    // starting it again resets the animation clock — so a generation already
    // under way ignores the repeat instead of rewinding forever.
    if (generation <= startedGenerationRef.current) {
      return;
    }
    startedGenerationRef.current = generation;

    if (planned.kind === 'pointer' && planned.pendingPointer) {
      physicsRef.current = new PaperPhysicsSolver({ quality: SURFACE_QUALITY, direction: readingDirection }).begin(planned.grab);
      controllerRef.current?.texturesReady(generation);
      controllerRef.current?.beginPointer(generation, planned.pendingPointer.pointerId, planned.grab, performance.now());
      setPendingPointer(undefined);
      syncFromController();
      updateDragSurface(planned.grab, planned.grab);
      return;
    }

    beginAutomaticTurn(planned);
  }, [beginAutomaticTurn, readingDirection, syncFromController, updateDragSurface]);

  const onSettled = useCallback((result: PageTurnSettled) => {
    if (state.phase !== 'settling' || state.generation !== result.generation) {
      return;
    }

    controllerRef.current?.finishSettle(result.generation);
    syncFromController();
  }, [state, syncFromController]);

  const onFailure = useCallback((failure: PageTurnFailure) => {
    clearAnimation();
    releasePointerCapture(
      state.phase === 'dragging' ? state.pointerId : pendingPointer?.pointerId,
    );
    setFailure(failure);

    // Retiring the surface is right — a backend or solver that just failed will
    // keep failing — but the reader asked for a page, not for an animation. A
    // turn that is still in flight and has not navigated yet is completed
    // without the fold, so a single failure costs the effect rather than
    // leaving the reader unable to move through the publication for the rest of
    // the session.
    const strandedDirection = 'direction' in state ? state.direction : undefined;
    // The controller is the authority on whether this turn already emitted its
    // navigation; React state can still be a render behind.
    const controllerPhase = controllerRef.current?.snapshot().phase;
    const alreadyNavigated = awaitingNavigationGenerationRef.current !== undefined
      || state.phase === 'committed'
      || controllerPhase === 'committed';

    if (state.phase !== 'idle' && state.phase !== 'disabled' && 'generation' in state) {
      plannedTurnsRef.current.delete(state.generation);
    }
    plannedTurnsRef.current.clear();

    foldFailuresRef.current += 1;
    if (foldFailuresRef.current >= FOLD_FAILURES_BEFORE_RETIRING) {
      controllerRef.current?.disable(failure.reason === 'backend' ? 'backend' : 'performance');
    } else {
      controllerRef.current?.cancel(failure.reason === 'backend' ? 'backend' : 'solver');
    }

    if (strandedDirection && !alreadyNavigated) {
      turnDirectionToCallback(strandedDirection, readingDirection, onNextRef.current, onPreviousRef.current)();
    }

    syncFromController();
  }, [clearAnimation, pendingPointer?.pointerId, readingDirection, releasePointerCapture, state, syncFromController]);

  const acknowledgeNavigation = useCallback((generation?: number) => {
    // A turn that reached its page proves the surface is working, so earlier
    // failures no longer count against it.
    foldFailuresRef.current = 0;
    const acknowledged = generation ?? awaitingNavigationGenerationRef.current;
    if (acknowledged === undefined) {
      return;
    }

    awaitingNavigationGenerationRef.current = undefined;
    controllerRef.current?.navigationAck(acknowledged);
    plannedTurnsRef.current.delete(acknowledged);
    syncFromController();
  }, [syncFromController]);

  const edgeProps = useMemo<UsePageTurnResult['edgeProps']>(() => ({
    onPointerDown: (event) => {
      if (event.button !== 0 || event.isPrimary === false || reducedMotion || state.phase !== 'idle' || !canNext) {
        return;
      }

      const frame = pageFrameFor(transformedPage.current, event.currentTarget);
      if (!frame || !isVisibleOuterEdgeHit({ x: event.clientX, y: event.clientY }, frame, readingDirection)) {
        return;
      }

      const direction = logicalDeltaToTurnDirection(1, readingDirection);
      const nextScene = buildPageTurnScene({
        pages: publication.pages,
        currentIndex: publication.currentPage,
        mode,
        readingDirection,
        turnDirection: direction,
      });

      if (!nextScene) {
        onNextRef.current();
        return;
      }

      const grab = clientToPagePoint(
        { x: event.clientX, y: event.clientY },
        frame,
        zoom,
      );
      const normalizedGrab = {
        x: clamp(grab.x, 0, 1),
        y: clamp(grab.y, 0, 1),
      };

      stageTargetRef.current = event.currentTarget;
      event.currentTarget.setPointerCapture(event.pointerId);
      const generation = controllerRef.current?.request(direction, false);
      if (!generation) {
        return;
      }

      plannedTurnsRef.current.set(generation, {
        generation,
        direction,
        scene: nextScene,
        kind: 'pointer',
        grab: normalizedGrab,
        pendingPointer: {
          pointerId: event.pointerId,
          grab: normalizedGrab,
          pointerType: event.pointerType,
        },
      });
      syncFromController();
    },
    onPointerMove: (event) => {
      if (reducedMotion || state.phase === 'disabled') {
        clearSurface();
        return;
      }

      const frame = pageFrameFor(transformedPage.current, event.currentTarget);
      if (!frame) {
        clearSurface();
        return;
      }

      if (state.phase === 'dragging') {
        if (event.pointerId !== state.pointerId) {
          return;
        }
        const point = clientToPagePoint({ x: event.clientX, y: event.clientY }, frame, zoom);
        const normalizedPoint = { x: point.x, y: point.y };
        controllerRef.current?.movePointer(event.pointerId, normalizedPoint, performance.now());
        updateDragSurface(state.grab, normalizedPoint);
        syncFromController();
        return;
      }

      if (state.phase !== 'idle' || !canNext || !isVisibleOuterEdgeHit({ x: event.clientX, y: event.clientY }, frame, readingDirection)) {
        return;
      }

      const nextScene = buildPageTurnScene({
        pages: publication.pages,
        currentIndex: publication.currentPage,
        mode,
        readingDirection,
        turnDirection: logicalDeltaToTurnDirection(1, readingDirection),
      });
      if (!nextScene) {
        return;
      }

      const grab = clientToPagePoint({ x: event.clientX, y: event.clientY }, frame, zoom);
      const normalizedGrab = {
        x: clamp(grab.x, 0, 1),
        y: clamp(grab.y, 0, 1),
      };
      const progress = hoverProgressFor(event.clientX, frame, readingDirection);
      const previewPoint = {
        x: readingDirection === 'rtl' ? Math.min(1, normalizedGrab.x + progress) : Math.max(0, normalizedGrab.x - progress),
        y: normalizedGrab.y,
      };
      const framePreview = new PaperPhysicsSolver({ quality: SURFACE_QUALITY, direction: readingDirection })
        .begin(normalizedGrab)
        .step({ pointer: previewPoint, elapsedMs: 16.7 });

      setScene(nextScene);
      setSurfaceGeneration(0);
      setSurfaceState({
        phase: 'preparing',
        direction: readingDirection,
        progress,
        frame: framePreview,
      });
    },
    onPointerUp: (event) => {
      if (state.phase !== 'dragging' || event.pointerId !== state.pointerId) {
        return;
      }

      releasePointerCapture(event.pointerId);
      controllerRef.current?.releasePointer(event.pointerId, performance.now());
      const snapshot = controllerRef.current?.snapshot();
      syncFromController();

      if (snapshot?.phase === 'settling') {
        animateSettle(snapshot.generation, state.grab, snapshot.outcome);
      }
    },
    onPointerCancel: () => {
      cancelTurn('publication-change');
    },
  }), [animateSettle, canNext, cancelTurn, clearSurface, mode, publication.currentPage, publication.pages, readingDirection, reducedMotion, releasePointerCapture, state, syncFromController, transformedPage, updateDragSurface, zoom]);

  useEffect(() => {
    const onResize = () => {
      if (state.phase !== 'idle' && state.phase !== 'disabled') {
        cancelTurn('resize');
      }
    };
    const onFullscreenChange = () => {
      if (state.phase !== 'idle' && state.phase !== 'disabled') {
        cancelTurn('fullscreen');
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && state.phase !== 'idle' && state.phase !== 'disabled') {
        cancelTurn('hidden');
      }
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cancelTurn, state.phase]);

  useEffect(() => {
    const pageChanged = previousPageRef.current !== publication.currentPage;
    const publicationChanged = previousPublicationIdRef.current !== publication.id;
    const modeChanged = previousModeRef.current !== mode;
    const directionChanged = previousDirectionRef.current !== readingDirection;

    previousPageRef.current = publication.currentPage;
    previousPublicationIdRef.current = publication.id;
    previousModeRef.current = mode;
    previousDirectionRef.current = readingDirection;

    if (pageChanged && state.phase === 'committed') {
      acknowledgeNavigation();
      return;
    }

    if ((publicationChanged || pageChanged) && state.phase !== 'idle' && state.phase !== 'disabled' && state.phase !== 'committed') {
      cancelTurn(publicationChanged ? 'publication' : 'publication-change');
      return;
    }

    if ((modeChanged || directionChanged) && state.phase !== 'idle' && state.phase !== 'disabled') {
      cancelTurn('profile');
    }
  }, [acknowledgeNavigation, cancelTurn, mode, publication.currentPage, publication.id, readingDirection, state.phase]);

  const teardownRef = useRef<() => void>(() => undefined);
  teardownRef.current = () => {
    clearAnimation();
    releasePointerCapture(
      state.phase === 'dragging' ? state.pointerId : pendingPointer?.pointerId,
    );
    controllerRef.current?.cancel('unmount');
  };

  // Runs on unmount only. Keying this on `state` would make React fire the
  // cleanup on every phase change, so the transition into `preparing` would
  // immediately cancel the turn that produced it and the reader would never
  // move. The ref keeps the teardown reading current values without making the
  // effect re-run.
  useEffect(() => () => teardownRef.current(), []);

  const surfaceInput = scene && surfaceGeneration !== undefined && surfaceState.phase !== 'idle'
    ? {
        scene,
        generation: surfaceGeneration,
        state: surfaceState,
        progress: surfaceState.progress,
        quality: SURFACE_QUALITY,
        onMetrics: (_metrics: PageTurnMetrics) => undefined,
      }
    : undefined;

  return {
    state,
    scene,
    surfaceInput,
    edgeProps,
    requestTurn,
    cancelTurn,
    acknowledgeNavigation,
    onTexturesAndBackendReady,
    onSettled,
    onFailure,
    pendingPointer,
    syntheticTrajectory,
    failure,
  };
}
