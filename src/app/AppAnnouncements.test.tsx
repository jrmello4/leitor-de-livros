import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererStatus } from '../rendering/contracts';
import { registerLocale, setLocale } from '../i18n/catalog';
import { App } from './App';

vi.mock('../rendering/ReaderSurface', () => ({
  ReaderSurface({
    staticContent,
    onStatus,
  }: {
    staticContent: ReactNode;
    onStatus: (status: RendererStatus) => void;
  }) {
    useEffect(() => {
      onStatus({ backend: 'static', quality: 'essential' });
    }, [onStatus]);
    return <div data-testid="reader-surface">{staticContent}</div>;
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('application live-region wiring', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    registerLocale('integration-live', {
      'app.pageReady': ({ page, count }) => `Integration page ${page}/${count}`,
      'render.recovering': 'Integration renderer recovering',
    });
    setLocale('integration-live');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    localStorage.clear();
    setLocale('en');
  });

  it('announces reader navigation and renderer state through real consumers', async () => {
    await act(async () => {
      root.render(<App />);
      await flushReact();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.continue-button')?.click();
      await flushReact();
    });

    const rendererStatus = host.querySelector('[data-testid="renderer-status-announcement"]');
    const rendererDiagnostic = host.querySelector('[data-testid="renderer-diagnostic"]');
    expect(rendererStatus?.getAttribute('role')).toBe('status');
    expect(rendererStatus?.textContent).toBe('Integration renderer recovering');
    expect(rendererStatus?.textContent).not.toMatch(/backend|quality/i);
    expect(rendererDiagnostic?.textContent).toContain('backend=static');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.click();
      await flushReact();
    });

    const statusMessages = [...host.querySelectorAll('[role="status"]')].map((node) => node.textContent ?? '');
    expect(statusMessages.some((message) => /^Integration page 2\/\d+$/.test(message))).toBe(true);
  });
});
