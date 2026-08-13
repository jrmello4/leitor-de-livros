import assert from 'node:assert/strict';
import test from 'node:test';
import {
  measureImportToFirstFrame,
  waitForCommittedPage,
} from './performance-navigation.mjs';

test('first frame includes import time', async () => {
  const events = [];
  const times = [100, 600, 900];
  const result = await measureImportToFirstFrame({
    prepareImport: async () => { events.push('fill'); },
    triggerImport: async () => { events.push('click'); },
    waitForImportComplete: async () => { events.push('import-complete'); },
    waitForReader: async () => { events.push('reader'); },
    waitForTwoFrames: async () => { events.push('two-frames'); },
  }, () => {
    events.push('now');
    return times.shift();
  });
  assert.deepEqual(result, { importMs: 500, firstFrameMs: 800 });
  assert.deepEqual(events, [
    'fill',
    'now',
    'click',
    'import-complete',
    'now',
    'reader',
    'two-frames',
    'now',
  ]);
});

test('waits until the reader commits the expected page index', async () => {
  let currentIndex = '3';
  let attributeReads = 0;
  const page = {
    getByTestId(testId) {
      assert.equal(testId, 'reader-current-page');
      return {
        async getAttribute(attributeName) {
          assert.equal(attributeName, 'data-page-index');
          attributeReads += 1;
          return currentIndex;
        },
      };
    },
  };
  const waitFor = async (predicate) => {
    while (!await predicate()) {
      currentIndex = '4';
    }
  };

  await waitForCommittedPage(page, 4, waitFor);

  assert.equal(attributeReads, 2);
});

test('times out when the reader never commits the expected page index', async () => {
  let attributeReads = 0;
  const page = {
    getByTestId() {
      return {
        async getAttribute() {
          attributeReads += 1;
          return '3';
        },
      };
    },
  };
  const waitFor = async (predicate, description) => {
    for (let poll = 0; poll < 2; poll += 1) {
      if (await predicate()) {
        return;
      }
    }
    throw new Error(description);
  };

  await assert.rejects(waitForCommittedPage(page, 4, waitFor), /Reader did not commit page 4/);
  assert.equal(attributeReads, 2);
});
