export async function waitForCommittedPage(page, expectedIndex, waitFor) {
  const expected = String(expectedIndex);
  return waitFor(async () => (
    await page.getByTestId('reader-current-page').getAttribute('data-page-index') === expected
  ), 'Reader did not commit page ' + expected + '.');
}

export async function measureImportToFirstFrame(steps, now) {
  const startedAt = now();
  await steps.triggerImport();
  await steps.waitForImportComplete();
  const importMs = now() - startedAt;
  await steps.waitForReader();
  await steps.waitForTwoFrames();
  return { importMs, firstFrameMs: now() - startedAt };
}
