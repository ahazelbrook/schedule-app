// Unit test for the switchboard (suite ticket W0.2; no browser, no network): the registry (app/features.js), the surfaces' reader (app/sheet/flags.js), the iPad's
// features part (app/display-page.js Pure.featuresPart and the poller's onFeatures), the GM controller (app/gm/switchboard.js) against a fake host, the Worker's door
// (functions/_lib/features.js), and where each file is bundled (routes.js). Test switches are registered by the test and removed again: none ships.
//   node checks/runtime/features.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const F = require(path.join(ROOT, 'app', 'features.js'));
const Flags = require(path.join(ROOT, 'app', 'sheet', 'flags.js'));
const SB = require(path.join(ROOT, 'app', 'gm', 'switchboard.js'));
const D = require(path.join(ROOT, 'app', 'display-page.js'));
const Door = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'features.js')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const sw = (id, surface, extra = {}) => Object.assign({ id, label: 'Test ' + id, surface, stage: 'spine', default: false, saturday: 'off', doc: 'A test switch.' }, extra);
async function withSwitches(list, fn) {
  list.forEach((d) => F.register(d));
  try { return await fn(); } finally { list.forEach((d) => F.unregister(d.id)); }
}
const GMX = sw('test.gm', 'gm'), DISP = sw('test.disp', 'display'), PH = sw('test.phone', 'phone');

await test('the registry ships phoneCards and nothing else: a phone switch, default off, Saturday off, with the old key as its fallback', async () => {
  assert.deepEqual(F.list().map((s) => s.id), ['phoneCards']);
  const s = F.get('phoneCards');
  assert.equal(s.surface, 'phone'); assert.equal(s.default, false); assert.equal(s.saturday, 'off'); assert.equal(s.legacy, 'phoneCards'); assert.equal(s.stage, 'existing');
  assert.ok(s.label && s.doc);
});
await test('every switch has an id, a label, a surface, a default of off, a line on what it does and its Saturday default; bad ones are refused', async () => {
  const bad = [
    [{}, /switch id/], [sw('1x', 'gm'), /switch id/], [sw('a b', 'gm'), /switch id/], [sw('t.a', 'tv'), /surface/], [sw('t.a', 'gm', { default: true }), /default is off/],
    [sw('t.a', 'gm', { default: undefined }), /default is off/], [sw('t.a', 'gm', { stage: 'nope' }), /stage/], [sw('t.a', 'gm', { saturday: 'yes' }), /saturday/],
    [sw('t.a', 'gm', { label: '' }), /label/], [sw('t.a', 'gm', { doc: ' ' }), /label and a line/], [sw('phoneCards', 'phone'), /already registered/]
  ];
  for (const [d, re] of bad) assert.throws(() => F.register(d), re, JSON.stringify(d).slice(0, 80));
  assert.deepEqual(F.list().map((s) => s.id), ['phoneCards'], 'a refused switch is not left behind');
});
await test('values: ON only when exactly true; features beats the legacy key; the legacy key is the fallback; unknown ids are off', async () => {
  assert.equal(F.valueOf({}, 'phoneCards'), false); assert.equal(F.valueOf(null, 'phoneCards'), false);
  assert.equal(F.valueOf({ phoneCards: true }, 'phoneCards'), true, 'the old key still reads');
  assert.equal(F.valueOf({ phoneCards: 'yes' }, 'phoneCards'), false);
  assert.equal(F.valueOf({ features: { phoneCards: true } }, 'phoneCards'), true);
  assert.equal(F.valueOf({ features: { phoneCards: false }, phoneCards: true }, 'phoneCards'), false, 'features wins');
  assert.equal(F.valueOf({ features: { phoneCards: 1 } }, 'phoneCards'), false);
  assert.equal(F.valueOf({ features: { zzz: true } }, 'zzz'), false, 'not registered');
});
await test('patches: a flip writes features and the old key; All off writes every id false, GM-only ones too', async () => {
  assert.deepEqual(F.patchFor({}, 'phoneCards', true), { features: { phoneCards: true }, phoneCards: true });
  assert.deepEqual(F.patchFor({}, 'phoneCards', 'yes'), { features: { phoneCards: false }, phoneCards: false });
  assert.throws(() => F.patchFor({}, 'nope', true), /unknown switch/);
  await withSwitches([GMX, DISP, PH], () => {
    const p = F.patchAllOff({});
    assert.deepEqual(p, { features: { phoneCards: false, 'test.gm': false, 'test.disp': false, 'test.phone': false }, phoneCards: false });
  });
});
await test('where values live: publicMap is the display and phone switches only (a complete map); cleanPublic drops a GM-only id, an unknown id and a non-boolean', async () => {
  await withSwitches([GMX, DISP, PH], () => {
    const doc = { features: { 'test.gm': true, 'test.disp': true } };
    assert.deepEqual(F.publicMap(doc), { phoneCards: false, 'test.disp': true, 'test.phone': false });
    assert.ok(!('test.gm' in F.publicMap(doc)), 'a GM-only id is not in the map that is copied to the campaign');
    assert.deepEqual(F.publicIds(), ['phoneCards', 'test.disp', 'test.phone']);
    assert.deepEqual(F.idsFor('gm'), ['test.gm']);
    assert.deepEqual(F.cleanPublic({ 'test.gm': true, 'test.disp': true, nope: true, 'test.phone': 'on', phoneCards: false }), { 'test.disp': true, phoneCards: false });
  });
  assert.deepEqual(F.cleanPublic(null), {}); assert.deepEqual(F.cleanPublic([true]), {}); assert.deepEqual(F.cleanPublic('x'), {});
});
await test('sameOn: absent is off, so a missing map equals an all-off one', async () => {
  assert.ok(F.sameOn(undefined, {})); assert.ok(F.sameOn({}, { phoneCards: false })); assert.ok(F.sameOn({ a: true }, { a: true, b: false }));
  assert.ok(!F.sameOn({ a: true }, {})); assert.ok(!F.sameOn({}, { a: true })); assert.ok(!F.sameOn({ a: 'true' }, { a: true }));
});
await test('the Switchboard\'s groups follow the stages, in order, and only groups that have a switch', async () => {
  assert.deepEqual(F.byStage().map((g) => g.stage.id), ['existing']);
  await withSwitches([sw('test.a', 'gm', { stage: 'map' }), sw('test.b', 'gm', { stage: 'spine' })], () => {
    assert.deepEqual(F.byStage().map((g) => g.stage.id), ['existing', 'spine', 'map']);
  });
});

// ---------- the surfaces' reader ----------
await test('flags: apply reads a campaign document, a display answer or a bare map; only exactly true is on; an answer without features turns everything off', async () => {
  Flags.reset();
  assert.equal(Flags.on('x'), false);
  assert.equal(Flags.apply({ crew: {}, features: { x: true, y: false, z: 'yes' } }), true);
  assert.equal(Flags.on('x'), true); assert.equal(Flags.on('y'), false); assert.equal(Flags.on('z'), false); assert.deepEqual(Flags.all(), { x: true, y: false });
  assert.equal(Flags.apply({ features: { x: true, y: false } }), false, 'nothing moved');
  assert.equal(Flags.apply({ seq: 1, mission: {} }), true, 'a document with no features: x goes off');
  assert.equal(Flags.on('x'), false);
  Flags.apply({ x: true }); assert.equal(Flags.on('x'), true, 'a bare map');
  Flags.apply(null); assert.equal(Flags.on('x'), false, 'no campaign at all: off');
});
await test('flags: subscribers hear what changed, once per change; one that throws does not stop the others; off() unsubscribes', async () => {
  Flags.reset(); const heard = [];
  const off = Flags.subscribe((all, ch) => heard.push(ch.join(',')));
  Flags.subscribe(() => { throw new Error('boom'); }); const origErr = console.error; console.error = () => {};
  try { Flags.subscribe((all) => heard.push('b' + Object.keys(all).length)); Flags.apply({ features: { a: true } }); Flags.apply({ features: { a: true } }); Flags.apply({ features: { a: false, b: true } }); } finally { console.error = origErr; }
  assert.deepEqual(heard, ['a', 'b1', 'a,b', 'b2']);
  off(); Flags.apply({ features: {} }); assert.deepEqual(heard.slice(4), ['b0']);
  Flags.reset();
});
await test('the iPad: Pure.featuresPart keeps booleans only, and is {} for an answer with none', async () => {
  assert.deepEqual(D.Pure.featuresPart({ features: { a: true, b: false, c: 'x', d: 1, e: null } }), { a: true, b: false });
  assert.deepEqual(D.Pure.featuresPart({}), {}); assert.deepEqual(D.Pure.featuresPart(null), {}); assert.deepEqual(D.Pure.featuresPart({ features: [true] }), {});
});
await test('the iPad: the poller hands onFeatures the answer\'s switches on EVERY successful answer (a full one, an unchanged one, one without), never on a failure', async () => {
  let now = 0; const timers = { setTimeout: (fn, ms) => { timers.q.push({ fn, at: now + ms }); return timers.q.length; }, clearTimeout: () => {}, q: [] };
  const got = [], answers = [
    { seq: 1, display: { kind: 'blank', title: '', caption: '' }, updatedAt: 'x', features: { 'test.disp': true } },
    { seq: 1, unchanged: true, features: { 'test.disp': false } },
    { seq: 1, unchanged: true }
  ];
  let i = 0;
  const poller = D.Pure.createPoller({ timers, now: () => now, fetch: () => Promise.resolve(answers[i++]), onData() {}, onStatus() {}, isHidden: () => false, onFeatures: (f) => got.push(f) });
  poller.start();
  for (let n = 0; n < 6; n++) { for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r)); const next = timers.q.shift(); if (next) { now = next.at; next.fn(); } }
  for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
  poller.stop();
  assert.deepEqual(got, [{ 'test.disp': true }, { 'test.disp': false }, {}]);
});

// ---------- the Worker's door ----------
await test('the Worker: cleanFeatures / forPlayer / parseFeatures use the registry; a player\'s document never carries a GM-only id', async () => {
  await withSwitches([GMX, DISP], () => {
    assert.deepEqual(Door.cleanFeatures({ 'test.gm': true, 'test.disp': true, phoneCards: true, q: true }), { 'test.disp': true, phoneCards: true });
    assert.deepEqual(Door.forPlayer({ v: 1, features: { 'test.gm': true, 'test.disp': false } }), { v: 1, features: { 'test.disp': false } });
    assert.deepEqual(Door.forPlayer({ v: 1, features: { 'test.gm': true } }), { v: 1 });
    assert.deepEqual(Door.forPlayer({ v: 1 }), { v: 1 });
    assert.deepEqual(Door.parseFeatures('{"test.gm":true,"test.disp":true}'), { 'test.disp': true });
    assert.deepEqual(Door.featuresOfDoc({ features: { 'test.gm': true, phoneCards: false } }), { phoneCards: false });
  });
});

// ---------- the GM controller ----------
function rig(state = {}, camp = {}) {
  const calls = { patch: [], publish: [], toast: [], redraw: 0 };
  const host = {
    doc: () => state, campaign: () => camp, F, Sheet: null, root: () => null, now: () => host.t,
    patch(p) { calls.patch.push(p); state.features = Object.assign({}, state.features, p.features); for (const k of Object.keys(p)) if (k !== 'features') state[k] = p[k]; return true; },
    publish(map) { calls.publish.push(map); camp.features = Object.assign({}, map); return Promise.resolve(true); },
    toast(m, bad) { calls.toast.push([m, !!bad]); }, redraw() { calls.redraw++; }, t: 1000
  };
  return { ctl: SB.create(host), calls, state, camp, host };
}
await test('switchboard: with every switch off and nothing stored, heal writes nothing at all (main\'s traffic)', async () => {
  const r = rig({}, { v: 1 });
  assert.equal(r.ctl.heal(), false); assert.deepEqual(r.calls.publish, []);
  const r2 = rig({}, { v: 1, features: { phoneCards: false } }); assert.equal(r2.ctl.heal(), false);
  assert.equal(rig({}, null).ctl.heal(), false, 'the campaign has not arrived: nothing to compare');
});
await test('switchboard: set writes the GM state (features and the old key) and copies a complete public map to the campaign; GM-only ids stay out of it', async () => {
  await withSwitches([GMX, DISP, PH], async () => {
    const r = rig({}, { v: 1 });
    assert.equal(r.ctl.set('test.disp', true), true); await Promise.resolve();
    assert.deepEqual(r.calls.patch[0], { features: { 'test.disp': true } });
    assert.deepEqual(r.calls.publish, [{ phoneCards: false, 'test.disp': true, 'test.phone': false }]);
    assert.equal(r.ctl.set('test.gm', true), true); await Promise.resolve();
    assert.equal(r.calls.publish.length, 1, 'a GM-only flip changes nothing public, so nothing is written to the campaign');
    assert.ok(r.calls.publish.every((m) => !('test.gm' in m)));
    assert.equal(r.ctl.set('phoneCards', true), true);
    assert.deepEqual(r.calls.patch[2], { features: { phoneCards: true }, phoneCards: true });
    assert.equal(r.ctl.on('phoneCards'), true); assert.equal(r.ctl.set('nope', true), false);
    assert.ok(r.calls.redraw >= 3, 'the page redraws after a flip');
  });
});
await test('switchboard: All off turns every switch off, GM-only too, copies all-false to the campaign, and says how many were on', async () => {
  await withSwitches([GMX, DISP], async () => {
    const r = rig({ features: { 'test.gm': true, 'test.disp': true, phoneCards: true }, phoneCards: true }, { features: { 'test.disp': true, phoneCards: true } });
    assert.equal(r.ctl.counts().on, 3);
    assert.equal(r.ctl.allOff(), 3); await Promise.resolve();
    assert.equal(r.ctl.counts().on, 0); assert.equal(r.state.phoneCards, false, 'the old key goes false too');
    assert.deepEqual(r.calls.publish.pop(), { phoneCards: false, 'test.disp': false });
    assert.match(r.calls.toast.pop()[0], /3 were on/);
    assert.equal(r.ctl.allOff(), 0); assert.match(r.calls.toast.pop()[0], /already off/);
  });
});
await test('switchboard: heal puts a stale campaign copy right, and does not resend a copy just sent (4 s), but does after', async () => {
  const r = rig({ features: { phoneCards: true } }, { features: { phoneCards: false } });
  assert.equal(r.ctl.heal(), true); await Promise.resolve(); assert.equal(r.calls.publish.length, 1);
  r.camp.features = { phoneCards: false };       // the server has not reflected it yet
  assert.equal(r.ctl.heal(), false); r.host.t += 5000; assert.equal(r.ctl.heal(), true); await Promise.resolve(); assert.equal(r.calls.publish.length, 2);
});
await test('switchboard: a copy the server never takes (a page newer than the Worker) is sent three times, then left alone until the map changes', async () => {
  const r = rig({ features: { phoneCards: true } }, { features: {} });
  let sends = 0; r.host.publish = () => { sends++; return Promise.resolve(true); };     // and the campaign never reflects it
  for (let i = 0; i < 8; i++) { r.ctl.heal(); await Promise.resolve(); r.host.t += 5000; }
  assert.equal(sends, 3);
  r.state.features.phoneCards = false; r.state.phoneCards = false; r.camp.features = { phoneCards: true };      // a different map is a new copy
  assert.equal(r.ctl.heal(), true); await Promise.resolve(); assert.equal(sends, 4);
});
await test('switchboard: a failed copy says so and is tried again at the next arrival', async () => {
  const r = rig({ features: { phoneCards: true } }, { features: {} });
  r.host.publish = () => Promise.reject(new Error('offline'));
  assert.equal(r.ctl.heal(), true); await new Promise((x) => setImmediate(x));
  assert.match(r.calls.toast[0][0], /Could not copy the switches/); assert.equal(r.calls.toast[0][1], true);
  assert.equal(r.ctl.heal(), true, 'tried again at once');
});
await test('switchboard: the sheet draws the groups, a line per switch with its surface and Saturday default, and All off', async () => {
  await withSwitches([sw('test.disp', 'display', { stage: 'map', saturday: 'try' })], () => {
    const r = rig({ features: { 'test.disp': true } }, {}); const box = { parentNode: null, innerHTML: '' };
    r.ctl.render(box);
    const h = box.innerHTML;
    assert.match(h, /Already in the app/); assert.match(h, /Stage 2: the maps/); assert.match(h, /data-sb="phoneCards" aria-pressed="false">Off/); assert.match(h, /data-sb="test.disp" aria-pressed="true">On/);
    assert.match(h, /data-sb-alloff/); assert.match(h, /1 of 2 on/); assert.match(h, /the iPad/); assert.match(h, /your call on Friday/); assert.match(h, /phones/);
    assert.ok(F.byStage().length === 2);
  });
});

// ---------- where each file is bundled ----------
await test('bundles: flags.js is in the core (every route) and index.html loads it; the registry and the GM files are gm-only; cue-verbs ride with cue.js', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const g = {}; new Function('self', 'globalThis', src)(g, g);   // routes.js defines B68Load on the root it is given
  const B = g.B68Load.BUNDLES;
  assert.ok(B.core.includes('sheet/flags.js')); assert.ok(fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8').includes('<script src="sheet/flags.js"></script>'));
  for (const f of ['features.js', 'gm/tools.js', 'gm/workshop.js', 'gm/switchboard.js']) {
    assert.ok(B.gm.includes(f), f + ' is in the gm bundle');
    for (const n of Object.keys(B)) if (n !== 'gm') assert.ok(!B[n].includes(f), f + ' must not be in ' + n + ': players and the iPad never fetch GM files');
    assert.ok(fs.existsSync(path.join(ROOT, 'app', f)));
  }
  assert.ok(B.gm.indexOf('gm/workshop.js') < B.gm.indexOf('gm/switchboard.js') && B.gm.indexOf('features.js') < B.gm.indexOf('gm/switchboard.js') && B.gm.indexOf('gm/switchboard.js') < B.gm.indexOf('gm-page.js'));
  for (const n of ['gm', 'display']) { assert.ok(B[n].includes('cue-verbs.js') && B[n].indexOf('cue-verbs.js') < B[n].indexOf('cue.js'), n); }
  for (const n of ['core', 'table', 'print', 'crews', 'figures']) assert.ok(!B[n].includes('cue-verbs.js') && !B[n].includes('features.js'), n + ' has no registry');
});
await test('the files a player or the iPad fetches never name a GM-only switch: the core holds no registry, and flags.js knows no ids', async () => {
  const flags = fs.readFileSync(path.join(ROOT, 'app', 'sheet', 'flags.js'), 'utf8');
  assert.ok(!/B68Features|phoneCards|spine\./.test(flags.replace(/\/\*[\s\S]*?\*\//g, '')));
  for (const s of F.list()) if (s.surface === 'gm') for (const f of ['sheet/flags.js', 'display-page.js', 'tracker.js', 'boot.js']) assert.ok(!fs.readFileSync(path.join(ROOT, 'app', f), 'utf8').includes(s.id), f + ' names ' + s.id);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
