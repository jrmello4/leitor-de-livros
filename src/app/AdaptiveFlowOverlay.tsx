import { useEffect, useState } from 'react';
import { flowResolution, orderedPanels, type PanelGraph } from '../domain/flow';

interface AdaptiveFlowOverlayProps {
  graph: PanelGraph | null;
  isAnalyzing: boolean;
  visible: boolean;
  pageSlot: number;
  pageCount: number;
  onSwap: (firstId: string, secondId: string) => void;
  onUseManualRoute: () => void;
}

function statusLabel(graph: PanelGraph): string {
  switch (flowResolution(graph)) {
    case 'manual':
      return 'Full-page reading active';
    case 'review':
      return 'Panel guidance needs a check';
    default:
      return 'Panel guidance ready';
  }
}

function guidanceLabel(graph: PanelGraph, canCorrectOrder: boolean, hasSelection: boolean): string {
  switch (flowResolution(graph)) {
    case 'manual':
      return 'Assistance is off for this page; the full composition stays intact.';
    case 'review':
      if (canCorrectOrder) {
        return hasSelection
          ? 'Choose the second marker to swap, or read the full page.'
          : 'The suggested order is uncertain. Choose two markers to swap, or read the full page.';
      }
      return 'The suggestion is uncertain. Read the full page to keep the composition intact.';
    default:
      return canCorrectOrder
        ? (hasSelection ? 'Choose the second marker to swap.' : 'Choose two markers to correct the order.')
        : 'The full-page route keeps reading uninterrupted.';
  }
}

export function AdaptiveFlowOverlay({
  graph,
  isAnalyzing,
  visible,
  pageSlot,
  pageCount,
  onSwap,
  onUseManualRoute,
}: AdaptiveFlowOverlayProps) {
  const [firstSelection, setFirstSelection] = useState<string>();

  useEffect(() => {
    setFirstSelection(undefined);
  }, [graph?.pageId, graph?.updatedAt, visible]);

  if (!visible) {
    return null;
  }

  if (isAnalyzing || !graph) {
    return (
      <div className="flow-overlay" aria-live="polite">
        <span className="flow-overlay-note">Mapping page locally…</span>
      </div>
    );
  }

  const panels = orderedPanels(graph);
  const canCorrectOrder = panels.length > 1;
  const resolution = flowResolution(graph);
  const canUseManualRoute = resolution === 'review';
  const width = 100 / Math.max(pageCount, 1);
  const pageOffset = width * pageSlot;
  const choosePanel = (panelId: string) => {
    if (!firstSelection) {
      setFirstSelection(panelId);
      return;
    }
    if (firstSelection === panelId) {
      setFirstSelection(undefined);
      return;
    }
    onSwap(firstSelection, panelId);
    setFirstSelection(undefined);
  };

  return (
    <div className="flow-overlay" aria-label="Adaptive Flow panel order">
      <section className="flow-overlay-legend" data-flow-control aria-labelledby="flow-overlay-title">
        <span id="flow-overlay-title">FLOW / {String(panels.length).padStart(2, '0')}</span>
        <strong>{statusLabel(graph)}</strong>
        <p>{guidanceLabel(graph, canCorrectOrder, Boolean(firstSelection))}</p>
        {canUseManualRoute && (
          <button
            className="flow-manual-route"
            data-flow-control
            type="button"
            onClick={onUseManualRoute}
            aria-label="Read this page as one full page"
          >
            Read full page
          </button>
        )}
      </section>
      {panels.map((panel, index) => (
        <button
          className={`flow-panel-marker ${firstSelection === panel.id ? 'flow-panel-marker--selected' : ''}`}
          data-flow-control
          key={panel.id}
          type="button"
          aria-label={canCorrectOrder
            ? `Panel ${index + 1}. ${firstSelection ? 'Choose as the second panel to swap.' : 'Choose as the first panel to swap.'}`
            : `Panel ${index + 1}. Full-page reading route.`}
          aria-pressed={firstSelection === panel.id}
          disabled={!canCorrectOrder}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => choosePanel(panel.id)}
          style={{
            left: `${pageOffset + panel.bounds.x * width}%`,
            top: `${panel.bounds.y * 100}%`,
            width: `${panel.bounds.width * width}%`,
            height: `${panel.bounds.height * 100}%`,
          }}
        >
          <span>{String(index + 1).padStart(2, '0')}</span>
        </button>
      ))}
    </div>
  );
}
