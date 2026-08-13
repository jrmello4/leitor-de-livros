import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createInstalledAppHarness, InstalledAppLifecycleError } from './installed-app-harness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function fakePortServer(port, events = []) {
  return {
    once() {},
    listen(_requestedPort, _host, callback) {
      callback();
    },
    address() {
      return { port };
    },
    close(callback) {
      events.push('port-closed');
      callback();
    },
  };
}

function fakeStream(events, label) {
  return {
    destroyed: false,
    writableEnded: false,
    end(callback) {
      events.push(label);
      this.writableEnded = true;
      callback();
    },
  };
}

function successfulLaunchDependencies(events, child, options = {}) {
  const page = {
    getByTestId() {
      return { waitFor: async () => undefined };
    },
  };
  return {
    chromium: {
      connectOverCDP: async () => ({
        close: options.closeBrowser ?? (async () => { events.push('browser'); }),
        contexts: () => [{ pages: () => [page] }],
      }),
    },
    createServer: () => fakePortServer(43210),
    createWriteStream: (filePath) => fakeStream(events, filePath.endsWith('.stdout.log') ? 'stdout' : 'stderr'),
    delay: async () => undefined,
    fetch: async () => ({ ok: true }),
    spawn: () => child,
  };
}

test('finds the newest installed application executable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'installed-app-harness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'Tactile Reader-setup.exe'), 'installer');
  await writeFile(join(root, 'uninstall.exe'), 'uninstaller');
  await writeFile(join(root, 'nested', 'Tactile Reader.exe'), 'application');
  await writeFile(join(root, 'nested', 'Tactile Reader-new.exe'), 'new application');
  await utimes(join(root, 'nested', 'Tactile Reader.exe'), new Date(1_000), new Date(1_000));
  await utimes(join(root, 'nested', 'Tactile Reader-new.exe'), new Date(2_000), new Date(2_000));

  const executable = await createInstalledAppHarness().findNewestExecutable(root);

  assert.equal(executable, join(root, 'nested', 'Tactile Reader-new.exe'));
});

test('returns the condition value after a successful wait', async () => {
  let attempts = 0;
  const harness = createInstalledAppHarness({ delay: async () => undefined });

  const result = await harness.waitFor(() => {
    attempts += 1;
    return attempts === 3 ? 'ready' : false;
  }, 'application readiness', { timeoutMs: 1_000, intervalMs: 0 });

  assert.equal(result, 'ready');
  assert.equal(attempts, 3);
});

test('returns an ephemeral port only after the lease server closes', async () => {
  const events = [];
  const harness = createInstalledAppHarness({ createServer: () => fakePortServer(43123, events) });

  const port = await harness.allocatePort();

  assert.equal(port, 43123);
  assert.deepEqual(events, ['port-closed']);
});

test('reports the installation stage and underlying cause', async () => {
  const installerFailure = new Error('NSIS failed');
  const harness = createInstalledAppHarness({
    mkdir: async () => undefined,
    execFileSync: () => { throw installerFailure; },
  });

  await assert.rejects(
    harness.installPackage('C:\\runs\\package.exe', 'C:\\runs\\installed'),
    (error) => error instanceof InstalledAppLifecycleError
      && error.stage === 'install'
      && error.cause === installerFailure
      && /NSIS failed/.test(error.message),
  );
});

test('rejects cleanup outside the owned run root', async () => {
  const harness = createInstalledAppHarness({ remove: async () => assert.fail('must not remove') });
  harness.registerRunRoot('C:\\runs\\one');
  await assert.rejects(
    harness.removeOwnedPath('C:\\runs\\one', 'C:\\fixtures\\source.cbz'),
    (error) => error.stage === 'cleanup' && /outside/i.test(error.message),
  );
});

test('rejects repository and user directories as cleanup run roots', async () => {
  let removeCalls = 0;
  const harness = createInstalledAppHarness({
    remove: async () => { removeCalls += 1; },
  });

  for (const runRoot of [repositoryRoot, homedir()]) {
    await assert.rejects(
      harness.removeOwnedPath(runRoot, join(runRoot, 'would-be-deleted')),
      (error) => error.stage === 'cleanup' && /unsafe run root/i.test(error.message),
    );
  }

  assert.equal(removeCalls, 0);
});

test('removes an already-missing path only under a registered temporary run root', async (t) => {
  const runRoot = await mkdtemp(join(tmpdir(), 'installed-app-harness-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const harness = createInstalledAppHarness();
  harness.registerRunRoot(runRoot);

  await harness.removeOwnedPath(runRoot, join(runRoot, 'already-missing'));
});

test('rejects an already-missing contained path under an unregistered run root', async (t) => {
  const runRoot = await mkdtemp(join(tmpdir(), 'installed-app-harness-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let removeCalls = 0;
  const harness = createInstalledAppHarness({
    remove: async () => { removeCalls += 1; },
  });

  await assert.rejects(
    harness.removeOwnedPath(runRoot, join(runRoot, 'already-missing')),
    (error) => error instanceof InstalledAppLifecycleError
      && error.stage === 'cleanup'
      && /unregistered run root/i.test(error.message),
  );
  assert.equal(removeCalls, 0);
});

test('records a cleanup failure without replacing a connection deadline', async () => {
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    pid: 1234,
    kill() {},
    stderr: { pipe() {} },
    stdout: { pipe() {} },
  });
  const times = [0, 0, 2];
  const harness = createInstalledAppHarness({
    createServer: () => fakePortServer(43211, events),
    createWriteStream: (filePath) => fakeStream(events, filePath.endsWith('.stdout.log') ? 'stdout' : 'stderr'),
    delay: async () => undefined,
    execFileSync: () => { throw new Error('taskkill failed'); },
    fetch: async () => ({ ok: false }),
    now: () => times.shift() ?? 2,
    spawn: () => child,
  });

  await assert.rejects(
    harness.launchApp({
      evidenceDirectory: 'C:\\safe-evidence',
      executable: 'C:\\safe-app\\Tactile Reader.exe',
      label: 'connection',
      timeoutMs: 1,
    }),
    (error) => error instanceof InstalledAppLifecycleError
      && error.stage === 'connection'
      && /CDP endpoint timed out/.test(error.message)
      && error.cleanupFailure?.message === 'taskkill failed',
  );
  assert.deepEqual(events, ['port-closed', 'stdout', 'stderr']);
});

test('uses taskkill for a launched process tree that does not exit after kill', async () => {
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    pid: 4321,
    kill() { events.push('kill'); },
    stderr: { pipe() {} },
    stdout: { pipe() {} },
  });
  const harness = createInstalledAppHarness({
    ...successfulLaunchDependencies(events, child),
    execFileSync: (command, argumentsList, options) => {
      assert.equal(command, 'taskkill.exe');
      assert.deepEqual(argumentsList, ['/PID', '4321', '/T', '/F']);
      assert.deepEqual(options, { stdio: 'ignore' });
      events.push('taskkill');
      child.exitCode = 0;
    },
  });

  const session = await harness.launchApp({
    evidenceDirectory: 'C:\\safe-evidence',
    executable: 'C:\\safe-app\\Tactile Reader.exe',
    label: 'process-tree',
    timeoutMs: 1,
  });
  await session.close();

  assert.deepEqual(events, ['browser', 'kill', 'taskkill', 'stdout', 'stderr']);
});

test('close is idempotent and closes browser, process, then streams', async () => {
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    pid: 5678,
    kill() {
      events.push('process');
      this.exitCode = 0;
      this.emit('exit');
    },
    stderr: { pipe() {} },
    stdout: { pipe() {} },
  });
  const harness = createInstalledAppHarness(successfulLaunchDependencies(events, child));

  const session = await harness.launchApp({
    evidenceDirectory: 'C:\\safe-evidence',
    executable: 'C:\\safe-app\\Tactile Reader.exe',
    label: 'idempotent-close',
    timeoutMs: 1,
  });
  await session.close();
  await session.close();

  assert.deepEqual(events, ['browser', 'process', 'stdout', 'stderr']);
});

test('concurrent close callers share the same pending cleanup', async () => {
  const events = [];
  const browserClose = deferred();
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    pid: 6789,
    kill() {
      events.push('process');
      this.exitCode = 0;
      this.emit('exit');
    },
    stderr: { pipe() {} },
    stdout: { pipe() {} },
  });
  const harness = createInstalledAppHarness(successfulLaunchDependencies(events, child, {
    closeBrowser: () => {
      events.push('browser');
      return browserClose.promise;
    },
  }));
  const session = await harness.launchApp({
    evidenceDirectory: 'C:\\safe-evidence',
    executable: 'C:\\safe-app\\Tactile Reader.exe',
    label: 'concurrent-close',
    timeoutMs: 1,
  });

  const firstClose = session.close();
  const concurrentClose = session.close();

  assert.strictEqual(concurrentClose, firstClose);
  assert.deepEqual(events, ['browser']);
  browserClose.resolve();
  await Promise.all([firstClose, concurrentClose]);
  assert.deepEqual(events, ['browser', 'process', 'stdout', 'stderr']);
});

test('concurrent close callers share a cleanup error and a later call retries', async () => {
  const events = [];
  const cleanupFailure = new Error('browser cleanup failed');
  let browserCloseAttempts = 0;
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    pid: 7890,
    kill() {
      events.push('process');
      this.exitCode = 0;
      this.emit('exit');
    },
    stderr: { pipe() {} },
    stdout: { pipe() {} },
  });
  const harness = createInstalledAppHarness(successfulLaunchDependencies(events, child, {
    closeBrowser: async () => {
      browserCloseAttempts += 1;
      events.push('browser-' + browserCloseAttempts);
      if (browserCloseAttempts === 1) {
        throw cleanupFailure;
      }
    },
  }));
  const session = await harness.launchApp({
    evidenceDirectory: 'C:\\safe-evidence',
    executable: 'C:\\safe-app\\Tactile Reader.exe',
    label: 'retry-close',
    timeoutMs: 1,
  });

  const firstClose = session.close();
  const concurrentClose = session.close();

  assert.strictEqual(concurrentClose, firstClose);
  const outcomes = await Promise.allSettled([firstClose, concurrentClose]);
  assert.deepEqual(outcomes.map(({ status }) => status), ['rejected', 'rejected']);
  assert.equal(outcomes[0].reason.cause, cleanupFailure);
  assert.equal(outcomes[1].reason, outcomes[0].reason);
  await session.close();
  assert.deepEqual(events, ['browser-1', 'process', 'stdout', 'stderr', 'browser-2']);
});

test('does not terminate an already-exited launched process', async () => {
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: 0,
    signalCode: null,
    pid: 8765,
    kill() { assert.fail('must not kill an already-exited process'); },
    stderr: { pipe() {} },
    stdout: { pipe() {} },
  });
  const harness = createInstalledAppHarness({
    ...successfulLaunchDependencies(events, child),
    execFileSync: () => assert.fail('must not taskkill an already-exited process'),
  });

  const session = await harness.launchApp({
    evidenceDirectory: 'C:\\safe-evidence',
    executable: 'C:\\safe-app\\Tactile Reader.exe',
    label: 'already-exited',
    timeoutMs: 1,
  });
  await session.close();

  assert.deepEqual(events, ['browser', 'stdout', 'stderr']);
});
