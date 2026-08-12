import { useMemo } from 'react';
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
}: LibraryViewProps) {
  const visiblePublications = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...publications]
      .filter((publication) => publication.title.toLowerCase().includes(normalizedQuery))
      .sort((left, right) =>
        sort === 'title'
          ? left.title.localeCompare(right.title)
          : right.updatedAt.localeCompare(left.updatedAt),
      );
  }, [publications, query, sort]);

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

  return (
    <main className="library-view" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
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
          <button className="quiet-button" onClick={onOpenSettings}>Reader settings</button>
        </div>
      </header>

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
        </div>
      </section>

      {diagnostic && <div className="diagnostic-banner" role="alert">{diagnostic}</div>}

      {visiblePublications.length > 0 ? (
        <section className="publication-grid" aria-label="Publications">
          {visiblePublications.map((publication) => (
            <article className="publication-card" key={publication.id}>
              <button className="cover-button" onClick={() => onOpen(publication)} aria-label={`Open ${publication.title}`}>
                <img src={publication.pages[0]?.src} alt="" />
                <span className="cover-edge" aria-hidden="true" />
                <span className="cover-stamp">{publication.format === 'demo' ? 'STUDY' : publication.format.toUpperCase()}</span>
              </button>
              <div className="publication-meta">
                <div>
                  <p className="eyebrow">{publication.sourceLabel}</p>
                  <h2>{publication.title}</h2>
                </div>
                <button className="open-link" onClick={() => onOpen(publication)}>Open <span aria-hidden="true">↗</span></button>
              </div>
              <div className="progress-line" aria-label={formatProgress(publication.progress)}>
                <span style={{ width: `${publication.progress * 100}%` }} />
              </div>
              <div className="card-footer">
                <span>{publication.pages.length} pages</span>
                <span>{formatProgress(publication.progress)}</span>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-shelf">
          <span className="empty-mark" aria-hidden="true">∅</span>
          <h2>No publication matches that search.</h2>
          <p>Clear the search or drop a supported image set/CBZ onto the shelf.</p>
        </section>
      )}

      <footer className="library-footer">
        <span>TACTILE READER / LOCAL-FIRST WINDOWS EDITION</span>
        <span>60 FPS TARGET · LTR / RTL · REDUCED MOTION</span>
      </footer>
    </main>
  );
}
