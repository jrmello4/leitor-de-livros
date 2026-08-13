import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInstalledAppHarness, InstalledAppLifecycleError } from './installed-app-harness.mjs';

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
  await assert.rejects(
    harness.removeOwnedPath('C:\\runs\\one', 'C:\\fixtures\\source.cbz'),
    (error) => error.stage === 'cleanup' && /outside/i.test(error.message),
  );
});
