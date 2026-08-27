import { describe, expect, it } from 'vitest';
import {
  createEmptyReview,
  normalizeReview,
  normalizeReviewMap,
} from './reviews';

describe('reviews domain', () => {
  it('creates default empty review', () => {
    const review = createEmptyReview('pub-1');
    expect(review.publicationId).toBe('pub-1');
    expect(review.rating).toBe(0);
    expect(review.reviewText).toBe('');
    expect(review.updatedAt).toBeDefined();
  });

  it('normalizes valid review objects and clamps ratings from 0 to 5', () => {
    const valid = {
      publicationId: 'pub-1',
      rating: 4.8,
      reviewText: 'Excelente roteiro e arte impecável!',
      updatedAt: '2026-08-27T10:00:00.000Z',
    };

    const normalized = normalizeReview(valid);
    expect(normalized).not.toBeNull();
    expect(normalized?.rating).toBe(5);
    expect(normalized?.reviewText).toBe('Excelente roteiro e arte impecável!');

    // Test rating clamping
    const overflow = normalizeReview({ publicationId: 'pub-2', rating: 10, reviewText: '' });
    expect(overflow?.rating).toBe(5);

    const underflow = normalizeReview({ publicationId: 'pub-2', rating: -2, reviewText: '' });
    expect(underflow?.rating).toBe(0);
  });

  it('normalizes reviews map cleanly', () => {
    expect(normalizeReviewMap(null)).toEqual({});
    expect(normalizeReviewMap('invalid')).toEqual({});

    const map = {
      'pub-1': {
        publicationId: 'pub-1',
        rating: 5,
        reviewText: 'Masterpiece',
        updatedAt: '2026-08-01',
      },
      'bad-pub': 'not an object',
    };

    const normalized = normalizeReviewMap(map);
    expect(Object.keys(normalized)).toEqual(['pub-1']);
    expect(normalized['pub-1'].rating).toBe(5);
  });
});
