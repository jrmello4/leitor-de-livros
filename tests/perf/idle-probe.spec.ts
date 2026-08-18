import { expect, test, type Page } from '@playwright/test';

/**
 * Idle-efficiency guard.
 *
 * The reader spends most of its life showing a still page. Any animation-frame
 * loop that keeps re-arming while nothing moves burns a wakeup per vsync
 * forever, which matters on battery and on integrated GPUs. Frame telemetry is
 * therefore sampled only while a page turn is in flight.
 *
 * Measured on this workstation before the loop was gated: 60.2 callbacks/s.
 * After gating: 0.0 callbacks/s. The companion unit guard in
 * `src/rendering/ReaderSurface.test.tsx` covers the other half: telemetry must
 * still be sampled while a turn is in flight.
 */
const IDLE_SAMPLE_MS = 5000;
const MAX_IDLE_CALLBACKS_PER_SECOND = 5;

async function countAnimationFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counters = { raf: 0 };
    (window as unknown as { __perf: typeof counters }).__perf = counters;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback: FrameRequestCallback) => original((timestamp) => {
      counters.raf += 1;
      return callback(timestamp);
    });
  });
}

function readCounter(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __perf: { raf: number } }).__perf.raf);
}

test('an idle reader does not schedule animation frames', async ({ page }) => {
  await countAnimationFrames(page);
  await page.goto('/');
  const demoCard = page.locator('[data-testid="library-publication-card"][data-publication-format="demo"]');
  await demoCard.locator('.cover-button').click();
  await expect(page.getByTestId('reader-stage')).toBeVisible();
  await page.waitForTimeout(1500);

  const before = await readCounter(page);
  await page.waitForTimeout(IDLE_SAMPLE_MS);
  const after = await readCounter(page);

  const perSecond = (after - before) / (IDLE_SAMPLE_MS / 1000);
  console.log(`IDLE-PROBE raf_callbacks=${after - before} over_ms=${IDLE_SAMPLE_MS} per_second=${perSecond.toFixed(1)}`);
  expect(perSecond).toBeLessThanOrEqual(MAX_IDLE_CALLBACKS_PER_SECOND);
});
