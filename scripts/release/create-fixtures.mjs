import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { deflateSync } from 'node:zlib';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const outputDirectory = process.argv[2] ? resolve(process.argv[2]) : undefined;

if (!outputDirectory) {
  throw new Error('Usage: node scripts/release/create-fixtures.mjs <output-directory>');
}

const pdfFixture = resolve(repositoryRoot, 'src-tauri/tests/fixtures/tactile-reader-sample.pdf');

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (~checksum) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

function createPng(width, height, color, accent) {
  const rowSize = width * 4 + 1;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowSize;
    pixels[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const selected = (x + y) % 12 < 2 ? accent : color;
      pixels[pixelOffset] = selected[0];
      pixels[pixelOffset + 1] = selected[1];
      pixels[pixelOffset + 2] = selected[2];
      pixels[pixelOffset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

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
