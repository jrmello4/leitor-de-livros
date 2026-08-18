import type { Bookmark, PageDescriptor, Publication } from './types';

export type LibrarySort = 'recent' | 'title' | 'added';

export function safeSourceName(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

function safeSourceNames(publication: Publication): string[] {
  return [
    safeSourceName(publication.sourceLabel),
    ...(publication.sourceNames ?? []).map(safeSourceName),
  ].filter(Boolean);
}

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
    .filter((publication) => {
      const searchable = [
        publication.title,
        ...safeSourceNames(publication),
      ].join('\n').toLowerCase();
      return searchable.includes(normalizedQuery);
    })
    .sort((left, right) => comparePublications(left, right, sort));
}

function comparePublications(left: Publication, right: Publication, sort: LibrarySort): number {
  if (sort === 'title') {
    return compareText(left.title, right.title)
      || compareText(left.sourceLabel, right.sourceLabel)
      || compareText(left.id, right.id);
  }
  if (sort === 'added') {
    return compareDescending(left.addedAt, right.addedAt)
      || compareText(left.title, right.title)
      || compareText(left.sourceLabel, right.sourceLabel)
      || compareText(left.id, right.id);
  }
  return compareDescending(left.updatedAt, right.updatedAt)
    || compareText(left.title, right.title)
    || compareText(left.sourceLabel, right.sourceLabel)
    || compareText(left.id, right.id);
}

function compareDescending(left: string, right: string): number {
  return right.localeCompare(left);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
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
