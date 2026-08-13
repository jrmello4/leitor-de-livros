import { beforeEach, describe, expect, it } from 'vitest';
import type { Publication } from './types';
import { publicationCoverSrc, validateCoverMetadata } from './covers';

describe('custom covers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts supported image metadata and rejects oversized or non-image files', () => {
    expect(validateCoverMetadata('cover.webp', 'image/webp', 1024)).toEqual({ ok: true });
    expect(validateCoverMetadata('cover.exe', 'application/octet-stream', 1024).ok).toBe(false);
    expect(validateCoverMetadata('cover.png', 'image/png', 10 * 1024 * 1024 + 1).ok).toBe(false);
  });

  it('prefers a custom cover and falls back to the first page', () => {
    const publication = {
      pages: [{ src: 'page-src' }],
      customCover: { src: 'data:image/png;base64,AA==', sourceName: 'cover.png' },
    } as Publication;
    expect(publicationCoverSrc(publication)).toBe('data:image/png;base64,AA==');
    expect(publicationCoverSrc({ pages: [{ src: 'page-src' }] } as Publication)).toBe('page-src');
  });
});
