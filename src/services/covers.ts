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
    reader.addEventListener('load', () => {
      const cover = normalizeCustomCover({ src: reader.result, sourceName: file.name });
      if (!cover) {
        reject(new Error('unsupported'));
        return;
      }
      resolve(cover);
    });
    reader.addEventListener('error', () => reject(new Error('unreadable')));
    reader.readAsDataURL(file);
  });
}

export function coverErrorMessage(validation: CoverValidation | string): string {
  if (typeof validation === 'string') {
    return validation;
  }
  return validation.ok ? '' : validation.error;
}
