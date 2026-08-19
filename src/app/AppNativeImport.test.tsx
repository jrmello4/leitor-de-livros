import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Publication } from '../domain/types';
import { App } from './App';

const native = vi.hoisted(() => ({
  chooseFiles: vi.fn(),
  chooseFolder: vi.fn(),
  importPaths: vi.fn(),
  listPublications: vi.fn(),
  getCacheInfo: vi.fn(),
  loadProfileStore: vi.fn(),
  saveProfileStore: vi.fn(),
}));

const importStates = vi.hoisted(() => ({ snapshots: [] as boolean[] }));

vi.mock('../rendering/ReaderSurface', () => ({
  ReaderSurface({ staticContent }: { staticContent: ReactNode }) {
    return <div>{staticContent}</div>;
  },
}));

vi.mock('../services/nativeLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/nativeLibrary')>();
  return {
    ...actual,
    isNativeRuntime: () => true,
    chooseNativeFiles: native.chooseFiles,
    chooseNativeFolder: native.chooseFolder,
    importNativePaths: native.importPaths,
    listNativePublications: native.listPublications,
    getNativeCacheInfo: native.getCacheInfo,
    loadNativeProfileStore: native.loadProfileStore,
    saveNativeProfileStore: native.saveProfileStore,
  };
});

vi.mock('./LibraryView', () => ({
  LibraryView({
    diagnostic,
    isImporting,
    onImportFolder,
    onImportNative,
  }: {
    diagnostic?: string;
    isImporting: boolean;
    onImportFolder(): void;
    onImportNative(): void;
  }) {
    importStates.snapshots.push(isImporting);
    return (
      <div>
        <button data-testid="native-files" onClick={onImportNative}>Files</button>
        <button data-testid="native-folder" onClick={onImportFolder}>Folder</button>
        <span data-testid="native-importing">{String(isImporting)}</span>
        {diagnostic && <span data-testid="native-diagnostic">{diagnostic}</span>}
      </div>
    );
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const importedPublication: Publication = {
  id: 'native-book',
  title: 'Native book',
  sourceLabel: 'native-book.cbz',
  sourceNames: ['native-book.cbz'],
  format: 'cbz',
  pages: [{ id: 'page-1', index: 0, name: 'page-1.jpg', src: 'native://page-1', width: 100, height: 100 }],
  pageCount: 1,
  coverSrc: 'native://page-1',
  coverPageId: 'page-1',
  currentPage: 0,
  progress: 0,
  direction: 'ltr',
  addedAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  isFavorite: false,
};

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function loadingTransitions() {
  return importStates.snapshots.filter((state, index, snapshots) => index === 0 || state !== snapshots[index - 1]);
}

describe('App native import lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    importStates.snapshots = [];
    native.chooseFiles.mockResolvedValue(['native-book.cbz']);
    native.chooseFolder.mockResolvedValue(['native-book.cbz']);
    native.importPaths.mockResolvedValue({ publications: [], diagnostics: [] });
    native.listPublications.mockResolvedValue([]);
    native.getCacheInfo.mockResolvedValue({ usedBytes: 0, maxBytes: 100, entryCount: 0 });
    native.loadProfileStore.mockResolvedValue(null);
    native.saveProfileStore.mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<App />);
      await flushReact();
    });
    importStates.snapshots = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  async function importFiles() {
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="native-files"]')?.click();
      await flushReact();
    });
  }

  async function importFolder() {
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="native-folder"]')?.click();
      await flushReact();
    });
  }

  function expectLoadingClearedOnce() {
    expect(loadingTransitions()).toEqual([true, false]);
  }

  it('clears loading once when the file picker fails', async () => {
    native.chooseFiles.mockRejectedValueOnce(new Error('picker unavailable'));

    await importFiles();

    expectLoadingClearedOnce();
    expect(host.querySelector('[data-testid="native-diagnostic"]')?.textContent).toContain('The native import failed');
  });

  it('clears loading once when the importer fails', async () => {
    native.importPaths.mockRejectedValueOnce(new Error('importer unavailable'));

    await importFiles();

    expectLoadingClearedOnce();
    expect(host.querySelector('[data-testid="native-diagnostic"]')?.textContent).toContain('The native import failed');
  });

  it('clears loading once when importing finds no publications', async () => {
    native.importPaths.mockResolvedValueOnce({ publications: [], diagnostics: ['Unsupported file'] });

    await importFiles();

    expectLoadingClearedOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('No supported native publication was found');
  });

  it('clears loading once when the picker is cancelled', async () => {
    native.chooseFiles.mockResolvedValueOnce([]);

    await importFiles();

    expectLoadingClearedOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Import cancelled');
  });

  it('clears loading once after importing a publication', async () => {
    native.importPaths.mockResolvedValueOnce({ publications: [importedPublication], diagnostics: [] });
    native.listPublications.mockResolvedValue([importedPublication]);

    await importFiles();

    expectLoadingClearedOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Native book imported into the native library');
  });

  it('imports a folder selection without falling back to the file picker', async () => {
    native.chooseFiles.mockRejectedValueOnce(new Error('the file picker must not run'));
    native.chooseFolder.mockResolvedValueOnce(['folder/native-book.cbz']);
    native.importPaths.mockResolvedValueOnce({ publications: [], diagnostics: [] });

    await importFolder();

    expect(native.chooseFolder).toHaveBeenCalledOnce();
    expect(native.chooseFiles).not.toHaveBeenCalled();
    expect(native.importPaths).toHaveBeenCalledWith(['folder/native-book.cbz'], 'ltr');
  });

  it('imports a smoke source directly without opening a native picker', async () => {
    act(() => root.unmount());
    root = createRoot(host);
    vi.stubEnv('VITE_SMOKE_TEST', '1');
    native.chooseFiles.mockRejectedValueOnce(new Error('the file picker must not run'));
    native.chooseFolder.mockRejectedValueOnce(new Error('the folder picker must not run'));
    native.importPaths.mockResolvedValueOnce({ publications: [importedPublication], diagnostics: [] });
    native.listPublications.mockResolvedValue([importedPublication]);

    await act(async () => {
      root.render(<App />);
      await flushReact();
    });

    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]')!;
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\direct.cbz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await flushReact();
    });

    expect(native.importPaths).toHaveBeenCalledWith(['C:\\fixtures\\direct.cbz'], 'ltr');
    expect(native.chooseFiles).not.toHaveBeenCalled();
    expect(native.chooseFolder).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toContain('Imported');
  });
});
