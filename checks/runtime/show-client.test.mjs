// The show contract on the clients (W0.3 / F6; no browser): the display's registry and renderers (app/display/shows.js, show-beats.js), the lasting
// layers and the data channel to the HTML scenes (app/display/layers.js), the display page's overlay check taking the new kinds
// (app/display-page.js Pure.cleanOverlay), the GM's three commands (app/gm/show.js) and the GM page's gate for them (app/gm-page.js), the design
// tokens (app/tokens.css = app/tokens.js) and the look book's files. INVENTED data only; GM-ONLY- markers for anything that must never appear.
//   node checks/runtime/show-client.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl, writes } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* the browser's globals the UMD files look for */
globalThis.self = globalThis;
const posted = [], listeners = [];
globalThis.location = { origin: 'http://x.test' };
globalThis.addEventListener = (t, fn) => { if (t === 'message') listeners.push(fn); };
globalThis.removeEventListener = (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
const S = require(path.join(APP, 'display', 'shows.js'));
require(path.join(APP, 'display', 'show-beats.js'));
require(path.join(APP, 'display', 'report-beat.js'));
const Lay = require(path.join(APP, 'display', 'layers.js'));
const Tok = require(path.join(APP, 'tokens.js'));
const Show = require(path.join(APP, 'gm', 'show.js'));
const D = require(path.join(APP, 'display-page.js'));
const GP = require(path.join(APP, 'gm-page.js'))._pure;

const doc = { createElement: (t) => { const e = new MiniEl(t); e.style = { setProperty() {} }; return e; }, createElementNS: (ns, t) => doc.createElement(t) };
const KINDS = ['stamp', 'spotted', 'keyturn', 'rolodex', 'title', 'wanted', 'ring', 'spotlight', 'report'];

await test('the registry holds the seven brief beats and the spotlight, each with a label, a fixture that passes its own check, and a default length', () => {
  assert.deepEqual(S.ids().sort(), [...KINDS].sort());
  for (const e of S.entries()) {
    assert.ok(e.label && e.fixture && e.ms >= 1000 && e.ms <= 180000, e.kind);
    const once = S.clean(e.kind, e.fixture); assert.ok(once, e.kind + ': the fixture is a payload the display accepts'); assert.deepEqual(S.clean(e.kind, once), once, e.kind + ': checking is stable');
  }
  assert.equal(S.has('clock'), false); assert.equal(S.has('nope'), false); assert.equal(S.clean('nope', {}), null);
  assert.throws(() => S.register('bad kind', { clean() {}, render() {} })); assert.throws(() => S.register('x', { clean() {} }), /render or bundle/);
});

await test('the display refuses what the server would: bounds, the unjoined NPC shape, and strays', () => {
  assert.equal(S.clean('stamp', { word: 'x'.repeat(25) }), null); assert.equal(S.clean('stamp', {}), null);
  assert.equal(S.clean('wanted', { level: 5 }), null); assert.equal(S.clean('spotted', { text: '' }), null);
  assert.equal(S.clean('rolodex', { npcIds: ['n-mabel'] }), null, 'the STORED shape (ids) is not drawable: only the server-joined cards are');
  assert.equal(S.clean('spotlight', { npcId: 'n-lotte' }), null);
  const r = S.clean('rolodex', { npcs: [{ npcId: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', revealed: false }, { name: 'no id' }, 'junk'] });
  assert.deepEqual(Object.keys(r.npcs[0]).sort(), ['alias', 'faction', 'name', 'npcId', 'role', 'spec'], 'only the joined keys survive'); assert.equal(r.npcs.length, 1, 'a card with no id, and junk, are dropped');
  assert.ok(!JSON.stringify(r).includes('MARKER'));
  assert.equal(S.clean('stamp', { word: 'PAID', stray: 'STRAY-MARKER' }).stray, undefined);
});

await test('every renderer builds a node from its fixture with textContent only: no innerHTML write, markup in a payload is text', async () => {
  writes.length = 0;
  for (const e of S.entries()) {
    const node = await S.mount({ kind: e.kind, payload: e.fixture }, { document: doc, reduced: false });
    assert.ok(node && node.classList.contains('dp-show') && node.classList.contains('dp-show-' + e.kind), e.kind + ' drew');
    assert.equal(node.getAttribute('data-show'), e.kind);
  }
  const evil = await S.mount({ kind: 'title', payload: { text: '<img src=x onerror=alert(1)>', sub: '</p><script>x</script>' } }, { document: doc });
  assert.ok(!/<img|<script/.test(evil.outerHTML), 'escaped: ' + evil.outerHTML); assert.ok(evil.outerHTML.includes('&lt;img'));
  assert.deepEqual(writes, [], 'nothing was written as HTML');
  assert.equal(await S.mount({ kind: 'rolodex', payload: { npcIds: ['n-mabel'] } }, { document: doc }), null, 'an undrawable payload is no beat, not an error');
  assert.equal(await S.mount({ kind: 'nope', payload: {} }, { document: doc }), null);
  const roll = await S.mount({ kind: 'rolodex', payload: S.entry('rolodex').fixture }, { document: doc });
  assert.equal(roll.querySelectorAll('.dp-roll-card').length, 3); assert.ok(roll.outerHTML.includes('Mabel Quist'));
});

await test('a kind with a bundle instead of a renderer loads it through B68Load first, and a failed load is no beat', async () => {
  let asked = [];
  globalThis.B68Load = { need: (n) => { asked.push(n); return n === 'good' ? Promise.resolve().then(() => S.register('lazy', { label: 'Lazy', clean: (p) => p, render: () => { const e = doc.createElement('div'); e.className = 'lazy'; return e; } })) : Promise.reject(new Error('down')); } };
  S.register('lazy', { label: 'Lazy', fixture: {}, bundle: 'good', clean: (p) => p });
  const n = await S.mount({ kind: 'lazy', payload: {} }, { document: doc }); assert.ok(n && n.className === 'lazy'); assert.deepEqual(asked, ['good']);
  S.register('lazy2', { label: 'Lazy 2', fixture: {}, bundle: 'bad', clean: (p) => p });
  assert.equal(await S.mount({ kind: 'lazy2', payload: {} }, { document: doc }), null);
  delete globalThis.B68Load;
});

await test('the display page takes the new kinds in its overlay check (Pure.cleanOverlay) and rejects what does not pass; an old kind is unchanged', () => {
  const P = D.Pure;
  globalThis.B68Shows = S;
  const ok = P.cleanOverlay({ id: 'a', kind: 'stamp', ms: 4000, age: 100, payload: { word: 'PAID', tone: 'orange', stray: 1 }, stray: 'STRAY-MARKER' });
  assert.deepEqual(ok, { id: 'a', kind: 'stamp', ms: 4000, age: 100, payload: { word: 'PAID', tone: 'orange' } });
  assert.equal(P.cleanOverlay({ id: 'a', kind: 'stamp', ms: 4000, payload: { word: '' } }), null);
  assert.equal(P.cleanOverlay({ id: 'a', kind: 'stamp', ms: 90, payload: { word: 'X' } }), null);
  assert.equal(P.cleanOverlay({ id: 'a', kind: 'rolodex', ms: 4000, payload: { npcIds: ['n-mabel'] } }), null, 'an unjoined rolodex never draws');
  assert.equal(P.overlayStep('', { id: 'a', kind: 'ring', ms: 4000, payload: { text: 'x' } }).action, 'show');
  assert.equal(P.overlayStep('a', { id: 'a', kind: 'ring', ms: 4000, payload: {} }).action, 'keep');
  assert.deepEqual(P.cleanOverlay({ id: 't', kind: 'text', ms: 4000, text: ' A  line ' }), { id: 't', kind: 'text', ms: 4000, text: 'A line' });
  delete globalThis.B68Shows;
  assert.equal(P.cleanOverlay({ id: 'a', kind: 'stamp', ms: 4000, payload: { word: 'PAID' } }), null, 'without the registry (an older page) a new kind is not shown');
  globalThis.B68Shows = S;
});

/* ---- layers ---- */
const frame = (scene) => { const f = new MiniEl('iframe'); f.setAttribute('data-scene', scene); f.contentWindow = { postMessage: (m, o) => posted.push({ scene, m, o }) }; return f; };
function container() {
  const c = new MiniEl('div'); c.ownerDocument = doc;
  const amb = new MiniEl('div'); amb.className = 'dp-ambient'; c.appendChild(amb);
  return { c, amb };
}
const LAYERS = { band: { phase: 'plan', security: 3, faces: [{ npcId: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', spec: { v: 1 } }, { pcId: 'pc-nell' }], onair: true },
  scene: { filter: 'flashback', layout: 'montage', mode: 'start' }, data: { countdown: { to: 1760000000000, label: 'Curfew' }, credits: [{ npcId: 'n-lotte', name: 'Lotte Brand', role: 'Doorwoman' }], previously: [{ npcId: 'n-dov', name: 'Dov Kessler', role: 'Desk sergeant' }] } };

await test('layers: clean() keeps names and roles only; the message to a scene carries no id, spec or note; every field is present', () => {
  const c = Lay.clean(LAYERS);
  assert.deepEqual(c.faces, [{ name: 'Mabel Quist', role: 'Fixer' }, { pcId: 'pc-nell' }]);
  assert.deepEqual(c.credits, [{ name: 'Lotte Brand', role: 'Doorwoman' }]); assert.deepEqual(c.previously, [{ name: 'Dov Kessler', role: 'Desk sergeant' }]);
  assert.deepEqual([c.phase, c.security, c.onair, c.filter, c.layout, c.mode], ['plan', 3, true, 'flashback', 'montage', 'start']);
  const m = Lay.message(c); assert.equal(m.type, 'b68:data');
  assert.ok(!/n-mabel|n-lotte|n-dov|"spec"|npcId/.test(JSON.stringify(m)), 'no NPC id or spec reaches a scene');
  const empty = Lay.clean(null); assert.deepEqual([empty.phase, empty.security, empty.onair, empty.faces, empty.countdown], [null, null, false, [], null]);
  assert.equal(Lay.clean({ band: { phase: 'late', security: 9 }, scene: { filter: 'sepia' } }).phase, null, 'a value out of bounds is unset');
  assert.equal(Lay.clean({ band: { faces: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }] } }).faces.length, 3, 'at most three faces');
});

await test('layers: apply() sets the root attributes, draws the strip, posts to the scene frames only when something changed, answers b68:ready and a scene load; clearing removes it all', () => {
  const { c, amb } = container(); const fa = frame('credits'), fb = frame('watch'); amb.appendChild(fa); amb.appendChild(fb);
  posted.length = 0; listeners.length = 0;
  const L = Lay.attach(c, { skew: () => 1000 });
  L.apply(LAYERS);
  assert.deepEqual([c.getAttribute('data-band-phase'), c.getAttribute('data-band-security'), c.getAttribute('data-scene-filter'), c.getAttribute('data-scene-layout'), c.getAttribute('data-scene-mode'), c.getAttribute('data-band-onair')], ['plan', '3', 'flashback', 'montage', 'start', '1']);
  const strip = c.querySelector('.dp-lay-strip'); assert.ok(strip, 'a strip'); assert.ok(strip.textContent.includes('ON AIR') && strip.textContent.includes('Mabel Quist') && strip.textContent.includes('pc-nell'));
  assert.equal(posted.length, 2, 'one message per frame'); assert.equal(posted[0].o, 'http://x.test'); assert.equal(posted[0].m.countdown.to, 1760000000000 - 1000, 'the server epoch less its skew: the iPad clock');
  L.apply(LAYERS); assert.equal(posted.length, 2, 'the same layers again: nothing is posted');
  L.sceneLoaded('credits'); assert.equal(posted.length, 3); assert.equal(posted[2].scene, 'credits');
  assert.equal(listeners.length, 1); listeners[0]({ origin: 'http://x.test', data: { type: 'b68:ready' }, source: fb.contentWindow }); assert.equal(posted.length, 4); assert.equal(posted[3].scene, 'watch');
  listeners[0]({ origin: 'http://evil.test', data: { type: 'b68:ready' }, source: fb.contentWindow }); listeners[0]({ origin: 'http://x.test', data: { type: 'x' }, source: fb.contentWindow }); listeners[0]({ origin: 'http://x.test', data: { type: 'b68:ready' }, source: {} });
  assert.equal(posted.length, 4, 'another origin, another type or an unknown source is ignored');
  L.apply(null);
  assert.equal(c.getAttribute('data-band-phase'), null); assert.equal(c.getAttribute('data-scene-filter'), null); assert.equal(c.getAttribute('data-band-onair'), null); assert.equal(c.querySelector('.dp-lay-strip'), null);
  assert.equal(posted.length, 6, 'clearing is a change: both frames are told');
  L.destroy(); assert.equal(listeners.length, 0, 'destroy removes the listener');
});

await test('layers: with nothing set a scene is told NOTHING (apply(null), a scene load, b68:ready): the ambient scenes\' messages are exactly what they were', () => {
  const { c, amb } = container(); const fa = frame('watch'); amb.appendChild(fa); posted.length = 0; listeners.length = 0;
  const L = Lay.attach(c, {}); L.apply(null); L.apply({}); L.apply({ band: {}, scene: {}, data: {} }); L.sceneLoaded('watch');
  listeners[0]({ origin: 'http://x.test', data: { type: 'b68:ready' }, source: fa.contentWindow });
  assert.equal(posted.length, 0, 'no message: ' + JSON.stringify(posted));
  assert.ok(!c.querySelector('.dp-lay-strip') && c.getAttribute('data-band-phase') === null, 'and nothing drawn');
  L.apply({ scene: { filter: 'flashback' } }); assert.equal(posted.length, 1, 'a layer set: told'); L.apply(null); assert.equal(posted.length, 2, 'cleared: told once, so a scene drops it');
  L.apply(null); L.sceneLoaded('watch'); assert.equal(posted.length, 2, 'and then quiet again'); L.destroy();
});

/* ---- the GM's commands ---- */
await test('GM show(): a key gives the SAME id on every page and sends ifNotOverlay; no key gives a fresh id; a bad payload is refused before it is sent', async () => {
  const sent = [], toasts = [];
  const a = Show.make({ send: (p) => { sent.push(p); return Promise.resolve({ ok: 1 }); }, toast: (m) => toasts.push(m) });
  const b = Show.make({ send: (p) => { sent.push(p); return Promise.resolve({ ok: 1 }); }, toast: () => {} });
  await a.show('stamp', { word: 'PAID' }, { key: 'cue-4#run-1' }); await b.show('stamp', { word: 'PAID' }, { key: 'cue-4#run-1' });
  assert.equal(sent[0].overlay.id, sent[1].overlay.id, 'two pages, one id'); assert.equal(sent[0].ifNotOverlay, sent[0].overlay.id);
  assert.ok(!sent[0].overlay.id.includes('cue') && sent[0].overlay.id.length <= 40, 'the id is opaque');
  assert.equal(sent[0].overlay.ms, 4000, 'the kind\'s default length');
  await a.show('stamp', { word: 'PAID' }); await a.show('stamp', { word: 'PAID' });
  assert.notEqual(sent[2].overlay.id, sent[3].overlay.id, 'no key: each press is its own'); assert.ok(!('ifNotOverlay' in sent[2]));
  assert.equal(Show.idFor('k1'), Show.idFor('k1')); assert.notEqual(Show.idFor('k1'), Show.idFor('k2'));
  const n = sent.length;
  for (const [k, p, o] of [['stamp', {}], ['stamp', { word: 'A', extra: 1 }], ['nope', {}], ['wanted', { level: 9 }], ['stamp', { word: 'A' }, { ms: 5 }], ['rolodex', { npcIds: [] }]]) assert.equal(await a.show(k, p, o), null, k);
  assert.equal(sent.length, n, 'nothing refused was sent'); assert.equal(toasts.length, 6);
  const r = await a.show('rolodex', { npcIds: ['n-mabel'] }, { ms: 12000 }); assert.deepEqual(r, { ok: 1 }); assert.equal(sent[n].overlay.ms, 12000);
});

await test('GM layer() and clear(): known paths and values only; null clears one layer; clear() takes the beat and every layer, or the beat alone', async () => {
  const sent = []; const c = Show.make({ send: (p) => { sent.push(p); return Promise.resolve({}); }, toast: () => {} });
  await c.layer('band.security', 2); await c.layer('band.onair', null);
  assert.deepEqual(sent, [{ layer: { path: 'band.security', value: 2 } }, { layer: { path: 'band.onair', value: null } }]);
  for (const [p, v] of [['band.security', 5], ['nope.path', 1], ['band.faces', []], ['data.credits', ['bad id']], ['data.countdown', { to: 'x' }], ['band.onair', false]]) assert.equal(await c.layer(p, v), null, p);
  assert.equal(sent.length, 2);
  await c.clear(); await c.clear({ layers: false });
  assert.deepEqual(sent.slice(2), [{ overlay: null, layers: null }, { overlay: null }]);
  assert.deepEqual(Show.LAYER_PATHS.sort(), ['band.faces', 'band.onair', 'band.phase', 'band.security', 'data.countdown', 'data.credits', 'data.montage', 'data.previously', 'scene.filter', 'scene.layout', 'scene.mode']);
});

await test('the GM page gate takes the new commands and refuses what names a hidden NPC, an unknown layer, or a loose overlay', () => {
  const gate = GP.makeGate(() => ['GM-ONLY-NPC-1', 'GM-ONLY-ALIAS-1']);
  const ov = (kind, payload) => ({ overlay: { id: 'a', kind, ms: 4000, payload } });
  assert.equal(gate.allowsAmbient(ov('stamp', { word: 'PAID' })), true); assert.equal(gate.allowsAmbient({ ...ov('rolodex', { npcIds: ['n-mabel'] }), ifNotOverlay: 'a' }), true);
  assert.equal(gate.allowsAmbient(ov('stamp', { word: 'PAID', extra: 1 })), false, 'a stray key');
  assert.equal(gate.allowsAmbient(ov('title', { text: 'Welcome gm-only-npc-1' })), false, 'free text naming a hidden NPC'); assert.equal(gate.allowsAmbient(ov('title', { text: 'Welcome Lotte' })), true);
  assert.equal(gate.allowsAmbient({ overlay: { id: 'a', kind: 'stamp', ms: 4000, payload: { word: 'X' }, text: 'x' } }), false, 'an extra field on the overlay');
  assert.equal(gate.allowsAmbient({ layer: { path: 'band.phase', value: 'plan' } }), true); assert.equal(gate.allowsAmbient({ layer: { path: 'band.phase', value: 'late' } }), false);
  assert.equal(gate.allowsAmbient({ layer: { path: 'data.countdown', value: { to: 1760000000000, label: 'GM-ONLY-ALIAS-1' } } }), false);
  assert.equal(gate.allowsAmbient({ layer: { path: 'nope', value: 1 } }), false); assert.equal(gate.allowsAmbient({ layers: null }), true); assert.equal(gate.allowsAmbient({ layers: {} }), false);
  assert.equal(gate.allowsAmbient({ layer: { path: 'band.phase' } }), false, 'a layer with no value');
  assert.equal(GP.overlayOk({ id: 'a', kind: 'fx', ms: 4000, fx: 'dawn' }), true, 'an old kind is still fine');
  assert.match(GP.overlayLine({ id: 'a', kind: 'stamp', ms: 4000, payload: { word: 'X' } }), /stamp/);
});

/* ---- tokens and the look book ---- */
await test('tokens: app/tokens.css and app/tokens.js carry the same values; every name is --b68-; the old stylesheets use none of them', () => {
  const css = fs.readFileSync(path.join(APP, 'tokens.css'), 'utf8');
  const got = {}; for (const m of css.matchAll(/(--b68-[a-z0-9-]+)\s*:\s*([^;]+);/g)) got[m[1]] = m[2].trim();
  const want = Tok.vars();
  for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, k + ' differs between tokens.css and tokens.js');
  const extra = Object.keys(got).filter((k) => !(k in want)); assert.deepEqual(extra.sort(), ['--b68-font-cond', '--b68-font-mono', '--b68-font-poster', '--b68-font-text'], 'only the font stacks are css-only');
  for (const need of ['--b68-paper', '--b68-ink', '--b68-orange', '--b68-rules-blue', '--b68-faction-1', '--b68-faction-6', '--b68-t-label', '--b68-t-stamp']) assert.ok(need in got, need);
  assert.deepEqual(Tok.faction(2), { fill: '#3f62c4', ink: '#fbf8f1' }); assert.equal(Tok.faction(7), null);
  assert.ok(Tok.css().includes('--b68-paper: #f2ede1;'));
  for (const f of fs.readdirSync(APP).filter((x) => x.endsWith('.css') && !['tokens.css', 'lookbook.css'].includes(x))) assert.ok(!fs.readFileSync(path.join(APP, f), 'utf8').includes('--b68-'), f + ' is old CSS and stays untouched');
  const sizes = [...fs.readFileSync(path.join(APP, 'display', 'shows.css'), 'utf8').matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)vmin/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length === 0 || Math.min(...sizes) >= 3.4, 'no text on a show is set below the label size');
});

await test('the look book: GM only, in the lookbook bundle, every file exists, and a frame for every registered kind', () => {
  const routes = fs.readFileSync(path.join(APP, 'routes.js'), 'utf8');
  const ctx = vm.createContext({}); vm.runInContext(routes, ctx); const B = ctx.B68Load.BUNDLES;
  assert.ok(Array.isArray(B.lookbook) && B.lookbook.includes('display/lookbook.js') && B.lookbook.includes('display/show-beats.js'));
  for (const f of [...B.lookbook, ...B.display, ...B.gm]) assert.ok(fs.existsSync(path.join(APP, f)), f);
  const lb = fs.readFileSync(path.join(APP, 'lookbook.html'), 'utf8'), boot = fs.readFileSync(path.join(APP, 'lookbook-boot.js'), 'utf8');
  assert.ok(!/<script(?![^>]*src=)/.test(lb), 'no inline script (the report-only CSP asks for script-src self)');
  assert.ok(/api\/me/.test(boot) && /role !== 'gm'/.test(boot) && /GM only/.test(boot), 'the page asks /api/me and draws nothing for anyone but the GM');
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8'); assert.ok(!/lookbook/.test(sw), 'sw.js learns its files from routes.js');
  assert.ok(!B.core.concat(B.table, B.figures).some((f) => /lookbook|display\/|gm\/show/.test(f)), 'players never fetch a GM or display file');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
