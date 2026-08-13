import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmokeHarness, smokeStatusText } from './SmokeHarness';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SmokeHarness', () => {
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

  it('maps each typed state to the automation status copy', () => {
    expect(smokeStatusText({ phase: 'ready' })).toBe('Ready');
    expect(smokeStatusText({ phase: 'importing' }, { importing: 'Loading source…' })).toBe('Loading source…');
    expect(smokeStatusText({ phase: 'imported' })).toBe('Imported');
    expect(smokeStatusText({ phase: 'failed', reason: 'missing-path' })).toBe('Enter a source path');
    expect(smokeStatusText({ phase: 'failed', reason: 'import' })).toBe('Import failed');
  });

  it('renders the path input, status, and diagnostic hooks', () => {
    act(() => root.render(
      <SmokeHarness onImportPath={vi.fn()} diagnostic="PDFium runtime not found." />,
    ));

    expect(host.querySelector('[data-testid="smoke-source-path"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toContain('Ready');
    expect(host.querySelector('[data-testid="smoke-diagnostic"]')?.textContent).toContain('PDFium runtime not found.');
    expect(host.querySelector('[data-testid="smoke-import-complete"]')?.getAttribute('data-sequence')).toBe('0');
  });

  it('reports the async successful import', async () => {
    let resolveImport: (() => void) | undefined;
    const onImportPath = vi.fn(() => new Promise<void>((resolve) => {
      resolveImport = resolve;
    }));
    act(() => root.render(<SmokeHarness onImportPath={onImportPath} diagnostic={null} />));

    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]');
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]');
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\smoke.cbz');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      button!.click();
      await Promise.resolve();
    });

    expect(onImportPath).toHaveBeenCalledWith('C:\\fixtures\\smoke.cbz');
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toContain('Importing');

    await act(async () => {
      resolveImport?.();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toContain('Imported');
  });

  it('stays disabled while an alternate importing copy is displayed', async () => {
    let resolveImport: (() => void) | undefined;
    const onImportPath = vi.fn(() => new Promise<void>((resolve) => {
      resolveImport = resolve;
    }));
    const props = {
      onImportPath,
      diagnostic: null,
      copy: { importing: 'Loading source…' },
    };
    act(() => root.render(<SmokeHarness {...props} />));

    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]')!;
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\smoke.cbz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toBe('Loading source…');
    expect(button.disabled).toBe(true);

    await act(async () => {
      resolveImport?.();
      await Promise.resolve();
    });
  });

  it('ignores a submit event while an import is already in flight', async () => {
    let resolveImport: (() => void) | undefined;
    const onImportPath = vi.fn(() => new Promise<void>((resolve) => {
      resolveImport = resolve;
    }));
    act(() => root.render(<SmokeHarness onImportPath={onImportPath} diagnostic={null} />));

    const form = host.querySelector('form')!;
    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]')!;
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\smoke.cbz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await Promise.resolve();
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onImportPath).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveImport?.();
      await Promise.resolve();
    });
  });

  it('allows another submit after an import resolves', async () => {
    let resolveFirstImport: (() => void) | undefined;
    let attempts = 0;
    const onImportPath = vi.fn((_path: string) => {
      attempts += 1;
      return attempts === 1
        ? new Promise<void>((resolve) => {
          resolveFirstImport = resolve;
        })
        : Promise.resolve();
    });
    act(() => root.render(<SmokeHarness onImportPath={onImportPath} diagnostic={null} />));

    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]')!;
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\smoke.cbz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await Promise.resolve();
    });

    await act(async () => {
      resolveFirstImport?.();
      await Promise.resolve();
    });

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(onImportPath).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toBe('Imported');
  });

  it('allows another submit after an import rejects', async () => {
    let rejectFirstImport: ((reason?: unknown) => void) | undefined;
    let attempts = 0;
    const onImportPath = vi.fn((_path: string) => {
      attempts += 1;
      return attempts === 1
        ? new Promise<void>((_resolve, reject) => {
          rejectFirstImport = reject;
        })
        : Promise.resolve();
    });
    act(() => root.render(<SmokeHarness onImportPath={onImportPath} diagnostic={null} />));

    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]')!;
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\missing.pdf');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await Promise.resolve();
    });

    await act(async () => {
      rejectFirstImport?.(new Error('missing source'));
      await Promise.resolve();
    });

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(onImportPath).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toBe('Imported');
  });

  it('reports missing-path without invoking import for an empty path', async () => {
    const onImportPath = vi.fn();
    act(() => root.render(<SmokeHarness onImportPath={onImportPath} diagnostic={null} />));

    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(onImportPath).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toBe('Enter a source path');
  });

  it('reports import failure when the import rejects', async () => {
    const onImportPath = vi.fn().mockRejectedValue(new Error('missing source'));
    act(() => root.render(<SmokeHarness onImportPath={onImportPath} diagnostic={null} />));

    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]')!;
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\missing.pdf');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await Promise.resolve();
    });
    expect(onImportPath).toHaveBeenCalledWith('C:\\fixtures\\missing.pdf');
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toBe('Import failed');
  });
});
