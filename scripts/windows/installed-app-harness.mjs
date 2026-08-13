import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm as remove, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';

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
  const { intervalMs = 250, timeoutMs = 180_000 } = options ?? {};
  const started = dependencies.now();
  let lastError;
  while (dependencies.now() - started < timeoutMs) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await dependencies.delay(intervalMs);
  }
  throw lifecycleError('wait', description + (lastError ? ': ' + errorMessage(lastError) : '.'), lastError);
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
    throw lifecycleError('install', 'Could not install package ' + installer, error);
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
  child.kill();
  await Promise.race([
    dependencies.once(child, 'exit'),
    dependencies.delay(1_500),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      dependencies.execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // The owned process may have exited between the check and taskkill.
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

async function launchApp(options, dependencies) {
  const {
    executable,
    label,
    evidenceDirectory,
    pageDescription = 'smoke harness',
    pageTestId = 'smoke-harness',
    timeoutMs,
  } = options;
  let child;
  let stdout;
  let stderr;
  let browser;
  try {
    const port = await allocatePort(dependencies);
    stdout = dependencies.createWriteStream(join(evidenceDirectory, label + '.stdout.log'));
    stderr = dependencies.createWriteStream(join(evidenceDirectory, label + '.stderr.log'));
    child = dependencies.spawn(executable, [], {
      cwd: dirname(executable),
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);
    await waitFor(async () => {
      try {
        return (await dependencies.fetch('http://127.0.0.1:' + port + '/json/version')).ok;
      } catch {
        return false;
      }
    }, label + ' CDP endpoint did not answer', { timeoutMs }, dependencies);
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
    let closed = false;
    return {
      browser,
      child,
      page,
      async close() {
        if (closed) {
          return;
        }
        closed = true;
        await closeSession({ browser, child, stdout, stderr }, dependencies);
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
    const lifecycle = lifecycleError('launch', 'Could not launch installed application ' + executable, error);
    lifecycle.cleanupFailure = cleanupFailure;
    throw lifecycle;
  }
}

async function removeOwnedPath(runRoot, target, dependencies) {
  const resolvedRunRoot = resolve(runRoot);
  const resolvedTarget = resolve(target);
  const pathFromRunRoot = relative(resolvedRunRoot, resolvedTarget);
  const outsideRunRoot = pathFromRunRoot === '..'
    || pathFromRunRoot.startsWith('..' + '\\')
    || pathFromRunRoot.startsWith('..' + '/')
    || pathFromRunRoot === '';
  if (outsideRunRoot) {
    throw new InstalledAppLifecycleError('cleanup', 'Refusing to remove a path outside the owned run root: ' + resolvedTarget);
  }
  try {
    await dependencies.remove(resolvedTarget, { recursive: true, force: true });
  } catch (error) {
    throw lifecycleError('cleanup', 'Could not remove owned path ' + resolvedTarget, error);
  }
}

export function createInstalledAppHarness(overrides = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    allocatePort: () => allocatePort(dependencies),
    findNewestExecutable: (root, options) => findNewestExecutable(root, options, dependencies),
    waitFor: (predicate, description, options) => waitFor(predicate, description, options, dependencies),
    installPackage: (installer, root) => installPackage(installer, root, dependencies),
    launchApp: (options) => launchApp(options, dependencies),
    removeOwnedPath: (runRoot, target) => removeOwnedPath(runRoot, target, dependencies),
  };
}
