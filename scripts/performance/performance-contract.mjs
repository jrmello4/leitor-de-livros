export const PERFORMANCE_REPORT_VERSION = 1;

export const PERFORMANCE_THRESHOLDS = Object.freeze({
  firstFrameMs: 1500,
  navigationFrameTimeP95Ms: 33.4,
  rapidSwitchFrameTimeP95Ms: 50,
  longSessionFrameTimeP95Ms: 33.4,
  longSessionMemoryGrowthBytes: 256 * 1024 * 1024,
  longSessionCacheGrowthBytes: 512 * 1024 * 1024,
  qualityDegradationBeforeInteractionStall: true,
});

export const PERFORMANCE_SCENARIOS = Object.freeze([
  'import',
  'first-frame',
  'navigation-50-pages',
  'rapid-publication-switching',
  'long-reading-session',
]);

export const GPU_CLASSES = Object.freeze(['integrated', 'dedicated']);

export function classifyGpu(name, adapterRam = 0) {
  const normalized = String(name ?? '').toLowerCase();
  if (/microsoft basic display/.test(normalized)) {
    return undefined;
  }
  if (/nvidia|geforce|quadro|rtx|gtx|tesla|radeon\s+(rx|pro)|intel\s+arc/.test(normalized)) {
    return 'dedicated';
  }
  if (/intel.*(uhd|iris|hd\s+graphics)|amd.*radeon\s+graphics|radeon\s+vega|apu/.test(normalized)) {
    return 'integrated';
  }
  if (Number(adapterRam) >= 2 * 1024 ** 3) {
    return 'dedicated';
  }
  return undefined;
}

export function normalizeGpuClass(value) {
  return GPU_CLASSES.includes(value) ? value : undefined;
}

export function percentile(values, percentileRank) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1));
  return sorted[index];
}

export function evaluateScenarioMetrics(metrics, thresholds = PERFORMANCE_THRESHOLDS) {
  const failures = [];
  for (const [name, value] of Object.entries({
    firstFrameMs: metrics.firstFrameMs,
    frameTimeP95Ms: metrics.frameTimeP95Ms,
  })) {
    if (!Number.isFinite(value)) {
      failures.push(`${name} is not a finite measurement`);
    }
  }
  if (metrics.requireFrameSamples && (!(metrics.frameSampleCount > 0) || !Number.isFinite(metrics.frameSampleCount))) {
    failures.push('frame sampler produced no valid samples');
  }
  if (metrics.requireQualitySamples && (!(metrics.qualitySampleCount > 0) || !Number.isFinite(metrics.qualitySampleCount))) {
    failures.push('quality sampler produced no valid samples');
  }
  if (metrics.requireMemorySamples && (!(metrics.memorySampleCount > 1) || !Number.isFinite(metrics.memorySampleCount))) {
    failures.push('memory sampler produced fewer than two valid samples');
  }
  if (metrics.firstFrameMs > thresholds.firstFrameMs) {
    failures.push(`first-frame latency ${metrics.firstFrameMs}ms exceeds ${thresholds.firstFrameMs}ms`);
  }
  if (metrics.frameTimeP95Ms > thresholds.navigationFrameTimeP95Ms) {
    failures.push(`frame-time p95 ${metrics.frameTimeP95Ms}ms exceeds ${thresholds.navigationFrameTimeP95Ms}ms`);
  }
  if (metrics.memoryGrowthBytes > thresholds.longSessionMemoryGrowthBytes) {
    failures.push('steady memory growth exceeds the long-session threshold');
  }
  if (metrics.cacheGrowthBytes > thresholds.longSessionCacheGrowthBytes) {
    failures.push('derived-cache growth exceeds the long-session threshold');
  }
  if (thresholds.qualityDegradationBeforeInteractionStall && !metrics.qualityDegradedBeforeStall) {
    failures.push('quality did not degrade before interaction stall');
  }
  return { status: failures.length === 0 ? 'passed' : 'failed', failures };
}

export function validatePerformanceReport(report) {
  const errors = [];
  if (!report || report.schemaVersion !== PERFORMANCE_REPORT_VERSION) {
    errors.push(`schemaVersion must be ${PERFORMANCE_REPORT_VERSION}`);
  }
  if (!report?.hardware?.gpuClass || !GPU_CLASSES.includes(report.hardware.gpuClass)) {
    errors.push('hardware.gpuClass must be integrated or dedicated');
  }
  if (!report?.build?.commit || report.build.commit === 'unknown' || !report?.build?.version || report.build.version === 'unknown') {
    errors.push('build.commit and build.version are required');
  }
  if (!report?.hardware?.os || report.hardware.os === 'unknown' || !report?.hardware?.gpu || report.hardware.gpu === 'unknown' || !(report?.hardware?.memoryBytes > 0)) {
    errors.push('hardware.os, hardware.gpu, and hardware.memoryBytes are required');
  }
  if (!report?.hardware?.gpuClassDetected || !GPU_CLASSES.includes(report.hardware.gpuClassDetected)) {
    errors.push('hardware.gpuClassDetected must be integrated or dedicated');
  } else if (report.hardware.gpuClass !== report.hardware.gpuClassDetected) {
    errors.push('hardware.gpuClass does not match the detected GPU class');
  }
  const scenarios = report?.scenarios ?? {};
  for (const scenario of PERFORMANCE_SCENARIOS) {
    if (!scenarios[scenario]) {
      errors.push(`missing scenario: ${scenario}`);
    }
  }
  return errors;
}

export function comparePerformanceReports(reports) {
  const errors = reports.flatMap(validatePerformanceReport);
  if (errors.length > 0) {
    return { status: 'invalid', errors };
  }
  const gpuClasses = new Set(reports.map((report) => report.hardware.gpuClass));
  if (!gpuClasses.has('integrated') || !gpuClasses.has('dedicated')) {
    return { status: 'invalid', errors: ['comparison requires one integrated and one dedicated GPU report'] };
  }
  const buildIdentities = new Set(reports.map((report) => `${report.build.commit}:${report.build.version}`));
  if (buildIdentities.size !== 1) {
    return { status: 'invalid', errors: ['comparison requires reports from the same build commit and version'] };
  }
  const qualityOrdering = reports.map((report) => ({
    gpuClass: report.hardware.gpuClass,
    qualityDegradedBeforeStall: report.summary.qualityDegradedBeforeInteractionStall,
  }));
  const passed = reports.every((report) => report.summary.status === 'passed')
    && reports.every((report) => report.summary.qualityDegradedBeforeInteractionStall)
    && reports.every((report) => report.summary.longSessionMemoryBounded)
    && reports.every((report) => report.summary.longSessionCacheBounded);
  return {
    status: passed ? 'passed' : 'failed',
    errors: passed ? [] : ['one or more hardware reports failed the documented performance or bounded-growth criteria'],
    hardware: qualityOrdering,
  };
}
