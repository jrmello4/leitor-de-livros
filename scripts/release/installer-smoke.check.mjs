import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage, resultWithFailure, settleInstallerLifecycle } from './installer-smoke.mjs';
import { InstalledAppLifecycleError } from '../windows/installed-app-harness.mjs';

test('result failure serialization keeps the run evidence and message', () => {
  const result = resultWithFailure({ status: 'running', runId: 'test-run' }, new Error('CDP timed out'));
  assert.deepEqual(result, { status: 'failed', runId: 'test-run', stage: 'execution', failure: 'CDP timed out' });
  assert.equal(errorMessage('plain failure'), 'plain failure');
});

test('successful installer caller still cleans its owned run state', async () => {
  const events = [];
  const outcome = await settleInstallerLifecycle({
    cleanup: async () => { events.push('cleanup'); },
    execute: async () => { events.push('execute'); },
    result: { runId: 'success-run', status: 'running' },
  });

  assert.deepEqual(events, ['execute', 'cleanup']);
  assert.deepEqual(outcome, {
    error: undefined,
    result: { runId: 'success-run', status: 'passed' },
  });
});

test('failed installer caller cleans temporary state while preserving the primary failure', async () => {
  const events = [];
  const primary = new Error('scenario failed');
  const cleanup = new Error('cleanup failed');
  const outcome = await settleInstallerLifecycle({
    cleanup: async () => { events.push('cleanup'); throw cleanup; },
    execute: async () => { events.push('execute'); throw primary; },
    result: { runId: 'failed-run', status: 'running' },
  });

  assert.deepEqual(events, ['execute', 'cleanup']);
  assert.equal(outcome.error.cause, primary);
  assert.deepEqual(outcome.result, {
    runId: 'failed-run',
    status: 'failed',
    stage: 'execution',
    failure: 'scenario failed',
    cleanupFailure: 'cleanup failed',
  });
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
