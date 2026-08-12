import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoomMode } from '../domain/types';
import { ZoomControls } from './ZoomControls';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ZoomControls', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  function renderControls(overrides: Partial<React.ComponentProps<typeof ZoomControls>> = {}) {
    act(() => {
      root.render(
        <ZoomControls
          mode="manual"
          scale={1}
          onModeChange={vi.fn()}
          onScaleChange={vi.fn()}
          onResetPan={vi.fn()}
          {...overrides}
        />,
      );
    });
  }

  it('offers page, width and manual modes without starting the stage gesture', () => {
    const onModeChange = vi.fn();
    renderControls({ onModeChange });
    const page = host.querySelector<HTMLButtonElement>('[aria-label="Fit to page"]');
    expect(page).not.toBeNull();
    act(() => page?.click());
    expect(onModeChange).toHaveBeenCalledWith('page' satisfies ZoomMode);
  });

  it('uses bounded ten-percent zoom steps and a bounded slider', () => {
    const onScaleChange = vi.fn();
    renderControls({ scale: 3, onScaleChange });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click());
    expect(onScaleChange).toHaveBeenCalledWith(3);

    const slider = host.querySelector<HTMLInputElement>('[aria-label="Zoom level"]');
    expect(slider?.min).toBe('0.5');
    expect(slider?.max).toBe('3');
    expect(slider?.step).toBe('0.1');
    if (slider) {
      act(() => {
        slider.value = '0.1';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(onScaleChange).toHaveBeenLastCalledWith(0.5);
  });

  it('resets pan explicitly', () => {
    const onResetPan = vi.fn();
    renderControls({ onResetPan });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Reset pan"]')?.click());
    expect(onResetPan).toHaveBeenCalledTimes(1);
  });
});
