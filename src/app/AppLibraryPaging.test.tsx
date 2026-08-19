import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Publication } from '../domain/types';
import { App } from './App';

const native = vi.hoisted(() => ({
  listPublications: vi.fn(),
  loadPages: vi.fn(),
  getCacheInfo: vi.fn(),
  loadProfileStore: vi.fn(),
  saveProfileStore: vi.fn(),
  saveProgress: vi.fn(),
  ensurePage: vi.fn(),
  touchPages: vi.fn(),
  listBookmarks: vi.fn(),
  loadReaderState: vi.fn(),
}));

vi.mock('../rendering/ReaderSurface', () => ({
  ReaderSurface({ staticContent }: { staticContent: ReactNode }) {
    return <div>{staticContent}</div>;
  },
}));

vi.mock('../services/nativeLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/nativeLibrary')>();
  return {
    ...actual,
    isNativeRuntime: () => true,
    listNativePublications: native.listPublications,
    loadNativePublicationPages: native.loadPages,
    getNativeCacheInfo: native.getCacheInfo,
    loadNativeProfileStore: native.loadProfileStore,
    saveNativeProfileStore: native.saveProfileStore,
    saveNativeProgress: native.saveProgress,
    ensureNativePage: native.ensurePage,
    touchNativePages: native.touchPages,
    listNativeBookmarks: native.listBookmarks,
    loadNativeReaderState: native.loadReaderState,
  };
});

vi.mock('./LibraryView', () => ({
  LibraryView({ publications, onOpen }: { publications: Publication[]; onOpen(publication: Publication): void }) {
    return (
      <div>
        {publications.map((publication) => (
          <button
            key={publication.id}
            data-testid={`open-${publication.id}`}
            data-page-count={publication.pageCount}
            data-loaded-pages={publication.pages.length}
            onClick={() => onOpen(publication)}
          >
            {publication.title}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('./ReaderView', () => ({
  ReaderView({ publication }: { publication: Publication }) {
    return <div data-testid="reader" data-loaded-pages={publication.pages.length} />;
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What a native listing reports: counts and a cover, but no page list. */
const summary: Publication = {
  id: 'native-book',
  title: 'Native book',
  sourceLabel: 'native-book.cbz',
  sourceNames: ['native-book.cbz'],
  format: 'cbz',
  pages: [],
  pageCount: 240,
  coverSrc: 'native://cover',
  currentPageId: 'page-0',
  coverPageId: 'page-0',
  currentPage: 0,
  progress: 0,
  direction: 'ltr',
  addedAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  isFavorite: false,
};

const pages = Array.from({ length: 240 }, (_, index) => ({
  id: `page-${index}`,
  index,
  name: `page-${index}.png`,
  src: `native://page-${index}`,
  width: 800,
  height: 1200,
}));

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('library listing without page lists', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    native.listPublications.mockResolvedValue([summary]);
    native.loadPages.mockResolvedValue(pages);
    native.getCacheInfo.mockResolvedValue({ usedBytes: 0, maxBytes: 100, entryCount: 0 });
    native.loadProfileStore.mockResolvedValue(null);
    native.saveProfileStore.mockResolvedValue(undefined);
    native.saveProgress.mockResolvedValue(undefined);
    native.ensurePage.mockResolvedValue(pages[0]);
    native.touchPages.mockResolvedValue(undefined);
    native.listBookmarks.mockResolvedValue([]);
    native.loadReaderState.mockResolvedValue(null);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
      await flushReact();
    });
    await act(async () => { await flushReact(); });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows the page count from the listing without loading any page', () => {
    const card = host.querySelector('[data-testid="open-native-book"]');
    expect(card?.getAttribute('data-page-count')).toBe('240');
    expect(card?.getAttribute('data-loaded-pages')).toBe('0');
    expect(native.loadPages).not.toHaveBeenCalled();
  });

  it('loads the pages of the publication it opens', async () => {
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="open-native-book"]')!.click();
      await flushReact();
    });
    await act(async () => { await flushReact(); });

    expect(native.loadPages).toHaveBeenCalledWith('native-book');
    expect(host.querySelector('[data-testid="reader"]')?.getAttribute('data-loaded-pages')).toBe('240');
  });
});
