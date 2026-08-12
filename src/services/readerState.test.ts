// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultReaderState } from '../domain/readerState';
import {
  loadReaderStateForPublication,
  saveReaderStateForPublication,
  listBookmarksForPublication,
  saveBookmarkForPublication,
  removeBookmarkForPublication,
  toggleFavoriteForPublication,
} from './readerState';

describe('hybrid reader state adapter', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('uses the versioned browser fallback and isolates each publication', async () => {
    await saveReaderStateForPublication('book-a', { zoomMode: 'manual', zoomScale: 1.2, panX: 8, panY: -2 });
    await saveBookmarkForPublication('book-a', {
      pageId: 'page-a',
      label: 'start',
      createdAt: '1',
      updatedAt: '1',
    });
    await toggleFavoriteForPublication('book-a', true);

    expect(await loadReaderStateForPublication('book-a')).toEqual({
      zoomMode: 'manual',
      zoomScale: 1.2,
      panX: 8,
      panY: -2,
    });
    expect(await loadReaderStateForPublication('book-b')).toEqual(defaultReaderState);
    expect(await listBookmarksForPublication('book-a')).toHaveLength(1);
    expect(await listBookmarksForPublication('book-b')).toEqual([]);

    await removeBookmarkForPublication('book-a', 'page-a');
    expect(await listBookmarksForPublication('book-a')).toEqual([]);
  });

  it('normalizes malformed native-shaped DTOs instead of throwing', async () => {
    const native = await import('./nativeLibrary');
    vi.spyOn(native, 'isNativeRuntime').mockReturnValue(true);
    vi.spyOn(native, 'loadNativeReaderState').mockResolvedValue({
      zoomMode: 'unknown' as never,
      zoomScale: Number.NaN,
      panX: 'bad' as never,
      panY: null as never,
    });
    vi.spyOn(native, 'listNativeBookmarks').mockResolvedValue([
      { pageId: 4 as never, label: null as never, createdAt: 5 as never, updatedAt: {} as never },
      { pageId: 'page-1', label: 'ok', createdAt: '1', updatedAt: '2' },
    ]);

    await expect(loadReaderStateForPublication('book-a')).resolves.toEqual(defaultReaderState);
    await expect(listBookmarksForPublication('book-a')).resolves.toEqual([
      { pageId: 'page-1', label: 'ok', createdAt: '1', updatedAt: '2' },
    ]);
  });
});
