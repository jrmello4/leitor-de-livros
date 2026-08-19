import { describe, expect, it } from 'vitest';
import { createDefaultProfile } from './profiles';
import { createPageSelectionCoordinator, preparePageSelection, selectLatestPage, warmWorkingSet, type EnsurePage } from './pageSelection';
import { activeWorkingSetPageIds } from './reader';
import type { PageDescriptor, Publication } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('race-safe page selection', () => {
  it('prepares a distant page with its destination working set under a tight cache limit', async () => {
    const pages: PageDescriptor[] = Array.from({ length: 8 }, (_, index) => ({
      id: `page-${index + 1}`,
      index,
      name: `page-${index + 1}.png`,
      src: `blob:${index + 1}`,
      width: 100,
      height: 140,
    }));
    const publication: Publication = {
      id: 'publication-1',
      title: 'Long publication',
      sourceLabel: 'long.cbz',
      format: 'cbz',
      pages,
      pageCount: pages.length,
      coverSrc: pages[0]?.src ?? '',
      coverPageId: 'page-1',
      currentPage: 1,
      progress: 0.25,
      direction: 'ltr',
      addedAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
      isFavorite: false,
    };
    const cached = new Set(['page-1', 'page-2', 'page-3', 'page-5', 'page-6', 'page-7']);
    let receivedProtectedIds: string[] = [];

    const evictToLimit = (protectedPageIds: string[]) => {
      for (const cachedPageId of [...cached]) {
        if (cached.size <= 3) {
          break;
        }
        if (!protectedPageIds.includes(cachedPageId)) {
          cached.delete(cachedPageId);
        }
      }
    };

    const prepared = await preparePageSelection(
      publication,
      createDefaultProfile(),
      5,
      async (_publicationId, pageId, protectedPageIds) => {
        receivedProtectedIds = protectedPageIds;
        evictToLimit(protectedPageIds);
        return pages.find((page) => page.id === pageId) ?? null;
      },
    );

    expect(prepared?.id).toBe('page-6');
    expect(receivedProtectedIds).toEqual(['page-1', 'page-2', 'page-3', 'page-5', 'page-6', 'page-7']);
    expect([...cached]).toEqual(['page-1', 'page-2', 'page-3', 'page-5', 'page-6', 'page-7']);

    publication.currentPage = 5;
    evictToLimit(activeWorkingSetPageIds(publication, createDefaultProfile(), publication.currentPage));
    expect([...cached]).toEqual(['page-5', 'page-6', 'page-7']);
  });

  it('commits only the newest page when preparation resolves out of order', async () => {
    const coordinator = createPageSelectionCoordinator();
    const first = deferred<string>();
    const second = deferred<string>();
    const committed: string[] = [];

    const olderSelection = selectLatestPage(
      coordinator,
      'publication-1',
      1,
      () => first.promise,
      (page) => { committed.push(page); },
    );
    const newerSelection = selectLatestPage(
      coordinator,
      'publication-1',
      2,
      () => second.promise,
      (page) => { committed.push(page); },
    );

    second.resolve('page-3');
    expect(await newerSelection).toBe(true);
    first.resolve('page-2');
    expect(await olderSelection).toBe(false);
    expect(committed).toEqual(['page-3']);
  });

  it('invalidates an in-flight selection when the reader changes publication', async () => {
    const coordinator = createPageSelectionCoordinator();
    const preparation = deferred<string>();
    const committed: string[] = [];

    const selection = selectLatestPage(
      coordinator,
      'publication-1',
      4,
      () => preparation.promise,
      (page) => { committed.push(page); },
    );

    coordinator.cancel();
    preparation.resolve('page-5');

    expect(await selection).toBe(false);
    expect(committed).toEqual([]);
  });

  it('waits for an asynchronous commit before completing the selection', async () => {
    const coordinator = createPageSelectionCoordinator();
    const commit = deferred<void>();
    let completed = false;

    const selection = selectLatestPage(
      coordinator,
      'publication-1',
      1,
      async () => 'page-2',
      async () => {
        await commit.promise;
        completed = true;
      },
    );

    await Promise.resolve();
    expect(completed).toBe(false);
    commit.resolve();
    expect(await selection).toBe(true);
    expect(completed).toBe(true);
  });
});

describe('warmWorkingSet', () => {
  it('prepares the pages a page turn needs, not just the one on screen', async () => {
    const pages: PageDescriptor[] = Array.from({ length: 8 }, (_, index) => ({
      id: `page-${index + 1}`,
      index,
      name: `page-${index + 1}.png`,
      src: `blob:${index + 1}`,
      width: 100,
      height: 140,
    }));
    const publication: Publication = {
      id: 'publication-1',
      title: 'Long publication',
      sourceLabel: 'long.cbz',
      format: 'cbz',
      pages,
      pageCount: pages.length,
      coverSrc: pages[0].src,
      coverPageId: 'page-1',
      currentPage: 3,
      progress: 0.4,
      direction: 'ltr',
      addedAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
      isFavorite: false,
    };
    const ensured: string[] = [];
    const ensurePage: EnsurePage = async (_publicationId, pageId) => {
      ensured.push(pageId);
      return pages.find((page) => page.id === pageId) ?? null;
    };

    // The fold is drawn from the page being left, the one arriving and the one
    // underneath. Only ever caching the visible page leaves those missing, and
    // the turn fails with "Could not decode page-turn image".
    await warmWorkingSet(publication, createDefaultProfile(), 3, ensurePage);

    expect(ensured).toContain('page-5');
    expect(ensured).toContain('page-3');
    expect(ensured.length).toBeGreaterThan(1);
  });
});
