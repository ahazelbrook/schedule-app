// ability-find (RK25 of the room key build: search on the phones, setting phone.find). No browser, no network.
// app/sheet/ability-find.js: the matching (pure), what start() and stop() add and take away (against a stand-in window), what box() and apply() do while not
// started (nothing), and the one-line seams in tracker.js, glance.js and boot.js. The rows hiding in a real page is checked by phone-glance.e2e.mjs (the "find" section).
//   node checks/runtime/ability-find.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { blankSheet, loadContent } from './fixtures/sheets/blank-sheet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/sheet/ability-find.js';
const SRC = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
function load(extra) {   /* the file as a plain script, in a window of its own */
  const win = Object.assign({}, extra || {}); win.self = win; win.window = win;
  vm.runInNewContext(SRC, win, { filename: FILE });
  return win;
}
const M = require(path.join(ROOT, FILE));
/* the abilities of an invented playbook: names and rule lines are made up here */
const ITEMS = [
  { n: 'Scrapper', t: 'You gain a bonus die when you fight at a disadvantage.' },
  { n: 'Dovetail Drift', t: 'When you slip a pursuer you may carry one friend along.' },
  { n: 'Ledger Eyes', t: 'You can read a room’s mood from its accounts.' },
  { n: 'Scout’s Honor', t: 'An ally you vouch for takes +1d on their first roll.' },
  { n: 'Éclat', t: 'A flourish that distracts everyone nearby.' }
];
const names = (r) => ITEMS.filter((_, i) => r.keep[i]).map((x) => x.n);

test('the module: under Node and as a plain script (window.B68AbilityFind), no stub left', () => {
  assert.deepEqual(Object.keys(M).sort(), ['apply', 'box', 'match', 'norm', 'start', 'state', 'stop', 'terms']);
  const w = load();
  assert.ok(w.B68AbilityFind && typeof w.B68AbilityFind.box === 'function' && !w.B68AbilityFind.stub);
});
test('norm: case, accents, apostrophes and punctuation are ignored', () => {
  assert.equal(M.norm('  Scout’s  Honor! '), 'scouts honor');
  assert.equal(M.norm('Éclat'), 'eclat');
  assert.equal(M.norm(null), '');
  assert.deepEqual(M.terms('  Dove  Tail '), ['dove', 'tail']);
  assert.deepEqual(M.terms('?!'), []);
});
test('match: three letters of a name find it, wherever in the name and in any case', () => {
  assert.deepEqual(names(M.match(ITEMS, 'dov')), ['Dovetail Drift']);
  assert.deepEqual(names(M.match(ITEMS, 'LEDG')), ['Ledger Eyes']);
  assert.deepEqual(names(M.match(ITEMS, 'tail')), ['Dovetail Drift']);
  assert.deepEqual(names(M.match(ITEMS, 'scouts')), ['Scout’s Honor']);
  assert.deepEqual(names(M.match(ITEMS, 'eclat')), ['Éclat']);
  assert.deepEqual(names(M.match(ITEMS, 'ecl')), ['Éclat']);
  const r = M.match(ITEMS, 'dov'); assert.equal(r.tier, 1); assert.equal(r.shown, 1); assert.equal(r.total, 5);
});
test('match: every word typed must be in the name (any order); an empty or punctuation-only query keeps everything', () => {
  assert.deepEqual(names(M.match(ITEMS, 'drift dove')), ['Dovetail Drift']);
  assert.equal(names(M.match(ITEMS, 'dove zzz')).length, 0);
  for (const q of ['', '   ', '?!', null, undefined]) { const r = M.match(ITEMS, q); assert.equal(r.tier, 0); assert.equal(r.shown, 5); assert.ok(r.keep.every(Boolean)); }
});
test('match: names first; the rule text only when no name has every word, and it says so (tier 2); nothing is tier 3', () => {
  assert.equal(M.match(ITEMS, 'scr').tier, 1, 'a name matches, so the text is not searched');
  assert.deepEqual(names(M.match(ITEMS, 'scr')), ['Scrapper']);
  const t = M.match(ITEMS, 'pursuer'); assert.equal(t.tier, 2); assert.deepEqual(names(t), ['Dovetail Drift']);
  const none = M.match(ITEMS, 'qqq'); assert.equal(none.tier, 3); assert.equal(none.shown, 0); assert.ok(none.keep.every((k) => !k));
  assert.deepEqual(M.match([], 'dov').keep, []);
  assert.equal(M.match(null, 'dov').total, 0);
});
test('match: an item with no name or text never throws', () => {
  assert.doesNotThrow(() => M.match([{}, null, { n: 'Ab', t: undefined }], 'ab'));
  assert.deepEqual(M.match([{}, null, { n: 'Ab' }], 'ab').keep, [false, false, true]);
});

test('not started (the setting is off): box() is empty, apply() does nothing, stop() does nothing, state is off', () => {
  const w = load({ B68Tracker: { refresh() { throw new Error('refresh with the setting off'); } } }), F = w.B68AbilityFind;
  assert.equal(F.box('abbox'), ''); assert.equal(F.box('strip'), ''); assert.equal(F.box('abs'), '');
  assert.equal(F.apply({ querySelectorAll() { throw new Error('read the page with the setting off'); } }), false);
  assert.equal(F.stop(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(F.state())), { on: false, q: {} });
});

/* a stand-in window: records what start() and stop() add and take away */
function fakeWin() {
  const log = { listeners: [], removed: [], styles: 0, refresh: 0, boxes: 3, off: 2 };
  const style = { id: '', textContent: '', parentNode: null };
  const document = {
    head: { appendChild(n) { log.styles++; n.parentNode = { removeChild() { n.parentNode = null; log.styles--; } }; } },
    createElement() { return style; },
    getElementById(id) { return style.parentNode && id === style.id ? style : null; },
    addEventListener(t) { log.listeners.push(t); },
    removeEventListener(t) { log.removed.push(t); },
    querySelectorAll(sel) {
      if (sel === '[data-abf-box]') return Array.from({ length: log.boxes }, () => ({ parentNode: { removeChild() { log.boxes--; } } }));
      if (sel === '[data-abf-off]') return Array.from({ length: log.off }, () => ({ removeAttribute(a) { if (a === 'data-abf-off') log.off--; } }));
      return [];
    }
  };
  return { win: load({ document, B68Tracker: { refresh() { log.refresh++; } } }), log, style };
}
test('start() adds one style and three listeners and redraws the sheet once; start() again does nothing', () => {
  const { win, log, style } = fakeWin(), F = win.B68AbilityFind;
  assert.equal(F.start(), null); assert.equal(F.start(), null);
  assert.deepEqual(log.listeners.slice().sort(), ['click', 'input', 'keydown']);
  assert.equal(log.styles, 1); assert.equal(style.id, 'b68-abf-css');
  assert.equal(log.refresh, 1);
  assert.equal(F.state().on, true);
  assert.match(F.box('abbox'), /data-abf-box="abbox"/);
  assert.equal(F.box('nope'), '');
});
test('stop() takes the listeners, the boxes, the hidden rows and the style away and redraws once', () => {
  const { win, log } = fakeWin(), F = win.B68AbilityFind;
  F.start(); log.refresh = 0;
  F.stop(); F.stop();
  assert.deepEqual(log.removed.slice().sort(), ['click', 'input', 'keydown']);
  assert.equal(log.boxes, 0, 'every box is taken out of the page'); assert.equal(log.off, 0, 'every hidden row is shown again');
  assert.equal(log.styles, 0, 'the style is gone');
  assert.equal(log.refresh, 1);
  assert.equal(F.box('abbox'), '');
});
test('box(): the markup keeps the hooks the sheet needs (a data-always input, a ds-new class for focus, a Clear that starts hidden), no query in it', () => {
  const { win } = fakeWin(), F = win.B68AbilityFind; F.start();
  for (const k of ['abbox', 'strip', 'abs', 'ed']) {
    const h = F.box(k);
    assert.match(h, new RegExp('data-abf-box="' + k + '"')); assert.match(h, /<input type="search"[^>]*data-always="1"/);
    assert.match(h, new RegExp('class="abf-in ds-newfind' + k + '"')); assert.match(h, /data-abf-clear="[a-z]+" data-always="1" hidden>Clear</);
    assert.match(h, /aria-label="Find an ability"/);
    assert.match(h, new RegExp('<button type="button" class="' + { abbox: 'btn sm', strip: 'btn sm', abs: 'gl-btn', ed: 'sp-btn' }[k] + ' abf-x"'), 'Clear wears the own button class of its sheet');
    assert.ok(!/ value=/.test(h), 'typing never changes the slot string the sheet compares');
  }
});

test('box(n): no box over a short list (under 4 rows) or an empty one; 4 and more draw it; no count draws it', () => {
  const { win } = fakeWin(), F = win.B68AbilityFind; F.start();
  for (const k of ['abbox', 'strip', 'abs', 'ed']) {
    assert.equal(F.box(k, 0), ''); assert.equal(F.box(k, 3), '');
    assert.match(F.box(k, 4), /data-abf-box/); assert.match(F.box(k, 40), /data-abf-box/); assert.match(F.box(k), /data-abf-box/);
  }
});

test('file: no request, no storage, no important flag, no Escape handling, nothing under 12 px, 44 px tap targets, no U+0080 to U+009F, no literal over 220 characters', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB/.test(code), 'no request, no storage');
  assert.ok(!/[\u0080-\u009f]/.test(SRC));
  assert.ok(!/!\s*important/.test(code));
  assert.ok(!/Escape|'Esc'/.test(code), 'Escape stays with the sheet and B68GmEsc');
  for (const m of code.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)) assert.ok(+m[1] >= 12, 'font-size ' + m[1]);
  assert.equal((code.match(/min-height: 44px/g) || []).length, 2, 'the input and Clear are 44 px tall');
  assert.ok(/#dossier \[data-abf-off\]\[data-abf-off\] \{ display: none; \}/.test(code), 'the hiding rule beats the sheet\'s own display rules');
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)+)'/g)) assert.ok(m[1].length <= 220, 'a string literal over 220 characters: ' + m[1].slice(0, 40));
});
test('seams: tracker.js meets it in three one-line branches, glance.js in two, each a no-op without the global', () => {
  const T = read('app/tracker.js').split('\n').filter((l) => /B68AbilityFind/.test(l));
  assert.equal(T.length, 3, 'tracker.js: three lines');
  assert.ok(T.some((l) => /^\s*h = \(window\.B68AbilityFind && !cur\.ui\.static \? window\.B68AbilityFind\.box\('abbox', list\.length \+ \(hull \? \(pb\.frame \|\| \[\]\)\.length : 0\)\) : ''\) \+ h;/.test(l)), 'the abilities box, counted');
  assert.ok(T.some((l) => /\(window\.B68AbilityFind \? window\.B68AbilityFind\.box\('strip', mine\.length \+ \(crew \? crew\.length : 0\)\) : ''\) \+ abGroup\('p'/.test(l)), 'the strip, counted');
  assert.ok(T.some((l) => /^\s*if \(window\.B68AbilityFind\) window\.B68AbilityFind\.apply\(cur\.root\);/.test(l)), 'after the render');
  const G = read('app/sheet/glance.js').split('\n').filter((l) => /B68AbilityFind/.test(l));
  assert.equal(G.length, 2, 'glance.js: two lines');
  assert.ok(G.some((l) => /case 'abs':.*body: W\.B68AbilityFind \? W\.B68AbilityFind\.box\('abs', st\.abs\.length\) : ''/.test(l)), 'the abilities sheet, counted');
  assert.ok(G.some((l) => /function tickIn\(scope\) \{ if \(W\.B68AbilityFind\) W\.B68AbilityFind\.apply\(scope, 'gl'\);/.test(l)), 'every sheet draw');
});
test('seams: page.js (the full sheet) meets it in three one-line branches, in the abilities editor and drawEd; a waived or failed region has no editor and draws nothing', () => {
  const src = read('app/sheet/page.js'), P = src.split('\n').filter((l) => /B68AbilityFind/.test(l));
  assert.equal(P.length, 3, 'page.js: three lines');
  assert.ok(P.some((l) => /^\s*body = W && W\.B68AbilityFind && !edNote\('abilities'\) \? W\.B68AbilityFind\.box\('ed', list\.length\) : '';/.test(l)));
  assert.equal(P.filter((l) => /W\.B68AbilityFind\.apply\(layer, 'pg'\)/.test(l)).length, 2, 'applied after the fresh draw and after the live redraw');
  const i = src.indexOf("case 'abilities': {"), j = src.indexOf("case 'friends'", i);
  assert.ok(i > 0 && src.slice(i, j).indexOf('B68AbilityFind') > 0, 'the box is built only in the abilities case');
  assert.ok(/var sp = editor\(cur\.ed\.region, cur\.ch, CTnow\(\)\); if \(!sp\) \{ cur\.ed = null;/.test(src), 'drawEd draws nothing without an editor (the guard is RK32 and untouched)');
});
test('seams: boot.js asks for the bundle only while phone.find is on (the between list, a player only) and stop()s it when it goes off', () => {
  const boot = read('app/boot.js');
  assert.ok(/\['phone\.find', 'phone-find', 'B68AbilityFind'\]/.test(boot));
  assert.ok(/else if \(window\[x\[2\]\]\) window\[x\[2\]\]\.stop\(\);/.test(boot));
});

/* ---- RK32's full sheet with phone.find on and off: a region it does not draw gets no box; off, the editor is RK32's markup ---- */
const PAGE_SRC = read('app/sheet/page.js'), CTX = loadContent(path.join(ROOT, 'app', 'content.js')), PAGE = require(path.join(ROOT, 'app/sheet/page.js')).Pure;
const SENTINEL = '<!--ABF-BOX-->', NOTE = 'This part of the sheet isn’t mapped: use the glance screen', hound = CTX.byId.hound;
/* page.js in a stand-in window whose elements keep what is written to them; find: a stand-in B68AbilityFind, or none */
function pageWin(map, find) {
  function el() {
    return { style: {}, attrs: {}, children: [], innerHTML: '', isConnected: true, clientWidth: 390, clientHeight: 600, offsetWidth: 0, scrollLeft: 0, scrollTop: 0, hidden: false, _q: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, removeChild() {},
      querySelector(sel) { return this._q[sel] || (this._q[sel] = el()); }, querySelectorAll() { return []; }, addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0 }; }, focus() {} };
  }
  const win = { innerWidth: 390, innerHeight: 664, setTimeout, clearTimeout, Promise, B68Content: CTX, document: { createElement: el, createElementNS: el, activeElement: null } };
  win.self = win; win.window = win;
  win.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(map))) });
  win.Image = function () { const img = { setAttribute() {}, parentNode: null }; Object.defineProperty(img, 'src', { set() { setTimeout(() => img.onload(), 0); }, get() { return ''; } }); return img; };
  if (find) win.B68AbilityFind = find;
  vm.runInNewContext(PAGE_SRC, win, { filename: 'app/sheet/page.js' });
  return { win, box: el() };
}
const nellCh = () => ({ doc: { name: 'Nell Arbuthnot', playbook: 'hound' }, play: { stress: 2, abilities: ['Fixer'] }, pb: hound, own: [] });
/* opens the full sheet on the abilities editor (the focus the glance's "All your abilities" row gives) and returns the editor's html */
async function editorHtml(map, withFind) {
  const calls = { box: [], apply: [] }, find = withFind ? { box(k, n) { calls.box.push([k, n]); return SENTINEL; }, apply(r, kind) { calls.apply.push(kind); return true; } } : null;
  const w = pageWin(map, find), P = w.win.B68SheetPage;
  assert.equal(P.open(w.box, nellCh(), { focus: 'ds-abbox', fallback() { throw new Error('fell back'); }, close() {}, record() {}, commit() {}, play() { return null; } }), true);
  for (let i = 0; i < 40 && !(P.state() && P.state().editor); i++) await new Promise((r) => setTimeout(r, 15));
  assert.equal(P.state().editor, 'abilities', 'the abilities editor is open');
  return { calls, html: w.box.children[0]._q['.sp-layer'].innerHTML };
}
const pending = [];
function atest(name, fn) { pending.push(fn().then(() => { passed++; console.log('PASS ' + name); }, (e) => { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); })); }
atest('full sheet, phone.find ON: a healthy abilities region gets the box; a waived region and a wrong-count region draw no box and show the note (and RK32 draws no ability mark there)', async () => {
  const ok = await editorHtml(blankSheet(CTX, 'hound').map, true);
  assert.ok(ok.html.includes(SENTINEL), 'the box is in the editor'); assert.ok(!ok.html.includes(NOTE)); assert.ok(ok.calls.box.length > 0 && ok.calls.box.every((c) => c[0] === 'ed' && c[1] === hound.abilities.length), 'asked with the playbook\'s row count'); assert.ok(ok.calls.apply.includes('pg'));
  const waived = await editorHtml(blankSheet(CTX, 'hound', { waived: ['abilities'] }).map, true);
  assert.ok(!waived.html.includes(SENTINEL), 'a waived region: no box'); assert.ok(waived.html.includes(NOTE), 'the note shows'); assert.deepEqual(waived.calls.box, [], 'box() is not even asked');
  const m = blankSheet(CTX, 'hound').map; m.ab.pop();
  const bad = await editorHtml(m, true);
  assert.ok(!bad.html.includes(SENTINEL), 'a wrong count: no box'); assert.ok(bad.html.includes(NOTE), 'the note shows'); assert.deepEqual(bad.calls.box, []);
  for (const mp of [m, blankSheet(CTX, 'hound', { waived: ['abilities'] }).map]) {
    const g = PAGE.guards(mp, CTX, hound); assert.equal(g.ab.ok, false, 'RK32 itself fails that region');
    assert.equal((PAGE.marks(mp, { play: { abilities: ['Fixer'] }, pb: hound, doc: {} }, g, CTX).match(/class="sp-pen"/g) || []).length, 0, 'so it draws no ability mark');
  }
});
atest('full sheet, phone.find OFF (no B68AbilityFind): the abilities editor is exactly RK32\'s, with no box and no extra node, healthy or waived', async () => {
  for (const o of [undefined, { waived: ['abilities'] }]) {
    const on = await editorHtml(blankSheet(CTX, 'hound', o).map, true), off = await editorHtml(blankSheet(CTX, 'hound', o).map, false);
    assert.ok(!off.html.includes(SENTINEL) && !/abf/.test(off.html), 'no box, no abf node');
    assert.equal(off.html.includes(NOTE), !!o, 'the note only where RK32 puts it');
    assert.equal(off.html, on.html.split(SENTINEL).join(''), 'byte for byte RK32\'s markup: the box is the only difference');
    assert.ok(off.html.includes('<div class="sp-static"></div>'), 'the static part is empty, as RK32 draws it');
  }
});

await Promise.all(pending);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
