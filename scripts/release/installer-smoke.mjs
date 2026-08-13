import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstalledAppHarness } from '../windows/installed-app-harness.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const evidenceRoot = resolve(process.env.SMOKE_EVIDENCE_DIR ?? join(repositoryRoot, 'artifacts/installer-smoke'));
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);
const installedAppHarness = createInstalledAppHarness();

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

function waitFor(predicate, description) {
  return installedAppHarness.waitFor(predicate, description, { timeoutMs });
}

async function waitForStatus(page, expected) {
  await waitFor(async () => (await page.getByTestId('smoke-status').textContent())?.includes(expected), 'Smoke status did not become ' + expected);
}

async function waitForCardCount(page, expected) {
  await waitFor(async () => (await page.locator('[data-testid="library-publication-card"]').count()) === expected, 'Native library did not reach ' + expected + ' cards');
}

async function waitForNativeLibraryReady(page) {
  await page.locator('[data-testid="native-library-ready"][data-ready="true"]').waitFor({ state: 'attached' });
}

async function waitForReader(page) {
  await page.getByTestId('reader-stage').waitFor({ state: 'visible' });
  await page.getByTestId('reader-current-page').waitFor({ state: 'visible' });
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

async function buildInstaller(runDirectory, runId) {
  const configPath = join(runDirectory, 'tauri.smoke.json');
  const bundleDirectory = resolve(repositoryRoot, 'src-tauri/target/release/bundle/nsis');
  const config = {
    identifier: 'com.jrmello4.tactilereader.smoke.' + runId.replaceAll('-', ''),
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
  const installer = await installedAppHarness.findNewestExecutable(bundleDirectory, { allowSetup: true });
  if (!installer) {
    throw new Error('NSIS installer was not found under ' + bundleDirectory + ' after ' + (Date.now() - started) + 'ms.');
  }
  return installer;
}

async function runMissingPdfiumScenario(installDirectory, pdfPath, runDirectory, result) {
  const missingDirectory = join(runDirectory, 'missing-pdfium');
  await cp(installDirectory, missingDirectory, { recursive: true });
  const pdfium = (await recursiveFiles(missingDirectory)).find((filePath) => basename(filePath).toLowerCase() === 'pdfium.dll');
  if (!pdfium) {
    throw new Error('Installed application copy did not contain pdfium.dll.');
  }
  await unlink(pdfium);
  const executable = await installedAppHarness.findNewestExecutable(missingDirectory);
  if (!executable) {
    throw new Error('PDFium-missing application executable was not found.');
  }

  const session = await installedAppHarness.launchApp({
    executable,
    label: 'missing-pdfium',
    evidenceDirectory: join(evidenceRoot, result.runId),
    timeoutMs,
  });
  try {
    await waitForNativeLibraryReady(session.page);
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
  const session = await installedAppHarness.launchApp({
    executable,
    label: 'intact-first',
    evidenceDirectory: join(evidenceRoot, result.runId),
    timeoutMs,
  });
  try {
    await waitForNativeLibraryReady(session.page);
    await importSource(session.page, cbzPath);
    await waitForReader(session.page);
    await session.page.getByTestId('reader-back').click();
    await waitForLibrary(session.page);
    await waitForCardCount(session.page, 1);

    await importSource(session.page, pdfPath);
    await waitForReader(session.page);
    await session.page.getByTestId('reader-back').click();
    await waitForLibrary(session.page);
    await waitForCardCount(session.page, 2);

    const cbzCard = session.page.locator('[data-testid="library-publication-card"][data-publication-format="cbz"]');
    await cbzCard.locator('.cover-button').click();
    await session.page.getByTestId('reader-stage').waitFor({ state: 'visible' });
    await session.page.getByTestId('reader-next').click();
    await waitFor(async () => (await session.page.getByTestId('reader-current-page').getAttribute('data-page-index')) === '1', 'CBZ page did not advance');
    await waitFor(async () => (await session.page.getByTestId('reader-announcement').textContent())?.includes('Page 2 of') === true, 'CBZ progress save was not acknowledged');
  } finally {
    await session.close();
  }

  const resumed = await installedAppHarness.launchApp({
    executable,
    label: 'intact-resumed',
    evidenceDirectory: join(evidenceRoot, result.runId),
    timeoutMs,
  });
  try {
    await waitForNativeLibraryReady(resumed.page);
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
  const runId = Date.now() + '-' + process.pid + '-' + randomUUID().replaceAll('-', '');
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
    result.installer = await buildInstaller(runDirectory, runId);
    const executable = await installedAppHarness.installPackage(result.installer, result.installDirectory);
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
