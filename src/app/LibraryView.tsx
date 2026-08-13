import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { mostRecentPublication, visiblePublications as getVisiblePublications, type LibrarySort } from '../domain/library';
import { publicationCoverSrc } from '../domain/covers';
import type { Publication } from '../domain/types';
import { t } from '../i18n/catalog';

interface LibraryViewProps {
  publications: Publication[];
  query: string;
  sort: LibrarySort;
  diagnostic?: string;
  isImporting: boolean;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onOpen: (publication: Publication) => void;
  onImport: (files: File[]) => void;
  isNativeRuntime: boolean;
  onImportNative: () => void;
  onImportFolder: () => void;
  onOpenSettings: () => void;
  onToggleFavorite: (publication: Publication) => void | Promise<void>;
  onDelete: (publication: Publication) => void | Promise<void>;
  onReplaceCover: (publication: Publication, file: File) => void | Promise<void>;
  onCoverError?: (publication: Publication) => void;
  onChooseNativeCover: (publication: Publication) => void | Promise<void>;
  onResetCover: (publication: Publication) => void | Promise<void>;
  favoriteOnly: boolean;
  onFavoriteOnlyChange: (favoriteOnly: boolean) => void;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
}

function formatProgress(progress: number): string {
  return t('library.progress', { percent: Math.round(progress * 100) });
}

export function LibraryView({
  publications,
  query,
  sort,
  diagnostic,
  isImporting,
  onQueryChange,
  onSortChange,
  onOpen,
  onImport,
  isNativeRuntime,
  onImportNative,
  onImportFolder,
  onOpenSettings,
  onToggleFavorite,
  onDelete,
  onReplaceCover,
  onCoverError = () => undefined,
  onChooseNativeCover,
  onResetCover,
  favoriteOnly,
  onFavoriteOnlyChange,
  settingsTriggerRef,
}: LibraryViewProps) {
  const [pendingDelete, setPendingDelete] = useState<Publication | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreTriggerOnCloseRef = useRef(false);
  const libraryMainRef = useRef<HTMLElement>(null);
  const restoreDeleteFocus = () => {
    const trigger = deleteTriggerRef.current
      ?? libraryMainRef.current?.querySelector<HTMLButtonElement>('.delete-link');
    if (trigger?.isConnected) {
      trigger.focus();
      return;
    }
    if (settingsTriggerRef.current?.isConnected) {
      settingsTriggerRef.current.focus();
    } else {
      libraryMainRef.current?.focus();
    }
  };
  const visiblePublications = useMemo(() => {
    const visible = getVisiblePublications(publications, query, sort);
    return favoriteOnly ? visible.filter((publication) => publication.isFavorite) : visible;
  }, [favoriteOnly, publications, query, sort]);
  const continuePublication = useMemo(() => mostRecentPublication(publications), [publications]);

  useLayoutEffect(() => {
    if (!pendingDelete) {
      if (restoreTriggerOnCloseRef.current) {
        restoreTriggerOnCloseRef.current = false;
        restoreDeleteFocus();
      }
      return;
    }
    setDeleteError(undefined);
    deleteCancelRef.current?.focus();
  }, [pendingDelete]);

  useEffect(() => {
    if (!pendingDelete) {
      return;
    }

    const onDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        restoreTriggerOnCloseRef.current = true;
        setPendingDelete(null);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(document.querySelectorAll<HTMLElement>(
        '.confirm-dialog button:not([disabled]), .confirm-dialog [href], .confirm-dialog input:not([disabled]), .confirm-dialog select:not([disabled])',
      ));
      if (focusable.length === 0) {
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

    document.addEventListener('keydown', onDialogKeyDown);
    return () => document.removeEventListener('keydown', onDialogKeyDown);
  }, [pendingDelete]);

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    onImport(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const onCoverFile = (publication: Publication, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      void onReplaceCover(publication, file);
    }
  };

  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!isNativeRuntime) {
      onImport(Array.from(event.dataTransfer.files));
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete || isDeleting) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = onDelete(pendingDelete);
      void Promise.resolve(result)
        .then(() => {
          // The card may be removed by the parent as soon as onDelete resolves,
          // so focus a stable target before unmounting the dialog/card.
          libraryMainRef.current?.focus();
          setPendingDelete(null);
        })
        .catch(() => setDeleteError(t('library.deleteError')))
        .finally(() => setIsDeleting(false));
    } catch {
      setDeleteError(t('library.deleteError'));
      setIsDeleting(false);
    }
  };

  return (
    <main ref={libraryMainRef} className="library-view" tabIndex={-1} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="library-header">
        <div className="brand-lockup" aria-label={t('library.brand')}>
          <span className="brand-glyph" aria-hidden="true">T</span>
          <span>
            <strong>{t('library.tactile')}</strong>
            <small>{t('library.localEdition')}</small>
          </span>
        </div>
        <div className="header-actions">
          <span className="privacy-chip"><span className="status-dot" /> {t('library.deviceOnly')}</span>
          <button ref={settingsTriggerRef} className="quiet-button" onClick={onOpenSettings}>{t('library.settings')}</button>
        </div>
      </header>

      {continuePublication && (
        <section className="continue-card" aria-label={t('library.continueReading')}>
          <div>
            <span className="eyebrow">{t('library.pickUp')}</span>
            <strong className="continue-title">{continuePublication.title}</strong>
            <p>{formatProgress(continuePublication.progress)} · {t('library.pages', { count: continuePublication.pages.length })}</p>
          </div>
          <button className="continue-button" type="button" onClick={() => onOpen(continuePublication)}>
            {t('library.continue')} <span aria-hidden="true">↗</span>
          </button>
        </section>
      )}

      <section className="library-intro">
        <div className="intro-copy">
          <p className="eyebrow">{t('library.paperAtelier')}</p>
          <h1>{t('library.heading')}<br /><em>{t('library.headingEmphasis')}</em></h1>
          <p className="intro-description">
            {t('library.description')}
          </p>
          <div className="intro-actions">
            {isNativeRuntime ? (
              <>
                <button className="primary-button" disabled={isImporting} onClick={onImportNative}>
                  {isImporting ? t('library.readingFiles') : t('library.importPublication')}
                </button>
                <button className="secondary-button" disabled={isImporting} onClick={onImportFolder}>
                  {t('library.importFolder')}
                </button>
              </>
            ) : (
              <label className="primary-button">
                {isImporting ? t('library.readingFile') : t('library.importPublication')}
                <input
                  type="file"
                  accept=".cbz,.cbr,.pdf,image/*"
                  multiple
                  disabled={isImporting}
                  onChange={onFileInput}
                />
              </label>
            )}
            <span className="shortcut-note">
              {isNativeRuntime ? t('library.nativeShortcut') : t('library.browserShortcut')}
            </span>
          </div>
        </div>

        <aside className="intro-aside" aria-label={t('library.principles')}>
          <span className="aside-index">01—03</span>
          <p>{t('library.principleCopy')}</p>
          <div className="aside-rule" />
          <span className="aside-caption">{t('library.builtForMoment')}</span>
        </aside>
      </section>

      <section className="library-toolbar" aria-label={t('library.tools')}>
        <div className="section-heading">
          <span className="eyebrow">{t('library.shelf')}</span>
          <strong>{t('library.publications', { count: visiblePublications.length })}</strong>
        </div>
        <div className="toolbar-controls">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input aria-label={t('library.searchAria')} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t('library.search')} />
          </label>
          <label className="sort-field">
            <span>{t('library.sort')}</span>
            <select aria-label={t('library.sortAria')} value={sort} onChange={(event) => onSortChange(event.target.value as LibrarySort)}>
              <option value="recent">{t('library.sortRecent')}</option>
              <option value="title">{t('library.sortTitle')}</option>
              <option value="added">{t('library.sortAdded')}</option>
            </select>
          </label>
          <label className="favorite-filter" htmlFor="favorite-only">
            <input
              id="favorite-only"
              type="checkbox"
              checked={favoriteOnly}
              onChange={(event) => onFavoriteOnlyChange(event.target.checked)}
            />
            <span>{t('library.favoriteOnly')}</span>
          </label>
        </div>
      </section>

      {diagnostic && <div className="diagnostic-banner" role="alert">{diagnostic}</div>}

      {visiblePublications.length > 0 ? (
        <section className="publication-grid" aria-label={t('library.publicationsAria')}>
          {visiblePublications.map((publication) => (
            <article
              className="publication-card"
              key={publication.id}
              data-testid="library-publication-card"
              data-publication-id={publication.id}
              data-publication-format={publication.format}
              data-publication-source={publication.sourceLabel}
            >
              <button className="cover-button" type="button" onClick={() => onOpen(publication)} aria-label={t('library.open', { title: publication.title })}>
                <img
                  src={publicationCoverSrc(publication)}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = publication.pages[0]?.src ?? '';
                    if (publication.customCover) {
                      onCoverError(publication);
                    }
                  }}
                />
                <span className="cover-edge" aria-hidden="true" />
                <span className="cover-stamp">{publication.format === 'demo' ? t('library.study') : publication.format.toUpperCase()}</span>
              </button>
              <div className="publication-meta">
                <div>
                  <p className="eyebrow">{publication.sourceLabel}</p>
                  <h2>{publication.title}</h2>
                </div>
                <div className="publication-actions">
                  <button
                    className={publication.isFavorite ? 'favorite-button favorite-button--active' : 'favorite-button'}
                    type="button"
                    aria-pressed={publication.isFavorite}
                    aria-label={publication.isFavorite ? t('library.removeFavorite', { title: publication.title }) : t('library.addFavorite', { title: publication.title })}
                    onClick={() => void onToggleFavorite(publication)}
                  >
                    <span aria-hidden="true">{publication.isFavorite ? '★' : '☆'}</span>
                  </button>
                  <button className="open-link" type="button" onClick={() => onOpen(publication)}>{t('library.openLabel')} <span aria-hidden="true">↗</span></button>
                </div>
              </div>
              <div className="cover-actions">
                {isNativeRuntime ? (
                  <button className="quiet-button" type="button" onClick={() => void onChooseNativeCover(publication)}>
                    {publication.customCover ? t('library.replaceCover') : t('library.chooseCover')}
                  </button>
                ) : (
                  <label className="quiet-button cover-file-button">
                    {publication.customCover ? t('library.replaceCover') : t('library.chooseCover')}
                    <input type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp" onChange={(event) => onCoverFile(publication, event)} />
                  </label>
                )}
                {(publication.customCover || publication.diagnostic?.toLowerCase().includes('custom cover')) && (
                  <button className="quiet-button" type="button" aria-label={t('library.resetCover')} onClick={() => void onResetCover(publication)}>
                    {t('library.resetCover')}
                  </button>
                )}
              </div>
              {publication.diagnostic && <p className="diagnostic-banner publication-diagnostic" role="alert">{publication.diagnostic}</p>}
              <div className="progress-line" aria-label={formatProgress(publication.progress)}>
                <span style={{ width: `${publication.progress * 100}%` }} />
              </div>
              <div className="card-footer">
                <span>{t('library.pages', { count: publication.pages.length })}</span>
                <span>{formatProgress(publication.progress)}</span>
                <button
                  className="delete-link"
                  type="button"
                  data-testid="library-publication-remove"
                  aria-label={t('library.removeAria', { title: publication.title })}
                  onClick={(event) => {
                    deleteTriggerRef.current = event.currentTarget;
                    setPendingDelete(publication);
                  }}
                >
                  {t('library.remove')}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-shelf">
          <span className="empty-mark" aria-hidden="true">∅</span>
          <h2>{t('library.emptyTitle')}</h2>
          <p>{isNativeRuntime
            ? t('library.emptyNative')
            : t('library.emptyBrowser')}</p>
        </section>
      )}

      <footer className="library-footer">
        <span>{t('library.footerEdition')}</span>
        <span>{t('library.footerFeatures')}</span>
      </footer>

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-publication-title"
            aria-describedby="remove-publication-copy"
          >
            <span className="eyebrow">{t('library.localData')}</span>
            <h2 id="remove-publication-title">{t('library.removeQuestion', { title: pendingDelete.title })}</h2>
            <p id="remove-publication-copy">
              {t('library.removeCopy')}
            </p>
            {deleteError && <p className="dialog-error" role="alert">{deleteError}</p>}
            <div className="dialog-actions">
              <button
                ref={deleteCancelRef}
                className="secondary-button"
                type="button"
                disabled={isDeleting}
                aria-label={t('library.keepPublication')}
                onClick={(event) => {
                  event.currentTarget.blur();
                  restoreTriggerOnCloseRef.current = true;
                  setPendingDelete(null);
                }}
              >
                {t('library.keepPublication')}
              </button>
              <button
                className="primary-button"
                type="button"
                data-testid="library-remove-confirm"
                disabled={isDeleting}
                aria-label={t('library.removeConfirm', { title: pendingDelete.title })}
                onClick={confirmDelete}
              >
                {isDeleting ? t('library.removing') : t('library.removeFromLibrary')}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
