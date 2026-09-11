import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against the debug WebView forwarded by adb. Only a generated fixture is
// touched; never use a real publication because this test changes progress.
const browser = await chromium.connectOverCDP(process.argv[2] ?? 'http://127.0.0.1:9223');
const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://tauri.localhost'));
assert(page, 'Open the packaged Android app first');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const publicationId = await page.evaluate(async () => {
    const api = window.__TAURI_INTERNALS__;
    const publications = await api.invoke('list_publications');
    const fixture = publications.find(p => p.title === 'zoom-regression-20260908');
    if (!fixture) throw new Error('Import the generated zoom-regression-20260908.cbz first');
    await api.invoke('save_reader_state', {
      publicationId: fixture.id,
      state: { zoomMode: 'manual', zoomScale: 1, panX: 0, panY: 0 },
    });
    return fixture.id;
  });
  await page.reload();
  const start = Date.now();
  await page.locator(`[data-publication-id="${publicationId}"] .cover-button`).click();
  await page.getByTestId('webtoon-reader').waitFor();
  console.log(JSON.stringify({ readerOpenMs: Date.now() - start, scripts: await page.locator('script[src]').evaluateAll(els => els.map(el => el.src)) }));
  const cdp = await page.context().newCDPSession(page);
  const focal = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }));
  const points = distance => [
    { x: focal.x - distance / 2, y: focal.y - distance / 2, id: 1 },
    { x: focal.x + distance / 2, y: focal.y + distance / 2, id: 2 },
  ];
  for (const index of [25, 49]) {
    await page.locator(`.webtoon-page-item[data-page-index="${index}"]`).evaluate(el => el.scrollIntoView());
    await page.waitForTimeout(900);
    const reference = await page.evaluate(({ x, y }) => {
      const article = document.elementFromPoint(x, y)?.closest('.webtoon-page-item');
      if (!article) throw new Error('Focal point is not on a page');
      const r = article.getBoundingClientRect();
      return { index: article.dataset.pageIndex, x: (x - r.left) / r.width, y: (y - r.top) / r.height, width: r.width };
    }, focal);
    const measure = () => page.evaluate(({ reference, focal }) => {
      const r = document.querySelector(`.webtoon-page-item[data-page-index="${reference.index}"]`).getBoundingClientRect();
      return {
        error: Math.hypot(r.left + reference.x * r.width - focal.x, r.top + reference.y * r.height - focal.y),
        scale: r.width / reference.width,
        underFinger: document.elementFromPoint(focal.x, focal.y)?.closest('.webtoon-page-item')?.dataset.pageIndex,
      };
    }, { reference, focal });
    const samples = [];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(100) });
    for (let step = 1; step <= 24; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(100 + step * 4) });
      await page.waitForTimeout(300);
      samples.push(await measure());
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(650);
    samples.push(await measure());
    console.log(JSON.stringify({ index, reference, maxError: Math.max(...samples.map(s => s.error)), scales: samples.map(s => +s.scale.toFixed(2)) }));
    assert(samples.every(s => s.error < 2 && s.underFinger === reference.index), 'Zoom moved the focal point');
    assert(Math.abs(samples.at(-1).scale - 1.96) < 0.02, 'Zoom was reverted by persistence');

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(196) });
    for (let step = 23; step >= 0; step--) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(100 + step * 4) });
      await page.waitForTimeout(80);
    }
    const beforeEnd = await page.getByTestId('webtoon-reader').evaluate(el => el.scrollTop);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: points(100).slice(0, 1) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...points(100)[0], y: focal.y - 100 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(650);
    const restored = await measure();
    assert(restored.error < 2 && Math.abs(restored.scale - 1) < 0.02, 'Zoom out moved the focal point');
    assert(Math.abs(await page.getByTestId('webtoon-reader').evaluate(el => el.scrollTop) - beforeEnd) < 2, 'Remaining finger caused a fling');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...focal, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: focal.x, y: focal.y + step * 15, id: 1 }] });
      await page.waitForTimeout(35);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    assert(await page.getByTestId('webtoon-reader').evaluate(el => el.scrollTop) < beforeEnd - 30, 'Normal scrolling stopped working');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Android WebView + real native persistence, slow pinch in/out and subsequent navigation');
} finally {
  await browser.close();
}
