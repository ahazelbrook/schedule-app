// Unit test for the registry after the night rebuild (N0; first written for suite ticket W0.2). No browser, no network: the registry (app/features.js), the
// surfaces' reader (app/sheet/flags.js), the iPad's features part (app/display-page.js Pure.featuresPart and the poller's onFeatures), the Settings controller
// (app/gm/settings.js) against a fake host, the Worker's door (functions/_lib/features.js), and where each file is bundled (routes.js).
// The new truth: everything built is ON whatever is stored; three lines are settings, read as stored; nothing can turn a feature off; the Switchboard and the
// Workshop are gone. Test lines are registered by the test and removed again: none ships.
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
const SET = require(path.join(ROOT, 'app', 'gm', 'settings.js'));
const D = require(path.join(ROOT, 'app', 'display-page.js'));
const Door = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'features.js')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const sw = (id, surface, extra = {}) => Object.assign({ id, label: 'Test ' + id, surface, stage: 'spine', default: false, saturday: 'off', doc: 'A test line.' }, extra);
async function withSwitches(list, fn) {
  list.forEach((d) => F.register(d));
  try { return await fn(); } finally { list.forEach((d) => F.unregister(d.id)); }
}
const GMX = sw('test.gm', 'gm'), DISP = sw('test.disp', 'display'), PH = sw('test.phone', 'phone'), DSET = sw('test.dset', 'display', { setting: true });
const SETTINGS = ['phoneCards', 'fx.off', 'room.music', 'display.band',      /* display.band: the tech run (06/11), the iPad's strip across the top, off until chosen */
  'kit.desk', 'kit.stage', 'kit.phone', 'night.who', 'blade.pitches',         /* the kit and stage build (KS01.1, 11/11): five more, each off until chosen */
  'map.fill', 'map.people', 'map.lights', 'map.room',                          /* the map kit's new options (MK1, 13/11): four more GM settings, each off until chosen */
  'stage.players'];                                                             /* the players' screen build (IP2, 13/11): one display setting, off until chosen */

// ---------- the shipped registry ----------
await test('the shipped lines: each well-formed, default false, phoneCards first; the settings are exactly phoneCards, fx.off, room.music, display.band and the kit\'s five; spine.workshop is gone', async () => {
  assert.equal(F.list()[0].id, 'phoneCards');
  for (const s of F.list()) {
    assert.equal(s.default, false, s.id); assert.ok(s.label && s.doc, s.id);
    F.unregister(s.id); assert.doesNotThrow(() => F.register(s), s.id + ' registers again as it stands');
  }
  F.reset();
  assert.deepEqual(F.settings().map((s) => s.id), SETTINGS);
  assert.deepEqual(F.list().filter((s) => s.setting).map((s) => s.id), SETTINGS);
  assert.equal(F.get('spine.workshop'), null, 'the Workshop line is gone');
  assert.ok(F.isSetting('fx.off') && F.isSetting('room.music') && F.isSetting('phoneCards'));
  assert.ok(!F.isSetting('spine.rail') && !F.isSetting('nope'));
  const p = F.get('phoneCards');
  assert.equal(p.surface, 'phone'); assert.equal(p.legacy, 'phoneCards'); assert.equal(p.stage, 'existing'); assert.equal(p.setting, true);
  assert.equal(F.get('fx.off').surface, 'display'); assert.equal(F.get('room.music').surface, 'display');
});
await test('everything built is on: with NOTHING stored every line but a setting reads ON, and a setting reads off', async () => {
  for (const doc of [{}, null, undefined, { features: {} }]) {
    for (const s of F.list()) assert.equal(F.valueOf(doc, s.id), !s.setting, s.id + ' in ' + JSON.stringify(doc));
  }
});
await test('nothing can turn a feature off: a stored false (the Switchboard\'s All off) still reads ON; a setting follows its stored value', async () => {
  const allOff = { features: Object.fromEntries(F.list().map((s) => [s.id, false])), phoneCards: false };
  for (const s of F.list()) assert.equal(F.valueOf(allOff, s.id), !s.setting, s.id);
  const v = F.values(allOff);
  assert.equal(Object.values(v).filter((x) => x === false).length, SETTINGS.length);
  assert.equal(F.valueOf({ features: { 'fx.off': true } }, 'fx.off'), true);
  assert.equal(F.valueOf({ features: { 'room.music': true } }, 'room.music'), true);
});
await test('a setting: ON only when exactly true; features beats the legacy key; the legacy key is the fallback; unknown ids are off', async () => {
  assert.equal(F.valueOf({}, 'phoneCards'), false); assert.equal(F.valueOf(null, 'phoneCards'), false);
  assert.equal(F.valueOf({ phoneCards: true }, 'phoneCards'), true, 'the old key still reads');
  assert.equal(F.valueOf({ phoneCards: 'yes' }, 'phoneCards'), false);
  assert.equal(F.valueOf({ features: { phoneCards: true } }, 'phoneCards'), true);
  assert.equal(F.valueOf({ features: { phoneCards: false }, phoneCards: true }, 'phoneCards'), false, 'features wins');
  assert.equal(F.valueOf({ features: { phoneCards: 1 } }, 'phoneCards'), false);
  assert.equal(F.valueOf({ features: { zzz: true } }, 'zzz'), false, 'not registered');
  assert.equal(F.valueOf({ features: { 'fx.off': 'true' } }, 'fx.off'), false);
});
await test('a line is checked when registered: bad ones are refused (setting must be a boolean; only a setting keeps a legacy key)', async () => {
  const bad = [
    [{}, /switch id/], [sw('1x', 'gm'), /switch id/], [sw('a b', 'gm'), /switch id/], [sw('t.a', 'tv'), /surface/], [sw('t.a', 'gm', { default: true }), /default is off/],
    [sw('t.a', 'gm', { default: undefined }), /default is off/], [sw('t.a', 'gm', { stage: 'nope' }), /stage/], [sw('t.a', 'gm', { saturday: 'yes' }), /saturday/],
    [sw('t.a', 'gm', { label: '' }), /label/], [sw('t.a', 'gm', { doc: ' ' }), /label and a line/], [sw('phoneCards', 'phone'), /already registered/],
    [sw('t.a', 'gm', { setting: 'yes' }), /setting is true or false/], [sw('t.a', 'phone', { legacy: 'oldKey' }), /only a setting keeps a legacy key/]
  ];
  const n = F.list().length;
  for (const [d, re] of bad) assert.throws(() => F.register(d), re, JSON.stringify(d).slice(0, 80));
  assert.equal(F.list().length, n, 'a refused line is not left behind');
  await withSwitches([sw('t.ok', 'phone', { setting: true, legacy: 'oldKey' })], () => { assert.equal(F.valueOf({ oldKey: true }, 't.ok'), true); });
});
await test('patches: only a setting can change (features and the old key); any other id throws; patchAllOff touches the settings only', async () => {
  assert.deepEqual(F.patchFor({}, 'phoneCards', true), { features: { phoneCards: true }, phoneCards: true });
  assert.deepEqual(F.patchFor({}, 'phoneCards', 'yes'), { features: { phoneCards: false }, phoneCards: false });
  assert.deepEqual(F.patchFor({}, 'fx.off', true), { features: { 'fx.off': true } });
  assert.throws(() => F.patchFor({}, 'nope', true), /unknown switch/);
  assert.throws(() => F.patchFor({}, 'spine.rail', false), /always on/);
  await withSwitches([GMX, DISP], () => { assert.throws(() => F.patchFor({}, 'test.disp', false), /always on/); });
  assert.deepEqual(F.patchAllOff({}), { features: { phoneCards: false, 'fx.off': false, 'room.music': false, 'display.band': false, 'kit.desk': false, 'kit.stage': false, 'kit.phone': false, 'night.who': false, 'blade.pitches': false, 'map.fill': false, 'map.people': false, 'map.lights': false, 'map.room': false, 'stage.players': false }, phoneCards: false });
});
await test('publicMap: the display and phone lines, complete, as the GM page sees them (a setting as stored, the rest ON); never a GM-only id', async () => {
  await withSwitches([GMX, DISP, PH], () => {
    const m = F.publicMap({ features: { 'test.gm': false, 'test.disp': false, 'fx.off': true } });
    assert.equal(m['test.disp'], true); assert.equal(m['test.phone'], true); assert.equal(m['fx.off'], true); assert.equal(m['room.music'], false); assert.equal(m.phoneCards, false);
    assert.ok(!('test.gm' in m), 'a GM-only id is not in the public map');
    assert.deepEqual(Object.keys(m).sort(), F.publicIds().sort());
    assert.ok(F.idsFor('gm').includes('test.gm') && !F.publicIds().includes('test.gm'));
  });
});
await test('publishMap: what the GM page copies is the SETTINGS only; the legacy one always, any other only while on or where the document holds it; never a non-setting', async () => {
  await withSwitches([GMX, DISP, PH], () => {
    assert.deepEqual(F.publishMap({}, undefined), { phoneCards: false }, 'all off, nothing stored: what main wrote');
    assert.deepEqual(F.publishMap({ phoneCards: true }, {}), { phoneCards: true });
    assert.deepEqual(F.publishMap({ features: { 'test.disp': true, 'test.phone': false, 'fx.off': true } }, {}), { phoneCards: false, 'fx.off': true });
    assert.deepEqual(F.publishMap({}, { 'fx.off': true, 'test.disp': false, phoneCards: true }), { phoneCards: false, 'fx.off': false }, 'it was on, now off: false is written; a non-setting is never written');
    for (const m of [F.publishMap({ features: Object.fromEntries(F.list().map((s) => [s.id, true])) }, {}), F.publishMap({}, Object.fromEntries(F.publicIds().map((i) => [i, false])))]) {
      assert.ok(Object.keys(m).every((k) => F.isSetting(k)), 'only settings: ' + Object.keys(m));
    }
  });
});
await test('publicView (what a phone or the iPad is told): every display and phone line ON, a setting as stored, absent stays absent, never a GM-only id', async () => {
  await withSwitches([GMX, DISP, PH, DSET], () => {
    const v = F.publicView({ 'test.gm': true, 'test.disp': false, 'test.phone': 'no', 'test.dset': true, phoneCards: false, junk: true });
    assert.equal(v['test.disp'], true, 'a stored false is ON'); assert.equal(v['test.phone'], true); assert.equal(v['test.dset'], true); assert.equal(v.phoneCards, false);
    assert.ok(!('test.gm' in v) && !('junk' in v) && !('fx.off' in v) && !('room.music' in v), JSON.stringify(v));
    const none = F.publicView(null);
    for (const s of F.list()) if (s.surface !== 'gm') assert.equal(none[s.id], s.setting ? undefined : true, s.id);
    assert.deepEqual(F.publicView({ 'test.dset': 'yes' })['test.dset'], undefined, 'a setting that is not a boolean is not served');
  });
});
await test('cleanPublic (what may be STORED) is as before: only registered display and phone ids, only booleans', async () => {
  await withSwitches([GMX, DISP, PH], () => {
    assert.deepEqual(F.cleanPublic({ 'test.gm': true, 'test.disp': true, nope: true, 'test.phone': 'on', phoneCards: false }), { 'test.disp': true, phoneCards: false });
  });
  assert.deepEqual(F.cleanPublic(null), {}); assert.deepEqual(F.cleanPublic([true]), {}); assert.deepEqual(F.cleanPublic('x'), {});
});
await test('sameOn: absent is off; sameSettings compares only the settings', async () => {
  assert.ok(F.sameOn(undefined, {})); assert.ok(F.sameOn({}, { phoneCards: false })); assert.ok(F.sameOn({ a: true }, { a: true, b: false }));
  assert.ok(!F.sameOn({ a: true }, {})); assert.ok(!F.sameOn({}, { a: true })); assert.ok(!F.sameOn({ a: 'true' }, { a: true }));
  assert.ok(F.sameSettings({ phoneCards: false }, { 'spine.start': true, 'map.flashback': true }), 'non-settings are not compared');
  assert.ok(!F.sameSettings({ 'fx.off': true }, {})); assert.ok(F.sameSettings(undefined, { phoneCards: false }));
});
await test('the stages still label every line, in order', async () => {
  const ids = F.STAGES.map((s) => s.id);
  for (const g of F.byStage()) assert.ok(ids.includes(g.stage.id) && g.switches.length);
  assert.equal(F.byStage().reduce((n, g) => n + g.switches.length, 0), F.list().length);
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
await test('the served map reaches the flags as every feature ON: a phone that applies a served document sees each display and phone line on, a setting as stored', async () => {
  Flags.reset();
  Flags.apply(Door.forPlayer({ crew: {}, features: { phoneCards: true } }));
  for (const s of F.list()) if (s.surface !== 'gm') assert.equal(Flags.on(s.id), s.setting ? s.id === 'phoneCards' : true, s.id);
  Flags.reset();
});
await test('the iPad: Pure.featuresPart keeps booleans only, and is {} for an answer with none', async () => {
  assert.deepEqual(D.Pure.featuresPart({ features: { a: true, b: false, c: 'x', d: 1, e: null } }), { a: true, b: false });
  assert.deepEqual(D.Pure.featuresPart({}), {}); assert.deepEqual(D.Pure.featuresPart(null), {}); assert.deepEqual(D.Pure.featuresPart({ features: [true] }), {});
});
await test('the iPad: the poller hands onFeatures the answer\'s map on EVERY successful answer (a full one, an unchanged one, one without), never on a failure', async () => {
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
await test('the Worker: cleanFeatures cleans what may be stored; servedFeatures, forPlayer, parseFeatures and featuresOfDoc serve every display and phone line ON', async () => {
  await withSwitches([GMX, DISP, DSET], () => {
    assert.deepEqual(Door.cleanFeatures({ 'test.gm': true, 'test.disp': true, phoneCards: true, q: true }), { 'test.disp': true, phoneCards: true });
    const served = Door.forPlayer({ v: 1, features: { 'test.gm': true, 'test.disp': false, 'test.dset': false } });
    assert.equal(served.v, 1); assert.equal(served.features['test.disp'], true); assert.equal(served.features['test.dset'], false); assert.ok(!('test.gm' in served.features));
    const bare = Door.forPlayer({ v: 1 });
    assert.equal(bare.features['test.disp'], true, 'nothing stored: still ON'); assert.ok(!('test.dset' in bare.features) && !('phoneCards' in bare.features), 'a setting never stored is absent (off)');
    assert.deepEqual(Door.parseFeatures('{"test.gm":true,"test.disp":false}'), Door.servedFeatures({ 'test.disp': false }));
    assert.equal(Door.parseFeatures('{not json')['test.disp'], true); assert.equal(Door.parseFeatures(null)['test.disp'], true);
    assert.deepEqual(Door.featuresOfDoc({ features: { 'test.gm': true, phoneCards: false } }), Door.servedFeatures({ phoneCards: false }));
    for (const m of [served.features, bare.features, Door.parseFeatures('{"test.gm":true}')]) assert.ok(!('test.gm' in m), 'never a GM-only id');
    assert.equal(Door.forPlayer(null), null); assert.deepEqual(Door.forPlayer([1]), [1]);
  });
});

// ---------- the Settings controller (gm/settings.js) ----------
function rig(state = {}, camp = {}, extra = {}) {
  const calls = { patch: [], publish: [], toast: [], redraw: 0, mirror: 0 };
  const host = {
    doc: () => state, campaign: () => camp, F, Sheet: null, root: () => null, now: () => host.t,
    patch(p) { calls.patch.push(p); state.features = Object.assign({}, state.features, p.features); for (const k of Object.keys(p)) if (k !== 'features') state[k] = p[k]; return true; },
    publish(map) { calls.publish.push(map); camp.features = Object.assign({}, camp.features, map); return Promise.resolve(true); },
    toast(m, bad) { calls.toast.push([m, !!bad]); }, redraw() { calls.redraw++; }, t: 1000,
    mirrorOn: () => state.mirror !== false, toggleMirror() { calls.mirror++; state.mirror = state.mirror === false; },
    ...extra
  };
  return { ctl: SET.create(host), calls, state, camp, host };
}
await test('settings: with every setting off and nothing stored, heal writes nothing at all; nor before the campaign arrives', async () => {
  const r = rig({}, { v: 1 });
  assert.equal(r.ctl.heal(), false); assert.deepEqual(r.calls.publish, []);
  const r2 = rig({}, { v: 1, features: { phoneCards: false } }); assert.equal(r2.ctl.heal(), false);
  assert.equal(rig({}, null).ctl.heal(), false, 'the campaign has not arrived: nothing to compare');
});
await test('settings: heal never writes for a non-setting, whatever the campaign holds (the served map has them ON, the stored one may hold false)', async () => {
  const camp = { features: Object.fromEntries(F.publicIds().filter((i) => !F.isSetting(i)).map((i) => [i, false])) };
  const r = rig({ features: Object.fromEntries(F.list().map((s) => [s.id, false])) }, camp);
  assert.equal(r.ctl.heal(), false); assert.deepEqual(r.calls.publish, []);
});
await test('settings: set writes the GM state (features and the old key) and copies the settings to the campaign; a non-setting is refused and nothing is written', async () => {
  const r = rig({}, { v: 1 });
  assert.equal(r.ctl.set('fx.off', true), true); await Promise.resolve();
  assert.deepEqual(r.calls.patch[0], { features: { 'fx.off': true } });
  assert.deepEqual(r.calls.publish, [{ phoneCards: false, 'fx.off': true }]);
  assert.equal(r.ctl.set('spine.rail', false), false); assert.equal(r.ctl.set('nope', true), false);
  assert.equal(r.calls.patch.length, 1, 'nothing written for a non-setting');
  assert.equal(r.ctl.set('phoneCards', true), true);
  assert.deepEqual(r.calls.patch[1], { features: { phoneCards: true }, phoneCards: true });
  assert.equal(r.ctl.on('phoneCards'), true); assert.equal(r.ctl.on('spine.rail'), false, 'on() answers for settings only');
  assert.ok(r.calls.redraw >= 2, 'the page redraws after a change');
});
await test('settings: heal puts a stale campaign copy right, does not resend a copy just sent (4 s) but does after, and gives up after three tries of the same copy', async () => {
  const r = rig({ features: { phoneCards: true } }, { features: { phoneCards: false } });
  assert.equal(r.ctl.heal(), true); await Promise.resolve(); assert.equal(r.calls.publish.length, 1);
  r.camp.features = { phoneCards: false };       // the server has not reflected it yet
  assert.equal(r.ctl.heal(), false); r.host.t += 5000; assert.equal(r.ctl.heal(), true); await Promise.resolve(); assert.equal(r.calls.publish.length, 2);
  const r2 = rig({ features: { 'room.music': true } }, { features: {} });
  let sends = 0; r2.host.publish = () => { sends++; return Promise.resolve(true); };     // and the campaign never reflects it
  for (let i = 0; i < 8; i++) { r2.ctl.heal(); await Promise.resolve(); r2.host.t += 5000; }
  assert.equal(sends, 3);
});
await test('settings: a failed copy says so and is tried again at the next arrival', async () => {
  const r = rig({ features: { phoneCards: true } }, { features: {} });
  r.host.publish = () => Promise.reject(new Error('offline'));
  assert.equal(r.ctl.heal(), true); await new Promise((x) => setImmediate(x));
  assert.match(r.calls.toast[0][0], /Could not copy the settings/); assert.equal(r.calls.toast[0][1], true);
  assert.equal(r.ctl.heal(), true, 'tried again at once');
});
await test('settings: fifteen rows (the Players screen row first, then Scenes, Music, Phones, Mirror for phones, Band, the kit\'s Desk, Stage, Phone sheet, Start the night, Pitches, and MK1\'s four map rows), each a two-way choice showing the current value', async () => {
  const r = rig({ features: { 'room.music': true }, mirror: false }, { v: 1 });
  const rows = r.ctl.rows();
  assert.deepEqual(rows.map((x) => x.label), ['Players’ screen', 'Scenes', 'Music', 'Phones', 'Mirror for phones', 'Band', 'Desk', 'Stage', 'Phone sheet', 'Start the night', 'Pitches',
    'Map fills the screen', 'People on the map', 'Room lights', 'Cut to the room']);
  assert.deepEqual(rows.map((x) => x.key), ['stage.players', 'fx.off', 'room.music', 'phoneCards', 'mirror', 'display.band', 'kit.desk', 'kit.stage', 'kit.phone', 'night.who', 'blade.pitches',
    'map.fill', 'map.people', 'map.lights', 'map.room']);
  assert.deepEqual(rows.map((x) => x.options.map((o) => o.label)), [['Classic', 'Map first'], ['Moving', 'Held still'], ['Scene themes', 'Heat music'], ['Sheet only', 'Mission cards'], ['Off', 'On'], ['Off', 'On'],
    ['Old desk', 'New desk'], ['Old iPad', 'New iPad'], ['Old sheet', 'Four screens'], ['Off', 'On'], ['Stall and Meanwhile', 'Pitches'], ['Off', 'On'], ['Off', 'On'], ['Off', 'On'], ['Off', 'On']]);
  assert.deepEqual(rows.map((x) => x.value), [false, false, true, false, false, false, false, false, false, false, false, false, false, false, false]);
  const box = { parentNode: null, innerHTML: '' }; r.ctl.render(box);
  assert.match(box.innerHTML, /data-set="room\.music" data-v="1" aria-pressed="true">Heat music/);
  assert.match(box.innerHTML, /data-set="fx\.off" data-v="0" aria-pressed="true">Moving/);
  assert.match(box.innerHTML, /data-set="mirror" data-v="0" aria-pressed="true">Off/);
  assert.equal((box.innerHTML.match(/aria-pressed="true"/g) || []).length, 15, 'one value pressed per row');
});
await test('the kit\'s five settings (KS01.1): surfaces gm, display, phone, gm, gm; off with nothing stored; nothing is published or healed while they are off; turning one on writes only its own key', async () => {
  const want = { 'kit.desk': 'gm', 'kit.stage': 'display', 'kit.phone': 'phone', 'night.who': 'gm', 'blade.pitches': 'gm' };
  for (const [id, surface] of Object.entries(want)) {
    const s = F.get(id); assert.ok(s && s.setting === true && s.default === false && s.saturday === 'off' && s.stage === 'kit', id);
    assert.equal(s.surface, surface, id); assert.equal(F.valueOf({}, id), false, id + ' reads off with nothing stored');
  }
  assert.deepEqual(F.publishMap({}, undefined), { phoneCards: false }, 'all off: the campaign copy is what 798907c wrote');
  assert.deepEqual(F.publicView({}), F.publicView({ 'kit.desk': true, 'night.who': true, 'blade.pitches': true }), 'a GM-only setting never reaches a phone or the iPad');
  const r = rig({}, { v: 1 });
  assert.equal(r.ctl.heal(), false); assert.deepEqual(r.calls.publish, [], 'nothing published while the kit is off');
  const settle = () => new Promise((x) => setImmediate(x));
  assert.equal(r.ctl.choose('kit.desk', true), true); await settle();
  assert.deepEqual(r.calls.patch.pop(), { features: { 'kit.desk': true } }); assert.deepEqual(r.calls.publish, [], 'a GM setting is never copied to the campaign');
  assert.equal(r.ctl.choose('kit.stage', true), true); await settle();
  assert.deepEqual(r.calls.publish.pop(), { phoneCards: false, 'kit.stage': true }, 'a display setting is copied for the iPad');
  assert.equal(r.ctl.choose('kit.phone', true), true); await settle();
  assert.deepEqual(r.calls.publish.pop(), { phoneCards: false, 'kit.stage': true, 'kit.phone': true }, 'a phone setting is copied for the phones');
  for (const id of ['kit.desk', 'night.who', 'blade.pitches']) assert.ok(!(id in r.camp.features), id + ' never in the campaign document');
});
await test('settings: choose takes the page\'s own paths (phone cards: setPhoneCards; mirror: toggleMirror; scenes and music: set, with a toast) and does nothing for the value already chosen', async () => {
  const phone = [];
  const r = rig({ mirror: true }, { v: 1 }, { setPhoneCards(on) { phone.push(on); return true; } });
  assert.equal(r.ctl.choose('phoneCards', false), false, 'already off: nothing'); assert.deepEqual(phone, []);
  assert.equal(r.ctl.choose('phoneCards', true), true); assert.deepEqual(phone, [true]);
  assert.equal(r.ctl.choose('mirror', true), false, 'already on'); assert.equal(r.calls.mirror, 0);
  assert.equal(r.ctl.choose('mirror', false), true); assert.equal(r.calls.mirror, 1); assert.equal(r.state.mirror, false);
  assert.equal(r.ctl.choose('fx.off', true), true); assert.equal(r.state.features['fx.off'], true); assert.match(r.calls.toast.pop()[0], /held still/);
  assert.equal(r.ctl.choose('room.music', true), true); assert.match(r.calls.toast.pop()[0], /heat music/);
  assert.equal(r.ctl.choose('nope', true), false);
});

// ---------- where each file is bundled ----------
await test('bundles: flags.js is in the core (every route); the registry, the sheet host and the Settings are gm-only; the Switchboard and the Workshop are gone', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const g = {}; new Function('self', 'globalThis', src)(g, g);   // routes.js defines B68Load on the root it is given
  const B = g.B68Load.BUNDLES;
  assert.ok(B.core.includes('sheet/flags.js')); assert.ok(fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8').includes('<script src="sheet/flags.js"></script>'));
  for (const f of ['features.js', 'gm/tools.js', 'gm/workshop.js', 'gm/settings.js']) {
    assert.ok(B.gm.includes(f), f + ' is in the gm bundle');
    for (const n of Object.keys(B)) if (n !== 'gm') assert.ok(!B[n].includes(f), f + ' must not be in ' + n + ': players and the iPad never fetch GM files');
    assert.ok(fs.existsSync(path.join(ROOT, 'app', f)));
  }
  for (const f of ['gm/switchboard.js', 'gm/workshop-first.js']) {
    for (const n of Object.keys(B)) assert.ok(!B[n].includes(f), f + ' is gone from ' + n);
    assert.ok(!fs.existsSync(path.join(ROOT, 'app', f)), f + ' is gone');
  }
  assert.ok(B.gm.indexOf('gm/workshop.js') < B.gm.indexOf('gm/settings.js') && B.gm.indexOf('features.js') < B.gm.indexOf('gm/settings.js') && B.gm.indexOf('gm/settings.js') < B.gm.indexOf('gm-page.js'));
  for (const n of ['gm', 'display']) { assert.ok(B[n].includes('cue-verbs.js') && B[n].indexOf('cue-verbs.js') < B[n].indexOf('cue.js'), n); }
  for (const n of ['core', 'table', 'print', 'crews', 'figures']) assert.ok(!B[n].includes('cue-verbs.js') && !B[n].includes('features.js'), n + ' has no registry');
});
await test('the GM page: the Settings live in the iPad view (no Menu line, no sheet: N5), no Switchboard or Workshop line, and no CSS left that keys off the Workshop', async () => {
  const gp = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'app', 'gm.css'), 'utf8');
  assert.ok(gp.includes('id="gm-ipad-settings"') && /setInst\(\)/.test(gp) && /st\.render\(sb\)/.test(gp), 'the iPad view draws the Settings');
  assert.ok(!gp.includes('id="gm-menu-settings"') && !gp.includes("case 'settings':"), 'no Menu line for them any more');
  assert.equal(require(path.join(ROOT, 'app', 'gm', 'ipad-tray.js')).settingsInView, true, 'the tray says so, so the band\'s Menu has no Settings line');
  assert.ok(!/gm-sheet-settings|Sheet\.sheet/.test(fs.readFileSync(path.join(ROOT, 'app', 'gm', 'settings.js'), 'utf8')), 'and settings.js makes no sheet');
  assert.ok(!/gm-menu-switchboard|data-gm="switchboard"|case 'switchboard'|case 'workshop'|B68GmSwitchboard|B68GmWorkshopFirst|menuLine\(\)/.test(gp));
  assert.ok(!/ws-away|ws-show-|gm-sb-stage|gm-ws-list/.test(css));
  assert.ok(!/#as-cogm-also-row|#as-screen/.test(css), 'the uncued co-GM box and the Screen props show as before the Workshop');
  assert.ok(/\[data-gm="mirror"\]/.test(css) && /data-mid="phone-cards"/.test(css) && /gm-run-lens/.test(css), 'the mirror buttons, the Run menu\'s phone cards and the costume select stay put away');
});
await test('the files a player or the iPad fetches never name a GM-only line: the core holds no registry, and flags.js knows no ids', async () => {
  const flags = fs.readFileSync(path.join(ROOT, 'app', 'sheet', 'flags.js'), 'utf8');
  assert.ok(!/B68Features|phoneCards|spine\./.test(flags.replace(/\/\*[\s\S]*?\*\//g, '')));
  for (const s of F.list()) if (s.surface === 'gm') for (const f of ['sheet/flags.js', 'display-page.js', 'tracker.js', 'boot.js']) assert.ok(!fs.readFileSync(path.join(ROOT, 'app', f), 'utf8').includes(s.id), f + ' names ' + s.id);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
