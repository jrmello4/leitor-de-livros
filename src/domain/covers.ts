import type { CustomCover, Publication } from './types';

export const MAX_CUSTOM_COVER_BYTES = 10 * 1024 * 1024;

export type CoverValidation = { ok: true } | { ok: false; error: 'unsupported' | 'tooLarge' | 'missing' };

const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);

export function validateCoverMetadata(name: string, mimeType: string, byteSize: number): CoverValidation {
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return { ok: false, error: 'missing' };
  }
  if (byteSize > MAX_CUSTOM_COVER_BYTES) {
    return { ok: false, error: 'tooLarge' };
  }
  const extension = name.toLowerCase().split('.').pop() ?? '';
  const isImage = mimeType.toLowerCase().startsWith('image/') && IMAGE_EXTENSIONS.has(extension);
  return isImage ? { ok: true } : { ok: false, error: 'unsupported' };
}

export function normalizeCustomCover(value: unknown): CustomCover | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Partial<CustomCover>;
  if (
    typeof candidate.src !== 'string'
    || !isSafeCoverSource(candidate.src)
    || typeof candidate.sourceName !== 'string'
    || candidate.sourceName.trim().length === 0
  ) {
    return undefined;
  }
  const sourceName = candidate.sourceName.split(/[\\/]/).pop()?.trim() ?? '';
  if (!sourceName) {
    return undefined;
  }
  return {
    src: candidate.src,
    sourceName,
  };
}

export function publicationCoverSrc(publication: Publication): string {
  return normalizeCustomCover(publication.customCover)?.src ?? publication.pages[0]?.src ?? '';
}

function isSafeCoverSource(src: string): boolean {
  return /^data:image\//i.test(src)
    || src.startsWith('asset:')
    || /^https?:\/\/asset\.localhost(?:\/|$)/i.test(src);
}
