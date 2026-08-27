import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, RefObject, WheelEvent } from 'react';
import { t } from '../i18n/catalog';
import { clamp, clampPan, clampZoomScale, navigationAvailability, pageCounter, visiblePageIndexes } from '../domain/reader';
import { defaultReaderState, nextRotation, normalizeReaderState } from '../domain/readerState';
import type { Bookmark, PageDescriptor, PageRotation, Publication, ReaderState, ReadingProfile, StageBackground, ZoomMode } from '../domain/types';
import { touchNativePages } from '../services/nativeLibrary';
import { useAdaptiveFlow } from '../flow/useAdaptiveFlow';
import { ReaderSurface } from '../rendering/ReaderSurface';
import type { RenderFrame, RendererStatus } from '../rendering/contracts';
import { PageTurnSurface } from '../rendering/pageTurn/PageTurnSurface';
import { rendererStatusMessage } from '../rendering/telemetry';
import { evaluateAchievements, isCurrentHourNight, type Achievement } from '../domain/achievements';
import { loadAchievementsMap, logReadingSessionActivity, saveAchievementsMap } from '../services/storage';
import { RecapModal } from './RecapModal';
import { AchievementToast } from './AchievementToast';
import { AdaptiveFlowOverlay } from './AdaptiveFlowOverlay';
import { LiveAnnouncement } from './LiveAnnouncement';
import { PageNavigator } from './PageNavigator';
import { usePageTurn } from './usePageTurn';
import { WebtoonReader } from './WebtoonReader';
import { ZoomControls } from './ZoomControls';
import { CollectorInfoModal } from './CollectorInfoModal';
import { BookOpenIcon, BookmarkFilledIcon, BookmarkIcon, CloseIcon, EyeIcon, EyeOffIcon, FullscreenIcon, InfoIcon, PinIcon, SettingsIcon, SlidersIcon, SparklesIcon } from './Icons';

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
  onNextVolume?: () => void;
  nextVolumeTitle?: string;
}

function pageAspect(page?: PageDescriptor): number {
  if (!page || page.width <= 0 || page.height <= 0) {
    return 0.705;
  }

  return page.width / page.height;
}

function PageSheet({
  page,
  className = '',
  onImageDimensions,
}: {
  page: PageDescriptor;
  className?: string;
  onImageDimensions?: (pageId: string, width: number, height: number) => void;
}) {
  const aspectRatio = page.width > 0 && page.height > 0 ? `${page.width} / ${page.height}` : undefined;
  return (
    <article className={`page-sheet ${className}`} aria-label={t('reader.page', { page: page.index + 1 })} style={{ aspectRatio }}>
      <img
        src={page.src}
        alt={t('navigator.pageAlt', { name: page.name, page: page.index + 1 })}
        draggable={false}
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            if (img.naturalWidth !== page.width || img.naturalHeight !== page.height) {
              onImageDimensions?.(page.id, img.naturalWidth, img.naturalHeight);
            }
          }
        }}
      />
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
  onNextVolume,
  nextVolumeTitle,
}: ReaderViewProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const previousPageRef = useRef(publication.currentPage);
  const [flowVisible, setFlowVisible] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [collectorInfoOpen, setCollectorInfoOpen] = useState(false);
  const [recapModalOpen, setRecapModalOpen] = useState(false);
  const [unlockedAchievementToast, setUnlockedAchievementToast] = useState<Achievement | null>(null);
  const [hudPinned, setHudPinned] = useState(false);
  const [hudVisible, setHudVisible] = useState(false);
  const hudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageDimensions, setPageDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [localReaderState, setLocalReaderState] = useState<ReaderState>(() => normalizeReaderState(readerState ?? defaultReaderState));
  const [panDragging, setPanDragging] = useState(false);
  const spaceHeldRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const skipNextStateSaveRef = useRef(true);
  const [rendererStatus, setRendererStatus] = useState<RendererStatus>({ backend: 'static', quality: 'essential' });

  // Track page reading habit and evaluate achievements
  const lastTrackedPageRef = useRef(publication.currentPage);
  useEffect(() => {
    if (lastTrackedPageRef.current !== publication.currentPage) {
      lastTrackedPageRef.current = publication.currentPage;
      const { stats } = logReadingSessionActivity({ pagesDelta: 1 });
      const achievementsMap = loadAchievementsMap();
      const completedCount = publication.progress >= 1 ? 1 : 0;
      const { newlyUnlocked, updatedUnlockedMap } = evaluateAchievements({
        stats,
        publicationCount: 1,
        completedCount,
        existingUnlockedMap: achievementsMap,
        isNightHour: isCurrentHourNight(),
      });
      if (newlyUnlocked.length > 0) {
        saveAchievementsMap(updatedUnlockedMap);
        setUnlockedAchievementToast(newlyUnlocked[0]);
      }
    }
  }, [publication.currentPage, publication.progress]);

  const isHudShowing = !chromeHidden && (hudVisible || hudPinned || zoomMenuOpen || navigatorVisible || collectorInfoOpen || recapModalOpen);

  const showHudTemporarily = useCallback((durationMs = 3000) => {
    setHudVisible(true);
    if (hudTimeoutRef.current) {
      clearTimeout(hudTimeoutRef.current);
    }
    if (!hudPinned && !zoomMenuOpen && !navigatorVisible && !collectorInfoOpen && !recapModalOpen) {
      hudTimeoutRef.current = setTimeout(() => {
        setHudVisible(false);
      }, durationMs);
    }
  }, [hudPinned, zoomMenuOpen, navigatorVisible, collectorInfoOpen, recapModalOpen]);

  useEffect(() => {
    if (hudPinned || zoomMenuOpen || navigatorVisible || collectorInfoOpen || recapModalOpen) {
      setHudVisible(true);
      if (hudTimeoutRef.current) {
        clearTimeout(hudTimeoutRef.current);
      }
    }
  }, [hudPinned, zoomMenuOpen, navigatorVisible, collectorInfoOpen, recapModalOpen]);

  const handleImageDimensions = (pageId: string, width: number, height: number) => {
    setPageDimensions((current) => {
      if (current[pageId]?.width === width && current[pageId]?.height === height) {
        return current;
      }
      return { ...current, [pageId]: { width, height } };
    });
  };

  const effectivePages = useMemo(() => {
    return publication.pages.map((page) => {
      const natural = pageDimensions[page.id];
      if (natural && (page.width !== natural.width || page.height !== natural.height)) {
        return { ...page, width: natural.width, height: natural.height };
      }
      return page;
    });
  }, [publication.pages, pageDimensions]);

  const visibleIndexes = visiblePageIndexes(publication.currentPage, effectivePages, profile.mode, profile.direction);
  const visiblePages = visibleIndexes.map((index) => effectivePages[index]).filter(Boolean);
  const currentPage = effectivePages[publication.currentPage];
  const readerCounter = publication.pages.length === 0
    ? t('navigator.noPages')
    : pageCounter(publication.currentPage, publication.pages.length);
  const preloadPages = [publication.currentPage - 1, publication.currentPage, publication.currentPage + 1, publication.currentPage + 2]
    .map((index) => effectivePages[index])
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
    preloadPages.forEach((page) => {
      if (!pageDimensions[page.id] && typeof Image !== 'undefined') {
        const img = new Image();
        img.src = page.src;
        img.onload = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            handleImageDimensions(page.id, img.naturalWidth, img.naturalHeight);
          }
        };
      }
    });
  }, [preloadPages, pageDimensions]);

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

  const isFlowInteraction = (event: PointerEvent<HTMLDivElement>) => (
    event.target instanceof Element && Boolean(event.target.closest('[data-flow-control], [data-reader-control]'))
  );

  const pageTurn = usePageTurn({
    publication,
    mode: profile.mode,
    readingDirection: profile.direction,
    reducedMotion: profile.reducedMotion,
    transformedPage: paperRef,
    zoom: {
      scale: effectiveScale,
      panX: safeReaderState.panX,
      panY: safeReaderState.panY,
    },
    canNext,
    canPrevious,
    onNext,
    onPrevious,
  });

  const { graph: flowGraph, state: flowState, swapOrder, useManualRoute, addPanel, removePanel } = useAdaptiveFlow({
    publicationId: publication.id,
    page: currentPage,
    direction: profile.direction,
    nativeRuntime,
    enabled: flowVisible,
  });

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) {
        return;
      }

      if (event.code === 'Space') {
        spaceHeldRef.current = true;
      }

      if ((event.key === 'i' || event.key === 'I')) {
        setCollectorInfoOpen((current) => !current);
      }
      if ((event.key === 'r' || event.key === 'R')) {
        setRecapModalOpen((current) => !current);
      }
      if ((event.key === 'v' || event.key === 'V')) {
        setZoomMenuOpen((current) => !current);
        setHudVisible(true);
      }
      if ((event.key === 'z' || event.key === 'Z' || event.key === 'h' || event.key === 'H')) {
        setChromeHidden((current) => !current);
      }
      if (event.key === 'Escape') {
        if (collectorInfoOpen) {
          setCollectorInfoOpen(false);
        } else if (recapModalOpen) {
          setRecapModalOpen(false);
        } else if (zoomMenuOpen) {
          setZoomMenuOpen(false);
        } else {
          setChromeHidden(false);
        }
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
  }, [collectorInfoOpen, zoomMenuOpen]);

  useEffect(() => {
    if (!nativeRuntime) {
      return;
    }
    const ids = [publication.currentPage - 1, publication.currentPage, publication.currentPage + 1]
      .map((index) => publication.pages[index]?.id)
      .filter((id): id is string => Boolean(id));
    void touchNativePages(publication.id, ids).catch(() => undefined);
  }, [nativeRuntime, publication.currentPage, publication.id, publication.pages]);

  const stageClickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isFlowInteraction(event)) {
      return;
    }

    if (event.button === 0 && canPan && pageTurn.state.phase === 'idle') {
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
      || pageTurn.state.phase === 'dragging'
      || pageTurn.state.phase === 'disabled'
    ) {
      return;
    }

    stageClickStartRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
    pageTurn.edgeProps.onPointerDown?.(event as never);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (panDragging) {
      const start = panStartRef.current;
      const paper = paperRef.current;
      const bounds = paper ? paper.getBoundingClientRect() : { width: 800, height: 1000 };
      const maxPanX = Math.max(0, ((manualScale - 1) * bounds.width) / 2 + 80);
      const maxPanY = Math.max(0, ((manualScale - 1) * bounds.height) / 2 + 80);
      const next = clampPan(
        start.panX + event.clientX - start.x,
        start.panY + event.clientY - start.y,
        manualScale,
        maxPanX,
        maxPanY,
      );
      setLocalReaderState((current) => ({ ...current, panX: next.x, panY: next.y }));
      return;
    }

    if (event.clientY <= 36 || event.clientY >= window.innerHeight - 44) {
      if (!isHudShowing) {
        showHudTemporarily(3000);
      }
    }

    if (isFlowInteraction(event)) {
      return;
    }

    pageTurn.edgeProps.onPointerMove?.(event as never);
  };

  useEffect(() => {
    if (!onRegisterTurnRequest) {
      return undefined;
    }

    onRegisterTurnRequest((delta) => pageTurn.requestTurn(delta));
    return () => onRegisterTurnRequest(null);
  }, [onRegisterTurnRequest, pageTurn.requestTurn]);

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (panDragging) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPanDragging(false);
      return;
    }

    if (pageTurn.state.phase === 'dragging') {
      pageTurn.edgeProps.onPointerUp?.(event as never);
      stageClickStartRef.current = null;
      return;
    }

    // Handle clicks and swipes on the reading stage
    if (event.button === 0 && !isFlowInteraction(event) && stageClickStartRef.current) {
      const start = stageClickStartRef.current;
      stageClickStartRef.current = null;
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const elapsed = performance.now() - start.time;

      // Horizontal swipe gesture
      if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5 && elapsed < 800) {
        const step = deltaX < 0
          ? (profile.direction === 'rtl' ? -1 : 1)
          : (profile.direction === 'rtl' ? 1 : -1);
        pageTurn.requestTurn(step);
        return;
      }

      // Tap / Click on left, right or center (when not zoomed in)
      if (Math.abs(deltaX) < 25 && Math.abs(deltaY) < 25 && elapsed < 600) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const clickX = event.clientX - bounds.left;
        const width = bounds.width;

        // Tapping the center 40% (between 30% and 70%) toggles HUD visibility
        if (clickX > width * 0.30 && clickX < width * 0.70) {
          setHudVisible((current) => !current);
          return;
        }

        const isRightSide = clickX >= width * 0.70;
        const step = isRightSide
          ? (profile.direction === 'rtl' ? -1 : 1)
          : (profile.direction === 'rtl' ? 1 : -1);
        pageTurn.requestTurn(step);
        return;
      }
    }

    pageTurn.edgeProps.onPointerUp?.(event as never);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isFlowInteraction(event as never)) {
      return;
    }

    if (safeReaderState.zoomScale > 1 || safeReaderState.zoomMode === 'manual') {
      setLocalReaderState((current) => ({
        ...current,
        zoomMode: 'page',
        zoomScale: 1,
        panX: 0,
        panY: 0,
      }));
    } else {
      const bounds = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - bounds.left - bounds.width / 2;
      const clickY = event.clientY - bounds.top - bounds.height / 2;
      const maxPanX = Math.max(0, 1.5 * bounds.width / 2);
      const maxPanY = Math.max(0, 1.5 * bounds.height / 2);
      setLocalReaderState((current) => ({
        ...current,
        zoomMode: 'manual',
        zoomScale: 2.5,
        panX: clamp(-clickX * 1.2, -maxPanX, maxPanX),
        panY: clamp(-clickY * 1.2, -maxPanY, maxPanY),
      }));
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('[data-reader-control], [data-flow-control]')) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.25 : -0.25;
      const nextScale = clampZoomScale(Number((manualScale + delta).toFixed(2)));
      setLocalReaderState((current) => ({
        ...current,
        zoomMode: 'manual',
        zoomScale: nextScale,
      }));
      return;
    }

    if (canPan) {
      event.preventDefault();
      const paper = paperRef.current;
      const bounds = paper ? paper.getBoundingClientRect() : { width: 800, height: 1000 };
      const maxPanX = Math.max(0, ((manualScale - 1) * bounds.width) / 2 + 80);
      const maxPanY = Math.max(0, ((manualScale - 1) * bounds.height) / 2 + 80);
      const panDeltaX = event.shiftKey ? -event.deltaY : -event.deltaX;
      const panDeltaY = event.shiftKey ? 0 : -event.deltaY;
      const next = clampPan(
        safeReaderState.panX + panDeltaX,
        safeReaderState.panY + panDeltaY,
        manualScale,
        maxPanX,
        maxPanY,
      );
      setLocalReaderState((current) => ({ ...current, panX: next.x, panY: next.y }));
      return;
    }

    if (Math.abs(event.deltaY) < 4) {
      return;
    }

    event.preventDefault();
    pageTurn.requestTurn(event.deltaY > 0 ? 1 : -1);
  };

  useEffect(() => {
    const onAuxClick = (event: globalThis.MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        onPrevious();
      } else if (event.button === 4) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener('auxclick', onAuxClick);
    return () => window.removeEventListener('auxclick', onAuxClick);
  }, [onNext, onPrevious]);

  const rotateClockwise = () => {
    const next = nextRotation(safeReaderState.rotation);
    setLocalReaderState((current) => ({ ...current, rotation: next }));
  };

  const changeBackground = (background: StageBackground) => {
    setLocalReaderState((current) => ({ ...current, background }));
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

  const turnHintStyle = {
    '--turn-hint-left': profile.direction === 'rtl' ? `${currentPageSlot * pageSlotWidth}%` : 'auto',
    '--turn-hint-right': profile.direction === 'ltr'
      ? `${100 - ((currentPageSlot + 1) * pageSlotWidth)}%`
      : 'auto',
  } as CSSProperties;
  const rendererFrame: RenderFrame = {
    pages: visiblePages,
    preloadPages,
    direction: profile.direction,
    mode: profile.mode,
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
    transform: `translate(${safeReaderState.panX}px, ${safeReaderState.panY}px) scale(${effectiveScale}) rotate(${safeReaderState.rotation ?? 0}deg)`,
    transition: panDragging ? 'none' : 'transform 200ms ease-out',
  } as CSSProperties;

  useEffect(() => {
    if (previousPageRef.current !== publication.currentPage) {
      previousPageRef.current = publication.currentPage;
      pageTurn.acknowledgeNavigation();
    }
  }, [pageTurn.acknowledgeNavigation, publication.currentPage]);

  // The renderer status is refreshed on every frame sample, so folding the
  // page-turn failure into it meant the reason vanished before anyone could
  // read it. It is kept alongside instead, and stays until a turn succeeds.
  const [foldFailure, setFoldFailure] = useState<string>();
  useEffect(() => {
    if (pageTurn.failure) {
      setFoldFailure(`page-turn ${pageTurn.failure.reason}: ${pageTurn.failure.diagnostic}`);
    }
  }, [pageTurn.failure]);
  useEffect(() => {
    if (pageTurn.state.phase === 'committed') {
      setFoldFailure(undefined);
    }
  }, [pageTurn.state.phase]);

  return (
    <main
      className={`reader-view ${!isHudShowing ? 'reader-view--hud-hidden reader-view--zen' : ''} reader-view--${profile.direction} ${profile.reducedMotion ? 'reader-view--reduced-motion' : ''}`}
      data-layout-zone={profile.layoutZone}
    >
      <header
        className={`reader-topbar ${!isHudShowing ? 'reader-topbar--hidden' : ''}`}
        onMouseEnter={() => {
          setHudVisible(true);
          if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
        }}
        onMouseLeave={() => {
          if (!hudPinned && !zoomMenuOpen && !navigatorVisible) {
            showHudTemporarily(2000);
          }
        }}
      >
        <div className="reader-topbar-start">
          <button className="reader-back" data-testid="reader-back" data-reader-control onClick={onBack} aria-label={t('reader.back')}>← <span>{t('reader.library')}</span></button>
          <span className="reader-divider" aria-hidden="true" />
          <div className="reader-title">
            <span className="eyebrow">{t('reader.nowReading')}</span>
            <strong>{publication.title}</strong>
          </div>
        </div>
        {/* The status echo lives in the top bar's free middle. */}
        <p className="reader-announcement" data-testid="reader-announcement" aria-hidden="true">{announcement}</p>

        <div className="reader-topbar-end">
          <span className="reader-counter" data-testid="reader-current-page" data-page-index={publication.currentPage}>{readerCounter}</span>
          <button
            className={`reader-tool reader-flow-toggle ${flowVisible ? 'reader-flow-toggle--active' : ''}`}
            type="button"
            onClick={() => setFlowVisible((current) => !current)}
            aria-pressed={flowVisible}
            aria-label={flowVisible ? t('reader.hideGuidance') : t('reader.showGuidance')}
            data-reader-control
          >
            <span className="reader-tool-label">{t('reader.flow')}</span>
            <span className="reader-tool-symbol" aria-hidden="true">↘</span>
          </button>
          <button
            className={`reader-tool ${zoomMenuOpen ? 'reader-tool--active' : ''}`}
            type="button"
            onClick={() => {
              setZoomMenuOpen((current) => !current);
              setHudVisible(true);
            }}
            aria-pressed={zoomMenuOpen}
            aria-label="Ajustes de Zoom e Visual"
            title="Ajustes de Zoom e Visual (V)"
            data-reader-control
          >
            <SlidersIcon />
            <span className="reader-tool-label">Zoom</span>
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
            <BookOpenIcon />
            <span className="reader-tool-label">{t('reader.pages')}</span>
          </button>
          <button
            className={`reader-tool ${recapModalOpen ? 'reader-tool--active' : ''}`}
            type="button"
            onClick={() => setRecapModalOpen((current) => !current)}
            aria-pressed={recapModalOpen}
            aria-label={t('recap.title')}
            title={`${t('recap.title')} (R)`}
            data-reader-control
          >
            <SparklesIcon />
            <span className="reader-tool-label">Recap</span>
          </button>
          <button
            className={`reader-tool ${collectorInfoOpen ? 'reader-tool--active' : ''}`}
            type="button"
            onClick={() => setCollectorInfoOpen((current) => !current)}
            aria-pressed={collectorInfoOpen}
            aria-label={t('reader.collectorInfo')}
            title={`${t('reader.collectorInfo')} (I)`}
            data-reader-control
          >
            <InfoIcon />
            <span className="reader-tool-label">{t('reader.collectorInfo')}</span>
          </button>
          <button
            className={`reader-tool ${currentBookmarked ? 'reader-tool--active' : ''}`}
            type="button"
            onClick={() => currentPage && onToggleBookmark(currentPage.id)}
            aria-pressed={currentBookmarked}
            aria-label={currentBookmarked ? t('reader.removeCurrentBookmark') : t('reader.bookmarkCurrent')}
            data-reader-control
          >
            {currentBookmarked ? <BookmarkFilledIcon /> : <BookmarkIcon />}
            <span className="reader-tool-label">{t('reader.bookmark')}</span>
          </button>
          <button
            className={`reader-tool ${hudPinned ? 'reader-tool--active' : ''}`}
            type="button"
            onClick={() => setHudPinned((current) => !current)}
            aria-pressed={hudPinned}
            aria-label={hudPinned ? "HUD Fixado" : "Auto-ocultar"}
            title={hudPinned ? "Barras fixas (clique para ocultar automático)" : "Fixar barras na tela"}
            data-reader-control
          >
            <PinIcon />
            <span className="reader-tool-label">{hudPinned ? "Fixado" : "Auto-ocultar"}</span>
          </button>
          <button
            className={`reader-tool ${chromeHidden ? 'reader-tool--active' : ''}`}
            type="button"
            onClick={() => setChromeHidden((current) => !current)}
            aria-pressed={chromeHidden}
            aria-label={t('reader.zenMode')}
            title={`${t('reader.zenMode')} (Z)`}
            data-reader-control
          >
            {chromeHidden ? <EyeIcon /> : <EyeOffIcon />}
            <span className="reader-tool-label">{t('reader.zenMode')}</span>
          </button>
          <button className="reader-tool" data-testid="reader-fullscreen" data-reader-control onClick={onToggleFullscreen} aria-label={t('reader.fullscreen')}>
            <FullscreenIcon />
            <span className="reader-tool-label">{t('reader.fullscreen')}</span>
          </button>
          <button ref={settingsTriggerRef} className="reader-tool" data-reader-control onClick={onToggleSettings} aria-label={t('reader.settings')}>
            <SettingsIcon />
            <span className="reader-tool-label">{t('reader.settings')}</span>
          </button>
        </div>
      </header>

      {zoomMenuOpen && (
        <div className="zoom-controls-floating-wrapper" data-reader-control>
          <ZoomControls
            mode={safeReaderState.zoomMode}
            scale={safeReaderState.zoomScale}
            rotation={safeReaderState.rotation}
            background={safeReaderState.background}
            onModeChange={changeZoomMode}
            onScaleChange={changeZoomScale}
            onResetPan={resetPan}
            onRotate={rotateClockwise}
            onBackgroundChange={changeBackground}
            onClose={() => setZoomMenuOpen(false)}
          />
        </div>
      )}

      {collectorInfoOpen && (
        <CollectorInfoModal
          publication={publication}
          onClose={() => setCollectorInfoOpen(false)}
        />
      )}

      {recapModalOpen && (
        <RecapModal
          publication={publication}
          currentPageIndex={publication.currentPage}
          onClose={() => setRecapModalOpen(false)}
        />
      )}

      <AchievementToast
        achievement={unlockedAchievementToast}
        onDismiss={() => setUnlockedAchievementToast(null)}
      />

      {chromeHidden && (
        <button
          type="button"
          className="reader-zen-restore-btn"
          onClick={() => {
            setChromeHidden(false);
            setHudVisible(true);
          }}
          aria-label={t('reader.showControls')}
          title={`${t('reader.showControls')} (Z)`}
          data-reader-control
        >
          <EyeIcon />
          <span>{t('reader.showControls')}</span>
        </button>
      )}

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
        className={`reading-stage reading-stage--${profile.mode} reading-stage--bg-${safeReaderState.background ?? 'atelier'} ${pageTurn.state.phase === 'dragging' ? 'reading-stage--dragging' : ''} ${pageTurn.state.phase !== 'idle' ? `reading-stage--turn-${pageTurn.state.phase}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerCancel={() => {
          if (panDragging) {
            setPanDragging(false);
          } else {
            pageTurn.edgeProps.onPointerCancel?.();
          }
        }}
        onWheel={onWheel}
        data-testid="reader-stage"
        data-turn-phase={pageTurn.state.phase}
        data-turn-direction={profile.direction}
        data-turn-progress={pageTurn.surfaceInput?.progress ?? 0}
        aria-label={t('reader.canvas')}
      >
        {profile.mode === 'webtoon' ? (
          <WebtoonReader
            publication={publication}
            currentPage={publication.currentPage}
            rotation={safeReaderState.rotation}
            background={safeReaderState.background}
            scale={effectiveScale}
            onPageVisible={onSelectPage}
            onNextVolume={onNextVolume}
            nextVolumeTitle={nextVolumeTitle}
          />
        ) : (
          <div
            className={`paper-spread paper-spread--${profile.mode}`}
            ref={paperRef}
            style={{ '--spread-aspect': spreadAspect } as CSSProperties}
          >
            <div className="reader-content-transform" style={contentTransformStyle} data-reader-content>
              <ReaderSurface
                frame={rendererFrame}
                ariaLabel={t('reader.pageReady', { counter: readerCounter })}
                onStatus={setRendererStatus}
                interactionActive={pageTurn.state.phase !== 'idle'}
                staticContent={(
                  <>
                    {visiblePages.map((page) => (
                      <PageSheet
                        page={page}
                        key={page.id}
                        onImageDimensions={handleImageDimensions}
                      />
                    ))}
                  </>
                )}
              />
              {pageTurn.surfaceInput && (
                <PageTurnSurface
                  {...pageTurn.surfaceInput}
                  onReady={pageTurn.onTexturesAndBackendReady}
                  onSettled={pageTurn.onSettled}
                  onFailure={pageTurn.onFailure}
                />
              )}
              <AdaptiveFlowOverlay
                graph={flowGraph}
                isAnalyzing={flowState === 'analyzing'}
                visible={flowVisible}
                pageSlot={Math.max(currentPageSlot, 0)}
                pageCount={visiblePages.length}
                onSwap={correctFlowOrder}
                onUseManualRoute={useManualFlowRoute}
                onAddPanel={addPanel}
                onRemovePanel={removePanel}
              />
            </div>
          </div>
        )}

        <div className="stage-rail" data-testid="reader-stage-rail">
          <div className="stage-meta">
            <span>{profile.direction === 'rtl' ? t('reader.rightToLeft') : t('reader.leftToRight')}</span>
            <span className="stage-meta__divider" aria-hidden="true" />
            <span>
              {profile.mode === 'spread'
                ? t('reader.spreadView')
                : profile.mode === 'webtoon'
                  ? t('reader.webtoon')
                  : t('reader.singlePage')}
            </span>
          </div>
          <p className="stage-note">
            {profile.reducedMotion
              ? t('reader.reducedMotion')
              : rendererAnnouncement.message}
          </p>
          <details className="renderer-diagnostic-panel">
            <summary>{t('reader.rendererDiagnostics')}</summary>
            <code>{foldFailure ? `${rendererAnnouncement.diagnostic} · ${foldFailure}` : rendererAnnouncement.diagnostic}</code>
          </details>
        </div>
        <LiveAnnouncement
          message={rendererAnnouncement.message}
          testId="renderer-status-announcement"
        />
        <p className="sr-only" data-testid="renderer-diagnostic">
          {foldFailure ? `${rendererAnnouncement.diagnostic} · ${foldFailure}` : rendererAnnouncement.diagnostic}
        </p>

        {nextVolumeTitle && onNextVolume && publication.currentPage >= Math.max(0, publication.pageCount - 1) && profile.mode !== 'webtoon' && (
          <div className="next-volume-dock" data-reader-control>
            <button type="button" className="primary-button next-volume-btn" onClick={onNextVolume}>
              {t('reader.nextVolume', { title: nextVolumeTitle })} ↗
            </button>
          </div>
        )}
      </section>

      <footer
        className={`reader-controls ${!isHudShowing ? 'reader-controls--hidden' : ''}`}
        onMouseEnter={() => {
          setHudVisible(true);
          if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
        }}
        onMouseLeave={() => {
          if (!hudPinned && !zoomMenuOpen && !navigatorVisible) {
            showHudTemporarily(2000);
          }
        }}
      >
        <button className="nav-button" data-testid="reader-previous" onClick={() => pageTurn.requestTurn(-1)} aria-disabled={!canPrevious} aria-label={t('reader.previousAria')}>← <span>{t('reader.previous')}</span></button>
        <div className="reader-progress" aria-label={t('reader.percentRead', { percent: Math.round(publication.progress * 100) })}>
          <div className="progress-track"><span style={{ width: `${publication.progress * 100}%` }} /></div>
          <span>{t('reader.percentComplete', { percent: Math.round(publication.progress * 100) })}</span>
        </div>
        <button
          className="nav-button nav-button--forward"
          data-testid="reader-next"
          onClick={() => {
            if (canNext) {
              pageTurn.requestTurn(1);
            } else if (onNextVolume && publication.currentPage >= Math.max(0, publication.pageCount - 1)) {
              onNextVolume();
            }
          }}
          aria-disabled={!canNext && !onNextVolume}
          aria-label={t('reader.nextAria')}
        >
          <span>{t('reader.next')}</span> →
        </button>
      </footer>

    </main>
  );
}
