import type { PanelGraph } from '../domain/flow';
import { isPanelGraph } from '../domain/flow';

const FLOW_KEY = 'tactile-reader/flow/v1';

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readGraphs(): Record<string, PanelGraph> {
  try {
    const value = JSON.parse(getStorage()?.getItem(FLOW_KEY) ?? '{}') as Record<string, unknown>;
    return Object.entries(value).reduce<Record<string, PanelGraph>>((graphs, [key, graph]) => {
      if (isPanelGraph(graph)) {
        graphs[key] = graph;
      }
      return graphs;
    }, {});
  } catch {
    return {};
  }
}

function graphKey(publicationId: string, pageId: string): string {
  return `${publicationId}:${pageId}`;
}

export function loadFlowGraph(publicationId: string, pageId: string): PanelGraph | null {
  return readGraphs()[graphKey(publicationId, pageId)] ?? null;
}

export function saveFlowGraph(publicationId: string, graph: PanelGraph): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    const graphs = readGraphs();
    graphs[graphKey(publicationId, graph.pageId)] = graph;
    storage.setItem(FLOW_KEY, JSON.stringify(graphs));
  } catch {
    return;
  }
}
