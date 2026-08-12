import type { RenderQuality } from './contracts';

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
