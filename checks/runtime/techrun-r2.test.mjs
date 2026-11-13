// The tech run (06/11/2026), builder R2: what the iPad draws (no browser, no network, no key). INVENTED data only; GM-ONLY- markers for anything hidden.
//   T9  the band across the top is a setting (display.band) that starts off: no strip, no dp-lay-on, the lamp in its own corner; on, the strip as before
//   T6  the score scenes fit the site whole in any frame (the 4:3 cover and the floor-by-floor pan are gone)
//   T7  each montage panel is joined to its character's figure (the Worker) and draws it (the iPad); no figure, the initial on the panel's colour
//   T8  no 3D flip on the Introduce card; a framed face's duotone sits inside its svg, not as a CSS filter on the HTML holder
//   T17 the Aftermath's Seen tonight draws each revealed face over its name; a hidden person never reaches it
//   node checks/runtime/techrun-r2.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as ambientHandler } from '../../functions/api/gm/ambient.js';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const req = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

globalThis.self = globalThis;
globalThis.location = { origin: 'http://x.test' };
const listeners = [];
globalThis.addEventListener = (t, fn) => { if (t === 'message') listeners.push(fn); };
globalThis.removeEventListener = () => {};
/* a B68Flags the tests drive (the real one is app/sheet/flags.js) */
const Flags = req(path.join(APP, 'sheet', 'flags.js'));
globalThis.B68Flags = Flags;
const F = req(path.join(APP, 'features.js'));
const Set_ = req(path.join(APP, 'gm', 'settings.js'));
const DM = req(path.join(APP, 'display', 'montage.js'));
globalThis.B68DisplayMontage = DM;
const Lay = req(path.join(APP, 'display', 'layers.js'));
const S = req(path.join(APP, 'display', 'shows.js'));
req(path.join(APP, 'display', 'show-beats.js'));
/* each kind's renderer, kept as aftermath.js registers it (the page reaches it through mount()) */
const KIND = {};
{ const Sh = globalThis.B68Shows || S, orig = Sh.register; Sh.register = function (k, spec) { KIND[k] = spec; return orig.call(this, k, spec); }; req(path.join(APP, 'display', 'aftermath.js')); Sh.register = orig; }

const doc = { createElement: (t) => { const e = new MiniEl(t); e.style = { setProperty() {} }; return e; }, createElementNS: (ns, t) => doc.createElement(t) };
function box() { const c = new MiniEl('div'); c.ownerDocument = doc; const amb = new MiniEl('div'); amb.className = 'dp-ambient'; c.appendChild(amb); return c; }
const LAYERS = { band: { phase: 'score', security: 2, faces: [{ pcId: 'pc-nell', name: 'Nell Arbuthnot', stress: 4, harm: [1] }, { pcId: 'pc-ray', name: 'Ray Okonjo', stress: 2 }] } };
const find = (n, cls) => { if (!n || !n.children) return null; for (const c of n.children) { if (c.className && (' ' + c.className + ' ').includes(' ' + cls + ' ')) return c; const d = find(c, cls); if (d) return d; } return null; };
const all = (n, cls, out = []) => { if (!n || !n.children) return out; for (const c of n.children) { if (c.className && (' ' + c.className + ' ').includes(' ' + cls + ' ')) out.push(c); all(c, cls, out); } return out; };

/* ---------- T9 ---------- */
await test('T9: display.band is a display SETTING that starts off (absent reads off), is published to the iPad, and old documents need nothing new', () => {
  const s = F.get('display.band');
  assert.ok(s && s.surface === 'display' && s.setting === true && s.default === false, JSON.stringify(s));
  assert.equal(F.valueOf({}, 'display.band'), false, 'nothing stored: off');
  assert.equal(F.valueOf({ features: { 'display.band': true } }, 'display.band'), true);
  assert.deepEqual(F.publicView({}), Object.assign({}, F.publicView({})), 'the view is built the same');
  assert.equal(F.publicView({})['display.band'], undefined, 'absent stays absent (reads off on the iPad)');
  assert.equal(F.publicView({ 'display.band': true })['display.band'], true);
  assert.deepEqual(F.patchFor({}, 'display.band', true), { features: { 'display.band': true } }, 'a new optional key, nothing else');
  assert.deepEqual(F.publishMap({}, {}), F.publishMap({}, {}), 'off and never stored: not written');
  assert.ok(!('display.band' in F.publishMap({}, {})), 'off and never stored: the campaign document is untouched');
});

await test('T9: the iPad view Settings has a Band row (Off / On) beside Scenes, Music, Phones and Mirror, and choosing On writes the setting', async () => {
  const rows = Set_.ROWS.map((r) => r.key);
  assert.deepEqual(rows, ['fx.off', 'room.music', 'phoneCards', 'mirror', 'display.band', 'kit.desk', 'kit.stage', 'kit.phone', 'night.who', 'blade.pitches',
    'map.fill', 'map.people', 'map.lights', 'map.room']);      /* KS01.1: the kit's five after Band; MK1: the four map rows after them */
  let state = {}, published = null;
  const ctl = Set_.create({ F, doc: () => state, patch: (p) => { state = Object.assign({}, state, { features: Object.assign({}, state.features, p.features) }); return true; },
    campaign: () => ({ features: {} }), publish: (m) => { published = m; return Promise.resolve(true); }, toast() {}, redraw() {} });
  const band = ctl.rows().find((r) => r.key === 'display.band');
  assert.equal(band.label, 'Band'); assert.equal(band.value, false); assert.deepEqual(band.options.map((o) => o.label), ['Off', 'On']);
  assert.equal(ctl.choose('display.band', true), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.features['display.band'], true); assert.equal(published && published['display.band'], true, 'copied to the campaign document for the iPad');
});

await test('T9: with the band off the strip is never drawn and the root never carries dp-lay-on; the lamp is refused (it draws in its own corner); turning it on draws the strip at once', () => {
  Flags.reset(); globalThis.B68Flags = Flags;
  const c = box();
  const L = Lay.attach(c, { skew: () => 0, band: () => Flags.on('display.band') });
  L.apply(LAYERS);
  assert.equal(find(c, 'dp-lay-strip'), null, 'no strip'); assert.ok(!c.classList.contains('dp-lay-on'), 'nothing laid out below a strip');
  assert.equal(c.getAttribute('data-band-phase'), 'score', 'the attributes are the same either way');
  assert.equal(Lay.mic(c, { off: false, text: 'On air' }), false, 'the lamp is refused: onair.js draws its own');
  Flags.apply({ 'display.band': true });
  assert.ok(find(c, 'dp-lay-strip'), 'on: the strip'); assert.ok(c.classList.contains('dp-lay-on'));
  assert.ok(find(c, 'dp-lay-strip').textContent.includes('Nell'));
  assert.equal(Lay.mic(c, { off: false, text: 'On air' }), true, 'on: the strip takes the lamp');
  Flags.apply({ 'display.band': false });
  assert.equal(find(c, 'dp-lay-strip'), null, 'off again: gone'); assert.ok(!c.classList.contains('dp-lay-on'));
  L.destroy(); Flags.reset();
});

await test('T9: without a band option (the look book, older callers) the strip draws as before', () => {
  const c = box(); const L = Lay.attach(c, { skew: () => 0 }); L.apply(LAYERS);
  assert.ok(find(c, 'dp-lay-strip')); assert.ok(c.classList.contains('dp-lay-on')); L.destroy();
});

await test('T9: the display page asks the setting for the band; the ambient scenes sit below the strip only while it is up', () => {
  assert.match(read('display-page.js'), /band: function \(\) \{ return swOn\('display\.band'\); \}/);
  assert.match(read('display/shows.css'), /\.dp-root\.dp-lay-on \.dp-ambient \{ top: var\(--dp-lay-h\); \}/);
});

/* ---------- T6 ---------- */
await test('T6: the score scenes fill their frame and fit the site whole (no 4:3 cover, no slice, no floor-by-floor travel), and refit on a resize', () => {
  for (const f of ['ambient/planning-board.html', 'ambient/score-exploded.html']) {
    const h = read(f);
    assert.ok(!/width:max\(100%,133\.334vh\)/.test(h), f + ': the 4:3 cover is gone');
    assert.ok(!/preserveAspectRatio="xMidYMid slice"/.test(h), f + ': no slice');
    assert.match(h, /preserveAspectRatio="xMidYMid meet"/, f + ': the world is contained');
    assert.match(h, /\.stage\{position:absolute;inset:0;overflow:hidden\}/, f + ': the stage is the frame');
    assert.match(h, /addEventListener\("resize",/, f + ': it refits on a resize');
    assert.match(h, /function visible\(\)\{const w=innerWidth\|\|4,h=innerHeight\|\|3,a=w\/h;return a>=4\/3\?\{hw:600\*a,hh:600\}:\{hw:800,hh:800\/a\};\}/, f + ': the visible world from the frame');
  }
  assert.ok(!/travel/.test(read('ambient/score-exploded.html')), 'the exploded site no longer pans a drawing taller than the frame');
});

await test('T6: the fit is right for the live board shape at 1024x768 and 768x1024 (the sheet and its polaroids inside the visible world, with the drift)', () => {
  const vis = (w, h) => { const a = w / h; return a >= 4 / 3 ? { hw: 600 * a, hh: 600 } : { hw: 800, hh: 800 / a }; };
  const vb = [0, 0, 369.09, 261.38], bw = 1220, bh = bw * vb[3] / vb[2], by = 120, foot = Math.max(by + bh, by + bh - 70 + 16 + 9 + 228), AX = 44, AY = 28, WOB = 0.03;
  const box_ = { w: bw + 40, h: foot - by };
  for (const [w, h] of [[1024, 768], [768, 1024], [1024, 691], [768, 947]]) {
    const v = vis(w, h), base = Math.min(1.16, 0.96 * v.hw / (box_.w / 2 + AX), 0.96 * v.hh / (box_.h / 2 + AY)) / (1 + WOB), s = base * (1 + WOB);
    assert.ok((box_.w / 2 + AX) * s <= v.hw, w + 'x' + h + ': the width fits'); assert.ok((box_.h / 2 + AY) * s <= v.hh, w + 'x' + h + ': the height fits');
  }
});

/* ---------- T7 ---------- */
const GM = { me: { role: 'gm', email: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test' } };
async function freshDb() { const raw = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); return { prepare: (q) => raw.prepare(q), batch: (l) => raw.batch(l), raw }; }
const call = async (db, handler, method, url, body, who = GM) => {
  try { return await handler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: { DB: db }, data: who, waitUntil() {} }); }
  catch (e) { if (e && Number.isInteger(e.status)) return new Response(JSON.stringify({ error: e.message }), { status: e.status }); throw e; }
};
const patch = async (db, body) => { const r = await call(db, ambientHandler, 'PATCH', '/api/gm/ambient', body); return { status: r.status, body: await r.json() }; };
const getDisplay = async (db) => { const r = await call(db, displayHandler, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1', undefined, DISPLAY); return { status: r.status, body: await r.json() }; };
const now = new Date().toISOString();
async function addRow(db, table, id, d) { await db.raw.prepare('INSERT INTO ' + table + ' (id, campaign, created_at, updated_at, deleted, doc) VALUES (?1, ?2, ?3, ?3, 0, ?4)').bind(id, 'default', now, JSON.stringify(d)).run(); }
const FIG = { figure: 'fem', skin: 'olive', heightIn: 65, age: 31, hair: { style: 'bun', color: 'cloth-chocolate' }, outfit: {} };

await test('T7: the display GET joins each montage panel to its character\'s figure (the figure keys only, never a sheet field); a panel with no character is served as stored', async () => {
  const db = await freshDb();
  await addRow(db, 'characters', 'pc-nell', { v: 2, name: 'Nell Arbuthnot', spec: { ...FIG, id: 'pc-nell', name: 'Nell Arbuthnot' }, sheet: { vice: 'GM-ONLY-SHEET-FIELD' }, play: { stress: 4 } });
  const v = { panels: [{ pcId: 'pc-nell', name: 'Nell', room: 'The bar', line: 'A line' }, { pcId: 'pc-nobody', name: 'Quill' }] };
  assert.equal((await patch(db, { layer: { path: 'data.montage', value: v } })).status, 200);
  const g = (await getDisplay(db)).body, p = g.layers.data.montage.panels;
  assert.equal(p.length, 2);
  assert.equal(p[0].spec.figure, 'fem'); assert.equal(p[0].spec.heightIn, 65); assert.ok(!('name' in p[0].spec) && !('id' in p[0].spec), 'the figure keys only');
  assert.deepEqual(p[1], { pcId: 'pc-nobody', name: 'Quill' }, 'no character: as stored');
  assert.ok(!JSON.stringify(g).includes('GM-ONLY'), 'no sheet field is served');
});

await test('T7: the iPad keeps the figure through B68Layers and the montage draws it on the panel\'s colour; no figure keeps the initial (never a blank card)', () => {
  const c = box(); const drawn = [];
  const L = Lay.attach(c, { skew: () => 0, figure: (spec, id) => { drawn.push(id); const s = new MiniEl('svg'); s.setAttribute('data-fig', id); return s; } });
  L.apply({ data: { montage: { panels: [{ pcId: 'pc-nell', name: 'Nell', spec: FIG }, { pcId: 'pc-ray', name: 'Ray' }] } }, scene: { layout: 'montage' } });
  const m = find(c, 'dp-montage'); assert.ok(m, 'drawn');
  const pics = all(m, 'dp-mt-pic'); assert.equal(pics.length, 2);
  assert.ok(pics[0].className.includes('dp-mt-pic-fig') && pics[0].children[0].tagName === 'SVG', 'the figure');
  assert.deepEqual(drawn, ['pc-nell']);
  assert.equal(find(pics[1], 'dp-mt-fig').textContent, 'R', 'no figure: the initial');
  assert.ok(!('spec' in L.message()), 'the scenes are never sent it');
  L.destroy();
  const css = read('display/montage.css');
  assert.match(css, /\.dp-mt-pic \{[^}]*background: var\(--b68-rules-blue\)/, 'the picture sits on a colour, not paper');
  assert.match(read('display-page.js'), /figure: function \(spec, id\) \{ var r = drawFigure\(spec, 'dp-mt-'/, 'the page hands the montage its cleaned figure drawer');
});

/* ---------- T8 ---------- */
await test('T8: the Introduce card rises flat (no 3D turn or perspective anywhere on the display), its face is larger', () => {
  const css = read('display/face-cards.css');
  for (const f of ['display.css', ...fs.readdirSync(path.join(APP, 'display')).filter((x) => x.endsWith('.css')).map((x) => 'display/' + x)]) {
    const t = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/rotateX|rotateY|rotate3d|perspective\s*:|preserve-3d/.test(t), f + ': no 3D');
  }
  assert.match(css, /\.dp-rc-card \{[^}]*transform: translateY\(6vmin\); opacity: 0; \}/);
  assert.match(css, /\.dp-rc-face \{ flex: none; width: 19vmin; height: 19vmin;/);
});

await test('T8: a framed face\'s duotone is a filter on a group INSIDE its svg (drawn at the screen\'s resolution), not a CSS filter on the HTML holder', () => {
  globalThis.B68FaceLook = req(path.join(APP, 'display', 'face-look.js'));
  const FM = req(path.join(APP, 'display', 'face-formats.js'));
  const e = doc.createElement('div'); const holder = doc.createElement('div'); holder.className = 'dp-ov-portrait'; holder.style = { setProperty() {} };
  const sv = doc.createElement('svg'); const g0 = doc.createElement('path'); sv.appendChild(g0); holder.appendChild(sv); e.appendChild(holder);
  holder.querySelector = (q) => (q === 'svg' ? sv : null);
  FM.wrap(doc, e, holder, 'licence', { name: 'Ada Vell', role: 'Croupier', faction: 'The Pelican Rooms', id: 'npc-ada', num: '', slot: 0, uid: 'u1' });
  assert.equal(holder.style.filter, undefined, 'no CSS filter on the holder');
  assert.equal(sv.children.length, 1); assert.equal(sv.children[0].tagName, 'G');
  assert.match(sv.children[0].getAttribute('filter'), /^url\(#dp-fl-duo-/); assert.equal(sv.children[0].children[0], g0, 'the drawing moved inside it');
});

/* ---------- T17 ---------- */
await test('T17: Seen tonight draws each face with the beat env\'s portrait renderer over its name; a card without a figure is the name alone', () => {
  const asked = [];
  const env = { document: doc, reduced: true, portrait: (spec, id) => { asked.push(id); return doc.createElement('svg'); } };
  const p = S.clean('credits', { npcs: [{ npcId: 'n-mabel', name: 'Mabel Quist', role: 'The house', spec: FIG }, { npcId: 'n-dov', name: 'Dov Kessler', role: 'House security' }] });
  assert.ok(p && KIND.credits, 'the credits kind is registered and its payload passes');
  const rendered = KIND.credits.render(p, env);
  const rows = all(rendered, 'dp-cr-row'); assert.equal(rows.length, 2);
  assert.ok(find(rows[0], 'dp-cr-face'), 'a face over the first name'); assert.equal(find(rows[1], 'dp-cr-face'), null, 'no figure: no face box');
  assert.deepEqual(asked, ['cr-n-mabel']);
  assert.match(read('display/aftermath.css'), /\.dp-cr-face \{ width: 22vmin; height: 22vmin;/);
});

await test('T17: the server serves the credits joined to REVEALED NPCs with their figure; a hidden one is dropped before the iPad sees it', async () => {
  const db = await freshDb();
  await addRow(db, 'npcs', 'n-mabel', { name: 'Mabel Quist', role: 'The house', revealed: true, spec: FIG });
  await addRow(db, 'npcs', 'n-hid', { name: 'GM-ONLY-NPC-1', role: 'GM-ONLY-ROLE', revealed: false, spec: FIG });
  assert.equal((await patch(db, { overlay: { id: 'k-cr-1', kind: 'credits', ms: 60000, payload: { npcIds: ['n-mabel', 'n-hid'] } } })).status, 200);
  const g = (await getDisplay(db)).body, ov = g.overlay || (g.ambient && g.ambient.doc && g.ambient.doc.overlay);
  assert.ok(ov && ov.payload && Array.isArray(ov.payload.npcs), JSON.stringify(g).slice(0, 300));
  assert.deepEqual(ov.payload.npcs.map((c) => c.npcId), ['n-mabel']); assert.equal(ov.payload.npcs[0].spec.figure, 'fem');
  assert.ok(!JSON.stringify(g).includes('GM-ONLY'));
});


console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
