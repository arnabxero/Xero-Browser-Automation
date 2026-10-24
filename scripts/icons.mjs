// Renders the app icon from SVG into the PNG sizes the app and installer need.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { root } from './bundle.mjs';

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7894FF"/>
      <stop offset="1" stop-color="#4F6FF0"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>
  <rect x="8.5" y="8.5" width="239" height="239" rx="55.5" fill="none" stroke="rgba(255,255,255,0.22)"/>
  <path d="M84 80 172 176M172 80 84 176" stroke="#fff" stroke-width="26" stroke-linecap="round"/>
  <circle cx="192" cy="64" r="30" fill="#FF4F5E" stroke="#7390FE" stroke-width="12"/>
</svg>`;

const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => chromium.launch({ headless: true }));
const page = await browser.newPage();
mkdirSync(join(root, 'build'), { recursive: true });
for (const [size, out] of [
  [512, 'build/icon.png'],
  [256, 'resources/icon.png'],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  writeFileSync(join(root, out), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', out);
}
writeFileSync(join(root, 'build/icon.svg'), svg(256));
await browser.close();
