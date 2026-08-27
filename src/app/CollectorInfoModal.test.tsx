import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorInfoModal } from './CollectorInfoModal';
import type { Publication } from '../domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPublication: Publication = {
  id: 'pub-1',
  title: 'Batman: The Court of Owls',
  sourceLabel: 'Batman_01.cbz',
  format: 'cbz',
  pages: [],
  pageCount: 32,
  coverSrc: 'blob:cover-1',
  coverPageId: 'p1',
  currentPage: 0,
  progress: 0,
  direction: 'ltr',
  addedAt: '2026-01-01',
  updatedAt: '2026-01-01',
  isFavorite: false,
  metadata: {
    title: 'The Court of Owls',
    series: 'Batman',
    number: '1',
    publisher: 'DC Comics',
    year: 2011,
    writer: 'Scott Snyder',
    penciller: 'Greg Capullo',
    summary: 'A dark mystery unfolding in Gotham City.',
    characters: ['Bruce Wayne', 'Dick Grayson'],
    tags: ['Detective', 'Superhero'],
  },
};

describe('CollectorInfoModal', () => {
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

  it('renders title, series, credits and synopsis correctly', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<CollectorInfoModal publication={mockPublication} onClose={onClose} />);
    });

    expect(host.textContent).toContain('The Court of Owls');
    expect(host.textContent).toContain('Batman');
    expect(host.textContent).toContain('#1');
    expect(host.textContent).toContain('DC Comics');
    expect(host.textContent).toContain('Scott Snyder');
    expect(host.textContent).toContain('Greg Capullo');
    expect(host.textContent).toContain('A dark mystery unfolding in Gotham City.');
    expect(host.textContent).toContain('Bruce Wayne');
  });

  it('triggers onClose when close button is clicked', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<CollectorInfoModal publication={mockPublication} onClose={onClose} />);
    });

    const closeBtn = host.querySelector<HTMLButtonElement>('.collector-modal-close');
    expect(closeBtn).toBeTruthy();
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
