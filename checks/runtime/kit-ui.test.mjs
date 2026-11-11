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

const EVIL = '<img src=x onerror=alert(1)>';
const FNS = ['button', 'seg', 'tabs', 'chip', 'card', 'row', 'field', 'meter', 'key', 'dot'];

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
  const BOOL = new Set(['hidden', 'disabled', 'selected', 'required']);
  let s = '<' + n.tag;
  for (const [k, v] of n.attrs) s += v === '' && BOOL.has(k) ? ' ' + k : ' ' + k + '="' + escT(v) + '"';
  s += '>';
  if (VOID.has(n.tag)) return s;
  return s + n.children.map(serial).join('') + '</' + n.tag + '>';
}
/* every attribute name in a markup string */
function attrNames(html) { return [...html.matchAll(/\s([a-zA-Z][\w:.-]*)(?==|[\s>])/g)].map((m) => m[1]); }

/* ---------- the helper ---------- */
test('B68Ui exports the ten parts, part, node, fill, esc and the manifest', () => {
  for (const f of FNS) assert.equal(typeof U[f], 'function', f);
  for (const f of ['part', 'node', 'fill', 'esc']) assert.equal(typeof U[f], 'function', f);
  assert.deepEqual(U.FNS, FNS);
  assert.equal(typeof U.PARTS, 'object');
});

test('the contract block at the top of ui.js names every part', () => {
  const head = UI_SRC.slice(0, UI_SRC.indexOf('(function'));
  for (const f of FNS.concat(['part', 'node', 'fill', 'esc', 'PARTS'])) assert.ok(head.includes('B68Ui.' + f), 'B68Ui.' + f + ' in the contract');
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
  assert.ok(U.button({ label: 'Send', key: 'S' }).endsWith('>Send<kbd class="ui-key" aria-hidden="true">S</kbd></button>'));
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
    s.split(',').forEach((x) => out.push(x.trim()));
  }
  return out;
}
test('the kit sheets: no !important, no @layer, no mangled punctuation, every selector scoped', () => {
  for (const [name, css] of [['tokens.css', TOKENS], ['parts.css', PARTS_CSS]]) {
    assert.ok(!/!\s*important/i.test(stripComments(css)), name + ' has an !important');
    assert.ok(!/@layer/i.test(stripComments(css)), name + ' has an @layer');
    assert.ok(!/[\u0080-\u009f]/.test(css), name + ' has a character in U+0080 to U+009F');
    for (const s of selectors(css)) assert.ok(/^:root\[data-kit~="(desk|stage|phone)"\]/.test(s) || /^\.ui-[a-z]/.test(s), name + ': unscoped selector ' + s);
  }
  assert.ok(selectors(TOKENS).every((s) => /^:root\[data-kit~="(desk|stage|phone)"\]/.test(s)), 'every token rule sits under :root[data-kit~=...]');
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
