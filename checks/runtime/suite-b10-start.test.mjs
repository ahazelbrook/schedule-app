// Suite B10, ticket 1.2 (the hard start, switch spine.start; no browser, no network): the display's phases on a fake clock, the GM controller against a fake server
// that joins to revealed NPCs only, and the picking rules. INVENTED data only (the Pelican Rooms cast); GM-ONLY- markers for anything that must never appear.
//   node checks/runtime/suite-b10-start.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a document the UMD files can draw into */
function fakeDoc() {
  const d = { hidden: false, listeners: {}, createElement: (t) => { const e = new MiniEl(t); e.ownerDocument = d; e.style = {}; e.addEventListener = (t, fn) => { (e.listeners = e.listeners || {})[t] = [fn]; }; return e; }, createElementNS: (ns, t) => d.createElement(t),
    addEventListener(t, f) { (d.listeners[t] = d.listeners[t] || []).push(f); }, removeEventListener() {} };
  return d;
}
globalThis.self = globalThis;
globalThis.location = { origin: 'http://x.test' };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};

const Layers = require(path.join(APP, 'display', 'layers.js'));
const HS = require(path.join(APP, 'display', 'hardstart.js'));
const GHS = require(path.join(APP, 'gm', 'hardstart.js'));
const Show = require(path.join(APP, 'gm', 'show.js'));
const F = require(path.join(APP, 'features.js'));

/* ---------- the cast: revealed and hidden ---------- */
const NPCS = {
  n1: { name: 'Mabel Quist', role: 'Fixer', revealed: true, firstSeen: '2026-10-01T10:00:00.000Z' },
  n2: { name: 'Dov Kessler', role: 'Desk sergeant', revealed: true, firstSeen: '2026-10-08T10:00:00.000Z' },
  n3: { name: 'Ines Ardal', role: 'Cabbie', revealed: true, firstSeen: '2026-10-15T10:00:00.000Z' },
  n4: { name: 'Pip Tolliver', role: 'Bookmaker', revealed: true, firstSeen: '2026-10-22T10:00:00.000Z' },
  n5: { name: 'Wren Oake', role: 'Courier', revealed: true, firstSeen: '2026-10-29T10:00:00.000Z' },
  hid: { name: 'GM-ONLY-Hidden Name', role: 'GM-ONLY-role', revealed: false, firstSeen: null },
  oldHid: { name: 'GM-ONLY-Was Revealed', role: 'GM-ONLY-x', revealed: false, firstSeen: '2026-11-01T10:00:00.000Z' }
};

/* a fake server for the layers: applies what the GM sends, joins to revealed NPCs only (as functions/_lib/show.js does), serves the display's `layers` */
function fakeTable(npcs) {
  const lay = {}, writes = [];
  const card = (id) => (npcs[id] && npcs[id].revealed === true ? { npcId: id, name: npcs[id].name, role: npcs[id].role } : null);
  const table = {
    writes, lay,
    async layer(p, v) {
      assert.ok(Show.layerOk(p, v), 'the write is one the contract takes: ' + p);
      writes.push([p, JSON.parse(JSON.stringify(v))]);
      const [g, k] = p.split('.');
      if (v === null) { if (lay[g]) { delete lay[g][k]; if (!Object.keys(lay[g]).length) delete lay[g]; } } else (lay[g] = lay[g] || {})[k] = v;
      return { ok: true };
    },
    served() {   /* what the display GET carries as `layers` */
      const out = {};
      const add = (g, k, v) => { (out[g] = out[g] || {})[k] = v; };
      for (const g of Object.keys(lay)) for (const k of Object.keys(lay[g])) {
        const v = lay[g][k];
        if (g === 'band' && k === 'faces') { const f = v.map((x) => card(x.npcId)).filter(Boolean).map((c) => ({ name: c.name, role: c.role })); if (f.length) add(g, k, f); }
        else if (g === 'data' && (k === 'credits' || k === 'previously')) { const r = v.map(card).filter(Boolean).map((c) => ({ name: c.name, role: c.role })); if (r.length) add(g, k, r); }
        else add(g, k, v);
      }
      return Object.keys(out).length ? out : null;
    }
  };
  return table;
}

/* ================= 1.2 the hard start ================= */
await test('phases follow the clock: card, fuse (4 s at most), credits, previously; nothing without scene.mode', () => {
  const to = 1_000_000;
  const st = { mode: 'start', countdown: { to }, credits: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], previously: [{ name: 'A' }], faces: [] };
  assert.equal(HS.phaseAt({ mode: null, countdown: { to } }, to).phase, null);
  assert.deepEqual(HS.phaseAt({ mode: 'start' }, to), { phase: 'card', left: null });
  assert.equal(HS.phaseAt(st, to - 5000).phase, 'card'); assert.equal(HS.phaseAt(st, to - 5000).left, 5000);
  assert.equal(HS.phaseAt(st, to).phase, 'fuse');
  assert.ok(HS.FUSE_MS <= 4000);
  assert.equal(HS.phaseAt(st, to + HS.FUSE_MS - 1).phase, 'fuse');
  assert.equal(HS.phaseAt(st, to + HS.FUSE_MS).phase, 'credits');
  const cm = HS.creditsMs(3);
  assert.equal(HS.phaseAt(st, to + HS.FUSE_MS + cm - 1).phase, 'credits');
  assert.equal(HS.phaseAt(st, to + HS.FUSE_MS + cm).phase, 'previously');
  assert.equal(HS.phaseAt(st, to + 10 * 3600_000).phase, 'previously', 'it stays until the GM ends it');
  assert.equal(HS.phaseAt({ ...st, credits: [] }, to + HS.FUSE_MS).phase, 'previously', 'no credits: skipped');
  assert.equal(HS.phaseAt({ ...st, credits: [], previously: [] }, to + HS.FUSE_MS).phase, 'cold', 'nothing to show: the cold open');
  assert.equal(HS.clockText(4_000), '0:04'); assert.equal(HS.clockText(61_000), '1:01'); assert.equal(HS.clockText(3_723_000), '1:02:03'); assert.equal(HS.clockText(-5), '0:00');
});

await test('end to end on a fake clock: countdown, fuse, credits, three blank plates, three reveals, end (display reads what the server serves)', async () => {
  const table = fakeTable(NPCS);
  let t = 5_000_000;
  const host = { layer: (p, v) => table.layer(p, v), npcs: () => NPCS, now: () => t, startAt: () => t + 600_000 };
  const ctl = GHS.make(host);
  assert.deepEqual(ctl.picks(), ['n5', 'n4', 'n3'], 'the three revealed most recently');
  assert.equal(await ctl.arm(host.startAt()), true);

  const doc = fakeDoc(), box = new MiniEl('div'); box.ownerDocument = doc; box.querySelectorAll = () => []; box.setAttribute = () => {}; box.removeAttribute = () => {};
  const layers = Layers.attach(box, { skew: () => 0 });
  const hs = HS.attach(box, { layers, now: () => t });
  const show = () => { layers.apply(table.served()); hs.update(); };
  const text = () => box.textContent;
  const phase = () => { const n = box.children.find((c) => c.className.includes('dp-hs ')); return n ? n.getAttribute('data-hs') : null; };

  show();
  assert.equal(phase(), 'card'); assert.match(text(), /10:00/, 'the station clock counts down to the start');
  t += 1000; show(); assert.match(text(), /9:59/);
  t += 598_000; show(); assert.match(text(), /0:01/);
  t += 1000; show(); assert.equal(phase(), 'fuse', 'at zero the fuse burns');
  t += HS.FUSE_MS - 1; show(); assert.equal(phase(), 'fuse');
  t += 1; show(); assert.equal(phase(), 'credits');
  assert.match(text(), /Wren Oake/, 'the credits are revealed NPCs, newest first');
  t += HS.creditsMs(5); show(); assert.equal(phase(), 'previously');
  let faces = box.children.find((c) => c.className.includes('dp-hs ')).children.find((c) => c.className.includes('dp-hs-faces'));
  assert.equal(faces.children.length, 3, 'three faces');
  assert.ok(faces.children.every((f) => f.children.find((c) => c.className === 'dp-hs-name').children.length === 0), 'three blank name plates');
  assert.doesNotMatch(text(), /Wren Oake|Pip Tolliver|Ines Ardal/, 'no name is on the page yet');

  for (const [i, nm] of [[0, 'Wren Oake'], [1, 'Pip Tolliver'], [2, 'Ines Ardal']]) {
    assert.equal(await ctl.reveal(i), true); show();
    assert.match(text(), new RegExp(nm), 'face ' + (i + 1) + ' is named after one tap');
    faces = box.children.find((c) => c.className.includes('dp-hs ')).children.find((c) => c.className.includes('dp-hs-faces'));
    const named = faces.children.filter((f) => f.children.find((c) => c.className === 'dp-hs-name').children.length > 0).length;
    assert.equal(named, i + 1, (i + 1) + ' plate(s) shown, the rest still blank');
  }
  assert.deepEqual(table.lay.band.faces, [{ npcId: 'n5' }, { npcId: 'n4' }, { npcId: 'n3' }]);

  assert.equal(await ctl.end(), true); show();
  assert.equal(phase(), null, 'the cold open: nothing of the hard start is left on the page');
  assert.equal(table.served(), null, 'every layer it set is gone');
  hs.destroy();
});

await test('GO runs the same path as zero; a reloaded iPad lands in the right phase', async () => {
  const table = fakeTable(NPCS); let t = 9_000_000;
  const ctl = GHS.make({ layer: table.layer, npcs: () => NPCS, now: () => t, startAt: () => t + 3_600_000 });
  assert.equal(await ctl.go(), false, 'nothing to GO before it is armed');
  await ctl.arm(t + 3_600_000);
  t += 5000; assert.equal(await ctl.go(), true);
  assert.equal(table.lay.data.countdown.to, t, 'GO lays the clock at now');
  const st = { mode: 'start', countdown: table.lay.data.countdown, credits: [], previously: [{ name: 'x' }] };
  assert.equal(HS.phaseAt(st, t + 1).phase, 'fuse');
});

await test('a hidden NPC cannot be picked, listed, credited or revealed; a stale pick falls away', async () => {
  const table = fakeTable(NPCS);
  const live = JSON.parse(JSON.stringify(NPCS));
  const ctl = GHS.make({ layer: table.layer, npcs: () => live, now: () => 1, startAt: () => 0 });
  assert.ok(ctl.pool().every((p) => !/GM-ONLY/.test(p.name + p.role)), 'the pool has revealed NPCs only');
  assert.equal(ctl.setPick(0, 'hid'), false); assert.equal(ctl.setPick(0, 'oldHid'), false); assert.equal(ctl.setPick(0, 'nope'), false);
  assert.equal(ctl.setPick(0, 'n1'), true); assert.deepEqual(ctl.picks().slice(0, 1), ['n1']);
  assert.equal(ctl.setPick(1, 'n1'), false, 'one face, one slot');
  await ctl.arm(2_000_000);
  const sent = JSON.stringify(table.writes);
  assert.doesNotMatch(sent, /hid|oldHid|GM-ONLY/, 'no hidden id is ever written');
  live.n1.revealed = false;                                   /* un-revealed after the pick */
  assert.ok(!ctl.picks().includes('n1'), 'a pick that went hidden drops out');
  await ctl.reveal(0);
  assert.ok(!JSON.stringify(table.lay.band.faces || []).includes('n1'), 'and is not revealed');
  /* the server's own join drops a hidden id even if one were written: the display never gets its name */
  table.lay.data.previously = ['hid', 'n2']; const served = JSON.stringify(table.served()); assert.doesNotMatch(served, /GM-ONLY/);
});

await test('"Test: start in 2 minutes" never touches the night: only the show layers are written, and the real start time is unread', async () => {
  const table = fakeTable(NPCS); let t = 7_000_000, readStart = 0;
  const ctl = GHS.make({ layer: table.layer, npcs: () => NPCS, now: () => t, startAt: () => { readStart++; return t + 9_999_999; } });
  assert.equal(await ctl.armTest(), true);
  assert.equal(table.lay.data.countdown.to, t + 120_000); assert.equal(table.lay.data.countdown.label, 'Test'); assert.equal(ctl.state().test, true);
  assert.equal(readStart, 0, 'the night\'s startAt is not read');
  assert.ok(table.writes.every(([p]) => GHS.PATHS.includes(p)), 'only the five show layers');
  const hostKeys = Object.keys({ layer: 1 });
  assert.ok(hostKeys.length === 1);
});

await test('the strip does not give a plate away: names are hidden in start mode by CSS, and the plates match name+role only', () => {
  const css = fs.readFileSync(path.join(APP, 'display', 'hardstart.css'), 'utf8');
  assert.match(css, /\[data-scene-mode="start"\] \.dp-lay-face \{ display: none; \}/);
  const st = { previously: [{ name: 'A', role: 'x' }, { name: 'A', role: 'y' }], faces: [{ name: 'A', role: 'y' }] };
  assert.deepEqual(HS.plates(st).map((p) => p.revealed), [false, true]);
});

await test('"Previously on" draws each face\'s portrait from its served spec (plates still blank); a silhouette with no spec or before the kit; the kit arriving redraws', () => {
  const doc = fakeDoc(), box = new MiniEl('div'); box.ownerDocument = doc; box.querySelectorAll = () => []; box.setAttribute = () => {}; box.removeAttribute = () => {};
  const layers = Layers.attach(box, { skew: () => 0 });
  let kit = false; const drawnFor = [];
  const portrait = (spec, id) => { drawnFor.push([spec.figure, id]); const n = doc.createElement('svg'); n.className = 'fake-portrait'; return n; };
  const hs = HS.attach(box, { layers, now: () => 10_000_000, kitIn: () => kit, portrait });
  const served = { scene: { mode: 'start' }, data: { countdown: { to: 1_000 }, previously: [
    { npcId: 'n1', name: 'Mabel Quist', role: 'Fixer', spec: { v: 1, figure: 'femme' } }, { npcId: 'n2', name: 'Dov Kessler', role: 'Desk sergeant' }, { npcId: 'n3', name: 'Ada Vell', role: 'Croupier', spec: { v: 1, figure: 'masc' } }] } };
  layers.apply(served); hs.update();
  const faces = () => box.children.find((c) => c.className.includes('dp-hs ')).children.find((c) => c.className.includes('dp-hs-faces')).children;
  const pics = () => faces().map((f) => f.children.find((c) => c.className.startsWith('dp-hs-pic')).children[0].className);
  assert.deepEqual(pics(), ['dp-hs-sil', 'dp-hs-sil', 'dp-hs-sil'], 'no kit yet: three silhouettes');
  assert.equal(drawnFor.length, 0);
  kit = true; hs.update();
  assert.deepEqual(pics(), ['fake-portrait', 'dp-hs-sil', 'fake-portrait'], 'the kit came: the two with a figure are drawn, the one without stays a silhouette');
  assert.deepEqual(drawnFor.map((d) => d[0]), ['femme', 'masc']); assert.ok(drawnFor.every(([, id]) => /^dp-hs-\d-n\d$/.test(id)), 'each drawn with its own id');
  assert.ok(faces().every((f) => f.children.find((c) => c.className === 'dp-hs-name').children.length === 0), 'the name plates stay blank until revealed');
  assert.doesNotMatch(box.textContent, /Mabel|Dov|Ada/, 'no name on the page');
  const msg = JSON.stringify(layers.message());
  assert.ok(!/"spec"|npcId|femme/.test(msg), 'the scenes\' b68:data message still carries no spec or id');
  /* a revealed plate keeps its portrait */
  layers.apply({ ...served, band: { faces: [{ npcId: 'n1', name: 'Mabel Quist', role: 'Fixer' }] } }); hs.update();
  assert.equal(pics()[0], 'fake-portrait'); assert.match(box.textContent, /Mabel Quist/);
  /* the renderer failing is a silhouette, never an empty frame or a throw */
  const hs2 = HS.attach(box, { layers, now: () => 10_000_000, kitIn: () => true, portrait: () => { throw new Error('kit broke'); } });
  hs.destroy(); hs2.update();
  assert.ok(pics().every((c) => c === 'dp-hs-sil'));
  hs2.destroy(); layers.destroy();
});

await test('Roll the opening credits: end() takes every layer off, then the host\'s onTitles pins the credits; End without credits (and Clear) never call it', async () => {
  const table = fakeTable(NPCS), log = [];
  const layer = (p, v) => { log.push('layer ' + p + ' ' + (v === null ? 'off' : 'on')); return table.layer(p, v); };
  let ipad = 'Ambient scenes';
  const host = { layer, npcs: () => NPCS, now: () => 1_000, startAt: () => 0, onTitles: () => { log.push('onTitles'); ipad = 'Opening credits (pinned)'; return Promise.resolve(true); }, onIpad: () => ipad };
  const ctl = GHS.make(host);
  assert.equal(await ctl.armTest(), true);
  log.length = 0;
  assert.equal(await ctl.roll(), true);
  assert.deepEqual(log, [...GHS.PATHS.slice().reverse().map((p) => 'layer ' + p + ' off'), 'onTitles'], 'every layer off first, then the pin');
  assert.equal(table.served(), null, 'nothing of the hard start is left');
  assert.equal(ctl.state().rolled, true); assert.equal(ctl.state().armed, false);
  /* End without credits: today's end(), no pin */
  assert.equal(await ctl.armTest(), true); log.length = 0;
  assert.equal(ctl.state().rolled, false, 'a new arm starts again');
  assert.equal(await ctl.end(), true);
  assert.ok(!log.includes('onTitles'), 'End without credits never pins the credits'); assert.equal(ctl.state().rolled, false);
  /* a refused end pins nothing; a refused pin is false */
  const refuse = GHS.make({ ...host, layer: () => Promise.resolve(null) }); log.length = 0;
  assert.equal(await refuse.roll(), false); assert.ok(!log.includes('onTitles'), 'the hard start did not come off: no credits over it');
  const noPin = GHS.make({ ...host, onTitles: () => Promise.resolve(false) }); await noPin.armTest();
  assert.equal(await noPin.roll(), false); assert.equal(noPin.state().rolled, false);
  /* the sheet: both buttons only once armed, with the tap line; afterwards it says what is on the iPad */
  const box = { innerHTML: '', parentNode: { __hs: true } };
  ctl.render(box);
  assert.doesNotMatch(box.innerHTML, /data-hs="roll"|data-hs="end"/, 'not armed: no way to end it');
  await ctl.armTest(); ctl.render(box);
  assert.match(box.innerHTML, /data-hs="roll"[^>]*>Roll the opening credits</); assert.match(box.innerHTML, /data-hs="end"[^>]*>End without credits</);
  assert.match(box.innerHTML, /sound only after a tap/); assert.match(box.innerHTML, /Tap for sound/);
  await ctl.roll(); ctl.render(box);
  assert.match(box.innerHTML, /On the iPad: Opening credits \(pinned\)\./); assert.match(box.innerHTML, /pin the next scene \(iPad view, Scenes\) or fire a cue\. Clear keeps the credits’ title card\./);
  /* the page wires the seam: the host it makes has onTitles, which pins the credits scene through the iPad view's own ambient PATCH */
  const page = fs.readFileSync(path.join(APP, 'gm-page.js'), 'utf8'), at = page.indexOf('S.hs = W.B68GmHardStart.make(');
  const made = page.slice(at, page.indexOf('return S.hs;', at));
  assert.match(made, /onTitles: function \(\) \{\s*return patchAmbient\(\{ mode: 'pin', scene: 'credits' \}\)/);
  assert.match(made, /onIpad: function/);
  assert.match(page, /if \(hs && typeof hs\.end === 'function'\) steps\.push\(function \(\) \{ return hs\.end\(\); \}\)/, 'Clear calls end(), not roll()');
});


/* ================= the switch, the wiring, the leaks ================= */
await test('spine.start is a display switch, default off, Saturday on; the code asks for that id', () => {
  const s = F.get('spine.start'); assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'display'); assert.equal(s.saturday, 'on'); assert.ok(s.label && s.doc);
  const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
  assert.match(src('display-page.js'), /swOn\('spine\.start'\)/); assert.match(src('gm-page.js'), /valueOf\(S\.doc, 'spine\.start'\)/);
});
await test('the hard start files are in the right bundles and exist; no campaign names in them', () => {
  const routes = fs.readFileSync(path.join(APP, 'routes.js'), 'utf8');
  const bundle = (n) => (new RegExp('\\b' + n + ': \\[([^\\]]*)\\]').exec(routes) || [])[1] || '';
  for (const f of ['display/hardstart.js', 'display/hardstart.css']) { assert.ok(bundle('display').includes("'" + f + "'"), f); assert.ok(!bundle('gm').includes("'" + f + "'"), f + ' not for the GM'); assert.ok(fs.existsSync(path.join(APP, f)), f); }
  assert.ok(bundle('gm').includes("'gm/hardstart.js'")); assert.ok(!bundle('display').includes("'gm/hardstart.js'")); assert.ok(fs.existsSync(path.join(APP, 'gm', 'hardstart.js')));
  for (const f of ['display/hardstart.js', 'display/hardstart.css', 'gm/hardstart.js']) assert.doesNotMatch(fs.readFileSync(path.join(APP, f), 'utf8'), /GM-ONLY|Pelican/, f);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
