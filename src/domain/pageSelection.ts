import { activeWorkingSetPageIds } from './reader';
import type { PageDescriptor, Publication, ReadingProfile } from './types';

export type EnsurePage = (
  publicationId: string,
  pageId: string,
  protectedPageIds: string[],
) => Promise<PageDescriptor | null>;

export async function preparePageSelection(
  publication: Publication,
  profile: ReadingProfile,
  pageIndex: number,
  ensurePage: EnsurePage,
): Promise<PageDescriptor> {
  const page = publication.pages[pageIndex];
  const protectedPageIds = [
    ...new Set([
      ...activeWorkingSetPageIds(publication, profile, publication.currentPage),
      ...activeWorkingSetPageIds(publication, profile, pageIndex),
    ]),
  ];
  const preparedPage = await ensurePage(publication.id, page?.id ?? '', protectedPageIds);
  if (!preparedPage) {
    throw new Error('page-unavailable');
  }
  return preparedPage;
}

/**
 * Prepares the pages around the one being read.
 *
 * A page turn is drawn from the page being left, the one arriving and the one
 * underneath, and those come from the derived cache like any other page. Only
 * ever caching the visible page leaves the neighbours missing — after the cache
 * is cleared the fold cannot load them and the turn fails with "Could not
 * decode page-turn image", so the reader keeps changing pages with no
 * animation at all.
 *
 * Failures here are deliberately swallowed: this is a warm-up, and the page on
 * screen has already been prepared by `preparePageSelection`.
 */
export async function warmWorkingSet(
  publication: Publication,
  profile: ReadingProfile,
  pageIndex: number,
  ensurePage: EnsurePage,
): Promise<PageDescriptor[]> {
  const working = activeWorkingSetPageIds(publication, profile, pageIndex);
  const prepared: PageDescriptor[] = [];

  for (const pageId of working) {
    try {
      const page = await ensurePage(publication.id, pageId, working);
      if (page?.src) {
        prepared.push(page);
      }
    } catch {
      // A page that cannot be rebuilt must not stop the others warming.
    }
  }

  return prepared;
}

export interface PageSelectionRequest {
  sequence: number;
  publicationId: string;
  pageIndex: number;
}

export interface PageSelectionCoordinator {
  begin(publicationId: string, pageIndex: number): PageSelectionRequest;
  isCurrent(request: PageSelectionRequest): boolean;
  cancel(): void;
}

export function createPageSelectionCoordinator(): PageSelectionCoordinator {
  let sequence = 0;

  return {
    begin(publicationId, pageIndex) {
      sequence += 1;
      return { sequence, publicationId, pageIndex };
    },
    isCurrent(request) {
      return request.sequence === sequence;
    },
    cancel() {
      sequence += 1;
    },
  };
}

export async function selectLatestPage<T>(
  coordinator: PageSelectionCoordinator,
  publicationId: string,
  pageIndex: number,
  prepare: () => Promise<T>,
  commit: (prepared: T, request: PageSelectionRequest) => void | Promise<void>,
  onPrepareError?: (error: unknown, request: PageSelectionRequest) => void,
): Promise<boolean> {
  const request = coordinator.begin(publicationId, pageIndex);
  let prepared: T;
  try {
    prepared = await prepare();
  } catch (error) {
    if (coordinator.isCurrent(request)) {
      onPrepareError?.(error, request);
    }
    return false;
  }
  if (!coordinator.isCurrent(request)) {
    return false;
  }
  await commit(prepared, request);
  return true;
}
