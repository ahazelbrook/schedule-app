// Static checks for the ambient scenes (AMBIENT-PLAN.md): every scene exists, none reaches off the origin, and
// app/_headers frames /ambient/* for the same origin only. Plain Node, no browser.
//   node checks/runtime/ambient-assets.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AMB = path.join(ROOT, 'app', 'ambient');
const SCENES = ['second-harvest.html', 'watch-feed.html', 'duskwall-after-dark.html', 'test-card.html', 'planning-board.html', 'score-exploded.html',
  'boneyard-dawn.html', 'undertow.html', 'bluetime.html', 'grunts-vet.html', 'night-tram.html', 'lurker-press.html', 'calling-cards.html',
  'pells-provisions.html', 'wanted-wall.html'];
// built on the GM's PC from the book's faction art and never committed (.gitignore): checked when present, skipped when not
const LOCAL_ONLY = ['calling-cards.html'];
const present = (f) => fs.existsSync(path.join(AMB, f));
for (const f of LOCAL_ONLY) if (!present(f)) console.log('SKIP ' + f + ' is not built here (node tools/ambient/scenes/cards.js)');
const HERE = SCENES.filter((f) => !LOCAL_ONLY.includes(f) || present(f));
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };

await test('the fifteen scenes exist and are not empty', () => {
  for (const f of HERE) {
    const p = path.join(AMB, f);
    ok(fs.existsSync(p), f + ' is missing');
    ok(fs.statSync(p).size > 1000, f + ' is empty');
    ok(/^\s*<!doctype html/i.test(fs.readFileSync(p, 'utf8').slice(0, 200)), f + ' does not start with a doctype');
  }
});

await test('no scene names an external http(s) address except the two XML namespaces', () => {
  const allowed = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);
  for (const f of HERE) {
    const text = fs.readFileSync(path.join(AMB, f), 'utf8');
    const hits = (text.match(/https?:\/\/[^\s"'<>)]*/gi) || []).filter((u) => !allowed.has(u.replace(/[;,.]+$/, '')));
    ok(hits.length === 0, f + ' references ' + hits.slice(0, 3).join(' | '));
  }
});

await test('app/_headers covers /ambient/* with X-Frame-Options and a same-origin CSP, and nothing else', () => {
  const p = path.join(ROOT, 'app', '_headers');
  ok(fs.existsSync(p), 'app/_headers is missing');
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
  const i = lines.findIndex((l) => l.trim() === '/ambient/*');
  ok(i === 0 && lines.every((l, k) => k === 0 || /^\s+\S/.test(l)), 'expected exactly one rule, for /ambient/*');
  const body = lines.slice(1).map((l) => l.trim());
  ok(body.includes('X-Frame-Options: SAMEORIGIN'), 'X-Frame-Options: SAMEORIGIN is missing');
  const csp = body.find((l) => /^Content-Security-Policy:/i.test(l)) || '';
  for (const d of ["frame-ancestors 'self'", "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", 'img-src data:', "font-src 'self' data:", "connect-src 'self'"]) {
    ok(csp.includes(d), 'CSP is missing ' + d);
  }
});

await test('every registry scene has its file, and its iframe URL has no .html (the asset server 307s it; a redirected response is never cached)', async () => {
  const { createRequire } = await import('node:module');
  const P = createRequire(import.meta.url)(path.join(ROOT, 'app', 'display-page.js')).Pure;
  ok(P.AMBIENT_SCENES.length === SCENES.length, SCENES.length + ' scenes');
  ok(P.AMBIENT_SCENES.every((s) => SCENES.includes(s.file)), 'every registry file is checked here');
  for (const s of P.AMBIENT_SCENES) {
    ok(LOCAL_ONLY.includes(s.file) || fs.existsSync(path.join(AMB, s.file)), s.id + ': app/ambient/' + s.file + ' is missing');
    const u = P.ambientUrl(s.id);
    ok(/^ambient\/[a-z-]+(\?api=off)?$/.test(u) && !/\.html/.test(u), s.id + ': ' + u);
    ok(u.split('?')[0] === 'ambient/' + s.file.replace(/\.html$/, ''), s.id + ': the URL names its file');
  }
});

await test('the scenes built by tools/ambient pause when hidden, keep the screen awake, load nothing, and take b68:crew only from their own origin', () => {
  for (const f of HERE.filter((x) => SCENES.indexOf(x) >= 6)) {
    const text = fs.readFileSync(path.join(AMB, f), 'utf8');
    ok(/visibilitychange/.test(text) && /wakeLock/.test(text), f + ': no pause-when-hidden or wake lock');
    ok(!/<script[^>]+src=/i.test(text) && !/<link[^>]+href=/i.test(text), f + ': loads a script or stylesheet');
  }
  const wall = fs.readFileSync(path.join(AMB, 'wanted-wall.html'), 'utf8');
  ok(/b68:crew/.test(wall) && wall.includes('if(e.origin!==location.origin)return;'), 'the wanted wall must check the origin of b68:crew');
});

console.log('\n' + (failed ? failed + ' failed' : 'all passed'));
process.exit(failed ? 1 : 0);
