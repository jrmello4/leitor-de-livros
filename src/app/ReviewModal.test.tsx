import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewModal } from './ReviewModal';
import type { Publication } from '../domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_PUB: Publication = {
  id: 'pub-batman',
  title: 'Batman: The Long Halloween',
  sourceLabel: 'batman.cbz',
  format: 'cbz',
  coverSrc: 'blob:cover',
  coverPageId: 'page-1',
  pageCount: 24,
  currentPage: 10,
  progress: 41,
  direction: 'ltr',
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isFavorite: true,
  pages: [],
};

describe('ReviewModal', () => {
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

  it('allows clicking stars, typing notes, and saving review', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <ReviewModal
          publication={SAMPLE_PUB}
          onSave={onSave}
          onClose={onClose}
        />,
      );
    });

    expect(host.textContent).toContain('Batman: The Long Halloween');

    // Click 5th star
    const starButtons = host.querySelectorAll('.review-star-btn');
    expect(starButtons).toHaveLength(5);
    act(() => {
      starButtons[4]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).toContain('5 / 5');

    // Type notes
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();
    if (textarea) {
      act(() => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        nativeSetter?.call(textarea, 'Incrível história de mistério!');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    // Click Save
    const saveBtn = host.querySelector<HTMLButtonElement>('.primary-button');
    act(() => {
      saveBtn?.click();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        publicationId: 'pub-batman',
        rating: 5,
        reviewText: 'Incrível história de mistério!',
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
