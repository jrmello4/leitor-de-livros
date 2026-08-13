import { expect, test } from 'vitest';
import { expectedRtlMotion } from './visual-matrix';

test('expectedRtlMotion requires backward RTL motion with positive progress', () => {
  expect(expectedRtlMotion('rtl', 0.5)).toBe(true);
  expect(expectedRtlMotion('ltr', 0.5)).toBe(false);
  expect(expectedRtlMotion('rtl', 0)).toBe(false);
});
