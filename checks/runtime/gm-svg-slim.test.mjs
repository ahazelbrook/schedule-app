// gm-svg-slim (RK28.4, setting map.fit): app/gm/svg-slim.js, a smaller svg for the iPad. No browser, no network (the pixel check is behind SLIM_PIXELS=1).
//   - It strips nothing a reader sees: the visible text, every text node, the hidden-name scan (leaks()), every id, class and data-* attribute, every
//     scale() and the element order are identical before and after, on the real kits' svgs.
//   - It cuts only what it should: whitespace between tags (not inside <text>), a path's separators and zeros, float noise; one decimal only in a plain
//     drawing space (never inside a scale above 1.5, defs, clipPath, mask, pattern, filter or a gradient).
//   - checkSvg (the server's gate) passes the slimmed svg; slim is idempotent and fast.
//   - It saves on the invented palazzo: the numbers are printed. The ticket asked for 4% on a whole map and 8% on a room cut; that took dropping data-*,
//     ids and classes (the diagnosis' own third lever), which the ticket rules out, so the bars here are what the rest of it delivers.
//   - SLIM_PIXELS=1 (with PW_MODULE and PW_CHANNEL): the slimmed svg draws within 0.5% of the pixels of the original, in Chromium.
// INVENTED data only: the Palazzo Rooms (fixtures/gm/palazzo-kit1.json), the Dovetail Crew.
//   node checks/runtime/gm-svg-slim.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checkSvg } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/svg-slim.js';
const S = require(path.join(ROOT, FILE));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const slim = S.slim;

test('the module loads under Node and as a plain script (window.B68GmSvgSlim), and is no longer a stub', () => {
  assert.ok(S && typeof S === 'object'); assert.ok(!S.stub); assert.equal(typeof S.slim, 'function');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  assert.equal(typeof win.B68GmSvgSlim.slim, 'function');
});

/* ---------- the pieces ---------- */
test('numbers: no trailing zero, no leading zero, no -0, float noise to four decimals; a place count rounds; Infinity only tidies', () => {
  const n = S.num;
  assert.equal(n('257.20', null), '257.2'); assert.equal(n('0.5', null), '.5'); assert.equal(n('-0.5', null), '-.5'); assert.equal(n('3.000', null), '3'); assert.equal(n('0', null), '0');
  assert.equal(n('-0', null), '0'); assert.equal(n('-0.04', 1), '0'); assert.equal(n('1.6199999999999999', null), '1.62'); assert.equal(n('0.86603', null), '.866');
  assert.equal(n('0.86603', Infinity), '.86603', 'Infinity: only the zeros go, never a digit'); assert.equal(n('12.34', 1), '12.3'); assert.equal(n('12.35', 1), '12.4'); assert.equal(n('-12.34', 1), '-12.3');
  assert.equal(n('7', 1), '7'); assert.equal(n('100', 1), '100'); assert.equal(n('10.0', 1), '10'); assert.equal(n('1e-7', 1), '1e-7', 'not a plain number: as it was');
});
test('a path: separators and zeros go, every command and number stays; an unknown character leaves it exactly as it was', () => {
  assert.equal(S.path('M 1 2 L 3 -4 Z', null), 'M1 2L3-4Z');
  assert.equal(S.path('M-23.5 16.7 -22.7 16.6Z', null), 'M-23.5 16.7-22.7 16.6Z');
  assert.equal(S.path('M2.88 -2.16 A1.6199999999999999 1.6199999999999999 0 0 1 6.12 -10.98', null), 'M2.88-2.16A1.62 1.62 0 0 1 6.12-10.98', 'arc flags stay separate numbers');
  assert.equal(S.path('M0.5,0.25 L .5 .5', null), 'M.5 .25L.5 .5');
  assert.equal(S.path('M1 2 3 4', null), 'M1 2 3 4', 'implicit lineto: the numbers stay in order');
  assert.equal(S.path('M1.23 4.56', 1), 'M1.2 4.6'); assert.equal(S.path('M1.23 4.56', null), 'M1.23 4.56');
  assert.equal(S.path('M1 2 X 3', null), null); assert.equal(S.path('M1 2 # 3', null), null);
  assert.equal(S.path('M1e-3 2', null), 'M1e-3 2', 'an exponent is left alone');
  assert.equal(S.points('1.50,2.0  3 -4.25', 1), '1.5 2 3 -4.3'); assert.equal(S.points('1 2 x', null), null);
});
test('the scale of a transform: scale(), scale(x y) the larger, matrix() the root of its determinant, anything else 1; a bad number means "do not round"', () => {
  assert.equal(S.scaleOf('translate(5 6)'), 1); assert.equal(S.scaleOf('scale(40.1061)'), 40.1061); assert.equal(S.scaleOf('translate(1 2) scale(2 3)'), 3);
  assert.ok(Math.abs(S.scaleOf('matrix(0.86603 0.5 -0.86603 0.5 36.228 122.200)') - Math.sqrt(0.86603)) < 1e-9);
  assert.equal(S.scaleOf('rotate(8) scale(0.5)'), 0.5); assert.equal(S.scaleOf('scale(NaN)'), Infinity); assert.equal(S.scaleOf('matrix(1 2 3)'), Infinity);
});

/* ---------- what it does to a small svg ---------- */
const SMALL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000.00 749.63" width="1366" height="1024">\n' +
  '  <title id="t1">  The Palazzo Rooms: player handout </title>\n  <desc id="d1">Room with 3.50 stairs</desc>\n' +
  '  <defs>\n    <linearGradient id="g1" x1="0.25" y1="0" x2="0.75" y2="1"><stop offset="0.50" stop-color="#14110e"/></linearGradient>\n    <clipPath id="c1"><path d="M 1.23 4.56 L 7.89 0.12 Z"/></clipPath>\n  </defs>\n  <clipPath id="c2"><path d="M 1.23 4.56 L 7.89 0.12 Z"/></clipPath>\n' +
  '  <g class="furniture b68-room" data-room="Showroom" data-part="p-1" id="room-showroom" transform="translate(14.92 174.07) scale(2.8202)">\n    <path d="M 1.23 4.56 L 7.89 0.12 Z" fill="#14110e" stroke-width="0.50"/>\n  </g>\n' +
  '  <g transform="translate(10.26 20.34) rotate(8)">\n    <path d="M -3.456 0.45 L 7.1 8.04 Z" fill="#14110e"/>\n    <rect x="12.50" y="3.00" width="4.0" height="0.50" opacity="0.50"/>\n    <polygon points="0.55,1.25 3.10,4.99 -2.05,0.10"/>\n  </g>\n' +
  '  <text x="10.50" y="20.00"><tspan>Cocktail</tspan> <tspan>lounge</tspan>   1.50 m</text>\n  <!-- 0.50 keep -->\n</svg>\n';
test('on a small svg: whitespace between tags, zeros and separators go; one decimal only in a plain drawing space; the rest is left as drawn', () => {
  const o = slim(SMALL);
  const outside = o.replace(/<text[\s\S]*?<\/text>/, '').replace(/<title[\s\S]*?<\/title>/, '').replace(/<desc[\s\S]*?<\/desc>/, '');
  assert.ok(!/>\s+</.test(outside), 'no whitespace between tags outside the text');
  assert.ok(o.includes('<path d="M1.23 4.56L7.89 .12Z" fill="#14110e" stroke-width=".5"/>'), 'inside scale(2.8202), above 1.5: the path keeps its digits (zeros and separators go); stroke-width only loses its zero');
  assert.ok(o.includes('<path d="M-3.5 .5L7.1 8Z" fill="#14110e"/>'), 'in a plain space: one decimal');
  assert.ok(o.includes('transform="translate(14.9 174.1) scale(2.8202)"'), 'a translate in the parent\'s plain space: one decimal; the scale() as it was');
  assert.ok(o.includes('transform="translate(10.3 20.3) rotate(8)"'), 'rotate() as it was');
  assert.equal(o.split('<path d="M1.23 4.56L7.89 .12Z"/></clipPath>').length - 1, 2, 'a clipPath, in the defs or not: tidied, never rounded');
  assert.ok(o.includes('x1=".25"') && o.includes('x2=".75"') && o.includes('offset="0.50"'), 'a gradient: the same values (a leading zero goes, never a digit); its offset as it was');
  assert.ok(o.includes('<rect x="12.5" y="3" width="4" height=".5" opacity=".5"/>'), 'plain numeric attributes lose their zeros');
  assert.ok(o.includes('<polygon points=".6 1.3 3.1 5 -2.1 .1"/>'), o.match(/<polygon[^>]*>/)[0]);
  assert.ok(o.includes('<text x="10.5" y="20"><tspan>Cocktail</tspan> <tspan>lounge</tspan>   1.50 m</text>'), 'a text keeps every character and space of its content (its x and y lose only their zeros)');
  assert.ok(o.includes('<title id="t1">  The Palazzo Rooms: player handout </title>') && o.includes('<desc id="d1">Room with 3.50 stairs</desc>'));
  assert.ok(o.includes('<!-- 0.50 keep -->'), 'a comment stays');
  assert.ok(o.includes('class="furniture b68-room" data-room="Showroom" data-part="p-1" id="room-showroom"'));
  assert.ok(o.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000.00 749.63" width="1366" height="1024">'), 'the root tag, untouched');
  assert.equal(slim(o), o, 'idempotent');
});
test('junk in: the same out (not a string, no tags, a path it cannot read, a tag left open)', () => {
  for (const x of [null, undefined, 5, '', 'plain text', '<svg><path d="M1 2 Q"/></svg>'.replace('Q', 'X')]) assert.equal(slim(x), x);
  assert.equal(slim('<svg><g><path d="M 1.50 2"/>'), '<svg><g><path d="M1.5 2"/>', 'an unclosed tag: what it can tidy, nothing lost');
  assert.equal(slim('<svg><path d="M 1.50 X 2"/></svg>'), '<svg><path d="M 1.50 X 2"/></svg>');
});

/* ---------- on the real kits' svgs: nothing a reader sees changes ---------- */
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
const PALAZZO = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'palazzo-kit1.json'), 'utf8'));
let REAL = null;
try {
  const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js')), FK = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  if (typeof FK.mini === 'function' && typeof FK.extra === 'function') REAL = { K, FK, roll: P.authoredRoll(L, FIXL, PALAZZO) };
} catch (e) { REAL = null; }
const ALL = G.flags(() => true), BANDS = ['public', 'working', 'controlled', 'secure'];
function draws() {      /* what the page draws for the iPad (player layer) and for the GM (every name in it): the whole map, a room cut, flat and shaded */
  const { K, FK, roll } = REAL, roles = ['docker', 'sailor', 'warehouse-hand'], names = ['Nell Arbuthnot', 'Ray Okonjo', 'Tam Petrakis'], out = [];
  const pcs = names.map((n, i) => ({ id: 'pc' + (i + 1), name: n, spec: FK.extra({ role: roles[i], seed: 's20' }) })), crew = { pc1: { room: 'Cocktail lounge' }, pc2: { room: 'Cocktail lounge' }, pc3: { room: 'Showroom' } };
  const scene = (extra) => Object.assign({ flags: ALL, pcs, crew, disguises: [], crowd: true, lights: { 'Cocktail lounge': 'bright' }, screen: 'ipad', stage: true, view: '', room: '', kit: FK, images: {} }, extra || {});
  const k1 = P.kit1On, sh = P.shadeOn; P.kit1On = () => true; P.sceneMod = G;
  try {
    for (const shade of [false, true]) {
      P.shadeOn = () => shade;
      for (const [label, reveal, sc] of [['whole map', BANDS, scene()], ['public', ['public'], scene()], ['room cut', ['public'], scene({ view: 'room', room: 'Cocktail lounge' })]]) {
        const d = P.playerDisplay(roll, { layer: 'player', view: 'iso', theme: 'rulebook', reveal: Object.fromEntries(reveal.map((b) => [b, true])), open: [], know: [] }, (r, o) => K.render(r, o), { tokens: [], hide: [], sig: '', scene: sc });
        out.push({ label: label + (shade ? ' (depth)' : ''), svg: d.svg, reveal: d.reveal });
      }
    }
    out.push({ label: 'GM layer', svg: K.render(roll, { layer: 'gm', view: 'iso', theme: 'rulebook', layout: 'ipad', kit1: true }).svg, reveal: ['public'], gm: true });
  } finally { P.kit1On = k1; P.shadeOn = sh; }
  return out;
}
const attrs = (svg, re) => (svg.match(re) || []);
const R = REAL ? draws() : [];
test('the real palazzo, six player copies and the GM copy: the visible text, every text node and the hidden-name scan are identical before and after', () => {
  if (!REAL) { console.log('  (skipped: the vendored kits are not here)'); return; }
  assert.ok(R.length >= 7);
  for (const x of R) {
    const s = slim(x.svg);
    assert.equal(P.svgText(s), P.svgText(x.svg), x.label + ': the visible text');
    assert.deepEqual(attrs(s, />[^<>]*[^<>\s][^<>]*</g), attrs(x.svg, />[^<>]*[^<>\s][^<>]*</g), x.label + ': every text node (and its spaces)');
    assert.deepEqual(P.svgHays(s).map((h) => h.length > 0), P.svgHays(x.svg).map((h) => h.length > 0));
    assert.deepEqual(P.leaks(s, ROLL_OF(), x.reveal), P.leaks(x.svg, ROLL_OF(), x.reveal), x.label + ': leaks()');
  }
  const gm = R.find((x) => x.gm), before = P.leaks(gm.svg, REAL.roll, ['public']);
  assert.ok(before.length > 0, 'the GM copy names hidden rooms, so this compares something: ' + before.join(', '));
  assert.deepEqual(P.leaks(slim(gm.svg), REAL.roll, ['public']), before, 'the same hidden names are found in the slimmed GM copy');
});
function ROLL_OF() { return REAL.roll; }
test('the real palazzo: every id, class and data-* attribute, every scale(), every element, in the same order; the root tag is byte for byte', () => {
  if (!REAL) return;
  for (const x of R) {
    const s = slim(x.svg);
    for (const re of [/\sid="[^"]*"/g, /\sclass="[^"]*"/g, /\sdata-[\w-]+="[^"]*"/g, /scale\([^)]*\)/g, /\s(?:href|xlink:href|clip-path|mask|filter|fill|stroke)="[^"]*"/g, /<\/?[A-Za-z][\w:.-]*/g])
      assert.deepEqual(attrs(s, re), attrs(x.svg, re), x.label + ' ' + re);
    assert.equal(s.slice(0, s.indexOf('>') + 1), x.svg.slice(0, x.svg.indexOf('>') + 1), x.label + ': the root tag');
    for (const m of x.svg.matchAll(/data-room="([^"]*)"/g)) assert.ok(s.includes('data-room="' + m[1] + '"'));
  }
});
test('the real palazzo: matrix() keeps its four scale numbers to the last digit; a rotate() is as it was', () => {
  if (!REAL) return;
  const nums = (svg) => attrs(svg, /matrix\([^)]*\)/g).map((m) => m.slice(7, -1).trim().split(/[\s,]+/).slice(0, 4).map(Number));
  for (const x of R) assert.deepEqual(nums(slim(x.svg)), nums(x.svg), x.label); assert.ok(R.some((x) => nums(x.svg).length > 0), 'the fixture has matrices');
  for (const x of R) assert.deepEqual(attrs(slim(x.svg), /rotate\([^)]*\)/g), attrs(x.svg, /rotate\([^)]*\)/g), x.label);
});
test('the server\'s checkSvg passes every slimmed svg (and its size is under what it was); slim is idempotent', () => {
  if (!REAL) return;
  for (const x of R) { const s = slim(x.svg); assert.equal(checkSvg(s), s.trimStart(), x.label); assert.ok(Buffer.byteLength(s) < Buffer.byteLength(x.svg), x.label); assert.equal(slim(s), s, x.label + ': idempotent'); }
});
test('it is fast (a 550 KiB room cut in well under 150 ms, once the engine is warm)', () => {
  if (!REAL) return;
  const big = R.reduce((a, b) => (b.svg.length > a.svg.length ? b : a)); slim(big.svg);
  const t0 = process.hrtime.bigint(); slim(big.svg); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 150, ms.toFixed(0) + ' ms for ' + Math.round(big.svg.length / 1024) + ' KiB');
});
test('what it saves on the invented palazzo (whole map, room cut, with the depth)', () => {
  if (!REAL) return;
  const pct = (x) => 100 * (1 - Buffer.byteLength(slim(x.svg)) / Buffer.byteLength(x.svg)), whole = R.find((x) => x.label === 'whole map (depth)'), room = R.find((x) => x.label === 'room cut (depth)');
  console.log('  whole map: ' + Math.round(whole.svg.length / 1024) + ' -> ' + Math.round(slim(whole.svg).length / 1024) + ' KiB (-' + pct(whole).toFixed(1) + '%); room cut: ' + Math.round(room.svg.length / 1024) + ' -> ' + Math.round(slim(room.svg).length / 1024) + ' KiB (-' + pct(room).toFixed(1) + '%)');
  assert.ok(pct(whole) >= 1.8, 'whole map ' + pct(whole).toFixed(1) + '%'); assert.ok(pct(room) >= 6.5, 'room cut ' + pct(room).toFixed(1) + '%');
});

/* ---------- the pixels (a browser: SLIM_PIXELS=1) ---------- */
if (process.env.SLIM_PIXELS === '1') {
  const pwPath = process.env.PW_MODULE || 'C:/Users/ahaze/Documents/b68-wt/_kits/node_modules/playwright-core';
  const { chromium } = require(pwPath);
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0">');
    for (const x of R) {
      const r = await page.evaluate(async ([a, b]) => {
        const load = (svg) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('svg did not load')); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
        const [ia, ib] = await Promise.all([load(a), load(b)]), w = 1366, h = 1024, grab = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
        const A = grab(ia), B = grab(ib); let diff = 0, drawn = 0;
        for (let i = 0; i < A.length; i += 4) { if (A[i] !== 255 || A[i + 1] !== 255 || A[i + 2] !== 255) drawn++; if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 24) diff++; }
        return { diff, total: w * h, drawn };
      }, [x.svg, slim(x.svg)]);
      const pct = 100 * r.diff / r.total;
      console.log('  pixels ' + x.label + ': ' + r.diff + ' of ' + r.total + ' differ (' + pct.toFixed(3) + '%), ' + Math.round(100 * r.drawn / r.total) + '% drawn');
      test('pixels: ' + x.label + ' draws within 0.5% of the original (a channel differs by more than 24)', () => { assert.ok(r.drawn > r.total * 0.05, 'something is drawn'); assert.ok(pct <= 0.5, pct.toFixed(3) + '%'); });
    }
  } finally { await browser.close(); }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
