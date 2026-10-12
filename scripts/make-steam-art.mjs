// Draws the artwork Steam shows for a non-Steam game into assets/steam/, from the same
// mark as the app icon. Run with `npm run steam-art`; it uses Electron only as a canvas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const OUT = join(import.meta.dirname, '..', 'assets', 'steam');
const FONT = "'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif";

/** The mark from src/renderer/components/Logo.tsx, drawn `size` wide at (x, y). */
const mark = (x, y, size) => `
  <g transform="translate(${x} ${y}) scale(${size / 64})">
    <rect width="64" height="64" rx="14" fill="url(#mark)"/>
    <path d="M17 12h30a3 3 0 0 1 3 3v32h-9v7H23v-7h-9V15a3 3 0 0 1 3-3z" fill="#fff"/>
    <path d="M27 21v18l15-9z" fill="#178f86"/>
  </g>`;

const wordmark = (x, y, size, anchor = 'middle') =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="900" font-size="${size}"
     letter-spacing="${size * 0.06}" text-anchor="${anchor}" fill="#2ec4b6">COUCHCART</text>`;

const tagline = (x, y, size, anchor = 'middle') =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="600" font-size="${size}"
     text-anchor="${anchor}" fill="#c9d6dc">Your RomM library, on the couch</text>`;

const defs = `
  <defs>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3fd6c8"/><stop offset="1" stop-color="#178f86"/>
    </linearGradient>
    <linearGradient id="night" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1a22"/><stop offset="1" stop-color="#06090d"/>
    </linearGradient>
    <radialGradient id="teal"><stop offset="0" stop-color="#2ec4b6" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#2ec4b6" stop-opacity="0"/></radialGradient>
    <radialGradient id="amber"><stop offset="0" stop-color="#ffb86b" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#ffb86b" stop-opacity="0"/></radialGradient>
  </defs>`;

/** Dark background with a teal and an amber glow and a few faint cartridges. */
const backdrop = (width, height) => {
  const unit = Math.min(width, height);
  const ghost = (x, y, size, turn) => `
    <g transform="translate(${x} ${y}) rotate(${turn}) scale(${size / 64}) translate(-32 -33)"
       fill="none" stroke="#6fe3d6" stroke-opacity="0.13" stroke-width="1.6">
      <path d="M17 12h30a3 3 0 0 1 3 3v32h-9v7H23v-7h-9V15a3 3 0 0 1 3-3z"/>
      <path d="M27 21v18l15-9z"/>
    </g>`;
  return `
    <rect width="${width}" height="${height}" fill="url(#night)"/>
    <ellipse cx="${width * 0.18}" cy="${height * 0.1}" rx="${unit * 0.95}" ry="${unit * 0.8}" fill="url(#teal)"/>
    <ellipse cx="${width * 0.9}" cy="${height * 0.95}" rx="${unit * 0.85}" ry="${unit * 0.7}" fill="url(#amber)"/>
    ${ghost(width * 0.86, height * 0.2, unit * 0.34, 14)}
    ${ghost(width * 0.1, height * 0.86, unit * 0.26, -12)}
    ${ghost(width * 0.62, height * 0.9, unit * 0.16, 8)}`;
};

const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}">${defs}${body}</svg>`;

const artwork = [
  {
    // Portrait capsule: the library grid.
    file: 'cover.png',
    width: 600,
    height: 900,
    body: `${backdrop(600, 900)}${mark(160, 220, 280)}${wordmark(303, 630, 74)}${tagline(300, 686, 25)}`,
  },
  {
    // Wide capsule: the "recent games" shelf and Big Picture.
    file: 'wide-cover.png',
    width: 920,
    height: 430,
    body: `${backdrop(920, 430)}${mark(70, 115, 200)}${wordmark(318, 222, 84, 'start')}${tagline(322, 276, 27, 'start')}`,
  },
  {
    // Background behind the game's page. Steam lays the logo over it, so no text here.
    file: 'hero.jpg',
    width: 3840,
    height: 1240,
    body: backdrop(3840, 1240),
  },
  {
    // Logo laid over the hero: transparent.
    file: 'logo.png',
    width: 1280,
    height: 720,
    body: `${mark(70, 240, 240)}${wordmark(360, 405, 128, 'start')}`,
  },
];

async function draw() {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await window.loadURL('about:blank');
  mkdirSync(OUT, { recursive: true });

  for (const { file, width, height, body } of artwork) {
    const type = file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    const dataUrl = await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = ${width};
        canvas.height = ${height};
        canvas.getContext('2d').drawImage(image, 0, 0);
        resolve(canvas.toDataURL(${JSON.stringify(type)}, 0.92));
      };
      image.onerror = () => reject(new Error('The SVG for ${file} did not load'));
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg(width, height, body))});
    })`);
    writeFileSync(join(OUT, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`assets/steam/${file} (${width} x ${height})`);
  }
}

// Not a top-level await: Electron only becomes ready once this module has finished loading.
app
  .whenReady()
  .then(draw)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
