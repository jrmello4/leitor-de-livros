import { describe, expect, it } from 'vitest';
import { extractTitlePattern, findNextPublication } from './seriesMatching';
import type { Publication } from './types';

function createMockPublication(id: string, title: string, metadata?: Publication['metadata']): Publication {
  return {
    id,
    title,
    sourceLabel: title,
    format: 'cbz',
    pages: [],
    pageCount: 20,
    coverSrc: '',
    coverPageId: 'p1',
    currentPage: 0,
    progress: 0,
    direction: 'ltr',
    addedAt: '2026-01-01',
    updatedAt: '2026-01-01',
    isFavorite: false,
    metadata,
  };
}

describe('extractTitlePattern', () => {
  it('extracts series prefix and issue number from common formats', () => {
    expect(extractTitlePattern('Batman #01')).toEqual({ prefix: 'batman', number: 1 });
    expect(extractTitlePattern('Saga Vol. 2')).toEqual({ prefix: 'saga', number: 2 });
    expect(extractTitlePattern('One Piece Volume 104 (2022)')).toEqual({ prefix: 'one piece', number: 104 });
    expect(extractTitlePattern('Spider-Man - 15')).toEqual({ prefix: 'spider-man', number: 15 });
    expect(extractTitlePattern('Naruto ch 700')).toEqual({ prefix: 'naruto', number: 700 });
  });

  it('returns null for unnumbered titles', () => {
    expect(extractTitlePattern('Watchmen Deluxe Edition')).toBeNull();
  });
});

describe('findNextPublication', () => {
  it('prioritizes ComicInfo.xml metadata matching', () => {
    const pub1 = createMockPublication('1', 'Batman Court of Owls', { series: 'Batman', number: '1' });
    const pub2 = createMockPublication('2', 'Batman City of Owls', { series: 'Batman', number: '2' });
    const pub3 = createMockPublication('3', 'Superman #1', { series: 'Superman', number: '1' });

    const next = findNextPublication(pub1, [pub3, pub1, pub2]);
    expect(next?.id).toBe('2');
  });

  it('matches by title pattern when metadata is not available', () => {
    const pub1 = createMockPublication('1', 'Invincible #01');
    const pub2 = createMockPublication('2', 'Invincible #02');
    const pub3 = createMockPublication('3', 'Invincible #03');

    const next = findNextPublication(pub1, [pub3, pub1, pub2]);
    expect(next?.id).toBe('2');

    const nextFrom2 = findNextPublication(pub2, [pub3, pub1, pub2]);
    expect(nextFrom2?.id).toBe('3');
  });

  it('falls back to natural alphabetical sort successor', () => {
    const pubA = createMockPublication('a', 'Watchmen Chapter 1');
    const pubB = createMockPublication('b', 'Watchmen Chapter 2');

    const next = findNextPublication(pubA, [pubB, pubA]);
    expect(next?.id).toBe('b');
  });
});
