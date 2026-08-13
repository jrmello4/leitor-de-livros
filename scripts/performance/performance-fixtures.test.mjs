import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { createCbz } from './png-fixtures.mjs';

test('creates deterministic raster CBZ fixtures with the required page counts', () => {
  const palette = { color: [33, 50, 63], accent: [225, 164, 88] };
  const first = createCbz(50, palette);
  const second = createCbz(50, palette);
  assert.deepEqual(first, second);
  const entries = unzipSync(first);
  const names = Object.keys(entries);
  assert.equal(names.length, 50);
  assert.equal(names[0], 'page-001.png');
  assert.equal(names.at(-1), 'page-050.png');
  assert.deepEqual(Array.from(entries[names[0]].subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
});
