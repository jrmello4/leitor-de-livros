import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, WheelEvent } from 'react';
import { pageCounter, visiblePageIndexes, clamp } from '../domain/reader';
import type { PageDescriptor, Publication, ReadingProfile } from '../domain/types';

interface ReaderViewProps {
  publication: Publication;
  profile: ReadingProfile;
  announcement: string;
  onBack: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleSettings: () => void;
  onToggleFullscreen: () => void;
}

function PageSheet({ page, className = '' }: { page: PageDescriptor; className?: string }) {
  return (
    <article className={`page-sheet ${className}`} aria-label={`Page ${page.index + 1}`}>
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
}: ReaderViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragProgress, setDragProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const visibleIndexes = visiblePageIndexes(publication.currentPage, publication.pages, profile.mode, profile.direction);
  const visiblePages = visibleIndexes.map((index) => publication.pages[index]).filter(Boolean);
  const currentPage = publication.pages[publication.currentPage];

  const progressFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const distance = profile.direction === 'rtl' ? event.clientX - rect.left : rect.right - event.clientX;
    return clamp(distance / Math.max(rect.width * 0.72, 1), 0, 1);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || profile.reducedMotion) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setDragProgress(progressFromPointer(event));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }

    setDragProgress(progressFromPointer(event));
  };

  const finishDrag = (commit: boolean) => {
    setDragging(false);
    setDragProgress(0);
    if (commit) {
      onNext();
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    finishDrag(dragProgress >= 0.42);
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
  } as CSSProperties;

  return (
    <main className={`reader-view reader-view--${profile.direction} ${profile.reducedMotion ? 'reader-view--reduced-motion' : ''}`}>
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
          <span className="reader-counter">{pageCounter(publication.currentPage, publication.pages.length)}</span>
          <button className="reader-tool" onClick={onToggleFullscreen}>Fullscreen <span aria-hidden="true">↗</span></button>
          <button className="reader-tool" onClick={onToggleSettings}>Settings <span aria-hidden="true">⌘</span></button>
        </div>
      </header>

      <section
        className={`reading-stage ${dragging ? 'reading-stage--dragging' : ''}`}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => finishDrag(false)}
        onWheel={onWheel}
        aria-label="Reading canvas. Drag the lower corner to turn the page."
      >
        <div className="stage-caption stage-caption--left">{profile.direction === 'rtl' ? 'RIGHT TO LEFT' : 'LEFT TO RIGHT'}</div>
        <div className="stage-caption stage-caption--right">{profile.mode === 'spread' ? 'SPREAD VIEW' : 'SINGLE PAGE'}</div>

        <div className={`paper-spread paper-spread--${profile.mode}`}>
          {visiblePages.map((page) => <PageSheet page={page} key={page.id} />)}
          {currentPage && dragProgress > 0 && (
            <div
              className={`curl-layer curl-layer--${profile.direction}`}
              style={curlStyle}
              aria-hidden="true"
            >
              <PageSheet page={currentPage} />
              <span className="curl-glint" />
            </div>
          )}
        </div>

        <div className="corner-hint" aria-hidden="true">
          <span className="corner-line" />
          <span>DRAG A CORNER</span>
        </div>
        <p className="stage-note">{profile.reducedMotion ? 'Reduced motion is on · use the controls below' : 'The fold follows your pointer'}</p>
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
