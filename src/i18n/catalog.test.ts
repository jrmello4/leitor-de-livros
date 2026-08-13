import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, hasTranslation, registerLocale, setLocale, t } from './catalog';

describe('interface message catalogue', () => {
  afterEach(() => setLocale('en'));

  it('interpolates dynamic values and chooses singular/plural text', () => {
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
});
