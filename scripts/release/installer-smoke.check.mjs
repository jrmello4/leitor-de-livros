import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage, resultWithFailure } from './installer-smoke.mjs';

test('result failure serialization keeps the run evidence and message', () => {
  const result = resultWithFailure({ status: 'running', runId: 'test-run' }, new Error('CDP timed out'));
  assert.deepEqual(result, { status: 'failed', runId: 'test-run', failure: 'CDP timed out' });
  assert.equal(errorMessage('plain failure'), 'plain failure');
});
