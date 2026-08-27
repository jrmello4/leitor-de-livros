import { useEffect, useRef, useState, type CSSProperties, type UIEvent } from 'react';
import type { PageRotation, Publication, StageBackground } from '../domain/types';
import { t } from '../i18n/catalog';
import { PauseIcon, PlayIcon } from './Icons';

export interface WebtoonReaderProps {
  publication: Publication;
  currentPage: number;
  rotation?: PageRotation;
  background?: StageBackground;
  scale?: number;
  onPageVisible: (pageIndex: number) => void;
  onNextVolume?: () => void;
  nextVolumeTitle?: string;
}

export function WebtoonReader({
  publication,
  currentPage,
  rotation = 0,
  background = 'atelier',
  scale = 1,
  onPageVisible,
  onNextVolume,
  nextVolumeTitle,
}: WebtoonReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const initialScrollDoneRef = useRef(false);
  const isScrollingProgrammaticallyRef = useRef(false);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<1 | 2 | 3>(1);
  const autoScrollRafRef = useRef<number | null>(null);

  // Scroll to current page on initial load if not at top
  useEffect(() => {
    if (initialScrollDoneRef.current) {
      return;
    }
    if (currentPage > 0) {
      const target = pageRefs.current.get(currentPage);
      if (target && containerRef.current) {
        target.scrollIntoView?.({ block: 'start' });
      }
    }
    initialScrollDoneRef.current = true;
  }, [currentPage]);

  // Set up IntersectionObserver to track active visible page
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingProgrammaticallyRef.current) {
          return;
        }
        let bestEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }

        if (bestEntry) {
          const indexAttr = bestEntry.target.getAttribute('data-page-index');
          if (indexAttr !== null) {
            const index = Number(indexAttr);
            if (!Number.isNaN(index)) {
              onPageVisible(index);
            }
          }
        }
      },
      {
        root: container,
        threshold: [0.1, 0.3, 0.5, 0.7, 0.9],
      },
    );

    for (const el of pageRefs.current.values()) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [onPageVisible, publication.pages.length]);

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

    const scrollTick = () => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      // Check if reached the end of the scroll container
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
        setIsAutoScrolling(false);
        return;
      }

      container.scrollTop += stepPx;
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

  const handleScroll = (_event: UIEvent<HTMLDivElement>) => {
    // Auxiliary fallback if needed
  };

  const toggleAutoScroll = () => {
    setIsAutoScrolling((current) => !current);
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
            aria-label={t('reader.page', { page: page.index + 1 })}
          >
            <img
              src={page.src}
              alt={t('navigator.pageAlt', { name: page.name, page: page.index + 1 })}
              loading="lazy"
              draggable={false}
              style={imageStyle}
            />
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
