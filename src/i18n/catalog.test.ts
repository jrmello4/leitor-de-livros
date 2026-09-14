import { afterEach, describe, expect, it } from 'vitest';
import { availableLocales, getLocale, hasTranslation, registerLocale, setLocale, t } from './catalog';
import { PT_BR_CATALOG } from './pt-BR';

describe('interface message catalogue', () => {
  afterEach(() => setLocale('pt-BR'));

  it('interpolates dynamic values and chooses singular/plural text', () => {
    registerLocale('en', {});
    setLocale('en');
    expect(t('library.pages', { count: 1 })).toBe('1 page');
    expect(t('library.pages', { count: 4 })).toBe('4 pages');
    expect(t('reader.pageOf', { page: 2, count: 8 })).toBe('Page 2 of 8.');
  });

  it('reports missing keys without silently hiding untranslated UI', () => {
    expect(hasTranslation('does.not.exist')).toBe(false);
    expect(t('does.not.exist')).toBe('[missing translation: does.not.exist]');
  });

  it('allows a new locale catalogue without component changes', () => {
    registerLocale('test', {
      'app.libraryReady': 'Shelf ready in test locale.',
    });
    setLocale('test');
    expect(getLocale()).toBe('test');
    expect(t('app.libraryReady')).toBe('Shelf ready in test locale.');
    expect(t('library.pages', { count: 2 })).toBe('2 pages');
  });

  it('provides available locales list with PT-BR only', () => {
    const locales = availableLocales();
    expect(locales.map((l) => l.code)).toEqual(['pt-BR']);
  });

  it('translates messages and formats plurals in Portuguese (pt-BR)', () => {
    registerLocale('pt-BR', PT_BR_CATALOG);
    setLocale('pt-BR');
    expect(getLocale()).toBe('pt-BR');
    expect(t('app.libraryReady')).toBe('Biblioteca pronta.');
    expect(t('library.pages', { count: 1 })).toBe('1 página');
    expect(t('library.pages', { count: 5 })).toBe('5 páginas');
    expect(t('reader.pageOf', { page: 3, count: 10 })).toBe('Página 3 de 10.');
    expect(t('library.filterFormat')).toBe('Formato');
    expect(t('library.filterStatus')).toBe('Status');
  });
});
