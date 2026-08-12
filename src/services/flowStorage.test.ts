import { beforeEach, describe, expect, it } from 'vitest';
import { createManualPanelGraph } from '../domain/flow';
import { loadFlowGraph, saveFlowGraph } from './flowStorage';

describe('Adaptive Flow local storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps a graph scoped to its publication and page', () => {
    const graph = createManualPanelGraph('page-7', 'rtl');
    saveFlowGraph('publication-a', graph);

    expect(loadFlowGraph('publication-a', 'page-7')).toEqual(graph);
    expect(loadFlowGraph('publication-b', 'page-7')).toBeNull();
    expect(loadFlowGraph('publication-a', 'page-8')).toBeNull();
  });
});
