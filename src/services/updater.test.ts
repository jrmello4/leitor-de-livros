import { describe, expect, it } from 'vitest';
import { compareVersions } from './updater';

describe('compareVersions', () => {
  it('orders semantic versions', () => {
    expect(compareVersions('0.1.2', '0.1.1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1', '0.1.2')).toBeLessThan(0);
    expect(compareVersions('0.1.1', '0.1.1')).toBe(0);
    expect(compareVersions('v0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1-beta', '0.1.1')).toBeLessThan(0);
  });
});
