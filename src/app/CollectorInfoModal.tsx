import type { Publication } from '../domain/types';
import { CloseIcon } from './Icons';

export interface CollectorInfoModalProps {
  publication: Publication;
  onClose: () => void;
}

export function CollectorInfoModal({ publication, onClose }: CollectorInfoModalProps) {
  const meta = publication.metadata;
  const hasCredits = meta && (meta.writer || meta.penciller || meta.inker || meta.colorist || meta.letterer || meta.coverArtist || meta.editor);

  return (
    <div className="collector-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="collector-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Ficha Técnica - ${publication.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="collector-modal-header">
          <div className="collector-modal-title-area">
            <span className="collector-modal-eyebrow">Ficha de Colecionador</span>
            <h2>{meta?.title || publication.title}</h2>
            {meta?.series && (
              <p className="collector-modal-series">
                <strong>{meta.series}</strong>
                {meta.number && <span className="collector-badge">#{meta.number}</span>}
                {meta.volume && <span className="collector-badge">Vol. {meta.volume}</span>}
                {meta.year && <span className="collector-badge-subtle">{meta.year}</span>}
              </p>
            )}
          </div>
          <button
            type="button"
            className="collector-modal-close"
            onClick={onClose}
            aria-label="Fechar ficha técnica"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="collector-modal-body">
          {/* Cover and Primary Meta */}
          <div className="collector-hero-row">
            {publication.coverSrc && (
              <img
                src={publication.coverSrc}
                alt={`Capa de ${publication.title}`}
                className="collector-cover-thumb"
              />
            )}
            <div className="collector-meta-grid">
              {meta?.publisher && (
                <div className="collector-meta-field">
                  <span className="collector-field-label">Editora</span>
                  <span className="collector-field-value">{meta.publisher}</span>
                </div>
              )}
              {meta?.year && (
                <div className="collector-meta-field">
                  <span className="collector-field-label">Lançamento</span>
                  <span className="collector-field-value">{meta.month ? `${meta.month}/${meta.year}` : meta.year}</span>
                </div>
              )}
              <div className="collector-meta-field">
                <span className="collector-field-label">Páginas</span>
                <span className="collector-field-value">{publication.pageCount} páginas</span>
              </div>
              <div className="collector-meta-field">
                <span className="collector-field-label">Formato</span>
                <span className="collector-field-value uppercase">{publication.format}</span>
              </div>
              {meta?.genre && (
                <div className="collector-meta-field">
                  <span className="collector-field-label">Gênero</span>
                  <span className="collector-field-value">{meta.genre}</span>
                </div>
              )}
            </div>
          </div>

          {/* Synopsis */}
          {meta?.summary && (
            <div className="collector-section">
              <h3>Sinopse da Edição</h3>
              <p className="collector-summary-text">{meta.summary}</p>
            </div>
          )}

          {/* Creative Credits */}
          {hasCredits && (
            <div className="collector-section">
              <h3>Equipe Criativa</h3>
              <div className="collector-credits-grid">
                {meta?.writer && (
                  <div className="collector-credit-chip">
                    <span className="credit-role">Roteiro</span>
                    <strong className="credit-name">{meta.writer}</strong>
                  </div>
                )}
                {meta?.penciller && (
                  <div className="collector-credit-chip">
                    <span className="credit-role">Arte / Desenho</span>
                    <strong className="credit-name">{meta.penciller}</strong>
                  </div>
                )}
                {meta?.inker && (
                  <div className="collector-credit-chip">
                    <span className="credit-role">Arte-Final</span>
                    <strong className="credit-name">{meta.inker}</strong>
                  </div>
                )}
                {meta?.colorist && (
                  <div className="collector-credit-chip">
                    <span className="credit-role">Cores</span>
                    <strong className="credit-name">{meta.colorist}</strong>
                  </div>
                )}
                {meta?.letterer && (
                  <div className="collector-credit-chip">
                    <span className="credit-role">Letras</span>
                    <strong className="credit-name">{meta.letterer}</strong>
                  </div>
                )}
                {meta?.coverArtist && (
                  <div className="collector-credit-chip">
                    <span className="credit-role">Capa</span>
                    <strong className="credit-name">{meta.coverArtist}</strong>
                  </div>
                )}
                {meta?.editor && (
                  <div className="collector-credit-chip">
                    <span className="credit-role">Edição</span>
                    <strong className="credit-name">{meta.editor}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Characters and Tags */}
          {meta?.characters && meta.characters.length > 0 && (
            <div className="collector-section">
              <h3>Personagens</h3>
              <div className="collector-tags-row">
                {meta.characters.map((char) => (
                  <span key={char} className="collector-char-tag">👤 {char}</span>
                ))}
              </div>
            </div>
          )}

          {meta?.tags && meta.tags.length > 0 && (
            <div className="collector-section">
              <h3>Tags</h3>
              <div className="collector-tags-row">
                {meta.tags.map((tag) => (
                  <span key={tag} className="collector-tag">🏷️ {tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
