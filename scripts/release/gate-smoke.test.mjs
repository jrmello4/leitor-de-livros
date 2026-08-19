import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateDecision } from './gate-smoke.mjs';

test('a passing smoke run releases', () => {
  assert.equal(gateDecision({ status: 'passed' }).publish, true);
});

test('a failure while exercising the app stops the release', () => {
  const decision = gateDecision({ status: 'failed', stage: 'execution', failure: 'CBZ page did not advance.' });
  assert.equal(decision.publish, false);
  assert.match(decision.reason, /CBZ page did not advance/);
});

test('a runner that cannot drive the app stops the release by default', () => {
  const decision = gateDecision({ status: 'failed', stage: 'connection', failure: 'CDP endpoint did not answer.' });
  assert.equal(decision.publish, false);
  assert.match(decision.reason, /proves nothing/);
});

test('a person can publish from a runner that cannot drive the app', () => {
  const decision = gateDecision(
    { status: 'failed', stage: 'connection', failure: 'CDP endpoint did not answer.' },
    { allowUntestedRunner: true },
  );
  assert.equal(decision.publish, true);
  assert.equal(decision.untested, true);
});

test('an execution failure is never waved through', () => {
  const decision = gateDecision(
    { status: 'failed', stage: 'execution', failure: 'CBZ page did not advance.' },
    { allowUntestedRunner: true },
  );
  assert.equal(decision.publish, false);
});

test('a missing result stops the release', () => {
  assert.equal(gateDecision(undefined).publish, false);
});
