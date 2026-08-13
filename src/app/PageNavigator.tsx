import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Bookmark, PageDescriptor } from '../domain/types';
import { clamp } from '../domain/reader';
import { t } from '../i18n/catalog';

export interface PageNavigatorProps {
  pages: PageDescriptor[];
  currentPage: number;
  bookmarks: Bookmark[];
  onSelectPage: (pageIndex: number) => void;
  onToggleBookmark: (pageId: string) => void;
  onClose: () => void;
  onUpdateBookmarkLabel?: (pageId: string, label: string) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

/** A compact, keyboard-first page strip. It intentionally owns no reader state. */
export function PageNavigator({
  pages,
  currentPage,
  bookmarks,
  onSelectPage,
  onToggleBookmark,
  onClose,
  onUpdateBookmarkLabel = () => undefined,
  triggerRef,
}: PageNavigatorProps) {
  const safeCurrent = pages.length > 0 ? clamp(currentPage, 0, pages.length - 1) : 0;
  const [jumpValue, setJumpValue] = useState(String(safeCurrent + 1));
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bookmarkIds = useMemo(() => new Set(bookmarks.map((bookmark) => bookmark.pageId)), [bookmarks]);
  const bookmarkByPageId = useMemo(() => new Map(bookmarks.map((bookmark) => [bookmark.pageId, bookmark])), [bookmarks]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setJumpValue(String(safeCurrent + 1));
  }, [safeCurrent]);

  useEffect(() => {
    setLabelDrafts(Object.fromEntries(bookmarks.map((bookmark) => [bookmark.pageId, bookmark.label])));
  }, [bookmarks]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : triggerRef?.current;
    const focusableSelector = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const restoreTarget = opener?.isConnected ? opener : triggerRef?.current;
      restoreTarget?.focus();
    };
  }, [onClose, triggerRef]);

  const selectPage = (pageIndex: number) => {
    if (pages.length === 0) {
      return;
    }
    onSelectPage(clamp(Math.round(pageIndex), 0, pages.length - 1));
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

  const saveLabel = (pageId: string, value: string) => {
    onUpdateBookmarkLabel(pageId, value.trim().slice(0, 120));
  };

  return (
    <aside
      className="page-navigator"
      ref={panelRef}
      tabIndex={-1}
      aria-label={t('navigator.label')}
      data-reader-control
    >
      <div className="page-navigator__header">
        <div>
          <span className="eyebrow">{t('navigator.title')}</span>
          <strong>{pages.length === 0 ? t('navigator.noPages') : t('navigator.pageOf', { page: safeCurrent + 1, count: pages.length })}</strong>
        </div>
        <button ref={closeRef} type="button" className="page-navigator__close" aria-label={t('navigator.close')} onClick={onClose}>
          ×
        </button>
      </div>

      <div className="page-navigator__tools" data-reader-control>
        <label className="page-navigator__jump">
          <span>{t('navigator.jump')}</span>
          <input
            type="number"
            min={1}
            max={Math.max(pages.length, 1)}
            value={jumpValue}
            aria-label={t('navigator.jumpAria')}
            onChange={(event) => setJumpValue(event.currentTarget.value)}
            onKeyDown={onJumpKeyDown}
          />
        </label>
        <label className="page-navigator__scrubber">
          <span className="sr-only">{t('navigator.scrubber')}</span>
          <input
            type="range"
            min={1}
            max={Math.max(pages.length, 1)}
            step={1}
            value={safeCurrent + 1}
            aria-label={t('navigator.scrubber')}
            aria-valuemin={1}
            aria-valuemax={Math.max(pages.length, 1)}
            aria-valuenow={safeCurrent + 1}
            onInput={(event) => selectPage(Number(event.currentTarget.value) - 1)}
          />
        </label>
      </div>

      <div className="page-navigator__strip" role="list" aria-label={t('navigator.thumbnails')}>
        {pages.map((page, index) => {
          const bookmarked = bookmarkIds.has(page.id);
          return (
            <div className="page-navigator__item" role="listitem" key={page.id}>
              <button
                type="button"
                className={`page-thumb ${index === safeCurrent ? 'page-thumb--current' : ''}`}
                aria-label={t('navigator.goToPage', { page: index + 1 })}
                aria-current={index === safeCurrent ? 'page' : undefined}
                onClick={() => selectPage(index)}
                data-reader-control
              >
                <img src={page.src} alt={t('navigator.pageAlt', { name: page.name, page: index + 1 })} loading="lazy" decoding="async" />
                <span>{String(index + 1).padStart(2, '0')}</span>
              </button>
              <button
                type="button"
                className={`page-thumb__bookmark ${bookmarked ? 'page-thumb__bookmark--active' : ''}`}
                aria-label={bookmarked ? t('navigator.removeBookmark', { page: index + 1 }) : t('navigator.addBookmark', { page: index + 1 })}
                aria-pressed={bookmarked}
                title={bookmarkByPageId.get(page.id)?.label || undefined}
                onClick={() => onToggleBookmark(page.id)}
                data-reader-control
              >
                {bookmarked ? '◆' : '◇'}
              </button>
              {bookmarked && (
                <input
                  className="page-thumb__bookmark-label"
                  value={labelDrafts[page.id] ?? bookmarkByPageId.get(page.id)?.label ?? ''}
                  aria-label={t('navigator.bookmarkTitle', { page: index + 1 })}
                  maxLength={120}
                  onChange={(event) => setLabelDrafts((current) => ({ ...current, [page.id]: event.currentTarget.value }))}
                  onBlur={(event) => saveLabel(page.id, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveLabel(page.id, event.currentTarget.value);
                      event.currentTarget.blur();
                    }
                  }}
                  data-reader-control
                />
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
