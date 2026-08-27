import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncModal } from './SyncModal';
import { t } from '../i18n/catalog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SyncModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    window.localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it('renders export and import sections and closes properly', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<SyncModal onClose={onClose} />);
    });

    expect(host.textContent).toContain(t('sync.title'));
    expect(host.textContent).toContain(t('sync.export'));
    expect(host.textContent).toContain(t('sync.import'));

    const closeBtn = host.querySelector<HTMLButtonElement>('.collector-modal-close');
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
