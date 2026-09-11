import type { Page } from '@playwright/test';
import { createDefaultProfile } from '../../src/domain/profiles';

// Only the native I/O boundary is simulated. App, ReaderView, WebtoonReader,
// layout, IntersectionObserver, touch delivery and persistence timers are real.
export async function seedNativeChapter(page: Page, count = 120, estimatedDimensions = false) {
  await page.addInitScript(({ count, profile, estimatedDimensions }) => {
    const pages = Array.from({ length: count }, (_, index) => {
      const height = index % 3 === 0 ? 2400 : 1200;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}"><rect width="800" height="${height}" fill="hsl(${index * 47 % 360} 40% 75%)"/><path d="M0 0L800 ${height}M800 0L0 ${height}" stroke="black" stroke-width="8"/><text x="40" y="200" font-size="100">PAGE ${index + 1}</text></svg>`;
      return { id: `fixture-page-${index}`, index, name: `${index}.svg`, width: estimatedDimensions ? 1200 : 800, height: estimatedDimensions ? 1700 : height,
        cachePath: `data:image/svg+xml,${encodeURIComponent(svg)}` };
    });
    const publication = { id: 'fixture-chapter', title: 'Zoom regression chapter', sourceLabel: 'fixture.cbz', format: 'cbz',
      pageCount: count, currentPage: 0, coverPageId: pages[0].id, coverSrc: pages[0].cachePath,
      pages, addedAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z' };
    const state = { zoomMode: 'page', zoomScale: 1, panX: 0, panY: 0, rotation: 0, background: 'atelier' };
    const host = window as unknown as { __TAURI_INTERNALS__: unknown };
    host.__TAURI_INTERNALS__ = {
      convertFileSrc: (src: string) => src,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        switch (cmd) {
          case 'load_profile': return { version: 2, activeProfileId: profile.id, profiles: [profile] };
          case 'save_profile': return;
          case 'list_publications': return [publication];
          case 'list_publication_pages': return pages;
          case 'load_reader_state': return { ...state };
          case 'save_reader_state': Object.assign(state, args.state); return;
          case 'list_bookmarks': return [];
          case 'ensure_page_cache': return pages.find(p => p.id === args.pageId);
          case 'save_progress': publication.currentPage = Number(args.currentPage); return;
          case 'touch_pages': return;
          case 'get_cache_info': return { usedBytes: 0, maxBytes: 100000000, entryCount: 0 };
          default: throw new Error(`Unexpected native call: ${cmd}`);
        }
      },
    };
  }, { count, estimatedDimensions, profile: { ...createDefaultProfile(), mode: 'webtoon' } });
}
