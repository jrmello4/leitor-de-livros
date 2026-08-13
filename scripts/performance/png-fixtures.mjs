import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';

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

export function createPng(width, height, color, accent, variant = 0) {
  const rowSize = width * 4 + 1;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowSize;
    pixels[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const stripe = (x + y + variant * 7) % 31 < 3;
      const selected = stripe ? accent : color;
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
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function createCbz(pageCount, palette) {
  const entries = {};
  for (let index = 0; index < pageCount; index += 1) {
    const name = `page-${String(index + 1).padStart(3, '0')}.png`;
    entries[name] = createPng(160, 240, palette.color, palette.accent, index);
  }
  return zipSync(entries, { level: 0, mtime: new Date('1980-01-01T12:00:00.000Z') });
}
