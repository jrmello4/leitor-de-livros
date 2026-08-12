import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { loadProfile } from '../services/storage';
import { ProfilePanel } from './ProfilePanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProfilePanel focus management', () => {
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

  it('restores focus to the original opener even if the shared trigger ref changes', () => {
    const originalTrigger = document.createElement('button');
    const replacementTrigger = document.createElement('button');
    document.body.prepend(originalTrigger, replacementTrigger);
    originalTrigger.focus();
    const triggerRef = { current: originalTrigger } as RefObject<HTMLButtonElement | null>;

    act(() => {
      root.render(
        <ProfilePanel
          profile={loadProfile()}
          capturingAction={null}
          onChange={vi.fn()}
          onStartCapture={vi.fn()}
          onReset={vi.fn()}
          onClose={vi.fn()}
          triggerRef={triggerRef}
        />,
      );
    });

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close settings');
    triggerRef.current = replacementTrigger;

    act(() => root.unmount());

    expect(document.activeElement).toBe(originalTrigger);
    root = createRoot(host);
  });
});
