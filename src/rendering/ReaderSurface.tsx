import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createWebGl2Backend, createWebGpuBackend, type CanvasRenderer } from './backends';
import type { RenderBackendKind, RenderFrame, RenderQuality, RendererStatus } from './contracts';
import { adaptRenderQuality, FrameTelemetry } from './telemetry';
import { parseVisualBackend } from '../release/testModes';

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
  const telemetryRef = useRef(new FrameTelemetry());
  const forcedBackend = parseVisualBackend(
    typeof window === 'undefined' ? '' : window.location.search,
    import.meta.env.VITE_VISUAL_TEST === '1',
  );

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
    const useStaticWithFailure = (message: string) => {
      failuresRef.current = [...failuresRef.current, message];
      useStatic();
    };
    const tryNext = (message: string) => {
      failuresRef.current = [...failuresRef.current, message];
      if (!disposed) {
        setAttempt((current) => Math.max(current, attempt + 1));
      }
    };

    if (forcedBackend === 'static' || (forcedBackend === 'auto' && attempt > 1)) {
      useStatic();
      return () => {
        disposed = true;
      };
    }

    const initialize = async () => {
      try {
        renderer = forcedBackend === 'webgpu' || (forcedBackend === 'auto' && attempt === 0)
          ? await createWebGpuBackend(canvas, () => {
              if (forcedBackend === 'auto') {
                tryNext('WebGPU device was lost.');
              } else {
                useStaticWithFailure('Skipped ' + forcedBackend + ': WebGPU device was lost.');
              }
            })
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
        if (forcedBackend === 'auto') {
          tryNext(failureMessage(error));
        } else {
          useStaticWithFailure('Skipped ' + forcedBackend + ': ' + failureMessage(error));
        }
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
  }, [attempt, forcedBackend]);

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
      const message = failureMessage(error);
      failuresRef.current = [
        ...failuresRef.current,
        forcedBackend === 'auto' ? message : 'Skipped ' + forcedBackend + ': ' + message,
      ];
      if (forcedBackend === 'auto') {
        setAttempt((current) => Math.max(current, backend === 'webgpu' ? 1 : 2));
      } else {
        setBackend('static');
        setQuality('essential');
        setFps(undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [backend, frame, forcedBackend, quality, resizeVersion]);

  useEffect(() => {
    if (
      backend === 'static'
      || !interactionActive
      || typeof window === 'undefined'
      || typeof window.requestAnimationFrame !== 'function'
    ) {
      return undefined;
    }
    const telemetry = telemetryRef.current;
    telemetry.resume();
    let frameId = 0;
    const tick = (timestamp: number) => {
      const snapshot = telemetry.record(timestamp);
      if (snapshot && snapshot.sampleCount >= 16 && snapshot.sampleCount % 8 === 0) {
        const sampledFps = Math.round(snapshot.fps);
        setFps((current) => (current === sampledFps ? current : sampledFps));
        setQuality((current) => adaptRenderQuality(current, snapshot.fps));
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [backend, interactionActive]);

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
    <div
      className="render-surface"
      data-renderer={backend}
      data-quality={quality}
      aria-busy={backend === 'static' && failuresRef.current.length === 0}
    >
      <div
        className={showStatic ? 'render-static' : 'render-static render-static--hidden'}
        style={showStatic ? undefined : { opacity: 0, pointerEvents: 'none' }}
      >
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
