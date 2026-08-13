import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Publication } from '../domain/types';
import type { LibrarySort } from '../domain/library';
import { LibraryView } from './LibraryView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function publication(
  id: string,
  title: string,
  isFavorite: boolean,
  overrides: Partial<Publication> = {},
): Publication {
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
    ...overrides,
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

function ControlledLibrary({ publications }: { publications: Publication[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('recent');
  return (
    <LibraryView
      publications={publications}
      query={query}
      sort={sort}
      isImporting={false}
      isNativeRuntime={false}
      onQueryChange={setQuery}
      onSortChange={setSort}
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
    />
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: LibrarySort) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
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

  it('searches by a safe filename without exposing an absolute source path', () => {
    const privatePath = 'C:\\private\\library\\chapter-07.cbz';
    const book = publication('book-a', 'Untitled', false, {
      sourceLabel: privatePath,
      sourceNames: [privatePath],
    });
    root = createRoot(host);
    act(() => root.render(<ControlledLibrary publications={[book]} />));

    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search your shelf"]');
    expect(search).not.toBeNull();
    act(() => {
      search?.focus();
      if (search) {
        setInputValue(search, 'chapter-07');
      }
    });

    expect(document.activeElement).toBe(search);
    expect(host.textContent).toContain('Untitled');
    expect(host.textContent).toContain('chapter-07.cbz');
    expect(host.textContent).not.toContain('C:\\private');
  });

  it('sorts rendered publications through the accessible selector', () => {
    const books = [
      publication('charlie', 'Charlie', false, {
        addedAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-13T00:00:00.000Z',
      }),
      publication('alpha', 'Alpha', false, {
        addedAt: '2026-08-13T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }),
      publication('bravo', 'Bravo', false, {
        addedAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      }),
    ];
    root = createRoot(host);
    act(() => root.render(<ControlledLibrary publications={books} />));
    const sort = host.querySelector<HTMLSelectElement>('select[aria-label="Sort publications"]');
    expect(sort).not.toBeNull();
    const renderedTitles = () => [...host.querySelectorAll('.publication-card h2')].map((node) => node.textContent);

    act(() => sort?.focus());
    expect(document.activeElement).toBe(sort);
    expect(renderedTitles()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    act(() => sort && setSelectValue(sort, 'title'));
    expect(renderedTitles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    act(() => sort && setSelectValue(sort, 'added'));
    expect(renderedTitles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('renders deterministic tie breakers at the component boundary', () => {
    const tiedBooks = [
      publication('z-book', 'Same title', false, { sourceLabel: 'z-book.cbz' }),
      publication('a-book', 'Same title', false, { sourceLabel: 'a-book.cbz' }),
    ];
    root = createRoot(host);
    act(() => root.render(<ControlledLibrary publications={tiedBooks} />));

    expect([...host.querySelectorAll('.publication-card .eyebrow')].map((node) => node.textContent))
      .toEqual(['a-book.cbz', 'z-book.cbz']);
  });

  it('announces an empty result after keyboard-usable search input', () => {
    root = createRoot(host);
    act(() => root.render(<ControlledLibrary publications={[publication('book-a', 'Book A', false)]} />));
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search your shelf"]');

    act(() => {
      search?.focus();
      if (search) {
        setInputValue(search, 'missing title');
      }
    });

    expect(document.activeElement).toBe(search);
    expect(host.textContent).toContain('No publication matches that search.');
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

  it('keeps the publication when the confirmation is cancelled', async () => {
    const book = publication('book-a', 'Book A', false);
    const onDelete = vi.fn();
    root = renderLibrary(host, [book], { onDelete });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Remove Book A from library"]')?.click();
      await Promise.resolve();
    });
    const removeButton = host.querySelector<HTMLButtonElement>('[aria-label="Remove Book A from library"]');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Keep publication"]')?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain('Book A');
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(removeButton);
  });

  it('restores focus after a successful removal request while the card remains mounted', async () => {
    const book = publication('book-a', 'Book A', false);
    const onDelete = vi.fn(async () => undefined);
    root = renderLibrary(host, [book], { onDelete });
    const removeButton = host.querySelector<HTMLButtonElement>('[aria-label="Remove Book A from library"]');

    await act(async () => {
      removeButton?.click();
      await Promise.resolve();
      host.querySelector<HTMLButtonElement>('[aria-label="Confirm remove Book A"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onDelete).toHaveBeenCalledWith(book);
    expect(document.activeElement).toBe(host.querySelector('main.library-view'));
  });
});
