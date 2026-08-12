import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Bookmark, PageDescriptor } from '../domain/types';
import { clamp } from '../domain/reader';

export interface PageNavigatorProps {
  pages: PageDescriptor[];
  currentPage: number;
  bookmarks: Bookmark[];
  onSelectPage: (pageIndex: number) => void;
  onToggleBookmark: (pageId: string) => void;
  onClose: () => void;
}

/** A compact, keyboard-first page strip. It intentionally owns no reader state. */
export function PageNavigator({
  pages,
  currentPage,
  bookmarks,
  onSelectPage,
  onToggleBookmark,
  onClose,
}: PageNavigatorProps) {
  const safeCurrent = pages.length > 0 ? clamp(currentPage, 0, pages.length - 1) : 0;
  const [jumpValue, setJumpValue] = useState(String(safeCurrent + 1));
  const panelRef = useRef<HTMLElement>(null);
  const bookmarkIds = useMemo(() => new Set(bookmarks.map((bookmark) => bookmark.pageId)), [bookmarks]);

  useEffect(() => {
    setJumpValue(String(safeCurrent + 1));
  }, [safeCurrent]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const selectPage = (pageIndex: number) => {
    if (pages.length === 0) {
      return;
    }
    onSelectPage(clamp(Math.round(pageIndex), 0, pages.length - 1));
  };

  const onScrub = (event: ChangeEvent<HTMLInputElement>) => {
    selectPage(Number(event.currentTarget.value) - 1);
  };

  const onJumpKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const value = Number.parseInt(event.currentTarget.value, 10);
    if (Number.isFinite(value)) {
      selectPage(value - 1);
      setJumpValue(String(clamp(value, 1, Math.max(pages.length, 1))));
    }
  };

  return (
    <aside
      className="page-navigator"
      ref={panelRef}
      tabIndex={-1}
      aria-label="Page navigator"
      data-reader-control
    >
      <div className="page-navigator__header">
        <div>
          <span className="eyebrow">NAVIGATOR</span>
          <strong>{pages.length === 0 ? 'No pages' : `Page ${safeCurrent + 1} of ${pages.length}`}</strong>
        </div>
        <button type="button" className="page-navigator__close" aria-label="Close page navigator" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="page-navigator__tools" data-reader-control>
        <label className="page-navigator__jump">
          <span>Jump to page</span>
          <input
            type="number"
            min={1}
            max={Math.max(pages.length, 1)}
            value={jumpValue}
            aria-label="Jump to page number"
            onChange={(event) => setJumpValue(event.currentTarget.value)}
            onKeyDown={onJumpKeyDown}
          />
        </label>
        <label className="page-navigator__scrubber">
          <span className="sr-only">Page scrubber</span>
          <input
            type="range"
            min={1}
            max={Math.max(pages.length, 1)}
            step={1}
            value={safeCurrent + 1}
            aria-label="Page scrubber"
            aria-valuemin={1}
            aria-valuemax={Math.max(pages.length, 1)}
            aria-valuenow={safeCurrent + 1}
            onChange={onScrub}
            onInput={(event) => selectPage(Number(event.currentTarget.value) - 1)}
          />
        </label>
      </div>

      <div className="page-navigator__strip" role="list" aria-label="Page thumbnails">
        {pages.map((page, index) => {
          const bookmarked = bookmarkIds.has(page.id);
          return (
            <div className="page-navigator__item" role="listitem" key={page.id}>
              <button
                type="button"
                className={`page-thumb ${index === safeCurrent ? 'page-thumb--current' : ''}`}
                aria-label={`Go to page ${index + 1}`}
                aria-current={index === safeCurrent ? 'page' : undefined}
                onClick={() => selectPage(index)}
                data-reader-control
              >
                <img src={page.src} alt={`${page.name}, page ${index + 1}`} loading="lazy" decoding="async" />
                <span>{String(index + 1).padStart(2, '0')}</span>
              </button>
              <button
                type="button"
                className={`page-thumb__bookmark ${bookmarked ? 'page-thumb__bookmark--active' : ''}`}
                aria-label={`${bookmarked ? 'Remove' : 'Add'} bookmark from page ${index + 1}`}
                aria-pressed={bookmarked}
                title={bookmarks.find((bookmark) => bookmark.pageId === page.id)?.label || undefined}
                onClick={() => onToggleBookmark(page.id)}
                data-reader-control
              >
                {bookmarked ? '◆' : '◇'}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
