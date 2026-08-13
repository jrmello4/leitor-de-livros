import { unzipSync } from 'fflate';
import type { ImportResult, PageDescriptor, Publication, PublicationFormat } from '../domain/types';
import { t } from '../i18n/catalog';

const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function fileExtension(name: string): string {
  const extension = name.split('.').pop();
  return extension?.toLowerCase() ?? '';
}

export function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(name));
}

export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortImageNames(names: string[]): string[] {
  return [...names].filter(isImageName).sort(naturalCompare);
}

export function formatForFile(name: string): PublicationFormat | undefined {
  const extension = fileExtension(name);
  if (extension === 'cbz') return 'cbz';
  if (extension === 'cbr') return 'cbr';
  if (extension === 'pdf') return 'pdf';
  if (isImageName(name)) return 'images';
  return undefined;
}

function mimeForExtension(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'avif') return 'image/avif';
  if (extension === 'gif') return 'image/gif';
  return 'image/png';
}

async function readFileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('The file reader returned an invalid result.'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });
}

function publicationFromPages(
  title: string,
  sourceLabel: string,
  format: PublicationFormat,
  pages: PageDescriptor[],
  sourceNames: string[] = [sourceLabel],
): Publication {
  const now = new Date().toISOString();
  const id = createId('publication');
  const normalizedPages = pages.map((page, index) => ({ ...page, index }));
  return {
    id,
    title,
    sourceLabel,
    format,
    pages: normalizedPages,
    coverPageId: normalizedPages[0]?.id ?? '',
    currentPage: 0,
    progress: normalizedPages.length > 0 ? 1 / normalizedPages.length : 0,
    direction: 'ltr',
    addedAt: now,
    updatedAt: now,
    isFavorite: false,
    sourceNames: sourceNames
      .map((name) => name.split(/[\\/]/).pop() ?? name)
      .filter(Boolean),
  };
}

function pagesFromFiles(files: File[]): PageDescriptor[] {
  return sortImageNames(files.map((file) => file.name)).map((name, index) => {
    const file = files.find((candidate) => candidate.name === name);
    const extension = fileExtension(name);
    return {
      id: createId(`page-${index}`),
      index,
      name,
      src: file ? URL.createObjectURL(file) : '',
      width: 1200,
      height: 1700,
    };
  });
}

async function importCbz(file: File): Promise<ImportResult> {
  try {
    const archive = unzipSync(await readFileBytes(file));
    const names = sortImageNames(Object.keys(archive).filter((name) => !name.endsWith('/')));
    const pages = names.map((name, index) => {
      const extension = fileExtension(name);
      const data = archive[name];
      const blob = new Blob([data as unknown as BlobPart], { type: mimeForExtension(extension) });
      return {
        id: createId(`page-${index}`),
        index,
        name: name.split('/').pop() ?? name,
        src: URL.createObjectURL(blob),
        width: 1200,
        height: 1700,
      };
    });

    if (pages.length === 0) {
      return { diagnostic: t('import.cbzEmpty') };
    }

    const title = file.name.replace(/\.cbz$/i, '') || 'Imported CBZ';
    return { publication: publicationFromPages(title, file.name, 'cbz', pages, [file.name]) };
  } catch {
    return { diagnostic: t('import.cbzReadError') };
  }
}

export async function importFiles(files: File[]): Promise<ImportResult> {
  const imageFiles = files.filter((file) => isImageName(file.name));
  if (imageFiles.length > 0) {
    const pages = pagesFromFiles(imageFiles);
    const title = imageFiles[0]?.name.replace(/\.[^.]+$/, '') || 'Imported pages';
    return {
      publication: publicationFromPages(
        title,
        `${imageFiles.length} image files`,
        'images',
        pages,
        imageFiles.map((file) => file.name),
      ),
    };
  }

  const cbz = files.find((file) => formatForFile(file.name) === 'cbz');
  if (cbz) {
    return importCbz(cbz);
  }

  const unsupported = files.find((file) => ['cbr', 'pdf'].includes(fileExtension(file.name)));
  if (unsupported) {
    const format = fileExtension(unsupported.name).toUpperCase();
    return { diagnostic: t('import.nativeOnly', { format }) };
  }

  return { diagnostic: t('import.noSupported') };
}
