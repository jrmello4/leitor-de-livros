import { useCallback, useEffect, useState } from 'react';
import { createManualPanelGraph, swapPanelOrder, type PanelGraph } from '../domain/flow';
import type { PageDescriptor, ReadingDirection } from '../domain/types';
import { analyzePageFlow } from '../services/flowAnalysis';
import { loadFlowGraph, saveFlowGraph } from '../services/flowStorage';
import { loadNativePanelGraph, saveNativePanelGraph } from '../services/nativeLibrary';

export type FlowAnalysisState = 'idle' | 'analyzing' | 'ready';

interface UseAdaptiveFlowOptions {
  publicationId: string;
  page?: PageDescriptor;
  direction: ReadingDirection;
  nativeRuntime: boolean;
  /**
   * Whether the reader currently wants panel guidance. Analysis decodes the
   * page, reads it back off the GPU and sweeps it on the main thread, so it is
   * only worth doing for a reader who asked to see the markers.
   */
  enabled: boolean;
}

function matchesReadingDirection(graph: PanelGraph | null, direction: ReadingDirection): graph is PanelGraph {
  return Boolean(graph && graph.direction === direction);
}

export function useAdaptiveFlow({ publicationId, page, direction, nativeRuntime, enabled }: UseAdaptiveFlowOptions) {
  const [graph, setGraph] = useState<PanelGraph | null>(null);
  const [state, setState] = useState<FlowAnalysisState>('idle');

  useEffect(() => {
    if (!page || !enabled) {
      setGraph(null);
      setState('idle');
      return undefined;
    }

    let active = true;
    setGraph(null);
    setState('analyzing');

    const resolve = async () => {
      let stored = nativeRuntime ? await loadNativePanelGraph(publicationId, page.id).catch(() => null) : null;
      if (!matchesReadingDirection(stored, direction)) {
        stored = loadFlowGraph(publicationId, page.id);
      }

      if (matchesReadingDirection(stored, direction)) {
        saveFlowGraph(publicationId, stored);
        if (nativeRuntime) {
          void saveNativePanelGraph(publicationId, stored).catch(() => undefined);
        }
        if (active) {
          setGraph(stored);
          setState('ready');
        }
        return;
      }

      const analyzed = await analyzePageFlow(page, direction);
      if (!active) {
        return;
      }
      setGraph(analyzed);
      setState('ready');
      saveFlowGraph(publicationId, analyzed);
      if (nativeRuntime) {
        void saveNativePanelGraph(publicationId, analyzed).catch(() => undefined);
      }
    };

    void resolve();
    return () => {
      active = false;
    };
  }, [direction, enabled, nativeRuntime, page?.id, page?.src, publicationId]);

  const swapOrder = useCallback((firstId: string, secondId: string) => {
    setGraph((current) => {
      if (!current) {
        return current;
      }
      const corrected = swapPanelOrder(current, firstId, secondId);
      if (corrected === current) {
        return current;
      }
      saveFlowGraph(publicationId, corrected);
      if (nativeRuntime) {
        void saveNativePanelGraph(publicationId, corrected).catch(() => undefined);
      }
      return corrected;
    });
  }, [nativeRuntime, publicationId]);

  const useManualRoute = useCallback(() => {
    setGraph((current) => {
      if (!current || current.source === 'manual') {
        return current;
      }
      const manual = {
        ...createManualPanelGraph(current.pageId, current.direction),
        corrections: current.corrections + 1,
      };
      saveFlowGraph(publicationId, manual);
      if (nativeRuntime) {
        void saveNativePanelGraph(publicationId, manual).catch(() => undefined);
      }
      return manual;
    });
  }, [nativeRuntime, publicationId]);

  return { graph, state, swapOrder, useManualRoute };
}
