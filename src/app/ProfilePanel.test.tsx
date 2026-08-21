import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { loadProfile } from '../services/storage';
import type { CacheInfo } from '../domain/types';
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

  it('offers the supported cache limits and a manual clear action', () => {
    const cacheInfo: CacheInfo = {
      usedBytes: 96 * 1024 * 1024,
      maxBytes: 2 * 1024 * 1024 * 1024,
      entryCount: 4,
    };
    const onSetCacheLimit = vi.fn();
    const onClearCache = vi.fn();

    act(() => {
      root.render(
        <ProfilePanel
          profile={loadProfile()}
          capturingAction={null}
          onChange={vi.fn()}
          onStartCapture={vi.fn()}
          onReset={vi.fn()}
          onClose={vi.fn()}
          triggerRef={{ current: null }}
          cacheInfo={cacheInfo}
          onSetCacheLimit={onSetCacheLimit}
          onClearCache={onClearCache}
        />,
      );
    });

    const select = host.querySelector<HTMLSelectElement>('#cache-limit');
    expect(select?.querySelectorAll('option')).toHaveLength(4);
    expect(select?.textContent).toContain('512 MiB');
    expect(select?.textContent).toContain('1 GiB');
    expect(select?.textContent).toContain('2 GiB');
    expect(select?.textContent).toContain('5 GiB');
    if (select) {
      act(() => {
        select.value = String(512 * 1024 * 1024);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    expect(onSetCacheLimit).toHaveBeenCalledWith(512 * 1024 * 1024);

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Clear derived cache"]')?.click());
    expect(onClearCache).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Original files are never removed');
  });

  it('explains when cache controls require the desktop app', () => {
    act(() => {
      root.render(
        <ProfilePanel
          profile={loadProfile()}
          capturingAction={null}
          onChange={vi.fn()}
          onStartCapture={vi.fn()}
          onReset={vi.fn()}
          onClose={vi.fn()}
          triggerRef={{ current: null }}
          cacheAvailable={false}
        />,
      );
    });

    expect(host.textContent).toContain('Cache controls are available in the desktop app.');
    expect(host.querySelector<HTMLSelectElement>('#cache-limit')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Clear derived cache"]')?.disabled).toBe(true);
  });

  it('exposes explicit save and undo controls for a profile preview', () => {
    const onSavePreview = vi.fn();
    const onUndoPreview = vi.fn();
    const onExportProfiles = vi.fn();

    act(() => {
      root.render(
        <ProfilePanel
          profile={loadProfile()}
          capturingAction={null}
          onChange={vi.fn()}
          onStartCapture={vi.fn()}
          onReset={vi.fn()}
          onClose={vi.fn()}
          triggerRef={{ current: null }}
          isPreviewing
          onSavePreview={onSavePreview}
          onUndoPreview={onUndoPreview}
          onExportProfiles={onExportProfiles}
        />,
      );
    });

    const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent === label);
    act(() => button('Save preview')?.click());
    act(() => button('Undo preview')?.click());
    act(() => button('Export profiles')?.click());

    expect(onSavePreview).toHaveBeenCalledTimes(1);
    expect(onUndoPreview).toHaveBeenCalledTimes(1);
    expect(onExportProfiles).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Previewing unsaved changes');
  });

  it('renders interface language selector and allows changing language', () => {
    act(() => {
      root.render(
        <ProfilePanel
          profile={loadProfile()}
          capturingAction={null}
          onChange={vi.fn()}
          onStartCapture={vi.fn()}
          onReset={vi.fn()}
          onClose={vi.fn()}
          triggerRef={{ current: null }}
        />,
      );
    });

    const langSelect = host.querySelector<HTMLSelectElement>('#interface-language');
    expect(langSelect).not.toBeNull();
    expect(langSelect?.textContent).toContain('English');
    expect(langSelect?.textContent).toContain('Português (Brasil)');

    act(() => {
      if (langSelect) {
        langSelect.value = 'pt-BR';
        langSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(langSelect?.value).toBe('pt-BR');
  });
});
