import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { PageRotation, Publication, StageBackground } from '../domain/types';
import { t } from '../i18n/catalog';
import { PauseIcon, PlayIcon } from './Icons';

export interface WebtoonReaderProps {
  publication: Publication;
  currentPage: number;
  rotation?: PageRotation;
  background?: StageBackground;
  scale?: number;
  onScaleChange?: (scale: number) => void;
  onPageVisible: (pageIndex: number) => void;
  onNextVolume?: () => void;
  nextVolumeTitle?: string;
  onScrollPosition?: (pageId: string, scrollRatio: number) => void;
  resumeScrollRatio?: number;
  resumePageId?: string;
  onToggleHud?: () => void;
}

interface ZoomAnchor {
  clientX: number;
  clientY: number;
  stripLeft: number;
  stripTop: number;
  stripWidth: number;
  stripXRatio: number;
  stripYRatio: number;
  pageIndex?: number;
  pageXRatio?: number;
  pageYRatio?: number;
}

export function WebtoonReader({
  publication,
  currentPage,
  rotation = 0,
  background = 'atelier',
  scale = 1,
  onScaleChange,
  onPageVisible,
  onNextVolume,
  nextVolumeTitle,
  onScrollPosition,
  resumeScrollRatio,
  resumePageId,
  onToggleHud,
}: WebtoonReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const initialScrollDoneRef = useRef(false);
  const visiblePagesRef = useRef(new Set<number>());
  const onPageVisibleRef = useRef(onPageVisible);
  onPageVisibleRef.current = onPageVisible;
  const [windowRange, setWindowRange] = useState(() => ({
    first: Math.max(0, currentPage - 1), last: currentPage + 1,
  }));
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<1 | 2 | 3>(1);
  const autoScrollRafRef = useRef<number | null>(null);
  const scrollNotifyRef = useRef<number | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number; anchor: ZoomAnchor | null } | null>(null);
  const finishingPinchRef = useRef(false);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const zoomAnchorClearFrameRef = useRef<number | null>(null);
  const zoomNavigationBlockRef = useRef(false);
  const zoomNavigationBlockTimerRef = useRef<number | null>(null);
  const pinchFrameRef = useRef<number | null>(null);
  const pendingPinchScaleRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const settleZoomNavigation = () => {
    zoomNavigationBlockRef.current = true;
    if (zoomNavigationBlockTimerRef.current !== null) {
      window.clearTimeout(zoomNavigationBlockTimerRef.current);
    }
    zoomNavigationBlockTimerRef.current = window.setTimeout(() => {
      zoomNavigationBlockTimerRef.current = null;
      if (!pinchRef.current) zoomNavigationBlockRef.current = false;
    }, 120);
  };

  const captureZoomAnchor = (clientX: number, clientY: number): ZoomAnchor | null => {
    const strip = stripRef.current;
    const rect = strip?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return null;
    }
    const anchor: ZoomAnchor = {
      clientX,
      clientY,
      stripLeft: rect.left,
      stripTop: rect.top,
      stripWidth: rect.width,
      stripXRatio: (clientX - rect.left) / rect.width,
      stripYRatio: (clientY - rect.top) / rect.width,
    };
    // Anchor against the page itself whenever possible. The strip can include
    // margins and multiple page heights, so scaling from its origin causes a
    // small drift that eventually crosses into a different page.
    for (const [pageIndex, page] of pageRefs.current) {
      const pageRect = page.getBoundingClientRect();
      if (
        pageRect.width > 0
        && pageRect.height > 0
        && clientX >= pageRect.left
        && clientX <= pageRect.right
        && clientY >= pageRect.top
        && clientY <= pageRect.bottom
      ) {
        anchor.pageIndex = pageIndex;
        anchor.pageXRatio = (clientX - pageRect.left) / pageRect.width;
        anchor.pageYRatio = (clientY - pageRect.top) / pageRect.height;
        setWindowRange((previous) => {
          const first = Math.min(previous.first, Math.max(0, pageIndex - 1));
          const last = Math.max(previous.last, Math.min(publication.pages.length - 1, pageIndex + 1));
          return first === previous.first && last === previous.last ? previous : { first, last };
        });
        break;
      }
    }
    return anchor;
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length < 2 || !onScaleChange) {
      return;
    }
    if (pinchRef.current) {
      event.preventDefault();
      return;
    }
    if (zoomAnchorClearFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnchorClearFrameRef.current);
      zoomAnchorClearFrameRef.current = null;
    }
    const first = event.touches[0];
    const second = event.touches[1];
    const clientX = (first.clientX + second.clientX) / 2;
    const clientY = (first.clientY + second.clientY) / 2;
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)),
      scale: Math.max(1, scale),
      anchor: captureZoomAnchor(clientX, clientY),
    };
    finishingPinchRef.current = false;
    zoomNavigationBlockRef.current = true;
    setIsAutoScrolling(false);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (finishingPinchRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!pinchRef.current || event.touches.length < 2 || !onScaleChange) {
      return;
    }
    const first = event.touches[0];
    const second = event.touches[1];
    const clientX = (first.clientX + second.clientX) / 2;
    const clientY = (first.clientY + second.clientY) / 2;
    const distance = Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY));
    // Keep the content coordinate captured at touchstart for the whole pinch.
    // Recapturing it on every move accumulated scroll rounding/layout drift.
    const anchor = pinchRef.current.anchor;
    zoomAnchorRef.current = anchor ? { ...anchor, clientX, clientY } : null;
    const nextScale = Math.max(1, Math.min(5, pinchRef.current.scale * distance / pinchRef.current.distance));
    event.preventDefault();
    event.stopPropagation();
    const roundedScale = Number(nextScale.toFixed(2));
    if (pinchFrameRef.current === null) {
      // Apply the first sample/presented frame immediately, then coalesce any
      // extra touchmove events produced before the next display frame.
      onScaleChange(roundedScale);
      pinchFrameRef.current = requestAnimationFrame(() => {
        pinchFrameRef.current = null;
        const pendingScale = pendingPinchScaleRef.current;
        pendingPinchScaleRef.current = null;
        if (pendingScale !== null) onScaleChange(pendingScale);
      });
    } else {
      pendingPinchScaleRef.current = roundedScale;
    }
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (!pinchRef.current && !finishingPinchRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.touches.length >= 2) return;
    pinchRef.current = null;
    finishingPinchRef.current = event.touches.length > 0;
    settleZoomNavigation();
    // Let the layout effect for the final touchmove compensate scroll before
    // clearing its anchor. Clearing synchronously made the last zoom frame
    // fall back to the strip origin on slower devices.
    if (zoomAnchorClearFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnchorClearFrameRef.current);
    }
    zoomAnchorClearFrameRef.current = requestAnimationFrame(() => {
      zoomAnchorClearFrameRef.current = null;
      zoomAnchorRef.current = null;
    });
  };

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const container = containerRef.current;
    const strip = stripRef.current;
    const nextRect = strip?.getBoundingClientRect();
    if (!anchor || !container || !nextRect || anchor.stripWidth <= 0 || nextRect.width <= 0) {
      if (anchor) {
        zoomAnchorRef.current = null;
      }
      return;
    }

    const anchoredPage = anchor.pageIndex === undefined ? undefined : pageRefs.current.get(anchor.pageIndex);
    const anchoredPageRect = anchoredPage?.getBoundingClientRect();
    if (anchoredPageRect && anchoredPageRect.width > 0 && anchoredPageRect.height > 0) {
      const desiredLeft = anchor.clientX - anchoredPageRect.width * (anchor.pageXRatio ?? 0);
      const desiredTop = anchor.clientY - anchoredPageRect.height * (anchor.pageYRatio ?? 0);
      container.scrollLeft += anchoredPageRect.left - desiredLeft;
      container.scrollTop += anchoredPageRect.top - desiredTop;
    } else {
      // Fallback for the gap between pages, where there is no page element to
      // use as the focal reference.
      const desiredLeft = anchor.clientX - anchor.stripXRatio * nextRect.width;
      const desiredTop = anchor.clientY - anchor.stripYRatio * nextRect.width;
      container.scrollLeft += nextRect.left - desiredLeft;
      container.scrollTop += nextRect.top - desiredTop;
    }
    // This scroll is an internal zoom correction, not a reading navigation.
    // Do not let its IntersectionObserver notification select another page.
    settleZoomNavigation();
    zoomAnchorRef.current = null;
  }, [scale]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!onScaleChange || (!event.ctrlKey && !event.metaKey)) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('[data-reader-control]')) {
      return;
    }

    const currentScale = Math.max(1, scale);
    const delta = event.deltaY < 0 ? 0.25 : -0.25;
    const nextScale = Math.max(1, Math.min(5, Number((currentScale + delta).toFixed(2))));
    if (nextScale === currentScale) {
      return;
    }
    zoomAnchorRef.current = captureZoomAnchor(event.clientX, event.clientY);
    event.preventDefault();
    event.stopPropagation();
    onScaleChange(nextScale);
  };

  // React delegates touch events passively. Native non-passive listeners are
  // necessary to prevent the browser from consuming a two-finger gesture.
  const handlersRef = useRef({ handleTouchStart, handleTouchMove, handleTouchEnd });
  handlersRef.current = { handleTouchStart, handleTouchMove, handleTouchEnd };
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const start = (event: TouchEvent) => handlersRef.current.handleTouchStart(event);
    const move = (event: TouchEvent) => handlersRef.current.handleTouchMove(event);
    const end = (event: TouchEvent) => handlersRef.current.handleTouchEnd(event);
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end, { passive: false });
    element.addEventListener('touchcancel', end, { passive: false });
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
      if (zoomAnchorClearFrameRef.current !== null) {
        cancelAnimationFrame(zoomAnchorClearFrameRef.current);
      }
      if (pinchFrameRef.current !== null) {
        cancelAnimationFrame(pinchFrameRef.current);
        pinchFrameRef.current = null;
      }
    };
  }, []);

  // Scroll to current page on initial load if not at top
  useEffect(() => {
    if (initialScrollDoneRef.current) {
      return;
    }
    const resumeIndex = resumePageId
      ? publication.pages.find((page) => page.id === resumePageId)?.index ?? currentPage
      : currentPage;
    const target = pageRefs.current.get(resumeIndex);
    if (target && containerRef.current) {
      target.scrollIntoView?.({ block: 'start' });
      if (resumeScrollRatio !== undefined) {
        const ratio = Math.max(0, Math.min(1, resumeScrollRatio));
        containerRef.current.scrollTop = target.offsetTop
          + ratio * Math.max(0, target.offsetHeight - containerRef.current.clientHeight);
      }
    }
    initialScrollDoneRef.current = true;
  }, [currentPage, resumePageId, resumeScrollRatio, publication.pages]);

  // Set up IntersectionObserver to track active visible page
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // Observer batches contain only changed intersections. Retain the rest,
        // including very tall pages whose visible ratio may be below 10%.
        for (const entry of entries) {
          const index = Number(entry.target.getAttribute('data-page-index'));
          if (entry.isIntersecting) visiblePagesRef.current.add(index);
          else visiblePagesRef.current.delete(index);
        }
        const visible = [...visiblePagesRef.current].sort((a, b) => a - b);
        if (visible.length) {
          if (zoomNavigationBlockRef.current) {
            return;
          }
          const first = Math.max(0, visible[0] - 1);
          const last = Math.min(publication.pages.length - 1, visible[visible.length - 1] + 1);
          setWindowRange(previous => previous.first === first && previous.last === last
            ? previous : { first, last });
          onPageVisibleRef.current(visible[0]);
        }
      },
      {
        root: container,
        threshold: [0, 0.01],
      },
    );

    for (const el of pageRefs.current.values()) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      visiblePagesRef.current.clear();
      if (scrollNotifyRef.current !== null) {
        window.clearTimeout(scrollNotifyRef.current);
        scrollNotifyRef.current = null;
      }
      if (zoomNavigationBlockTimerRef.current !== null) {
        window.clearTimeout(zoomNavigationBlockTimerRef.current);
        zoomNavigationBlockTimerRef.current = null;
      }
    };
  }, [publication.id, publication.pages.length]);

  // Autoscroll continuous animation loop
  useEffect(() => {
    if (!isAutoScrolling) {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      return undefined;
    }

    const speedMap = { 1: 1.2, 2: 2.8, 3: 5.2 };
    const stepPx = speedMap[autoScrollSpeed];

    let previousTime: number | undefined;
    const scrollTick = (time: number) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      // Check if reached the end of the scroll container
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
        setIsAutoScrolling(false);
        return;
      }

      // Match the same speed on 60 Hz and 120 Hz screens; cap background gaps.
      const elapsed = previousTime === undefined ? 1000 / 60 : Math.min(50, time - previousTime);
      previousTime = time;
      container.scrollTop += stepPx * elapsed / (1000 / 60);
      autoScrollRafRef.current = requestAnimationFrame(scrollTick);
    };

    autoScrollRafRef.current = requestAnimationFrame(scrollTick);

    return () => {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [isAutoScrolling, autoScrollSpeed]);

  const toggleAutoScroll = () => {
    setIsAutoScrolling((current) => !current);
  };

  const handleScroll = () => {
    if (!onScrollPosition || scrollNotifyRef.current !== null) return;
    scrollNotifyRef.current = window.setTimeout(() => {
      scrollNotifyRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      const visible = [...visiblePagesRef.current].sort((a, b) => a - b)[0];
      const page = Number.isFinite(visible) ? publication.pages[visible] : publication.pages[currentPage];
      if (!page) return;
      const pageElement = pageRefs.current.get(page.index);
      const containerRect = container.getBoundingClientRect();
      const pageRect = pageElement?.getBoundingClientRect();
      const pageTop = pageRect ? pageRect.top - containerRect.top + container.scrollTop : 0;
      const ratio = !pageElement || !pageRect || pageElement.offsetHeight <= container.clientHeight
        ? 0
        : (container.scrollTop - pageTop)
          / (pageElement.offsetHeight - container.clientHeight);
      onScrollPosition(page.id, Math.max(0, Math.min(1, ratio)));
    }, 200);
  };

  const handleReaderTap = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('[data-reader-control]')) {
      return;
    }
    const container = containerRef.current;
    const bounds = container?.getBoundingClientRect();
    if (!container || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const now = performance.now();
    const previousTap = lastTapRef.current;
    const isDoubleTap = previousTap
      && now - previousTap.time < 340
      && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < 32;
    lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
    if (isDoubleTap && onScaleChange) {
      lastTapRef.current = null;
      zoomAnchorRef.current = captureZoomAnchor(event.clientX, event.clientY);
      settleZoomNavigation();
      onScaleChange(scale > 1.05 ? 1 : 2);
      event.stopPropagation();
      return;
    }

    const xRatio = (event.clientX - bounds.left) / bounds.width;
    if (xRatio >= 0.30 && xRatio <= 0.70) {
      onToggleHud?.();
    } else {
      const isLowerZone = event.clientY - bounds.top >= bounds.height / 2;
      container.scrollBy({
        top: (isLowerZone ? 1 : -1) * Math.max(1, Math.round(container.clientHeight * 0.72)),
        behavior: 'smooth',
      });
    }
    // ReaderView has a desktop-oriented click handler around this component.
    // A handled Webtoon zone must not be toggled a second time by that parent.
    event.stopPropagation();
  };

  const imageStyle: CSSProperties = {
    transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: 'center center',
  };

  return (
    <div
      ref={containerRef}
      className={`webtoon-reader-container webtoon-bg--${background}`}
      data-testid="webtoon-reader"
      data-background={background}
      onScroll={handleScroll}
      onWheel={handleWheel}
      onClick={handleReaderTap}
      style={{ display: 'block', overflowX: scale > 1 ? 'auto' : 'hidden', touchAction: 'pan-x pan-y', scrollBehavior: 'auto', overflowAnchor: 'none' }}
      tabIndex={0}
      aria-label={t('profile.webtoon')}
    >
      {/* Floating Autoscroll HUD */}
      <div className="webtoon-autoscroll-hud" data-reader-control>
        <button
          type="button"
          className={`webtoon-autoscroll-btn ${isAutoScrolling ? 'webtoon-autoscroll-btn--active' : ''}`}
          onClick={toggleAutoScroll}
          aria-label={isAutoScrolling ? t('webtoon.pause') : t('webtoon.play')}
          data-reader-control
        >
          {isAutoScrolling ? <PauseIcon /> : <PlayIcon />}
          <span>{isAutoScrolling ? t('webtoon.pause') : t('webtoon.autoscroll')}</span>
        </button>
        <select
          className="webtoon-autoscroll-speed"
          value={autoScrollSpeed}
          onChange={(e) => setAutoScrollSpeed(Number(e.target.value) as 1 | 2 | 3)}
          aria-label={t('webtoon.speed')}
          data-reader-control
        >
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={3}>3x</option>
        </select>
      </div>

      <div
        className="webtoon-strip"
        ref={stripRef}
        style={{
          width: scale !== 1 ? `${Math.round(100 * scale)}%` : undefined,
          maxWidth: scale === 1 ? '850px' : `${Math.round(850 * scale)}px`,
        }}
      >
        {publication.pages.map((page) => (
          <article
            key={page.id}
            ref={(el) => {
              if (el) {
                pageRefs.current.set(page.index, el);
              } else {
                pageRefs.current.delete(page.index);
              }
            }}
            className="webtoon-page-item webtoon-page"
            data-page-index={page.index}
            data-page-id={page.id}
            style={{ aspectRatio: `${Math.max(1, page.width)} / ${Math.max(1, page.height)}`, flexShrink: 0 }}
            aria-label={t('reader.page', { page: page.index + 1 })}
          >
            {page.index >= windowRange.first && page.index <= windowRange.last && (page.src ? <img
              src={page.src}
              alt={t('navigator.pageAlt', { name: page.name, page: page.index + 1 })}
              loading="eager"
              decoding="async"
              draggable={false}
              style={imageStyle}
            /> : <span className="page-loading" role="status">{t('reader.preparingPage')}</span>)}
            <span className="webtoon-folio">{String(page.index + 1).padStart(2, '0')}</span>
          </article>
        ))}

        {nextVolumeTitle && onNextVolume && (
          <section className="webtoon-next-volume" aria-label={t('reader.openNextVolume')}>
            <p className="eyebrow">{t('reader.nextVolumeAvailable', { title: nextVolumeTitle })}</p>
            <button
              type="button"
              className="primary-button"
              onClick={onNextVolume}
            >
              {t('reader.nextVolume', { title: nextVolumeTitle })} ↗
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
