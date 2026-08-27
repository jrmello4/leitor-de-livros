import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelRegion } from '../domain/flow';
import { CinematicGuidedOverlay } from './CinematicGuidedOverlay';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CinematicGuidedOverlay', () => {
  let host: HTMLDivElement;
  let root: Root;

  const mockPanels: PanelRegion[] = [
    { id: 'p1', order: 0, bounds: { x: 0, y: 0, width: 0.5, height: 0.5 } },
    { id: 'p2', order: 1, bounds: { x: 0.5, y: 0, width: 0.5, height: 0.5 } },
    { id: 'p3', order: 2, bounds: { x: 0, y: 0.5, width: 1, height: 0.5 } },
  ];

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it('renders nothing when active is false', () => {
    act(() => {
      root.render(
        <CinematicGuidedOverlay
          active={false}
          currentPanelIndex={0}
          panels={mockPanels}
          onNextPanel={vi.fn()}
          onPrevPanel={vi.fn()}
          onExit={vi.fn()}
        />,
      );
    });

    expect(host.querySelector('.guided-overlay')).toBeNull();
  });

  it('renders panel badge and spotlight frame when active is true', () => {
    const onNextPanel = vi.fn();
    const onPrevPanel = vi.fn();
    const onExit = vi.fn();

    act(() => {
      root.render(
        <CinematicGuidedOverlay
          active={true}
          currentPanelIndex={1}
          panels={mockPanels}
          onNextPanel={onNextPanel}
          onPrevPanel={onPrevPanel}
          onExit={onExit}
        />,
      );
    });

    const overlay = host.querySelector('.guided-overlay');
    expect(overlay).not.toBeNull();

    // Badge showing Panel 2 of 3
    const badge = host.querySelector('.guided-pill-badge');
    expect(badge?.textContent).toContain('2');
    expect(badge?.textContent).toContain('3');

    // Next button
    const nextBtn = host.querySelector<HTMLButtonElement>('[aria-label="Next panel"]');
    expect(nextBtn).not.toBeNull();
    act(() => nextBtn?.click());
    expect(onNextPanel).toHaveBeenCalledTimes(1);

    // Prev button
    const prevBtn = host.querySelector<HTMLButtonElement>('[aria-label="Previous panel"]');
    expect(prevBtn).not.toBeNull();
    act(() => prevBtn?.click());
    expect(onPrevPanel).toHaveBeenCalledTimes(1);

    // Exit button
    const exitBtn = host.querySelector<HTMLButtonElement>('[aria-label="Exit Cinema Mode (Esc)"]');
    expect(exitBtn).not.toBeNull();
    act(() => exitBtn?.click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('exits when Escape key is pressed', () => {
    const onExit = vi.fn();

    act(() => {
      root.render(
        <CinematicGuidedOverlay
          active={true}
          currentPanelIndex={0}
          panels={mockPanels}
          onNextPanel={vi.fn()}
          onPrevPanel={vi.fn()}
          onExit={onExit}
        />,
      );
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
