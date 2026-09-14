import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { calculateProgress } from '../domain/reader';
import { defaultReaderState, normalizeReaderState } from '../domain/readerState';
import { getActiveProfile, tryMigrateProfileStore, type ProfileStore } from '../domain/profiles';
import type {
  Bookmark,
  CacheInfo,
  PageDescriptor,
  Publication,
  ReaderState,
  ReadingDirection,
  ReadingProfile,
} from '../domain/types';
import { isPanelGraph, type PanelGraph } from '../domain/flow';
import { t } from '../i18n/catalog';
import { isAndroidRuntime, isNativeRuntime } from './platform';
import {
  clearPublicationStorage,
  loadBookmarks,
  loadProfileStore,
  loadReaderState,
  saveBookmarks,
  saveFavorite,
  saveReaderState,
} from './storage';

export {
  ensureRuntimePlatformLoaded,
  getRuntimePlatform,
  isAndroidRuntime,
  isNativeRuntime,
} from './platform';

export const DEFAULT_NATIVE_CACHE_LIMIT = 2 * 1024 * 1024 * 1024;

interface NativePageDto {
  id: string;
  index: number;
  name: string;
  cachePath: string;
  width: number;
  height: number;
}

interface NativePublicationDto {
  id: string;
  title: string;
  sourceLabel: string;
  sourceNames?: unknown;
  pageCount?: unknown;
  coverSrc?: unknown;
  currentPageId?: unknown;
  format: Publication['format'];
  pages: NativePageDto[];
  coverPageId: string;
  currentPage: number;
  progress: number;
  direction: ReadingDirection;
  addedAt: string;
  updatedAt: string;
  isFavorite?: unknown;
  diagnostic?: string;
  customCoverPath?: unknown;
  customCoverName?: unknown;
}

function safeSourceName(value: unknown): string {
  const source = normalizeString(value);
  return source.split(/[\\/]/).pop() ?? source;
}

function safeSourceNames(value: unknown, fallback: string): string[] {
  const names = Array.isArray(value)
    ? value.map(safeSourceName).filter(Boolean)
    : [];
  return names.length > 0 ? [...new Set(names)] : (fallback ? [fallback] : []);
}

interface NativeImportResultDto {
  publications: NativePublicationDto[];
  diagnostics: string[];
}

export async function chooseNativeFiles(): Promise<string[]> {
  if (!isNativeRuntime()) {
    return [];
  }
  if (isAndroidRuntime()) {
    return pickAndroidImport('pick_files');
  }
  const selection = await open({
    multiple: true,
    directory: false,
  });
  return normalizeSelection(selection);
}

export async function chooseNativeFolder(): Promise<string[]> {
  if (!isNativeRuntime()) {
    return [];
  }
  if (isAndroidRuntime()) {
    return pickAndroidImport('pick_folder');
  }
  const selection = await open({ multiple: false, directory: true });
  return normalizeSelection(selection);
}

export interface NativeImportProgress {
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
  currentName: string;
}


async function pickAndroidImport(command: 'pick_files' | 'pick_folder'): Promise<string[]> {
  const result = await invoke<unknown>(`plugin:mobile-import|${command}`);
  if (!result || typeof result !== 'object' || !('paths' in result)) {
    return [];
  }
  const paths = (result as { paths?: unknown }).paths;
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [];
}

export async function listNativePublications(direction: ReadingDirection): Promise<Publication[]> {
  if (!isNativeRuntime()) {
    return [];
  }

  const publications = await invoke<unknown>('list_publications');
  return Array.isArray(publications)
    ? publications.map((publication) => mapPublication(publication, direction))
    : [];
}

/**
 * Loads the pages of one publication. A listing deliberately omits them, so the
 * reader asks for the pages of the publication it is about to open.
 */
export async function loadNativePublicationPages(publicationId: string): Promise<PageDescriptor[]> {
  if (!isNativeRuntime()) {
    return [];
  }

  const pages = await invoke<unknown>('list_publication_pages', { publicationId });
  if (!Array.isArray(pages)) {
    return [];
  }

  return pages
    .map(normalizePage)
    .filter((page): page is NativePageDto => Boolean(page))
    .map((page) => ({
      id: page.id,
      index: page.index,
      name: page.name,
      src: page.cachePath ? convertFileSrc(page.cachePath) : '',
      width: page.width,
      height: page.height,
    }));
}

export async function importNativePaths(
  paths: string[],
  direction: ReadingDirection,
): Promise<{ publications: Publication[]; diagnostics: string[] }> {
  if (!isNativeRuntime()) {
    return { publications: [], diagnostics: [t('import.nativeUnavailable')] };
  }

  const result = await invoke<unknown>('import_publications', { paths });
  const nativeResult = isNativeImportResult(result) ? result : { publications: [], diagnostics: [] };
  return {
    publications: nativeResult.publications.map((publication) => mapPublication(publication, direction)),
    diagnostics: nativeResult.diagnostics.filter((diagnostic): diagnostic is string => typeof diagnostic === 'string'),
  };
}

export function listenNativeImportProgress(
  callback: (progress: NativeImportProgress) => void,
): Promise<UnlistenFn> {
  return listen<NativeImportProgress>('import-progress', (event) => callback(event.payload));
}

export async function saveNativeProgress(publicationId: string, currentPage: number): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('save_progress', { publicationId, currentPage });
}

export async function loadNativeProfile(): Promise<ReadingProfile | null> {
  const store = await loadNativeProfileStore();
  return store ? getActiveProfile(store) : null;
}

export async function chooseNativeCover(): Promise<string | null> {
  if (!isNativeRuntime()) {
    return null;
  }
  const selection = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Cover image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
  });
  return normalizeSelection(selection)[0] ?? null;
}

export async function setNativeCover(publicationId: string, sourcePath: string): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('set_custom_cover', { publicationId, sourcePath });
}

export async function clearNativeCover(publicationId: string): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('clear_custom_cover', { publicationId });
}

export async function loadNativeProfileStore(): Promise<ProfileStore | null> {
  if (!isNativeRuntime()) {
    return null;
  }
  const stored = await invoke<unknown | null>('load_profile');
  return hydrateProfileStore(stored);
}

export async function saveNativeProfile(profile: ReadingProfile): Promise<void> {
  const store = loadProfileStore();
  const active = getActiveProfile(store);
  await saveNativeProfileStore({
    ...store,
    profiles: store.profiles.map((candidate) => candidate.id === active.id
      ? { ...candidate, ...profile, id: candidate.id, version: 1 as const }
      : candidate),
  });
}

export async function saveNativeProfileStore(store: ProfileStore): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('save_profile', { profile: store });
}

export async function loadNativePanelGraph(publicationId: string, pageId: string): Promise<PanelGraph | null> {
  if (!isNativeRuntime()) {
    return null;
  }
  const graph = await invoke<unknown | null>('load_panel_graph', { publicationId, pageId });
  return isPanelGraph(graph) ? graph : null;
}

export async function saveNativePanelGraph(publicationId: string, graph: PanelGraph): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('save_panel_graph', { publicationId, pageId: graph.pageId, graph });
}

/**
 * Reads page bookmarks from SQLite in Tauri and from the versioned local
 * storage fallback in a browser. Invalid native DTOs are ignored so a single
 * corrupt row cannot prevent the library from opening.
 */
export async function listNativeBookmarks(publicationId: string): Promise<Bookmark[]> {
  if (!isNativeRuntime()) {
    return loadBookmarks(publicationId);
  }

  const value = await invoke<unknown>('list_bookmarks', { publicationId });
  return normalizeBookmarks(value);
}

export interface NativeLibrarySnapshot {
  bookmarks: Record<string, Bookmark[]>;
  readerStates: Record<string, ReaderState>;
}

/**
 * Snapshot em lote: 1 IPC para bookmarks + reader states de toda a
 * biblioteca. Substitui o N×2 do boot (2 chamadas por publicação).
 */
export async function listNativeLibrarySnapshot(): Promise<NativeLibrarySnapshot | null> {
  if (!isNativeRuntime()) {
    return null;
  }
  try {
    const value = await invoke<unknown>('list_library_snapshot');
    if (!value || typeof value !== 'object') {
      return null;
    }
    const snapshot = value as {
      bookmarks?: unknown;
      readerStates?: unknown;
    };
    const bookmarks: Record<string, Bookmark[]> = {};
    if (snapshot.bookmarks && typeof snapshot.bookmarks === 'object') {
      for (const [publicationId, entries] of Object.entries(snapshot.bookmarks as Record<string, unknown>)) {
        bookmarks[publicationId] = normalizeBookmarks(entries);
      }
    }
    const readerStates: Record<string, ReaderState> = {};
    if (snapshot.readerStates && typeof snapshot.readerStates === 'object') {
      for (const [publicationId, state] of Object.entries(snapshot.readerStates as Record<string, unknown>)) {
        if (state === null || state === undefined) continue;
        try {
          readerStates[publicationId] = normalizeReaderState(state ?? defaultReaderState);
        } catch {
          // Linha corrompida não pode impedir a abertura da biblioteca.
        }
      }
    }
    return { bookmarks, readerStates };
  } catch {
    return null;
  }
}

export async function saveNativeBookmark(publicationId: string, bookmark: Bookmark): Promise<void> {
  const normalized = normalizeBookmark(bookmark);
  if (!normalized) {
    return;
  }
  if (!isNativeRuntime()) {
    const bookmarks = loadBookmarks(publicationId).filter((entry) => entry.pageId !== normalized.pageId);
    saveBookmarks(publicationId, [...bookmarks, normalized]);
    return;
  }
  await invoke('upsert_bookmark', { publicationId, bookmark: normalized });
}

export async function removeNativeBookmark(publicationId: string, pageId: string): Promise<void> {
  if (!isNativeRuntime()) {
    saveBookmarks(publicationId, loadBookmarks(publicationId).filter((bookmark) => bookmark.pageId !== pageId));
    return;
  }
  await invoke('remove_bookmark', { publicationId, pageId });
}

export async function setNativeFavorite(publicationId: string, isFavorite: boolean): Promise<void> {
  if (!isNativeRuntime()) {
    saveFavorite(publicationId, isFavorite);
    return;
  }
  await invoke('set_publication_favorite', { publicationId, isFavorite });
}

export async function loadNativeReaderState(publicationId: string): Promise<ReaderState | null> {
  if (!isNativeRuntime()) {
    return loadReaderState(publicationId);
  }
  const value = await invoke<unknown | null>('load_reader_state', { publicationId });
  return value === null ? null : normalizeReaderState(value ?? defaultReaderState);
}

export async function saveNativeReaderState(publicationId: string, state: ReaderState): Promise<void> {
  const normalized = normalizeReaderState(state);
  if (!isNativeRuntime()) {
    saveReaderState(publicationId, normalized);
    return;
  }
  await invoke('save_reader_state', { publicationId, state: normalized });
}

export async function deleteNativePublication(publicationId: string): Promise<void> {
  if (!isNativeRuntime()) {
    clearPublicationStorage(publicationId);
    return;
  }
  await invoke('delete_publication', { publicationId });
}

export async function getNativeCacheInfo(): Promise<CacheInfo> {
  if (!isNativeRuntime()) {
    return defaultCacheInfo();
  }
  const value = await invoke<unknown>('get_cache_info');
  return normalizeCacheInfo(value);
}

export async function setNativeCacheLimit(maxBytes: number, protectedPageIds: string[] = []): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  const normalized = typeof maxBytes === 'number' && Number.isFinite(maxBytes)
    ? Math.max(1, Math.floor(maxBytes))
    : DEFAULT_NATIVE_CACHE_LIMIT;
  await invoke('set_cache_limit', { maxBytes: normalized, protectedPageIds });
}

export async function clearNativeCache(protectedPageIds: string[] = []): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('clear_cache', { protectedPageIds });
}

export async function rebuildNativePublicationCache(publicationId: string): Promise<number> {
  if (!isNativeRuntime()) {
    return 0;
  }
  const rebuiltCount = await invoke<number>('rebuild_publication_cache', { publicationId });
  return typeof rebuiltCount === 'number' ? rebuiltCount : 0;
}

export async function ensureNativePage(
  publicationId: string,
  pageId: string,
  protectedPageIds: string[] = [],
): Promise<PageDescriptor | null> {
  if (!isNativeRuntime()) {
    return null;
  }
  const value = await invoke<unknown>('ensure_page_cache', { publicationId, pageId, protectedPageIds });
  const page = normalizePage(value);
  if (!page) {
    return null;
  }
  return {
    id: page.id,
    index: page.index,
    name: page.name,
    src: page.cachePath ? convertFileSrc(page.cachePath) : '',
    width: page.width,
    height: page.height,
  };
}

/**
 * Marks the current page and nearby pages as recently used/pinned. The
 * `touch_pages` command is intentionally small; it receives only identifiers
 * so source paths never cross the frontend/native boundary.
 */
export async function touchNativePages(publicationId: string, pageIds: string[]): Promise<void> {
  if (!isNativeRuntime() || pageIds.length === 0) {
    return;
  }
  await invoke('touch_pages', { publicationId, pageIds });
}

function mapPublication(value: unknown, direction: ReadingDirection): Publication {
  const publication = isNativePublication(value) ? value : emptyPublicationDto();
  const pages = Array.isArray(publication.pages) ? publication.pages.map(normalizePage).filter(Boolean) as NativePageDto[] : [];
  // A listing reports its own count; an import result carries the pages it just
  // wrote. Trusting `pages.length` alone would report an empty library.
  const pageCount = Math.max(normalizeInteger(publication.pageCount), pages.length);
  const currentPage = pageCount === 0
    ? 0
    : Math.max(0, Math.min(normalizeInteger(publication.currentPage), pageCount - 1));
  const sourceLabel = safeSourceName(publication.sourceLabel);
  const coverCachePath = normalizeString(publication.coverSrc) || pages[0]?.cachePath || '';
  return {
    id: normalizeString(publication.id),
    title: normalizeString(publication.title, 'Untitled publication'),
    sourceLabel,
    format: normalizeFormat(publication.format),
    pages: pages.map((page) => ({
      id: page.id,
      index: page.index,
      name: page.name,
      src: page.cachePath ? convertFileSrc(page.cachePath) : '',
      width: page.width,
      height: page.height,
    })),
    pageCount,
    coverSrc: coverCachePath ? convertFileSrc(coverCachePath) : '',
    currentPageId: normalizeString(publication.currentPageId) || pages[currentPage]?.id || undefined,
    coverPageId: normalizeString(publication.coverPageId, pages[0]?.id ?? ''),
    currentPage,
    progress: calculateProgress(currentPage, pageCount, direction),
    direction,
    addedAt: normalizeString(publication.addedAt),
    updatedAt: normalizeString(publication.updatedAt),
    isFavorite: publication.isFavorite === true,
    sourceNames: safeSourceNames(publication.sourceNames, sourceLabel),
    diagnostic: typeof publication.diagnostic === 'string' ? publication.diagnostic : undefined,
    customCover: publication.customCoverPath && publication.customCoverName
      ? {
          src: convertFileSrc(normalizeString(publication.customCoverPath)),
          sourceName: safeSourceName(publication.customCoverName),
        }
      : undefined,
  };
}

function normalizePage(value: unknown): NativePageDto | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const page = value as Partial<NativePageDto>;
  return {
    id: normalizeString(page.id),
    index: normalizeInteger(page.index),
    name: normalizeString(page.name),
    cachePath: normalizeString(page.cachePath),
    width: normalizePositiveInteger(page.width, 1),
    height: normalizePositiveInteger(page.height, 1),
  };
}

function isNativePublication(value: unknown): value is NativePublicationDto {
  return Boolean(value && typeof value === 'object');
}

function emptyPublicationDto(): NativePublicationDto {
  return {
    id: '',
    title: 'Untitled publication',
    sourceLabel: '',
    format: 'demo',
    pages: [],
    coverPageId: '',
    currentPage: 0,
    progress: 0,
    direction: 'ltr',
    addedAt: '',
    updatedAt: '',
  };
}

function normalizeBookmarks(value: unknown): Bookmark[] {
  return Array.isArray(value)
    ? value.map(normalizeBookmark).filter(Boolean) as Bookmark[]
    : [];
}

function normalizeBookmark(value: unknown): Bookmark | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const bookmark = value as Partial<Bookmark>;
  if (
    typeof bookmark.pageId !== 'string'
    || typeof bookmark.label !== 'string'
    || typeof bookmark.createdAt !== 'string'
    || typeof bookmark.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    pageId: bookmark.pageId,
    label: bookmark.label,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
  };
}

function normalizeCacheInfo(value: unknown): CacheInfo {
  if (!value || typeof value !== 'object') {
    return defaultCacheInfo();
  }
  const candidate = value as Partial<CacheInfo>;
  return {
    usedBytes: normalizeNonNegative(candidate.usedBytes),
    maxBytes: normalizePositiveInteger(candidate.maxBytes, DEFAULT_NATIVE_CACHE_LIMIT),
    entryCount: normalizeNonNegativeInteger(candidate.entryCount),
  };
}

function defaultCacheInfo(): CacheInfo {
  return { usedBytes: 0, maxBytes: DEFAULT_NATIVE_CACHE_LIMIT, entryCount: 0 };
}

function isNativeImportResult(value: unknown): value is NativeImportResultDto {
  return Boolean(value && typeof value === 'object')
    && Array.isArray((value as Partial<NativeImportResultDto>).publications)
    && Array.isArray((value as Partial<NativeImportResultDto>).diagnostics);
}

function normalizeFormat(value: unknown): Publication['format'] {
  return value === 'images' || value === 'cbz' || value === 'cbr' || value === 'pdf' || value === 'demo'
    ? value
    : 'demo';
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const integer = normalizeInteger(value);
  return integer > 0 ? integer : fallback;
}

function normalizeNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeNonNegativeInteger(value: unknown): number {
  return Math.floor(normalizeNonNegative(value));
}

function normalizeSelection(selection: string | string[] | null): string[] {
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

function hydrateProfileStore(value: unknown): ProfileStore | null {
  if (value === null || value === undefined) {
    return null;
  }
  return tryMigrateProfileStore(value);
}
