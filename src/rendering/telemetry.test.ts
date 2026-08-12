import { describe, expect, it } from 'vitest';
import type { RendererStatus } from './contracts';
import { rendererStatusMessage } from './telemetry';

describe('renderer status messaging', () => {
  it('translates a healthy renderer into a simple ready message', () => {
    const status: RendererStatus = { backend: 'webgpu', quality: 'rich' };

    expect(rendererStatusMessage(status)).toMatchObject({
      phase: 'ready',
      message: 'Leitura pronta.',
    });
  });

  it('explains that the accessible fallback is still usable', () => {
    const status: RendererStatus = {
      backend: 'static',
      quality: 'essential',
      fallbackReason: 'WebGPU device was lost.',
    };

    expect(rendererStatusMessage(status)).toMatchObject({
      phase: 'fallback',
      message: 'O modo compatível está ativo. A leitura continua disponível.',
    });
  });

  it('announces recovery while the renderer is initializing', () => {
    const status: RendererStatus = { backend: 'static', quality: 'essential' };

    expect(rendererStatusMessage(status)).toMatchObject({
      phase: 'recovering',
      message: 'Preparando a leitura. O conteúdo continua disponível.',
    });
  });

  it('does not put technical backend names in the user message', () => {
    const status: RendererStatus = {
      backend: 'webgl2',
      quality: 'balanced',
      fps: 42,
      fallbackReason: 'WebGPU unavailable',
    };

    const result = rendererStatusMessage(status);
    expect(result.message).not.toMatch(/webgl|webgpu|fps|balanced/i);
    expect(result.diagnostic).toContain('webgl2');
    expect(result.diagnostic).toContain('42');
  });
});
