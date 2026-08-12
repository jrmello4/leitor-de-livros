import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { mostRecentPublication, visiblePublications as getVisiblePublications } from '../domain/library';
import type { Publication } from '../domain/types';

interface LibraryViewProps {
  publications: Publication[];
  query: string;
  sort: 'recent' | 'title';
  diagnostic?: string;
  isImporting: boolean;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: 'recent' | 'title') => void;
  onOpen: (publication: Publication) => void;
  onImport: (files: File[]) => void;
  isNativeRuntime: boolean;
  onImportNative: () => void;
  onImportFolder: () => void;
  onOpenSettings: () => void;
  onToggleFavorite: (publication: Publication) => void | Promise<void>;
  onDelete: (publication: Publication) => void | Promise<void>;
  favoriteOnly: boolean;
  onFavoriteOnlyChange: (favoriteOnly: boolean) => void;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
}

function formatProgress(progress: number): string {
  return `${Math.round(progress * 100)}% read`;
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
        .catch(() => setDeleteError('The publication could not be removed. Nothing was changed.'))
        .finally(() => setIsDeleting(false));
    } catch {
      setDeleteError('The publication could not be removed. Nothing was changed.');
      setIsDeleting(false);
    }
  };

  return (
    <main ref={libraryMainRef} className="library-view" tabIndex={-1} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="library-header">
        <div className="brand-lockup" aria-label="Tactile Reader home">
          <span className="brand-glyph" aria-hidden="true">T</span>
          <span>
            <strong>TACTILE</strong>
            <small>local reader / edition 01</small>
          </span>
        </div>
        <div className="header-actions">
          <span className="privacy-chip"><span className="status-dot" /> device only</span>
          <button ref={settingsTriggerRef} className="quiet-button" onClick={onOpenSettings}>Reader settings</button>
        </div>
      </header>

      {continuePublication && (
        <section className="continue-card" aria-label="Continue reading">
          <div>
            <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
            <strong className="continue-title">{continuePublication.title}</strong>
            <p>{formatProgress(continuePublication.progress)} · {continuePublication.pages.length} pages</p>
          </div>
          <button className="continue-button" type="button" onClick={() => onOpen(continuePublication)}>
            Continue <span aria-hidden="true">↗</span>
          </button>
        </section>
      )}

      <section className="library-intro">
        <div className="intro-copy">
          <p className="eyebrow">PAPER ATELIER / YOUR LIBRARY</p>
          <h1>Keep the page<br /><em>in your hands.</em></h1>
          <p className="intro-description">
            A quiet local shelf for comics and illustrated publications. Import a file, choose your rhythm, and let
            the interface recede when the reading begins.
          </p>
          <div className="intro-actions">
            {isNativeRuntime ? (
              <>
                <button className="primary-button" disabled={isImporting} onClick={onImportNative}>
                  {isImporting ? 'Reading files...' : 'Import publication'}
                </button>
                <button className="secondary-button" disabled={isImporting} onClick={onImportFolder}>
                  Import folder
                </button>
              </>
            ) : (
              <label className="primary-button">
                {isImporting ? 'Reading file...' : 'Import publication'}
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
              {isNativeRuntime ? 'Choose files or a folder; originals remain read-only' : 'Drop images or a CBZ anywhere on this shelf'}
            </span>
          </div>
        </div>

        <aside className="intro-aside" aria-label="Reader principles">
          <span className="aside-index">01—03</span>
          <p>Every source stays read-only. Derived pages and preferences live beside the reader, never in your files.</p>
          <div className="aside-rule" />
          <span className="aside-caption">BUILT FOR THE READING MOMENT</span>
        </aside>
      </section>

      <section className="library-toolbar" aria-label="Library tools">
        <div className="section-heading">
          <span className="eyebrow">THE SHELF</span>
          <strong>{visiblePublications.length.toString().padStart(2, '0')} publications</strong>
        </div>
        <div className="toolbar-controls">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search your shelf" />
          </label>
          <label className="sort-field">
            <span>Sort</span>
            <select value={sort} onChange={(event) => onSortChange(event.target.value as 'recent' | 'title')}>
              <option value="recent">Recent</option>
              <option value="title">Title</option>
            </select>
          </label>
          <label className="favorite-filter" htmlFor="favorite-only">
            <input
              id="favorite-only"
              type="checkbox"
              checked={favoriteOnly}
              onChange={(event) => onFavoriteOnlyChange(event.target.checked)}
            />
            <span>Favorites only</span>
          </label>
        </div>
      </section>

      {diagnostic && <div className="diagnostic-banner" role="alert">{diagnostic}</div>}

      {visiblePublications.length > 0 ? (
        <section className="publication-grid" aria-label="Publications">
          {visiblePublications.map((publication) => (
            <article className="publication-card" key={publication.id}>
              <button className="cover-button" type="button" onClick={() => onOpen(publication)} aria-label={`Open ${publication.title}`}>
                <img src={publication.pages[0]?.src} alt="" />
                <span className="cover-edge" aria-hidden="true" />
                <span className="cover-stamp">{publication.format === 'demo' ? 'STUDY' : publication.format.toUpperCase()}</span>
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
                    aria-label={`${publication.isFavorite ? 'Remove' : 'Add'} ${publication.title} to favorites`}
                    onClick={() => void onToggleFavorite(publication)}
                  >
                    <span aria-hidden="true">{publication.isFavorite ? '★' : '☆'}</span>
                  </button>
                  <button className="open-link" type="button" onClick={() => onOpen(publication)}>Open <span aria-hidden="true">↗</span></button>
                </div>
              </div>
              <div className="progress-line" aria-label={formatProgress(publication.progress)}>
                <span style={{ width: `${publication.progress * 100}%` }} />
              </div>
              <div className="card-footer">
                <span>{publication.pages.length} pages</span>
                <span>{formatProgress(publication.progress)}</span>
                <button
                  className="delete-link"
                  type="button"
                  aria-label={`Remove ${publication.title} from library`}
                  onClick={(event) => {
                    deleteTriggerRef.current = event.currentTarget;
                    setPendingDelete(publication);
                  }}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-shelf">
          <span className="empty-mark" aria-hidden="true">∅</span>
          <h2>No publication matches that search.</h2>
          <p>{isNativeRuntime
            ? 'Clear the search or use Import publication to choose a supported file.'
            : 'Clear the search or drop a supported image set/CBZ onto the shelf.'}</p>
        </section>
      )}

      <footer className="library-footer">
        <span>TACTILE READER / LOCAL-FIRST WINDOWS EDITION</span>
        <span>60 FPS TARGET · LTR / RTL · REDUCED MOTION</span>
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
            <span className="eyebrow">LOCAL READER DATA</span>
            <h2 id="remove-publication-title">Remove {pendingDelete.title}?</h2>
            <p id="remove-publication-copy">
              This removes the reader copy, progress, bookmarks, and derived pages only. Your original file will be preserved.
            </p>
            {deleteError && <p className="dialog-error" role="alert">{deleteError}</p>}
            <div className="dialog-actions">
              <button
                ref={deleteCancelRef}
                className="secondary-button"
                type="button"
                disabled={isDeleting}
                aria-label="Keep publication"
                onClick={(event) => {
                  event.currentTarget.blur();
                  restoreTriggerOnCloseRef.current = true;
                  setPendingDelete(null);
                }}
              >
                Keep publication
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={isDeleting}
                aria-label={`Confirm remove ${pendingDelete.title}`}
                onClick={confirmDelete}
              >
                {isDeleting ? 'Removing...' : 'Remove from library'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
