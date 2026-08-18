import { normalizeCustomCover, validateCoverMetadata, type CoverValidation } from '../domain/covers';
import type { CustomCover } from '../domain/types';
import { clearCustomCover, loadCustomCover, saveCustomCover } from './storage';

export { clearCustomCover, loadCustomCover, saveCustomCover };

export function readBrowserCover(file: File): Promise<CustomCover> {
  const validation = validateCoverMetadata(file.name, file.type, file.size);
  if (!validation.ok) {
    return Promise.reject(new Error(validation.error));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', async () => {
      const cover = normalizeCustomCover({ src: reader.result, sourceName: file.name });
      if (!cover) {
        reject(new Error('unsupported'));
        return;
      }
      try {
        await decodeCover(cover.src);
        resolve(cover);
      } catch {
        reject(new Error('unreadable'));
      }
    });
    reader.addEventListener('error', () => reject(new Error('unreadable')));
    reader.readAsDataURL(file);
  });
}

function decodeCover(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('unreadable')), { once: true });
    image.src = src;
  });
}

export function coverErrorMessage(validation: CoverValidation | string): string {
  if (typeof validation === 'string') {
    return validation;
  }
  return validation.ok ? '' : validation.error;
}
