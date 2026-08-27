import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, PageDescriptor } from '../domain/types';
import { PageNavigator } from './PageNavigator';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: PageDescriptor[] = [1, 2, 3].map((number, index) => ({
  id: `page-${number}`,
  index,
  name: `page-${number}.png`,
  src: `data:image/gif;base64,R0lGODlhAQABAAD/ACw=`,
  width: 100,
  height: 140,
}));

const bookmark: Bookmark = {
  pageId: 'page-2',
  label: 'climax',
  createdAt: '1000',
  updatedAt: '1000',
};

describe('PageNavigator', () => {
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

  function renderNavigator(overrides: Partial<React.ComponentProps<typeof PageNavigator>> = {}) {
    act(() => {
      root.render(
        <PageNavigator
          pages={pages}
          currentPage={1}
          bookmarks={[bookmark]}
          onSelectPage={vi.fn()}
          onToggleBookmark={vi.fn()}
          onClose={vi.fn()}
          {...overrides}
        />,
      );
    });
  }

  it('marks the selected thumbnail with aria-current and lazy loading', () => {
    renderNavigator();

    const selected = host.querySelector('[aria-current="page"]');
    expect(selected).not.toBeNull();
    expect(selected?.querySelector('img')?.getAttribute('loading')).toBe('lazy');
  });

  it('jumps directly to a page and toggles one bookmark independently', () => {
    const onSelectPage = vi.fn();
    const onToggleBookmark = vi.fn();
    renderNavigator({ onSelectPage, onToggleBookmark });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Go to page 3"]')?.click());
    expect(onSelectPage).toHaveBeenCalledWith(2);

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove bookmark from page 2"]')?.click());
    expect(onToggleBookmark).toHaveBeenCalledWith('page-2');
    expect(onSelectPage).toHaveBeenCalledTimes(1);
  });

  it('supports scrubber and a direct page number input', () => {
    const onSelectPage = vi.fn();
    renderNavigator({ onSelectPage });

    const scrubber = host.querySelector<HTMLInputElement>('[aria-label="Page scrubber"]');
    expect(scrubber?.getAttribute('aria-valuenow')).toBe('2');
    if (scrubber) {
      act(() => {
        scrubber.value = '3';
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(onSelectPage).toHaveBeenCalledWith(2);

    const input = host.querySelector<HTMLInputElement>('[aria-label="Jump to page number"]');
    expect(input).not.toBeNull();
    if (input) {
      act(() => {
        input.value = '1';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    }
    expect(onSelectPage).toHaveBeenCalledWith(0);
  });

  it('closes on Escape and exposes a keyboard close control', () => {
    const onClose = vi.fn();
    renderNavigator({ onClose });

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Close page navigator"]')).not.toBeNull();
  });

  it('edits a bookmark title from the keyboard', () => {
    const onUpdateBookmarkLabel = vi.fn();
    renderNavigator({ onUpdateBookmarkLabel });
    const title = host.querySelector<HTMLInputElement>('[aria-label="Bookmark title for page 2"]');
    expect(title).not.toBeNull();
    if (title) {
      act(() => {
        title.value = 'Climax';
        title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    }
    expect(onUpdateBookmarkLabel).toHaveBeenCalledWith('page-2', 'Climax');
    expect(onUpdateBookmarkLabel).toHaveBeenCalledTimes(1);
  });

  it('restores focus to its trigger when closed', () => {
    const trigger = document.createElement('button');
    document.body.prepend(trigger);
    const triggerRef = { current: trigger };
    trigger.focus();
    renderNavigator({ triggerRef });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close page navigator');

    act(() => root.unmount());
    expect(document.activeElement).toBe(trigger);
    root = createRoot(host);
  });

  it('displays a preview card when hovering over the scrubber track', () => {
    renderNavigator();

    const scrubber = host.querySelector<HTMLInputElement>('[aria-label="Page scrubber"]');
    expect(scrubber).not.toBeNull();

    if (scrubber) {
      act(() => {
        scrubber.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 100,
          }),
        );
      });
    }

    const preview = host.querySelector('.page-navigator__scrubber-preview');
    expect(preview).not.toBeNull();

    if (scrubber) {
      act(() => {
        scrubber.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      });
    }

    expect(host.querySelector('.page-navigator__scrubber-preview')).toBeNull();
  });
});
