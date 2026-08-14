import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyGpu,
  comparePerformanceReports,
  evaluateScenarioMetrics,
  percentile,
  validatePerformanceReport,
} from './performance-contract.mjs';

test('does not classify the Microsoft Basic Display software adapter as integrated', () => {
  assert.equal(classifyGpu('Microsoft Basic Display Adapter', 4 * 1024 ** 3), undefined);
  assert.equal(classifyGpu('Intel(R) Iris(R) Xe Graphics'), 'integrated');
  assert.equal(classifyGpu('NVIDIA GeForce RTX 4070'), 'dedicated');
});

test('computes frame-time p95 and rejects threshold breaches', () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 95), 50);
  assert.deepEqual(evaluateScenarioMetrics({
    firstFrameMs: 500,
    frameTimeP95Ms: 20,
    peakMemoryBytes: 200,
    steadyMemoryBytes: 100,
    memoryGrowthBytes: 100,
    cacheGrowthBytes: 200,
    qualityDegradedBeforeStall: true,
  }).status, 'passed');
  assert.equal(evaluateScenarioMetrics({
    firstFrameMs: 2000,
    frameTimeP95Ms: 40,
    peakMemoryBytes: 300 * 1024 * 1024,
    steadyMemoryBytes: 0,
    memoryGrowthBytes: 300 * 1024 * 1024,
    cacheGrowthBytes: 600 * 1024 * 1024,
    qualityDegradedBeforeStall: false,
  }).status, 'failed');
  assert.equal(evaluateScenarioMetrics({
    firstFrameMs: 500,
    frameTimeP95Ms: 20,
    memoryGrowthBytes: 0,
    cacheGrowthBytes: 0,
    qualityDegradedBeforeStall: true,
    requireFrameSamples: true,
    frameSampleCount: 0,
    requireQualitySamples: true,
    qualitySampleCount: 0,
    requireMemorySamples: true,
    memorySampleCount: 0,
  }).status, 'failed');
});

test('requires complete hardware/build/scenario identity', () => {
  assert.deepEqual(validatePerformanceReport({}), [
    'schemaVersion must be 1',
    'hardware.gpuClass must be integrated or dedicated',
    'build.commit and build.version are required',
    'hardware.os, hardware.gpu, and hardware.memoryBytes are required',
    'hardware.gpuClassDetected must be integrated or dedicated',
    'missing scenario: import',
    'missing scenario: first-frame',
    'missing scenario: navigation-50-pages',
    'missing scenario: rapid-publication-switching',
    'missing scenario: long-reading-session',
  ]);
});

function report(gpuClass, passed = true, commit = 'abc1234') {
  const scenarios = Object.fromEntries([
    'import',
    'first-frame',
    'navigation-50-pages',
    'rapid-publication-switching',
    'long-reading-session',
  ].map((name) => [name, { status: 'passed' }]));
  return {
    schemaVersion: 1,
    hardware: { gpuClass, gpuClassDetected: gpuClass, os: 'Windows 11', gpu: gpuClass, memoryBytes: 8 * 1024 ** 3 },
    build: { commit, version: '0.1.0' },
    scenarios,
    summary: {
      status: passed ? 'passed' : 'failed',
      qualityDegradedBeforeInteractionStall: passed,
      longSessionMemoryBounded: passed,
      longSessionCacheBounded: passed,
    },
  };
}

test('compares one integrated and one dedicated report', () => {
  assert.equal(comparePerformanceReports([report('integrated'), report('dedicated')]).status, 'passed');
  assert.equal(comparePerformanceReports([report('integrated')]).status, 'invalid');
  assert.equal(comparePerformanceReports([report('integrated'), report('dedicated', false)]).status, 'failed');
  assert.equal(comparePerformanceReports([report('integrated'), report('dedicated', true, 'different')]).status, 'invalid');
});
