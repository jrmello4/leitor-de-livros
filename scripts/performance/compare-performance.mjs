import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { comparePerformanceReports } from './performance-contract.mjs';

const inputPaths = process.argv.slice(2).map((path) => resolve(path));
if (inputPaths.length < 2) {
  throw new Error('Usage: node scripts/performance/compare-performance.mjs <integrated-report.json> <dedicated-report.json> [more reports...]');
}

const reports = await Promise.all(inputPaths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
const comparison = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  reports: inputPaths,
  ...comparePerformanceReports(reports),
};
const outputPath = resolve(process.env.PERFORMANCE_COMPARISON_OUTPUT ?? 'artifacts/performance-comparison.json');
await writeFile(outputPath, JSON.stringify(comparison, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ outputPath, comparison }));
if (comparison.status !== 'passed') {
  process.exitCode = 1;
}
