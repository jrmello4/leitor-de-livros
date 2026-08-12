import type { Publication } from './types';

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
