import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageDescriptor } from '../domain/types';
import { useAdaptiveFlow } from './useAdaptiveFlow';

const analyzePageFlow = vi.hoisted(() => vi.fn());
const loadFlowGraph = vi.hoisted(() => vi.fn(() => null));
const loadNativePanelGraph = vi.hoisted(() => vi.fn(async () => null));

vi.mock('../services/flowAnalysis', () => ({ analyzePageFlow }));
vi.mock('../services/flowStorage', () => ({ loadFlowGraph, saveFlowGraph: vi.fn() }));
vi.mock('../services/nativeLibrary', () => ({ loadNativePanelGraph, saveNativePanelGraph: vi.fn() }));

const page: PageDescriptor = {
  id: 'page-1',
  index: 0,
  name: 'Page 1',
  src: 'asset://page-1.png',
  width: 800,
  height: 1200,
};

describe('useAdaptiveFlow', () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useAdaptiveFlow> | undefined;

  function Harness({ enabled }: { enabled: boolean }) {
    latest = useAdaptiveFlow({ publicationId: 'pub-1', page, direction: 'ltr', nativeRuntime: false, enabled });
    return null;
  }

  beforeEach(() => {
    analyzePageFlow.mockReset();
    loadFlowGraph.mockReset();
    loadFlowGraph.mockReturnValue(null);
    loadNativePanelGraph.mockReset();
    loadNativePanelGraph.mockResolvedValue(null);
    analyzePageFlow.mockResolvedValue({
      pageId: 'page-1',
      direction: 'ltr',
      source: 'geometry',
      corrections: 0,
      panels: [],
    });
    latest = undefined;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(enabled: boolean) {
    await act(async () => {
      root.render(<Harness enabled={enabled} />);
      await Promise.resolve();
    });
  }

  it('does not analyse a page while the guidance overlay is closed', async () => {
    await render(false);

    // Panel analysis decodes the page, reads it back off the GPU and sweeps it
    // on the main thread. The overlay starts closed and the product only shows
    // markers on request, so a reader who never opens it must never pay for it.
    expect(analyzePageFlow).not.toHaveBeenCalled();
    expect(latest?.state).toBe('idle');
    expect(latest?.graph).toBeNull();
  });

  it('reuses a stored graph instead of analysing the page again', async () => {
    loadFlowGraph.mockReturnValueOnce(null).mockReturnValue({
      pageId: 'page-1',
      direction: 'ltr',
      source: 'geometry',
      corrections: 0,
      panels: [],
    } as never);

    await render(true);
    await render(false);
    await render(true);

    // Closing the overlay drops the graph from state, so reopening it must come
    // back through storage rather than sweeping the page a second time.
    expect(analyzePageFlow).toHaveBeenCalledTimes(1);
    expect(latest?.state).toBe('ready');
  });

  it('analyses the page once the reader opens the guidance overlay', async () => {
    await render(false);
    await render(true);

    expect(analyzePageFlow).toHaveBeenCalledTimes(1);
    expect(latest?.state).toBe('ready');
  });
});
