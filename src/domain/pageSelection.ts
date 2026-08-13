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
  commit: (prepared: T, request: PageSelectionRequest) => void,
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
  commit(prepared, request);
  return true;
}
