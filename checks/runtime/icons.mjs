// Builds the hosted app's install icons (app/icons/*) from the figure kit: Stacey Jatham's silhouette mugshot,
// in ink on an alarm-red halo, on the app's paper, with "68" knocked out of the shoulders in the display face.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/icons.mjs
// Writes icon.svg (any size), icon-192.png, icon-512.png, icon-maskable-512.png (mark scaled into the 80% safe
// circle) and apple-touch-icon.png (180). Deterministic: the kit uses no randomness.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'app', 'icons');
const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const cast = require(path.join(ROOT, 'app', 'figures', 'cast.js'));
const PW = process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright';

const INK = '#14110e', PAPER = '#f2ede1', HALO = K.tokens.BRAND['alarm-500'];   // the app's --ink / --paper; Stacey's halo
const FONT = fs.readFileSync(path.join(ROOT, 'app', 'fonts', 'ArchivoCompressed-Black.woff2')).toString('base64');

/* the silhouette in one ink, numbers rounded to 0.1 kit units (a 25th of an inch) to keep the SVG small */
const spec = cast.byId.stacey;
const fig = K.render(spec, { silhouette: true });
if (fig.warnings && fig.warnings.length) throw new Error('figure kit warnings: ' + fig.warnings.join('; '));
const inner = fig.inner
  .replace(/(fill|stroke|stop-color)="#[0-9a-fA-F]{3,8}"/g, (_, a) => `${a}="${INK}"`)
  .replace(/-?\d+\.\d{2,}/g, (n) => String(Math.round(parseFloat(n) * 10) / 10));

/* k scales the whole mark about the centre (1 = full bleed; 0.8 keeps the head, halo and "68" in the maskable safe circle) */
function icon(k = 1) {
  const c = (v) => +(256 + (v - 256) * k).toFixed(2);
  const headU = (spec.heightIn * 25) / spec.heads, s = (150 / headU) * k;     // the head about 150 px tall at k = 1
  const tx = 256, ty = +(c(70) - fig.minY * s).toFixed(2);                     // crown at y = 70
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<title>Blades '68</title>` +
    `<style>@font-face{font-family:B68;src:url(data:font/woff2;base64,${FONT}) format("woff2");font-weight:900}</style>` +
    `<rect width="512" height="512" fill="${PAPER}"/>` +
    `<circle cx="256" cy="${c(200)}" r="${+(150 * k).toFixed(2)}" fill="${HALO}"/>` +
    `<g transform="translate(${tx} ${ty}) scale(${+s.toFixed(5)})">${inner}</g>` +
    `<text x="256" y="${c(478)}" text-anchor="middle" font-family="B68" font-weight="900" font-size="${+(170 * k).toFixed(2)}" letter-spacing="-2" fill="${PAPER}">68</text>` +
    `</svg>`;
}

fs.mkdirSync(OUT, { recursive: true });
const full = icon(1), safe = icon(0.8), apple = icon(0.9);
fs.writeFileSync(path.join(OUT, 'icon.svg'), full);
const { chromium } = require(PW);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:${PAPER}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: size, height: size } });
}
await png(full, 192, 'icon-192.png');
await png(full, 512, 'icon-512.png');
await png(safe, 512, 'icon-maskable-512.png');
await png(apple, 180, 'apple-touch-icon.png');
await browser.close();
for (const f of fs.readdirSync(OUT).sort()) console.log(f.padEnd(24), fs.statSync(path.join(OUT, f)).size, 'bytes');
