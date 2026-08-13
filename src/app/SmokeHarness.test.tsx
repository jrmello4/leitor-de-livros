import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmokeHarness } from './SmokeHarness';

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

  it('reports a rejected import and ignores an empty path', async () => {
    const onImportPath = vi.fn().mockRejectedValue(new Error('missing source'));
    act(() => root.render(<SmokeHarness onImportPath={onImportPath} diagnostic={null} />));

    const input = host.querySelector<HTMLInputElement>('[data-testid="smoke-source-path"]')!;
    const button = host.querySelector<HTMLButtonElement>('[data-testid="smoke-import"]')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(onImportPath).not.toHaveBeenCalled();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'C:\\fixtures\\missing.pdf');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      await Promise.resolve();
    });
    expect(onImportPath).toHaveBeenCalledWith('C:\\fixtures\\missing.pdf');
    expect(host.querySelector('[data-testid="smoke-status"]')?.textContent).toContain('Import failed');
  });
});
