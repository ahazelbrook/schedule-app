// gm-close-crew (RK07, setting close.crew): the close writes heat and Wanted back to the crew, once, in absolute numbers; heat reasons as ticks; status by
// faction (a picker, a log line, never crew.factions); the payout split; xp ticks on the GM's side; Open lines kept in the night only.
// app/gm/close-crew.js on its own, and app/gm/aftermath.js's controller with the setting on (host.closeCrew) and off (no host.closeCrew: the show as it was).
// No browser, no network, no clock: the host is a recorder and the time is a number the test moves. INVENTED data only (the Pelican Rooms; the Dovetail Crew).
//   node checks/runtime/gm-close-crew.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/close-crew.js';
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const CC = require(path.join(ROOT, FILE));
const A = require(path.join(APP, 'gm', 'aftermath.js'));
const Show = require(path.join(APP, 'gm', 'show.js'));
const Night = require(path.join(APP, 'gm', 'night.js'));
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------- the module ---------- */
await test('gm-close-crew: the module loads under Node and as a plain script, and is filled (no stub)', () => {
  assert.ok(CC && typeof CC === 'object' && !CC.stub);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  assert.ok(win.B68GmCloseCrew && typeof win.B68GmCloseCrew.onNext === 'function' && !win.B68GmCloseCrew.stub, 'window.B68GmCloseCrew is the filled module');
});

await test('heat reasons: short labels and numbers only, ticks add up with the house add-on, capped at +-6 like the Modifiers box', () => {
  assert.deepEqual(CC.REASONS.map((r) => [r.id, r.n]), [['profile', 1], ['turf', 1], ['war', 1], ['killing', 2]]);
  CC.REASONS.forEach((r) => assert.ok(r.label.length <= 24, 'a label, not a sentence: ' + r.label));
  assert.deepEqual(CC.reasonsOf('killing, profile,bogus,killing'), ['killing', 'profile']);
  assert.equal(CC.modsOf({ heatWhy: 'profile,killing', house: 1 }), 4);
  assert.equal(CC.modsOf({ heatWhy: 'profile,turf,war,killing', house: 6 }), 6);
  assert.equal(CC.modsOf({ house: -9 }), -6);
  assert.equal(CC.modsOf({}), 0);
});

await test('target(): heat 2, exposure 6, add-ons +1 +2 +1 (12 in all) is Heat 0 and Wanted +1; 8 in all is Heat 8, Wanted unchanged; Wanted stops at 4', () => {
  const d = { heat: 2, wanted: 0, exposure: 6, heatWhy: 'profile,killing', house: 1 }; d.mods = CC.modsOf(d);
  assert.equal(d.mods, 4);
  assert.deepEqual(CC.target(d, A.heatOutcome), { from: { heat: 2, wanted: 0 }, to: { heat: 0, wanted: 1 }, siren: true });
  assert.deepEqual(CC.target({ heat: 2, wanted: 1, exposure: 4, mods: 2 }, A.heatOutcome).to, { heat: 8, wanted: 1 });
  assert.deepEqual(CC.target({ heat: 9, wanted: 4, exposure: 6, mods: 0 }, A.heatOutcome).to, { heat: 0, wanted: 4 });
});

await test('crewWritten: a JSON string in the flat night bag, read back exactly; a fresh start seeds from `from` only while the crew still holds `to`', () => {
  const s = CC.packWritten({ from: { heat: 2, wanted: 0 }, to: { heat: 0, wanted: 1 }, at: 1795000000000 });
  assert.equal(typeof s, 'string'); assert.ok(s.length <= 200, 'fits the night bag: ' + s.length);
  assert.deepEqual(CC.parseWritten(s), { from: { heat: 2, wanted: 0 }, to: { heat: 0, wanted: 1 }, at: 1795000000000 });
  assert.equal(CC.parseWritten('nonsense'), null); assert.equal(CC.parseWritten('{"from":{"heat":12}}'), null);
  assert.deepEqual(CC.seed({ heat: 0, wanted: 1 }, { crewWritten: s }), { heat: 2, wanted: 0, written: s }, 'already written: start from the numbers before');
  assert.deepEqual(CC.seed({ heat: 3, wanted: 1 }, { crewWritten: s }), { heat: 3, wanted: 1, written: '' }, 'the crew moved since: a new close');
  assert.deepEqual(CC.seed({ heat: 5, wanted: 2 }, {}), { heat: 5, wanted: 2, written: '' });
});

await test('picks, the split, the Open lines and the xp list', () => {
  const p = CC.packPicks([{ name: 'The Kestrel Club', d: 1 }, { name: 'The Tidewater Watch', d: -2 }, { name: 'Zero', d: 0 }]);
  assert.deepEqual(CC.picksOf(p), [{ name: 'The Kestrel Club', d: 1 }, { name: 'The Tidewater Watch', d: -2 }]);
  assert.deepEqual(CC.pickLines(CC.picksOf(p)), ['The Kestrel Club +1', 'The Tidewater Watch −2']);
  const many = CC.packPicks(Array.from({ length: 12 }, (_, i) => ({ name: 'A long invented faction name ' + i, d: 1 })));
  assert.ok(many.length <= 200 && CC.picksOf(many).length >= 1, 'cut to fit 200 characters');
  assert.deepEqual(CC.split(14, 3, 3), { kept: 11, n: 3, each: 3, over: 2 });
  assert.equal(CC.splitLine(CC.split(14, 3, 3)), 'Kept 11 stacks: 3 each for 3 PCs, 2 left over.');
  assert.deepEqual(CC.split(5, 9, 2), { kept: 0, n: 2, each: 0, over: 0 });
  assert.match(CC.splitLine(CC.split(6, 0, 0)), /No PCs/);
  const open = CC.packOpen('Ray Okonjo: dead or alive?\nWho has the GM-ONLY-KEY-1?\n\n');
  assert.equal(open, 'Ray Okonjo: dead or alive? | Who has the GM-ONLY-KEY-1?');
  assert.ok(!/[\n\r]/.test(open), 'no new line: the night bag would make it a space');
  assert.ok(CC.packOpen('x'.repeat(70) + '\n' + 'y'.repeat(70) + '\n' + 'z'.repeat(70)).length <= 200);
  assert.deepEqual(CC.openOf(open), ['Ray Okonjo: dead or alive?', 'Who has the GM-ONLY-KEY-1?']);
  const Content = { byId: { hound: { name: 'Hound', xp: 'address a challenge with tracking or violence' } } };
  const Crews = { CREWS: [{ id: 'shadows', name: 'Shadows', xpTriggers: ['Trigger one.', 'Trigger two.'] }] };
  const xl = CC.xpList([{ id: 'c1', name: 'Nell Arbuthnot', playbook: 'hound' }, { id: 'c2', name: 'Ray Okonjo', playbook: '' }], 'Shadows', Content, Crews);
  assert.deepEqual(xl.map((x) => x.key), ['p:c1', 'p:c2', 'c:0', 'c:1']);
  assert.equal(xl[0].who, 'Nell Arbuthnot (Hound)'); assert.match(xl[0].line, /tracking or violence/); assert.match(xl[1].line, /No playbook trigger/);
});

await test('feed() and writer(): the PATCH body is { crew: { heat, wanted } } and nothing else; the factions are copies; tonight\'s PCs when the table names them', async () => {
  const sent = [];
  const api = { db: () => ({ collection: (c) => ({ doc: (id) => ({ update: (p) => { sent.push([c, id, clone(p)]); return Promise.resolve(); } }) }) }) };
  const camp = { crew: { type: 'shadows', heat: 2, wanted: 0, factions: [{ name: 'The Kestrel Club', status: 1 }, { name: '', status: 2 }, 'junk'] }, session: { present: ['c1'] } };
  const o = CC.feed({ doc: {} }, { camp, api, pcs: () => [{ id: 'c1', name: 'Nell Arbuthnot', playbook: 'hound' }, { id: 'c2', name: 'Ray Okonjo' }] });
  await o.writeCrew({ heat: 0, wanted: 1, vault: 9, factions: [] });
  assert.deepEqual(sent, [['campaign', 'main', { crew: { heat: 0, wanted: 1 } }]]);
  await assert.rejects(o.writeCrew({ heat: 12, wanted: 1 }));
  assert.deepEqual(o.factions, [{ name: 'The Kestrel Club', status: 1 }]);
  o.factions[0].status = 3; assert.equal(camp.crew.factions[0].status, 1, 'never the crew sheet\'s own array');
  assert.deepEqual(o.pcs().map((p) => p.id), ['c1'], 'session.present');
  assert.deepEqual(CC.feed({}, { camp: { crew: {} }, api, pcs: () => [{ id: 'c1' }, { id: 'c2' }] }).pcs().map((p) => p.id), ['c1', 'c2'], 'every filed PC when no one is marked present');
  await assert.rejects(CC.writer(null)({ heat: 0, wanted: 0 }), /not available/);
});

/* ---------- the controller: the Aftermath with the setting on, on a recorded host and a campaign document the test holds ---------- */
const CAST = [{ id: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', revealed: true, firstSeen: '2026-11-07T20:10:00.000Z', staged: false }];
function mergeNight(cur, p) {
  if (p === null) return null;
  const c = clone(cur || {});
  for (const [k, v] of Object.entries(p)) {
    if (k === 'aftermath') { c.aftermath = c.aftermath || { data: {} }; c.aftermath.step = v.step; const d = c.aftermath.data || {}; for (const [dk, dv] of Object.entries(v.data || {})) { if (dv === null) delete d[dk]; else d[dk] = dv; } c.aftermath.data = d; }
    else if (k === 'phases') { c.phases = c.phases || {}; for (const [pk, pv] of Object.entries(v)) c.phases[pk] = Object.assign(c.phases[pk] || {}, pv); }
    else if (k === 'log') { c.log = Object.assign(c.log || {}, v); for (const [lk, lv] of Object.entries(v)) if (lv === null) delete c.log[lk]; }
    else c[k] = v;
  }
  return c;
}
/* camp: the campaign document as the server would hold it; write() deep-merges the crew patch, as the PATCH does */
function rig({ on = true, crew = { heat: 2, wanted: 0, vault: 3 }, writeFails = false, nightDoc = null } = {}) {
  const t = { now: Date.parse('2026-11-07T22:00:00Z') };
  const log = [], docsLog = [], writes = [], toasts = [];
  const camp = { crew: Object.assign({ name: 'The Dovetail Crew', type: 'shadows', factions: [{ name: 'The Kestrel Club', status: 1 }, { name: 'The Tidewater Watch', status: -1 }], claims: ['a'] }, crew) };
  const box = { night: nightDoc };
  const nightCtl = Night.create({ doc: () => ({ night: box.night }), patch: (p) => { box.night = mergeNight(box.night, p.night); return true; }, now: () => t.now, prep: () => null });
  const x = {
    C: CC,
    write: (c) => { writes.push(clone(c)); if (writeFails) return Promise.reject(new Error('offline')); camp.crew = Object.assign({}, camp.crew, c); return Promise.resolve(); },
    factions: () => camp.crew.factions.map((f) => ({ name: f.name, status: f.status })),
    pcs: () => [{ id: 'c1', name: 'Nell Arbuthnot', playbook: 'hound' }, { id: 'c2', name: 'Ray Okonjo', playbook: 'hound' }, { id: 'c3', name: 'Tam Petrakis', playbook: 'hound' }],
    crewType: () => 'shadows', Content: { byId: { hound: { name: 'Hound', xp: 'address a challenge with violence' } } }, Crews: { CREWS: [{ id: 'shadows', xpTriggers: ['One.', 'Two.'] }] }
  };
  const host = {
    enabled: () => true,
    show: (kind, payload, o) => { log.push({ at: t.now, kind, payload: clone(payload), ms: o.ms, key: o.key }); assert.ok(Show.overlayFor(kind, payload, { ms: o.ms, id: 'x' }), 'the GM page would send it: ' + kind); return Promise.resolve({ ok: true }); },
    layer: () => Promise.resolve({ ok: true }), clearShow: () => Promise.resolve({ ok: true }),
    night: () => nightCtl,
    docs: { put: (row) => { docsLog.push(clone(row)); return Promise.resolve({ ok: true }); }, del: (k, o) => { docsLog.push({ del: [k, o] }); return Promise.resolve({ ok: true }); } },
    npcs: () => CAST, crew: () => ({ heat: camp.crew.heat, wanted: camp.crew.wanted, vault: camp.crew.vault }), since: () => Date.parse('2026-11-07T19:00:00Z'), now: () => t.now,
    toast: (m, bad) => toasts.push({ m, bad: !!bad })
  };
  if (on) host.closeCrew = () => x;
  return { t, log, docsLog, writes, toasts, camp, host, ctl: A.create(host), night: () => box.night, nightCtl, box };
}
const heatShows = (r) => r.log.filter((x) => x.kind === 'aftermath' && x.payload.step === 'heat');
const stamps = (r) => Night.logList(r.night()).filter((e) => e.k === 'stamp').map((e) => e.text);
async function toHeat(r) { await r.ctl.start(); await r.ctl.set({ stacks: 14 }); await r.ctl.next(); await r.ctl.set({ tithe: 3 }); await r.ctl.next(); assert.equal(r.ctl.state().step.id, 'heat'); }
async function s04Close(r) { await r.ctl.set({ exposure: 6 }); await r.ctl.set({ heatWhy: 'profile,killing' }); await r.ctl.set({ house: 1, houseWhy: 'explosives' }); }

await test('DONE WHEN: a close at Heat 2, exposure 6, add-ons +1 +2 +1 (12) leaves the crew at Heat 0 and Wanted +1, written once; the rest of the crew sheet is untouched', async () => {
  const r = rig();
  const before = clone(r.camp.crew);
  await toHeat(r); await s04Close(r);
  assert.equal(r.ctl.state().data.mods, 4, 'the ticks and the house add-on make the Modifiers');
  const last = heatShows(r).pop().payload;
  assert.deepEqual([last.heat, last.after, last.wanted, last.mods, last.siren], [2, 0, 1, 4, true], 'the iPad is told the same numbers as before: heat 2, after 0, Wanted 1');
  assert.equal(r.writes.length, 0, 'nothing is written before Next');
  await r.ctl.next();
  assert.equal(r.ctl.state().step.id, 'status');
  assert.deepEqual(r.writes, [{ heat: 0, wanted: 1 }], 'one write of two absolute numbers');
  assert.deepEqual([r.camp.crew.heat, r.camp.crew.wanted], [0, 1]);
  assert.deepEqual(Object.assign({}, before, { heat: 0, wanted: 1 }), r.camp.crew, 'every other crew field is as it was');
  const w = CC.parseWritten(r.night().aftermath.data.crewWritten);
  assert.deepEqual([w.from, w.to, w.at], [{ heat: 2, wanted: 0 }, { heat: 0, wanted: 1 }, r.t.now]);
  assert.ok(stamps(r).includes('Crew written: Heat 2 → 0, Wanted 0 → 1'), 'and the night log says so: ' + stamps(r).join(' / '));
});

await test('Back and Next again re-send the SAME absolute numbers, never a second increment; so does a fresh Start once the show is finished', async () => {
  const r = rig();
  await toHeat(r); await s04Close(r); await r.ctl.next();
  await r.ctl.back(); assert.equal(r.ctl.state().step.id, 'heat');
  assert.deepEqual([r.ctl.state().data.heat, r.ctl.state().data.wanted], [2, 0], 'the run keeps the numbers from before the close');
  await r.ctl.next();
  await r.ctl.back(); await r.ctl.next();
  assert.deepEqual(r.writes, [{ heat: 0, wanted: 1 }, { heat: 0, wanted: 1 }, { heat: 0, wanted: 1 }], 'three sends, the same absolute values each time');
  assert.deepEqual([r.camp.crew.heat, r.camp.crew.wanted], [0, 1], 'Wanted is 1, not 3');
  assert.equal(stamps(r).filter((s) => /^Crew written/.test(s)).length, 1, 'logged once');
  await r.ctl.finish();
  assert.ok(CC.parseWritten(r.night().aftermath.data.crewWritten), 'the guard outlives the finish');
  await r.ctl.start();
  assert.deepEqual([r.ctl.state().data.heat, r.ctl.state().data.wanted], [0, 1], 'a fresh Start is a new close: it starts from the crew as it stands');
  assert.ok(CC.parseWritten(r.ctl.state().data.lastClose) && r.ctl.state().data.crewWritten === undefined, 'the earlier close is kept as lastClose, not as this run\'s guard');
  await r.ctl.go(2); await r.ctl.set({ redo: true });
  assert.deepEqual([r.ctl.state().data.heat, r.ctl.state().data.wanted], [2, 0], 'Redo that close: back to the numbers before it');
  assert.equal(heatShows(r).pop().payload.heat, 2, 'and the iPad is told the heat step again from there');
  await r.ctl.set({ exposure: 6, heatWhy: 'profile,killing', house: 1 }); await r.ctl.next();
  assert.deepEqual([r.camp.crew.heat, r.camp.crew.wanted], [0, 1], 'redone: still Heat 0, Wanted 1');
});

await test('ADVISOR (Gate 2): a second score the same night adds to the first, never undoes it', async () => {
  const r = rig({ crew: { heat: 5, wanted: 0, vault: 3 } });
  await toHeat(r); await r.ctl.set({ exposure: 2 }); await r.ctl.next(); await r.ctl.finish();
  assert.deepEqual([r.camp.crew.heat, r.camp.crew.wanted], [7, 0], 'the first close: 5 + 2');
  await r.ctl.start(); await r.ctl.go(2);
  assert.deepEqual([r.ctl.state().data.heat, r.ctl.state().data.wanted], [7, 0], 'the second starts from 7, not from the first close\'s 5');
  await r.ctl.set({ exposure: 2 }); await r.ctl.next();
  assert.deepEqual([r.camp.crew.heat, r.camp.crew.wanted], [0, 1], '7 + 2 = 9: the siren, Heat 0 and Wanted 1');
});

await test('a reload mid-show (resume) keeps the guard and the numbers from before the close', async () => {
  const r = rig();
  await toHeat(r); await s04Close(r); await r.ctl.next();
  const again = A.create(r.host);
  assert.equal(again.resume(), true);
  assert.deepEqual([again.state().data.heat, again.state().data.wanted, again.state().data.mods], [2, 0, 4]);
  assert.ok(CC.parseWritten(again.state().data.crewWritten));
  await again.back(); await again.next();
  assert.deepEqual(r.writes.slice(-1), [{ heat: 0, wanted: 1 }]);
  assert.deepEqual([r.camp.crew.heat, r.camp.crew.wanted], [0, 1]);
});

await test('a failed write toasts, sets no guard, and the show moves on', async () => {
  const r = rig({ writeFails: true });
  await toHeat(r); await s04Close(r); await r.ctl.next();
  assert.equal(r.ctl.state().step.id, 'status');
  assert.ok(r.toasts.some((t) => t.bad && /Could not write heat and Wanted/.test(t.m)));
  assert.equal(r.night().aftermath.data.crewWritten, undefined, 'no guard for a write that did not land');
  assert.deepEqual([r.camp.crew.heat, r.camp.crew.wanted], [2, 0]);
});

await test('a crew that moved since the last close is a new close: it starts from the crew as it stands', async () => {
  const r = rig();
  await toHeat(r); await s04Close(r); await r.ctl.next(); await r.ctl.finish();
  r.camp.crew.heat = 3;      /* the week went by: the crew sheet says Heat 3 */
  await r.ctl.start();
  assert.deepEqual([r.ctl.state().data.heat, r.ctl.state().data.wanted], [3, 1]);
  assert.equal(r.ctl.state().data.crewWritten, undefined, 'the old guard is dropped');
});

await test('status by faction: picks reach the iPad as status lines and the night log, and crew.factions is never written', async () => {
  const r = rig();
  const factions = clone(r.camp.crew.factions);
  await toHeat(r); await r.ctl.next();
  assert.equal(r.ctl.state().step.id, 'status');
  await r.ctl.set({ picks: [{ name: 'The Kestrel Club', d: 2 }, { name: 'The Tidewater Watch', d: -1 }] });
  await r.ctl.set({ status: 'Mabel Quist owes a favour' });
  const st = r.log.filter((x) => x.kind === 'aftermath' && x.payload.step === 'status').pop().payload;
  assert.deepEqual(st.lines, ['The Kestrel Club +2', 'The Tidewater Watch −1', 'Mabel Quist owes a favour']);
  await r.ctl.next();
  assert.ok(stamps(r).includes('Status: The Kestrel Club +2, The Tidewater Watch −1'));
  assert.deepEqual(r.camp.crew.factions, factions, 'crew.factions as it was');
  assert.ok(r.writes.every((w) => Object.keys(w).sort().join() === 'heat,wanted'), 'every write is heat and Wanted only');
});

await test('the payout split and the xp ticks are logged; the Open lines stay in the night, are never sent, and never re-send the step', async () => {
  const r = rig();
  await r.ctl.start(); await r.ctl.set({ stacks: 14 }); await r.ctl.next(); await r.ctl.set({ tithe: 3 });
  const n = r.log.length;
  await r.ctl.set({ open: 'Ray Okonjo: dead or alive?\nGM-ONLY-OPEN-1' });
  assert.equal(r.log.length, n, 'an Open line is GM only: the step is not sent again');
  await r.ctl.next();
  assert.ok(stamps(r).includes('Kept 11 stacks: 3 each for 3 PCs, 2 left over.'), stamps(r).join(' / '));
  await r.ctl.go(6); assert.equal(r.ctl.state().step.id, 'xp');
  const m = r.log.length;
  await r.ctl.set({ xpTicks: 'p:c1,c:0' });
  assert.equal(r.log.length, m, 'the xp ticks are the GM\'s: the 90 s beat is not sent again');
  await r.ctl.next();
  assert.ok(stamps(r).includes('Xp: Nell Arbuthnot; crew 1 of 2'), stamps(r).join(' / '));
  await r.ctl.finish();
  const data = r.night().aftermath.data;
  assert.equal(data.open, 'Ray Okonjo: dead or alive? | GM-ONLY-OPEN-1');
  const out = JSON.stringify(r.log) + JSON.stringify(r.docsLog);
  assert.ok(!/Okonjo|GM-ONLY|crewWritten|explosives/.test(out), 'nothing of the Open lines, the guard or a label reaches the iPad or the phones');
  const rows = r.docsLog.filter((d) => d.kind);
  assert.deepEqual(rows, [{ kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: rows[0].json.until } }], 'the phones get the same text-free commend row as before');
  assert.deepEqual(Night.clean(r.night()).aftermath.data, data, 'the night contract keeps every key as stored (flat, under 24 keys, strings of 200 or less)');
  await r.ctl.start();
  assert.equal(r.ctl.state().data.open, data.open, 'the Open lines outlive a restart of the show');
});

await test('OFF: with no host.closeCrew the show sends, stores and writes exactly what it did', async () => {
  async function play(on) {
    const r = rig({ on });
    await r.ctl.start(); await r.ctl.set({ stacks: 14 }); await r.ctl.next(); await r.ctl.set({ tithe: 3 }); await r.ctl.next();
    await r.ctl.set({ exposure: 6, mods: 4 }); await r.ctl.next(); await r.ctl.set({ status: 'The Kestrel Club +1' }); await r.ctl.next();
    await r.ctl.set({ heatWhy: 'killing', open: 'GM-ONLY-OPEN-1', picks: [{ name: 'The Kestrel Club', d: 1 }] });
    for (let i = 0; i < 4; i++) await r.ctl.next();
    return r;
  }
  const off = await play(false), on = await play(true);
  assert.equal(off.writes.length, 0, 'off: nothing is written');
  assert.deepEqual([off.camp.crew.heat, off.camp.crew.wanted], [2, 0]);
  assert.deepEqual(off.night().aftermath.data, { stacks: 14, tithe: 3, exposure: 6, mods: 4, heat: 2, wanted: 0, status: 'The Kestrel Club +1', pending: '', pos: 8 }, 'off: the night data has the old keys only');
  assert.deepEqual(stamps(off), [], 'off: no log line');
  const strip = (r) => r.log.map((x) => [x.kind, x.payload]);
  assert.deepEqual(strip(off).slice(0, 4), strip(on).slice(0, 4), 'the payout and tithe steps send the same with it on');
  assert.equal(on.writes.length, 1);
});

await test('Deploy 41 reads a night this build wrote: an old controller (no closeCrew) resumes it and keeps its own keys', async () => {
  const r = rig();
  await toHeat(r); await s04Close(r); await r.ctl.next(); await r.ctl.set({ open: 'Ray Okonjo: dead or alive?' });
  const old = A.create(Object.assign({}, r.host, { closeCrew: undefined }));
  assert.equal(old.resume(), true);
  assert.deepEqual([old.state().step.id, old.state().data.heat, old.state().data.mods, old.state().data.exposure], ['status', 2, 4, 6]);
  assert.equal(old.state().data.crewWritten, undefined, 'the old page does not see the new keys');
  assert.equal(await old.next(), true, 'and it runs on');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
