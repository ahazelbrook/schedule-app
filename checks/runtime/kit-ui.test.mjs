// The UI kit (the kit and stage build, KS02): app/ui/tokens.css, app/ui/parts.css, app/ui/ui.js (B68Ui) and app/ui/parts.json. No browser, no network.
// B68Ui returns escaped markup (a label of <img onerror> comes out as text, in every part and every attribute); the hooks (id, the old classes,
// data-*, the allowed attributes) pass through untouched and nothing else gets in; node() builds the same thing as DOM nodes with no markup sink;
// parts.json and B68Ui.PARTS are the same manifest, and every part in it has look book fixtures that draw. Then the sheets: no !important, no @layer,
// nothing outside :root[data-kit~=...] or a ui- class, no mangled punctuation, every colour one the app already has, every token the ticket names.
//   node checks/runtime/kit-ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
const U = require(path.join(APP, 'ui', 'ui.js'));
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
const UI_SRC = read('ui/ui.js');
const TOKENS = read('ui/tokens.css');
const PARTS_CSS = read('ui/parts.css');

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* B68Ui reports a dropped hook with console.warn (once per distinct value): collect them here, so the run stays quiet and a test can read them */
const warnings = [];
console.warn = (...a) => { warnings.push(a.join(' ')); };

const EVIL = '<img src=x onerror=alert(1)>';
const FNS = ['button', 'seg', 'tabs', 'chip', 'card', 'row', 'field', 'meter', 'key', 'dot', 'link', 'menu'];

/* a tiny document: elements with ordered attributes and children, and a serialiser in the same form as the helper's markup */
const VOID = new Set(['input']);
const escT = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function fakeDoc() {
  const sinks = [];
  function node(tag, ns) {
    const n = { nodeType: 1, tag, ns: ns || '', attrs: [], children: [], _text: null,
      setAttribute(k, v) { const i = this.attrs.findIndex((a) => a[0] === k); if (i >= 0) this.attrs.splice(i, 1); this.attrs.push([k, String(v)]); },
      getAttribute(k) { const a = this.attrs.find((x) => x[0] === k); return a ? a[1] : null; },
      appendChild(c) { this.children.push(c); return c; },
      set innerHTML(v) { sinks.push(v); },
      set textContent(v) { this.children = [{ nodeType: 3, data: String(v) }]; },
      get textContent() { return this.children.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); },
      querySelector(sel) {
        const m = /^\[data-ui-slot="([^"]+)"\]$/.exec(sel); if (!m) throw new Error('unexpected selector ' + sel);
        const walk = (e) => { for (const c of e.children) { if (c.nodeType !== 1) continue; if (c.getAttribute('data-ui-slot') === m[1]) return c; const f = walk(c); if (f) return f; } return null; };
        return walk(this);
      } };
    return n;
  }
  return { sinks,
    createElement: (t) => node(t), createElementNS: (ns, t) => node(t, ns), createTextNode: (d) => ({ nodeType: 3, data: String(d) }) };
}
function serial(n) {
  if (n.nodeType === 3) return escT(n.data);
  const BOOL = new Set(['hidden', 'disabled', 'selected', 'required', 'checked', 'download']);
  let s = '<' + n.tag;
  for (const [k, v] of n.attrs) s += v === '' && BOOL.has(k) ? ' ' + k : ' ' + k + '="' + escT(v) + '"';
  s += '>';
  if (VOID.has(n.tag)) return s;
  return s + n.children.map(serial).join('') + '</' + n.tag + '>';
}
/* every attribute name in a markup string */
function attrNames(html) { return [...html.matchAll(/\s([a-zA-Z][\w:.-]*)(?==|[\s>])/g)].map((m) => m[1]); }

/* ---------- the helper ---------- */
test('B68Ui exports the twelve parts, part, node, fill, esc, wireTabs, guardBusy and the manifest', () => {
  for (const f of FNS) assert.equal(typeof U[f], 'function', f);
  for (const f of ['part', 'node', 'fill', 'esc', 'wireTabs', 'guardBusy']) assert.equal(typeof U[f], 'function', f);
  assert.deepEqual(U.FNS, FNS);
  assert.equal(typeof U.PARTS, 'object');
});

test('the contract block at the top of ui.js names every part', () => {
  const head = UI_SRC.slice(0, UI_SRC.indexOf('(function'));
  for (const f of FNS.concat(['part', 'node', 'fill', 'esc', 'PARTS', 'wireTabs', 'guardBusy'])) assert.ok(head.includes('B68Ui.' + f), 'B68Ui.' + f + ' in the contract');
});

test('a label of <img onerror> comes out as text, in every part and every text option', () => {
  const opts = { label: EVIL, sub: EVIL, meta: EVIL, body: EVIL, hint: EVIL, placeholder: EVIL, value: EVIL, title: EVIL, key: EVIL,
    items: [{ label: EVIL, value: EVIL }], options: [{ value: EVIL, label: EVIL }], action: { label: EVIL }, more: [{ label: EVIL }],
    actions: [{ label: EVIL }], kids: [{ part: 'chip', label: EVIL }], lead: EVIL, show: true };
  for (const f of FNS) {
    const html = U[f](opts);
    assert.ok(!/<img/i.test(html), f + ' let a tag through: ' + html);
    const tags = (html.match(/<[a-z][^>]*>/gi) || []).map((t) => t.replace(/"[^"]*"/g, '""'));
    assert.ok(!tags.some((t) => /\sonerror\b/i.test(t)), f + ' made an onerror attribute: ' + html);
    if (f !== 'meter') assert.ok(html.includes('&lt;img'), f + ' kept the label as text: ' + html);
  }
  assert.equal(U.esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(U.button(EVIL), '<button type="button" class="ui-btn ui-btn--standard">&lt;img src=x onerror=alert(1)&gt;</button>');
});

test('attribute values are escaped; a bad id, class, data key or attribute is dropped', () => {
  const html = U.button({ label: 'Go', id: 'a"b', title: 't"x', cls: 'gm-ok x"y', data: { place: 'run"x', 'Bad Key': 'z', 'x onclick': 'q', '"q': 1 },
    attrs: { onclick: 'evil()', style: 'color:red', href: 'javascript:x', 'class': 'no', id: 'no', type: 'submit', 'aria-label': 'Say "go"' } });
  assert.ok(!html.includes('id='), 'an id with a quote is dropped: ' + html);
  assert.ok(html.includes('title="t&quot;x"'));
  assert.ok(html.includes('class="ui-btn ui-btn--standard gm-ok"'), 'a class with a quote is dropped, the good one kept: ' + html);
  assert.ok(html.includes('data-place="run&quot;x"'));
  assert.ok(html.includes('aria-label="Say &quot;go&quot;"'));
  for (const bad of ['onclick', 'style', 'href', 'data-bad', 'data-x']) assert.ok(!attrNames(html).some((n) => n.toLowerCase().startsWith(bad)), bad + ' got in: ' + html);
  assert.ok(html.startsWith('<button type="button" '), 'attrs cannot change the type: ' + html);
  assert.equal(attrNames(html).filter((n) => n === 'class').length, 1, 'one class attribute');
});

test('hooks pass through untouched: id, the old classes in order, data-*, aria and role, on every part', () => {
  const hooks = { id: 'gm-bar-sess', cls: ['gm-place', 'chip', 'sm'], data: { 'band-place': 'run', 'data-tone': 'hot', n: 3, on: true }, attrs: { 'aria-current': 'page', tabindex: '0' } };
  for (const f of FNS) {
    const html = U[f](Object.assign({ label: 'X', items: [{ label: 'A', value: 'a' }], options: ['a'] }, hooks));
    assert.ok(html.includes('id="gm-bar-sess"'), f + ' id: ' + html);
    assert.ok(/class="[^"]*\bgm-place chip sm"/.test(html), f + ' old classes, in order, after the kit ones: ' + html);
    assert.ok(html.includes('data-band-place="run"') && html.includes('data-tone="hot"') && html.includes('data-n="3"') && html.includes('data-on=""'), f + ' data: ' + html);
    assert.ok(html.includes('aria-current="page"') && html.includes('tabindex="0"'), f + ' attrs: ' + html);
  }
  /* items in a group keep their own hooks */
  const seg = U.seg({ value: 'b', items: [{ label: 'A', value: 'a', id: 'pos-a', cls: 'gm-pos', data: { pos: 'a' } }, { label: 'B', value: 'b' }] });
  assert.ok(seg.includes('<button type="button" class="ui-seg-opt gm-pos" id="pos-a" data-pos="a" value="a" aria-pressed="false">A</button>'), seg);
  assert.ok(seg.includes('value="b" aria-pressed="true">B</button>'), seg);
  const tabs = U.tabs({ items: [{ label: 'Run', value: 'run', selected: true, data: { 'band-place': 'run' }, controls: 'gm-run' }, { label: 'Map', value: 'map' }] });
  assert.ok(tabs.includes('data-band-place="run" value="run" role="tab" aria-selected="true" tabindex="0" aria-controls="gm-run">Run</button>'), tabs);
  assert.ok(tabs.includes('aria-selected="false" tabindex="-1">Map</button>'), tabs);
});

test('buttons: the type defaults to button, submit and reset pass through; rank, pressed, disabled, busy, key', () => {
  assert.ok(U.button('A').startsWith('<button type="button"'));
  assert.ok(U.button({ label: 'A', type: 'submit' }).startsWith('<button type="submit"'));
  assert.ok(U.button({ label: 'A', type: 'reset' }).startsWith('<button type="reset"'));
  assert.ok(U.button({ label: 'A', type: 'link' }).startsWith('<button type="button"'));
  for (const r of ['primary', 'standard', 'quiet', 'danger']) assert.ok(U.button({ label: 'A', rank: r }).includes('class="ui-btn ui-btn--' + r + '"'));
  assert.ok(U.button({ label: 'A', rank: 'loud' }).includes('ui-btn--standard'));
  assert.ok(U.button({ label: 'A', pressed: true }).includes('aria-pressed="true"'));
  assert.ok(U.button({ label: 'A', pressed: false }).includes('aria-pressed="false"'));
  assert.ok(!U.button({ label: 'A' }).includes('aria-pressed'));
  assert.ok(/ disabled>A<\/button>$/.test(U.button({ label: 'A', disabled: true })));
  assert.ok(U.button({ label: 'A', busy: true }).includes('aria-busy="true"'));
  /* KS02b: the label sits in .ui-label and the hint's letter is painted by CSS, so the button's textContent stays the label */
  assert.ok(U.button({ label: 'Send', key: 'S' }).endsWith('><span class="ui-label">Send</span><kbd class="ui-key" aria-hidden="true" data-ui-key="S"></kbd></button>'));
});

test('nesting goes through descriptors and slots only: no option takes markup', () => {
  const card = U.card({ label: 'T', kids: [{ part: 'chip', label: 'Live' }, { part: 'slot', name: 'body' }, { part: 'nope', label: 'x' }, '<b>raw</b>'], html: '<b>raw</b>', slot: 'extra' });
  assert.ok(card.includes('<span class="ui-chip ui-chip--plain">Live</span>'), card);
  assert.ok(card.includes('<div class="ui-slot" data-ui-slot="body"></div>'), card);
  assert.ok(card.includes('<div class="ui-slot ui-card-body" data-ui-slot="extra"></div>'), card);
  assert.ok(!card.includes('<b>'), 'raw markup never gets in: ' + card);
  assert.equal(U.part({ part: 'button', label: 'Go', rank: 'primary' }), U.button({ label: 'Go', rank: 'primary' }));
  assert.equal(U.part({ part: 'nope' }), '');
  assert.ok(!U.part({ part: 'slot', name: 'Bad Name' }).includes('data-ui-slot'), 'a slot name is checked');
  for (const k of ['html', 'innerHTML', 'raw']) assert.ok(!new RegExp('\\bo\\.' + k + '\\b').test(UI_SRC), 'ui.js reads no o.' + k);
});

test('node() builds the same part as DOM nodes, with no markup sink; fill() puts text into a slot', () => {
  const d = fakeDoc();
  for (const p of U.PARTS.parts) for (const ex of p.examples) {
    const n = U.node(p.fn, ex.opts, d);
    assert.equal(serial(n), U[p.fn](ex.opts), p.fn + ' (' + ex.caption + '): node and string agree');
  }
  const evil = U.node('chip', { label: EVIL }, d);
  assert.equal(evil.children[0].nodeType, 3, 'the label is a text node');
  assert.equal(evil.children[0].data, EVIL);
  const svg = U.node('meter', { kind: 'clock', value: 2, max: 4 }, d);
  assert.equal(svg.children[0].ns, 'http://www.w3.org/2000/svg', 'the clock is SVG');
  const card = U.node('card', { label: 'T', slot: 'body' }, d);
  U.fill(card, { body: EVIL, 'Bad Key': 'x' });
  assert.equal(card.children[1].textContent, EVIL);
  assert.equal(d.sinks.length, 0, 'nothing was written as markup');
  assert.equal(U.node('nope', {}, d), null);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(UI_SRC), 'ui.js has no markup sink');
});

test('the parts draw what the ticket asks: one visible action on a row, the rest behind the more button', () => {
  const row = U.row({ id: 'r1', label: 'Mabel Quist', sub: 'Fixer', lead: 'MQ', action: { label: 'Spotlight' }, more: [{ label: 'Introduce', data: { act: 'intro' } }, { label: 'Hide', rank: 'danger' }] });
  const acts = row.slice(row.indexOf('ui-row-acts'), row.indexOf('ui-menu'));
  assert.equal((acts.match(/<button/g) || []).length, 2, 'the action and the more button: ' + acts);
  assert.ok(acts.includes('ui-btn--quiet">Spotlight'), 'the action is quiet by default');
  assert.ok(row.includes('aria-haspopup="menu" aria-expanded="false" aria-controls="r1-more"'), row);
  assert.ok(row.includes('<div class="ui-menu" role="menu" id="r1-more" hidden>'), row);
  assert.ok(row.includes('class="ui-menu-item" data-act="intro" role="menuitem">Introduce'), row);
  assert.ok(row.includes('ui-menu-item--danger'), row);
  assert.ok(U.row({ label: 'A', selected: true }).includes('class="ui-row is-selected" aria-current="true"'));
  assert.ok(U.card({ label: 'A', edge: 'out-crit' }).includes('ui-edge-out-crit'));
  assert.ok(!U.card({ label: 'A', edge: 'pink' }).includes('ui-edge'));
  assert.ok(U.meter({ kind: 'pips', value: 9, max: 3, label: 'Stress' }).includes('aria-label="Stress: 3 of 3"'), 'clamped');
  assert.equal((U.meter({ kind: 'clock', value: 2, max: 8 }).match(/<path/g) || []).length, 8);
  assert.ok(U.dot({ tone: 'ok' }).includes('role="img" aria-label="ok"'), 'a dot alone is named');
  assert.ok(U.dot({ tone: 'ok', label: 'Phones in' }).includes('aria-hidden="true"></span>Phones in'), 'a dot beside a word');
  assert.ok(U.field({ label: 'Note', id: 'n1', cls: 'gm-note' }).includes('<input class="ui-field-input gm-note" type="text" id="n1">'), 'hooks on the control');
});

/* ---------- KS02b: the gaps the KS02 review found ---------- */
test('a camelCase data key is kebab-cased like dataset; a dropped hook warns once per distinct value', () => {
  const html = U.button({ label: 'Go', data: { fooBar: 1, dataBazQux: 2, 'band-place': 'run', 'data-tone': 'hot', place: 3 } });
  for (const want of ['data-foo-bar="1"', 'data-baz-qux="2"', 'data-band-place="run"', 'data-tone="hot"', 'data-place="3"']) assert.ok(html.includes(want), want + ': ' + html);
  warnings.length = 0;
  const bad = { label: 'Go', id: '9bad id', cls: 'ok no"pe', data: { 'two words': 1 }, attrs: { onfocus: 'x', formaction: 'y' } };
  U.button(bad); U.button(bad); U.chip(bad);
  assert.deepEqual(warnings.slice().sort(), [
    'B68Ui: dropped attribute "onfocus"', 'B68Ui: dropped attribute "formaction"', 'B68Ui: dropped class "no\\"pe"', 'B68Ui: dropped data key "two words"',
    'B68Ui: dropped id "9bad id"'].sort(), 'each distinct dropped hook, once, however many parts or calls');
  warnings.length = 0;
  U.button({ label: 'Go', id: 'fine', cls: ['a', 'b'], data: { x: 1 }, attrs: { 'aria-label': 'x' } });
  assert.equal(warnings.length, 0, 'a good hook says nothing');
});

test('hidden: false and hidden: "false" leave the attribute off, in o.hidden and in attrs; true puts it on', () => {
  for (const v of [false, 'false']) {
    assert.ok(!/hidden/.test(U.button({ label: 'A', attrs: { hidden: v } })), 'attrs.hidden ' + v);
    assert.ok(!/hidden/.test(U.button({ label: 'A', hidden: v })), 'o.hidden ' + v);
  }
  assert.ok(/ hidden>A<\/button>$/.test(U.button({ label: 'A', hidden: true })));
  assert.ok(/ hidden>A<\/button>$/.test(U.button({ label: 'A', attrs: { hidden: true } })));
  assert.ok(U.button({ label: 'A', attrs: { hidden: 'hidden' } }).includes('hidden="hidden"'));
  assert.ok(U.button({ label: 'A', attrs: { 'aria-hidden': 'false' } }).includes('aria-hidden="false"'), 'only the hidden attribute is special');
});

test('a key hint leaves the label alone: .ui-label holds the words, the hint is aria-hidden and painted by CSS, so textContent is the label', () => {
  const d = fakeDoc();
  for (const [fn, o] of [['button', { label: 'Send', key: 'S' }], ['link', { label: 'Send', key: 'S', href: '#x' }],
    ['seg', { items: [{ label: 'Send', key: 'S' }] }], ['tabs', { items: [{ label: 'Send', key: 'S' }] }], ['menu', { items: [{ label: 'Send', key: 'S' }] }]]) {
    const html = U[fn](o);
    assert.ok(html.includes('<span class="ui-label">Send</span><kbd class="ui-key" aria-hidden="true" data-ui-key="S"></kbd>'), fn + ': ' + html);
    const n = U.node(fn, o, d);
    assert.equal(serial(n), html, fn + ': node and string agree');
    const btn = fn === 'button' || fn === 'link' ? n : n.children[0];
    assert.equal(btn.textContent, 'Send', fn + ' textContent is the label, never SendS');
  }
  assert.equal(U.button({ label: 'Send' }), '<button type="button" class="ui-btn ui-btn--standard">Send</button>', 'no key: just the text, as before');
  assert.ok(/\.ui-key\[data-ui-key\]::before\s*\{\s*content:\s*attr\(data-ui-key\)/.test(PARTS_CSS), 'the sheet paints the letter');
  assert.ok(U.button({ label: 'x', key: EVIL }).includes('data-ui-key="&lt;img'), 'the hint is escaped');
});

/* a minimal tablist: tabs that know their list, can be focused and clicked, and keep their attributes */
function fakeTabs(n, opts) {
  opts = opts || {};
  const log = [];
  const list = { attrs: { 'aria-orientation': opts.orientation || '' }, getAttribute(k) { return this.attrs[k] || null; }, tabs: [],
    querySelectorAll(sel) { assert.equal(sel, '[role="tab"]'); return this.tabs; } };
  for (let i = 0; i < n; i++) {
    const t = { i, disabled: (opts.disabled || []).includes(i), attrs: { tabindex: i === 0 ? '0' : '-1', 'aria-selected': i === 0 ? 'true' : 'false' },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute(k, v) { this.attrs[k] = String(v); },
      focus() { log.push('focus ' + this.i); }, click() { log.push('click ' + this.i); },
      closest(sel) { return sel === '[role="tab"]' ? this : sel === '[role="tablist"]' ? list : null; } };
    list.tabs.push(t);
  }
  const listeners = [], root = { addEventListener(type, fn, cap) { listeners.push({ type, fn, cap }); } };
  const press = (i, key, extra) => {
    const e = Object.assign({ key, target: list.tabs[i], prevented: false, preventDefault() { this.prevented = true; } }, extra);
    listeners.filter((l) => l.type === 'keydown').forEach((l) => l.fn(e));
    return e;
  };
  return { list, root, log, listeners, press };
}
test('wireTabs: ONE delegated keydown listener per root; arrows, Home and End move focus, set the roving tabindex and activate', () => {
  const t = fakeTabs(4);
  assert.equal(U.wireTabs(t.root), t.root);
  U.wireTabs(t.root); U.wireTabs(t.root);
  assert.deepEqual(t.listeners.map((l) => l.type), ['keydown'], 'one listener however many calls, and none on Escape');
  let e = t.press(0, 'ArrowRight');
  assert.ok(e.prevented); assert.deepEqual(t.log, ['focus 1', 'click 1']);
  assert.deepEqual(t.list.tabs.map((x) => x.attrs.tabindex), ['-1', '0', '-1', '-1'], 'roving tabindex follows focus');
  t.log.length = 0; t.press(3, 'ArrowRight'); assert.deepEqual(t.log, ['focus 0', 'click 0'], 'wraps from the last to the first');
  t.log.length = 0; t.press(0, 'ArrowLeft'); assert.deepEqual(t.log, ['focus 3', 'click 3'], 'wraps from the first to the last');
  t.log.length = 0; t.press(2, 'Home'); assert.deepEqual(t.log, ['focus 0', 'click 0']);
  t.log.length = 0; t.press(1, 'End'); assert.deepEqual(t.log, ['focus 3', 'click 3']);
  t.log.length = 0;
  for (const [key, extra] of [['ArrowDown'], ['Escape'], ['Enter'], ['a'], ['ArrowRight', { shiftKey: true }], ['ArrowRight', { ctrlKey: true }], ['ArrowLeft', { altKey: true }]]) {
    e = t.press(1, key, extra); assert.ok(!e.prevented, key + ' is left alone');
  }
  assert.deepEqual(t.log, [], 'nothing else moves');
  t.listeners[0].fn({ key: 'ArrowRight', target: { closest: () => null }, preventDefault() { throw new Error('not a tab'); } });
  assert.ok(!/document\.addEventListener/.test(UI_SRC.replace(/\/\*[\s\S]*?\*\//g, '')), 'ui.js adds nothing to document');
});
test('wireTabs: a disabled tab is skipped; a vertical list answers to Up and Down', () => {
  const t = fakeTabs(4, { disabled: [1] });
  U.wireTabs(t.root);
  t.press(0, 'ArrowRight'); assert.deepEqual(t.log, ['focus 2', 'click 2'], 'tab 1 is disabled');
  const v = fakeTabs(3, { orientation: 'vertical' });
  U.wireTabs(v.root);
  assert.ok(!v.press(0, 'ArrowRight').prevented, 'Right does nothing on a vertical list');
  v.press(0, 'ArrowDown'); assert.deepEqual(v.log, ['focus 1', 'click 1']);
});

test('guardBusy: ONE capture listener per root cancels a click or Enter or Space on a busy button, and nothing else', () => {
  const calls = [], listeners = [], root = { addEventListener(type, fn, cap) { listeners.push({ type, fn, cap }); } };
  assert.equal(U.guardBusy(root), root); U.guardBusy(root);
  assert.deepEqual(listeners.map((l) => l.type + ':' + l.cap), ['click:true', 'keydown:true'], 'once, in the capture phase');
  const target = (busy) => ({ closest(sel) { assert.ok(sel.includes('[aria-busy="true"]')); return busy ? this : null; } });
  const ev = (type, busy, key) => ({ type, key, target: target(busy), preventDefault() { calls.push('prevent'); }, stopPropagation() { calls.push('stop'); }, stopImmediatePropagation() { calls.push('stopNow'); } });
  const fire = (e) => listeners.filter((l) => l.type === e.type).forEach((l) => l.fn(e));
  fire(ev('click', true)); assert.deepEqual(calls, ['prevent', 'stop', 'stopNow'], 'a busy click never reaches a handler');
  calls.length = 0; fire(ev('click', false)); assert.deepEqual(calls, [], 'a button that is not busy is left alone');
  for (const k of ['Enter', ' ']) { fire(ev('keydown', true, k)); assert.equal(calls.length, 3, k + ' on a busy button is cancelled'); calls.length = 0; }
  fire(ev('keydown', true, 'Tab')); fire(ev('keydown', true, 'Escape')); fire(ev('keydown', false, 'Enter'));
  assert.deepEqual(calls, [], 'Tab and Escape still work on a busy button; Enter elsewhere is left alone');
  assert.ok(/\.ui-btn\[aria-busy="true"\]\s*\{[^}]*pointer-events:\s*none/.test(PARTS_CSS), 'the sheet stops the pointer too');
});

test('the card keeps an inline part its own width: a chip in a card is not a full-width bar', () => {
  const css = PARTS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /(\.ui-card > \.ui-chip[^{]*)\{([^}]*)\}/.exec(css);
  assert.ok(m && /justify-self:\s*start/.test(m[2]), 'a chip laid into a card aligns to the start');
  assert.ok(/\.ui-card\s*\{[^}]*display:\s*grid/.test(css), 'the card is still a grid');
});

test('field: check, switch, time and range', () => {
  const chk = U.field({ label: 'Phones in', kind: 'check', checked: true, id: 'ph', cls: 'gm-ph', hint: 'Until they leave.', value: 'yes', disabled: true });
  assert.equal(chk, '<label class="ui-field ui-field--check is-disabled"><input class="ui-field-input gm-ph" type="checkbox" id="ph" value="yes" checked disabled>'
    + '<span class="ui-field-label">Phones in</span><span class="ui-field-hint">Until they leave.</span></label>');
  assert.ok(!U.field({ label: 'x', kind: 'check' }).includes('checked'), 'unchecked by default');
  const sw = U.field({ label: 'Rain', kind: 'switch', checked: true });
  assert.ok(sw.includes('ui-field--switch') && sw.includes('type="checkbox"') && sw.includes('role="switch"') && sw.includes(' checked'), sw);
  assert.ok(sw.indexOf('<input') < sw.indexOf('ui-field-label'), 'the box comes first');
  const tm = U.field({ label: 'Doors', kind: 'time', value: '19:30', min: '17:00', max: '23:00', step: 60 });
  assert.ok(tm.includes('<input class="ui-field-input" type="time" value="19:30" min="17:00" max="23:00" step="60">'), tm);
  const rg = U.field({ label: 'Volume', kind: 'range', value: 40, min: 0, max: 100, step: 5, id: 'vol' });
  assert.ok(rg.startsWith('<label class="ui-field ui-field--range">') && rg.includes('type="range" id="vol" value="40" min="0" max="100" step="5"'), rg);
  assert.equal(U.field({ label: 'A' }), '<label class="ui-field"><span class="ui-field-label">A</span><input class="ui-field-input" type="text"></label>', 'a text field is as it was');
  assert.ok(U.field({ label: 'A', kind: 'nope' }).includes('type="text"'));
  assert.ok(!U.field({ label: 'Q', kind: 'check', placeholder: 'p' }).includes('placeholder'));
  assert.ok(U.field({ label: EVIL, kind: 'switch', hint: EVIL }).includes('&lt;img'));
});

test('link: an <a> with the button ranks; the href is checked; escaped; the key hint as on a button', () => {
  assert.equal(U.link({ label: 'Open', href: 'rules.html' }), '<a class="ui-btn ui-btn--standard" href="rules.html">Open</a>');
  for (const r of ['primary', 'quiet', 'danger']) assert.ok(U.link({ label: 'A', href: '#a', rank: r }).includes('ui-btn--' + r));
  const good = ['http://a.test/x?y=1&z=2', 'https://a.test', 'HTTPS://a.test', 'mailto:a@a.test', '#top', '/api/x', '../up/x.html', 'x.html?a=b#c', 'obsidian://open?vault=V&file=F', '//cdn.test/x'];
  for (const h of good) assert.ok(U.link({ label: 'A', href: h }).includes('href="' + escT(h) + '"'), h + ' passes');
  warnings.length = 0;
  const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'java\tscript:alert(1)', '\u0000javascript:x', 'data:text/html,<b>', 'vbscript:x', 'file:///c/x', 'ftp://a.test', 'blob:x'];
  for (const h of bad) assert.ok(!/href/.test(U.link({ label: 'A', href: h })), JSON.stringify(h) + ' is dropped');
  assert.ok(warnings.length >= 1 && warnings.every((w) => w.startsWith('B68Ui: dropped href')), 'a dropped href warns');
  assert.ok(!/href/.test(U.link({ label: 'A', attrs: { href: 'javascript:x' } })), 'attrs cannot smuggle an href in');
  assert.ok(!/href/.test(U.link({ label: 'A' })), 'no href given: none drawn');
  assert.ok(U.link({ label: 'A', href: '#a' }).startsWith('<a '), 'an anchor, not a button');
  assert.ok(U.link({ label: 'A', href: 'x"onmouseover="y' }).includes('href="x&quot;onmouseover=&quot;y"'), 'the href is escaped');
  const dis = U.link({ label: 'A', href: '#a', disabled: true });
  assert.ok(!dis.includes('href') && dis.includes('aria-disabled="true"') && dis.includes('tabindex="-1"') && dis.includes('role="link"'), dis);
  assert.ok(U.link({ label: 'A', href: 'https://a.test', target: '_blank' }).includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(!U.link({ label: 'A', href: '#a', target: '_top' }).includes('target'), 'only _blank');
  assert.ok(U.link({ label: 'A', href: '#a', download: 'x.txt' }).includes('download="x.txt"'));
});

test('menu: a standalone list of menu items with the key hint at the right edge; the row draws its menu from the same items', () => {
  const html = U.menu({ id: 'm1', cls: 'gm-m', label: 'Mabel Quist', items: [{ label: 'Introduce', key: 'I', data: { act: 'intro' }, id: 'mi-1', cls: 'gm-mi' },
    { label: 'Hide', rank: 'danger' }, { label: 'Clear', disabled: true }] });
  assert.ok(html.startsWith('<div class="ui-menu ui-menu--static gm-m" role="menu" id="m1" aria-label="Mabel Quist">'), html);
  assert.ok(html.includes('<button type="button" class="ui-menu-item gm-mi" id="mi-1" data-act="intro" role="menuitem"><span class="ui-label">Introduce</span><kbd class="ui-key" aria-hidden="true" data-ui-key="I"></kbd></button>'), html);
  assert.ok(html.includes('ui-menu-item ui-menu-item--danger" role="menuitem">Hide') && html.includes(' role="menuitem" disabled>Clear'), html);
  assert.equal(U.menu({ items: [] }), '<div class="ui-menu ui-menu--static" role="menu"></div>');
  assert.equal(U.menu({}), U.menu({ items: [] }));
  assert.ok(U.menu({ items: [{ label: EVIL, key: EVIL }], label: EVIL }).includes('&lt;img'));
  assert.ok(/\.ui-menu--static\s*\{[^}]*position:\s*static/.test(PARTS_CSS), 'in the flow, where the row\'s menu is a popover');
  assert.ok(/\.ui-menu-item \.ui-key\s*\{[^}]*margin-left:\s*auto/.test(PARTS_CSS), 'the hint at the right edge');
  const items = [{ label: 'Introduce', key: 'I' }, { label: 'Hide', rank: 'danger' }];
  const body = (h) => h.slice(h.indexOf('<button type="button" class="ui-menu-item'), h.lastIndexOf('</button>') + 9);
  assert.equal(body(U.row({ id: 'r9', label: 'A', more: items })), body(U.menu({ items })), 'the same items in the row\'s menu');
});

/* ---------- the manifest ---------- */
test('parts.json and B68Ui.PARTS are the same manifest', () => {
  const j = JSON.parse(read('ui/parts.json'));
  delete j._note;
  assert.deepEqual(j, JSON.parse(JSON.stringify(U.PARTS)));
});

test('every part in the manifest has a function, a class, do and dont, and look book fixtures that draw', () => {
  const fns = U.PARTS.parts.map((p) => p.fn);
  assert.deepEqual([...fns].sort(), [...FNS].sort(), 'one manifest entry per part');
  for (const p of U.PARTS.parts) {
    assert.ok(/^ui-[a-z]+$/.test(p['class']), p.fn + ' class');
    assert.ok(p.do && p.dont, p.fn + ' do and dont');
    assert.ok(Array.isArray(p.examples) && p.examples.length >= 1, p.fn + ' has look book fixtures');
    for (const ex of p.examples) {
      const html = U[p.fn](ex.opts);
      assert.ok(html.includes(p['class']), p.fn + ' (' + ex.caption + ') draws its class: ' + html);
    }
    for (const v of p.variants || []) if (p.fn === 'button') assert.ok(p.examples.some((e) => (e.opts.rank || 'standard') === v), 'button ' + v + ' has a fixture');
  }
  assert.deepEqual(U.PARTS.radii, { control: '2px', pill: '999px' });
});

test('the look book draws every part from the manifest, in both themes and both densities', () => {
  const lb = read('lookbook-boot.js');
  assert.ok(/window\.B68Ui/.test(lb) && /\.PARTS\.parts\.forEach/.test(lb) && /p\.examples/.test(lb), 'the look book walks the manifest and draws each part\'s examples');
  assert.ok(/data-ui-theme/.test(lb) && /paper/.test(lb) && /night/.test(lb), 'both themes');
  assert.ok(/data-density/.test(lb) && /distance/.test(lb), 'both densities');
  assert.ok(!/<button/.test(lb), 'the look book builds its controls with B68Ui');
});

/* ---------- the sheets ---------- */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
function selectors(css) {
  const out = [];
  const body = stripComments(css);
  const re = /([^{}]+)\{/g; let m;
  while ((m = re.exec(body))) {
    const s = m[1].trim();
    if (!s || s.startsWith('@') || /^(from|to|[0-9.]+%)$/.test(s)) continue;
    splitTop(s).forEach((x) => out.push(x.trim()));
  }
  return out;
}
/* a selector list split on the commas outside () and [] (:where(:root[data-kit], [data-ui-scope]) has one inside) */
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
    if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
const SCOPE = ':where(:root[data-kit], [data-ui-scope]) ';
const TOKEN_SCOPE = /^(:root\[data-kit~="(desk|stage|phone)"\]|\[data-ui-scope\]|:where\(:root:not\(\[data-kit\]\)\) \[data-ui-scope\])/;
test('the kit sheets: no !important, no @layer, no mangled punctuation, every selector scoped', () => {
  for (const [name, css] of [['tokens.css', TOKENS], ['parts.css', PARTS_CSS]]) {
    assert.ok(!/!\s*important/i.test(stripComments(css)), name + ' has an !important');
    assert.ok(!/@layer/i.test(stripComments(css)), name + ' has an @layer');
    assert.ok(!/[\u0080-\u009f]/.test(css), name + ' has a character in U+0080 to U+009F');
    for (const s of selectors(css)) assert.ok(TOKEN_SCOPE.test(s) || (name === 'parts.css' && s.startsWith(SCOPE + '.ui-')), name + ': unscoped selector ' + s);
  }
  assert.ok(selectors(TOKENS).every((s) => TOKEN_SCOPE.test(s)), 'every token rule sits under :root[data-kit~=...] or on a [data-ui-scope] container');
});

test('data-ui-scope (KS02b): parts and tokens work under :root[data-kit] and inside a [data-ui-scope] container, and nowhere else', () => {
  const sel = selectors(PARTS_CSS);
  assert.ok(sel.length > 100, 'parts.css has its rules: ' + sel.length);
  for (const s of sel) {
    assert.ok(s.startsWith(SCOPE + '.ui-'), 'a parts.css selector outside the scope: ' + s);
    const rest = s.slice(SCOPE.length);
    assert.ok(!/:where|:root|(^|[\s>+~])(html|body)(?![\w-])/.test(rest) && !/(^|[\s>+~])\*/.test(rest), 'nothing in the rest of the selector escapes the scope: ' + s);
  }
  assert.ok(sel.includes(SCOPE + '.ui-btn') && sel.some((s) => s.startsWith(SCOPE + '.ui-btn:hover')), 'the .ui-btn rules are scoped');
  /* the scope costs no weight: :where() counts for nothing, and no :root[data-kit] is written outside one */
  assert.ok(!/:root\[data-kit\]/.test(PARTS_CSS.replace(/:where\(:root\[data-kit\], \[data-ui-scope\]\)/g, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'no bare :root[data-kit] in front of a part (it would add weight)');
  /* a bare .ui-btn, in a page with no data-kit and no data-ui-scope, has no rule that reaches it: every selector needs the scope as an ancestor */
  const reachesBare = sel.filter((s) => !s.startsWith(SCOPE));
  assert.deepEqual(reachesBare, [], 'no parts.css rule can match outside the kit root and a scope');
  /* the tokens: on the kit's root and on a scope, never on :root alone, *, or body */
  const tsel = selectors(TOKENS);
  assert.ok(tsel.includes('[data-ui-scope]'), 'the tokens are defined on [data-ui-scope]');
  assert.ok(tsel.every((s) => TOKEN_SCOPE.test(s)), 'and only on the kit root or a scope');
  assert.ok(tsel.includes(':where(:root:not([data-kit])) [data-ui-scope]'), 'Paper by default in a scope on a page with no kit');
  for (const t of ['paper', 'night']) {
    assert.ok(tsel.includes('[data-ui-scope][data-ui-theme="' + t + '"]') && tsel.includes('[data-ui-scope] [data-ui-theme="' + t + '"]'), 'data-ui-theme ' + t + ' works in a scope');
  }
  assert.ok(tsel.includes('[data-ui-scope][data-density="distance"]') && tsel.includes('[data-ui-scope] [data-density="desk"]'), 'density works in a scope');
  assert.ok(/prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\[data-ui-scope\]\s*\{[^}]*--ui-motion-quick:\s*0ms/.test(stripComments(TOKENS)), 'reduced motion is a cut in a scope');
  assert.ok(UI_SRC.slice(0, UI_SRC.indexOf('(function')).includes('data-ui-scope'), 'the header contract names data-ui-scope');
  assert.ok(!/(^|[^\w-])\.btn\b/.test(stripComments(PARTS_CSS) + stripComments(TOKENS)), 'the old .btn is in no kit rule');
});

test('every colour in the kit is one the app already has', () => {
  const have = new Set((read('index.html') + read('tokens.css') + read('gm.css')).toLowerCase().match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/g));
  for (const [name, css] of [['tokens.css', TOKENS], ['parts.css', PARTS_CSS]]) {
    for (const hex of (stripComments(css).toLowerCase().match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/g) || [])) assert.ok(have.has(hex), name + ': ' + hex + ' is a new colour');
  }
  assert.ok(!/rgba?\(|hsla?\(/.test(stripComments(PARTS_CSS)), 'parts.css takes its colours from the tokens');
});

test('the tokens: every role, size, radius, motion, layer and density the ticket names; themes written once', () => {
  const css = stripComments(TOKENS);
  const roles = ['surface', 'raised', 'sunk', 'ink', 'ink-soft', 'ink-faint', 'accent', 'rules', 'alarm'];
  const outs = ['deal', 'mid', 'low', 'six', 'crit'];
  const need = roles.map((r) => '--ui-' + r).concat(outs.map((o) => '--ui-out-' + o), outs.map((o) => '--ui-out-' + o + '-ink'),
    [1, 2, 3, 4, 5, 6].map((n) => '--ui-faction-' + n), [1, 2, 3, 4, 5, 6].map((n) => '--ui-faction-' + n + '-ink'),
    ['label', 'body', 'lead', 'title', 'display'].map((t) => '--ui-type-' + t), [1, 2, 3, 4, 5, 6].map((n) => '--ui-space-' + n),
    ['--ui-hairline', '--ui-rule', '--ui-radius', '--ui-radius-pill'], ['quick', 'base', 'slow', 'cut'].map((m) => '--ui-motion-' + m),
    ['base', 'sticky', 'popover', 'dialog', 'toast', 'alarm'].map((l) => '--ui-layer-' + l));
  for (const n of need) assert.ok(new RegExp(n.replace(/-/g, '\\-') + '\\s*:').test(css), n + ' is defined');
  const px = (n) => new RegExp('--ui-type-' + n + ':\\s*(\\d+)px').exec(css)[1];
  assert.deepEqual(['label', 'body', 'lead', 'title', 'display'].map(px), ['12', '14', '16', '28', '40']);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => new RegExp('--ui-space-' + n + ':\\s*(\\d+)px').exec(css)[1]), ['4', '8', '12', '16', '24', '32']);
  assert.deepEqual(['quick', 'base', 'slow'].map((m) => new RegExp('--ui-motion-' + m + ':\\s*(\\d+)ms').exec(css)[1]), ['120', '200', '320']);
  assert.equal(/--ui-radius:\s*([^;]+);/.exec(css)[1], U.PARTS.radii.control, 'the control radius is the manifest\'s');
  assert.equal(/--ui-radius-pill:\s*([^;]+);/.exec(css)[1], U.PARTS.radii.pill, 'the pill radius is the manifest\'s');
  /* themes written once: each theme colour is one light-dark() line; no second block of colours anywhere */
  for (const r of ['surface', 'raised', 'sunk', 'ink', 'ink-soft', 'ink-faint', 'rules', 'alarm']) {
    const defs = css.match(new RegExp('--ui-' + r + ':[^;]+;', 'g'));
    assert.equal(defs.length, 1, '--ui-' + r + ' is written once');
    assert.ok(/light-dark\(#[0-9a-f]{6},\s*#[0-9a-f]{6}\)/.test(defs[0]), '--ui-' + r + ' is a light-dark() pair');
  }
  assert.ok(/\[data-theme="light"\][^{]*\{\s*color-scheme:\s*light;/.test(css), 'a stored Paper');
  assert.ok(/\[data-theme="dark"\][^{]*\{\s*color-scheme:\s*dark;/.test(css), 'a stored Night');
  assert.ok(/color-scheme:\s*light dark;/.test(css), 'the device by default');
  assert.ok(/\[data-ui-theme="night"\][^{]*\{\s*color-scheme:\s*dark;/.test(css) && /\[data-ui-theme="paper"\][^{]*\{\s*color-scheme:\s*light;/.test(css), 'a container\'s own theme');
  assert.ok(/\[data-density="distance"\][^{]*\{[^}]*--ui-type-label:\s*3\.4vmin/.test(css), 'distance density in vmin');
  assert.ok(/prefers-reduced-motion:\s*reduce\)\s*\{[^}]*--ui-motion-base:\s*0ms/.test(css), 'reduced motion is a cut');
});

test('ui.js: no hand-built button tag, no string literal over 220 characters', () => {
  assert.ok(!/<button/.test(UI_SRC), 'ui.js builds the tag as "<" + tag');
  const code = UI_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g)) assert.ok(m[0].length - 2 <= 220, 'a literal of ' + (m[0].length - 2) + ' characters');
});

/* ---------- Paper by default on the desk (ui/kit-flag.js): data-theme="light" while the desk kit is painted and nothing is stored ---------- */
function flagPage(hash, stored) {
  const attrs = {}, log = [], observers = [];
  const el = {
    setAttribute(k, v) { log.push('set ' + k + '=' + v); attrs[k] = String(v); if (k === 'data-theme') observers.forEach((f) => f()); },
    removeAttribute(k) { log.push('remove ' + k); delete attrs[k]; if (k === 'data-theme') observers.forEach((f) => f()); },
    hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
    getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null)
  };
  const ls = new Map(stored ? [['b68.theme', stored]] : []), writes = [];
  const W = {
    document: { documentElement: el }, location: { hash }, console,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { writes.push(k); ls.set(k, String(v)); }, removeItem: (k) => { writes.push(k); ls.delete(k); } },
    addEventListener() {}, B68Load: { need: () => Promise.resolve(), layerOld() {} },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(t, o) { assert.equal(JSON.stringify(o.attributeFilter), '["data-theme"]'); observers.push(() => this.fn([])); } }
  };
  W.self = W;
  vm.runInNewContext(fs.readFileSync(path.join(APP, 'ui', 'kit-flag.js'), 'utf8'), W);
  return { W, K: W.B68Kit, attrs, log, ls, writes };
}
test('the desk is Paper by default: data-theme="light" while desk is on and nothing is stored, never written to storage', () => {
  const p = flagPage('#gm');
  p.K.set('desk', true);
  assert.equal(p.attrs['data-theme'], 'light');
  assert.equal(p.attrs['data-kit-paper'], '', 'marked as the kit\'s, so it can be taken back');
  assert.ok(!p.writes.includes('b68.theme'), 'the theme memory is not written');
  p.W.document.documentElement.removeAttribute('data-theme');     /* the footer's Auto */
  assert.equal(p.attrs['data-theme'], 'light', 'Auto on the new desk means Paper');
  p.K.set('desk', false);
  assert.ok(!('data-theme' in p.attrs) && !('data-kit-paper' in p.attrs), 'off: the device decides again, as today');
  p.W.document.documentElement.setAttribute('data-theme', 'dark');
  p.W.document.documentElement.removeAttribute('data-theme');
  assert.ok(!('data-theme' in p.attrs), 'with the desk off, Auto stays Auto');
});
test('a stored theme wins on the desk; Paper by default touches no other screen and nothing while the kit is off', () => {
  const night = flagPage('#gm', 'dark');
  night.W.document.documentElement.setAttribute('data-theme', 'dark');     /* index.html's head script */
  night.K.set('desk', true);
  assert.equal(night.attrs['data-theme'], 'dark');
  assert.ok(!('data-kit-paper' in night.attrs));
  for (const [hash, name] of [['#display', 'stage'], ['#c/pc-nell', 'phone']]) {
    const p = flagPage(hash);
    p.K.set(name, true);
    assert.ok(!('data-theme' in p.attrs), name + ' follows the device, as today');
  }
  const off = flagPage('#gm');
  off.K.set('desk', false);
  assert.ok(!off.log.some((l) => /data-theme|data-kit-paper/.test(l)), 'kit off: no theme write at all');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
