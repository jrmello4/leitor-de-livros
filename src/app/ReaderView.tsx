import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, WheelEvent } from 'react';
import { pageCounter, visiblePageIndexes, clamp } from '../domain/reader';
import type { PageDescriptor, Publication, ReadingProfile } from '../domain/types';
import { useAdaptiveFlow } from '../flow/useAdaptiveFlow';
import { ReaderSurface } from '../rendering/ReaderSurface';
import type { RenderFrame, RendererStatus } from '../rendering/contracts';
import { AdaptiveFlowOverlay } from './AdaptiveFlowOverlay';

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
  nativeRuntime: boolean;
}

type TurnPhase = 'idle' | 'dragging' | 'committing' | 'cancelling';

function pageAspect(page?: PageDescriptor): number {
  if (!page || page.width <= 0 || page.height <= 0) {
    return 0.705;
  }

  return page.width / page.height;
}

function PageSheet({ page, className = '' }: { page: PageDescriptor; className?: string }) {
  const aspectRatio = page.width > 0 && page.height > 0 ? `${page.width} / ${page.height}` : undefined;
  return (
    <article className={`page-sheet ${className}`} aria-label={`Page ${page.index + 1}`} style={{ aspectRatio }}>
      <img src={page.src} alt={`${page.name}, page ${page.index + 1}`} draggable={false} />
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
  nativeRuntime,
}: ReaderViewProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const turnTimerRef = useRef<number | undefined>(undefined);
  const previousPageRef = useRef(publication.currentPage);
  const [dragProgress, setDragProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('idle');
  const [pageChangeDirection, setPageChangeDirection] = useState<'forward' | 'backward' | null>(null);
  const [flowVisible, setFlowVisible] = useState(false);
  const [rendererStatus, setRendererStatus] = useState<RendererStatus>({ backend: 'static', quality: 'essential' });
  const visibleIndexes = visiblePageIndexes(publication.currentPage, publication.pages, profile.mode, profile.direction);
  const visiblePages = visibleIndexes.map((index) => publication.pages[index]).filter(Boolean);
  const currentPage = publication.pages[publication.currentPage];
  const preloadPages = [publication.currentPage - 1, publication.currentPage, publication.currentPage + 1]
    .map((index) => publication.pages[index])
    .filter((page): page is PageDescriptor => Boolean(page));
  const currentPageSlot = Math.max(visiblePages.findIndex((page) => page.id === currentPage?.id), 0);
  const pageSlotCount = Math.max(visiblePages.length, 1);
  const pageSlotWidth = 100 / pageSlotCount;
  const spreadAspect = Math.max(visiblePages.reduce((sum, page) => sum + pageAspect(page), 0), 0.1);
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
    event.target instanceof Element && Boolean(event.target.closest('[data-flow-control]'))
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
    if (
      event.button !== 0
      || profile.reducedMotion
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
    if (turnPhase !== 'dragging' || !dragging || isFlowInteraction(event)) {
      return;
    }

    setDragProgress(progressFromPointer(event));
  };

  const finishDrag = (commit: boolean) => {
    if (turnPhase !== 'dragging') {
      return;
    }

    if (turnTimerRef.current !== undefined) {
      window.clearTimeout(turnTimerRef.current);
    }
    const canAdvance = profile.direction === 'rtl'
      ? publication.currentPage > 0
      : publication.currentPage < publication.pages.length - 1;
    const shouldCommit = commit && canAdvance;
    setDragging(false);
    setTurnPhase(shouldCommit ? 'committing' : 'cancelling');
    setDragProgress(shouldCommit ? 1 : 0);
    turnTimerRef.current = window.setTimeout(() => {
      if (shouldCommit) {
        onNext();
      }
      setTurnPhase('idle');
      setDragProgress(0);
      turnTimerRef.current = undefined;
    }, Math.max(profile.pageTurnDuration, 160));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const commit = dragProgress >= 0.42;
    const canAdvance = profile.direction === 'rtl'
      ? publication.currentPage > 0
      : publication.currentPage < publication.pages.length - 1;
    if (commit && !canAdvance) {
      onNext();
    }
    finishDrag(commit);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) < 4) {
      return;
    }

    event.preventDefault();
    if (event.deltaY > 0) {
      onNext();
    } else {
      onPrevious();
    }
  };

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
  const rendererLabel = rendererStatus.backend === 'webgpu'
    ? 'GPU'
    : rendererStatus.backend === 'webgl2'
      ? 'GL'
      : 'PAGE';
  const correctFlowOrder = (firstId: string, secondId: string) => {
    swapOrder(firstId, secondId);
    onFlowCorrected();
  };
  const useManualFlowRoute = () => {
    useManualRoute();
    onFlowCorrected();
  };

  return (
    <main
      className={`reader-view reader-view--${profile.direction} ${profile.reducedMotion ? 'reader-view--reduced-motion' : ''}`}
      data-renderer={rendererStatus.backend}
    >
      <header className="reader-topbar">
        <div className="reader-topbar-start">
          <button className="reader-back" onClick={onBack} aria-label="Back to library">← <span>Library</span></button>
          <span className="reader-divider" aria-hidden="true" />
          <div className="reader-title">
            <span className="eyebrow">NOW READING</span>
            <strong>{publication.title}</strong>
          </div>
        </div>
        <div className="reader-topbar-end">
          <span
            className="renderer-mark"
            title={rendererStatus.fallbackReason ?? `Render backend: ${rendererStatus.backend}`}
            aria-label={`Render backend: ${rendererStatus.backend}${rendererStatus.fps ? `, ${rendererStatus.fps} frames per second` : ''}`}
          >
            {rendererLabel}
          </span>
          <span className="reader-counter">{pageCounter(publication.currentPage, publication.pages.length)}</span>
          <button
            className={`reader-tool reader-flow-toggle ${flowVisible ? 'reader-flow-toggle--active' : ''}`}
            type="button"
            onClick={() => setFlowVisible((current) => !current)}
            aria-pressed={flowVisible}
          >
            Flow <span aria-hidden="true">↘</span>
          </button>
          <button className="reader-tool" onClick={onToggleFullscreen}>Fullscreen <span aria-hidden="true">↗</span></button>
          <button className="reader-tool" onClick={onToggleSettings}>Settings <span aria-hidden="true">⌘</span></button>
        </div>
      </header>

      <section
        className={`reading-stage reading-stage--${profile.mode} ${dragging ? 'reading-stage--dragging' : ''} ${turnPhase !== 'idle' ? `reading-stage--turn-${turnPhase}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => finishDrag(false)}
        onWheel={onWheel}
        aria-label="Reading canvas. Drag the lower corner to turn the page."
      >
        <div className="stage-caption stage-caption--left">{profile.direction === 'rtl' ? 'RIGHT TO LEFT' : 'LEFT TO RIGHT'}</div>
        <div className="stage-caption stage-caption--right">{profile.mode === 'spread' ? 'SPREAD VIEW' : 'SINGLE PAGE'}</div>

        <div
          className={`paper-spread paper-spread--${profile.mode} ${pageChangeDirection ? `paper-spread--page-enter-${pageChangeDirection}` : ''}`}
          ref={paperRef}
          style={{ '--spread-aspect': spreadAspect } as CSSProperties}
        >
          <ReaderSurface
            frame={rendererFrame}
            ariaLabel={`${pageCounter(publication.currentPage, publication.pages.length)} rendered with ${rendererStatus.backend}`}
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
          <div className="corner-hint" style={turnHintStyle} aria-hidden="true">
            <span className="corner-line" />
            <span>DRAG A CORNER</span>
          </div>
        </div>
        <p className="stage-note">
          {profile.reducedMotion
            ? 'Reduced motion is on · use the controls below'
            : rendererStatus.backend === 'static'
              ? 'A static page is keeping this session accessible'
              : `${rendererStatus.backend === 'webgpu' ? 'GPU' : 'WebGL'} keeps motion within the frame budget`}
        </p>
      </section>

      <footer className="reader-controls">
        <button className="nav-button" onClick={onPrevious} aria-label="Previous page">← <span>Previous</span></button>
        <div className="reader-progress" aria-label={`${Math.round(publication.progress * 100)} percent read`}>
          <div className="progress-track"><span style={{ width: `${publication.progress * 100}%` }} /></div>
          <span>{Math.round(publication.progress * 100)}% complete</span>
        </div>
        <button className="nav-button nav-button--forward" onClick={onNext} aria-label="Next page"><span>Next</span> →</button>
      </footer>

      <p className="reader-announcement" aria-live="polite">{announcement}</p>
    </main>
  );
}
