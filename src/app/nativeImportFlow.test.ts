import { describe, expect, it, vi } from 'vitest';
import { resolveNativeImportRequest } from './nativeImportFlow';

describe('resolveNativeImportRequest', () => {
  it('reports cancellation when the file picker returns no paths', async () => {
    const chooseFiles = vi.fn(async () => [] as string[]);
    const chooseFolder = vi.fn(async () => ['unused']);

    await expect(resolveNativeImportRequest({ kind: 'files' }, { chooseFiles, chooseFolder }))
      .resolves.toEqual({ kind: 'cancelled' });
    expect(chooseFiles).toHaveBeenCalledOnce();
    expect(chooseFolder).not.toHaveBeenCalled();
  });

  it('returns direct paths without opening a picker', async () => {
    const chooseFiles = vi.fn(async () => ['unused']);
    const chooseFolder = vi.fn(async () => ['unused']);

    await expect(resolveNativeImportRequest({ kind: 'paths', paths: ['book.cbz'] }, { chooseFiles, chooseFolder }))
      .resolves.toEqual({ kind: 'selected', paths: ['book.cbz'] });
    expect(chooseFiles).not.toHaveBeenCalled();
    expect(chooseFolder).not.toHaveBeenCalled();
  });

  it('returns selected paths from the folder picker', async () => {
    const chooseFiles = vi.fn(async () => ['unused']);
    const chooseFolder = vi.fn(async () => ['books/one.cbz', 'books/two.pdf']);

    await expect(resolveNativeImportRequest({ kind: 'folder' }, { chooseFiles, chooseFolder }))
      .resolves.toEqual({ kind: 'selected', paths: ['books/one.cbz', 'books/two.pdf'] });
  });

  it('preserves picker failures for the lifecycle owner to diagnose', async () => {
    const pickerError = new Error('picker unavailable');

    await expect(resolveNativeImportRequest({ kind: 'files' }, {
      chooseFiles: async () => { throw pickerError; },
      chooseFolder: async () => ['unused'],
    })).rejects.toBe(pickerError);
  });
});
