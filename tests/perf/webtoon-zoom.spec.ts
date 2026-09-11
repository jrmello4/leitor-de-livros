import { expect, test, type Page } from '@playwright/test';
import { createDefaultProfile } from '../../src/domain/profiles';
import { seedNativeChapter } from './webtoon-fixture';

test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

async function openReader(page: Page) {
  const profile = { ...createDefaultProfile(), mode: 'webtoon' };
  await page.addInitScript((value) => {
    localStorage.setItem('tactile-reader/profiles/v2', JSON.stringify({
      version: 2, activeProfileId: value.id, profiles: [value],
    }));
  }, profile);
  await page.goto('/');
  await page.locator('[data-publication-format="demo"] .cover-button').click();
  await expect(page.getByTestId('webtoon-reader')).toBeVisible();
  await page.getByTestId('webtoon-reader').evaluate(el => { el.scrollTop = 1500; });
  await page.waitForTimeout(800);
}

for (const scenario of [
  { name: 'browser demo', index: undefined, delay: 80 },
  { name: 'native chapter middle', index: 60, delay: 80 },
  { name: 'native chapter end', index: 119, delay: 80 },
  { name: 'pauses longer than save timers', index: 119, delay: 300 },
  { name: 'estimated page dimensions', index: 60, delay: 80 },
]) {
test(`slow pinch preserves content through persistence timers: ${scenario.name}`, async ({ page }) => {
  if (scenario.index === undefined) {
    await openReader(page);
  } else {
    await seedNativeChapter(page, 120, scenario.name === 'estimated page dimensions');
    await page.goto('/');
    await page.locator('[data-publication-format="cbz"] .cover-button').click();
    await expect(page.getByTestId('webtoon-reader')).toBeVisible();
    await page.locator(`.webtoon-page-item[data-page-index="${scenario.index}"]`).evaluate(el => el.scrollIntoView());
    await page.waitForTimeout(800);
  }
  const focal = { x: 206, y: 450 };
  const reference = await page.evaluate(({ x, y }) => {
    const article = document.elementFromPoint(x, y)?.closest('article')!;
    const r = article.getBoundingClientRect();
    return { index: article.getAttribute('data-page-index'), x: (x - r.left) / r.width, y: (y - r.top) / r.height, width: r.width };
  }, focal);
  const cdp = await page.context().newCDPSession(page);
  const points = (distance: number) => [
    { x: focal.x - distance / 2, y: focal.y - distance / 2, id: 1 },
    { x: focal.x + distance / 2, y: focal.y + distance / 2, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(100) });
  const samples = [];
  for (let step = 1; step <= 24; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(100 + step * 4) });
    await page.waitForTimeout(scenario.delay);
    samples.push(await page.evaluate(({ reference, focal }) => {
      const article = document.querySelector(`.webtoon-page-item[data-page-index="${reference.index}"]`)!;
      const r = article.getBoundingClientRect();
      return {
        error: Math.hypot(r.left + reference.x * r.width - focal.x, r.top + reference.y * r.height - focal.y),
        scale: r.width / reference.width,
        underFinger: document.elementFromPoint(focal.x, focal.y)?.closest('article')?.getAttribute('data-page-index'),
      };
    }, { reference, focal }));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(650);
  console.log(JSON.stringify({ scenario: scenario.name, reference, maxError: Math.max(...samples.map(s => s.error)), scales: samples.map(s => Number(s.scale.toFixed(2))) }));
  expect(Math.max(...samples.map(s => s.error))).toBeLessThan(2);
  expect(samples.at(-1)!.scale).toBeCloseTo(1.96, 1);
  expect(samples.every(s => s.underFinger === reference.index)).toBe(true);
  const finalWidth = await page.locator(`.webtoon-page-item[data-page-index="${reference.index}"]`).evaluate(el => el.getBoundingClientRect().width);
  expect(finalWidth / reference.width).toBeCloseTo(1.96, 1);

  // A second gesture zooms back out. Leaving a finger on the screen must not
  // turn the end of the pinch into a fling to a different page.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(196) });
  for (let step = 23; step >= 0; step--) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(100 + step * 4) });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  const beforeEnd = await page.getByTestId('webtoon-reader').evaluate(el => el.scrollTop);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: points(100).slice(0, 1) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...points(100)[0], y: focal.y - 100 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(650);
  expect(Math.abs(await page.getByTestId('webtoon-reader').evaluate(el => el.scrollTop) - beforeEnd)).toBeLessThan(2);
  const restored = await page.locator(`.webtoon-page-item[data-page-index="${reference.index}"]`).evaluate((el, ref) => {
    const r = el.getBoundingClientRect();
    return { scale: r.width / ref.width, x: r.left + r.width * ref.x, y: r.top + r.height * ref.y };
  }, reference);
  expect(restored.scale).toBeCloseTo(1, 2);
  expect(Math.hypot(restored.x - focal.x, restored.y - focal.y)).toBeLessThan(2);

  // Ordinary one-finger navigation must still work after a long paused pinch.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 206, y: 400, id: 1 }] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 206, y: 400 + step * 15, id: 1 }] });
    await page.waitForTimeout(35);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.getByTestId('webtoon-reader').evaluate(el => el.scrollTop)).toBeLessThan(beforeEnd - 30);
});
}
