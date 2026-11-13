// The map kit's golden cases after kit 1.0 (MK2). checks/runtime/fixtures/gm/map-kit1-golden.json holds the hashes kit 0.9 drew (kit 1.0.0 drew the
// same); a later kit may change a case only in a way the overseer has listed. This tool finds every case the vendored kit draws differently from
// those goldens, works out WHY by comparing with kit 1.0.0's own drawing (taken from git, commit a1f8d57), and records the new hash with its reason
// in map-kit1-golden-changes.json, which checks/runtime/map-kit1.test.mjs reads.
//   node scripts/map-goldens.mjs              report: every changed case and its reason; exit 1 when a case changed for a reason not on the list, or
//                                             when the recorded file does not match the vendored kit
//   node scripts/map-goldens.mjs --write      the same, then write the file; it refuses while any case is UNLISTED
// The listed reasons (MK2 brief, step 2), each recognised from the two drawings:
//   heading       the player key's heading "What you know from outside" now reads "What you know" (more than the public band is open)
//   iso-cover     an iso's covered floors are the building's wall colour, not the hatch pattern
//   facade        a section's unsurveyed rooms are the building's outside wall ("Behind the walls..."), not black hatching
//   street-key    the player street key no longer prints page references
//   key-walls     (the overseer's final build) the key's swatch for a covered floor is the wall's colour and its note reads "Behind the walls..."
// Anything else is UNLISTED: a finding, never written. INVENTED fixtures only (map-kit1-cases.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'a1f8d57';
const OUT = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'map-kit1-golden-changes.json');
const require = createRequire(import.meta.url);
const { sites, rolled, cases, sha } = await import(pathToFileURL(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'map-kit1-cases.mjs')).href);
const GOLD = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'map-kit1-golden.json'), 'utf8'));
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'kits.json'), 'utf8')).kits.maps;
const NEW = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));

function refKit() {
  const r = spawnSync('git', ['show', REF + ':app/maps/map-kit.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) throw new Error('git cannot show ' + REF + ':app/maps/map-kit.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'b68-goldens-')), 'map-kit.js');
  fs.writeFileSync(f, r.stdout);
  return require(f);
}
const texts = (svg) => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
const HEAD_OLD = 'WHAT YOU KNOW FROM OUTSIDE', HEAD_NEW = 'WHAT YOU KNOW';
/* the note's opening words (it wraps at different places in different keys; the lines after are the same) */
const NOTE_OLD = 'Hatched rooms are what gathering information', NOTE_NEW = 'Behind the walls is what gathering information';
/* the reasons one case changed, or ['UNLISTED: ...'] */
function why(a, b, opts) {
  const out = [];
  let x = a;
  if (x.includes('>' + HEAD_OLD + '<') && b.includes('>' + HEAD_NEW + '<')) { x = x.split('>' + HEAD_OLD + '<').join('>' + HEAD_NEW + '<'); out.push('heading'); }
  if (x === b) return out;
  if (opts.view === 'iso') {
    const solid = /<g class="map-cover">\s*<path [^>]*fill="(#[0-9a-f]{6})"/i.exec(b);
    /* only the covered floors (a map-cover group's path): the key's swatches keep their hatch */
    if (solid) {
      const y = x.replace(/(<g class="map-cover">\s*<path [^>]*?)fill="url\(#[^"]*-hatch\)"/g, '$1fill="' + solid[1] + '"'); if (y === b) { out.push('iso-cover'); return out; }
      /* key-walls (the overseer's final build, change 2): the key's swatch for a covered floor is the wall's colour too, and its note reads "Behind the walls" */
      const z = y.replace(/fill="url\(#[^"]*-hatch\)"/g, 'fill="' + solid[1] + '"').split('>' + NOTE_OLD).join('>' + NOTE_NEW);
      if (z === b) { out.push('iso-cover', 'key-walls'); return out; }
    }
    return out.concat(['UNLISTED: the iso changed beyond its covered floors']);
  }
  if (opts.view === 'section') {
    const ta = texts(x).filter((t) => t !== 'UNSURVEYED' && !/what gathering information is for/.test(t)), tb = texts(b).filter((t) => !/what gathering information is for/.test(t));
    const facade = /map-unsurveyed/.test(x) && !/map-unsurveyed/.test(b) && /Behind the walls is what gathering information is for/.test(b);
    if (facade && JSON.stringify(ta) === JSON.stringify(tb)) { out.push('facade'); return out; }
    return out.concat(['UNLISTED: the section changed beyond its unsurveyed rooms (texts ' + JSON.stringify([ta.length, tb.length]) + ')']);
  }
  if (opts.view === 'street' && opts.layer === 'player') {
    const ta = texts(x).filter((t) => !/\bp\.\s*\d+|page \d+/i.test(t)), tb = texts(b);
    if (JSON.stringify(ta) === JSON.stringify(tb)) { out.push('street-key'); return out; }
  }
  return out.concat(['UNLISTED: ' + opts.view + ' ' + (opts.layer || '') + ' changed']);
}

const OLD = refKit(), S = sites(), changed = {}, problems = [];
for (const [key, s, opts] of cases()) {
  const roll = typeof s === 'number' ? rolled(s) : S[s];
  const b = NEW.render(roll, opts).svg, h = sha(b);
  if (h === GOLD[key]) continue;
  const a = OLD.render(roll, opts).svg;
  if (sha(a) !== GOLD[key]) problems.push(key + ': kit 1.0.0 (' + REF + ') does not draw its 0.9 golden either');
  const r = why(a, b, opts);
  changed[key] = { sha: h, why: r };
  if (r.some((x) => /^UNLISTED/.test(x)) || !r.length) problems.push(key + ': ' + (r.join(', ') || 'UNLISTED: no reason found'));
}
const keys = Object.keys(changed);
console.log('map kit ' + NEW.VERSION + ' (sha256 ' + MAN.sha256.slice(0, 12) + '): ' + keys.length + ' of ' + cases().length + ' golden cases changed');
const tally = {}; for (const k of keys) { const t = changed[k].why.join('+'); tally[t] = (tally[t] || 0) + 1; }
for (const [t, n] of Object.entries(tally)) console.log('  ' + n + ' x ' + t);
for (const p of problems) console.log('FINDING ' + p);
const rec = { $comment: 'Written by node scripts/map-goldens.mjs --write. The cases this map kit draws differently from the 0.9 goldens (map-kit1-golden.json), each with its listed reason. map-kit1.test.mjs holds every other case to 0.9.',
  kit: { version: NEW.VERSION, sha256: MAN.sha256 }, reasons: ['heading', 'iso-cover', 'facade', 'street-key', 'key-walls'], changed };
if (process.argv.includes('--write')) {
  if (problems.length) { console.log('NOT WRITTEN: ' + problems.length + ' finding(s) above'); process.exit(1); }
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 1) + '\n');
  console.log('wrote ' + path.relative(ROOT, OUT));
  process.exit(0);
}
const cur = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const same = cur && cur.kit && cur.kit.sha256 === MAN.sha256 && JSON.stringify(cur.changed) === JSON.stringify(changed);
console.log(same ? 'the recorded file matches the vendored kit' : 'the recorded file does NOT match the vendored kit: run with --write once every change is listed');
process.exit(problems.length || !same ? 1 : 0);
