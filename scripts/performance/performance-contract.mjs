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
  if (metrics.firstFrameMs > thresholds.firstFrameMs) {
    failures.push(`first-frame latency ${metrics.firstFrameMs}ms exceeds ${thresholds.firstFrameMs}ms`);
  }
  if (metrics.frameTimeP95Ms > thresholds.navigationFrameTimeP95Ms) {
    failures.push(`frame-time p95 ${metrics.frameTimeP95Ms}ms exceeds ${thresholds.navigationFrameTimeP95Ms}ms`);
  }
  if (metrics.peakMemoryBytes - metrics.steadyMemoryBytes > thresholds.longSessionMemoryGrowthBytes) {
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
  if (!report?.build?.commit || !report?.build?.version) {
    errors.push('build.commit and build.version are required');
  }
  if (!report?.hardware?.os || !report?.hardware?.gpu || !report?.hardware?.memoryBytes) {
    errors.push('hardware.os, hardware.gpu, and hardware.memoryBytes are required');
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
