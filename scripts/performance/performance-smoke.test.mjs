import assert from 'node:assert/strict';
import test from 'node:test';
import {
  performanceFailureEvidence,
  requirePassedPerformanceReport,
  settlePerformanceLifecycle,
} from './performance-smoke.mjs';

test('turns failed scenario evidence into an explicit execution-stage failure', () => {
  assert.throws(
    () => requirePassedPerformanceReport({
      status: 'failed',
      scenarios: {
        'first-frame': { status: 'failed', failures: ['threshold exceeded'] },
        import: { status: 'passed' },
      },
    }),
    (error) => error.stage === 'execution'
      && /first-frame/.test(error.message)
      && /threshold exceeded/.test(error.message),
  );
});

test('successful performance caller still cleans its owned run state', async () => {
  const events = [];
  const outcome = await settlePerformanceLifecycle({
    cleanup: async () => { events.push('cleanup'); },
    execute: async () => { events.push('execute'); return { status: 'passed' }; },
  });

  assert.deepEqual(events, ['execute', 'cleanup']);
  assert.deepEqual(outcome, { error: undefined, value: { status: 'passed' } });
});

test('performance failure evidence preserves execution failure and serializes cleanup failure separately', async () => {
  const events = [];
  const primary = new Error('scenario failed');
  const cleanup = new Error('run-root removal failed');
  const outcome = await settlePerformanceLifecycle({
    cleanup: async () => { events.push('cleanup'); throw cleanup; },
    execute: async () => { events.push('execute'); throw primary; },
  });

  assert.deepEqual(events, ['execute', 'cleanup']);
  assert.equal(outcome.error.cause, primary);
  assert.deepEqual(performanceFailureEvidence(outcome.error), {
    stage: 'execution',
    failure: 'scenario failed',
    cleanupFailure: 'run-root removal failed',
    errors: ['scenario failed'],
  });
});
