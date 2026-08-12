import { useEffect, useState } from 'react';
import { orderedPanels, type PanelGraph } from '../domain/flow';

interface AdaptiveFlowOverlayProps {
  graph: PanelGraph | null;
  isAnalyzing: boolean;
  visible: boolean;
  pageSlot: number;
  pageCount: number;
  onSwap: (firstId: string, secondId: string) => void;
  onUseManualRoute: () => void;
}

function confidenceLabel(graph: PanelGraph): string {
  if (graph.source === 'manual') {
    return 'Manual route';
  }
  return graph.confidence >= 0.72 ? 'Geometry confident' : 'Geometry needs review';
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
  const canUseManualRoute = graph.source === 'geometry' && graph.confidence < 0.72;
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
      <div className="flow-overlay-legend" data-flow-control>
        <span>FLOW / {String(panels.length).padStart(2, '0')}</span>
        <strong>{confidenceLabel(graph)}</strong>
        <p>{canCorrectOrder
          ? (firstSelection ? 'Choose the second marker to swap order.' : 'Choose two markers to correct order.')
          : 'One full-page region keeps reading uninterrupted.'}</p>
        {canUseManualRoute && (
          <button className="flow-manual-route" data-flow-control type="button" onClick={onUseManualRoute}>
            Use full page
          </button>
        )}
      </div>
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
