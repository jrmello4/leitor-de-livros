export interface PublicationReview {
  publicationId: string;
  rating: number; // 0 (unrated) to 5
  reviewText: string;
  updatedAt: string;
}

export function createEmptyReview(publicationId: string): PublicationReview {
  return {
    publicationId,
    rating: 0,
    reviewText: '',
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeReview(value: unknown, fallbackPublicationId?: string): PublicationReview | null {
  if (!isRecord(value)) {
    return null;
  }

  const publicationId = typeof value.publicationId === 'string' && value.publicationId.trim().length > 0
    ? value.publicationId
    : (fallbackPublicationId || '');

  if (!publicationId) {
    return null;
  }

  const rawRating = typeof value.rating === 'number' ? value.rating : 0;
  const rating = Math.max(0, Math.min(5, Math.round(rawRating)));
  const reviewText = typeof value.reviewText === 'string' ? value.reviewText : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString();

  return {
    publicationId,
    rating,
    reviewText,
    updatedAt,
  };
}

export function normalizeReviewMap(value: unknown): Record<string, PublicationReview> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, PublicationReview> = {};
  for (const [id, rawReview] of Object.entries(value)) {
    const normalized = normalizeReview(rawReview, id);
    if (normalized) {
      result[id] = normalized;
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
