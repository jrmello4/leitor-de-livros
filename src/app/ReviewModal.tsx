import { useState } from 'react';
import type { PublicationReview } from '../domain/reviews';
import type { Publication } from '../domain/types';
import { t } from '../i18n/catalog';
import { CloseIcon, StarFilledIcon, StarIcon } from './Icons';

export interface ReviewModalProps {
  publication: Publication;
  initialReview?: PublicationReview | null;
  onSave: (review: PublicationReview) => void;
  onDelete?: (publicationId: string) => void;
  onClose: () => void;
}

export function ReviewModal({
  publication,
  initialReview,
  onSave,
  onDelete,
  onClose,
}: ReviewModalProps) {
  const [rating, setRating] = useState<number>(initialReview?.rating || 0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState<string>(initialReview?.reviewText || '');

  const handleSave = () => {
    onSave({
      publicationId: publication.id,
      rating,
      reviewText: reviewText.trim(),
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  const handleDelete = () => {
    onDelete?.(publication.id);
    onClose();
  };

  const activeRating = hoverRating || rating;

  return (
    <div className="collector-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="collector-modal-panel review-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Avaliar ${publication.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="collector-modal-header">
          <div className="collector-modal-title-area">
            <span className="collector-modal-eyebrow">{t('review.title')}</span>
            <h2>{publication.title}</h2>
          </div>
          <button
            type="button"
            className="collector-modal-close"
            onClick={onClose}
            aria-label="Fechar avaliação"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="collector-modal-body">
          <div className="review-stars-section">
            <span className="review-stars-label">{t('review.rateThis')}</span>
            <div className="review-stars-row" role="radiogroup" aria-label="Classificação por estrelas">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`review-star-btn ${star <= activeRating ? 'review-star-btn--filled' : ''}`}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star === rating ? 0 : star)}
                  aria-label={`${star} ${star === 1 ? 'estrela' : 'estrelas'}`}
                  aria-checked={rating === star}
                  role="radio"
                >
                  {star <= activeRating ? <StarFilledIcon /> : <StarIcon />}
                </button>
              ))}
              <span className="review-rating-count">
                {rating > 0 ? `${rating} / 5` : 'Sem nota'}
              </span>
            </div>
          </div>

          <div className="review-text-section">
            <textarea
              className="review-textarea"
              placeholder={t('review.placeholder')}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              rows={5}
              aria-label="Notas da avaliação"
            />
          </div>

          <div className="review-modal-actions">
            {initialReview && onDelete && (
              <button
                type="button"
                className="secondary-button review-delete-btn"
                onClick={handleDelete}
              >
                {t('review.delete')}
              </button>
            )}
            <div className="review-actions-right">
              <button type="button" className="secondary-button" onClick={onClose}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={handleSave}>
                {t('review.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
