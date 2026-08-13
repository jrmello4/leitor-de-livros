import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { calculateProgress } from '../domain/reader';
import { defaultReaderState, normalizeReaderState } from '../domain/readerState';
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
import { cloneBindings } from '../domain/input';
import {
  clearPublicationStorage,
  loadBookmarks,
  loadProfile,
  loadReaderState,
  saveBookmarks,
  saveFavorite,
  saveReaderState,
} from './storage';

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
}

interface NativeImportResultDto {
  publications: NativePublicationDto[];
  diagnostics: string[];
}

export function isNativeRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function chooseNativeFiles(): Promise<string[]> {
  if (!isNativeRuntime()) {
    return [];
  }
  const selection = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Tactile publications', extensions: ['cbz', 'cbr', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
  });
  return normalizeSelection(selection);
}

export async function chooseNativeFolder(): Promise<string[]> {
  if (!isNativeRuntime()) {
    return [];
  }
  const selection = await open({ multiple: false, directory: true });
  return normalizeSelection(selection);
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

export async function importNativePaths(
  paths: string[],
  direction: ReadingDirection,
): Promise<{ publications: Publication[]; diagnostics: string[] }> {
  if (!isNativeRuntime()) {
    return { publications: [], diagnostics: ['Native import is not available in the browser.'] };
  }

  const result = await invoke<unknown>('import_publications', { paths });
  const nativeResult = isNativeImportResult(result) ? result : { publications: [], diagnostics: [] };
  return {
    publications: nativeResult.publications.map((publication) => mapPublication(publication, direction)),
    diagnostics: nativeResult.diagnostics.filter((diagnostic): diagnostic is string => typeof diagnostic === 'string'),
  };
}

export async function saveNativeProgress(publicationId: string, currentPage: number): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('save_progress', { publicationId, currentPage });
}

export async function loadNativeProfile(): Promise<ReadingProfile | null> {
  if (!isNativeRuntime()) {
    return null;
  }
  const stored = await invoke<unknown | null>('load_profile');
  return hydrateProfile(stored);
}

export async function saveNativeProfile(profile: ReadingProfile): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  await invoke('save_profile', { profile });
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
  const currentPage = pages.length === 0
    ? 0
    : Math.max(0, Math.min(normalizeInteger(publication.currentPage), pages.length - 1));
  return {
    id: normalizeString(publication.id),
    title: normalizeString(publication.title, 'Untitled publication'),
    sourceLabel: normalizeString(publication.sourceLabel),
    format: normalizeFormat(publication.format),
    pages: pages.map((page) => ({
      id: page.id,
      index: page.index,
      name: page.name,
      src: page.cachePath ? convertFileSrc(page.cachePath) : '',
      width: page.width,
      height: page.height,
    })),
    coverPageId: normalizeString(publication.coverPageId, pages[0]?.id ?? ''),
    currentPage,
    progress: calculateProgress(currentPage, pages.length, direction),
    direction,
    addedAt: normalizeString(publication.addedAt),
    updatedAt: normalizeString(publication.updatedAt),
    isFavorite: publication.isFavorite === true,
    diagnostic: typeof publication.diagnostic === 'string' ? publication.diagnostic : undefined,
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

function hydrateProfile(value: unknown): ReadingProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<ReadingProfile>;
  if (candidate.version !== 1) {
    return null;
  }
  const fallback = loadProfile();
  return {
    ...fallback,
    ...candidate,
    bindings: cloneBindings(candidate.bindings ?? fallback.bindings),
  };
}
