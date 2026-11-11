// The ratchet (the kit and stage build, KS02.4). No browser, no network.
// Counts, per file under app/ (not app/checks), five things the kit replaces: a hand-built `<button`, an `!important`, an inline `style="`,
// a native confirm( and a native prompt(. The baseline is checks/runtime/kit-ratchet.baseline.json (today's counts). The check fails when any
// count rises anywhere (a file missing from the baseline counts as zero), and when a kit file (app/ui/**, or any file in a kit/ folder) has
// one at all. Later bundles may only lower the numbers. The counts are raw text, comments included, so a kit file does not even mention them.
// app/ui/ui.js is the one place that builds a button element: it writes the tag as '<' + tag, so it too counts zero.
//
//   node checks/runtime/kit-ratchet.test.mjs                  the check
//   node checks/runtime/kit-ratchet.test.mjs --write          rewrite the baseline from the tree, sorted, so the same tree always gives the
//                                                             same file. It refuses when a count would rise (lower numbers only)
//   node checks/runtime/kit-ratchet.test.mjs --write --allow-rise    the overseer's override, for a rise that was agreed
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const BASE = path.join(ROOT, 'checks', 'runtime', 'kit-ratchet.baseline.json');
const EXT = /\.(js|mjs|css|html)$/;

/* the five counts; native confirm/prompt: window., self., globalThis. or the app's W. alias, or a bare call (not a method, not a definition) */
export const KINDS = {
  button: /<button\b/g,
  important: /!\s*important\b/gi,
  style: /\bstyle=\\?["']/g,
  confirm: /(?:\b(?:window|self|globalThis|W)\.|(?<![\w$.]|function\s{1,4}))confirm\(/g,
  prompt: /(?:\b(?:window|self|globalThis|W)\.|(?<![\w$.]|function\s{1,4}))prompt\(/g
};
export function count(text) {
  const out = {};
  for (const k of Object.keys(KINDS)) { const n = (String(text).match(KINDS[k]) || []).length; if (n) out[k] = n; }
  return out;
}
export const isKit = (rel) => rel.startsWith('app/ui/') || /(^|\/)kit\//.test(rel);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p !== path.join(APP, 'checks')) walk(p, out); }
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}
/* every counted file: { 'app/x.js': { button: 3, ... } }, sorted by path, files at zero left out */
export function tree() {
  const out = {};
  walk(APP, []).map((p) => path.relative(ROOT, p).split(path.sep).join('/')).sort().forEach((rel) => {
    const c = count(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (Object.keys(c).length) out[rel] = c;
  });
  return out;
}
/* what is wrong with `now` against `base`: rises, and anything at all in a kit file */
export function judge(now, base) {
  const bad = [];
  for (const rel of Object.keys(now)) for (const k of Object.keys(now[rel])) {
    const was = (base[rel] && base[rel][k]) || 0, is = now[rel][k];
    if (isKit(rel)) bad.push(rel + ': ' + is + ' ' + k + ' in a kit file (a kit file has none)');
    else if (is > was) bad.push(rel + ': ' + k + ' rose from ' + was + ' to ' + is);
  }
  return bad;
}
function totals(t) {
  const s = {}; Object.values(t).forEach((c) => Object.keys(c).forEach((k) => { s[k] = (s[k] || 0) + c[k]; })); return s;
}
function write(t) {
  const body = { _note: 'Written by node checks/runtime/kit-ratchet.test.mjs --write. Counts may only go down.', totals: totals(t), files: t };
  fs.writeFileSync(BASE, JSON.stringify(body, null, 1) + '\n');
}

const args = process.argv.slice(2);
const now = tree();
if (args.includes('--write')) {
  const old = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')).files : null;
  const bad = old ? judge(now, old) : Object.keys(now).filter(isKit).map((r) => r + ': in a kit file');
  if (bad.length && !args.includes('--allow-rise')) { console.log('REFUSED (a count would rise):\n  ' + bad.join('\n  ')); process.exit(1); }
  write(now);
  console.log('wrote ' + path.relative(ROOT, BASE) + ': ' + JSON.stringify(totals(now)));
  process.exit(0);
}

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); }
}
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));

test('the counter: each kind, and what it leaves alone', () => {
  assert.deepEqual(count('h += \'<button class="x" style="a">\' + "<button>"; el.innerHTML = "<buttons>"'), { button: 2, style: 1 });
  assert.deepEqual(count('a { color: red !important; } b { x: y ! important }'), { important: 2 });
  assert.deepEqual(count('if (W.confirm("x")) W.prompt("y"); window.confirm(1); confirm(2); prompt(3)'), { confirm: 3, prompt: 2 });
  assert.deepEqual(count('ov.confirm({}); B68Ui.prompt(1); function confirm(o) {} askConfirm(); reprompt()'), {});
  assert.deepEqual(count("var t = '<' + tag; s.style.color = 'x'; el.setAttribute('style', '')"), {});
});

test('the ratchet fails when a test line adds a raw button to a kit file, or raises a count anywhere', () => {
  const b = { 'app/gm-page.js': { button: 2 } };
  assert.deepEqual(judge({ 'app/gm-page.js': { button: 2 } }, b), []);
  assert.deepEqual(judge({ 'app/gm-page.js': { button: 1 } }, b), [], 'lower is fine');
  assert.equal(judge({ 'app/gm-page.js': { button: 3 } }, b).length, 1, 'a rise fails');
  assert.equal(judge({ 'app/new-file.js': { confirm: 1 } }, b).length, 1, 'a new file starts at zero');
  const kitFile = count(fs.readFileSync(path.join(APP, 'ui', 'ui.js'), 'utf8') + "\nh += '<button>';");
  assert.equal(judge({ 'app/ui/ui.js': kitFile }, { 'app/ui/ui.js': kitFile }).length, 1, 'a kit file fails even when the baseline holds it');
  assert.equal(judge({ 'app/gm/kit/band.js': { style: 1 } }, {}).length, 1, 'a kit/ folder counts as kit');
  assert.ok(isKit('app/display/kit/stage.css') && isKit('app/sheet/kit/tabs.js') && isKit('app/ui/parts.css') && !isKit('app/gm/band.js'));
});

test('the baseline is the tree written by --write: sorted, every count from the script', () => {
  const files = Object.keys(base.files);
  assert.deepEqual(files, [...files].sort(), 'sorted by path');
  assert.deepEqual(base.totals, totals(base.files), 'the totals add up');
  assert.ok(!files.some(isKit), 'no kit file in the baseline');
  assert.ok(base.totals.button > 500 && base.totals.important > 50, 'today\'s counts: ' + JSON.stringify(base.totals));
});

test('no count has risen since the baseline, and every kit file is at zero', () => {
  const bad = judge(now, base.files);
  assert.equal(bad.length, 0, '\n  ' + bad.join('\n  '));
  const lower = Object.keys(base.files).filter((rel) => Object.keys(base.files[rel]).some((k) => ((now[rel] || {})[k] || 0) < base.files[rel][k]));
  if (lower.length) console.log('  (lower than the baseline in ' + lower.length + ' file(s): run with --write to lock the gain in)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
