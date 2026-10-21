// The design system's two kits in the app: one manifest (app/kits.json), one way to update them, one check.
//   node scripts/kits.mjs                      what the manifest says, and whether each file still matches it
//   node scripts/kits.mjs maps <map-kit.js> [--source "<where it came from>"]
//   node scripts/kits.mjs figures <figure-kit.js> [--source "…"] [--note "…"]   (a note: why this file, e.g. a local patch it replaces)
// An update copies the file into app/ (maps/map-kit.js, figures/figure-kit.js), reads the version the file itself reports
// (B68Map.VERSION, B68Figure.version) and writes its size and sha256 into app/kits.json. It refuses a file that does not load
// in Node, does not export the kit's global, or is older than the one the app has (pass --older to go back on purpose).
// Nothing else changes: the service worker precaches each kit because its file is in a routes.js bundle (checks/runtime/kits.test.mjs
// keeps that true), and a deploy is still `npm run deploy`, Alex's call. GM.md, "The kits".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const MANIFEST = path.join(APP, 'kits.json');
export const KITS = {
  maps: { file: 'maps/map-kit.js', global: 'B68Map', version: (m) => m.VERSION },
  figures: { file: 'figures/figure-kit.js', global: 'B68Figure', version: (m) => m.version },
};

export function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
export function loadKit(file) {
  const req = createRequire(import.meta.url);
  const p = path.resolve(file);
  delete req.cache[p];
  return req(p);
}
export function readManifest() { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
/* -1, 0, 1 on dotted versions; a pre-release tag (0.8.0-beta.1) sorts before its release */
export function cmpVersion(a, b) {
  const p = (v) => String(v).split('-'), [x, xp] = p(a), [y, yp] = p(b);
  const xs = x.split('.').map(Number), ys = y.split('.').map(Number);
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) { const d = (xs[i] || 0) - (ys[i] || 0); if (d) return d < 0 ? -1 : 1; }
  if (xp === yp) return 0; if (!xp) return 1; if (!yp) return -1; return xp < yp ? -1 : 1;
}
/* what the manifest says against what is on disk: [] when they agree */
export function verify(man = readManifest()) {
  const out = [];
  for (const [name, k] of Object.entries(KITS)) {
    const m = man.kits && man.kits[name];
    if (!m) { out.push(name + ': not in app/kits.json'); continue; }
    if (m.file !== k.file) out.push(name + ': file is ' + m.file + ', expected ' + k.file);
    const f = path.join(APP, k.file);
    if (!fs.existsSync(f)) { out.push(name + ': ' + k.file + ' is missing'); continue; }
    const buf = fs.readFileSync(f);
    if (sha256(buf) !== m.sha256) out.push(name + ': ' + k.file + ' does not match its sha256 in app/kits.json (run scripts/kits.mjs ' + name + ' <file>)');
    if (buf.length !== m.bytes) out.push(name + ': ' + k.file + ' is ' + buf.length + ' bytes, app/kits.json says ' + m.bytes);
    let v = null; try { v = k.version(loadKit(f)); } catch (e) { out.push(name + ': ' + k.file + ' does not load: ' + e.message); }
    if (v !== null && v !== m.version) out.push(name + ': ' + k.file + ' reports ' + v + ', app/kits.json says ' + m.version);
  }
  return out;
}

function main(argv) {
  const [name, file, ...rest] = argv;
  if (!name) {
    const man = readManifest();
    for (const [n, m] of Object.entries(man.kits)) console.log(n.padEnd(8) + ' ' + m.version.padEnd(14) + ' ' + m.file + '  ' + m.sha256.slice(0, 12) + '  ' + m.source);
    const bad = verify(man); bad.forEach((b) => console.log('MISMATCH ' + b));
    process.exit(bad.length ? 1 : 0);
  }
  const k = KITS[name];
  if (!k || !file) { console.error('usage: node scripts/kits.mjs [maps|figures <file> [--source "…"] [--older]]'); process.exit(2); }
  const flag = (f) => rest.indexOf(f) >= 0, val = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
  let mod; try { mod = loadKit(file); } catch (e) { console.error(file + ' does not load in Node: ' + e.message); process.exit(1); }
  const v = mod && k.version(mod);
  if (typeof v !== 'string' || !v) { console.error(file + ' is not the ' + name + ' kit (no ' + k.global + ' version)'); process.exit(1); }
  const man = readManifest(), old = man.kits[name];
  if (old && cmpVersion(v, old.version) < 0 && !flag('--older')) { console.error(name + ' ' + v + ' is older than the app\'s ' + old.version + ' (pass --older to go back on purpose)'); process.exit(1); }
  const buf = fs.readFileSync(file);
  fs.writeFileSync(path.join(APP, k.file), buf);
  man.kits[name] = { file: k.file, global: k.global, version: v, bytes: buf.length, sha256: sha256(buf), source: val('--source') || (old && old.version === v ? old.source : 'unknown: say where with --source'), at: new Date().toISOString().slice(0, 10) };
  if (val('--note')) man.kits[name].note = val('--note');
  fs.writeFileSync(MANIFEST, JSON.stringify(man, null, 2) + '\n');
  console.log(name + ' ' + (old ? old.version + ' -> ' : '') + v + ' (' + buf.length + ' bytes, ' + man.kits[name].sha256.slice(0, 12) + ')');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
