import type { RenderQuality, RendererStatus } from './contracts';

export type RendererStatusPhase = 'ready' | 'fallback' | 'recovering';

export interface RendererStatusMessage {
  phase: RendererStatusPhase;
  message: string;
  diagnostic: string;
}

export interface FrameTelemetrySnapshot {
  fps: number;
  averageFrameMs: number;
  sampleCount: number;
}

export class FrameTelemetry {
  private readonly samples: number[] = [];
  private previousTimestamp?: number;

  constructor(private readonly sampleLimit = 48) {}

  record(timestamp: number): FrameTelemetrySnapshot | undefined {
    if (this.previousTimestamp === undefined) {
      this.previousTimestamp = timestamp;
      return undefined;
    }

    const frameMs = timestamp - this.previousTimestamp;
    this.previousTimestamp = timestamp;
    if (frameMs <= 0 || frameMs > 250) {
      return undefined;
    }

    this.samples.push(frameMs);
    if (this.samples.length > this.sampleLimit) {
      this.samples.shift();
    }
    const averageFrameMs = this.samples.reduce((sum, sample) => sum + sample, 0) / this.samples.length;
    return {
      fps: 1000 / averageFrameMs,
      averageFrameMs,
      sampleCount: this.samples.length,
    };
  }
}

export function adaptRenderQuality(current: RenderQuality, fps: number): RenderQuality {
  if (current === 'rich' && fps < 54) {
    return 'balanced';
  }
  if (current === 'balanced' && fps < 45) {
    return 'essential';
  }
  if (current === 'essential' && fps > 57) {
    return 'balanced';
  }
  if (current === 'balanced' && fps > 59) {
    return 'rich';
  }
  return current;
}

/**
 * Keeps implementation details out of the reader's primary language while
 * retaining a copyable diagnostic for support and automated checks.
 */
export function rendererStatusMessage(status: RendererStatus): RendererStatusMessage {
  const phase: RendererStatusPhase = status.backend === 'static'
    ? status.fallbackReason ? 'fallback' : 'recovering'
    : status.fallbackReason ? 'fallback' : 'ready';

  const message = phase === 'ready'
    ? 'Leitura pronta.'
    : phase === 'fallback'
      ? 'O modo compatível está ativo. A leitura continua disponível.'
      : 'Preparando a leitura. O conteúdo continua disponível.';

  const diagnosticParts = [
    `backend=${status.backend}`,
    `quality=${status.quality}`,
    status.fps === undefined ? undefined : `fps=${status.fps}`,
    status.fallbackReason ? `fallback=${status.fallbackReason}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return { phase, message, diagnostic: diagnosticParts.join(' · ') };
}
