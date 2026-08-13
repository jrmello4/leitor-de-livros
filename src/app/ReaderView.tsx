import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, RefObject, WheelEvent } from 'react';
import { t } from '../i18n/catalog';
import { resolvePageTurn, type PageTurnPhase } from '../domain/pageTurn';
import { clamp, clampPan, clampZoomScale, navigationAvailability, pageCounter, visiblePageIndexes } from '../domain/reader';
import { defaultReaderState, normalizeReaderState } from '../domain/readerState';
import type { Bookmark, PageDescriptor, Publication, ReaderState, ReadingProfile, ZoomMode } from '../domain/types';
import { touchNativePages } from '../services/nativeLibrary';
import { useAdaptiveFlow } from '../flow/useAdaptiveFlow';
import { ReaderSurface } from '../rendering/ReaderSurface';
import type { RenderFrame, RendererStatus } from '../rendering/contracts';
import { rendererStatusMessage } from '../rendering/telemetry';
import { AdaptiveFlowOverlay } from './AdaptiveFlowOverlay';
import { LiveAnnouncement } from './LiveAnnouncement';
import { PageNavigator } from './PageNavigator';
import { ZoomControls } from './ZoomControls';

interface ReaderViewProps {
  publication: Publication;
  profile: ReadingProfile;
  announcement: string;
  onBack: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleSettings: () => void;
  onToggleFullscreen: () => void;
  onFlowCorrected: () => void;
  onFlowManualRoute: () => void;
  nativeRuntime: boolean;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
  bookmarks: Bookmark[];
  readerState?: ReaderState;
  onSaveReaderState: (state: ReaderState) => void;
  onSelectPage: (pageIndex: number) => void;
  onToggleBookmark: (pageId: string) => void;
  onUpdateBookmarkLabel?: (pageId: string, label: string) => void;
  navigatorVisible: boolean;
  navigatorTriggerRef: RefObject<HTMLButtonElement | null>;
  onToggleNavigator: () => void;
  onCloseNavigator: () => void;
  onRegisterTurnRequest?: (request: ((delta: number) => void) | null) => void;
}

function pageAspect(page?: PageDescriptor): number {
  if (!page || page.width <= 0 || page.height <= 0) {
    return 0.705;
  }

  return page.width / page.height;
}

function PageSheet({ page, className = '' }: { page: PageDescriptor; className?: string }) {
  const aspectRatio = page.width > 0 && page.height > 0 ? `${page.width} / ${page.height}` : undefined;
  return (
    <article className={`page-sheet ${className}`} aria-label={t('reader.page', { page: page.index + 1 })} style={{ aspectRatio }}>
      <img src={page.src} alt={t('navigator.pageAlt', { name: page.name, page: page.index + 1 })} draggable={false} />
      <span className="page-folio">{String(page.index + 1).padStart(2, '0')}</span>
    </article>
  );
}

export function ReaderView({
  publication,
  profile,
  announcement,
  onBack,
  onNext,
  onPrevious,
  onToggleSettings,
  onToggleFullscreen,
  onFlowCorrected,
  onFlowManualRoute,
  nativeRuntime,
  settingsTriggerRef,
  bookmarks,
  readerState,
  onSaveReaderState,
  onSelectPage,
  onToggleBookmark,
  onUpdateBookmarkLabel,
  navigatorVisible,
  navigatorTriggerRef,
  onToggleNavigator,
  onCloseNavigator,
  onRegisterTurnRequest,
}: ReaderViewProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const turnTimerRef = useRef<number | undefined>(undefined);
  const turnRequestRef = useRef<(delta: number) => void>(() => undefined);
  const previousPageRef = useRef(publication.currentPage);
  const [dragProgress, setDragProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [turnPhase, setTurnPhase] = useState<PageTurnPhase>('idle');
  const [pageChangeDirection, setPageChangeDirection] = useState<'forward' | 'backward' | null>(null);
  const [flowVisible, setFlowVisible] = useState(false);
  const [localReaderState, setLocalReaderState] = useState<ReaderState>(() => normalizeReaderState(readerState ?? defaultReaderState));
  const [panDragging, setPanDragging] = useState(false);
  const spaceHeldRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const skipNextStateSaveRef = useRef(true);
  const [rendererStatus, setRendererStatus] = useState<RendererStatus>({ backend: 'static', quality: 'essential' });
  const visibleIndexes = visiblePageIndexes(publication.currentPage, publication.pages, profile.mode, profile.direction);
  const visiblePages = visibleIndexes.map((index) => publication.pages[index]).filter(Boolean);
  const currentPage = publication.pages[publication.currentPage];
  const readerCounter = publication.pages.length === 0
    ? t('navigator.noPages')
    : pageCounter(publication.currentPage, publication.pages.length);
  const preloadPages = [publication.currentPage - 1, publication.currentPage, publication.currentPage + 1]
    .map((index) => publication.pages[index])
    .filter((page): page is PageDescriptor => Boolean(page));
  const currentPageSlot = Math.max(visiblePages.findIndex((page) => page.id === currentPage?.id), 0);
  const pageSlotCount = Math.max(visiblePages.length, 1);
  const pageSlotWidth = 100 / pageSlotCount;
  const spreadAspect = Math.max(visiblePages.reduce((sum, page) => sum + pageAspect(page), 0), 0.1);
  const { canNext, canPrevious } = navigationAvailability(
    publication.currentPage,
    publication.pages.length,
    profile.direction,
  );
  const safeReaderState = useMemo(() => normalizeReaderState(localReaderState), [localReaderState]);
  const rendererAnnouncement = useMemo(() => rendererStatusMessage(rendererStatus), [rendererStatus]);
  const manualScale = safeReaderState.zoomMode === 'manual' ? clampZoomScale(safeReaderState.zoomScale) : 1;
  const effectiveScale = safeReaderState.zoomMode === 'width' ? 1.16 : manualScale;
  const canPan = safeReaderState.zoomMode === 'manual' && manualScale > 1;
  const currentBookmarked = Boolean(currentPage && bookmarks.some((bookmark) => bookmark.pageId === currentPage.id));

  useEffect(() => {
    const nextState = normalizeReaderState(readerState ?? defaultReaderState);
    setLocalReaderState((current) => {
      if (
        current.zoomMode === nextState.zoomMode
        && current.zoomScale === nextState.zoomScale
        && current.panX === nextState.panX
        && current.panY === nextState.panY
      ) {
        return current;
      }
      skipNextStateSaveRef.current = true;
      return nextState;
    });
  }, [publication.id, readerState]);

  useEffect(() => {
    if (skipNextStateSaveRef.current) {
      skipNextStateSaveRef.current = false;
      return;
    }
    onSaveReaderState(safeReaderState);
  }, [onSaveReaderState, safeReaderState]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        spaceHeldRef.current = true;
      }
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceHeldRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!nativeRuntime) {
      return;
    }
    const ids = [publication.currentPage - 1, publication.currentPage, publication.currentPage + 1]
      .map((index) => publication.pages[index]?.id)
      .filter((id): id is string => Boolean(id));
    void touchNativePages(publication.id, ids).catch(() => undefined);
  }, [nativeRuntime, publication.currentPage, publication.id, publication.pages]);
  const { graph: flowGraph, state: flowState, swapOrder, useManualRoute } = useAdaptiveFlow({
    publicationId: publication.id,
    page: currentPage,
    direction: profile.direction,
    nativeRuntime,
  });

  useEffect(() => {
    if (previousPageRef.current === publication.currentPage) {
      return undefined;
    }

    const previousPage = previousPageRef.current;
    previousPageRef.current = publication.currentPage;
    const movedForward = profile.direction === 'rtl'
      ? publication.currentPage < previousPage
      : publication.currentPage > previousPage;
    setPageChangeDirection(movedForward ? 'forward' : 'backward');
    const timer = window.setTimeout(() => setPageChangeDirection(null), 280);
    return () => window.clearTimeout(timer);
  }, [profile.direction, publication.currentPage]);

  useEffect(() => () => {
    if (turnTimerRef.current !== undefined) {
      window.clearTimeout(turnTimerRef.current);
    }
  }, []);

  const isFlowInteraction = (event: PointerEvent<HTMLDivElement>) => (
    event.target instanceof Element && Boolean(event.target.closest('[data-flow-control], [data-reader-control]'))
  );

  const turnRect = () => {
    const bounds = paperRef.current?.getBoundingClientRect();
    if (!bounds) {
      return undefined;
    }

    const slotWidth = bounds.width / pageSlotCount;
    const left = bounds.left + currentPageSlot * slotWidth;
    return {
      left,
      right: left + slotWidth,
      top: bounds.top,
      bottom: bounds.bottom,
      width: slotWidth,
      height: bounds.height,
    };
  };

  const isTurnCorner = (event: PointerEvent<HTMLDivElement>) => {
    const rect = turnRect();
    if (!rect) {
      return false;
    }

    const edgeReach = Math.min(150, Math.max(72, rect.width * 0.22));
    const bottomReach = Math.min(180, Math.max(90, rect.height * 0.22));
    const fromReadingEdge = profile.direction === 'rtl'
      ? event.clientX - rect.left
      : rect.right - event.clientX;
    const fromBottom = rect.bottom - event.clientY;
    return fromReadingEdge >= -8
      && fromReadingEdge <= edgeReach
      && fromBottom >= -8
      && fromBottom <= bottomReach;
  };

  const progressFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = turnRect();
    if (!rect) {
      return 0;
    }

    const distance = profile.direction === 'rtl' ? event.clientX - rect.left : rect.right - event.clientX;
    return clamp(distance / Math.max(rect.width * 0.72, 1), 0, 1);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isFlowInteraction(event)) {
      return;
    }

    if (event.button === 0 && canPan && spaceHeldRef.current && turnPhase === 'idle') {
      event.currentTarget.setPointerCapture(event.pointerId);
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        panX: safeReaderState.panX,
        panY: safeReaderState.panY,
      };
      setPanDragging(true);
      return;
    }

    if (
      event.button !== 0
      || turnPhase !== 'idle'
      || isFlowInteraction(event)
      || !isTurnCorner(event)
    ) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setTurnPhase('dragging');
    setDragProgress(progressFromPointer(event));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (panDragging) {
      const start = panStartRef.current;
      const next = clampPan(
        start.panX + event.clientX - start.x,
        start.panY + event.clientY - start.y,
        manualScale,
        160,
        120,
      );
      setLocalReaderState((current) => ({ ...current, panX: next.x, panY: next.y }));
      return;
    }

    if (turnPhase !== 'dragging' || !dragging || isFlowInteraction(event)) {
      return;
    }

    setDragProgress(progressFromPointer(event));
  };

  const requestTurn = (delta: number, phaseOverride?: PageTurnPhase, notifyBoundary = true) => {
    if (delta === 0) {
      return;
    }

    const available = delta > 0 ? canNext : canPrevious;
    const decision = resolvePageTurn(
      phaseOverride ?? turnPhase,
      available,
      profile.reducedMotion,
      profile.pageTurnDuration,
    );
    if (decision.kind === 'ignored') {
      return;
    }

    const callback = delta > 0 ? onNext : onPrevious;
    const shouldNotify = decision.kind === 'commit' || (notifyBoundary && !available);
    const finish = () => {
      if (shouldNotify) {
        callback();
      }
      setTurnPhase('idle');
      setDragProgress(0);
      turnTimerRef.current = undefined;
    };

    if (turnTimerRef.current !== undefined) {
      window.clearTimeout(turnTimerRef.current);
      turnTimerRef.current = undefined;
    }

    setDragging(false);
    setTurnPhase(decision.kind === 'commit' ? 'committing' : 'cancelling');
    setDragProgress(decision.kind === 'commit' ? 1 : 0);
    if (decision.immediate) {
      finish();
      return;
    }

    turnTimerRef.current = window.setTimeout(finish, decision.duration);
  };

  turnRequestRef.current = (delta: number) => requestTurn(delta);

  useEffect(() => {
    if (!onRegisterTurnRequest) {
      return undefined;
    }

    onRegisterTurnRequest((delta) => turnRequestRef.current(delta));
    return () => onRegisterTurnRequest(null);
  }, [onRegisterTurnRequest]);

  const finishDrag = (commit: boolean) => {
    if (turnPhase !== 'dragging') {
      return;
    }

    if (turnTimerRef.current !== undefined) {
      window.clearTimeout(turnTimerRef.current);
    }
    const shouldCommit = commit && canNext;
    setDragging(false);

    if (shouldCommit) {
      setTurnPhase('idle');
      setDragProgress(0);
      requestTurn(1, 'idle', false);
      return;
    }

    if (commit && !canNext) {
      requestTurn(1, 'idle');
      return;
    }

    setTurnPhase(shouldCommit ? 'committing' : 'cancelling');
    setDragProgress(shouldCommit ? 1 : 0);
    if (profile.reducedMotion) {
      setTurnPhase('idle');
      setDragProgress(0);
      return;
    }
    turnTimerRef.current = window.setTimeout(() => {
      setTurnPhase('idle');
      setDragProgress(0);
      turnTimerRef.current = undefined;
    }, Math.max(profile.pageTurnDuration, 160));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (panDragging) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPanDragging(false);
      return;
    }

    if (!dragging) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const commit = dragProgress >= 0.42;
    finishDrag(commit);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('[data-reader-control]')) {
      return;
    }
    if (Math.abs(event.deltaY) < 4) {
      return;
    }

    event.preventDefault();
    requestTurn(event.deltaY > 0 ? 1 : -1);
  };

  const changeZoomMode = (mode: ZoomMode) => {
    setLocalReaderState((current) => ({
      ...current,
      zoomMode: mode,
      zoomScale: mode === 'manual' ? clampZoomScale(current.zoomScale) : current.zoomScale,
      panX: mode === 'manual' ? current.panX : 0,
      panY: mode === 'manual' ? current.panY : 0,
    }));
  };

  const changeZoomScale = (scale: number) => {
    const nextScale = clampZoomScale(scale);
    setLocalReaderState((current) => {
      const pan = clampPan(current.panX, current.panY, nextScale, 160, 120);
      return { ...current, zoomMode: 'manual', zoomScale: nextScale, panX: pan.x, panY: pan.y };
    });
  };

  const resetPan = () => setLocalReaderState((current) => ({ ...current, panX: 0, panY: 0 }));

  const curlStyle = {
    '--turn-progress': dragProgress,
    '--turn-duration': `${profile.pageTurnDuration}ms`,
    '--turn-left': `${currentPageSlot * pageSlotWidth}%`,
    '--turn-width': `${pageSlotWidth}%`,
  } as CSSProperties;
  const turnHintStyle = {
    '--turn-hint-left': profile.direction === 'rtl' ? `${currentPageSlot * pageSlotWidth}%` : 'auto',
    '--turn-hint-right': profile.direction === 'ltr'
      ? `${100 - ((currentPageSlot + 1) * pageSlotWidth)}%`
      : 'auto',
  } as CSSProperties;
  const rendererFrame: RenderFrame = {
    pages: visiblePages,
    preloadPages,
    turningPageId: currentPage?.id,
    direction: profile.direction,
    mode: profile.mode,
    turnProgress: dragProgress,
    reducedMotion: profile.reducedMotion,
  };
  const correctFlowOrder = (firstId: string, secondId: string) => {
    swapOrder(firstId, secondId);
    onFlowCorrected();
  };
  const useManualFlowRoute = () => {
    useManualRoute();
    onFlowManualRoute();
  };
  const contentTransformStyle = {
    transform: `translate(${safeReaderState.panX}px, ${safeReaderState.panY}px) scale(${effectiveScale})`,
  } as CSSProperties;

  return (
    <main
      className={`reader-view reader-view--${profile.direction} ${profile.reducedMotion ? 'reader-view--reduced-motion' : ''}`}
      data-layout-zone={profile.layoutZone}
    >
      <header className="reader-topbar">
        <div className="reader-topbar-start">
          <button className="reader-back" data-testid="reader-back" onClick={onBack} aria-label={t('reader.back')}>← <span>{t('reader.library')}</span></button>
          <span className="reader-divider" aria-hidden="true" />
          <div className="reader-title">
            <span className="eyebrow">{t('reader.nowReading')}</span>
            <strong>{publication.title}</strong>
          </div>
        </div>
        <div className="reader-topbar-end">
          <span className="reader-counter" data-testid="reader-current-page" data-page-index={publication.currentPage}>{readerCounter}</span>
          <button
            className={`reader-tool reader-flow-toggle ${flowVisible ? 'reader-flow-toggle--active' : ''}`}
            type="button"
            onClick={() => setFlowVisible((current) => !current)}
            aria-pressed={flowVisible}
            aria-label={flowVisible ? t('reader.hideGuidance') : t('reader.showGuidance')}
          >
            <span className="reader-tool-label">{t('reader.flow')}</span>
            <span className="reader-tool-symbol" aria-hidden="true">↘</span>
          </button>
          <button
            className={`reader-tool ${navigatorVisible ? 'reader-tool--active' : ''}`}
            type="button"
            ref={navigatorTriggerRef}
            onClick={onToggleNavigator}
            aria-pressed={navigatorVisible}
            aria-label={navigatorVisible ? t('reader.hideNavigator') : t('reader.showNavigator')}
            data-reader-control
          >
            <span className="reader-tool-label">{t('reader.pages')}</span>
            <span className="reader-tool-symbol" aria-hidden="true">▦</span>
          </button>
          <button
            className={`reader-tool ${currentBookmarked ? 'reader-tool--active' : ''}`}
            type="button"
            onClick={() => currentPage && onToggleBookmark(currentPage.id)}
            aria-pressed={currentBookmarked}
            aria-label={currentBookmarked ? t('reader.removeCurrentBookmark') : t('reader.bookmarkCurrent')}
            data-reader-control
          >
            <span className="reader-tool-label">{t('reader.bookmark')}</span>
            <span className="reader-tool-symbol" aria-hidden="true">{currentBookmarked ? '◆' : '◇'}</span>
          </button>
          <button className="reader-tool" data-testid="reader-fullscreen" onClick={onToggleFullscreen} aria-label={t('reader.fullscreen')}>
            <span className="reader-tool-label">{t('reader.fullscreen')}</span>
            <span className="reader-tool-symbol" aria-hidden="true">↗</span>
          </button>
          <button ref={settingsTriggerRef} className="reader-tool" onClick={onToggleSettings} aria-label={t('reader.settings')}>
            <span className="reader-tool-label">{t('reader.settings')}</span>
            <span className="reader-tool-symbol" aria-hidden="true">⌘</span>
          </button>
        </div>
      </header>

      {navigatorVisible && (
        <PageNavigator
          pages={publication.pages}
          currentPage={publication.currentPage}
          bookmarks={bookmarks}
          onSelectPage={onSelectPage}
          onToggleBookmark={onToggleBookmark}
          onUpdateBookmarkLabel={onUpdateBookmarkLabel}
          triggerRef={navigatorTriggerRef}
          onClose={onCloseNavigator}
        />
      )}

      <section
        className={`reading-stage reading-stage--${profile.mode} ${dragging ? 'reading-stage--dragging' : ''} ${turnPhase !== 'idle' ? `reading-stage--turn-${turnPhase}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (panDragging) {
            setPanDragging(false);
          } else {
            finishDrag(false);
          }
        }}
        onWheel={onWheel}
        data-testid="reader-stage"
        aria-label={t('reader.canvas')}
      >
        <div className="stage-caption stage-caption--left">{profile.direction === 'rtl' ? t('reader.rightToLeft') : t('reader.leftToRight')}</div>
        <div className="stage-caption stage-caption--right">{profile.mode === 'spread' ? t('reader.spreadView') : t('reader.singlePage')}</div>

        <ZoomControls
          mode={safeReaderState.zoomMode}
          scale={safeReaderState.zoomScale}
          onModeChange={changeZoomMode}
          onScaleChange={changeZoomScale}
          onResetPan={resetPan}
        />

        <div
          className={`paper-spread paper-spread--${profile.mode} ${pageChangeDirection ? `paper-spread--page-enter-${pageChangeDirection}` : ''}`}
          ref={paperRef}
          style={{ '--spread-aspect': spreadAspect } as CSSProperties}
        >
          <div className="reader-content-transform" style={contentTransformStyle} data-reader-content>
            <ReaderSurface
              frame={rendererFrame}
              ariaLabel={t('reader.pageReady', { counter: readerCounter })}
              onStatus={setRendererStatus}
              interactionActive={turnPhase !== 'idle'}
              staticContent={(
                <>
                  {visiblePages.map((page) => <PageSheet page={page} key={page.id} />)}
                  {currentPage && turnPhase !== 'idle' && (
                    <div
                      className={`curl-layer curl-layer--${profile.direction}`}
                      style={curlStyle}
                      aria-hidden="true"
                    >
                      <PageSheet page={currentPage} />
                      <span className="curl-glint" />
                    </div>
                  )}
                </>
              )}
            />
            <AdaptiveFlowOverlay
              graph={flowGraph}
              isAnalyzing={flowState === 'analyzing'}
              visible={flowVisible}
              pageSlot={Math.max(currentPageSlot, 0)}
              pageCount={visiblePages.length}
              onSwap={correctFlowOrder}
              onUseManualRoute={useManualFlowRoute}
            />
          </div>
          <div className="corner-hint" style={turnHintStyle} aria-hidden="true">
            <span className="corner-line" />
          <span>{t('reader.dragCorner')}</span>
          </div>
        </div>
        <p className="stage-note">
          {profile.reducedMotion
            ? t('reader.reducedMotion')
            : rendererAnnouncement.message}
        </p>
        <LiveAnnouncement
          message={rendererAnnouncement.message}
          testId="renderer-status-announcement"
        />
        <p className="sr-only" data-testid="renderer-diagnostic">
          {rendererAnnouncement.diagnostic}
        </p>
        <details className="renderer-diagnostic-panel">
          <summary>{t('reader.rendererDiagnostics')}</summary>
          <code>{rendererAnnouncement.diagnostic}</code>
        </details>
      </section>

      <footer className="reader-controls">
        <button className="nav-button" data-testid="reader-previous" onClick={() => requestTurn(-1)} aria-disabled={!canPrevious} aria-label={t('reader.previousAria')}>← <span>{t('reader.previous')}</span></button>
        <div className="reader-progress" aria-label={t('reader.percentRead', { percent: Math.round(publication.progress * 100) })}>
          <div className="progress-track"><span style={{ width: `${publication.progress * 100}%` }} /></div>
          <span>{t('reader.percentComplete', { percent: Math.round(publication.progress * 100) })}</span>
        </div>
        <button className="nav-button nav-button--forward" data-testid="reader-next" onClick={() => requestTurn(1)} aria-disabled={!canNext} aria-label={t('reader.nextAria')}><span>{t('reader.next')}</span> →</button>
      </footer>

      <p className="reader-announcement" data-testid="reader-announcement" aria-hidden="true">{announcement}</p>
    </main>
  );
}
