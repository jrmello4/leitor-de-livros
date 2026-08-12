import type { Bookmark, PageDescriptor, Publication } from './types';

export type LibrarySort = 'recent' | 'title';

export function mostRecentPublication(publications: Publication[]): Publication | undefined {
  return publications.reduce<Publication | undefined>((latest, publication) => (
    !latest || publication.updatedAt > latest.updatedAt ? publication : latest
  ), undefined);
}

export function visiblePublications(
  publications: Publication[],
  query: string,
  sort: LibrarySort,
): Publication[] {
  const normalizedQuery = query.trim().toLowerCase();
  return [...publications]
    .filter((publication) => publication.title.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => (
      sort === 'title'
        ? left.title.localeCompare(right.title)
        : right.updatedAt.localeCompare(left.updatedAt)
    ));
}

export function nextBookmark(bookmarks: Bookmark[], pageId: string, label = '', now: string): Bookmark[] {
  if (bookmarks.some((bookmark) => bookmark.pageId === pageId)) {
    return bookmarks.filter((bookmark) => bookmark.pageId !== pageId);
  }

  return [...bookmarks, { pageId, label, createdAt: now, updatedAt: now }];
}

export function sortBookmarks(bookmarks: Bookmark[], pages: PageDescriptor[]): Bookmark[] {
  const pageOrder = new Map(pages.map((page, order) => [page.id, order]));
  return [...bookmarks].sort((left, right) => (
    (pageOrder.get(left.pageId) ?? Number.MAX_SAFE_INTEGER)
    - (pageOrder.get(right.pageId) ?? Number.MAX_SAFE_INTEGER)
  ));
}
