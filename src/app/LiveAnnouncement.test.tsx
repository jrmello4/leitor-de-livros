import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerLocale, setLocale, t } from '../i18n/catalog';
import { LiveAnnouncement } from './LiveAnnouncement';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('localized live announcements', () => {
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
    setLocale('en');
  });

  it('announces a dynamic page change through a polite status region', () => {
    act(() => root.render(<LiveAnnouncement message={t('app.pageReady', { page: 2, count: 8 })} />));

    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
    expect(status?.textContent).toBe('Page 2 of 8.');
  });

  it('updates the live region from another locale without component changes', () => {
    registerLocale('test-live', {
      'app.pageReady': ({ page, count }) => `Test page ${page}/${count}`,
      'render.recovering': 'Test renderer recovering',
    });
    setLocale('test-live');

    act(() => root.render(<LiveAnnouncement message={t('app.pageReady', { page: 3, count: 8 })} />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Test page 3/8');

    act(() => root.render(<LiveAnnouncement message={t('render.recovering')} />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Test renderer recovering');
  });

  it('announces pluralized text without accepting technical diagnostics', () => {
    act(() => root.render(
      <>
        <LiveAnnouncement message={t('library.pages', { count: 2 })} />
        <code data-testid="diagnostic">backend=webgl2 · fps=42</code>
      </>,
    ));

    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toBe('2 pages');
    expect(status?.textContent).not.toMatch(/webgl|fps/i);
    expect(host.querySelector('[data-testid="diagnostic"]')?.textContent).toContain('webgl2');
  });
});
