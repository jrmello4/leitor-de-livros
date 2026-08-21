import { useEffect, useState } from 'react';
import { flowResolution, orderedPanels, type PanelBounds, type PanelGraph } from '../domain/flow';
import { t } from '../i18n/catalog';

interface AdaptiveFlowOverlayProps {
  graph: PanelGraph | null;
  isAnalyzing: boolean;
  visible: boolean;
  pageSlot: number;
  pageCount: number;
  onSwap: (firstId: string, secondId: string) => void;
  onUseManualRoute: () => void;
  onAddPanel?: (bounds: PanelBounds) => void;
  onRemovePanel?: (panelId: string) => void;
}

function statusLabel(graph: PanelGraph): string {
  switch (flowResolution(graph)) {
    case 'manual':
      return t('flow.manual');
    case 'review':
      return t('flow.review');
    default:
      return t('flow.ready');
  }
}

function guidanceLabel(graph: PanelGraph, canCorrectOrder: boolean, hasSelection: boolean): string {
  switch (flowResolution(graph)) {
    case 'manual':
      return t('flow.manualCopy');
    case 'review':
      if (canCorrectOrder) {
        return hasSelection
          ? t('flow.reviewSwap')
          : t('flow.reviewUncertain');
      }
      return t('flow.reviewKeep');
    default:
      return canCorrectOrder
        ? (hasSelection ? t('flow.chooseSecond') : t('flow.chooseTwo'))
        : t('flow.fullPageRoute');
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
  onAddPanel,
  onRemovePanel,
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
        <span className="flow-overlay-note">{t('flow.mapping')}</span>
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

  const deleteSelectedPanel = () => {
    if (firstSelection && onRemovePanel) {
      onRemovePanel(firstSelection);
      setFirstSelection(undefined);
    }
  };

  const handleAddPanel = () => {
    if (onAddPanel) {
      onAddPanel({ x: 0.1, y: 0.1, width: 0.8, height: 0.4 });
    }
  };

  return (
    <div className="flow-overlay" aria-label={t('flow.label')}>
      <section className="flow-overlay-legend" data-flow-control aria-labelledby="flow-overlay-title">
        <span id="flow-overlay-title">{t('flow.count', { count: panels.length })}</span>
        <strong>{statusLabel(graph)}</strong>
        <p>{guidanceLabel(graph, canCorrectOrder, Boolean(firstSelection))}</p>
        <div className="flow-legend-actions">
          {firstSelection && onRemovePanel && panels.length > 1 && (
            <button
              className="flow-manual-route flow-delete-panel-btn"
              data-flow-control
              type="button"
              onClick={deleteSelectedPanel}
              aria-label={t('flow.deletePanel')}
            >
              {t('flow.deletePanel')}
            </button>
          )}
          {onAddPanel && (
            <button
              className="flow-manual-route flow-add-panel-btn"
              data-flow-control
              type="button"
              onClick={handleAddPanel}
              aria-label={t('flow.addPanel')}
            >
              + {t('flow.addPanel')}
            </button>
          )}
          {canUseManualRoute && (
            <button
              className="flow-manual-route"
              data-flow-control
              type="button"
              onClick={onUseManualRoute}
              aria-label={t('flow.readFullPage')}
            >
              {t('flow.readFullPageButton')}
            </button>
          )}
        </div>
      </section>
      {panels.map((panel, index) => (
        <button
          className={`flow-panel-marker ${firstSelection === panel.id ? 'flow-panel-marker--selected' : ''}`}
          data-flow-control
          key={panel.id}
          type="button"
          aria-label={canCorrectOrder
            ? (firstSelection ? t('flow.panelSecond', { page: index + 1 }) : t('flow.panelFirst', { page: index + 1 }))
            : t('flow.panelRoute', { page: index + 1 })}
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
