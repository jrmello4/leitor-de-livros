import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage, isInstallerExecutable, resultWithFailure } from './installer-smoke.mjs';

test('installer discovery excludes setup and uninstall executables', () => {
  assert.equal(isInstallerExecutable('Tactile Reader.exe'), true);
  assert.equal(isInstallerExecutable('Tactile Reader_0.1.0_x64-setup.exe'), false);
  assert.equal(isInstallerExecutable('uninstall.exe'), false);
  assert.equal(isInstallerExecutable('Tactile Reader.dll'), false);
});

test('result failure serialization keeps the run evidence and message', () => {
  const result = resultWithFailure({ status: 'running', runId: 'test-run' }, new Error('CDP timed out'));
  assert.deepEqual(result, { status: 'failed', runId: 'test-run', failure: 'CDP timed out' });
  assert.equal(errorMessage('plain failure'), 'plain failure');
});
