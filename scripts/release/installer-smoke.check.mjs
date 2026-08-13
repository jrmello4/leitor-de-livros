import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage, resultWithFailure } from './installer-smoke.mjs';
import { InstalledAppLifecycleError } from '../windows/installed-app-harness.mjs';

test('result failure serialization keeps the run evidence and message', () => {
  const result = resultWithFailure({ status: 'running', runId: 'test-run' }, new Error('CDP timed out'));
  assert.deepEqual(result, { status: 'failed', runId: 'test-run', failure: 'CDP timed out' });
  assert.equal(errorMessage('plain failure'), 'plain failure');
});

test('result failure serialization preserves lifecycle stage and cleanup failure', () => {
  const lifecycleError = new InstalledAppLifecycleError('connection', 'CDP endpoint timed out', {
    cleanupFailure: new Error('taskkill failed'),
  });

  assert.deepEqual(resultWithFailure({ runId: 'run-1' }, lifecycleError), {
    runId: 'run-1',
    status: 'failed',
    stage: 'connection',
    failure: 'CDP endpoint timed out',
    cleanupFailure: 'taskkill failed',
  });
});
