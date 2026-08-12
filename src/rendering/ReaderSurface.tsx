import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createWebGl2Backend, createWebGpuBackend, type CanvasRenderer } from './backends';
import type { RenderBackendKind, RenderFrame, RenderQuality, RendererStatus } from './contracts';
import { adaptRenderQuality, FrameTelemetry } from './telemetry';

interface ReaderSurfaceProps {
  frame: RenderFrame;
  staticContent: ReactNode;
  ariaLabel: string;
  onStatus: (status: RendererStatus) => void;
  interactionActive: boolean;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Renderer initialization failed.';
}

export function ReaderSurface({ frame, staticContent, ariaLabel, onStatus, interactionActive }: ReaderSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backendRef = useRef<CanvasRenderer | undefined>(undefined);
  const failuresRef = useRef<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [backend, setBackend] = useState<RenderBackendKind>('static');
  const [quality, setQuality] = useState<RenderQuality>('rich');
  const [fps, setFps] = useState<number>();
  const [resizeVersion, setResizeVersion] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    let disposed = false;
    let renderer: CanvasRenderer | undefined;
    backendRef.current?.dispose();
    backendRef.current = undefined;

    const useStatic = () => {
      if (!disposed) {
        setBackend('static');
        setQuality('essential');
        setFps(undefined);
      }
    };
    const tryNext = (message: string) => {
      failuresRef.current = [...failuresRef.current, message];
      if (!disposed) {
        setAttempt((current) => Math.max(current, attempt + 1));
      }
    };

    if (attempt > 1) {
      useStatic();
      return () => {
        disposed = true;
      };
    }

    const initialize = async () => {
      try {
        renderer = attempt === 0
          ? await createWebGpuBackend(canvas, () => tryNext('WebGPU device was lost.'))
          : createWebGl2Backend(canvas);
        if (disposed) {
          renderer.dispose();
          return;
        }
        backendRef.current = renderer;
        setBackend(renderer.kind);
        setQuality('rich');
        setFps(undefined);
      } catch (error) {
        tryNext(failureMessage(error));
      }
    };
    void initialize();

    return () => {
      disposed = true;
      renderer?.dispose();
      if (backendRef.current === renderer) {
        backendRef.current = undefined;
      }
    };
  }, [attempt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => setResizeVersion((current) => current + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const renderer = backendRef.current;
    if (!renderer || backend === 'static') {
      return undefined;
    }
    let cancelled = false;
    void renderer.render(frame, quality).catch((error) => {
      if (cancelled) {
        return;
      }
      failuresRef.current = [...failuresRef.current, failureMessage(error)];
      setAttempt((current) => Math.max(current, backend === 'webgpu' ? 1 : 2));
    });
    return () => {
      cancelled = true;
    };
  }, [backend, frame, quality, resizeVersion]);

  useEffect(() => {
    if (backend === 'static' || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return undefined;
    }
    const telemetry = new FrameTelemetry();
    let frameId = 0;
    const tick = (timestamp: number) => {
      const snapshot = telemetry.record(timestamp);
      if (snapshot && snapshot.sampleCount >= 16 && snapshot.sampleCount % 8 === 0) {
        setFps(Math.round(snapshot.fps));
        setQuality((current) => adaptRenderQuality(current, snapshot.fps));
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [backend]);

  useEffect(() => {
    onStatus({
      backend,
      quality,
      fps,
      fallbackReason: failuresRef.current.length > 0 ? failuresRef.current.join(' ') : undefined,
    });
  }, [backend, fps, onStatus, quality]);

  const gpuActive = backend !== 'static';
  const showStatic = backend === 'static' || interactionActive;
  return (
    <div className="render-surface" data-renderer={backend} data-quality={quality}>
      <div className={showStatic ? 'render-static' : 'render-static render-static--hidden'}>
        {staticContent}
      </div>
      <canvas
        className={gpuActive && !interactionActive ? 'renderer-canvas renderer-canvas--active' : 'renderer-canvas'}
        ref={canvasRef}
        aria-hidden="true"
      />
      {gpuActive && <span className="sr-only">{ariaLabel}</span>}
    </div>
  );
}
