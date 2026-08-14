import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstalledAppHarness, InstalledAppLifecycleError } from '../windows/installed-app-harness.mjs';
import { measureImportToFirstFrame, waitForCommittedPage } from './performance-navigation.mjs';
import {
  evaluateScenarioMetrics,
  PERFORMANCE_REPORT_VERSION,
  PERFORMANCE_SCENARIOS,
  PERFORMANCE_THRESHOLDS,
  percentile,
  validatePerformanceReport,
  normalizeGpuClass,
  classifyGpu,
} from './performance-contract.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const reportRoot = resolve(process.env.PERFORMANCE_REPORT_DIR ?? join(repositoryRoot, 'artifacts/performance'));
const timeoutMs = Number(process.env.PERFORMANCE_TIMEOUT_MS ?? 600_000);
const gpuClass = normalizeGpuClass(process.env.PERFORMANCE_GPU_CLASS);
const installedAppHarness = createInstalledAppHarness();

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function preservePrimaryFailure(primaryError, cleanupError) {
  if (!primaryError) {
    return cleanupError instanceof InstalledAppLifecycleError
      ? cleanupError
      : new InstalledAppLifecycleError('cleanup', errorMessage(cleanupError), { cause: cleanupError });
  }
  const lifecycle = primaryError instanceof InstalledAppLifecycleError
    ? primaryError
    : new InstalledAppLifecycleError('execution', errorMessage(primaryError), { cause: primaryError });
  lifecycle.cleanupFailure ??= cleanupError instanceof InstalledAppLifecycleError
    ? cleanupError.cause ?? cleanupError
    : cleanupError;
  return lifecycle;
}

export function performanceFailureEvidence(error) {
  const lifecycle = error instanceof InstalledAppLifecycleError
    ? error
    : new InstalledAppLifecycleError('execution', errorMessage(error), { cause: error });
  return {
    stage: lifecycle.stage,
    failure: lifecycle.message,
    ...(lifecycle.cleanupFailure ? { cleanupFailure: errorMessage(lifecycle.cleanupFailure) } : {}),
    errors: [lifecycle.message],
  };
}

export async function settlePerformanceLifecycle({ cleanup, execute }) {
  let error;
  let value;
  try {
    value = await execute();
  } catch (executionError) {
    error = executionError;
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    error = preservePrimaryFailure(error, cleanupError);
  }
  if (error && !(error instanceof InstalledAppLifecycleError)) {
    error = new InstalledAppLifecycleError('execution', errorMessage(error), { cause: error });
  }
  return { error, value };
}

export function requirePassedPerformanceReport(report) {
  if (report.status === 'passed') {
    return report;
  }
  const failures = Object.entries(report.scenarios ?? {})
    .filter(([, scenario]) => scenario?.status === 'failed')
    .map(([name, scenario]) => name + ': ' + (scenario.failures?.join('; ') || 'scenario failed'));
  throw new InstalledAppLifecycleError(
    'execution',
    'Performance scenarios failed: ' + (failures.join(' | ') || 'report status is failed'),
  );
}

function commandOutput(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function readPackageVersion() {
  return commandOutput(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(resolve(repositoryRoot, 'package.json'))}).version)`]);
}

function readBuildCommit() {
  return process.env.GITHUB_SHA ?? commandOutput('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
}

async function readWebglRenderer(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const extension = context?.getExtension('WEBGL_debug_renderer_info');
    return extension && context
      ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL))
      : undefined;
  });
}

function readHardwareSnapshot(webglRenderer) {
  const script = `
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { [ordered]@{ name = $_.Name; driver = $_.DriverVersion; adapterRam = [int64]$_.AdapterRAM } })
[ordered]@{
  os = ($os.Caption + ' ' + $os.Version).Trim()
  cpu = [string]$processor.Name
  memoryBytes = [int64]$computer.TotalPhysicalMemory
  gpus = $gpus
} | ConvertTo-Json -Compress -Depth 4
`;
  try {
    const value = JSON.parse(commandOutput('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]));
    const gpus = Array.isArray(value.gpus) ? value.gpus : [value.gpus];
    const candidates = [
      { name: webglRenderer, adapterRam: 0 },
      ...gpus.map((entry) => ({ name: entry?.name, adapterRam: Number(entry?.adapterRam) || 0 })),
    ];
    const webglClass = classifyGpu(webglRenderer);
    const wmiClasses = gpus.map((entry) => classifyGpu(entry?.name, Number(entry?.adapterRam) || 0)).filter(Boolean);
    const uniqueWmiClasses = [...new Set(wmiClasses)];
    return {
      os: value.os || 'Windows (unknown version)',
      cpu: value.cpu || 'unknown CPU',
      memoryBytes: Number(value.memoryBytes) || 0,
      gpu: gpus.map((entry) => entry?.name).filter(Boolean).join('; ') || 'unknown GPU',
      gpuDriver: gpus.map((entry) => entry?.driver).filter(Boolean).join('; ') || 'unknown driver',
      gpuRenderer: webglRenderer || 'unknown renderer',
      gpuClassDetected: webglClass ?? (uniqueWmiClasses.length === 1 ? uniqueWmiClasses[0] : undefined),
    };
  } catch {
    return {
      os: process.env.OS || 'Windows (hardware query failed)',
      cpu: 'unknown CPU',
      memoryBytes: 1,
      gpu: 'unknown GPU',
      gpuDriver: 'unknown driver',
      gpuRenderer: webglRenderer || 'unknown renderer',
      gpuClassDetected: classifyGpu(webglRenderer),
    };
  }
}

function readProcessTreeMemoryBytes(rootPid) {
  const script = `
$root = ${Number(rootPid)}
$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$ids = New-Object System.Collections.Generic.HashSet[int]
[void]$ids.Add($root)
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($process in $processes) {
    if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $changed = $true }
  }
}
$total = [int64]0
foreach ($id in $ids) {
  try { $total += (Get-Process -Id $id -ErrorAction Stop).PrivateMemorySize64 } catch {}
}
$total
`;
  try {
    const value = Number(commandOutput('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function startMemorySampler(pid) {
  const samples = [];
  const sample = () => {
    const bytes = readProcessTreeMemoryBytes(pid);
    if (bytes !== undefined) {
      samples.push({ atMs: Date.now(), bytes });
    }
  };
  sample();
  const interval = setInterval(sample, 500);
  return {
    stop() {
      clearInterval(interval);
      sample();
      return samples;
    },
  };
}

function waitFor(predicate, description) {
  return installedAppHarness.waitFor(predicate, description, { timeoutMs });
}

async function createRunFixtures(runDirectory) {
  const fixtureDirectory = join(runDirectory, 'fixtures');
  const generator = resolve(repositoryRoot, 'scripts/performance/create-performance-fixtures.mjs');
  const output = commandOutput(process.execPath, [generator, fixtureDirectory], { cwd: repositoryRoot });
  const parsed = JSON.parse(output);
  return parsed.fixtures;
}

async function buildInstaller(runDirectory, runId) {
  const configPath = join(runDirectory, 'tauri.performance.json');
  const bundleDirectory = resolve(repositoryRoot, 'src-tauri/target/release/bundle/nsis');
  const identifier = 'com.jrmello4.tactilereader.performance.' + runId.replaceAll('-', '');
  const config = {
    identifier,
    productName: 'Tactile Reader Performance',
    version: readPackageVersion(),
    bundle: { targets: ['nsis'] },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  const npmCli = process.env.npm_execpath
    ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const started = Date.now();
  const output = execFileSync(process.execPath, [npmCli, 'run', 'tauri:build', '--', '--config', configPath], {
    cwd: repositoryRoot,
    env: { ...process.env, VITE_SMOKE_TEST: '1', VITE_VISUAL_TEST: '0' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  await writeFile(join(runDirectory, 'build.log'), output, 'utf8');
  const installer = await installedAppHarness.findNewestExecutable(bundleDirectory, { allowSetup: true, modifiedAfter: started });
  if (!installer) {
    throw new Error('Performance NSIS installer was not found under ' + bundleDirectory + '.');
  }
  return { installer, identifier };
}

async function waitForNativeReady(page) {
  await page.locator('[data-testid="native-library-ready"][data-ready="true"]').waitFor({ state: 'attached' });
}

async function waitForStatus(page, expected) {
  await waitFor(async () => (await page.getByTestId('smoke-status').textContent())?.includes(expected), 'Smoke status did not become ' + expected);
}

async function waitForReader(page) {
  await page.getByTestId('reader-stage').waitFor({ state: 'visible' });
  await page.getByTestId('reader-current-page').waitFor({ state: 'visible' });
  await waitFor(async () => (await page.locator('.render-surface .page-sheet').count()) > 0 || (await page.locator('.render-surface canvas').count()) > 0, 'Reader surface did not mount');
}

async function waitForTwoFrames(page) {
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
}

async function waitForLibrary(page) {
  await page.getByTestId('reader-back').click();
  await page.getByTestId('library-publication-card').first().waitFor({ state: 'visible' });
}

async function resetReaderToFirstPage(page) {
  const currentPage = Number(await page.getByTestId('reader-current-page').getAttribute('data-page-index'));
  for (let pageIndex = currentPage; pageIndex > 0; pageIndex -= 1) {
    await page.getByTestId('reader-previous').click();
    await waitForCommittedPage(page, pageIndex - 1, waitFor);
  }
}

async function importSource(page, sourcePath) {
  await page.getByTestId('smoke-source-path').fill(sourcePath);
  const started = performance.now();
  await page.getByTestId('smoke-import').click();
  await waitForStatus(page, 'Imported');
  return performance.now() - started;
}

async function waitForImportComplete(page, previousSequence) {
  return waitFor(async () => {
    const sequence = Number(await page.getByTestId('smoke-import-complete').getAttribute('data-sequence'));
    return sequence > previousSequence ? sequence : undefined;
  }, 'Native import did not complete');
}

async function openCard(page, sourceName) {
  const started = performance.now();
  const card = page.locator(`[data-testid="library-publication-card"][data-publication-source*="${sourceName}"]`).first();
  await card.locator('.cover-button').click();
  await waitForReader(page);
  await waitForTwoFrames(page);
  return { latencyMs: performance.now() - started, card: card.first() };
}

async function getCacheInfo(page) {
  return page.evaluate(async () => {
    const internals = globalThis.__TAURI_INTERNALS__;
    if (!internals?.invoke) {
      throw new Error('Tauri invoke bridge is unavailable.');
    }
    return internals.invoke('get_cache_info');
  });
}

async function startFrameSampler(page) {
  await page.evaluate(() => {
    const samples = [];
    let last;
    let active = true;
    const tick = (now) => {
      if (!active) {
        return;
      }
      if (last !== undefined) {
        const frameMs = now - last;
        if (frameMs > 0) {
          samples.push({ atMs: now, frameMs });
        }
      }
      last = now;
      requestAnimationFrame(tick);
    };
    globalThis.__performanceFrameSampler = {
      samples,
      stop: () => { active = false; },
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameSampler(page) {
  return page.evaluate(() => {
    const sampler = globalThis.__performanceFrameSampler;
    sampler?.stop();
    const samples = sampler?.samples ?? [];
    delete globalThis.__performanceFrameSampler;
    return samples;
  });
}

async function startQualityObserver(page) {
  await page.evaluate(() => {
    const events = [];
    const record = () => {
      const surface = document.querySelector('.render-surface');
      const quality = surface?.getAttribute('data-quality');
      if (quality) {
        const previous = events.at(-1);
        if (!previous || previous.quality !== quality) {
          events.push({ atMs: performance.now(), quality });
        }
      }
    };
    record();
    const observer = new MutationObserver(record);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-quality'] });
    globalThis.__performanceQualityObserver = { events, observer };
  });
}

async function stopQualityObserver(page) {
  return page.evaluate(() => {
    const observer = globalThis.__performanceQualityObserver;
    observer?.observer.disconnect();
    const events = observer?.events ?? [];
    delete globalThis.__performanceQualityObserver;
    return events;
  });
}

async function measureInteraction(page, action) {
  await startFrameSampler(page);
  await startQualityObserver(page);
  let frames = [];
  let qualityEvents = [];
  try {
    await action();
  } finally {
    [frames, qualityEvents] = await Promise.all([stopFrameSampler(page), stopQualityObserver(page)]);
  }
  return { frames, qualityEvents };
}

function summarizeFrames(frames) {
  return {
    frameCount: frames.length,
    frameTimeP95Ms: percentile(frames.map((sample) => sample.frameMs), 95),
    maxFrameTimeMs: frames.reduce((max, sample) => Math.max(max, sample.frameMs), 0),
  };
}

function qualityEvidence(qualityEvents, frames, frameSummary, threshold = PERFORMANCE_THRESHOLDS.navigationFrameTimeP95Ms) {
  const transitions = qualityEvents.filter((event, index) => index > 0 && event.quality !== qualityEvents[index - 1].quality);
  const stallAt = frames.find((sample) => sample.frameMs > threshold)?.atMs;
  const degradedBeforeStall = qualityEvents.length > 0 && (transitions.some((event) => event.quality !== 'rich' && (stallAt === undefined || event.atMs <= stallAt))
    || stallAt === undefined);
  return {
    transitions,
    qualitySampleCount: qualityEvents.length,
    frameSampleCount: frames.length,
    qualityDegradedBeforeInteractionStall: degradedBeforeStall,
    rationale: qualityEvents.length === 0
      ? 'Quality sampler produced no valid samples.'
      : transitions.length === 0 && stallAt === undefined
      ? 'No quality reduction was required because interaction frame times stayed below the stall threshold.'
      : 'Quality transition was observed before the first unacceptable frame-time sample.',
  };
}

function memorySummary(samples) {
  const values = samples.map((sample) => sample.bytes);
  const baselineMemoryBytes = values[0] ?? 0;
  const steadyValues = values.slice(-5);
  const steadyMemoryBytes = steadyValues.length > 0 ? Math.round(steadyValues.reduce((sum, value) => sum + value, 0) / steadyValues.length) : 0;
  return {
    baselineMemoryBytes,
    peakMemoryBytes: values.length > 0 ? Math.max(...values) : 0,
    steadyMemoryBytes,
    memoryGrowthBytes: Math.max(0, steadyMemoryBytes - baselineMemoryBytes),
    peakMemoryGrowthBytes: Math.max(0, (values.length > 0 ? Math.max(...values) : 0) - baselineMemoryBytes),
    sampleCount: values.length,
  };
}

function cacheGrowth(before, after) {
  return Math.max(0, Number(after?.usedBytes ?? 0) - Number(before?.usedBytes ?? 0));
}

async function runPerformanceScenarios(session, fixtures) {
  const { page, child } = session;
  await waitForNativeReady(page);
  const scenarioResults = {};
  let qualitySummary;
  let memorySampler;
  let memorySamples = [];

  try {
    const importSequence = Number(await page.getByTestId('smoke-import-complete').getAttribute('data-sequence'));
    const { importMs, firstFrameMs } = await measureImportToFirstFrame({
      prepareImport: () => page.getByTestId('smoke-source-path').fill(fixtures.navigation),
      triggerImport: () => page.getByTestId('smoke-import').click(),
      waitForImportComplete: () => waitForImportComplete(page, importSequence),
      waitForReader: () => waitForReader(page),
      waitForTwoFrames: () => waitForTwoFrames(page),
    }, () => performance.now());
    await waitForStatus(page, 'Imported');
    scenarioResults.import = { status: 'passed', source: 'performance-50.cbz', pageCount: 50, importMs };
    scenarioResults['first-frame'] = { status: firstFrameMs <= PERFORMANCE_THRESHOLDS.firstFrameMs ? 'passed' : 'failed', firstFrameMs };

    const navigationBefore = await getCacheInfo(page);
    const navigationMeasurement = await measureInteraction(page, async () => {
      for (let pageIndex = 1; pageIndex < 50; pageIndex += 1) {
        await page.getByTestId('reader-next').click();
        await waitForCommittedPage(page, pageIndex, waitFor);
      }
    });
    const navigationFrame = summarizeFrames(navigationMeasurement.frames);
    const navigationAfter = await getCacheInfo(page);
    const navigationQuality = qualityEvidence(navigationMeasurement.qualityEvents, navigationMeasurement.frames, navigationFrame);
    const navigationEvaluation = evaluateScenarioMetrics({
      firstFrameMs,
      frameTimeP95Ms: navigationFrame.frameTimeP95Ms,
      peakMemoryBytes: 0,
      steadyMemoryBytes: 0,
      cacheGrowthBytes: cacheGrowth(navigationBefore, navigationAfter),
      qualityDegradedBeforeStall: navigationQuality.qualityDegradedBeforeInteractionStall,
    });
    scenarioResults['navigation-50-pages'] = {
      ...navigationFrame,
      ...navigationQuality,
      pages: 50,
      cacheBefore: navigationBefore,
      cacheAfter: navigationAfter,
      cacheGrowthBytes: cacheGrowth(navigationBefore, navigationAfter),
      status: navigationEvaluation.status,
      failures: navigationEvaluation.failures,
    };

    await waitForLibrary(page);
    await importSource(page, fixtures.firstSwitch);
    await waitForLibrary(page);
    await importSource(page, fixtures.secondSwitch);
    await waitForLibrary(page);
    let switchLatencies = [];
    const switchMeasurement = await measureInteraction(page, async () => {
      const latencies = [];
      for (let index = 0; index < 12; index += 1) {
        const sourceName = index % 2 === 0 ? 'performance-a.cbz' : 'performance-b.cbz';
        const opened = await openCard(page, sourceName);
        latencies.push(opened.latencyMs);
        await waitForLibrary(page);
      }
      switchLatencies = latencies;
    });
    const switchFrame = summarizeFrames(switchMeasurement.frames);
    const switchQuality = qualityEvidence(switchMeasurement.qualityEvents, switchMeasurement.frames, switchFrame, PERFORMANCE_THRESHOLDS.rapidSwitchFrameTimeP95Ms);
    const switchEvaluation = evaluateScenarioMetrics({
      firstFrameMs: Math.max(...switchLatencies, 0),
      frameTimeP95Ms: switchFrame.frameTimeP95Ms,
      peakMemoryBytes: 0,
      steadyMemoryBytes: 0,
      cacheGrowthBytes: 0,
      qualityDegradedBeforeStall: switchQuality.qualityDegradedBeforeInteractionStall,
    }, { ...PERFORMANCE_THRESHOLDS, navigationFrameTimeP95Ms: PERFORMANCE_THRESHOLDS.rapidSwitchFrameTimeP95Ms });
    scenarioResults['rapid-publication-switching'] = {
      ...switchFrame,
      ...switchQuality,
      switches: switchLatencies.length,
      switchLatencyP95Ms: percentile(switchLatencies, 95) ?? 0,
      status: switchEvaluation.status,
      failures: switchEvaluation.failures,
    };

    const navigationCard = page.locator('[data-testid="library-publication-card"][data-publication-source*="performance-50.cbz"]').first();
    await navigationCard.locator('.cover-button').click();
    await waitForReader(page);
    await waitForTwoFrames(page);
    await resetReaderToFirstPage(page);
    memorySampler = startMemorySampler(child.pid);
    const longBefore = await getCacheInfo(page);
    const longMeasurement = await measureInteraction(page, async () => {
      const cycles = Number(process.env.PERFORMANCE_LONG_SESSION_CYCLES ?? 2);
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        for (let pageIndex = 1; pageIndex < 50; pageIndex += 1) {
          await page.getByTestId('reader-next').click();
          await waitForCommittedPage(page, pageIndex, waitFor);
        }
        for (let pageIndex = 48; pageIndex >= 0; pageIndex -= 1) {
          await page.getByTestId('reader-previous').click();
          await waitForCommittedPage(page, pageIndex, waitFor);
        }
      }
    });
    await delay(2_000);
    const longAfter = await getCacheInfo(page);
    const longFrame = summarizeFrames(longMeasurement.frames);
    const longQuality = qualityEvidence(longMeasurement.qualityEvents, longMeasurement.frames, longFrame);
    memorySamples = memorySampler.stop();
    memorySampler = undefined;
    const longMemory = memorySummary(memorySamples);
    const longEvaluation = evaluateScenarioMetrics({
      firstFrameMs,
      frameTimeP95Ms: longFrame.frameTimeP95Ms,
      peakMemoryBytes: longMemory.peakMemoryBytes,
      steadyMemoryBytes: longMemory.steadyMemoryBytes,
      memoryGrowthBytes: longMemory.memoryGrowthBytes,
      cacheGrowthBytes: cacheGrowth(longBefore, longAfter),
      qualityDegradedBeforeStall: longQuality.qualityDegradedBeforeInteractionStall,
      frameSampleCount: longFrame.frameCount,
      qualitySampleCount: longQuality.qualitySampleCount,
      memorySampleCount: longMemory.sampleCount,
      requireFrameSamples: true,
      requireQualitySamples: true,
      requireMemorySamples: true,
    });
    qualitySummary = longQuality;
    scenarioResults['long-reading-session'] = {
      ...longFrame,
      ...longQuality,
      ...longMemory,
      cycles: Number(process.env.PERFORMANCE_LONG_SESSION_CYCLES ?? 2),
      cacheBefore: longBefore,
      cacheAfter: longAfter,
      cacheGrowthBytes: cacheGrowth(longBefore, longAfter),
      status: longEvaluation.status,
      failures: longEvaluation.failures,
    };
  } finally {
    memorySamples = memorySampler?.stop() ?? memorySamples;
  }
  return { scenarioResults, memory: memorySummary(memorySamples), qualitySummary };
}

function buildReport({ runId, hardware, build, scenarios, memory, qualitySummary }) {
  const statuses = PERFORMANCE_SCENARIOS.map((scenario) => scenarios[scenario]?.status);
  const longSession = scenarios['long-reading-session'];
  const summary = {
    status: statuses.every((status) => status === 'passed') ? 'passed' : 'failed',
    firstFrameLatencyMs: scenarios['first-frame']?.firstFrameMs ?? 0,
    frameTimeP95Ms: longSession?.frameTimeP95Ms ?? 0,
    peakMemoryBytes: longSession?.peakMemoryBytes ?? memory.peakMemoryBytes,
    steadyMemoryBytes: longSession?.steadyMemoryBytes ?? memory.steadyMemoryBytes,
    derivedCacheGrowthBytes: longSession?.cacheGrowthBytes ?? 0,
    qualityDegradedBeforeInteractionStall: Boolean(qualitySummary?.qualityDegradedBeforeInteractionStall),
    longSessionMemoryBounded: (longSession?.memorySampleCount ?? 0) > 1
      && (longSession?.memoryGrowthBytes ?? Number.POSITIVE_INFINITY) <= PERFORMANCE_THRESHOLDS.longSessionMemoryGrowthBytes,
    longSessionCacheBounded: (longSession?.cacheGrowthBytes ?? Number.POSITIVE_INFINITY) <= PERFORMANCE_THRESHOLDS.longSessionCacheGrowthBytes,
  };
  return {
    schemaVersion: PERFORMANCE_REPORT_VERSION,
    status: summary.status,
    runId,
    generatedAt: new Date().toISOString(),
    hardware: { ...hardware, gpuClass, runnerLabel: process.env.PERFORMANCE_RUNNER_LABEL ?? process.env.RUNNER_NAME ?? 'local' },
    build,
    thresholds: PERFORMANCE_THRESHOLDS,
    scenarios,
    summary,
    errors: [],
  };
}

async function main() {
  if (!gpuClass) {
    throw new Error('PERFORMANCE_GPU_CLASS must be integrated or dedicated.');
  }
  const runId = Date.now() + '-' + process.pid + '-' + randomUUID().replaceAll('-', '');
  const runDirectory = await mkdtemp(join(tmpdir(), 'tactile-reader-performance-'));
  installedAppHarness.registerRunRoot(runDirectory);
  const evidenceDirectory = join(reportRoot, runId);
  let session;
  let report;
  const installDirectory = join(runDirectory, 'installed');
  const outcome = await settlePerformanceLifecycle({
    execute: async () => {
      await mkdir(evidenceDirectory, { recursive: true });
      const fixtures = await createRunFixtures(runDirectory);
      const built = await buildInstaller(runDirectory, runId);
      const executable = await installedAppHarness.installPackage(built.installer, installDirectory);
      session = await installedAppHarness.launchApp({
        executable,
        label: 'performance',
        evidenceDirectory,
        pageDescription: 'performance harness',
        runRoot: runDirectory,
        timeoutMs,
      });
      const hardware = readHardwareSnapshot(await readWebglRenderer(session.page));
      if (!hardware.gpuClassDetected) {
        throw new Error('Could not classify the active GPU as integrated or dedicated.');
      }
      if (hardware.gpuClassDetected !== gpuClass) {
        throw new Error(`Requested GPU class ${gpuClass} does not match detected class ${hardware.gpuClassDetected}.`);
      }
      const result = await runPerformanceScenarios(session, fixtures);
      report = buildReport({
        runId,
        hardware,
        build: { commit: readBuildCommit(), version: readPackageVersion(), tauriIdentifier: built.identifier },
        ...result,
      });
      const validationErrors = validatePerformanceReport(report);
      report.errors.push(...validationErrors);
      if (validationErrors.length > 0) {
        report.status = 'failed';
        report.summary.status = 'failed';
        throw new InstalledAppLifecycleError('execution', 'Performance report validation failed: ' + validationErrors.join('; '));
      }
      return requirePassedPerformanceReport(report);
    },
    cleanup: () => installedAppHarness.cleanupRun({ installDirectory, runRoot: runDirectory, session }),
  });
  report = outcome.value ?? report;
  if (outcome.error) {
    report ??= {
      schemaVersion: PERFORMANCE_REPORT_VERSION,
      status: 'failed',
      runId,
      generatedAt: new Date().toISOString(),
      hardware: { gpuClass, gpuClassDetected: undefined, os: 'unknown', gpu: 'unknown', memoryBytes: 0 },
      build: { commit: process.env.GITHUB_SHA ?? 'unknown', version: 'unknown' },
      thresholds: PERFORMANCE_THRESHOLDS,
      scenarios: Object.fromEntries(PERFORMANCE_SCENARIOS.map((scenario) => [scenario, { status: 'not-run' }])),
      summary: { status: 'failed' },
      errors: [],
    };
    Object.assign(report, performanceFailureEvidence(outcome.error));
    report.status = 'failed';
    report.summary.status = 'failed';
  }
  try {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(join(evidenceDirectory, 'performance-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ evidenceDirectory, report }));
    if (report?.status !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
