import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const evidenceRoot = resolve(process.env.SMOKE_EVIDENCE_DIR ?? join(repositoryRoot, 'artifacts/installer-smoke'));
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);

export function isInstallerExecutable(filePath) {
  const fileName = basename(filePath).toLowerCase();
  return extname(fileName) === '.exe' && !fileName.includes('uninstall') && !fileName.includes('setup');
}

export function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function resultWithFailure(result, error) {
  return {
    ...result,
    status: 'failed',
    failure: errorMessage(error),
  };
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function recursiveFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await recursiveFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

async function newestExecutable(directory, allowSetup) {
  const files = (await recursiveFiles(directory))
    .filter((filePath) => allowSetup ? extname(filePath).toLowerCase() === '.exe' : isInstallerExecutable(filePath));
  if (files.length === 0) {
    return undefined;
  }
  const withStats = await Promise.all(files.map(async (filePath) => ({
    filePath,
    modified: (await stat(filePath)).mtimeMs,
  })));
  withStats.sort((left, right) => right.modified - left.modified);
  return withStats[0]?.filePath;
}

async function allocatePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) {
    throw new Error('Could not allocate a localhost CDP port.');
  }
  return port;
}

async function waitForCdp(port, label) {
  const started = Date.now();
  let lastError = 'CDP endpoint did not answer.';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (response.ok) {
        return;
      }
      lastError = 'HTTP ' + response.status;
    } catch (error) {
      lastError = errorMessage(error);
    }
    await delay(250);
  }
  throw new Error(label + ' CDP endpoint timed out: ' + lastError);
}

async function waitForPageHarness(browser, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const page of pages) {
      try {
        await page.getByTestId('smoke-harness').waitFor({ state: 'visible', timeout: 500 });
        return page;
      } catch {
        // The WebView2 page can exist before React has mounted.
      }
    }
    await delay(250);
  }
  throw new Error(label + ' did not expose the smoke harness.');
}

async function launchApp(executable, label, runEvidenceDirectory) {
  const port = await allocatePort();
  const stdoutPath = join(runEvidenceDirectory, label + '.stdout.log');
  const stderrPath = join(runEvidenceDirectory, label + '.stderr.log');
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);
  const child = spawn(executable, [], {
    cwd: dirname(executable),
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);

  try {
    await waitForCdp(port, label);
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    const page = await waitForPageHarness(browser, label);
    return {
      browser,
      child,
      page,
      async close() {
        await browser.close().catch(() => undefined);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
          await Promise.race([once(child, 'exit'), delay(1500)]);
        }
        if (child.exitCode === null && child.signalCode === null) {
          try {
            execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } catch {
            // The process may have exited between the check and taskkill.
          }
        }
        stdout.end();
        stderr.end();
      },
    };
  } catch (error) {
    child.kill();
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Preserve the original CDP error.
    }
    stdout.end();
    stderr.end();
    throw error;
  }
}

async function waitFor(predicate, description) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(description + (lastError ? ': ' + errorMessage(lastError) : '.'));
}

async function waitForStatus(page, expected) {
  await waitFor(async () => (await page.getByTestId('smoke-status').textContent())?.includes(expected), 'Smoke status did not become ' + expected);
}

async function waitForCardCount(page, expected) {
  await waitFor(async () => (await page.locator('[data-testid="library-publication-card"]').count()) === expected, 'Native library did not reach ' + expected + ' cards');
}

async function waitForLibrary(page) {
  await page.getByTestId('smoke-harness').waitFor({ state: 'visible' });
  await page.getByTestId('library-publication-card').first().waitFor({ state: 'visible' });
}

async function importSource(page, sourcePath) {
  await page.getByTestId('smoke-source-path').fill(sourcePath);
  await page.getByTestId('smoke-import').click();
  await waitForStatus(page, 'Imported');
}

async function importMissingSource(page, sourcePath) {
  await page.getByTestId('smoke-source-path').fill(sourcePath);
  await page.getByTestId('smoke-import').click();
  await waitForStatus(page, 'Import failed');
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function createRunFixtures(runDirectory) {
  const fixtureDirectory = join(runDirectory, 'fixtures');
  const generator = resolve(repositoryRoot, 'scripts/release/create-fixtures.mjs');
  execFileSync(process.execPath, [generator, fixtureDirectory], { cwd: repositoryRoot, stdio: 'pipe' });
  return {
    cbz: join(fixtureDirectory, 'smoke.cbz'),
    pdf: join(fixtureDirectory, 'smoke.pdf'),
  };
}

async function buildInstaller(runDirectory) {
  const configPath = join(runDirectory, 'tauri.smoke.json');
  const bundleDirectory = resolve(repositoryRoot, 'src-tauri/target/release/bundle/nsis');
  const config = {
    identifier: 'com.jrmello4.tactilereader.smoke.' + process.pid,
    productName: 'Tactile Reader Smoke',
    version: '0.1.0',
    bundle: { targets: ['nsis'] },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  const environment = {
    ...process.env,
    VITE_SMOKE_TEST: '1',
    VITE_VISUAL_TEST: '0',
  };
  const npmCli = process.env.npm_execpath
    ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const started = Date.now();
  let output = '';
  try {
    output = execFileSync(process.execPath, [npmCli, 'run', 'tauri:build', '--', '--config', configPath], {
      cwd: repositoryRoot,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    output = String(error.stdout ?? '') + '\n' + String(error.stderr ?? '');
    await writeFile(join(runDirectory, 'build.log'), output, 'utf8');
    throw error;
  }
  await writeFile(join(runDirectory, 'build.log'), output, 'utf8');
  const installer = await newestExecutable(bundleDirectory, true);
  if (!installer) {
    throw new Error('NSIS installer was not found under ' + bundleDirectory + ' after ' + (Date.now() - started) + 'ms.');
  }
  return installer;
}

async function installPackage(installer, installDirectory) {
  await mkdir(installDirectory, { recursive: true });
  execFileSync(installer, ['/S', '/D=' + installDirectory], {
    cwd: dirname(installer),
    stdio: 'ignore',
  });
  const executable = await newestExecutable(installDirectory, false);
  if (!executable) {
    throw new Error('Installed application executable was not found under ' + installDirectory + '.');
  }
  return executable;
}

async function runMissingPdfiumScenario(installDirectory, pdfPath, runDirectory, result) {
  const missingDirectory = join(runDirectory, 'missing-pdfium');
  await cp(installDirectory, missingDirectory, { recursive: true });
  const pdfium = (await recursiveFiles(missingDirectory)).find((filePath) => basename(filePath).toLowerCase() === 'pdfium.dll');
  if (!pdfium) {
    throw new Error('Installed application copy did not contain pdfium.dll.');
  }
  await unlink(pdfium);
  const executable = await newestExecutable(missingDirectory, false);
  if (!executable) {
    throw new Error('PDFium-missing application executable was not found.');
  }

  const session = await launchApp(executable, 'missing-pdfium', join(evidenceRoot, result.runId));
  try {
    await importMissingSource(session.page, pdfPath);
    const diagnostic = (await session.page.getByTestId('smoke-diagnostic').textContent())?.trim() ?? '';
    result.missingPdfiumDiagnostic = diagnostic;
    if (!diagnostic.includes('PDFium runtime not found')) {
      throw new Error('Missing PDFium diagnostic was not actionable: ' + diagnostic);
    }
    if (await session.page.getByTestId('library-publication-card').count() !== 0) {
      throw new Error('Missing PDFium import created a publication unexpectedly.');
    }
  } finally {
    await session.close();
  }
}

async function runIntactScenario(executable, cbzPath, pdfPath, runDirectory, result) {
  const session = await launchApp(executable, 'intact-first', join(evidenceRoot, result.runId));
  try {
    await importSource(session.page, cbzPath);
    await waitForCardCount(session.page, 1);
    await session.page.getByTestId('reader-back').click();
    await waitForLibrary(session.page);

    await importSource(session.page, pdfPath);
    await waitForCardCount(session.page, 2);
    await session.page.getByTestId('reader-back').click();
    await waitForLibrary(session.page);

    const cbzCard = session.page.locator('[data-testid="library-publication-card"][data-publication-format="cbz"]');
    await cbzCard.locator('.cover-button').click();
    await session.page.getByTestId('reader-stage').waitFor({ state: 'visible' });
    await session.page.getByTestId('reader-next').click();
    await waitFor(async () => (await session.page.getByTestId('reader-current-page').getAttribute('data-page-index')) === '1', 'CBZ page did not advance');
  } finally {
    await session.close();
  }

  const resumed = await launchApp(executable, 'intact-resumed', join(evidenceRoot, result.runId));
  try {
    await waitForCardCount(resumed.page, 2);
    const cbzCard = resumed.page.locator('[data-testid="library-publication-card"][data-publication-format="cbz"]');
    await cbzCard.locator('.cover-button').click();
    await resumed.page.getByTestId('reader-stage').waitFor({ state: 'visible' });
    const resumedPage = await resumed.page.getByTestId('reader-current-page').getAttribute('data-page-index');
    result.resumedPage = resumedPage;
    if (resumedPage !== '1') {
      throw new Error('CBZ progress was not restored after restart. Current page: ' + resumedPage);
    }
    await resumed.page.getByTestId('reader-back').click();
    await waitForLibrary(resumed.page);
    const card = resumed.page.locator('[data-testid="library-publication-card"][data-publication-format="cbz"]');
    await card.getByTestId('library-publication-remove').click();
    await resumed.page.getByTestId('library-remove-confirm').click();
    await waitFor(async () => (await resumed.page.locator('[data-testid="library-publication-card"][data-publication-format="cbz"]').count()) === 0, 'CBZ card was not removed');
    if (await resumed.page.locator('[data-testid="library-publication-card"][data-publication-format="pdf"]').count() !== 1) {
      throw new Error('Removing CBZ also removed the PDF publication.');
    }
    result.removedPublication = true;
  } finally {
    await resumed.close();
  }
}

async function main() {
  const runId = Date.now() + '-' + process.pid;
  const runDirectory = await mkdtemp(join(tmpdir(), 'tactile-reader-smoke-'));
  const evidenceDirectory = join(evidenceRoot, runId);
  await mkdir(evidenceDirectory, { recursive: true });
  const result = {
    runId,
    status: 'failed',
    installer: null,
    installDirectory: join(runDirectory, 'installed'),
    missingPdfiumDiagnostic: null,
    resumedPage: null,
    removedPublication: false,
    sourceHashesBefore: {},
    sourceHashesAfter: {},
    failure: null,
  };

  try {
    const fixtures = await createRunFixtures(runDirectory);
    result.sourceHashesBefore = {
      cbz: await sha256(fixtures.cbz),
      pdf: await sha256(fixtures.pdf),
    };
    result.installer = await buildInstaller(runDirectory);
    const executable = await installPackage(result.installer, result.installDirectory);
    await runMissingPdfiumScenario(result.installDirectory, fixtures.pdf, runDirectory, result);
    await runIntactScenario(executable, fixtures.cbz, fixtures.pdf, runDirectory, result);
    result.sourceHashesAfter = {
      cbz: await sha256(fixtures.cbz),
      pdf: await sha256(fixtures.pdf),
    };
    if (JSON.stringify(result.sourceHashesBefore) !== JSON.stringify(result.sourceHashesAfter)) {
      throw new Error('Fixture source hashes changed during the smoke run.');
    }
    result.status = 'passed';
  } catch (error) {
    Object.assign(result, resultWithFailure(result, error));
    try {
      await writeFile(join(evidenceDirectory, 'failure.txt'), errorMessage(error) + '\n', 'utf8');
    } catch {
      // The result write below remains the final evidence attempt.
    }
  } finally {
    await writeFile(join(evidenceDirectory, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ evidenceDirectory, result }));
    if (result.status !== 'passed') {
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
