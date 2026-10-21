#!/usr/bin/env node
// Copy the prop images from the vault into app/media/handouts/ (git-ignored; deployed from disk like the calling cards).
//
//   npm run gm:handouts                          reads the vault's handouts folder (lib/handouts-export.mjs, SRC_CANDIDATES)
//   npm run gm:handouts -- --src "<folder>"      a folder inside the vault (or an absolute one)
//   node scripts/gm-handouts.mjs --vault <vault> [--src <folder>] [--dest <dir>] [--dry]
//
// Only web images are copied (png, jpg, gif, webp, svg); anything else (pdf, tiff...) is named as skipped. Each image is copied under a
// content-hash name (16 hex of sha256 + extension), never its vault name, so the files cannot be guessed; hashed files that are no longer
// in the list are removed (other files in the folder are left alone). The manifest (title, file, cue) goes in the GM pack's
// `handouts` part (npm run gm:pack), never beside the images: it also writes a private copy to gm-private/handouts-manifest.json.
// Run this on the PC that deploys, before `npm run deploy` (GM.md, "Handouts"). Prints counts and file names only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSource, scanHandouts, HASHED_RE } from './lib/handouts-export.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Copy and report. Returns { src, copied, same, skipped, items, dest } or { error }. */
export function run({ vault, src, dest = path.join(REPO, 'app', 'media', 'handouts'), manifest = path.join(REPO, 'gm-private', 'handouts-manifest.json'), dry = false }) {
  const dir = findSource(vault, src);
  if (!dir) return { error: 'no handouts folder in the vault' + (src ? ' at ' + src : ' (looked in Campaigns/Group/handouts, Campaigns/Group/props, Projects/handouts, Projects/props); use --src') };
  const { items, skipped } = scanHandouts(dir);
  let copied = 0, same = 0, removed = [];
  if (!dry && items.length) fs.mkdirSync(dest, { recursive: true });
  const keep = new Set(items.map((i) => i.file));
  for (const it of items) {
    const to = path.join(dest, it.file);
    const a = fs.statSync(it.from);
    let b = null; try { b = fs.statSync(to); } catch (_) { b = null; }
    if (b && b.size === a.size && Math.floor(b.mtimeMs) >= Math.floor(a.mtimeMs) - 1) { same++; continue; }
    if (!dry) { fs.copyFileSync(it.from, to); fs.utimesSync(to, a.atime, a.mtime); }
    copied++;
  }
  /* stale: a hashed file no longer in the list (its image changed or left the vault). Other names in the folder are not ours: left alone. */
  if (items.length) {
    let have = []; try { have = fs.readdirSync(dest); } catch (_) { have = []; }
    for (const n of have) if (HASHED_RE.test(n) && !keep.has(n)) { removed.push(n); if (!dry) fs.rmSync(path.join(dest, n), { force: true }); }
  }
  if (!dry && items.length) {
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify(items.map(({ from, ...r }) => r), null, 1));
  }
  return { src: dir, dest, copied, same, removed, skipped, items: items.map(({ from, ...r }) => r) };
}

function main() {
  const o = { vault: process.env.B68_VAULT || '', src: '', dry: false, dest: '' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault') o.vault = argv[++i]; else if (a === '--src') o.src = argv[++i]; else if (a === '--dest') o.dest = argv[++i]; else if (a === '--dry') o.dry = true;
    else { console.error('unknown argument: ' + a); process.exit(2); }
  }
  if (!o.vault) { console.error('--vault <vault dir> is required (or set B68_VAULT)'); process.exit(2); }
  const r = run({ vault: path.resolve(o.vault), src: o.src, dry: o.dry, ...(o.dest ? { dest: path.resolve(o.dest) } : {}) });
  if (r.error) { console.error(r.error); process.exit(1); }
  console.log((o.dry ? 'dry run: ' : '') + 'handouts from ' + path.relative(path.resolve(o.vault), r.src).split(path.sep).join('/'));
  console.log('  images ' + r.items.length + ': copied ' + r.copied + ', already there ' + r.same + ', skipped ' + r.skipped.length + ', stale removed ' + r.removed.length);
  for (const s of r.skipped) console.log('  skipped ' + s.rel + ' (' + s.why + ')');
  if (!r.items.length) console.log('  no web images in that folder: nothing to deploy');
  else console.log('  next: npm run gm:pack (carries the titles), then deploy from this PC');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
