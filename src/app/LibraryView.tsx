import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { comparePublicationsBySeries, publicationSeries } from '../domain/seriesMatching';
import { filterPublications, mostRecentPublication, safeSourceName, visiblePublications as getVisiblePublications, type FormatFilter, type LibrarySort, type ReadingStatusFilter } from '../domain/library';
import { publicationCoverSrc } from '../domain/covers';
import type { Publication } from '../domain/types';
import { evaluateAchievements, isCurrentHourNight } from '../domain/achievements';
import { loadAchievementsMap, loadAllReviews, loadReadingStats, saveReview as saveReviewStorage, clearReview as clearReviewStorage } from '../services/storage';
import type { PublicationReview } from '../domain/reviews';
import { t } from '../i18n/catalog';
import { CollectionIcon, FlameIcon, SearchIcon, SparklesIcon, StarFilledIcon, StarIcon, SyncIcon } from './Icons';
import { ReadingStatsModal } from './ReadingStatsModal';
import { ReviewModal } from './ReviewModal';
import { RecapModal } from './RecapModal';
import { SyncModal } from './SyncModal';

interface LibraryViewProps {
  publications: Publication[];
  query: string;
  sort: LibrarySort;
  diagnostic?: string;
  isImporting: boolean;
  importProgress?: ImportProgress | null;
  canRetryImport?: boolean;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onOpen: (publication: Publication) => void;
  onImport: (files: File[]) => void;
  isNativeRuntime: boolean;
  onImportNative: () => void;
  onRetryImport?: () => void;
  onImportFolder: () => void;
  onOpenSettings: () => void;
  onToggleFavorite: (publication: Publication) => void | Promise<void>;
  onMarkRead?: (publication: Publication) => void | Promise<void>;
  onDelete: (publication: Publication) => void | Promise<void>;
  onReplaceCover: (publication: Publication, file: File) => void | Promise<void>;
  onCoverError?: (publication: Publication) => void;
  onChooseNativeCover: (publication: Publication) => void | Promise<void>;
  onResetCover: (publication: Publication) => void | Promise<void>;
  onRebuildCache?: (publication: Publication) => void | Promise<void>;
  favoriteOnly: boolean;
  onFavoriteOnlyChange: (favoriteOnly: boolean) => void;
  formatFilter: FormatFilter;
  onFormatFilterChange: (filter: FormatFilter) => void;
  statusFilter: ReadingStatusFilter;
  onStatusFilterChange: (filter: ReadingStatusFilter) => void;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
}

export interface ImportProgress {
  phase: 'selecting' | 'processing' | 'finishing';
  total?: number;
  completed?: number;
  currentName?: string;
  failed?: number;
}

function formatProgress(progress: number): string {
  return t('library.progress', { percent: Math.round(progress * 100) });
}

interface SeriesFolder {
  key: string;
  label: string;
  publications: Publication[];
  cover: Publication;
  possibleDuplicates: number;
}

function duplicateSignatures(publications: Publication[]): Map<string, number> {
  const groups = new Map<string, Publication[]>();
  publications.forEach((publication) => {
    const series = publicationSeries(publication);
    // This is intentionally conservative: equal series, edition and page
    // count are a review cue, never evidence that a file should be deleted.
    const signature = `${series.key}\u0000${series.number ?? publication.title.trim().toLowerCase()}\u0000${publication.pageCount}`;
    groups.set(signature, [...(groups.get(signature) ?? []), publication]);
  });
  const matches = new Map<string, number>();
  groups.forEach((group) => {
    if (group.length > 1) group.forEach((publication) => matches.set(publication.id, group.length));
  });
  return matches;
}

function LazyCoverImage({
  src,
  fallbackSrc,
  alt,
  loading,
  onError,
}: {
  src: string;
  fallbackSrc?: string;
  alt: string;
  loading?: 'eager' | 'lazy';
  onError?: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const canObserve = typeof window !== 'undefined' && 'IntersectionObserver' in window;
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() => canObserve ? undefined : src);

  useEffect(() => {
    if (!src) return undefined;
    if (!canObserve) {
      setResolvedSrc(src);
      return undefined;
    }
    const element = imageRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setResolvedSrc(src);
        observer.disconnect();
      }
    }, { rootMargin: '320px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canObserve, src]);

  useEffect(() => {
    setResolvedSrc((current) => current === undefined ? current : src);
  }, [src]);

  return (
    <img
      ref={imageRef}
      className="cover-image"
      src={resolvedSrc}
      alt={alt}
      loading={loading}
      decoding="async"
      onLoad={(event) => event.currentTarget.classList.add('cover-image--loaded')}
      onError={() => {
        if (fallbackSrc && resolvedSrc !== fallbackSrc) {
          setResolvedSrc(fallbackSrc);
          onError?.();
        }
      }}
    />
  );
}

export function LibraryView({
  publications,
  query,
  sort,
  diagnostic,
  isImporting,
  importProgress = null,
  canRetryImport = false,
  onQueryChange,
  onSortChange,
  onOpen,
  onImport,
  isNativeRuntime,
  onImportNative,
  onRetryImport,
  onImportFolder,
  onOpenSettings,
  onToggleFavorite,
  onMarkRead,
  onDelete,
  onReplaceCover,
  onCoverError = () => undefined,
  onChooseNativeCover,
  onResetCover,
  onRebuildCache,
  favoriteOnly,
  onFavoriteOnlyChange,
  formatFilter,
  onFormatFilterChange,
  statusFilter,
  onStatusFilterChange,
  settingsTriggerRef,
}: LibraryViewProps) {
  const [pendingDelete, setPendingDelete] = useState<Publication | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);

  // New Features State
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<Publication | null>(null);
  const [recapTarget, setRecapTarget] = useState<Publication | null>(null);
  const [ratingFilter, setRatingFilter] = useState<number>(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPublicationIds, setSelectedPublicationIds] = useState<Set<string>>(() => new Set());
  // Android starts in the lightweight series shelf. The browser harness keeps
  // its flat view so drag-and-drop work stays immediate and familiar.
  const [groupBySeries, setGroupBySeries] = useState(() => isNativeRuntime);
  const [openSeriesKey, setOpenSeriesKey] = useState<string | null>(null);
  const [showPossibleDuplicates, setShowPossibleDuplicates] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [renderLimit, setRenderLimit] = useState(40);

  const [readingStats, setReadingStats] = useState(loadReadingStats);
  const [achievementsMap, setAchievementsMap] = useState(loadAchievementsMap);
  const [reviewsMap, setReviewsMap] = useState<Record<string, PublicationReview>>(loadAllReviews);

  const refreshUserData = () => {
    setReadingStats(loadReadingStats());
    setAchievementsMap(loadAchievementsMap());
    setReviewsMap(loadAllReviews());
  };

  const achievements = useMemo(() => {
    const completedCount = publications.filter((p) => p.progress >= 1).length;
    const { list } = evaluateAchievements({
      stats: readingStats,
      publicationCount: publications.length,
      completedCount,
      existingUnlockedMap: achievementsMap,
      isNightHour: isCurrentHourNight(),
    });
    return list;
  }, [readingStats, publications, achievementsMap]);

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
    const filtered = filterPublications(publications, formatFilter, statusFilter);
    let visible = getVisiblePublications(filtered, query, sort);
    if (favoriteOnly) {
      visible = visible.filter((publication) => publication.isFavorite);
    }
    if (ratingFilter > 0) {
      visible = visible.filter((publication) => {
        const review = reviewsMap[publication.id];
        return review && review.rating >= ratingFilter;
      });
    }
    return visible;
  }, [favoriteOnly, formatFilter, publications, query, sort, statusFilter, ratingFilter, reviewsMap]);
  const possibleDuplicateCounts = useMemo(() => duplicateSignatures(publications), [publications]);
  const filteredPublications = useMemo(
    () => showPossibleDuplicates
      ? visiblePublications.filter((publication) => possibleDuplicateCounts.has(publication.id))
      : visiblePublications,
    [possibleDuplicateCounts, showPossibleDuplicates, visiblePublications],
  );
  const seriesFolders = useMemo(() => {
    const folders = new Map<string, SeriesFolder>();
    [...filteredPublications].sort(comparePublicationsBySeries).forEach((publication) => {
      const series = publicationSeries(publication);
      const existing = folders.get(series.key);
      if (existing) {
        existing.publications.push(publication);
        if (possibleDuplicateCounts.has(publication.id)) existing.possibleDuplicates += 1;
        return;
      }
      folders.set(series.key, {
        key: series.key,
        label: series.label,
        publications: [publication],
        cover: publication,
        possibleDuplicates: possibleDuplicateCounts.has(publication.id) ? 1 : 0,
      });
    });
    return [...folders.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' }));
  }, [filteredPublications, possibleDuplicateCounts]);
  const openSeries = useMemo(
    () => seriesFolders.find((folder) => folder.key === openSeriesKey) ?? null,
    [openSeriesKey, seriesFolders],
  );
  const orderedPublications = useMemo(() => {
    if (groupBySeries && openSeries) return openSeries.publications;
    return groupBySeries ? [] : filteredPublications;
  }, [filteredPublications, groupBySeries, openSeries]);
  const displayPublications = useMemo(
    () => orderedPublications.slice(0, renderLimit),
    [orderedPublications, renderLimit],
  );
  const selectedPublications = useMemo(
    () => publications.filter((publication) => selectedPublicationIds.has(publication.id)),
    [publications, selectedPublicationIds],
  );
  const continuePublication = useMemo(() => mostRecentPublication(publications), [publications]);
  const hasActiveFilters = Boolean(query.trim() || favoriteOnly || formatFilter !== 'all' || statusFilter !== 'all' || ratingFilter > 0 || showPossibleDuplicates);

  useEffect(() => {
    setSelectedPublicationIds((current) => {
      const available = new Set(publications.map((publication) => publication.id));
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [publications]);

  useEffect(() => {
    setRenderLimit(40);
  }, [groupBySeries, openSeriesKey, query, sort, formatFilter, statusFilter, favoriteOnly, ratingFilter, showPossibleDuplicates]);

  useEffect(() => {
    if (openSeriesKey && !openSeries) setOpenSeriesKey(null);
  }, [openSeries, openSeriesKey]);

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

  const toggleSelectedPublication = (publicationId: string) => {
    setSelectedPublicationIds((current) => {
      const next = new Set(current);
      if (next.has(publicationId)) next.delete(publicationId);
      else next.add(publicationId);
      return next;
    });
  };

  const clearSelection = () => setSelectedPublicationIds(new Set());

  const selectAllVisible = () => {
    setSelectedPublicationIds(new Set(orderedPublications.map((publication) => publication.id)));
  };

  const markSelectedRead = async () => {
    if (!onMarkRead || selectedPublications.length === 0) return;
    await Promise.all(selectedPublications.map((publication) => onMarkRead(publication)));
    clearSelection();
    setSelectionMode(false);
  };

  const removeSelected = async () => {
    if (selectedPublications.length === 0) return;
    for (const publication of selectedPublications) {
      await onDelete(publication);
    }
    clearSelection();
    setSelectionMode(false);
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
          <button
            type="button"
            className="library-streak-pill"
            onClick={() => setStatsModalOpen(true)}
            aria-label="Ver hábitos de leitura e conquistas"
            title="Sequência de Leitura & Conquistas"
          >
            <FlameIcon />
            <span>{readingStats.currentStreak} {readingStats.currentStreak === 1 ? 'dia' : 'dias'}</span>
          </button>
          <button
            type="button"
            className="quiet-button library-sync-btn"
            onClick={() => setSyncModalOpen(true)}
            aria-label="Sincronizar entre dispositivos"
            title="Sincronização Nuvem & Dispositivos"
          >
            <SyncIcon />
            <span>Sync</span>
          </button>
          <span className="privacy-chip"><span className="status-dot" /> {t('library.deviceOnly')}</span>
          <button ref={settingsTriggerRef} className="quiet-button" onClick={onOpenSettings}>{t('library.settings')}</button>
        </div>
      </header>

      {continuePublication && (
        <section
          className="continue-card"
          aria-label={t('library.continueReading')}
          style={{ '--continue-progress': `${Math.round(continuePublication.progress * 100)}%` } as CSSProperties}
        >
          <img
            className="continue-cover cover-image"
            src={publicationCoverSrc(continuePublication)}
            alt=""
            loading="eager"
            decoding="async"
            onLoad={(event) => event.currentTarget.classList.add('cover-image--loaded')}
          />
          <div className="continue-copy">
            <span className="eyebrow">{t('library.pickUp')}</span>
            <strong className="continue-title">{continuePublication.title}</strong>
            <p>{formatProgress(continuePublication.progress)} · {t('reader.pageOf', { page: continuePublication.currentPage + 1, count: continuePublication.pageCount })}</p>
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
                  accept=".cbz,.cbr,.rar,.pdf,image/*"
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

      <section className={`library-toolbar ${filtersOpen ? 'library-toolbar--filters-open' : ''}`} aria-label={t('library.tools')}>
        <div className="section-heading">
          <span className="eyebrow">{t('library.shelf')}</span>
          <strong>{t('library.publications', { count: visiblePublications.length })}</strong>
        </div>
        <div className="toolbar-controls">
          <label className="search-field">
            <SearchIcon />
            <input className="library-focus-control" aria-label={t('library.searchAria')} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t('library.search')} />
          </label>
          <label className="sort-field">
            <span>{t('library.sort')}</span>
            <select className="library-focus-control" aria-label={t('library.sortAria')} value={sort} onChange={(event) => onSortChange(event.target.value as LibrarySort)}>
              <option value="recent">{t('library.sortRecent')}</option>
              <option value="title">{t('library.sortTitle')}</option>
              <option value="added">{t('library.sortAdded')}</option>
              <option value="year">{t('library.sortYear')}</option>
            </select>
          </label>
          <label className="sort-field format-filter-field">
            <span>{t('library.filterFormat')}</span>
            <select
              className="library-focus-control"
              aria-label={t('library.filterFormat')}
              value={formatFilter}
              onChange={(event) => onFormatFilterChange(event.target.value as FormatFilter)}
            >
              <option value="all">{t('library.filterFormatAll')}</option>
              <option value="cbz">CBZ</option>
              <option value="cbr">CBR</option>
              <option value="pdf">PDF</option>
              <option value="images">Images</option>
            </select>
          </label>
          <label className="sort-field status-filter-field">
            <span>{t('library.filterStatus')}</span>
            <select
              className="library-focus-control"
              aria-label={t('library.filterStatus')}
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value as ReadingStatusFilter)}
            >
              <option value="all">{t('library.filterStatusAll')}</option>
              <option value="unread">{t('library.filterStatusUnread')}</option>
              <option value="reading">{t('library.filterStatusReading')}</option>
              <option value="completed">{t('library.filterStatusCompleted')}</option>
            </select>
          </label>
          <label className="sort-field rating-filter-field">
            <span>{t('library.rating')}</span>
            <select
              className="library-focus-control"
              aria-label="Filtrar por avaliação"
              value={ratingFilter}
              onChange={(event) => setRatingFilter(Number(event.target.value))}
            >
              <option value={0}>{t('library.ratingAll')}</option>
              <option value={5}>{t('library.ratingAtLeast', { count: 5 })}</option>
              <option value={4}>{t('library.ratingAtLeast', { count: 4 })}</option>
              <option value={3}>{t('library.ratingAtLeast', { count: 3 })}</option>
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
          <button
            type="button"
            className={`library-view-toggle ${groupBySeries ? 'library-view-toggle--active' : ''}`}
            aria-pressed={groupBySeries}
            onClick={() => {
              setGroupBySeries((current) => !current);
              setOpenSeriesKey(null);
            }}
          >
            {groupBySeries ? t('library.grouped') : t('library.group')}
          </button>
          {possibleDuplicateCounts.size > 0 && (
            <button
              type="button"
              className={`library-view-toggle ${showPossibleDuplicates ? 'library-view-toggle--active' : ''}`}
              aria-pressed={showPossibleDuplicates}
              onClick={() => {
                setShowPossibleDuplicates((current) => !current);
                setOpenSeriesKey(null);
              }}
            >
              {t('library.possibleDuplicates', { count: possibleDuplicateCounts.size })}
            </button>
          )}
          <button
            type="button"
            className={`library-view-toggle library-filter-toggle ${filtersOpen ? 'library-view-toggle--active' : ''}`}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            {filtersOpen ? t('library.hideFilters') : t('library.filters')}
          </button>
          {(!groupBySeries || openSeries) && <button
            type="button"
            className={`library-view-toggle ${selectionMode ? 'library-view-toggle--active' : ''}`}
            aria-pressed={selectionMode}
            onClick={() => {
              setSelectionMode((current) => !current);
              if (selectionMode) clearSelection();
            }}
          >
            {selectionMode ? t('library.done') : t('library.select')}
          </button>}
        </div>
      </section>

      {diagnostic && (
        <div className={`diagnostic-banner ${canRetryImport ? 'diagnostic-banner--with-action' : ''}`} role="alert">
          <span>{diagnostic}</span>
          {canRetryImport && onRetryImport && (
            <button type="button" className="quiet-button" disabled={isImporting} onClick={onRetryImport}>
              {t('library.retryImport')}
            </button>
          )}
        </div>
      )}

      {importProgress && (
        <section
          className={`import-progress ${importProgress.completed !== undefined && importProgress.total !== undefined ? 'import-progress--determinate' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy={importProgress.phase !== 'finishing'}
        >
          <div className="import-progress__copy">
            <span className="import-progress__mark" aria-hidden="true" />
            <div>
              <strong>
                {importProgress.phase === 'selecting'
          ? t('library.importChoose')
          : importProgress.phase === 'finishing'
                    ? t('library.importFinishing')
                    : importProgress.total
                      ? t('library.importingItems', { count: importProgress.total })
                      : t('library.importing')}
              </strong>
              <span>
                {importProgress.currentName
                  ? `${t('library.importProgress', { completed: importProgress.completed ?? 0, total: importProgress.total ?? '?' })} · ${importProgress.currentName}${importProgress.failed ? ` · ${t('library.importFailedCount', { count: importProgress.failed })}` : ''}`
                  : importProgress.completed !== undefined && importProgress.total
                    ? t('library.importProgress', { completed: importProgress.completed, total: importProgress.total })
                    : t('library.importOriginals')}
              </span>
            </div>
          </div>
          <div className="import-progress__track" aria-hidden="true">
            <span style={{ width: importProgress.completed !== undefined && importProgress.total ? `${Math.min(100, (importProgress.completed / importProgress.total) * 100)}%` : undefined }} />
          </div>
        </section>
      )}

      {selectionMode && (!groupBySeries || openSeries) && (
        <section className="library-selection-toolbar" aria-label={t('library.batchActions')}>
          <span>{t('library.selected', { count: selectedPublications.length })}</span>
          <button type="button" className="quiet-button" onClick={selectAllVisible}>{t('library.selectVisible')}</button>
          {onMarkRead && <button type="button" className="quiet-button" disabled={selectedPublications.length === 0} onClick={() => void markSelectedRead()}>{t('library.markRead')}</button>}
          <button type="button" className="quiet-button quiet-button--danger" disabled={selectedPublications.length === 0} onClick={() => void removeSelected()}>{t('library.removeSelected')}</button>
          {selectedPublications.length > 0 && <button type="button" className="quiet-button" onClick={clearSelection}>{t('library.clearSelection')}</button>}
        </section>
      )}

      {filteredPublications.length > 0 ? (
        <>
        {groupBySeries && !openSeries && (
          <section className="series-grid" aria-label={t('library.seriesAria')}>
            {seriesFolders.slice(0, renderLimit).map((folder, index) => (
              <article className="series-card" key={folder.key} data-testid="library-series-card" data-series-key={folder.key}>
                <button
                  className="series-card__open"
                  type="button"
                  onClick={() => setOpenSeriesKey(folder.key)}
                  aria-label={t('library.openSeries', { title: folder.label })}
                >
                  <span className="series-card__cover" aria-hidden="true">
                    <LazyCoverImage
                      src={publicationCoverSrc(folder.cover)}
                      fallbackSrc={folder.cover.coverSrc}
                      alt=""
                      loading={index < 4 ? 'eager' : 'lazy'}
                    />
                    <span className="series-card__collection"><CollectionIcon /></span>
                  </span>
                  <span className="series-card__copy">
                    <strong>{folder.label}</strong>
                    <small>{t('library.volumes', { count: folder.publications.length })}</small>
                    {folder.possibleDuplicates > 0 && (
                      <em>{t('library.possibleDuplicates', { count: folder.possibleDuplicates })}</em>
                    )}
                  </span>
                </button>
              </article>
            ))}
          </section>
        )}
        {groupBySeries && openSeries && (
          <div className="series-breadcrumb" aria-label={t('library.seriesNavigation')}>
            <button type="button" className="quiet-button" onClick={() => setOpenSeriesKey(null)}>{t('library.allSeries')}</button>
            <span aria-hidden="true">/</span>
            <strong>{openSeries.label}</strong>
            <small>{t('library.volumes', { count: openSeries.publications.length })}</small>
          </div>
        )}
        {(!groupBySeries || openSeries) && <section className="publication-grid" aria-label={t('library.publicationsAria')}>
          {displayPublications.map((publication, index) => {
            return (
            <article
              className={`publication-card ${selectedPublicationIds.has(publication.id) ? 'publication-card--selected' : ''}`}
              key={publication.id}
              data-testid="library-publication-card"
              data-publication-id={publication.id}
              data-publication-format={publication.format}
              data-publication-source={publication.sourceLabel}
            >
              {selectionMode && (
                <label className="publication-select" aria-label={t('library.selectPublication', { title: publication.title })}>
                  <input
                    type="checkbox"
                    checked={selectedPublicationIds.has(publication.id)}
                    onChange={() => toggleSelectedPublication(publication.id)}
                  />
                  <span aria-hidden="true" />
                </label>
              )}
              <button className="cover-button" type="button" onClick={() => onOpen(publication)} aria-label={t('library.open', { title: publication.title })}>
                <LazyCoverImage
                  src={publicationCoverSrc(publication)}
                  fallbackSrc={publication.coverSrc}
                  alt=""
                  loading={index < 4 ? 'eager' : 'lazy'}
                  onError={() => {
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
                  <p className="eyebrow">{safeSourceName(publication.sourceLabel)}</p>
                  <h2>{publication.title}</h2>
                  {possibleDuplicateCounts.has(publication.id) && (
                    <p className="possible-duplicate">{t('library.possibleDuplicate')}</p>
                  )}
                  {(publication.metadata?.series || publication.metadata?.year || publication.metadata?.publisher) && (
                    <p className="publication-submeta">
                      {[publication.metadata?.series, publication.metadata?.year, publication.metadata?.publisher]
                        .filter((value) => value !== undefined && value !== '')
                        .join(' · ')}
                    </p>
                  )}
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

              {/* Review & Rating Banner */}
              <div className="card-review-bar">
                <button
                  type="button"
                  className="card-review-btn"
                  onClick={() => setReviewTarget(publication)}
                  aria-label={t('review.title')}
                  title={t('review.title')}
                >
                  {reviewsMap[publication.id]?.rating ? (
                    <span className="card-stars-filled">
                      {Array.from({ length: reviewsMap[publication.id].rating }).map((_, i) => (
                        <StarFilledIcon key={i} />
                      ))}
                      <small>{reviewsMap[publication.id].rating}/5</small>
                    </span>
                  ) : (
                    <span className="card-stars-empty">
                      <StarIcon />
                      <small>{t('review.rateThis')}</small>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="card-recap-btn"
                  onClick={() => setRecapTarget(publication)}
                  aria-label={t('recap.button')}
                  title={t('recap.title')}
                >
                  <SparklesIcon />
                  <span>Recap</span>
                </button>
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
                {isNativeRuntime && onRebuildCache && publication.format !== 'demo' && (
                  <button className="quiet-button" type="button" aria-label={t('library.rebuildCache')} onClick={() => void onRebuildCache(publication)}>
                    {t('library.rebuildCache')}
                  </button>
                )}
              </div>
              {publication.diagnostic && <p className="diagnostic-banner publication-diagnostic" role="alert">{publication.diagnostic}</p>}
              <div className="progress-line" aria-label={formatProgress(publication.progress)}>
                <span style={{ width: `${publication.progress * 100}%` }} />
              </div>
              <div className="card-footer">
                <span>{t('library.pages', { count: publication.pageCount })}</span>
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
            );
          })}
        </section>}
        {((groupBySeries && !openSeries ? seriesFolders.length : orderedPublications.length) > renderLimit) && (
          <div className="library-load-more">
            <button type="button" className="secondary-button" onClick={() => setRenderLimit((current) => Math.min(current + 40, groupBySeries && !openSeries ? seriesFolders.length : orderedPublications.length))}>
              {t('library.loadMore')} · {Math.min(renderLimit, groupBySeries && !openSeries ? seriesFolders.length : orderedPublications.length)}/{groupBySeries && !openSeries ? seriesFolders.length : orderedPublications.length}
            </button>
          </div>
        )}
        </>
      ) : (
        <section className="empty-shelf">
          <span className="empty-mark" aria-hidden="true">∅</span>
          <h2>{t('library.emptyTitle')}</h2>
          <p>{isNativeRuntime
            ? t('library.emptyNative')
            : t('library.emptyBrowser')}</p>
          {hasActiveFilters && (
            <button
              type="button"
              className="secondary-button empty-shelf__clear"
              onClick={() => {
                onQueryChange('');
                onFavoriteOnlyChange(false);
                onFormatFilterChange('all');
                onStatusFilterChange('all');
                setRatingFilter(0);
              }}
            >
              {t('library.clearFilters')}
            </button>
          )}
        </section>
      )}

      <footer className="library-footer">
        <span>{t('library.footerEdition')}</span>
        <span>{t('library.footerFeatures')}</span>
      </footer>

      <div className="mobile-import-actions" aria-label={t('library.importOptions')}>
        <button
          className="mobile-import-folder"
          type="button"
          disabled={isImporting}
          onClick={() => isNativeRuntime && onImportFolder()}
        >
          <span aria-hidden="true">▣</span>
          {t('library.importFolder')}
        </button>
        <button
          className="mobile-import-fab"
          type="button"
          disabled={isImporting}
          onClick={() => isNativeRuntime && onImportNative()}
        >
          <span aria-hidden="true">+</span>
          {isImporting ? t('library.importing') : t('library.importComic')}
        </button>
      </div>

      {statsModalOpen && (
        <ReadingStatsModal
          stats={readingStats}
          achievements={achievements}
          onClose={() => setStatsModalOpen(false)}
        />
      )}

      {syncModalOpen && (
        <SyncModal
          onClose={() => setSyncModalOpen(false)}
          onSyncApplied={refreshUserData}
        />
      )}

      {reviewTarget && (
        <ReviewModal
          publication={reviewTarget}
          initialReview={reviewsMap[reviewTarget.id]}
          onSave={(review) => {
            saveReviewStorage(review);
            refreshUserData();
          }}
          onDelete={(id) => {
            clearReviewStorage(id);
            refreshUserData();
          }}
          onClose={() => setReviewTarget(null)}
        />
      )}

      {recapTarget && (
        <RecapModal
          publication={recapTarget}
          currentPageIndex={recapTarget.currentPage}
          onClose={() => setRecapTarget(null)}
        />
      )}

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
