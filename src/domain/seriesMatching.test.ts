import { describe, expect, it } from 'vitest';
import { comparePublicationsBySeries, extractTitlePattern, findNextPublication, publicationSeries } from './seriesMatching';
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

  it('reads issue zero and ignores release dates, scan credits and subtitles after the issue', () => {
    expect(extractTitlePattern('Arqueiro Verde Absoluto #00 (2025) [Equipe]')).toEqual({ prefix: 'arqueiro verde absoluto', number: 0 });
    expect(extractTitlePattern('Batman Absoluto #10 - O retorno (2026)')).toEqual({ prefix: 'batman absoluto', number: 10 });
    expect(extractTitlePattern('Saga 02 (2025) [Digital]')).toEqual({ prefix: 'saga', number: 2 });
    expect(extractTitlePattern('Batman v02')).toEqual({ prefix: 'batman', number: 2 });
    expect(extractTitlePattern('2000 AD #01')).toEqual({ prefix: '2000 ad', number: 1 });
    expect(extractTitlePattern('100 Bullets #02')).toEqual({ prefix: '100 bullets', number: 2 });
    expect(extractTitlePattern('1984')).toBeNull();
    expect(extractTitlePattern('2000 AD')).toBeNull();
  });
});

describe('series grouping', () => {
  it('uses one case-insensitive identity and numeric issue order, starting at zero', () => {
    const books = [
      createMockPublication('ten', 'Arqueiro Verde Absoluto #10 (2026) [Digital]'),
      createMockPublication('two', 'arqueiro  verde absoluto #02'),
      createMockPublication('zero', 'Arqueiro Verde Absoluto #00'),
      createMockPublication('one', 'ARQUEIRO VERDE ABSOLUTO #1 - Origem'),
    ];
    expect(new Set(books.map((book) => publicationSeries(book).key)).size).toBe(1);
    expect(books.sort(comparePublicationsBySeries).map((book) => book.id)).toEqual(['zero', 'one', 'two', 'ten']);
    expect(publicationSeries(books[0]).label).toBe('Arqueiro Verde Absoluto');
  });

  it('prefers metadata numbers over alphabetical subtitles and handles unnumbered specials last', () => {
    const books = [
      createMockPublication('ten', 'A tempestade', { series: 'Batman', number: '10' }),
      createMockPublication('special', 'Batman'),
      createMockPublication('zero', 'Zero absoluto', { series: ' batman ', number: '0' }),
      createMockPublication('two', 'Batman #02'),
    ];
    expect(books.sort(comparePublicationsBySeries).map((book) => book.id)).toEqual(['zero', 'two', 'ten', 'special']);
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

  it('does not guess a next volume from an alphabetical neighbour', () => {
    const pubA = createMockPublication('a', 'Watchmen Deluxe Edition');
    const pubB = createMockPublication('b', 'X-Men Omnibus');

    const next = findNextPublication(pubA, [pubB, pubA]);
    expect(next).toBeUndefined();
  });

  it('continues from issue zero using the same group identity despite suffixes and casing', () => {
    const zero = createMockPublication('zero', 'Arqueiro Verde Absoluto #00 (2025) [Digital]');
    const one = createMockPublication('one', 'ARQUEIRO VERDE ABSOLUTO #01 - Origem');
    expect(findNextPublication(zero, [one, zero])).toBe(one);
  });
});
