// Static checks for the two score-scene shells (AMBIENT-PLAN.md, Architecture and Secrecy): they hold no campaign data, reach
// nothing off the origin, never turn a received string into markup, and only listen to their parent. Plain Node, no browser.
//   node checks/runtime/ambient-shells.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AMB = path.join(ROOT, 'app', 'ambient');
const FONTS = path.join(ROOT, 'app', 'fonts');
const SHELLS = ['planning-board.html', 'score-exploded.html'];
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
const read = (f) => fs.readFileSync(path.join(AMB, f), 'utf8');

await test('both shells exist, start with a doctype and are small (no baked data or fonts)', () => {
  for (const f of SHELLS) {
    const p = path.join(AMB, f);
    ok(fs.existsSync(p), f + ' is missing');
    const t = read(f);
    ok(/^\s*<!doctype html/i.test(t.slice(0, 200)), f + ' does not start with a doctype');
    ok(t.length < 30000, f + ' is ' + t.length + ' bytes: it should hold no campaign data');
    ok(!/base64,/i.test(t.replace(/data:image\\?\/png/g, '')) || !/font\/woff2;base64/.test(t), f + ' embeds a font');
  }
});

await test('titles', () => {
  ok(/<title>Planning board<\/title>/.test(read('planning-board.html')), 'planning-board title');
  ok(/<title>Score site<\/title>/.test(read('score-exploded.html')), 'score-exploded title');
});

await test('no external http(s) address except the XML namespace', () => {
  const allowed = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);
  for (const f of SHELLS) {
    const hits = (read(f).match(/https?:\/\/[^\s"'<>)]*/gi) || []).filter((u) => !allowed.has(u.replace(/[;,.]+$/, '')));
    ok(hits.length === 0, f + ' references ' + hits.slice(0, 3).join(' | '));
  }
});

await test('no network calls, no markup sinks, no dynamic code', () => {
  const banned = [
    /innerHTML/, /insertAdjacentHTML/, /outerHTML\s*=/, /document\.write/, /\beval\s*\(/, /new\s+Function/,
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /importScripts/, /<script[^>]*\ssrc=/i, /<link[^>]*\shref=/i, /@import/,
  ];
  for (const f of SHELLS) {
    const t = read(f);
    for (const re of banned) ok(!re.test(t), f + ' matches ' + re);
  }
});

await test('messages are accepted only from the parent on this origin, with the b68:score type', () => {
  for (const f of SHELLS) {
    const t = read(f);
    ok(t.includes('e.source === parent'), f + ' lacks the e.source === parent guard');
    ok(t.includes('e.origin === location.origin'), f + ' lacks the e.origin === location.origin guard');
    ok(t.includes("e.data.type === \"b68:score\""), f + ' lacks the b68:score type check');
    ok(/postMessage\(\{type:"b68:ready"\},location\.origin\)/.test(t), f + ' does not post b68:ready to location.origin');
    ok(t.includes('parent!==window'), f + ' does not skip the protocol when it is the top window');
    ok(!/postMessage\([^)]*["']\*["']\)/.test(t), f + ' posts to a wildcard origin');
  }
});

await test('received SVG goes through DOMParser and importNode; text goes in as textContent', () => {
  for (const f of SHELLS) {
    const t = read(f);
    ok(t.includes('new DOMParser()') && t.includes('image/svg+xml'), f + ' does not parse with DOMParser');
    ok(t.includes('parsererror'), f + ' does not reject parser errors');
    ok(t.includes('document.importNode'), f + ' does not importNode');
    ok(t.includes('textContent'), f + ' does not use textContent');
  }
});

await test('fonts are referenced by ../fonts/ URL and every file exists', () => {
  for (const f of SHELLS) {
    const t = read(f);
    const refs = [...t.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]).filter((u) => /\.woff2$/.test(u));
    ok(refs.length >= 4, f + ' has only ' + refs.length + ' font urls');
    for (const u of refs) {
      ok(u.startsWith('../fonts/'), f + ' font url ' + u + ' is not under ../fonts/');
      ok(fs.existsSync(path.join(FONTS, u.slice('../fonts/'.length))), f + ' font ' + u + ' is not in app/fonts');
    }
  }
});

await test('the inline script parses, and there is exactly one', () => {
  for (const f of SHELLS) {
    const scripts = [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)];
    ok(scripts.length === 1, f + ' has ' + scripts.length + ' inline scripts');
    new vm.Script(scripts[0][1], { filename: f });
  }
});

await test('stage, vignette and grain are present; expected per-scene values', () => {
  const p = read('planning-board.html'), s = read('score-exploded.html');
  for (const t of [p, s]) ok(/id="vig"/.test(t) && /id="grain"/.test(t) && /class="stage"/.test(t) && /visibilitychange/.test(t) && /wakeLock/.test(t));
  ok(/#grain\{[^}]*opacity:\.12/.test(p) && /rgba\(8,7,10,\.55\)/.test(p) && /background:#3a2a18/.test(p), 'planning-board grain/vignette/bg');
  ok(/#grain\{[^}]*opacity:\.1[;}]/.test(s) && /rgba\(8,7,10,\.6\)/.test(s) && /background:#1d4f9c/.test(s), 'score-exploded grain/vignette/bg');
});

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall ambient shell checks passed');
