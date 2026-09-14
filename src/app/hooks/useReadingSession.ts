import { useCallback, useRef } from 'react';
import { nextBookmark } from '../../domain/library';
import { clamp, calculateProgress, movePage } from '../../domain/reader';
import type { Bookmark, PageDescriptor, Publication, ReaderState, ReadingProfile } from '../../domain/types';
import {
  preparePageSelection,
  selectLatestPage,
  warmWorkingSet,
  type PageSelectionCoordinator,
  type PageSelectionRequest,
} from '../../domain/pageSelection';
import { t } from '../../i18n/catalog';
import { ensureNativePage, loadNativePublicationPages, saveNativeProgress } from '../../services/nativeLibrary';
import {
  removeBookmarkForPublication,
  saveBookmarkForPublication,
  saveReaderStateForPublication,
} from '../../services/readerState';
import { saveProgress } from '../../services/storage';

function sameBookmark(left: Bookmark | undefined, right: Bookmark | undefined): boolean {
  return left?.pageId === right?.pageId
    && left?.label === right?.label
    && left?.createdAt === right?.createdAt
    && left?.updatedAt === right?.updatedAt;
}

function restoreBookmark(bookmarks: Bookmark[], pageId: string, previous: Bookmark | undefined, previousIndex: number): Bookmark[] {
  const index = bookmarks.findIndex((bookmark) => bookmark.pageId === pageId);
  const restored = bookmarks.filter((bookmark) => bookmark.pageId !== pageId);
  if (!previous) {
    return restored;
  }
  restored.splice(Math.min(previousIndex < 0 ? (index < 0 ? restored.length : index) : previousIndex, restored.length), 0, previous);
  return restored;
}

export interface ReadingSessionDeps {
  nativeRuntime: boolean;
  profile: ReadingProfile;
  getLibrary: () => Publication[];
  getActivePublication: () => Publication | undefined;
  getActivePublicationId: () => string | null;
  updatePublication: (id: string, updater: (publication: Publication) => Publication) => void;
  applyPreparedPages: (publicationId: string, prepared: PageDescriptor[]) => void;
  setLibrary: React.Dispatch<React.SetStateAction<Publication[]>>;
  setActiveId: (id: string | null) => void;
  setShowProfile: (show: boolean) => void;
  setBookmarks: React.Dispatch<React.SetStateAction<Record<string, Bookmark[]>>>;
  setReaderStates: React.Dispatch<React.SetStateAction<Record<string, ReaderState>>>;
  bookmarksRef: { current: Record<string, Bookmark[]> };
  enqueueBookmarkWrite: (key: string, write: () => Promise<void>) => Promise<void>;
  pageSelectionCoordinatorRef: { current: PageSelectionCoordinator };
  onError: (message: string | undefined) => void;
  onAnnounce: (message: string) => void;
}

/**
 * Sessão de leitura: navegação entre páginas, persistência de progresso,
 * bookmarks e abertura de publicações. O coordenador de seleção de página
 * (uma seleção por vez) mora aqui; a remoção de publicação o cancela via
 * `cancelPageSelection`.
 */
export function useReadingSession({
  nativeRuntime,
  profile,
  getLibrary,
  getActivePublication,
  getActivePublicationId,
  updatePublication,
  applyPreparedPages,
  setLibrary,
  setActiveId,
  setShowProfile,
  setBookmarks,
  setReaderStates,
  bookmarksRef,
  enqueueBookmarkWrite,
  pageSelectionCoordinatorRef,
  onError,
  onAnnounce,
}: ReadingSessionDeps) {
  const boundaryAnnouncementRef = useRef(false);
  const readerTurnRequestRef = useRef<((delta: number) => void) | null>(null);

  const persistProgress = useCallback(async (publicationId: string, pageIndex: number): Promise<void> => {
    saveProgress(publicationId, pageIndex);
    if (nativeRuntime) {
      try {
        await saveNativeProgress(publicationId, pageIndex);
      } catch {
        onError(t('app.progressSaveError'));
      }
    }
  }, [nativeRuntime, onError]);

  const persistReaderState = useCallback(async (publicationId: string, state: ReaderState) => {
    setReaderStates((current) => {
      const previous = current[publicationId];
      if (
        previous
        && previous.zoomMode === state.zoomMode
        && previous.zoomScale === state.zoomScale
        && previous.panX === state.panX
        && previous.panY === state.panY
        && previous.pageId === state.pageId
        && previous.scrollRatio === state.scrollRatio
      ) {
        return current;
      }
      return { ...current, [publicationId]: state };
    });
    try {
      await saveReaderStateForPublication(publicationId, state);
    } catch {
      onError(t('app.readerStateSaveError'));
    }
  }, [onError, setReaderStates]);

  const toggleBookmark = useCallback(async (publicationId: string, pageId: string) => {
    const current = bookmarksRef.current[publicationId] ?? [];
    const existing = current.find((bookmark) => bookmark.pageId === pageId);
    const next = nextBookmark(current, pageId, '', new Date().toISOString());
    const nextState = { ...bookmarksRef.current, [publicationId]: next };
    bookmarksRef.current = nextState;
    setBookmarks(nextState);
    const key = `${publicationId}:${pageId}`;
    try {
      await enqueueBookmarkWrite(key, () => existing
        ? removeBookmarkForPublication(publicationId, pageId)
        : saveBookmarkForPublication(publicationId, next.find((bookmark) => bookmark.pageId === pageId)!));
    } catch {
      setBookmarks((all) => {
        const latest = all[publicationId] ?? [];
        const expected = next.find((bookmark) => bookmark.pageId === pageId);
        const actual = latest.find((bookmark) => bookmark.pageId === pageId);
        if (!sameBookmark(actual, expected)) {
          return all;
        }
        const restored = {
          ...all,
          [publicationId]: restoreBookmark(latest, pageId, current.find((bookmark) => bookmark.pageId === pageId), current.findIndex((bookmark) => bookmark.pageId === pageId)),
        };
        bookmarksRef.current = restored;
        return restored;
      });
      onError(t('app.bookmarkSaveError'));
    }
  }, [bookmarksRef, enqueueBookmarkWrite, onError, setBookmarks]);

  const selectPublicationPage = useCallback(async (
    publication: Publication,
    pageIndex: number,
    onCommit: (preparedPage: PageDescriptor | null, request: PageSelectionRequest) => void | Promise<void>,
  ): Promise<boolean> => {
    if (publication.pages.length === 0) {
      return false;
    }
    const nextPage = clamp(pageIndex, 0, publication.pages.length - 1);
    return selectLatestPage(
      pageSelectionCoordinatorRef.current,
      publication.id,
      nextPage,
      async () => {
        // Files selected through the Android HTML picker are already decoded
        // into blob URLs. They must follow the browser path even in the Tauri
        // runtime; asking Rust to prepare a blob descriptor makes the tap look
        // like it did nothing because there is no filesystem path to rebuild.
        if (!nativeRuntime || publication.pages[0]?.src?.startsWith('blob:')) {
          return null;
        }
        const prepared = await preparePageSelection(publication, profile, nextPage, ensureNativePage);
        // The page on screen is ready; its neighbours are what the next fold is
        // drawn from, so they warm up behind it rather than holding it back.
        // Rebuilding a page can move it in the derived cache, so the refreshed
        // descriptors are merged back — a stale source is exactly what makes
        // the fold fail to decode after the cache is cleared.
        void warmWorkingSet(publication, profile, nextPage, ensureNativePage)
          .then((warmed) => {
            if (warmed.length > 0) {
              applyPreparedPages(publication.id, warmed);
            }
          })
          .catch(() => undefined);
        return prepared;
      },
      onCommit,
      () => {
        onError(t('app.pageRebuildError'));
      },
    );
  }, [applyPreparedPages, nativeRuntime, onError, profile]);

  const commitActivePageSelection = useCallback(async (
    preparedPage: PageDescriptor | null,
    request: PageSelectionRequest,
  ): Promise<void> => {
    if (getActivePublicationId() !== request.publicationId) {
      return;
    }
    const latest = getLibrary().find((publication) => publication.id === request.publicationId);
    if (!latest) {
      return;
    }
    await persistProgress(request.publicationId, request.pageIndex);
    updatePublication(request.publicationId, (publication) => ({
      ...publication,
      pages: preparedPage
        ? publication.pages.map((page) => page.id === preparedPage.id ? preparedPage : page)
        : publication.pages,
      currentPage: request.pageIndex,
      progress: calculateProgress(request.pageIndex, publication.pageCount, profile.direction),
      updatedAt: new Date().toISOString(),
    }));
    // A completed persistence from the preceding turn must not overwrite the
    // more recent boundary feedback.
    if (!boundaryAnnouncementRef.current) {
      onAnnounce(t('app.pageReady', { page: request.pageIndex + 1, count: latest.pageCount }));
    }
  }, [getActivePublicationId, getLibrary, onAnnounce, persistProgress, profile.direction, updatePublication]);

  const moveActivePage = useCallback(
    async (delta: number) => {
      const current = getActivePublication();
      if (!current) {
        return;
      }

      const nextPage = movePage(current.currentPage, current.pageCount, profile.direction, delta);
      if (nextPage === current.currentPage) {
        pageSelectionCoordinatorRef.current.cancel();
        boundaryAnnouncementRef.current = true;
        onAnnounce(delta > 0 ? t('app.endOfPublication') : t('app.beginningOfPublication'));
        return;
      }

      boundaryAnnouncementRef.current = false;
      await selectPublicationPage(current, nextPage, commitActivePageSelection);
    },
    [commitActivePageSelection, getActivePublication, onAnnounce, profile.direction, selectPublicationPage],
  );

  const dispatchPageTurn = useCallback((delta: number) => {
    if (readerTurnRequestRef.current) {
      readerTurnRequestRef.current(delta);
      return;
    }
    void moveActivePage(delta);
  }, [moveActivePage]);

  const registerReaderTurnRequest = useCallback((request: ((delta: number) => void) | null) => {
    readerTurnRequestRef.current = request;
  }, []);

  const selectActivePage = useCallback(
    async (pageIndex: number) => {
      const current = getActivePublication();
      if (!current || current.pages.length === 0) {
        return;
      }
      const nextPage = clamp(pageIndex, 0, current.pages.length - 1);
      if (nextPage === current.currentPage) {
        pageSelectionCoordinatorRef.current.cancel();
        return;
      }
      await selectPublicationPage(current, nextPage, commitActivePageSelection);
    },
    [commitActivePageSelection, getActivePublication, selectPublicationPage],
  );

  // Continuous scrolling already has the page in its DOM. Treating every
  // IntersectionObserver update as a page-selection request rebuilt native
  // cache entries during a pinch zoom, which could evict nearby images and
  // make the reader appear to jump. Record progress without preparing pages.
  const recordWebtoonVisiblePage = useCallback((pageIndex: number) => {
    const current = getActivePublication();
    if (!current || current.pages.length === 0) {
      return;
    }
    const nextPage = clamp(pageIndex, 0, current.pages.length - 1);
    if (nextPage === current.currentPage) {
      return;
    }
    updatePublication(current.id, (publication) => ({
      ...publication,
      currentPage: nextPage,
      progress: calculateProgress(nextPage, publication.pageCount, profile.direction),
      updatedAt: new Date().toISOString(),
    }));
    void persistProgress(current.id, nextPage);
  }, [getActivePublication, persistProgress, profile.direction, updatePublication]);

  const saveActiveReaderState = useCallback((state: ReaderState) => {
    const active = getActivePublication();
    if (active) {
      void persistReaderState(active.id, state);
    }
  }, [getActivePublication, persistReaderState]);

  const toggleActiveBookmark = useCallback((pageId: string) => {
    const active = getActivePublication();
    if (active) {
      void toggleBookmark(active.id, pageId);
    }
  }, [getActivePublication, toggleBookmark]);

  const updateActiveBookmarkLabel = useCallback((pageId: string, label: string) => {
    const publicationId = getActivePublicationId();
    if (!publicationId) {
      return;
    }
    const current = bookmarksRef.current[publicationId] ?? [];
    const existing = current.find((bookmark) => bookmark.pageId === pageId);
    if (!existing) {
      return;
    }
    const normalizedLabel = label.trim().slice(0, 120) || t('navigator.defaultBookmark');
    const next = current.map((bookmark) => bookmark.pageId === pageId
      ? { ...bookmark, label: normalizedLabel, updatedAt: new Date().toISOString() }
      : bookmark);
    const nextState = { ...bookmarksRef.current, [publicationId]: next };
    bookmarksRef.current = nextState;
    setBookmarks(nextState);
    const expected = next.find((bookmark) => bookmark.pageId === pageId)!;
    void enqueueBookmarkWrite(`${publicationId}:${pageId}`, () => saveBookmarkForPublication(publicationId, expected)).catch(() => {
      setBookmarks((all) => {
        const latest = all[publicationId] ?? [];
        const actual = latest.find((bookmark) => bookmark.pageId === pageId);
        if (!sameBookmark(actual, expected)) {
          return all;
        }
        const restored = {
          ...all,
          [publicationId]: restoreBookmark(latest, pageId, current.find((bookmark) => bookmark.pageId === pageId), current.findIndex((bookmark) => bookmark.pageId === pageId)),
        };
        bookmarksRef.current = restored;
        return restored;
      });
      onError(t('app.bookmarkSaveError'));
    });
  }, [bookmarksRef, enqueueBookmarkWrite, getActivePublicationId, onError, setBookmarks]);

  const openPublication = async (summary: Publication) => {
    // The library lists summaries; reading needs the actual pages, so they are
    // loaded for this one publication as it opens.
    const publication = summary.pages.length > 0 || !nativeRuntime
      ? summary
      : { ...summary, pages: await loadNativePublicationPages(summary.id).catch(() => []) };

    if (publication.pages.length === 0 && publication.pageCount > 0) {
      onError(t('app.publicationPagesError'));
      return;
    }

    const lastPage = Math.max(publication.pageCount - 1, 0);
    const startsAtFreshRtlPage =
      profile.direction === 'rtl' &&
      publication.currentPage === 0 &&
      publication.progress <= 1 / Math.max(publication.pageCount, 1);
    const openingPublication = startsAtFreshRtlPage
      ? {
          ...publication,
          currentPage: lastPage,
          progress: calculateProgress(lastPage, publication.pageCount, 'rtl'),
        }
      : publication;

    const commitOpenedPublication = async (preparedPage: PageDescriptor | null, request: PageSelectionRequest) => {
      const readyPublication = {
        ...openingPublication,
        pages: preparedPage
          ? openingPublication.pages.map((page) => page.id === preparedPage.id ? preparedPage : page)
          : openingPublication.pages,
        currentPage: request.pageIndex,
        progress: calculateProgress(request.pageIndex, openingPublication.pageCount, profile.direction),
      };
      setLibrary((current) => {
        if (current.some((entry) => entry.id === readyPublication.id)) {
          return current.map((entry) => entry.id === readyPublication.id ? readyPublication : entry);
        }
        return [readyPublication, ...current];
      });
      if (readyPublication.currentPage !== summary.currentPage || readyPublication !== summary) {
        await persistProgress(readyPublication.id, readyPublication.currentPage);
      }
      setActiveId(readyPublication.id);
      setShowProfile(false);
      onError(undefined);
      onAnnounce(t('app.publicationOpened', { title: readyPublication.title, page: readyPublication.currentPage + 1, count: readyPublication.pageCount }));
    };

    // A cold native cache may need to decompress a PDF/CBZ page. Enter the
    // reader first, then rebuild that page in the background; otherwise a tap
    // on a library card appears frozen until I/O and decoding have finished.
    const openingPage = openingPublication.pages[openingPublication.currentPage];
    if (nativeRuntime && !openingPage?.src) {
      await commitOpenedPublication(null, {
        publicationId: openingPublication.id,
        pageIndex: openingPublication.currentPage,
        sequence: 0,
      });
      void selectPublicationPage(openingPublication, openingPublication.currentPage, commitOpenedPublication);
      return;
    }

    await selectPublicationPage(openingPublication, openingPublication.currentPage, commitOpenedPublication);
  };

  return {
    persistProgress,
    persistReaderState,
    toggleBookmark,
    selectPublicationPage,
    commitActivePageSelection,
    moveActivePage,
    dispatchPageTurn,
    registerReaderTurnRequest,
    selectActivePage,
    recordWebtoonVisiblePage,
    saveActiveReaderState,
    toggleActiveBookmark,
    updateActiveBookmarkLabel,
    openPublication,
  };
}
