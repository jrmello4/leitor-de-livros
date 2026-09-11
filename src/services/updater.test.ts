import { describe, expect, it } from 'vitest';
import { compareVersions, shouldOfferUpdate } from './updater';

describe('compareVersions', () => {
  it('orders semantic versions', () => {
    expect(compareVersions('0.1.2', '0.1.1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1', '0.1.2')).toBeLessThan(0);
    expect(compareVersions('0.1.1', '0.1.1')).toBe(0);
    expect(compareVersions('v0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1-beta', '0.1.1')).toBeLessThan(0);
  });
});

describe('shouldOfferUpdate', () => {
  it('offers a newer version string', () => {
    expect(
      shouldOfferUpdate(
        '0.1.1',
        { version: '0.1.2', versionCode: 10, url: 'https://example.com/a.apk', notes: '' },
        9,
      ),
    ).toBe(true);
  });

  it('offers a newer versionCode on the same version (rolling main builds)', () => {
    expect(
      shouldOfferUpdate(
        '0.1.1',
        { version: '0.1.1', versionCode: 43, url: 'https://example.com/a.apk', notes: '' },
        42,
      ),
    ).toBe(true);
  });

  it('stays quiet on the same version and versionCode', () => {
    expect(
      shouldOfferUpdate(
        '0.1.1',
        { version: '0.1.1', versionCode: 42, url: 'https://example.com/a.apk', notes: '' },
        42,
      ),
    ).toBe(false);
  });

  it('never downgrades', () => {
    expect(
      shouldOfferUpdate(
        '0.1.2',
        { version: '0.1.1', versionCode: 99, url: 'https://example.com/a.apk', notes: '' },
        1,
      ),
    ).toBe(false);
  });
});
