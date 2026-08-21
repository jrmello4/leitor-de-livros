import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm as remove, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const INSTALLED_APP_LIFECYCLE_STAGES = Object.freeze([
  'discovery',
  'installation',
  'launch',
  'connection',
  'execution',
  'cleanup',
]);

const defaultDependencies = {
  chromium,
  createServer,
  createWriteStream,
  delay: (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  execFileSync,
  fetch,
  mkdir,
  now: () => Date.now(),
  once,
  readdir,
  remove,
  spawn,
  stat,
};

export class InstalledAppLifecycleError extends Error {
  constructor(stage, message, options = {}) {
    if (!INSTALLED_APP_LIFECYCLE_STAGES.includes(stage)) {
      throw new TypeError('Unknown installed-app lifecycle stage: ' + stage);
    }
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.stage = stage;
    this.cleanupFailure = options.cleanupFailure;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function lifecycleError(stage, message, cause) {
  if (cause instanceof InstalledAppLifecycleError && cause.stage === stage) {
    return cause;
  }
  return new InstalledAppLifecycleError(stage, message + (cause ? ': ' + errorMessage(cause) : ''), { cause });
}

function isContainedBy(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!isAbsolute(pathFromRoot)
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith('..' + '\\')
    && !pathFromRoot.startsWith('..' + '/'));
}

function isUnsafeRunRoot(runRoot) {
  const userDirectory = resolve(homedir());
  return isContainedBy(runRoot, repositoryRoot)
    || isContainedBy(repositoryRoot, runRoot)
    || isContainedBy(runRoot, userDirectory);
}

function registerRunRoot(runRoot, ownedRunRoots) {
  const resolvedRunRoot = resolve(runRoot);
  if (isUnsafeRunRoot(resolvedRunRoot)) {
    throw new InstalledAppLifecycleError('cleanup', 'Refusing unsafe run root: ' + resolvedRunRoot);
  }
  ownedRunRoots.add(resolvedRunRoot);
  return resolvedRunRoot;
}

async function recursiveFiles(directory, dependencies) {
  const entries = await dependencies.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await recursiveFiles(entryPath, dependencies));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

function isApplicationExecutable(filePath) {
  const name = filePath.toLowerCase();
  return extname(name) === '.exe' && !name.includes('uninstall') && !name.includes('setup');
}

async function findNewestExecutable(root, options, dependencies) {
  const { allowSetup = false, modifiedAfter = 0 } = options ?? {};
  try {
    const files = (await recursiveFiles(root, dependencies))
      .filter((filePath) => allowSetup ? extname(filePath).toLowerCase() === '.exe' : isApplicationExecutable(filePath));
    const candidates = await Promise.all(files.map(async (filePath) => ({
      filePath,
      modified: (await dependencies.stat(filePath)).mtimeMs,
    })));
    candidates.sort((left, right) => right.modified - left.modified);
    return candidates.find((candidate) => candidate.modified >= modifiedAfter - 2_000)?.filePath;
  } catch (error) {
    throw lifecycleError('discovery', 'Could not discover an application executable under ' + root, error);
  }
}

async function allocatePort(dependencies) {
  try {
    const server = dependencies.createServer();
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolvePromise);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : undefined;
    await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    if (!port) {
      throw new Error('Could not allocate a localhost CDP port.');
    }
    return port;
  } catch (error) {
    throw lifecycleError('launch', 'Could not allocate a localhost CDP port', error);
  }
}

async function waitFor(predicate, description, options, dependencies) {
  const { intervalMs = 250, timeoutMs = 180_000, stage = 'execution' } = options ?? {};
  const started = dependencies.now();
  let lastError;
  // Always attempt the predicate at least once: a caller-supplied deadline must
  // never skip the work it is timing, even when the budget expires immediately.
  do {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    if (dependencies.now() - started >= timeoutMs) {
      break;
    }
    await dependencies.delay(intervalMs);
  } while (true);
  throw lifecycleError(stage, description + (lastError ? ': ' + errorMessage(lastError) : '.'), lastError);
}

async function installPackage(installer, root, dependencies) {
  try {
    await dependencies.mkdir(root, { recursive: true });
    dependencies.execFileSync(installer, ['/S', '/D=' + root], { cwd: dirname(installer), stdio: 'ignore' });
    const executable = await findNewestExecutable(root, undefined, dependencies);
    if (!executable) {
      throw new Error('Installed application executable was not found under ' + root + '.');
    }
    return executable;
  } catch (error) {
    throw lifecycleError('installation', 'Could not install package ' + installer, error);
  }
}

function resolveOwnedTarget(runRoot, target, ownedRunRoots, { allowRoot = false } = {}) {
  const resolvedRunRoot = resolve(runRoot);
  const resolvedTarget = resolve(target);
  if (isUnsafeRunRoot(resolvedRunRoot)) {
    throw new InstalledAppLifecycleError('cleanup', 'Refusing unsafe run root: ' + resolvedRunRoot);
  }
  if (!ownedRunRoots.has(resolvedRunRoot)) {
    throw new InstalledAppLifecycleError('cleanup', 'Refusing cleanup from an unregistered run root: ' + resolvedRunRoot);
  }
  if (!isContainedBy(resolvedRunRoot, resolvedTarget) || (!allowRoot && resolvedRunRoot === resolvedTarget)) {
    throw new InstalledAppLifecycleError('cleanup', 'Refusing to use a path outside the owned run root: ' + resolvedTarget);
  }
  return { resolvedRunRoot, resolvedTarget };
}

async function uninstallPackage(runRoot, installDirectory, dependencies, ownedRunRoots) {
  const { resolvedTarget } = resolveOwnedTarget(runRoot, installDirectory, ownedRunRoots);
  let files;
  try {
    files = await recursiveFiles(resolvedTarget, dependencies);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw lifecycleError('cleanup', 'Could not inspect the owned NSIS installation', error);
  }
  const uninstaller = files.find((filePath) => /^uninstall.*\.exe$/i.test(basename(filePath)));
  if (!uninstaller) {
    return false;
  }
  try {
    dependencies.execFileSync(uninstaller, ['/S'], {
      cwd: dirname(uninstaller),
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch (error) {
    throw lifecycleError('cleanup', 'Could not silently uninstall the owned NSIS installation', error);
  }
}

async function endStream(stream) {
  if (!stream || stream.writableEnded || stream.destroyed) {
    return;
  }
  await new Promise((resolvePromise) => stream.end(resolvePromise));
}

async function terminateOwnedProcessTree(child, dependencies) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill();
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      throw error;
    }
    return;
  }
  await Promise.race([
    dependencies.once(child, 'exit'),
    dependencies.delay(1_500),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      dependencies.execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        throw error;
      }
      // The owned process exited between the check and taskkill.
    }
  }
}

async function closeSession({ browser, child, stdout, stderr }, dependencies) {
  const failures = [];
  await browser?.close().catch((error) => failures.push(error));
  await terminateOwnedProcessTree(child, dependencies).catch((error) => failures.push(error));
  await endStream(stdout).catch((error) => failures.push(error));
  await endStream(stderr).catch((error) => failures.push(error));
  if (failures.length > 0) {
    throw lifecycleError('cleanup', 'Could not fully close the installed application session', failures[0]);
  }
}

async function waitForCdpConnection(port, label, timeoutMs, dependencies) {
  try {
    await waitFor(async () => {
      try {
        return (await dependencies.fetch('http://127.0.0.1:' + port + '/json/version')).ok;
      } catch {
        return false;
      }
    }, label + ' CDP endpoint did not answer', { timeoutMs }, dependencies);
  } catch (error) {
    throw lifecycleError('connection', 'CDP endpoint timed out', error);
  }
}

async function launchApp(options, dependencies) {
  const {
    executable,
    label,
    evidenceDirectory,
    pageDescription = 'smoke harness',
    pageTestId = 'smoke-harness',
    runRoot,
    timeoutMs,
  } = options;
  let child;
  let stdout;
  let stderr;
  let browser;
  try {
    if (!runRoot) {
      throw new InstalledAppLifecycleError('launch', 'A registered run root is required to contain application data.');
    }
    const appDataRoot = resolve(runRoot, 'app-data');
    await dependencies.mkdir(resolve(appDataRoot, 'roaming'), { recursive: true });
    await dependencies.mkdir(resolve(appDataRoot, 'local'), { recursive: true });
    const port = await allocatePort(dependencies);
    stdout = dependencies.createWriteStream(join(evidenceDirectory, label + '.stdout.log'));
    stderr = dependencies.createWriteStream(join(evidenceDirectory, label + '.stderr.log'));
    child = dependencies.spawn(executable, [], {
      cwd: dirname(executable),
      env: {
        ...process.env,
        APPDATA: resolve(appDataRoot, 'roaming'),
        LOCALAPPDATA: resolve(appDataRoot, 'local'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);
    await waitForCdpConnection(port, label, timeoutMs, dependencies);
    browser = await dependencies.chromium.connectOverCDP('http://127.0.0.1:' + port);
    const page = await waitFor(async () => {
      const pages = browser.contexts().flatMap((context) => context.pages());
      for (const candidate of pages) {
        try {
          await candidate.getByTestId(pageTestId).waitFor({ state: 'visible', timeout: 500 });
          return candidate;
        } catch {
          // WebView2 can expose a page before React mounts.
        }
      }
      return undefined;
    }, label + ' did not expose the ' + pageDescription, { timeoutMs }, dependencies);
    let closePromise;
    return {
      browser,
      child,
      page,
      close() {
        if (!closePromise) {
          closePromise = closeSession({ browser, child, stdout, stderr }, dependencies)
            .catch((error) => {
              closePromise = undefined;
              throw error;
            });
        }
        return closePromise;
      },
    };
  } catch (error) {
    let cleanupFailure;
    if (child || browser || stdout || stderr) {
      try {
        await closeSession({ browser, child, stdout, stderr }, dependencies);
      } catch (cleanupError) {
        cleanupFailure = cleanupError;
      }
    }
    const lifecycle = error instanceof InstalledAppLifecycleError
      ? error
      : lifecycleError('launch', 'Could not launch installed application ' + executable, error);
    lifecycle.cleanupFailure = cleanupFailure?.cause ?? cleanupFailure;
    throw lifecycle;
  }
}

async function removeOwnedPath(runRoot, target, dependencies, ownedRunRoots) {
  let resolvedTarget;
  try {
    ({ resolvedTarget } = resolveOwnedTarget(runRoot, target, ownedRunRoots));
  } catch (error) {
    if (error instanceof InstalledAppLifecycleError && /outside/.test(error.message)) {
      throw new InstalledAppLifecycleError('cleanup', 'Refusing to remove a path outside the owned run root: ' + resolve(target));
    }
    throw error;
  }
  try {
    await dependencies.remove(resolvedTarget, { recursive: true, force: true });
  } catch (error) {
    throw lifecycleError('cleanup', 'Could not remove owned path ' + resolvedTarget, error);
  }
}

async function removeOwnedRunRoot(runRoot, dependencies, ownedRunRoots) {
  const { resolvedRunRoot } = resolveOwnedTarget(runRoot, runRoot, ownedRunRoots, { allowRoot: true });
  try {
    await dependencies.remove(resolvedRunRoot, { recursive: true, force: true });
  } catch (error) {
    throw lifecycleError('cleanup', 'Could not remove owned run root ' + resolvedRunRoot, error);
  }
}

async function cleanupRun({ installDirectory, runRoot, session }, dependencies, ownedRunRoots) {
  const failures = [];
  await session?.close().catch((error) => failures.push(error));
  if (installDirectory) {
    await uninstallPackage(runRoot, installDirectory, dependencies, ownedRunRoots)
      .catch((error) => failures.push(error));
  }
  await removeOwnedRunRoot(runRoot, dependencies, ownedRunRoots)
    .catch((error) => failures.push(error));
  if (failures.length > 0) {
    throw lifecycleError('cleanup', 'Could not fully clean the installed application run', failures[0]);
  }
}

function validateLaunchRunRoot(runRoot, ownedRunRoots) {
  return resolveOwnedTarget(runRoot, resolve(runRoot, 'app-data'), ownedRunRoots).resolvedRunRoot;
}

export function createInstalledAppHarness(overrides = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const ownedRunRoots = new Set();
  return {
    allocatePort: () => allocatePort(dependencies),
    findNewestExecutable: (root, options) => findNewestExecutable(root, options, dependencies),
    waitFor: (predicate, description, options) => waitFor(predicate, description, options, dependencies),
    installPackage: (installer, root) => installPackage(installer, root, dependencies),
    launchApp: (options) => {
      if (options?.runRoot) {
        validateLaunchRunRoot(options.runRoot, ownedRunRoots);
      }
      return launchApp(options, dependencies);
    },
    registerRunRoot: (runRoot) => registerRunRoot(runRoot, ownedRunRoots),
    removeOwnedPath: (runRoot, target) => removeOwnedPath(runRoot, target, dependencies, ownedRunRoots),
    removeOwnedRunRoot: (runRoot) => removeOwnedRunRoot(runRoot, dependencies, ownedRunRoots),
    uninstallPackage: (runRoot, installDirectory) => uninstallPackage(runRoot, installDirectory, dependencies, ownedRunRoots),
    cleanupRun: (options) => cleanupRun(options, dependencies, ownedRunRoots),
  };
}
