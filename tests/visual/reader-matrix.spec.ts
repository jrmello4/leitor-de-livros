import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  resetVisualEvidence,
  visualArtifactDirectory,
  visualScenarios,
  visualScreenshotPath,
  visualSummaryPath,
  visualViewports,
  visualProfileStore,
  writeVisualEvidence,
  expectedRtlMotion,
  type VisualEvidence,
  type VisualScenario,
} from './visual-matrix';

test.describe.configure({ mode: 'serial' });

async function seedProfile(page: Page, scenario: VisualScenario): Promise<void> {
  const store = visualProfileStore(scenario.profile);
  await page.addInitScript(({ value }) => {
    window.localStorage.setItem('tactile-reader/profiles/v2', JSON.stringify(value));
  }, { value: store });
}

async function openDemo(page: Page, scenario: VisualScenario): Promise<void> {
  const path = scenario.backend === 'auto' ? '/' : '/?renderBackend=' + scenario.backend;
  await page.goto(path);
  const demoCard = page.locator('[data-testid="library-publication-card"][data-publication-format="demo"]');
  await expect(demoCard).toHaveCount(1);
  await demoCard.locator('.cover-button').click();
  await expect(page.getByTestId('reader-stage')).toBeVisible();
  const currentPage = page.getByTestId('reader-current-page');
  await expect(currentPage).toBeVisible();
  await expect(currentPage).toHaveText(/\S+/);
  const pageIndex = await currentPage.getAttribute('data-page-index');
  expect(pageIndex, 'reader current-page must expose a finite committed page index').not.toBeNull();
  expect(pageIndex?.trim(), 'reader current-page must not expose an empty page index').not.toBe('');
  expect(Number.isFinite(Number(pageIndex)), 'reader current-page exposes an invalid page index').toBe(true);
  await expect(page.locator('.render-surface .page-sheet').first()).toHaveCount(1);
}

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };

type Edges = { x: number; y: number; right: number; bottom: number };

function overlap(left: Edges, right: Edges): boolean {
  const overlapWidth = Math.min(left.right, right.right) - Math.max(left.x, right.x);
  const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y);
  return overlapWidth > 2 && overlapHeight > 2;
}

async function assertReaderGeometry(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error('Playwright did not expose a viewport size.');
  }

  const stage = await page.getByTestId('reader-stage').boundingBox();
  expect(stage).not.toBeNull();
  if (!stage) {
    return;
  }
  expect(stage.width, 'reader stage must not be empty').toBeGreaterThan(100);
  expect(stage.height, 'reader stage must not be empty').toBeGreaterThan(100);
  expect(stage.x, 'reader stage is clipped on the left').toBeGreaterThanOrEqual(0);
  expect(stage.y, 'reader stage is clipped at the top').toBeGreaterThanOrEqual(0);
  expect(stage.x + stage.width, 'reader stage is clipped on the right').toBeLessThanOrEqual(viewport.width + 1);
  expect(stage.y + stage.height, 'reader stage is clipped at the bottom').toBeLessThanOrEqual(viewport.height + 1);

  const pageSheets = page.locator('.render-surface .page-sheet');
  expect(await pageSheets.count(), 'reader renderer contains no page sheets').toBeGreaterThan(0);
  const renderer = page.locator('.render-surface');
  const actualBackend = await renderer.getAttribute('data-renderer');
  if (actualBackend === 'static') {
    expect(await pageSheets.first().isVisible(), 'static renderer contains an empty page region').toBe(true);
  } else {
    const canvas = await renderer.locator('canvas').boundingBox();
    expect(canvas, 'GPU renderer contains no canvas').not.toBeNull();
    if (canvas) {
      expect(canvas.width, 'GPU renderer canvas is empty').toBeGreaterThan(100);
      expect(canvas.height, 'GPU renderer canvas is empty').toBeGreaterThan(100);
    }
  }

  const controls = await page.locator(
    '[data-testid="reader-back"], [data-testid="reader-fullscreen"], [data-testid="reader-previous"], [data-testid="reader-next"]',
  ).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      right: box.right,
      bottom: box.bottom,
    };
  }));
  expect(controls.length, 'reader primary controls are missing').toBe(4);
  for (const control of controls) {
    expect(control.x, 'primary control is clipped on the left').toBeGreaterThanOrEqual(0);
    expect(control.y, 'primary control is clipped at the top').toBeGreaterThanOrEqual(0);
    expect(control.right, 'primary control is clipped on the right').toBeLessThanOrEqual(viewport.width + 1);
    expect(control.bottom, 'primary control is clipped at the bottom').toBeLessThanOrEqual(viewport.height + 1);
  }
  for (let index = 0; index < controls.length; index += 1) {
    for (let next = index + 1; next < controls.length; next += 1) {
      expect(overlap(controls[index], controls[next]), 'primary reader controls overlap').toBe(false);
    }
  }

  const allReaderControls = await page.locator('[data-reader-control]:visible').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
  }));
  for (const control of allReaderControls) {
    expect(control.x, 'reader control is clipped on the left').toBeGreaterThanOrEqual(0);
    expect(control.y, 'reader control is clipped at the top').toBeGreaterThanOrEqual(0);
    expect(control.right, 'reader control is clipped on the right').toBeLessThanOrEqual(viewport.width + 1);
    expect(control.bottom, 'reader control is clipped at the bottom').toBeLessThanOrEqual(viewport.height + 1);
  }

  await assertStageNotesDoNotCollide(page);
}

// The stage's notes each used to be positioned absolutely against the same
// bottom edge, so the renderer status printed over the diagnostics and the
// corner hint printed over both. They share one row now; this keeps them there.
async function assertStageNotesDoNotCollide(page: Page): Promise<void> {
  const notes = await page.locator(
    '.stage-rail .stage-meta:visible, .stage-rail .stage-note:visible, .stage-rail .renderer-diagnostic-panel:visible, .corner-hint:visible, .reader-announcement:visible',
  ).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return {
      label: element.className.toString().split(/\s+/)[0] ?? 'note',
      x: box.x,
      y: box.y,
      right: box.right,
      bottom: box.bottom,
    };
  }));

  for (let index = 0; index < notes.length; index += 1) {
    for (let next = index + 1; next < notes.length; next += 1) {
      expect(
        overlap(notes[index], notes[next]),
        `stage notes overlap: ${notes[index].label} over ${notes[next].label}`,
      ).toBe(false);
    }
  }
}

async function advanceToLastPage(page: Page): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId('reader-next').click();
    await expect(page.getByTestId('reader-current-page')).toHaveAttribute('data-page-index', String(index + 1));
  }
}

interface TurnTraceEntry {
  phase: string | null;
  progress: number;
  direction: string | null;
}

const TURN_ATTRIBUTES = ['data-turn-phase', 'data-turn-progress', 'data-turn-direction'];

// A turn passes through `preparing`, `dragging`, `settling` and `committed` on
// its way back to `idle`. Sampling the live attribute races the animation: a
// machine that finishes the turn between two polls only ever shows `idle`, and
// `idle` is terminal, so the retry can never recover. Record every attribute
// change from inside the page instead and judge the whole trace once the turn
// has committed. The observer watches the document rather than the stage node
// so it survives a re-render that replaces the element.
async function recordTurnTrace(page: Page, attributes: string[]): Promise<void> {
  await page.evaluate((watched) => {
    const selector = '[data-testid="reader-stage"]';
    const trace: TurnTraceEntry[] = [];
    (window as unknown as { __turnTrace: TurnTraceEntry[] }).__turnTrace = trace;
    const record = (element: Element | null): void => {
      if (!element) {
        return;
      }
      trace.push({
        phase: element.getAttribute('data-turn-phase'),
        progress: Number(element.getAttribute('data-turn-progress')),
        direction: element.getAttribute('data-turn-direction'),
      });
    };
    record(document.querySelector(selector));
    new MutationObserver((records) => {
      for (const entry of records) {
        const target = entry.target as Element;
        if (typeof target.matches === 'function' && target.matches(selector)) {
          record(target);
        }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: watched });
  }, attributes);
}

async function readTurnTrace(page: Page): Promise<TurnTraceEntry[]> {
  return page.evaluate(() => (window as unknown as { __turnTrace?: TurnTraceEntry[] }).__turnTrace ?? []);
}

async function runScenarioSetup(page: Page, scenario: VisualScenario): Promise<string | undefined> {
  switch (scenario.name) {
    case 'single-rtl': {
      const stage = page.getByTestId('reader-stage');
      const currentPage = page.getByTestId('reader-current-page');
      await expect(currentPage).toHaveAttribute('data-page-index', '3');
      for (const pageIndex of ['2', '1', '0']) {
        await page.getByTestId('reader-next').click();
        await expect(currentPage).toHaveAttribute('data-page-index', pageIndex);
      }
      await recordTurnTrace(page, TURN_ATTRIBUTES);
      await page.getByTestId('reader-previous').click();
      // `data-page-index` is written on the `committed` phase, so waiting for
      // the landing page is what makes the recorded trace complete.
      await expect(currentPage).toHaveAttribute('data-page-index', '1');
      await expect(stage).toHaveAttribute('data-turn-direction', 'rtl');

      // The fold is an enhancement, not the contract: `requestTurn` navigates
      // directly whenever it cannot build a scene, so a machine in compatibility
      // mode reaches the same page without ever leaving `idle`. Requiring the
      // animation here is what made this scenario fail on CI while passing on a
      // machine with a working GPU. Judge the motion that was recorded, and let
      // the fold-specific scenarios own the fold.
      const trace = await readTurnTrace(page);
      const report = JSON.stringify(trace);
      expect(
        trace.every((entry) => entry.phase === 'idle' || entry.direction === 'rtl'),
        'RTL turn reported a non-rtl direction; recorded ' + report,
      ).toBe(true);
      const moved = trace.filter((entry) => Number.isFinite(entry.progress) && entry.progress !== 0);
      expect(
        moved.every((entry) => expectedRtlMotion(entry.direction, entry.progress)),
        'RTL turn must move backward with positive progress; recorded ' + report,
      ).toBe(true);
      return undefined;
    }
    case 'boundary':
      await page.getByTestId('reader-previous').dispatchEvent('click');
      await expect(page.getByTestId('reader-announcement')).toContainText('beginning of this publication');
      await advanceToLastPage(page);
      await page.getByTestId('reader-next').dispatchEvent('click');
      await expect(page.getByTestId('reader-announcement')).toContainText('end of this publication');
      return undefined;
    case 'cancelled-turn': {
      const stage = await page.getByTestId('reader-stage').boundingBox();
      if (!stage) {
        throw new Error('Reader stage has no bounds for cancelled-turn.');
      }
      await page.mouse.move(stage.x + stage.width - 8, stage.y + stage.height - 8);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width - 44, stage.y + stage.height - 44);
      await page.mouse.up();
      await page.waitForTimeout(480);
      await expect(page.getByTestId('reader-current-page')).toHaveAttribute('data-page-index', '0');
      return undefined;
    }
    case 'reduced-motion':
      await page.getByTestId('reader-next').click();
      await expect(page.getByTestId('reader-current-page')).toHaveAttribute('data-page-index', '1');
      return undefined;
    case 'fullscreen': {
      const supported = await page.evaluate(() => typeof document.documentElement.requestFullscreen === 'function');
      if (!supported) {
        return 'Fullscreen API is unavailable in this browser.';
      }
      await page.getByTestId('reader-fullscreen').click();
      await page.waitForTimeout(100);
      const active = await page.evaluate(() => Boolean(document.fullscreenElement));
      return active ? undefined : 'Headless browser rejected the fullscreen request.';
    }
    default:
      return undefined;
  }
}

const OPTIONAL_BACKENDS = ['webgl2', 'webgpu'];

// The reader's contract is WebGPU → WebGL2 → static, each step stating why it
// stepped down. Demanding the requested backend hangs the whole 45s timeout on
// any machine without that adapter — which is most CI runners — so wait for the
// ladder to settle and then insist the reader explained itself.
async function rendererState(page: Page, requestedBackend: string): Promise<{ actualBackend: string; skipReason?: string }> {
  const renderer = page.locator('.render-surface');
  await expect(renderer).toBeVisible();
  if (!OPTIONAL_BACKENDS.includes(requestedBackend)) {
    await page.waitForTimeout(120);
    return { actualBackend: await renderer.getAttribute('data-renderer') ?? 'unknown' };
  }

  await page.waitForFunction((requested) => {
    const element = document.querySelector('.render-surface');
    const actual = element?.getAttribute('data-renderer');
    if (!actual || actual === 'pending') {
      return false;
    }
    const diagnostic = document.querySelector('[data-testid="renderer-diagnostic"]')?.textContent ?? '';
    return actual === requested || diagnostic.trim().length > 0;
  }, requestedBackend);

  const actualBackend = await renderer.getAttribute('data-renderer') ?? 'unknown';
  if (actualBackend === requestedBackend) {
    return { actualBackend };
  }

  const diagnostic = (await page.getByTestId('renderer-diagnostic').textContent())?.trim() ?? '';
  expect(
    diagnostic.length > 0,
    `${requestedBackend} was replaced by ${actualBackend} without a diagnostic`,
  ).toBe(true);
  return { actualBackend, skipReason: diagnostic };
}

test.beforeAll(async () => {
  await resetVisualEvidence();
});

for (const scenario of visualScenarios) {
  for (const viewport of visualViewports) {
    test(scenario.name + ' ' + viewport.name, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedProfile(page, scenario);
      let status: VisualEvidence['status'] = 'passed';
      let skipReason: string | undefined;
      let actualBackend = 'unknown';
      let screenshot: string | undefined;

      try {
        await openDemo(page, scenario);
        const renderer = await rendererState(page, scenario.backend);
        actualBackend = renderer.actualBackend;
        skipReason = renderer.skipReason;
        if (skipReason) {
          status = 'skipped';
        }
        const scenarioSkipReason = await runScenarioSetup(page, scenario);
        if (scenarioSkipReason) {
          status = 'skipped';
          skipReason = scenarioSkipReason;
        }
        await assertReaderGeometry(page);
        screenshot = visualScreenshotPath(viewport.name, scenario.name);
        await mkdir(visualArtifactDirectory() + '/' + viewport.name, { recursive: true });
        await page.screenshot({ path: screenshot, fullPage: false });
        await testInfo.attach(scenario.name + '-' + viewport.name, {
          path: screenshot,
          contentType: 'image/png',
        });
      } catch (error) {
        status = 'failed';
        throw error;
      } finally {
        await writeVisualEvidence({
          scenario: scenario.name,
          viewport,
          profile: scenario.profile,
          requestedBackend: scenario.backend,
          actualBackend,
          status,
          skipReason,
          screenshot,
        });
      }
    });
  }
}

test('visual summary is written under the configured artifact directory', async () => {
  expect(visualSummaryPath()).toContain(visualArtifactDirectory());
});
