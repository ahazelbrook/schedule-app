// gm-night-ticks (RK03, night.flow): a stamped consequence ticks its clock. app/gm/night-ticks.js under Node with fake hosts, and app/gm/stamp.js's two
// night.flow branches (the stamp's key in view().active.at; no action span in the iPad's payload). No browser, no network. Every name is invented.
//   node checks/runtime/gm-night-ticks.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/night-ticks.js';
const NT = require(path.join(ROOT, FILE));
const BC = require(path.join(ROOT, 'app/gm/blade-chips.js'));
const St = require(path.join(ROOT, 'app/gm/stamp.js'));
let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const tick = () => new Promise((r) => setTimeout(r, 0));

const ALARM = () => ({ id: 'c-alarm', name: 'House alarm', size: 6, filled: 0, kind: 'danger', hidden: true });
const MARKER = () => ({ id: 'c-marker', name: 'Win back the marker', size: 8, filled: 3, kind: 'progress' });
const ROOM = (wrong) => ({ byRoom: { 'The Showroom': { md: '- **Costume:** Evening dress\n- **Who:** Mabel Quist\n- If it goes wrong: ' + wrong + '\n\n> [!quote] SAY\n> Do enjoy the tables.' } } });

/* a fake page: the table's clocks, the paHost it ticks through, the night log and the toasts */
function page(o = {}) {
  const P = { clocks: o.clocks || [ALARM(), MARKER()], ops: [], logs: [], toasts: [], undos: [], line: o.line || '', room: o.room || null, alarm: o.alarm === undefined ? 'House alarm' : o.alarm };
  P.th = {
    clocks: () => P.clocks.map((c) => ({ ...c })),
    clockOps: (ops) => { P.ops.push(ops); ops.forEach((op) => { const c = P.clocks.find((k) => k.id === op.id); if (c && 'filled' in op) c.filled = op.filled; }); return Promise.resolve(true); },
    toast: (m, bad) => P.toasts.push({ m, bad }),
    undoToast: (text, undo) => { P.undos.push({ text, undo }); return {}; }
  };
  P.host = {
    clocks: () => P.clocks.map((c) => ({ ...c })), line: () => P.line, roomNotes: () => P.room, room: () => 'Showroom', alarm: () => P.alarm,
    tickHost: () => P.th, log: (t) => P.logs.push(t), toast: (m, bad) => P.toasts.push({ m, bad }), changed: () => {}
  };
  P.ctl = NT.create(P.host);
  BC._reset();
  return P;
}
const fill = (P, id) => P.clocks.find((k) => k.id === id).filled;
const stamp = (at) => ({ on: true, active: { position: 'risky', effect: 'standard', text: 'x', at } });

// ---------- the module ----------
test('loads under Node, and as a plain script defines window.B68GmNightTicks (no longer a stub)', () => {
  assert.equal(typeof NT.create, 'function');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  assert.ok(win.B68GmNightTicks && typeof win.B68GmNightTicks.create === 'function' && !win.B68GmNightTicks.stub);
});

// ---------- the sure match (RK04's rule) ----------
test('sure: the clock’s own name, case and punctuation aside, with or without a leading the/a/an or a trailing "clock"', () => {
  const l = [ALARM(), MARKER()];
  for (const n of ['House alarm', 'house ALARM', 'house-alarm!', 'the House alarm', 'House alarm clock', 'the house alarm clock', 'Win back the marker']) assert.ok(NT.sure(n, l).hit, n);
  assert.equal(NT.sure('the house alarm', l).hit.id, 'c-alarm');
  assert.equal(NT.sure('alarm', [{ id: 'k', name: 'The Alarm', size: 4, filled: 0 }]).hit.id, 'k', 'a clock named with a leading "the" is sure under its bare name');
});
test('sure: a loose-only match ("House alarms", "the nights") is none, naming the near clock; two clocks of one name are many', () => {
  const l = [ALARM(), MARKER(), { id: 'c-lights', name: 'Lights out', size: 4, filled: 0 }];
  const r = NT.sure('House alarms', l);
  assert.ok(r.none && !r.hit, 'no hit');
  assert.equal(r.loose && r.loose.id, 'c-alarm', 'the near one is named');
  assert.ok(NT.sure('the nights', l).none && !NT.sure('the nights', l).hit, '"the nights" never hits "Lights out"');
  assert.ok(NT.sure('Lighthouse', l).none);
  assert.equal(NT.sure('Alarm', [{ id: 'a', name: 'Alarm' }, { id: 'b', name: 'The alarm' }]).many.length, 2);
  assert.ok(NT.sure('', l).none);
});

// ---------- the prefill ----------
test('wrongMd: the room’s "If it goes wrong" lines as written, and the lines under a bare label; fences and other lines skipped', () => {
  const md = '- **Who:** Ada Vell `▶ tick: Not this / 3`\n- If it goes wrong: the bell rings `▶ tick: House alarm / 2`\n\n**If it goes wrong**\n- a fall\n- a shout\n\n```\nIf it goes wrong: `▶ tick: Fenced / 1`\n```\nAfter';
  const w = NT.wrongMd(md);
  assert.match(w, /House alarm \/ 2/); assert.match(w, /a fall/); assert.match(w, /a shout/);
  assert.doesNotMatch(w, /Not this|Fenced|After/);
});
test('prefill: a span in the Roll’s line first, then one in the room’s line, then the play’s alarm clock +1; nothing when there is none', () => {
  const room = ROOM('the bell rings `▶ tick: Win back the marker / 2`').byRoom['The Showroom'].md;
  assert.deepEqual(NT.prefill({ line: 'The lights go out `▶ tick: House alarm / 3`', room, alarm: 'House alarm' }), { name: 'House alarm', n: 3, from: 'line' });
  assert.deepEqual(NT.prefill({ line: 'The lights go out', room, alarm: 'House alarm' }), { name: 'Win back the marker', n: 2, from: 'room' });
  assert.deepEqual(NT.prefill({ line: 'The lights go out', room: 'If it goes wrong: a fall', alarm: 'House alarm' }), { name: 'House alarm', n: 1, from: 'alarm' });
  assert.deepEqual(NT.prefill({ line: 'The lights go out', room: '- **Who:** `▶ tick: Not this / 3`', alarm: 'House alarm' }).from, 'alarm', 'a span outside the If it goes wrong lines is not the room’s tick');
  assert.equal(NT.prefill({ line: '', room: '', alarm: '' }), null);
  assert.ok(NT.roomMd(ROOM('x'), 'Showroom', (s) => s.toLowerCase().replace(/^the /, '')).includes('If it goes wrong: x'), 'the room is found by its normalised name');
});
test('rows: both rows start from the prefill on a sure hit; a miss keeps its name; a pick wins, and a pick of a clock gone from the table falls back', () => {
  const l = [ALARM(), MARKER()];
  const r = NT.rows({ name: 'house alarm', n: 2, from: 'room' }, l, {});
  assert.deepEqual([r['13'].id, r['13'].n, r['45'].id, r['45'].n], ['c-alarm', 2, 'c-alarm', 2]);
  const m = NT.rows({ name: 'House alarms', n: 1, from: 'room' }, l, {});
  assert.equal(m['13'].id, ''); assert.equal(m['13'].miss, 'House alarms'); assert.equal(m['13'].loose, 'House alarm');
  const p = NT.rows({ name: 'House alarm', n: 1 }, l, { '45': { id: '', n: 1 }, '13': { id: 'c-marker', n: 3 } });
  assert.deepEqual([p['13'].id, p['13'].n, p['13'].picked, p['45'].id, p['45'].picked], ['c-marker', 3, true, '', true]);
  const g = NT.rows({ name: 'House alarm', n: 1 }, l, { '13': { id: 'c-gone', n: 3 } });
  assert.equal(g['13'].id, 'c-alarm');
});

// ---------- the tick at the mark ----------
test('a 1–3 on a stamped roll ticks the alarm clock by one: one absolute clockOps, a toast with Undo led by the result, a night-log line', async () => {
  const P = page();
  const r = await P.ctl.marked('onetothree', stamp(1001));
  assert.ok(r.ok);
  assert.deepEqual(P.ops, [[{ id: 'c-alarm', filled: 1 }]], 'one absolute fill');
  assert.equal(fill(P, 'c-alarm'), 1);
  assert.equal(P.undos.length, 1); assert.match(P.undos[0].text, /^On 1–3: House alarm ticks 0 to 1 of 6\.$/);
  assert.deepEqual(P.logs, ['Tick on 1–3: House alarm 0 to 1/6']);
  assert.ok(P.logs[0].length <= 80, 'a night-log line fits the log');
});
test('marking again (the same stamp) leaves it at 1; so does a 4/5 after it; a new stamp ticks again', async () => {
  const P = page();
  await P.ctl.marked('onetothree', stamp(1001));
  assert.equal((await P.ctl.marked('onetothree', stamp(1001))).why, 'once');
  assert.equal((await P.ctl.marked('fourfive', stamp(1001))).why, 'once');
  assert.equal(fill(P, 'c-alarm'), 1); assert.equal(P.ops.length, 1);
  await P.ctl.marked('fourfive', stamp(2002));
  assert.equal(fill(P, 'c-alarm'), 2, 'the next stamp is its own');
});
test('Clean, a 6, a crit and a Before card never tick; nor does a roll with no stamp up', async () => {
  const P = page();
  for (const s of ['clean', 'six', 'critical', 'before', '']) assert.equal((await P.ctl.marked(s, stamp(3003))).why, 'result', s);
  assert.equal((await P.ctl.marked('onetothree', { on: true, active: null })).why, 'nostamp');
  assert.equal((await P.ctl.marked('onetothree', { on: true, active: { position: 'risky' } })).why, 'nostamp', 'a stamp view without its key (setting off in stamp.js) never ticks');
  assert.equal(P.ops.length, 0); assert.equal(fill(P, 'c-alarm'), 0);
});
test('the room’s span sets the clock and the count: a 4/5 ticks by 2', async () => {
  const P = page({ room: ROOM('the bell rings `▶ tick: House alarm / 2`') });
  assert.equal(P.ctl.rows()['45'].n, 2);
  await P.ctl.marked('fourfive', stamp(4004));
  assert.deepEqual(P.ops, [[{ id: 'c-alarm', filled: 2 }]]);
  assert.match(P.undos[0].text, /^On 4\/5: /);
});
test('a loose-only name never ticks: "No clock called" toast naming the near clock, and no write (RK04’s sure-match rule)', async () => {
  const P = page({ room: ROOM('the bell rings `▶ tick: House alarms / 1`') });
  const r = await P.ctl.marked('onetothree', stamp(5005));
  assert.equal(r.why, 'miss');
  assert.equal(P.ops.length, 0, 'nothing written'); assert.equal(fill(P, 'c-alarm'), 0);
  assert.equal(P.toasts.length, 1); assert.match(P.toasts[0].m, /^No clock called “House alarms” on the table: nothing ticked\. Did you mean “House alarm”\?$/); assert.equal(P.toasts[0].bad, true);
});
test('a name with no clock at all toasts "No clock called X", never silence; two clocks of that name toast too', async () => {
  const P = page({ alarm: 'Lighthouse' });
  await P.ctl.marked('onetothree', stamp(6006));
  assert.match(P.toasts[0].m, /^No clock called “Lighthouse”/); assert.equal(P.ops.length, 0);
  const Q = page({ alarm: 'Alarm', clocks: [{ id: 'a', name: 'Alarm', size: 4, filled: 0 }, { id: 'b', name: 'The alarm', size: 4, filled: 0 }] });
  await Q.ctl.marked('onetothree', stamp(6007));
  assert.match(Q.toasts[0].m, /^Two clocks are called “Alarm”/); assert.equal(Q.ops.length, 0);
});
test('the GM’s pick wins: No tick is silent; another clock and count tick that; the pick is spent once the roll is marked', async () => {
  const P = page();
  P.ctl.pick('13', '', 1);
  assert.equal((await P.ctl.marked('onetothree', stamp(7007))).why, 'none');
  assert.equal(P.toasts.length, 0); assert.equal(P.ops.length, 0);
  P.ctl.pick('45', 'c-marker', 2);
  await P.ctl.marked('fourfive', stamp(7008));
  assert.deepEqual(P.ops, [[{ id: 'c-marker', filled: 5 }]]);
  assert.equal(P.ctl.rows()['45'].id, 'c-alarm', 'the next roll starts from its own prefill');
});
test('Undo puts the clock back (absolute) and logs it; once the table has moved it, Undo leaves it', async () => {
  const P = page();
  await P.ctl.marked('onetothree', stamp(8008));
  const msg = await P.undos[0].undo();
  assert.match(msg, /^Undone: House alarm is back to 0 of 6\.$/);
  assert.deepEqual(P.ops[1], [{ id: 'c-alarm', filled: 0 }]); assert.equal(fill(P, 'c-alarm'), 0);
  assert.equal(P.logs[1], 'Tick undone: House alarm');
  await P.ctl.marked('onetothree', stamp(8009));
  P.clocks.find((k) => k.id === 'c-alarm').filled = 4;      /* someone ticked it on the table page */
  BC._reset();
  assert.match(await P.undos[1].undo(), /^Not undone/);
  assert.equal(fill(P, 'c-alarm'), 4);
});
test('a full clock is not ticked past its size, and says so', async () => {
  const P = page({ clocks: [{ ...ALARM(), filled: 6 }] });
  const r = await P.ctl.marked('onetothree', stamp(9009));
  assert.ok(!r.ok); assert.equal(P.ops.length, 0); assert.match(P.toasts[0].m, /already full/);
});

// ---------- stamp.js with night.flow: the key, and no span on the iPad ----------
function stampHost(flags, line) {
  const H = { shown: [], line };
  H.host = { feature: (id) => flags.includes(id), show: (p) => { H.shown.push(p); return Promise.resolve({ ok: true }); }, keyFor: (k) => k,
    currentPosition: () => 'risky', line: () => H.line, setLine: (t) => { H.line = t; }, now: () => 1234, log: () => {}, toast: () => {}, changed: () => {},
    setTimeout: () => 0, clearTimeout: () => {} };
  H.ctl = St.create(H.host);
  return H;
}
test('stamp.js, night.flow on: the iPad’s payload has no action span (the clock’s name never goes), and view().active carries the stamp’s key', async () => {
  const H = stampHost(['spine.stamp', 'night.flow'], 'The lights go out `▶ tick: House alarm / 1`');
  assert.equal(await H.ctl.fire(), true);
  assert.equal(H.shown[0].text, 'The lights go out');
  assert.doesNotMatch(JSON.stringify(H.shown), /House alarm|tick:|▶/);
  assert.equal(H.ctl.view().active.at, 1234);
  const B = stampHost(['spine.stamp', 'night.flow'], '`▶ tick: House alarm / 1`');
  await B.ctl.fire();
  assert.equal('text' in B.shown[0], false, 'a line that is only a span sends no text');
});
test('stamp.js, night.flow off: the payload and the view are as they were (the span goes as typed; no key)', async () => {
  const H = stampHost(['spine.stamp'], 'The lights go out `▶ tick: House alarm / 1`');
  await H.ctl.fire();
  assert.deepEqual(H.shown[0], St.payload({ position: 'risky', effect: 'standard', text: 'The lights go out `▶ tick: House alarm / 1`' }));
  assert.equal('at' in H.ctl.view().active, false);
});

for (const [name, fn] of queue) {
  try { await fn(); await tick(); passed++; console.log('PASS gm-night-ticks: ' + name); }
  catch (e) { failed++; console.log('FAIL gm-night-ticks: ' + name + ': ' + (e && e.stack || e)); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
