// Draws the app icon (a white game cartridge with a play button, on teal) into
// build/icon.png. The same mark, as SVG, is src/renderer/components/Logo.tsx.
// Plain Node, no image library: electron-builder turns the PNG into the Windows .ico.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 512;
const SAMPLES = 3; // per axis, for smooth edges

const BACKGROUND_TOP = [0x3f, 0xd6, 0xc8];
const BACKGROUND_BOTTOM = [0x17, 0x8f, 0x86];
const CARTRIDGE = [0xff, 0xff, 0xff];
const TRIANGLE = [0x17, 0x8f, 0x86];

const CORNER = SIZE * 0.22;
const insideRoundedSquare = (x, y) => {
  const dx = Math.max(CORNER - x, x - (SIZE - CORNER), 0);
  const dy = Math.max(CORNER - y, y - (SIZE - CORNER), 0);
  return dx * dx + dy * dy <= CORNER * CORNER;
};

// The cartridge: a body, and a narrower connector underneath it.
const insideCartridge = (x, y) => {
  const u = x / SIZE;
  const v = y / SIZE;
  const body = u >= 0.22 && u <= 0.78 && v >= 0.19 && v <= 0.735;
  const connector = u >= 0.36 && u <= 0.64 && v >= 0.735 && v <= 0.845;
  return body || connector;
};

// A right-pointing triangle on the cartridge, nudged right so it looks centred.
const A = [SIZE * 0.42, SIZE * 0.33];
const B = [SIZE * 0.42, SIZE * 0.61];
const C = [SIZE * 0.655, SIZE * 0.47];
const side = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
const insideTriangle = (x, y) => {
  const d1 = side(A, B, x, y);
  const d2 = side(B, C, x, y);
  const d3 = side(C, A, x, y);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  pixels[row] = 0; // PNG filter type "none" for this scanline
  for (let x = 0; x < SIZE; x++) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = x + (sx + 0.5) / SAMPLES;
        const py = y + (sy + 0.5) / SAMPLES;
        if (!insideRoundedSquare(px, py)) continue;
        const blend = py / SIZE;
        const color = insideTriangle(px, py)
          ? TRIANGLE
          : insideCartridge(px, py)
            ? CARTRIDGE
            : BACKGROUND_TOP.map((top, i) => top + (BACKGROUND_BOTTOM[i] - top) * blend);
        red += color[0];
        green += color[1];
        blue += color[2];
        alpha += 255;
      }
    }
    const covered = alpha / 255 || 1;
    const offset = row + 1 + x * 4;
    pixels[offset] = Math.round(red / covered);
    pixels[offset + 1] = Math.round(green / covered);
    pixels[offset + 2] = Math.round(blue / covered);
    pixels[offset + 3] = Math.round(alpha / (SAMPLES * SAMPLES));
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA

mkdirSync('build', { recursive: true });
writeFileSync(
  'build/icon.png',
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log('Wrote build/icon.png');
