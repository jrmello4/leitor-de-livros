import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { fileExtension, formatForFile, importFiles, revokePublicationBlobUrls, sortImageNames } from './importers';

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

  it('revokes blob URLs safely without errors', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const pub = {
      id: 'test',
      title: 'test',
      sourceLabel: 'test',
      format: 'cbz' as const,
      pages: [
        { id: '1', index: 0, name: '1.jpg', src: 'blob:http://localhost/1', width: 100, height: 100 },
        { id: '2', index: 1, name: '2.jpg', src: 'blob:http://localhost/2', width: 100, height: 100 },
      ],
      pageCount: 2,
      coverSrc: 'blob:http://localhost/cover',
      coverPageId: '1',
      currentPage: 0,
      progress: 0,
      direction: 'ltr' as const,
      addedAt: '',
      updatedAt: '',
      isFavorite: false,
    };

    revokePublicationBlobUrls(pub);
    expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/1');
    expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/2');
    expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/cover');
    revokeSpy.mockRestore();
  });
});
