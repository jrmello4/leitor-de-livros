import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUNDLE_BUDGETS, evaluateBundleBudget } from './bundle-budget.mjs';

const CURRENT_SHAPE = [
  { name: 'index-AbC123.js', bytes: 350_000 },
  { name: 'ReaderView-XyZ456.js', bytes: 112_000 },
  { name: 'vendor-react-QwE789.js', bytes: 12_000 },
  { name: 'SyncModal-MoD012.js', bytes: 6_000 },
  { name: 'index-DyZmEu.css', bytes: 87_000 },
];

describe('bundle-budget', () => {
  it('passes on the current bundle shape', () => {
    const result = evaluateBundleBudget(CURRENT_SHAPE);
    assert.equal(result.passed, true);
    assert.deepEqual(result.violations, []);
    assert.equal(result.totals.entryJs, 350_000);
  });

  it('fails when the entry chunk grows past the budget', () => {
    const files = CURRENT_SHAPE.map((file) => (
      file.name.startsWith('index-') && file.name.endsWith('.js')
        ? { ...file, bytes: BUNDLE_BUDGETS.entryJs + 1 }
        : file
    ));
    const result = evaluateBundleBudget(files);
    assert.equal(result.passed, false);
    assert.match(result.violations.join('\n'), /entry index-AbC123\.js/);
  });

  it('fails when a lazy chunk grows past the per-chunk budget', () => {
    const files = CURRENT_SHAPE.map((file) => (
      file.name.startsWith('ReaderView-')
        ? { ...file, bytes: BUNDLE_BUDGETS.anyChunkJs + 1 }
        : file
    ));
    const result = evaluateBundleBudget(files);
    assert.equal(result.passed, false);
    assert.match(result.violations.join('\n'), /lazy chunk ReaderView-/);
  });

  it('fails when CSS grows past the budget', () => {
    const files = CURRENT_SHAPE.map((file) => (
      file.name.endsWith('.css') ? { ...file, bytes: BUNDLE_BUDGETS.totalCss + 1 } : file
    ));
    const result = evaluateBundleBudget(files);
    assert.equal(result.passed, false);
    assert.match(result.violations.join('\n'), /total CSS/);
  });

  it('fails when the entry chunk is missing', () => {
    const result = evaluateBundleBudget([{ name: 'vendor-react-x.js', bytes: 10 }]);
    assert.equal(result.passed, false);
    assert.match(result.violations.join('\n'), /index-\*\.js not found/);
  });
});
