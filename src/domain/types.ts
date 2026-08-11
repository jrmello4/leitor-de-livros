export type PublicationFormat = 'demo' | 'images' | 'cbz' | 'cbr' | 'pdf';
export type ReadingDirection = 'ltr' | 'rtl';
export type ReadingMode = 'single' | 'spread';
export type ContrastMode = 'standard' | 'high';
export type LayoutZone = 'top' | 'bottom' | 'left' | 'right';

export type ActionName =
  | 'next_page'
  | 'previous_page'
  | 'toggle_library'
  | 'toggle_fullscreen'
  | 'toggle_settings'
  | 'toggle_spread'
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

export interface Publication {
  id: string;
  title: string;
  sourceLabel: string;
  format: PublicationFormat;
  pages: PageDescriptor[];
  coverPageId: string;
  currentPage: number;
  progress: number;
  direction: ReadingDirection;
  addedAt: string;
  updatedAt: string;
  diagnostic?: string;
}

export interface ReadingProfile {
  version: 1;
  name: string;
  mode: ReadingMode;
  direction: ReadingDirection;
  contrast: ContrastMode;
  reducedMotion: boolean;
  pageTurnDuration: number;
  layoutZone: LayoutZone;
  bindings: BindingMap;
}

export interface ImportResult {
  publication?: Publication;
  diagnostic?: string;
}
