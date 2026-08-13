import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { createPng } from '../performance/png-fixtures.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const outputDirectory = process.argv[2] ? resolve(process.argv[2]) : undefined;

if (!outputDirectory) {
  throw new Error('Usage: node scripts/release/create-fixtures.mjs <output-directory>');
}

const pdfFixture = resolve(repositoryRoot, 'src-tauri/tests/fixtures/tactile-reader-sample.pdf');

const cover = createPng(64, 96, [33, 50, 63], [225, 164, 88]);
const page = createPng(64, 96, [246, 238, 218], [35, 105, 117]);
const cbz = zipSync({
  '01-cover.png': cover,
  '02-page.png': page,
}, { level: 0, mtime: new Date('1980-01-01T12:00:00.000Z') });

await mkdir(outputDirectory, { recursive: true });
const cbzPath = resolve(outputDirectory, 'smoke.cbz');
const pdfPath = resolve(outputDirectory, 'smoke.pdf');
await writeFile(cbzPath, cbz);
await copyFile(pdfFixture, pdfPath);

console.log(JSON.stringify({
  directory: outputDirectory,
  cbz: cbzPath,
  pdf: pdfPath,
}));
