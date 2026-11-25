// sheet-page: the phone's Full sheet (phone.glance; RK32 of the room key build). app/sheet/page.js under Node and in a bare context with a fake
// window: no browser, no network. On the INVENTED blank sheet only (checks/runtime/fixtures/sheets/: blank-sheet.mjs makes it, blank.svg and
// blank.map.json are its Hound). Covers:
//   module    the global, not a stub, open/update and no start/stop (nothing starts it: glance.js opens it)
//   fixture   the committed pair is the generator's output; the svg holds every kind (box, dot, lozenge, clock, writing line, mark) and no script
//   schema    the header (schema 1, a size), each region's shape, the run-time expectations equal scripts/lib/sheets-check.mjs expectFor for all 12
//   guards    the invented sheet passes for six playbooks; a count that disagrees, a waived check (by FAMILY) or a wrong shape draws NOTHING there
//             and puts the note on the page; the rest still draws
//   marks     each region's marks from the character's data (stress, xp, dots, abilities, items, stacks, bank, harm, the clock, armour and the
//             resource, keys and a deadlock, friends and rivals, the cohort, identity, load); words escaped and squeezed to their line
//   regions   whole blocks, the smallest on top, never under 22 pt tall
//   zoom      the range, the steps, the double tap, the point under the finger kept
//   editors   each region's editor is made of tracker.js's own controls (data-act, data-path, data-change); the harm editor is one change (Done)
//   fallback  a missing map, a map of another schema or another playbook, a missing page: fallback(), remembered (the next open() is false at
//             once); a sheet that loads: drawn, and cached (no second fetch)
//   node checks/runtime/sheet-page.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { blankSheet, loadContent } from './fixtures/sheets/blank-sheet.mjs';
import { PAGE_ORDER, expectFor } from '../../scripts/lib/sheets-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/sheet/page.js';
const SRC = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'sheets');
const CT = loadContent(path.join(ROOT, 'app', 'content.js'));
const M = require(path.join(ROOT, FILE));
const P = M.Pure;
let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') { pending.push(r.then(() => { passed++; console.log('PASS ' + name); }, (e) => { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); })); return; } passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const pb = (id) => CT.byId[id];
const sheet = (id = 'hound', o) => blankSheet(CT, id, o).map;
const count = (s, re) => (s.match(re) || []).length;
const pens = (s) => count(s, /class="sp-pen"/g);
const ch = (play, id = 'hound', doc) => ({ play, pb: pb(id), doc: doc || { name: 'Nell Arbuthnot', sheet: { look: 'Long coat' } } });

/* ---------- module ---------- */
test('module: the global is defined as a plain script, not a stub, with open and update and no start or stop', () => {
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(SRC, win, { filename: FILE });
  const G = win.B68SheetPage;
  assert.ok(G && typeof G === 'object' && !G.stub, 'B68SheetPage is defined and not a stub');
  assert.equal(typeof G.open, 'function'); assert.equal(typeof G.update, 'function');
  assert.ok(!('start' in G) && !('stop' in G), 'nothing starts it: glance.js opens it');
  assert.equal(G.open(null, {}), false, 'no container: false');
});
test('module: ES5, no document listener, no string over 220 characters, no character in U+0080 to U+009F', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/=>|\blet\b|\bconst\b|`|\bclass\s+[A-Z]/.test(code), 'no arrow, let, const, template or class');
  assert.ok(!/document\.addEventListener|W\.document\.addEventListener/.test(code), 'no document listener');
  const long = (code.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter((s) => s.length > 222);
  assert.equal(long.length, 0, 'long literals: ' + long.map((s) => s.slice(0, 40)).join(' | '));
  assert.ok(!/[\u0080-\u009f]/.test(SRC + fs.readFileSync(path.join(ROOT, 'app/sheet/page.css'), 'utf8')), 'no C1 character');
  assert.ok(/BASE \+ encodeURIComponent\(id\)/.test(code) && /'media\/sheets\/'/.test(code), 'it fetches only media/sheets/<playbook>');
});
test('page.css: every rule under #dossier (or the Night root lines), no important flag, no layer, screen only', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app/sheet/page.css'), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  const sels = (rules.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1).trim()).filter(Boolean);
  const bad = []; for (const s of sels) for (const one of s.split(',')) { const o = one.trim(); if (!/^(:root(\[data-theme="dark"\]|:not\(\[data-theme="light"\]\)) )?#dossier\b/.test(o)) bad.push(o); }
  assert.ok(sels.length > 40 && !bad.length, 'selectors outside #dossier: ' + bad.slice(0, 3));
  assert.ok(!/!\s*important/i.test(css) && !/@layer/.test(css), 'no important flag, no layer');
  const top = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /^\S/.test(l) && !/^@media|^\}/.test(l));
  assert.ok(top.every((l) => /^:root\[data-theme="dark"\]/.test(l)), 'outside a screen media query only the Night lines: ' + top.slice(0, 2));
});

/* ---------- fixture ---------- */
test('fixture: blank.svg and blank.map.json are what blank-sheet.mjs makes (the Hound), and the svg is invented shapes only', () => {
  const g = blankSheet(CT, 'hound');
  assert.equal(fs.readFileSync(path.join(FIX, 'blank.svg'), 'utf8').split(String.fromCharCode(13)).join(''), g.svg, 'blank.svg (line endings aside)');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(FIX, 'blank.map.json'), 'utf8')), clone(g.map));
  for (const tag of ['<rect', '<circle', '<polygon', '<line', '<text', '<path']) assert.ok(g.svg.includes(tag), 'svg has ' + tag);
  assert.ok(!/<script|\son[a-z]+=|href=|<image|<foreignObject/i.test(g.svg), 'no script, handler, link or embedded image');
  assert.deepEqual(Object.values(g.map.kinds).sort().filter((v, i, a) => a.indexOf(v) === i), ['box', 'clock', 'dot', 'lozenge', 'mark', 'text']);
});

/* ---------- schema ---------- */
test('schema: the header must be schema 1 with a page size', () => {
  assert.equal(P.validate(sheet()).ok, true);
  assert.equal(P.validate(Object.assign(sheet(), { v: 2 })).ok, false);
  assert.equal(P.validate(Object.assign(sheet(), { size: [0, 10] })).ok, false);
  assert.equal(P.validate(null).ok, false);
});
test('schema: the run-time expectations are the publish step\'s (sheets-check expectFor), for all twelve playbooks', () => {
  for (const id of PAGE_ORDER) {
    const a = P.expect(CT, pb(id)), b = expectFor(CT, id);
    for (const k of ['stress', 'xp', 'xpi', 'xpp', 'xpr', 'acts', 'dots', 'abilities', 'stacks', 'bank', 'keys', 'hits', 'harm']) assert.equal(a[k], b[k], id + ' ' + k);
    assert.deepEqual(clone(a.items), clone(b.items), id + ' items'); assert.deepEqual(clone(a.friends), clone(b.friends), id + ' friends');
  }
});

/* ---------- guards ---------- */
test('guards: the invented sheet passes every region for six playbooks', () => {
  for (const id of ['hound', 'intellectual', 'hull', 'vampire', 'ghost', 'timetraveler']) {
    const g = P.guards(sheet(id), CT, pb(id)), bad = Object.keys(g).filter((k) => !g[k].ok);
    assert.equal(bad.length, 0, id + ': ' + bad.map((k) => k + ' (' + g[k].why + ')').join(', '));
  }
});
test('guards: 8 stress boxes for a 9-box track draws nothing there and puts the note on the page; the rest still draws', () => {
  const map = sheet('hound', { stress: 8 }), g = P.guards(map, CT, pb('hound'));
  assert.equal(g.stress.ok, false); assert.match(g.stress.why, /8 of 9/);
  const out = P.marks(map, ch({ stress: 5, dots: { Hunt: 2 } }), g, CT);
  assert.equal(pens(out), 2, 'only the two Hunt dots: ' + pens(out));
  assert.equal(count(out, /class="sp-unmapped"/g), 1, 'one note');
  assert.ok(out.includes('This part of the sheet isn’t mapped: use the glance screen'), 'the note says it');
  assert.equal(P.NOTE, 'This part of the sheet isn’t mapped: use the glance screen');
});
test('guards: a waiver covers its whole region, by FAMILY (item loads -> items, key hits -> keys, dots -> acts, stress -> stress)', () => {
  const play = { stress: 3, dots: { Hunt: 2 }, items: ['Binoculars'], keys: [{ name: 'KEY-1', hits: 2 }] };
  const base = pens(P.marks(sheet(), ch(play), null, CT));
  assert.equal(base, 3 + 2 + 1 + 2, 'all drawn when nothing is waived');
  for (const [check, region, gone] of [['item loads', 'items', 1], ['key hits', 'keys', 2], ['dots', 'acts', 2], ['stress', 'stress', 3]]) {
    const map = sheet('hound', { waived: [check] }), g = P.guards(map, CT, pb('hound'));
    assert.equal(g[region].ok, false, check + ' -> ' + region); assert.equal(g[region].why, 'waived');
    const out = P.marks(map, ch(play), g, CT);
    assert.equal(pens(out), base - gone, check + ': ' + pens(out)); assert.equal(count(out, /sp-unmapped/g), 1);
  }
  assert.deepEqual(clone(P.waivedRegions({ waived: ['item loads', 'key hits', 'dots', 'bank'] })), ['items', 'keys', 'acts', 'bank']);
});
test('guards: a wrong shape, a missing action, the wrong dot count, a stray item line, the wrong harm levels each fail their region only', () => {
  const cases = [
    ['acts', (m) => { m.acts.Hunt.d = 'x'; }], ['acts', (m) => { delete m.acts.Hunt; }], ['acts', (m) => { m.acts.Hunt.d.pop(); }],
    ['items', (m) => { m.items.push({ n: 'GM-ONLY-stray', s: [[1, 1, 2, 2]], l: [1, 1, 9, 9] }); }], ['items', (m) => { m.items[0].s.push([1, 1, 2, 2]); }],
    ['harm', (m) => { m.harm[0].level = 3; }], ['keys', (m) => { m.keys[0].hits.pop(); }], ['friends', (m) => { m.friends.pop(); }], ['ab', (m) => { m.ab.pop(); }],
    ['bank', (m) => { m.bank.pop(); }], ['xpi', (m) => { m.xpi.pop(); }], ['heal', (m) => { m.heal = [1, 2]; }], ['res', (m) => { m.res[1].squares.pop(); }]
  ];
  for (const [region, f] of cases) {
    const m = sheet(); f(m); const g = P.guards(m, CT, pb('hound')), bad = Object.keys(g).filter((k) => !g[k].ok);
    assert.deepEqual(bad, [region], region + ': ' + bad.join(','));
  }
  const g = P.guards(Object.assign(sheet(), { stress: undefined }), CT, pb('hound'));
  assert.equal(g.stress.ok, false, 'a region not on the map is not drawn');
});

/* ---------- marks ---------- */
test('marks: each region from the character\'s data', () => {
  const map = sheet(), one = (play, id) => P.marks(map, ch(play, id), null, CT);
  assert.equal(pens(one({ stress: 6 })), 6, 'stress 6');
  assert.equal(pens(one({ xp: { playbook: 3, insight: 2, prowess: 0, resolve: 6 } })), 11, 'xp 3 + 2 + 6');
  assert.equal(pens(one({ dots: { Hunt: 2, Skirmish: 3, Sway: 1 } })), 6, 'dots 2 + 3 + 1');
  assert.equal(pens(one({ abilities: ['Hound’s Instincts', 'Fixer', 'A custom ability'] })), 2, 'two abilities of the page (curly quote matched), not the custom one');
  assert.equal(pens(one({ abilities: ['Fixer'], abilityTicks: { Fixer: 3 } })), 1, 'one bubble on this page for Fixer');
  assert.equal(pens(one({ items: ['Binoculars', 'A loyal, clever pet', CT.STANDARD_ITEMS[3][0]] })), 1 + 1 + CT.STANDARD_ITEMS[3][1], 'item squares = their loads (a load-0 item its one box)');
  assert.equal(pens(one({ stacks: 2, bank: 5 })), 7, 'stacks 2 and bank 5');
  assert.equal(pens(one({ healing: 2 })), 1); assert.match(one({ healing: 2 }), /<path class="sp-pen"/); assert.match(one({ healing: 4 }), /<circle class="sp-pen"/); assert.equal(pens(one({ healing: 0 })), 0);
  assert.equal(pens(one({ armor: { armor: true, heavy: true }, resource: [true, false] })), 3, 'armour, heavy and one resource box');
  const k = one({ keys: [{ name: 'KEY-1', down: 'Takes the long way', up: 'Never lets go', hits: 2 }, { name: 'KEY-2', hits: 0, deadlock: 'down' }] });
  assert.equal(pens(k), 2 + 1, 'two hits, and the deadlock burst'); assert.equal(count(k, /class="sp-line"/g), 1, 'the deadlocked key struck through');
  assert.match(k, />KEY-1 \(▼ Takes the long way ▲ Never lets go\)</);
  const f = one({ contacts: [{ name: 'Mabel Quist', kind: 'friend' }, { name: 'Dov Kessler', kind: 'rival' }, { name: 'Ada Vell', kind: null }] });
  assert.equal(pens(f), 2, 'a friend and a rival');
  const fr = map.friends[1].m[1]; assert.ok(f.includes(String(fr[0] + 1) + ',' + String(fr[1] + 1)), 'the rival on the second mark');
  assert.equal(pens(one({ cohort: { harm: 'impaired', armor: true } })), 2, 'the cohort\'s harm and armour');
  assert.equal(pens(one({ cohort: { harm: 'impaired' } }, 'operative')), 0, 'no cohort on a playbook without one');
  const id = P.marks(map, ch({ crew: 'The Dovetail Crew', vice: 'Weird' }, 'hound', { name: 'Nell <b>&amp; co', alias: 'Nell', sheet: { look: 'Long coat', wearing: ['Hat', 'Boots'], heritage: 'Islander' } }), null, CT);
  assert.match(id, />Nell &lt;b&gt;&amp;amp; co</, 'words escaped'); assert.match(id, />Hat, Boots</); assert.match(id, />The Dovetail Crew</); assert.match(id, /class="sp-ink"/);
  assert.match(one({ loadLimit: 'loud' }), new RegExp('x="' + (Math.round((map.load.loud[0] - 2) * 100) / 100) + '"'), 'a ring round Loud');
});
test('marks: harm by level on its own lines, and long words squeezed to the line', () => {
  const map = sheet(), out = P.marks(map, ch({ harm: { l4: '', l3: 'Shot', l2: ['Cracked ribs', 'Burned hand'], l1: ['Winded', ''] } }), null, CT);
  const at = (t) => { const m = new RegExp('x="([\\d.]+)" y="([\\d.]+)"[^>]*>' + t + '<').exec(out); return m ? [+m[1], +m[2]] : null; };
  const l3 = map.harm.find((h) => h.level === 3).write, l2 = map.harm.filter((h) => h.level === 2).map((h) => h.write), l1 = map.harm.find((h) => h.level === 1).write;
  assert.equal(at('Shot')[0], l3[0] + 1); assert.equal(at('Cracked ribs')[0], l2[0][0] + 1); assert.equal(at('Burned hand')[0], l2[1][0] + 1); assert.ok(at('Winded')[1] > l1[1] && at('Winded')[1] <= l1[3]);
  const long = P.marks(map, ch({ harm: { l4: 'A very long wound that would never fit on the printed line at all', l3: '', l2: ['', ''], l1: ['', ''] } }), null, CT);
  assert.match(long, /textLength="[\d.]+" lengthAdjust="spacingAndGlyphs"/);
});

/* ---------- regions ---------- */
test('regions: whole blocks for every part, the smallest drawn last (on top), none under 22 pt tall', () => {
  const list = P.hits(sheet(), pb('hound')), regions = [...new Set(list.map((x) => x.region))].sort();
  assert.deepEqual(regions, ['abilities', 'about', 'actions', 'cohort', 'friends', 'harm', 'items', 'keys', 'stacks', 'stress', 'xp']);
  const areas = list.map((x) => (x.r[2] - x.r[0]) * (x.r[3] - x.r[1]));
  assert.ok(areas.every((a, i) => !i || a <= areas[i - 1]), 'largest first');
  assert.ok(list.every((x) => x.r[3] - x.r[1] >= 22 - 1e-9), 'every region at least 22 pt tall');
  assert.equal(list.filter((x) => x.region === 'xp').length, 4, 'playbook xp and the three attributes\' xp');
  assert.ok(!P.hits(sheet(), pb('operative')).some((x) => x.region === 'cohort'), 'no cohort region without a cohort');
});

/* ---------- zoom ---------- */
test('zoom: 100% to 400%, the steps, the double tap, and the point under the finger stays put', () => {
  assert.equal(P.clampZ(.5), 1); assert.equal(P.clampZ(9), 4); assert.equal(P.clampZ(NaN), 1); assert.equal(P.clampZ(2.2), 2.2);
  assert.equal(P.stepZ(1, 1), 1.5); assert.equal(P.stepZ(3, 1), 4); assert.equal(P.stepZ(4, 1), 4); assert.equal(P.stepZ(1, -1), 1); assert.equal(P.stepZ(2.2, -1), 2); assert.equal(P.stepZ(2.2, 1), 2.5);
  assert.equal(P.dblZ(1), 2.5); assert.equal(P.dblZ(2.5), 1); assert.equal(P.dblZ(4), 1);
  const k = P.keepPoint({ left: 0, top: 0, px: 100, py: 50, w0: 360, w1: 900, aspect: .5 });
  assert.equal(Math.round(k.left), 150); assert.equal(Math.round(k.top), 75);
  const back = P.keepPoint({ left: k.left, top: k.top, px: 100, py: 50, w0: 900, w1: 360, aspect: .5 });
  assert.equal(Math.round(back.left), 0); assert.equal(Math.round(back.top), 0);
  assert.deepEqual(clone(P.keepPoint({ left: 0, top: 0, px: 10, py: 10, w0: 900, w1: 360, aspect: .5 })), { left: 0, top: 0 }, 'never a negative scroll');
});

/* ---------- editors ---------- */
test('editors: each region is made of the sheet\'s own controls', () => {
  const play = { stress: 4, vice: 'Weird', purveyor: 'The corner shop', xp: { playbook: 2, insight: 6, prowess: 1, resolve: 0 }, xpHold: 3, dots: { Hunt: 2 }, abilities: ['Fixer'],
    keys: [{ name: 'KEY-1', down: 'Takes the long way', up: 'Never lets go', hits: 1 }], contacts: [{ name: 'Mabel Quist', role: 'a ferryman', kind: 'friend' }], items: ['Binoculars'],
    stacks: 1, bank: 3, cohort: { name: 'Rex', harm: 'weak' }, harm: { l1: ['Winded', ''], l2: ['', ''], l3: '', l4: '' }, healing: 1, armor: { armor: true }, resource: [false, true], crew: 'The Dovetail Crew' };
  const e = (r, id = 'hound') => P.editor(r, ch(play, id), CT);
  const has = (s, re, n) => { const c = count(s, re); assert.ok(n == null ? c > 0 : c === n, re + ' x' + c + (n == null ? '' : ' (want ' + n + ')')); };
  let s = e('stress'); has(s.live, /data-act="stress"/g, 9); has(s.live, /data-act="stressd"/g, 2); has(s.body, /data-change="vice"/g, 1); has(s.body, /data-path="purveyor"/g, 1); has(s.body, /data-act="dtopen" data-k="indulge"/g, 1); assert.equal(s.sub, '4/9');
  s = e('stress', 'vampire'); has(s.live, /data-act="stress"/g, 12); has(s.live, /data-act="feed"/g, 1); assert.equal(s.body, '', 'no vice on a paranormal page');
  s = e('keys'); has(s.live, /data-act="keyhit" data-i="0"/g, 3); has(s.live, /data-act="deadlock" data-i="0" data-dir="(down|up)"/g, 2); has(s.body, /data-path="keys\.0\.(name|down|up)"/g, 3);
  s = e('harm'); assert.equal(s.done, true); has(s.live, /data-act="heal"/g, 4); has(s.live, /data-act="armor" data-k="(armor|heavy)"/g, 2); has(s.live, /data-act="resource" data-k="[01]"/g, 2); has(s.body, /data-sp-h="/g, 6); assert.match(s.body, /value="Winded"/);
  assert.match(e('harm', 'hull').title, /^Damage and repair/);
  s = e('cohort'); has(s.live, /data-act="coharm"/g, 3); has(s.live, /data-act="coarmor"/g, 1); has(s.body, /data-path="cohort\.(name|type|edges|flaws)"/g, 4);
  s = e('abilities'); assert.match(s.live, /<b>Fixer<\/b>/); has(s.live, /data-act="ability" data-n="[^"]+" data-i="1"/g, pb('hound').abilities.length - 1);
  s = e('friends'); has(s.live, /data-act="contact" data-i="0"/g, 1); assert.match(s.live, /▲ friend/);
  s = e('xp'); has(s.live, /data-act="xp" data-k="playbook"/g, 8); has(s.live, /data-act="xp" data-k="(insight|prowess|resolve)"/g, 18); has(s.live, /data-act="advdot" data-a="[A-Za-z]+" data-k="insight"/g, 4); has(s.live, /data-act="xphold"/g, 2); has(s.live, /data-act="dtopen" data-k="train"/g, 1);
  s = e('stacks'); has(s.live, /data-act="stacks"/g, 4); has(s.live, /data-act="(tobank|frombank)"/g, 2);
  s = e('stacks', 'timetraveler'); has(s.live, /data-act="(tobank|frombank)"/g, 0);
  s = e('actions'); has(s.live, /data-act="rollopen"/g, 12); has(s.live, /data-act="resistopen"/g, 3); assert.match(s.live, /Resist 1d/);
  s = e('items'); has(s.live, /data-act="limit" data-v="(quiet|loud)"/g, 2); has(s.live, /data-act="item"/g, pb('hound').items.length + CT.STANDARD_ITEMS.length); assert.equal(s.sub, '2/3 load');
  s = e('about'); has(s.body, /data-path="crew"/g, 1); assert.match(s.title, /About Nell Arbuthnot/);
  assert.equal(P.editor('nothing', ch(play), CT), null);
  const q = P.editor('items', ch({ items: [], extraItems: [{ name: 'A "quoted" <thing>', load: 1 }] }), CT);
  assert.match(q.live, /data-n="A &quot;quoted&quot; &lt;thing&gt;"/, 'names escaped');
});

/* ---------- open, the fallback and the cache (a fake window) ---------- */
function fakeWin(o) {
  const calls = { fetch: [], fallback: 0, imgs: [] };
  function el() {
    return { style: {}, attrs: {}, children: [], innerHTML: '', isConnected: true, clientWidth: o.w || 390, clientHeight: 600, offsetWidth: 0, scrollLeft: 0, scrollTop: 0, hidden: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, removeChild() {},
      querySelector() { return el(); }, querySelectorAll() { return []; }, addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0 }; }, focus() {} };
  }
  const win = { innerWidth: o.w || 390, innerHeight: 664, setTimeout, clearTimeout, Promise, B68Content: CT, document: { createElement: el, createElementNS: el, activeElement: null } };
  win.self = win; win.window = win;
  win.fetch = (url) => { calls.fetch.push(url); return Promise.resolve(o.map ? { ok: true, status: 200, json: () => Promise.resolve(clone(o.map)) } : { ok: false, status: 404, json: () => Promise.reject(new Error('no')) }); };
  win.Image = function () { const img = { setAttribute() {}, parentNode: null }; calls.imgs.push(img); Object.defineProperty(img, 'src', { set(v) { img._src = v; setTimeout(() => (o.img === false ? img.onerror() : img.onload()), 0); }, get() { return img._src; } }); return img; };
  vm.runInNewContext(SRC, win, { filename: FILE });
  return { win, M: win.B68SheetPage, calls, box: el(), opts: { fallback() { calls.fallback++; }, close() {}, record() {}, commit() {}, play() { return null; } } };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const nell = () => ({ doc: { name: 'Nell Arbuthnot', playbook: 'hound' }, play: { stress: 2 }, pb: pb('hound'), own: [] });
test('fallback: no map (404): open() draws a placeholder, then fallback(); the next open() is false at once, with no second request', async () => {
  const F = fakeWin({});
  assert.equal(F.M.open(F.box, nell(), F.opts), true);
  await tick();
  assert.equal(F.calls.fallback, 1); assert.deepEqual(F.calls.fetch, ['media/sheets/hound.map.json']);
  assert.equal(F.M.open(F.box, nell(), F.opts), false, 'remembered'); assert.equal(F.calls.fetch.length, 1);
  assert.equal(F.M.open(F.box, { doc: {}, play: {}, pb: null }, F.opts), false, 'no playbook: false');
  const G = fakeWin({ map: sheet() });
  assert.equal(G.M.open(G.box, nell(), Object.assign({}, G.opts, { focus: 'notes' })), false, 'Notes and log: the classic sheet (the printed page has no notes)');
  assert.equal(G.calls.fetch.length, 0, 'and nothing fetched');
});
test('fallback: a map of another schema, a map for another playbook, a missing page', async () => {
  for (const [why, o] of [['schema 2', { map: Object.assign(sheet(), { v: 2 }) }], ['another playbook', { map: sheet('intellectual') }], ['no page', { map: sheet(), img: false }]]) {
    const F = fakeWin(o);
    assert.equal(F.M.open(F.box, nell(), F.opts), true, why);
    await tick();
    assert.equal(F.calls.fallback, 1, why + ': fallback');
    assert.equal(F.M.state(), null, why + ': nothing up');
  }
});
test('a sheet that loads: drawn, and cached for the next open (no second request); update() redraws', async () => {
  const F = fakeWin({ map: sheet() });
  assert.equal(F.M.open(F.box, nell(), F.opts), true);
  await tick();
  assert.equal(F.calls.fallback, 0); assert.equal(F.M.state().ready, true); assert.equal(F.M.state().z, 1);
  assert.equal(F.calls.imgs.length, 1); assert.equal(F.calls.imgs[0].src, 'media/sheets/hound.svg');
  F.M.update(nell());
  assert.equal(F.M.open(F.box, nell(), F.opts), true); await tick();
  assert.equal(F.calls.fetch.length, 1, 'one request for the visit'); assert.equal(F.calls.imgs.length, 1, 'one page'); assert.equal(F.M.state().ready, true);
});

await Promise.all(pending);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
