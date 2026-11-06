// The Aftermath show (suite ticket 1.6, switch spine.aftermath): the GM's controller (app/gm/aftermath.js), the two show kinds on the display
// (app/display/aftermath.js), and the phone's commendations window (app/sheet/commend.js). No browser, no network, no clock: the host is a recorder and the time
// is a number the test moves. INVENTED data only (the Pelican Rooms); every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/gm-aftermath.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl, writes } from './minidom.mjs';
import { cleanShowPayload, SHOW_KINDS } from '../../functions/_lib/show.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const A = require(path.join(APP, 'gm', 'aftermath.js'));
const Show = require(path.join(APP, 'gm', 'show.js'));
const Night = require(path.join(APP, 'gm', 'night.js'));
const S = require(path.join(APP, 'display', 'shows.js'));
require(path.join(APP, 'display', 'show-beats.js'));
require(path.join(APP, 'display', 'aftermath.js'));
const Commend = require(path.join(APP, 'sheet', 'commend.js'));
const Features = require(path.join(APP, 'features.js'));
const doc = { createElement: (t) => { const e = new MiniEl(t); e.style = { setProperty() {} }; return e; }, createElementNS: (ns, t) => doc.createElement(t) };

/* ---------- the pure part ---------- */
await test('the eight steps, in the Run Sheet order, fit the 12 minutes with the xp step at 90 seconds', () => {
  assert.deepEqual(A.STEPS.map((s) => s.id), ['payout', 'tithe', 'heat', 'status', 'harm', 'unwind', 'xp', 'credits']);
  assert.equal(A.SECS_TOTAL, A.STEPS.reduce((t, s) => t + s.secs, 0));
  assert.ok(A.SECS_TOTAL <= 12 * 60, 'the time boxes add up to ' + A.SECS_TOTAL + ' s');
  assert.equal(A.STEPS[6].secs, 90); assert.equal(A.XP_SECS, 90);
  assert.ok(A.HOLD_MS <= 180000 && A.RESEND_MS < A.HOLD_MS, 'a step is sent again before the 180 s beat ends');
  assert.deepEqual(A.EXPOSURE, [0, 2, 4, 6]);
});

await test('the heat wizard: exposure plus modifiers on the heat; at 9 a siren and the wanted level goes up one, and the heat starts again', () => {
  assert.deepEqual(A.heatOutcome(0, 0, 0), { total: 0, after: 0, siren: false, wantedUp: 0 });
  assert.deepEqual(A.heatOutcome(5, 2, 1), { total: 8, after: 8, siren: false, wantedUp: 0 });
  assert.deepEqual(A.heatOutcome(5, 2, 2), { total: 9, after: 0, siren: true, wantedUp: 1 }, 'exactly 9 is the siren');
  assert.deepEqual(A.heatOutcome(5, 6, 2), { total: 13, after: 0, siren: true, wantedUp: 1 });
  assert.equal(A.heatOutcome(1, 0, -6).total, 0, 'never below 0');
  assert.equal(A.heatOutcome('x', null, undefined).total, 0, 'junk is 0');
});

await test('lines(): split on | and new lines, trimmed, six at most, 80 characters each', () => {
  assert.deepEqual(A.lines('The Kestrel Club +1 | The Tidewater Watch -1\n\n  '), ['The Kestrel Club +1', 'The Tidewater Watch -1']);
  assert.equal(A.lines('a|b|c|d|e|f|g|h').length, 6);
  assert.equal(A.lines('x'.repeat(200))[0].length, 80);
  assert.deepEqual(A.lines(undefined), []);
});

await test('the siren step: wanted is untouched unless the heat track is full; full means wanted +1 and the heat clears', () => {
  const w = (heat, exposure, mods, wanted) => A.payloadFor('heat', { heat, exposure, mods, wanted }).payload;
  const notFull = w(5, 2, 1, 2); assert.deepEqual([notFull.wanted, notFull.after, notFull.siren], [2, 8, undefined], 'heat 8: wanted stays 2, heat is 8');
  assert.equal(w(0, 0, 0, 3).wanted, 3, 'no heat gained, wanted unchanged'); assert.equal(w(8, 0, 0, 0).wanted, 0, 'one short of full leaves wanted alone');
  const full = w(5, 2, 2, 2); assert.deepEqual([full.wanted, full.after, full.siren], [3, 0, true], 'heat 9: wanted +1 and the heat clears');
  assert.equal(w(9, 0, 0, 1).wanted, 2, 'already at 9 is full'); assert.equal(w(9, 6, 0, 4).wanted, 4, 'wanted stays capped at 4');
  assert.equal(A.heatOutcome(5, 2, 1).wantedUp, 0); assert.equal(A.heatOutcome(5, 2, 2).wantedUp, 1);
});

const DATA = { stacks: 14, tithe: 3, heat: 5, exposure: 4, mods: 2, wanted: 1, status: 'The Kestrel Club +1 | The Tidewater Watch -1', harm: 'Nell Arbuthnot: a bad leg', who: 'Nell Arbuthnot', line: 'Spend your downtime first' };
await test('every step builds a payload the GM page, the Worker and the display all accept, and stable under a second clean', () => {
  for (const s of A.STEPS) {
    const pl = A.payloadFor(s.id, DATA, { npcIds: ['n-mabel', 'n-dov'] });
    assert.ok(pl, s.id);
    assert.ok(Show.has(pl.kind), s.id + ' is a GM show kind');
    assert.ok(Show.payloadOk(pl.kind, pl.payload), s.id + ' passes the GM page mirror: ' + JSON.stringify(pl.payload));
    const server = cleanShowPayload(pl.kind, pl.payload);
    assert.deepEqual(server, pl.payload, s.id + ' passes the Worker untouched');
    if (pl.kind === 'aftermath') { const d = S.clean('aftermath', pl.payload); assert.ok(d, s.id + ' passes the display'); assert.deepEqual(S.clean('aftermath', d), d); }
  }
  assert.ok(Show.overlayFor('aftermath', A.payloadFor('heat', DATA).payload, { ms: A.HOLD_MS, id: 'k1' }), 'a held step is a legal overlay length');
  const heat = A.payloadFor('heat', DATA).payload;
  assert.deepEqual([heat.siren, heat.after, heat.wanted, heat.heat, heat.exposure, heat.mods], [true, 0, 2, 5, 4, 2], 'the siren step names the new wanted level');
  const tithe = A.payloadFor('tithe', DATA).payload; assert.deepEqual([tithe.tithe, tithe.kept], [3, 11]);
  assert.equal(A.payloadFor('xp', DATA).payload.secs, 90);
  assert.equal(A.payloadFor('credits', DATA, { npcIds: [] }), null, 'nobody to credit: nothing is sent');
  assert.equal(A.payloadFor('nope', DATA), null);
  assert.deepEqual(Object.keys(SHOW_KINDS).filter((k) => k === 'aftermath' || k === 'credits'), ['aftermath', 'credits']);
});

await test('the Worker refuses an Aftermath payload out of bounds, and the display refuses what the Worker would', () => {
  const bad = [{}, { step: 'dinner' }, { step: 'payout', stacks: 100 }, { step: 'payout', stacks: -1 }, { step: 'heat', heat: 10 }, { step: 'heat', mods: 7 }, { step: 'heat', siren: 'yes' },
    { step: 'status', lines: 'one' }, { step: 'status', lines: Array.from({ length: 7 }, () => 'x') }, { step: 'status', lines: ['x'.repeat(81)] }, { step: 'xp', secs: 9 }, { step: 'xp', secs: 181 }, { step: 'unwind', who: 'x'.repeat(61) }];
  for (const p of bad) {
    assert.throws(() => cleanShowPayload('aftermath', p), (e) => e.status === 400, JSON.stringify(p));
    const shown = S.clean('aftermath', p);       // the display drops a bad optional field (as every beat does) and refuses a bad step
    if (!p.step || p.step === 'dinner') assert.equal(shown, null, 'the display: ' + JSON.stringify(p));
    else for (const k of Object.keys(p)) if (k !== 'step') {
      if (k === 'lines' && Array.isArray(p.lines) && p.lines.length > 6) assert.ok(shown.lines.length <= 6, 'the display shows six lines at most');
      else assert.equal(shown[k], undefined, 'the display drops ' + k + ' from ' + JSON.stringify(p));
    }
  }
  assert.throws(() => cleanShowPayload('credits', { npcIds: [] }), (e) => e.status === 400);
  assert.throws(() => cleanShowPayload('credits', { npcIds: Array.from({ length: 31 }, (_, i) => 'n' + i) }), (e) => e.status === 400);
  assert.equal(S.clean('credits', { npcIds: ['n-mabel'] }), null, 'the STORED shape (ids) never draws: only server-joined cards');
  assert.equal(Show.payloadOk('aftermath', { step: 'status', lines: ['ok', 3] }), false);
  assert.ok(!JSON.stringify(cleanShowPayload('aftermath', { step: 'payout', stacks: 3, stray: 'STRAY-MARKER' })).includes('STRAY'));
});

await test('free text in a list is words too: the hidden-name scan sees every line, on the page and in the Worker', async () => {
  const seen = Show.texts('aftermath', { step: 'status', lines: ['The Kestrel Club +1', 'GM-ONLY-NPC-1 owes a favour'], who: 'Nell' });
  assert.deepEqual(seen.filter((t) => t !== 'status').sort(), ['GM-ONLY-NPC-1 owes a favour', 'Nell', 'The Kestrel Club +1']);
  assert.ok(seen.some((t) => t.includes('GM-ONLY-NPC-1')));
  const { showTexts } = await import('../../functions/_lib/show.js');
  const ws = showTexts({ kind: 'aftermath', payload: { step: 'harm', lines: ['GM-ONLY-NPC-1 hurt a guard'] } }, null);
  assert.deepEqual(ws.filter((t) => t !== 'harm'), ['GM-ONLY-NPC-1 hurt a guard']);
});

await test('the GM page mirror measures a line by its words: runs of the letter s are not whitespace, runs of spaces are', () => {
  const ok = (lines) => Show.payloadOk('aftermath', { step: 'status', lines });
  assert.equal(ok(['s'.repeat(80)]), true, '80 characters fit');
  assert.equal(ok(['s'.repeat(81)]), false, '81 s characters do not (a bad pattern collapsed them to one space)');
  assert.equal(ok(['Misses assists across the board'.repeat(3)]), false, '93 characters of words do not fit');
  assert.equal(ok(['a' + ' '.repeat(40) + 'b']), true, 'forty spaces count as one, as the Worker counts them');
  assert.equal(ok(['a\t\n b']), true);
  assert.equal(ok(['   ']), false, 'blank is no line');
  assert.ok(!/replace\(\/s\+\//.test(require('node:fs').readFileSync(path.join(APP, 'gm', 'show.js'), 'utf8')), 'no whitespace pattern is missing its backslash');
});

await test('met(): a revealed NPC first seen tonight, on stage, or ticked; never a hidden one, a nameless one or an unticked one', () => {
  const since = Date.parse('2026-11-07T19:00:00Z');
  const npcs = [
    { id: 'n-new', name: 'Mabel Quist', revealed: true, firstSeen: '2026-11-07T19:30:00Z' },
    { id: 'n-old', name: 'Dov Kessler', revealed: true, firstSeen: '2026-10-31T19:30:00Z' },
    { id: 'n-stage', name: 'Lotte Brand', revealed: true, firstSeen: '2026-10-01T00:00:00Z', staged: true },
    { id: 'n-hid', name: 'GM-ONLY-NPC-1', revealed: false, firstSeen: '2026-11-07T20:00:00Z', staged: true },
    { id: 'n-blank', name: ' ', revealed: true, firstSeen: '2026-11-07T20:00:00Z' },
    { id: 'n-off', name: 'Ada Vell', revealed: true, firstSeen: '2026-11-07T20:00:00Z' },
    { id: 'n-hand', name: 'Hob Tamsin', revealed: true, firstSeen: '' }];
  assert.deepEqual(A.met(npcs, since, {}), ['n-new', 'n-stage', 'n-off']);
  assert.deepEqual(A.met(npcs, since, { 'n-off': false, 'n-hand': true, 'n-old': true, 'n-hid': true }), ['n-new', 'n-old', 'n-stage', 'n-hand']);
  assert.ok(!A.met(npcs, since, { 'n-hid': true }).includes('n-hid'), 'ticking a hidden NPC does not reveal them');
  assert.deepEqual(A.met(null, since, null), []);
});

await test('pendingFor lists the steps not done, in order', () => {
  assert.deepEqual(A.pendingFor({}), A.STEPS.map((s) => s.id));
  assert.deepEqual(A.pendingFor({ payout: true, tithe: true, heat: true, status: true, harm: true, unwind: true, xp: true, credits: true }), []);
  assert.deepEqual(A.pendingFor({ payout: true, heat: true }), ['tithe', 'status', 'harm', 'unwind', 'xp', 'credits']);
});

/* ---------- the controller, on a recorded host and a clock the test moves ---------- */
const CAST = [
  { id: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', revealed: true, firstSeen: '2026-11-07T20:10:00.000Z', staged: false },
  { id: 'n-dov', name: 'Dov Kessler', role: 'Desk sergeant', revealed: true, firstSeen: '2026-11-07T20:40:00.000Z', staged: false },
  { id: 'n-lotte', name: 'Lotte Brand', role: 'Doorwoman', revealed: true, firstSeen: '2026-09-01T00:00:00.000Z', staged: true },
  { id: 'n-hid', name: 'GM-ONLY-NPC-1', role: 'GM-ONLY-ROLE-1', revealed: false, firstSeen: '2026-11-07T21:00:00.000Z', staged: true }];
function rig(over) {
  const t = { now: Date.parse('2026-11-07T22:00:00Z') };
  const log = [], docsLog = [], layers = {};
  let nightDoc = null;
  const nightCtl = Night.create({ doc: () => ({ night: nightDoc }), patch: (p) => { nightDoc = mergeNight(nightDoc, p.night); return true; }, now: () => t.now, prep: () => null });
  function mergeNight(cur, p) { const c = JSON.parse(JSON.stringify(cur || {})); if (p === null) return null; for (const [k, v] of Object.entries(p)) { if (k === 'aftermath') { c.aftermath = c.aftermath || { data: {} }; c.aftermath.step = v.step; const d = c.aftermath.data || {}; for (const [dk, dv] of Object.entries(v.data || {})) { if (dv === null) delete d[dk]; else d[dk] = dv; } c.aftermath.data = d; } else if (k === 'phases') { c.phases = c.phases || {}; for (const [pk, pv] of Object.entries(v)) c.phases[pk] = Object.assign(c.phases[pk] || {}, pv); } else if (k === 'log') { c.log = Object.assign(c.log || {}, v); } else c[k] = v; } return c; }
  const host = Object.assign({
    enabled: () => true,
    show: (kind, payload, o) => { log.push({ at: t.now, kind, payload, ms: o.ms, key: o.key }); assert.ok(Show.overlayFor(kind, payload, { ms: o.ms, id: 'x' }), 'the GM page would send it: ' + kind); return Promise.resolve({ ok: true }); },
    layer: (p, v) => { layers[p] = v; log.push({ at: t.now, layer: p, value: v }); return Promise.resolve({ ok: true }); },
    clearShow: (o) => { log.push({ at: t.now, clear: o }); return Promise.resolve({ ok: true }); },
    night: () => nightCtl,
    docs: { put: (row) => { docsLog.push({ at: t.now, put: row }); return Promise.resolve({ ok: true }); }, del: (k, o) => { docsLog.push({ at: t.now, del: [k, o] }); return Promise.resolve({ ok: true }); } },
    npcs: () => CAST, crew: () => ({ heat: 5, wanted: 1, vault: 3 }), since: () => Date.parse('2026-11-07T19:00:00Z'), now: () => t.now,
    toast: (m, bad) => log.push({ toast: m, bad: !!bad })
  }, over || {});
  return { t, log, docsLog, layers, host, ctl: A.create(host), night: () => nightDoc, nightCtl };
}
const shows = (r) => r.log.filter((x) => x.kind);

await test('the fixture night runs end to end in 12 minutes or less, with the iPad told each step in order and the phones told only during step 7', async () => {
  const r = rig();
  const t0 = r.t.now;
  assert.equal(await r.ctl.start(), true);
  assert.deepEqual([r.layers['band.phase'], r.layers['scene.mode']], ['after', 'aftermath']);
  assert.equal(r.nightCtl.phase(), 'after', 'the night is in the Aftermath');
  assert.deepEqual(r.docsLog, [], 'no phone sees anything before step 7');
  await r.ctl.set({ stacks: 14, tithe: 3, exposure: 4, mods: 2, status: 'The Kestrel Club +1', harm: 'Nell Arbuthnot: a bad leg', who: 'Nell Arbuthnot' });
  for (let i = 0; i < A.STEPS.length; i++) {
    assert.equal(r.ctl.state().step.id, A.STEPS[i].id);
    const during = r.docsLog.length;
    r.t.now += A.STEPS[i].secs * 1000;
    if (A.STEPS[i].id === 'xp') assert.deepEqual(r.docsLog.map((x) => Object.keys(x).filter((k) => k !== 'at')[0]), ['put'], 'the row stands during step 7');
    else if (i < 6) assert.equal(r.docsLog.length, during);
    assert.equal(await r.ctl.next(), true);
  }
  const mins = (r.t.now - t0) / 60000;
  assert.ok(mins <= 12, 'the night took ' + mins.toFixed(2) + ' minutes');
  assert.equal(r.ctl.state().open, false, 'finished');
  const order = shows(r).filter((x) => !x.resend).map((x) => (x.kind === 'credits' ? 'credits' : x.payload.step));
  assert.deepEqual([...new Set(order)], ['payout', 'tithe', 'heat', 'status', 'harm', 'unwind', 'xp', 'credits']);
  const puts = r.docsLog.filter((x) => x.put), dels = r.docsLog.filter((x) => x.del);
  assert.equal(puts.length, 1); assert.equal(dels.length, 1);
  assert.deepEqual(puts[0].put, { kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: puts[0].at + 90000 } });
  assert.ok(dels[0].at >= puts[0].at + 90000 - 1, 'the row is taken down after the 90 seconds, when the GM moves on');
  assert.deepEqual(dels[0].del, ['commend', '_']);
  assert.equal(r.layers['scene.mode'], null, 'the aftermath scene mode is cleared');
  assert.equal(r.log.filter((x) => x.clear).length, 1);
  const aft = r.night().aftermath;
  assert.equal(aft.step, 'done'); assert.equal(aft.data.pending, '', 'nothing left for the Debrief');
  assert.equal(r.night().phase, 'after');
});

await test('the credits are revealed NPCs met tonight only: a hidden NPC is never sent, ticking one off or on changes the list', async () => {
  const r = rig();
  await r.ctl.start(); await r.ctl.go(7);
  let c = shows(r).filter((x) => x.kind === 'credits').pop();
  assert.deepEqual(c.payload.npcIds, ['n-mabel', 'n-dov', 'n-lotte']);
  assert.ok(!JSON.stringify(shows(r)).includes('GM-ONLY'), 'no GM-ONLY marker in anything sent');
  r.ctl.pick('n-dov', false); r.ctl.pick('n-hid', true);
  await new Promise((res) => setTimeout(res, 0));
  c = shows(r).filter((x) => x.kind === 'credits').pop();
  assert.deepEqual(c.payload.npcIds, ['n-mabel', 'n-lotte']);
  const none = rig({ npcs: () => [CAST[3]] });
  await none.ctl.start(); await none.ctl.go(7);
  assert.equal(shows(none).filter((x) => x.kind === 'credits').length, 0, 'nobody met: no credits beat');
  assert.match(none.ctl.state().msg, /No revealed NPC/);
});

await test('every step can be skipped; a step skipped or not reached goes to the Debrief; Back un-skips', async () => {
  const r = rig();
  await r.ctl.start();
  for (let i = 0; i < 8; i++) await r.ctl.skip();
  assert.equal(r.ctl.state().open, false);
  assert.equal(r.night().aftermath.data.pending, 'payout,tithe,heat,status,harm,unwind,xp,credits');
  const q = rig();
  await q.ctl.start(); await q.ctl.next(); await q.ctl.skip(); await q.ctl.next();   // payout done, tithe skipped, heat done
  assert.deepEqual(q.ctl.state().pending, ['tithe', 'status', 'harm', 'unwind', 'xp', 'credits']);
  await q.ctl.back(); await q.ctl.back();                                             // back to tithe: it is no longer done-or-skipped
  assert.equal(q.ctl.state().step.id, 'tithe'); assert.ok(q.ctl.state().done.payout);
  await q.ctl.next(); await q.ctl.next();
  assert.equal(q.ctl.state().step.id, 'status');
  await q.ctl.stop();                                                                  // End now at step 4: the rest is filed
  assert.equal(q.night().aftermath.data.pending, 'status,harm,unwind,xp,credits');
  assert.equal(q.docsLog.length, 0, 'the phones were never told: step 7 was not reached');
});

await test('leaving step 7 any way takes the commendations off the phones: Next, Skip, Back, End now', async () => {
  for (const way of ['next', 'skip', 'back', 'stop']) {
    const r = rig();
    await r.ctl.start(); await r.ctl.go(6);
    assert.equal(r.docsLog.filter((x) => x.put).length, 1, way + ': put on entering');
    await r.ctl[way]();
    assert.equal(r.docsLog.filter((x) => x.del).length, 1, way + ': deleted on leaving');
  }
  const r = rig();
  await r.ctl.start(); await r.ctl.go(3); await r.ctl.go(2);
  assert.equal(r.docsLog.length, 0, 'a skim past never touched the store');
});

await test('a step held for long is sent again before the 180 s beat ends, with a new key; the xp step is not', async () => {
  const r = rig();
  await r.ctl.start();
  const n0 = shows(r).length;
  r.t.now += 100000; await r.ctl.tick(); assert.equal(shows(r).length, n0, 'not yet');
  r.t.now += 60000; await r.ctl.tick(); assert.equal(shows(r).length, n0 + 1, 'sent again at 160 s');
  const [a, b] = shows(r).slice(-2); assert.notEqual(a.key, b.key); assert.equal(a.ms, A.HOLD_MS);
  await r.ctl.go(6); const n1 = shows(r).length;
  r.t.now += 170000; await r.ctl.tick(); assert.equal(shows(r).length, n1, 'step 7 runs its 90 s and is left');
  assert.equal(shows(r).slice(-1)[0].ms, 90000);
});

await test('numbers the GM types are clamped and re-sent; the siren is the new wanted level, from the crew sheet when nothing was typed', async () => {
  const r = rig();
  await r.ctl.start(); await r.ctl.go(2);
  assert.equal(r.ctl.state().data.heat, 5, 'heat starts at the crew\'s');
  await r.ctl.set({ exposure: 99, mods: 99, wanted: 9 });
  const d = r.ctl.state().data; assert.deepEqual([d.exposure, d.mods, d.wanted], [6, 6, 4]);
  const p = shows(r).slice(-1)[0].payload; assert.deepEqual([p.step, p.siren, p.wanted, p.after], ['heat', true, 4, 0]);
  await r.ctl.set({ exposure: 0, mods: 0, wanted: 1 });
  const q = shows(r).slice(-1)[0].payload; assert.deepEqual([q.siren, q.after, q.wanted], [undefined, 5, 1]);
});

await test('off: the switch refuses a start, and nothing is sent', async () => {
  const r = rig({ enabled: () => false });
  assert.equal(await r.ctl.start(), false);
  assert.deepEqual(r.log.filter((x) => !x.toast), []); assert.equal(r.ctl.state().open, false);
  assert.equal(await r.ctl.next(), false); assert.equal(await r.ctl.back(), false); assert.equal(await r.ctl.skip(), false);
});

await test('a page reload mid-show resumes at the step the night document holds', async () => {
  const r = rig();
  await r.ctl.start(); await r.ctl.set({ stacks: 9 }); await r.ctl.next(); await r.ctl.next();
  const again = A.create(r.host);                                                       // a new page, same night document
  assert.equal(again.resume(), true);
  const s = again.state(); assert.equal(s.step.id, 'heat'); assert.equal(s.data.stacks, 9); assert.ok(s.done.payout && s.done.tithe);
  const none = A.create(rig().host); assert.equal(none.resume(), false);
});

await test('the line is a registered phone line with bland text, ON whatever is stored (N0: everything built is on)', () => {
  const s = Features.get('spine.aftermath');
  assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'phone'); assert.equal(s.stage, 'spine');
  assert.ok(!/Kestrel|Pelican|Tidewater|Mabel|Nell/.test(s.label + s.doc), 'bland text: no names');
  assert.equal(Features.valueOf({}, 'spine.aftermath'), true, 'on with nothing stored');
  assert.equal(Features.valueOf({ features: { 'spine.aftermath': false } }, 'spine.aftermath'), true, 'a stored false is still on');
});

/* ---------- the display ---------- */
await test('the display draws each step from its fixture by textContent only, and the look book has a card for each', async () => {
  writes.length = 0;
  const e = S.entry('aftermath');
  assert.equal(e.fixtures.length, 7);
  for (const f of e.fixtures) {
    const node = await S.mount({ kind: 'aftermath', payload: f.fixture }, { document: doc, reduced: true });
    assert.ok(node && node.classList.contains('dp-show-aftermath') && node.getAttribute('data-step') === f.fixture.step, f.label);
    assert.ok(node.outerHTML.includes('Aftermath'), f.label + ' says where it is');
  }
  const pay = await S.mount({ kind: 'aftermath', payload: { step: 'payout', stacks: 14 } }, { document: doc, reduced: true });
  assert.equal(pay.querySelectorAll('.dp-aft-stack').length, 14); assert.equal(pay.querySelector('.dp-aft-big').textContent, '14');
  const heat = await S.mount({ kind: 'aftermath', payload: { step: 'heat', exposure: 4, mods: 2, heat: 5, after: 0, siren: true, wanted: 2 } }, { document: doc, reduced: true });
  assert.equal(heat.querySelectorAll('.dp-aft-pip').length, 9); assert.equal(heat.querySelectorAll('.dp-aft-pip.on').length, 9, 'the meter reads 9 at the siren');
  const sub = await S.mount({ kind: 'aftermath', payload: { step: 'status', lines: ['<img src=x onerror=alert(1)>'] } }, { document: doc, reduced: true });
  assert.ok(!/<img/.test(sub.outerHTML) && sub.outerHTML.includes('&lt;img'), 'markup in a line is text');
  const none = await S.mount({ kind: 'aftermath', payload: { step: 'harm' } }, { document: doc, reduced: true });
  assert.ok(none.outerHTML.includes('No harm complications'));
  const cr = await S.mount({ kind: 'credits', payload: S.entry('credits').fixture }, { document: doc, reduced: true });
  assert.equal(cr.querySelectorAll('.dp-cr-row').length, 6); assert.equal(cr.querySelectorAll('.dp-cr-bar').length, 4, 'four bars, as the opening card has');
  assert.ok(cr.outerHTML.includes('Mabel Quist'));
  /* the GM night rebuild: the fixture carries a 14-letter surname; a name is one text, never split, and the role and the faction are lines of their own */
  const names = cr.querySelectorAll('.dp-cr-name').map((n) => n.textContent);
  assert.ok(names.includes('Ottilie Vandermeerholt') && 'Vandermeerholt'.length === 14, 'a 14-letter surname in the fixture: ' + names.join(', '));
  assert.deepEqual(cr.querySelectorAll('.dp-cr-row')[1].querySelectorAll('.dp-cr-role').map((n) => n.textContent), ['Desk sergeant', 'The Tidewater Watch'], 'the role over the faction, no dot');
  assert.deepEqual(writes, [], 'nothing written as HTML');
});

await test('the GM night rebuild: the heat step is read first and WANTED follows it as its own beat, never on top of it; the credits never break a name inside a word', async () => {
  const css = fs.readFileSync(path.join(APP, 'display', 'aftermath.css'), 'utf8');
  assert.match(css, /\.dp-aft-heat\.dp-aft-to-wanted > :not\(\.dp-show-wanted\) \{ opacity: 0; visibility: hidden;/, 'the heat step steps out before WANTED comes in');
  assert.match(css, /\.dp-show-credits \.dp-cr-name, \.dp-show-credits \.dp-cr-role \{ overflow-wrap: normal; word-break: normal;/, 'names and roles wrap at spaces only');
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/, 'four equal columns, one per bar, whatever a name holds');
  const timers = []; const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
  try {
    const heat = await S.mount({ kind: 'aftermath', payload: { step: 'heat', exposure: 4, mods: 2, heat: 5, after: 0, siren: true, wanted: 2 } }, { document: doc, reduced: false });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const w = heat.querySelector('.dp-show-wanted');
    assert.ok(w, 'the WANTED beat is ready inside the heat card');
    assert.ok(!heat.classList.contains('dp-aft-to-wanted') && !w.classList.contains('dp-ov-in'), 'at first only the heat step shows');
    const swap = timers.find((t) => t.ms >= 3000);
    assert.ok(swap, 'the swap waits until the step has been read: ' + timers.map((t) => t.ms).join(','));
    swap.fn();
    assert.ok(heat.classList.contains('dp-aft-to-wanted') && w.classList.contains('dp-ov-in'), 'then the step steps out and WANTED comes in');
  } finally { globalThis.setTimeout = realSet; }
});

await test('the end credits draw only the cards the Worker joined, no hidden key, at most 30', () => {
  const r = S.clean('credits', { npcs: [{ npcId: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', revealed: false }, { name: 'no id' }] });
  assert.equal(r.npcs.length, 1); assert.ok(!JSON.stringify(r).includes('MARKER'));
  assert.equal(S.clean('credits', { npcs: Array.from({ length: 40 }, (_, i) => ({ npcId: 'n' + i, name: 'N' + i })) }).npcs.length, 30);
  assert.equal(S.clean('credits', { npcs: [] }), null);
});

/* ---------- the phone ---------- */
await test('the commendations window: open while the row stands and both clocks agree, shut on its own, and a stale row cannot hold it up', () => {
  const W = Commend.windowOf, until = 1000000;
  assert.deepEqual(W({ until, secs: 90 }, until - 90000, until - 90000), { open: true, left: 90 });
  assert.deepEqual(W({ until, secs: 90 }, until - 1000, until - 90000), { open: true, left: 1 });
  assert.equal(W({ until, secs: 90 }, until, until - 1).open, false, 'at until it is shut');
  assert.equal(W({ until, secs: 90 }, until + 5000, until - 90000).open, false);
  assert.equal(W({ until: until + 600000, secs: 90 }, until, until - 91000).open, false, 'first seen 91 s ago on this phone: shut, whatever until says');
  assert.equal(W({ until: until + 600000, secs: 90 }, until, until).open, true, 'a phone whose clock is slow still gets its 90 s at most');
  for (const bad of [null, {}, { until: 'x' }, { until: -1 }, []]) assert.equal(W(bad, 5, 5).open, false);
});

function phone() {
  const calls = [], listeners = {};
  let t = 5000000, refreshed = 0, rows = [];
  const W = {
    fetch: (url, o) => { calls.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ docs: rows }) }); },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {},
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    B68Live: { on: (kinds, fn) => { listeners.live = { kinds, fn }; return () => { listeners.live = null; }; } },
    B68Tracker: { isOpen: () => true, refresh: () => { refreshed++; } }
  };
  return { W, calls, listeners, rows: (r) => { rows = r; }, refreshed: () => refreshed, now: (n) => { t = n; } };
}
await test('the phone: nothing is fetched until it is started; started, it reads only the commend row, is the Now card\'s item while it stands and clears it when the row goes', async () => {
  // the module reads the global window it was loaded with: load a fresh copy against a fake one
  const p = phone();
  const realNow = Date.now; let now = 5000000; Date.now = () => now;
  try {
    const Mod = (await import('node:module')).createRequire(import.meta.url)(path.join(APP, 'sheet', 'commend.js'));
    assert.equal(Commend.now(), null, 'not started: no item');
    assert.equal(p.calls.length, 0);
    // the module in this process is bound to globalThis; give it the fake window's parts
    Object.assign(globalThis, { fetch: p.W.fetch, document: p.W.document, B68Live: p.W.B68Live, B68Tracker: p.W.B68Tracker });
    Mod.start();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(p.calls, ['/api/docs?kind=commend&limit=1'], 'one read, one kind');
    assert.deepEqual(p.listeners.live.kinds, ['docs']);
    p.rows([{ kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: now + 90000 } }]);
    p.listeners.live.fn('docs');
    await new Promise((r) => setTimeout(r, 0));
    const it = Mod.now();
    assert.ok(it && it.actions.length === 1 && it.actions[0].attrs === 'data-act="endopen"' && it.actions[0].primary === true && /xp/.test(it.title), 'the item opens the sheet\'s own end-of-session panel: ' + JSON.stringify(it));
    assert.equal(it.ends, now + 90000, 'it counts down to the window\'s own end');
    now += 30000; assert.equal(Mod.now().ends, it.ends, 'the end does not move while the window stands (the card is not redrawn every second)');
    assert.ok(p.refreshed() >= 1, 'the sheet was redrawn');
    now += 61000; assert.equal(Mod.now(), null, 'ninety seconds on, it is gone');
    p.rows([{ kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: now + 90000 } }]);
    p.listeners.live.fn('docs'); await new Promise((r) => setTimeout(r, 0));
    assert.ok(Mod.now(), 'a new row opens it again');
    p.rows([]); p.listeners.live.fn('docs'); await new Promise((r) => setTimeout(r, 0));
    assert.equal(Mod.now(), null, 'the GM took the row down: gone at once');
    Mod.stop(); assert.equal(p.listeners.live, null, 'stop() lets go of the live socket');
    const before = p.calls.length; Mod.stop(); assert.equal(p.calls.length, before);
  } finally { Date.now = realNow; for (const k of ['fetch', 'document', 'B68Live', 'B68Tracker']) delete globalThis[k]; }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
