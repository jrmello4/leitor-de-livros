import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Forward only the confirmed test device's Tactile Reader WebView to this port.
// Snapshot before replacing the APK, then verify without importing or opening a
// comic. Only library grouping/search controls are changed by the check.
const [mode = 'before', endpoint = 'http://127.0.0.1:9224'] = process.argv.slice(2);
assert(['before', 'after'].includes(mode));
const baselinePath = 'artifacts/android-test/series-before.json';
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0].pages().find((candidate) => candidate.url().startsWith('http://tauri.localhost'));
  assert(page, 'Open the packaged Tactile Reader app first');
  if (await page.locator('.reader-back').isVisible()) await page.locator('.reader-back').click();
  await page.locator('.publication-card').first().waitFor({ state: 'attached' });
  const snapshot = await page.evaluate(async () => {
    const api = window.__TAURI_INTERNALS__;
    const books = await api.invoke('list_publications');
    return Promise.all(books.map(async (book) => ({
      id: book.id, title: book.title, sourceLabel: book.sourceLabel,
      pageCount: book.pageCount, currentPage: book.currentPage,
      isFavorite: book.isFavorite, addedAt: book.addedAt, updatedAt: book.updatedAt,
      bookmarks: await api.invoke('list_bookmarks', { publicationId: book.id }),
    })));
  });
  if (mode === 'before') {
    await writeFile(baselinePath, JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify({ baselineCount: snapshot.length, sampleTitles: snapshot.slice(0, 4).map((book) => book.title) }));
  } else {
    const before = JSON.parse(await readFile(baselinePath, 'utf8'));
    const readingData = (books) => books.map(({ title, sourceLabel, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(readingData(snapshot), readingData(before), 'Updating must preserve every publication and its reading data');
    const greenArrow = snapshot.filter((book) => /arqueiro verde absoluto/i.test(book.title));
    assert(greenArrow.length > 1, 'The device must contain the reported series');
    assert(greenArrow.every((book) => /^arqueiro verde absoluto\s*#/i.test(book.title)), 'An import prefix is still present');
    const groupButton = page.locator('.library-view-toggle').filter({ hasText: /^(Group|By series|Agrupar|Por série)$/i });
    assert.equal(await groupButton.count(), 1, 'Expected one series grouping control');
    if (await groupButton.getAttribute('aria-pressed') !== 'true') await groupButton.click();
    const search = page.locator('.search-field input');
    await search.fill('Arqueiro Verde Absoluto');
    while (await page.locator('.library-load-more button').isVisible()) await page.locator('.library-load-more button').click();
    const headings = await page.locator('.library-group-heading').allTextContents();
    assert.equal(headings.length, 1, 'The entire Green Arrow series must share one group');
    const ids = await page.locator('.publication-card').evaluateAll((cards) => cards.map((card) => card.dataset.publicationId));
    assert.equal(ids.length, greenArrow.length);
    const orderedTitles = ids.map((id) => snapshot.find((book) => book.id === id).title);
    const numbers = orderedTitles.map((title) => Number(title.match(/#\s*(\d+)/)[1]));
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'Issue order must be numeric');
    const evidence = {
      count: snapshot.length, preservedReadingData: true,
      correctedTitles: snapshot.filter((book) => before.find((old) => old.id === book.id)?.title !== book.title).length,
      headings, orderedTitles, numbers,
    };
    await writeFile('artifacts/android-test/series-verification.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: 'artifacts/android-test/moto-series-grouped.png' });
    await search.fill('');
  }
} finally {
  await browser.close();
}
