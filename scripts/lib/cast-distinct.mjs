// The distinctness linter's arithmetic (suite ticket 3.9): every NPC rendered at 64 px, compared in pairs. Two warnings:
// a silhouette overlap (the two shapes, each scaled to 64 px tall and centred, share more than a threshold of their combined area),
// or the same colour plus hat (same outer-garment colour and the same hat type and colour). Warnings only; nothing here fails a run.
// Needs `sharp` to draw the SVG; without it the silhouette check is skipped and said so. No network, no model.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SIZE = 64;
export const OVERLAP = 0.8;

/** The 64 x 64 alpha mask of a figure SVG (height 64, centred), as a Uint8Array of 0/1; null when sharp is missing. */
export async function mask(svg) {
  let sharp;
  try { sharp = require('sharp'); } catch (_) { return null; }
  const { data, info } = await sharp(Buffer.from(svg)).resize({ height: SIZE, width: SIZE, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(SIZE * SIZE), ox = Math.floor((SIZE - info.width) / 2), oy = Math.floor((SIZE - info.height) / 2);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 40) out[(y + oy) * SIZE + x + ox] = 1;
  return out;
}

/** Intersection over union of two masks, 0..1. */
export function overlap(a, b) {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; }
  return u ? i / u : 0;
}

const colourOf = (s) => (s && s.outfit && ((s.outfit.outer && s.outfit.outer.color) || (s.outfit.base && s.outfit.base.color))) || '';
const hatOf = (s) => (s && s.hair && s.hair.hat && s.hair.hat.type) ? s.hair.hat.type + ':' + (s.hair.hat.color || '') : '';

/** Same outer colour and the same hat (type and colour), both wearing one. */
export function sameLook(a, b) {
  const ca = colourOf(a), ha = hatOf(a);
  return !!ca && !!ha && ca === colourOf(b) && ha === hatOf(b);
}

/** specs: [{ id, name?, ... figure kit spec }]. render: (spec) -> { svg }. Returns { warnings: [text], skipped: bool }. */
export async function lint(specs, render, threshold = OVERLAP) {
  const warnings = [], masks = [];
  let skipped = false;
  for (const s of specs) {
    const m = await mask(render(s).svg);
    if (!m) { skipped = true; break; }
    masks.push(m);
  }
  const label = (s) => s.name || s.id;
  for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) {
    if (!skipped) { const o = overlap(masks[i], masks[j]); if (o >= threshold) warnings.push('silhouette: ' + label(specs[i]) + ' and ' + label(specs[j]) + ' overlap ' + Math.round(o * 100) + '% at ' + SIZE + ' px'); }
    if (sameLook(specs[i], specs[j])) warnings.push('look: ' + label(specs[i]) + ' and ' + label(specs[j]) + ' share ' + colourOf(specs[i]) + ' and the ' + hatOf(specs[i]).split(':')[0]);
  }
  return { warnings, skipped };
}
