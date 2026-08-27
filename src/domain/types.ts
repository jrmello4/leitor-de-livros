export type PublicationFormat = 'demo' | 'images' | 'cbz' | 'cbr' | 'pdf';
export type ReadingDirection = 'ltr' | 'rtl';
export type ReadingMode = 'single' | 'spread' | 'webtoon';
export type ContrastMode = 'standard' | 'high';
export type LayoutZone = 'top' | 'bottom' | 'left' | 'right';
export type ZoomMode = 'page' | 'width' | 'manual';
export type PageRotation = 0 | 90 | 180 | 270;
export type PageColorFilter = 'original' | 'sepia' | 'dark' | 'grayscale' | 'invert' | 'warm' | 'cool';
export type StageBackground = 'atelier' | 'oled' | 'dark' | 'paper';

export interface ComicMetadata {
  title?: string;
  series?: string;
  number?: string;
  count?: number;
  volume?: string;
  summary?: string;
  year?: number;
  month?: number;
  writer?: string;
  penciller?: string;
  inker?: string;
  colorist?: string;
  letterer?: string;
  coverArtist?: string;
  editor?: string;
  publisher?: string;
  genre?: string;
  characters?: string[];
  tags?: string[];
}

export type ActionName =
  | 'next_page'
  | 'previous_page'
  | 'toggle_library'
  | 'toggle_fullscreen'
  | 'toggle_settings'
  | 'toggle_spread'
  | 'toggle_navigator'
  | 'toggle_bookmark'
  | 'rotate_clockwise'
  | 'cancel';

export type BindingMap = Record<ActionName, string[]>;

export interface PageDescriptor {
  id: string;
  index: number;
  name: string;
  src: string;
  width: number;
  height: number;
}

export interface CustomCover {
  src: string;
  sourceName: string;
}

export interface Publication {
  id: string;
  title: string;
  sourceLabel: string;
  format: PublicationFormat;
  /**
   * Empty until the reader opens this publication. A library listing carries
   * `pageCount` and `coverSrc` instead, so opening the library does not load
   * every page of every publication.
   */
  pages: PageDescriptor[];
  /** Authoritative page total; `pages.length` is only valid once loaded. */
  pageCount: number;
  /** Cover image source, available without loading the page list. */
  coverSrc: string;
  /** Page the reader resumes on, used to protect it from cache eviction. */
  currentPageId?: string;
  coverPageId: string;
  currentPage: number;
  progress: number;
  direction: ReadingDirection;
  addedAt: string;
  updatedAt: string;
  isFavorite: boolean;
  /** Safe basenames used for discovery; never contains an absolute source path. */
  sourceNames?: string[];
  customCover?: CustomCover;
  metadata?: ComicMetadata;
  diagnostic?: string;
}

export interface ReaderState {
  zoomMode: ZoomMode;
  zoomScale: number;
  panX: number;
  panY: number;
  rotation: PageRotation;
  background: StageBackground;
}

export interface Bookmark {
  pageId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface CacheInfo {
  usedBytes: number;
  maxBytes: number;
  entryCount: number;
}

export interface ReadingProfile {
  id?: string;
  version: 1;
  name: string;
  mode: ReadingMode;
  direction: ReadingDirection;
  contrast: ContrastMode;
  reducedMotion: boolean;
  pageTurnDuration: number;
  layoutZone: LayoutZone;
  zoomMode: ZoomMode;
  zoomScale: number;
  bindings: BindingMap;
}

export interface ImportResult {
  publication?: Publication;
  diagnostic?: string;
}
