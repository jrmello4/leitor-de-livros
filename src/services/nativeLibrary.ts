import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { calculateProgress } from '../domain/reader';
import type { Publication, ReadingDirection, ReadingProfile } from '../domain/types';
import { isPanelGraph, type PanelGraph } from '../domain/flow';
import { cloneBindings } from '../domain/input';
import { loadProfile } from './storage';

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
  const selection = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Tactile publications', extensions: ['cbz', 'cbr', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
  });
  return normalizeSelection(selection);
}

export async function chooseNativeFolder(): Promise<string[]> {
  const selection = await open({ multiple: false, directory: true });
  return normalizeSelection(selection);
}

export async function listNativePublications(direction: ReadingDirection): Promise<Publication[]> {
  const publications = await invoke<NativePublicationDto[]>('list_publications');
  return publications.map((publication) => mapPublication(publication, direction));
}

export async function importNativePaths(
  paths: string[],
  direction: ReadingDirection,
): Promise<{ publications: Publication[]; diagnostics: string[] }> {
  const result = await invoke<NativeImportResultDto>('import_publications', { paths });
  return {
    publications: result.publications.map((publication) => mapPublication(publication, direction)),
    diagnostics: result.diagnostics,
  };
}

export async function saveNativeProgress(publicationId: string, currentPage: number): Promise<void> {
  await invoke('save_progress', { publicationId, currentPage });
}

export async function loadNativeProfile(): Promise<ReadingProfile | null> {
  const stored = await invoke<unknown | null>('load_profile');
  return hydrateProfile(stored);
}

export async function saveNativeProfile(profile: ReadingProfile): Promise<void> {
  await invoke('save_profile', { profile });
}

export async function loadNativePanelGraph(publicationId: string, pageId: string): Promise<PanelGraph | null> {
  const graph = await invoke<unknown | null>('load_panel_graph', { publicationId, pageId });
  return isPanelGraph(graph) ? graph : null;
}

export async function saveNativePanelGraph(publicationId: string, graph: PanelGraph): Promise<void> {
  await invoke('save_panel_graph', { publicationId, pageId: graph.pageId, graph });
}

function mapPublication(publication: NativePublicationDto, direction: ReadingDirection): Publication {
  const currentPage = Math.max(0, Math.min(publication.currentPage, publication.pages.length - 1));
  return {
    id: publication.id,
    title: publication.title,
    sourceLabel: publication.sourceLabel,
    format: publication.format,
    pages: publication.pages.map((page) => ({
      id: page.id,
      index: page.index,
      name: page.name,
      src: convertFileSrc(page.cachePath),
      width: page.width,
      height: page.height,
    })),
    coverPageId: publication.coverPageId,
    currentPage,
    progress: calculateProgress(currentPage, publication.pages.length, direction),
    direction,
    addedAt: publication.addedAt,
    updatedAt: publication.updatedAt,
    diagnostic: publication.diagnostic,
  };
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
