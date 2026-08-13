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
    mkdir: async () => undefined,
    spawn: () => child,
  };
}

function launchOptions(harness, label, options = {}) {
  const runRoot = 'C:\\runs\\installed-app-harness-' + label;
  harness.registerRunRoot(runRoot);
  return {
    evidenceDirectory: 'C:\\safe-evidence',
    executable: 'C:\\safe-app\\Tactile Reader.exe',
    label,
    runRoot,
    timeoutMs: 1,
    ...options,
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
      && error.stage === 'installation'
      && error.cause === installerFailure
      && /NSIS failed/.test(error.message),
  );
});

test('uses the closed execution stage for condition timeouts', async () => {
  const times = [0, 0, 2];
  const harness = createInstalledAppHarness({
    delay: async () => undefined,
    now: () => times.shift() ?? 2,
  });

  await assert.rejects(
    harness.waitFor(() => false, 'reader never became ready', { timeoutMs: 1 }),
    (error) => error instanceof InstalledAppLifecycleError
      && error.stage === 'execution'
      && /reader never became ready/.test(error.message),
  );
});

test('reports a deterministic occupied-port listen error', async () => {
  const occupied = Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' });
  const harness = createInstalledAppHarness({
    createServer: () => {
      let onError;
      return {
        once(event, listener) {
          assert.equal(event, 'error');
          onError = listener;
        },
        listen(port, host) {
          assert.equal(port, 0);
          assert.equal(host, '127.0.0.1');
          queueMicrotask(() => onError(occupied));
        },
      };
    },
  });

  await assert.rejects(
    harness.allocatePort(),
    (error) => error instanceof InstalledAppLifecycleError
      && error.stage === 'launch'
      && error.cause === occupied,
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
    mkdir: async () => undefined,
    now: () => times.shift() ?? 2,
    spawn: () => child,
  });

  await assert.rejects(
    harness.launchApp(launchOptions(harness, 'connection')),
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

  const session = await harness.launchApp(launchOptions(harness, 'process-tree'));
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

  const session = await harness.launchApp(launchOptions(harness, 'idempotent-close'));
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
  const session = await harness.launchApp(launchOptions(harness, 'concurrent-close'));

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
  const session = await harness.launchApp(launchOptions(harness, 'retry-close'));

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

  const session = await harness.launchApp(launchOptions(harness, 'already-exited'));
  await session.close();

  assert.deepEqual(events, ['browser', 'stdout', 'stderr']);
});

test('launch contains Tauri app data under the registered run root', async () => {
  const events = [];
  let launchOptions;
  const child = Object.assign(new EventEmitter(), {
    exitCode: 0,
    signalCode: null,
    pid: 9012,
    stderr: { pipe() {} },
    stdout: { pipe() {} },
  });
  const runRoot = 'C:\\runs\\app-data-contained';
  const harness = createInstalledAppHarness({
    ...successfulLaunchDependencies(events, child),
    spawn: (_executable, _argumentsList, options) => {
      launchOptions = options;
      return child;
    },
  });
  harness.registerRunRoot(runRoot);

  const session = await harness.launchApp({
    evidenceDirectory: 'C:\\safe-evidence',
    executable: 'C:\\safe-app\\Tactile Reader.exe',
    label: 'contained-app-data',
    runRoot,
    timeoutMs: 1,
  });
  await session.close();

  assert.equal(launchOptions.env.APPDATA, resolve(runRoot, 'app-data', 'roaming'));
  assert.equal(launchOptions.env.LOCALAPPDATA, resolve(runRoot, 'app-data', 'local'));
});

test('silently uninstalls NSIS before removing the owned run root and remains idempotent', async (t) => {
  const events = [];
  const runRoot = await mkdtemp(join(tmpdir(), 'installed-app-harness-cleanup-'));
  const installDirectory = join(runRoot, 'installed');
  const uninstaller = join(installDirectory, 'uninstall.exe');
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  await mkdir(installDirectory, { recursive: true });
  await writeFile(uninstaller, 'owned uninstaller');
  const harness = createInstalledAppHarness({
    execFileSync: (command, argumentsList, options) => {
      assert.equal(command, uninstaller);
      assert.deepEqual(argumentsList, ['/S']);
      assert.deepEqual(options, { cwd: installDirectory, stdio: 'ignore', windowsHide: true });
      events.push('uninstall');
    },
    remove: async (target, options) => {
      assert.equal(target, resolve(runRoot));
      assert.deepEqual(options, { recursive: true, force: true });
      events.push('remove-root');
      await rm(target, options);
    },
  });
  harness.registerRunRoot(runRoot);

  assert.equal(await harness.uninstallPackage(runRoot, installDirectory), true);
  await harness.removeOwnedRunRoot(runRoot);
  assert.equal(await harness.uninstallPackage(runRoot, installDirectory), false);
  await harness.removeOwnedRunRoot(runRoot);

  assert.deepEqual(events, ['uninstall', 'remove-root', 'remove-root']);
});

test('cleanup closes the session, uninstalls NSIS, and removes the run root even after an earlier cleanup failure', async (t) => {
  const events = [];
  const runRoot = await mkdtemp(join(tmpdir(), 'installed-app-harness-cleanup-order-'));
  const installDirectory = join(runRoot, 'installed');
  const uninstaller = join(installDirectory, 'uninstall.exe');
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  await mkdir(installDirectory, { recursive: true });
  await writeFile(uninstaller, 'owned uninstaller');
  const harness = createInstalledAppHarness({
    execFileSync: () => { events.push('uninstall'); },
    remove: async (target, options) => {
      events.push('remove-root');
      await rm(target, options);
    },
  });
  harness.registerRunRoot(runRoot);

  await assert.rejects(
    harness.cleanupRun({
      installDirectory,
      runRoot,
      session: { close: async () => { events.push('session-close'); throw new Error('browser close failed'); } },
    }),
    (error) => error instanceof InstalledAppLifecycleError
      && error.stage === 'cleanup'
      && error.cause?.message === 'browser close failed',
  );

  assert.deepEqual(events, ['session-close', 'uninstall', 'remove-root']);
});
