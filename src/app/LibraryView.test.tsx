import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Publication } from '../domain/types';
import { LibraryView } from './LibraryView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function publication(id: string, title: string, isFavorite: boolean): Publication {
  return {
    id,
    title,
    sourceLabel: 'Test source',
    format: 'images',
    pages: [{ id: `${id}-page`, index: 0, name: 'cover.png', src: 'data:image/gif;base64,R0lGODlhAQABAAD/ACw=', width: 1, height: 1 }],
    coverPageId: `${id}-page`,
    currentPage: 0,
    progress: 0,
    direction: 'ltr',
    addedAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    isFavorite,
  };
}

function renderLibrary(host: HTMLDivElement, publications: Publication[], overrides: Partial<React.ComponentProps<typeof LibraryView>> = {}) {
  const root = createRoot(host);
  act(() => root.render(
    <LibraryView
      publications={publications}
      query=""
      sort="recent"
      isImporting={false}
      isNativeRuntime={false}
      onQueryChange={vi.fn()}
      onSortChange={vi.fn()}
      onOpen={vi.fn()}
      onImport={vi.fn()}
      onImportNative={vi.fn()}
      onImportFolder={vi.fn()}
      onOpenSettings={vi.fn()}
      onToggleFavorite={vi.fn()}
      onDelete={vi.fn()}
      favoriteOnly={false}
      onFavoriteOnlyChange={vi.fn()}
      settingsTriggerRef={{ current: null }}
      {...overrides}
    />,
  ));
  return root;
}

describe('LibraryView favorites and safe deletion', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.replaceChildren();
  });

  it('keeps the favorite star independent from opening a publication', () => {
    const book = publication('book-a', 'Book A', false);
    const onOpen = vi.fn();
    const onToggleFavorite = vi.fn();
    root = renderLibrary(host, [book], { onOpen, onToggleFavorite });

    const favorite = host.querySelector<HTMLButtonElement>('[aria-label="Add Book A to favorites"]');
    expect(favorite).not.toBeNull();
    act(() => favorite?.click());

    expect(onToggleFavorite).toHaveBeenCalledWith(book);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('filters the shelf to favorite publications', () => {
    const favoriteBook = publication('book-a', 'Favorite A', true);
    const regularBook = publication('book-b', 'Regular B', false);
    const onFavoriteOnlyChange = vi.fn();
    root = renderLibrary(host, [favoriteBook, regularBook], { onFavoriteOnlyChange });

    const filter = host.querySelector<HTMLInputElement>('#favorite-only');
    expect(filter).not.toBeNull();
    act(() => filter?.click());

    expect(onFavoriteOnlyChange).toHaveBeenCalledWith(true);
  });

  it('requires confirmation and explains that the original is preserved', async () => {
    const book = publication('book-a', 'Book A', false);
    const onDelete = vi.fn();
    root = renderLibrary(host, [book], { onDelete });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Remove Book A from library"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('Your original file will be preserved.');
    expect(onDelete).not.toHaveBeenCalled();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Confirm remove Book A"]')?.click();
      await Promise.resolve();
    });
    expect(onDelete).toHaveBeenCalledWith(book);
  });

  it('keeps the publication when the confirmation is cancelled', () => {
    const book = publication('book-a', 'Book A', false);
    const onDelete = vi.fn();
    root = renderLibrary(host, [book], { onDelete });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove Book A from library"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Keep publication"]')?.click());

    expect(host.textContent).toContain('Book A');
    expect(onDelete).not.toHaveBeenCalled();
  });
});
