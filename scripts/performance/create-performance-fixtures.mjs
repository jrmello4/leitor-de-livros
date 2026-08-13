import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCbz } from './png-fixtures.mjs';

const outputDirectory = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!outputDirectory) {
  throw new Error('Usage: node scripts/performance/create-performance-fixtures.mjs <output-directory>');
}

await mkdir(outputDirectory, { recursive: true });
const fixtures = {
  navigation: resolve(outputDirectory, 'performance-50.cbz'),
  firstSwitch: resolve(outputDirectory, 'performance-a.cbz'),
  secondSwitch: resolve(outputDirectory, 'performance-b.cbz'),
};
await writeFile(fixtures.navigation, createCbz(50, { color: [33, 50, 63], accent: [225, 164, 88] }));
await writeFile(fixtures.firstSwitch, createCbz(8, { color: [246, 238, 218], accent: [35, 105, 117] }));
await writeFile(fixtures.secondSwitch, createCbz(8, { color: [53, 41, 69], accent: [214, 113, 96] }));

console.log(JSON.stringify({ directory: outputDirectory, fixtures }));
