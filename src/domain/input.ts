import type { ActionName, BindingMap } from './types';

export const ACTION_LABELS: Record<ActionName, string> = {
  next_page: 'Next page',
  previous_page: 'Previous page',
  toggle_library: 'Open library',
  toggle_fullscreen: 'Fullscreen',
  toggle_settings: 'Reader settings',
  toggle_spread: 'Toggle spread',
  cancel: 'Back / cancel',
};

export const DEFAULT_BINDINGS: BindingMap = {
  next_page: ['ArrowRight', 'PageDown'],
  previous_page: ['ArrowLeft', 'PageUp'],
  toggle_library: ['KeyL'],
  toggle_fullscreen: ['KeyF'],
  toggle_settings: ['KeyS'],
  toggle_spread: ['KeyM'],
  cancel: ['Escape'],
};

const ACTION_ORDER: ActionName[] = [
  'next_page',
  'previous_page',
  'toggle_library',
  'toggle_fullscreen',
  'toggle_settings',
  'toggle_spread',
  'cancel',
];

export function cloneBindings(bindings: BindingMap): BindingMap {
  return ACTION_ORDER.reduce((result, action) => {
    result[action] = [...(bindings[action] ?? DEFAULT_BINDINGS[action])];
    return result;
  }, {} as BindingMap);
}

export function bindingLabel(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('PageDown', 'PgDn')
    .replace('PageUp', 'PgUp')
    .replace('Space', 'Space');
}

export class InputMap {
  private readonly bindings: BindingMap;

  constructor(bindings: BindingMap = DEFAULT_BINDINGS) {
    this.bindings = cloneBindings(bindings);
  }

  resolve(code: string): ActionName | undefined {
    return ACTION_ORDER.find((action) => this.bindings[action].includes(code));
  }

  getBindings(): BindingMap {
    return cloneBindings(this.bindings);
  }

  bind(action: ActionName, code: string): { ok: true } | { ok: false; conflict: ActionName } {
    const conflict = ACTION_ORDER.find(
      (candidate) => candidate !== action && this.bindings[candidate].includes(code),
    );

    if (conflict) {
      return { ok: false, conflict };
    }

    this.bindings[action] = [code];
    return { ok: true };
  }

  reset(): void {
    const defaults = cloneBindings(DEFAULT_BINDINGS);
    for (const action of ACTION_ORDER) {
      this.bindings[action] = defaults[action];
    }
  }
}
