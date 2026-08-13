import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const outputDirectory = process.argv[2] ? resolve(process.argv[2]) : undefined;

if (!outputDirectory) {
  throw new Error('Usage: node scripts/release/create-fixtures.mjs <output-directory>');
}

const smokeFixtureDirectory = resolve(repositoryRoot, 'tests/fixtures/smoke');
const pdfFixture = resolve(repositoryRoot, 'src-tauri/tests/fixtures/tactile-reader-sample.pdf');
const cover = await readFile(resolve(smokeFixtureDirectory, 'cover.svg'));
const page = await readFile(resolve(smokeFixtureDirectory, 'page.svg'));
const cbz = zipSync({
  '01-cover.svg': strToU8(cover.toString('utf8')),
  '02-page.svg': strToU8(page.toString('utf8')),
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
