import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../app/styles.css';
import type { RenderFrame } from './contracts';
import { ReaderSurface } from './ReaderSurface';

const backend = {
  kind: 'webgl2' as const,
  render: vi.fn(async () => undefined),
  dispose: vi.fn(() => undefined),
};

vi.mock('./backends', () => ({
  createWebGpuBackend: vi.fn(async () => {
    throw new Error('WebGPU unavailable in test');
  }),
  createWebGl2Backend: vi.fn(() => backend),
}));

function frame(): RenderFrame {
  return {
    pages: [
      { id: 'page-1', index: 0, name: 'Page 1', src: 'asset://page-1', width: 800, height: 1200 },
    ],
    preloadPages: [],
    direction: 'ltr',
    mode: 'single',
    reducedMotion: false,
  };
}

describe('ReaderSurface semantics', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    backend.render.mockClear();
    backend.dispose.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', class {
      observe() {
        return undefined;
      }

      disconnect() {
        return undefined;
      }
    });
    vi.stubGlobal('requestAnimationFrame', (_callback: FrameRequestCallback) => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('keeps the static article semantics available when the GPU canvas becomes the idle visual layer', async () => {
    await act(async () => {
      root.render(
        <ReaderSurface
          frame={frame()}
          staticContent={<article aria-label="Semantic page">Semantic page</article>}
          ariaLabel="Reader ready"
          onStatus={vi.fn()}
          interactionActive={false}
        />,
      );
      await Promise.resolve();
    });

    const staticLayer = host.querySelector<HTMLElement>('.render-static--hidden');
    const article = host.querySelector<HTMLElement>('article[aria-label="Semantic page"]');

    expect(staticLayer).not.toBeNull();
    expect(article).not.toBeNull();
    expect(article?.closest('.render-static--hidden')).toBe(staticLayer);
    expect(article?.getAttribute('aria-label')).toBe('Semantic page');
    expect(getComputedStyle(staticLayer!).visibility).not.toBe('hidden');
    expect(getComputedStyle(staticLayer!).opacity).toBe('0');
    expect(getComputedStyle(staticLayer!).pointerEvents).toBe('none');
  });

  it('samples frame telemetry only while a page turn is in flight', async () => {
    const scheduled = vi.fn((_callback: FrameRequestCallback) => 1);
    vi.stubGlobal('requestAnimationFrame', scheduled);

    await act(async () => {
      root.render(
        <ReaderSurface
          frame={frame()}
          staticContent={<article aria-label="Semantic page">Semantic page</article>}
          ariaLabel="Reader ready"
          onStatus={vi.fn()}
          interactionActive={false}
        />,
      );
      await Promise.resolve();
    });

    expect(
      scheduled,
      'an idle reader must not schedule animation frames for telemetry',
    ).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <ReaderSurface
          frame={frame()}
          staticContent={<article aria-label="Semantic page">Semantic page</article>}
          ariaLabel="Reader ready"
          onStatus={vi.fn()}
          interactionActive
        />,
      );
      await Promise.resolve();
    });

    expect(
      scheduled,
      'a page turn must keep sampling frames so quality can still adapt',
    ).toHaveBeenCalled();
  });
});
