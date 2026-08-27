import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecapModal } from './RecapModal';
import type { Publication } from '../domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_PUB: Publication = {
  id: 'pub-xmen',
  title: 'X-Men: Dark Phoenix',
  sourceLabel: 'xmen.cbz',
  format: 'cbz',
  coverSrc: 'blob:cover',
  coverPageId: 'page-1',
  pageCount: 40,
  currentPage: 20,
  progress: 50,
  direction: 'ltr',
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isFavorite: false,
  metadata: {
    title: 'The Dark Phoenix Saga',
    series: 'Uncanny X-Men',
    number: '135',
    summary: 'Jean Grey is overwhelmed by cosmic power as the Hellfire Club plots in the shadows.',
    writer: 'Chris Claremont',
    penciller: 'John Byrne',
    characters: ['Cyclops', 'Jean Grey', 'Wolverine', 'Professor X'],
    tags: ['Marvel', 'Cosmic', 'Mutant'],
    year: 1980,
  },
  pages: Array.from({ length: 40 }, (_, i) => ({
    id: `page-${i + 1}`,
    index: i,
    name: `00${i + 1}.png`,
    src: `blob:page-${i + 1}`,
    width: 800,
    height: 1200,
  })),
};

describe('RecapModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it('renders spoiler-safe milestone, characters, and premise', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <RecapModal
          publication={SAMPLE_PUB}
          currentPageIndex={20}
          onClose={onClose}
        />,
      );
    });

    expect(host.textContent).toContain('X-Men: Dark Phoenix');
    expect(host.textContent).toContain('Página 21 de 40');
    expect(host.textContent).toContain('(53% lido)');
    expect(host.textContent).toContain('Jean Grey is overwhelmed by cosmic power');
    expect(host.textContent).toContain('Wolverine');
    expect(host.textContent).toContain('Cyclops');

    // Click close button
    const closeBtn = host.querySelector<HTMLButtonElement>('.collector-modal-close');
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
