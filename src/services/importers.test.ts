import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fileExtension, formatForFile, importFiles, sortImageNames } from './importers';

describe('local publication import contracts', () => {
  it('sorts numbered pages naturally and classifies formats', () => {
    expect(sortImageNames(['page-10.png', 'page-2.png', 'cover.jpg', 'notes.txt'])).toEqual([
      'cover.jpg',
      'page-2.png',
      'page-10.png',
    ]);
    expect(fileExtension('chapter.CBZ')).toBe('cbz');
    expect(formatForFile('chapter.CBR')).toBe('cbr');
    expect(formatForFile('scan.webp')).toBe('images');
  });

  it('imports image sets without modifying their source files', async () => {
    const files = [
      new File(['page 10'], 'page-10.png', { type: 'image/png' }),
      new File(['page 2'], 'page-2.png', { type: 'image/png' }),
    ];
    const result = await importFiles(files);
    expect(result.publication?.pages.map((page) => page.name)).toEqual(['page-2.png', 'page-10.png']);
    expect(result.publication?.format).toBe('images');
  });

  it('extracts image pages from a CBZ in natural order', async () => {
    const archive = zipSync({
      'chapter/page-10.png': new Uint8Array([1, 2]),
      'chapter/page-2.png': new Uint8Array([3, 4]),
    });
    const result = await importFiles([new File([archive], 'chapter.cbz', { type: 'application/zip' })]);
    expect(result.publication?.pages.map((page) => page.name)).toEqual(['page-2.png', 'page-10.png']);
    expect(result.publication?.format).toBe('cbz');
  });
});
