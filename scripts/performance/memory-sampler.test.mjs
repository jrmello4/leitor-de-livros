import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { MEMORY_SAMPLE_INTERVAL_MS, parseMemorySampleLine } from './performance-smoke.mjs';

test('reads a timestamped byte sample', () => {
  assert.deepEqual(parseMemorySampleLine('1787150000000 524288000'), { atMs: 1787150000000, bytes: 524288000 });
});

test('tolerates the carriage return PowerShell writes', () => {
  assert.deepEqual(parseMemorySampleLine('1787150000000 1024\r'), { atMs: 1787150000000, bytes: 1024 });
});

test('ignores anything that is not a sample', () => {
  for (const line of ['', '   ', 'not a sample', '1787150000000', '1787150000000 0', 'a b']) {
    assert.equal(parseMemorySampleLine(line), undefined, `should ignore ${JSON.stringify(line)}`);
  }
});

test('samples slowly enough to leave the app responsive', () => {
  // The previous sampler spawned a PowerShell process every 500ms, which takes
  // longer than that to start, so the samplers starved the app being measured.
  assert.ok(MEMORY_SAMPLE_INTERVAL_MS >= 1000);
});

test('the scenario results reach the report under the key it reads', async () => {
  // The runner returned `scenarioResults` while buildReport destructured
  // `scenarios`, so assembling the report threw after every scenario had
  // already run and no performance evidence could ever be produced.
  const source = await readFile(new URL('./performance-smoke.mjs', import.meta.url), 'utf8');
  const returned = /return \{ (\w+):? ?[^}]*memory: memorySummary/.exec(source)?.[1];
  const destructured = /function buildReport\(\{[^}]*\}\)/.exec(source)?.[0] ?? '';

  assert.equal(returned, 'scenarios');
  assert.match(destructured, /\bscenarios\b/);
});

test('the rationale states the verdict it was given', async () => {
  const { describeQualityEvidence } = await import('./performance-smoke.mjs');

  assert.match(
    describeQualityEvidence({ sampleCount: 2, transitionCount: 1, stallAt: 900, stallFrameMs: 366, firstDegradation: 3128, degradedBeforeStall: false }),
    /only at 3128ms, after a 366ms frame at 900ms/,
  );
  assert.match(
    describeQualityEvidence({ sampleCount: 2, transitionCount: 1, stallAt: 3000, stallFrameMs: 40, firstDegradation: 900, degradedBeforeStall: true }),
    /dropped at 900ms, before a 40ms frame at 3000ms/,
  );
  assert.match(
    describeQualityEvidence({ sampleCount: 2, transitionCount: 0, stallAt: 900, stallFrameMs: 366, degradedBeforeStall: false }),
    /never dropped/,
  );
  assert.match(
    describeQualityEvidence({ sampleCount: 1, transitionCount: 0, stallAt: undefined, degradedBeforeStall: true }),
    /No quality reduction was required/,
  );
  assert.match(describeQualityEvidence({ sampleCount: 0, transitionCount: 0 }), /no valid samples/);
});

test('the summary judges memory by the samples the scenario actually stored', async () => {
  const source = await readFile(new URL('./performance-smoke.mjs', import.meta.url), 'utf8');
  const summaryBlock = /longSessionMemoryBounded:[\s\S]{0,200}?longSessionCacheBounded/.exec(source)?.[0] ?? '';
  const scenarioBlock = /scenarioResults\['long-reading-session'\] = \{[\s\S]{0,400}?\};/.exec(source)?.[0] ?? '';

  assert.match(summaryBlock, /sampleCount/);
  assert.doesNotMatch(summaryBlock, /memorySampleCount/);
  assert.match(scenarioBlock, /\.\.\.longMemory/);
});
