// gm-blade-chips (RK04, setting night.flow): Blade's cards act on what they suggest. No browser, no network, no key. Invented names only.
//   the ▶ tick: verb (parseTick, findTick, line: the contract RK03 calls), the bare command test (isBare), the clock match, ticking (an absolute fill, capped,
//   with Undo only while the clock is as it was left, an idempotent second tap), the bare typed lane ("tick the alarm 1", "make a 6 clock called ..."),
//   what the Blade panel is handed, the prep-action chips with the flow on and off (prep-actions.js), and the Ask cards' chips and typed lane (assist-panel.js).
//   node checks/runtime/gm-blade-chips.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl, MiniText } from './minidom.mjs';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { patchState } from '../../functions/_lib/gm.js';
import { SEATS } from '../../functions/_lib/assist/seats.js';
import { ASK_ACTIONS_NOTE } from '../../functions/_lib/assist/prompts.js';
import { makeHandler } from '../../functions/api/gm/assist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/blade-chips.js';
const C = require(path.join(ROOT, FILE));
const PA = require(path.join(ROOT, 'app', 'gm', 'prep-actions.js'));
const AP = require(path.join(ROOT, 'app', 'gm', 'assist-panel.js'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const tickle = () => new Promise((r) => setImmediate(r));

// the table: invented clocks; a host that behaves like the page's paHost (an absolute clockOps, a toast with Undo)
function table(clocks) {
  const t = { clocks: clocks.map((c) => ({ ...c })), ops: [], toasts: [], undo: null, cards: [], dropped: [], ticksFail: false };
  t.host = {
    clocks: () => t.clocks.map((c) => ({ ...c })),
    clockOps: async (ops) => {
      t.ops.push(JSON.parse(JSON.stringify(ops)));
      if (t.ticksFail) throw new Error('offline');
      for (const op of ops) {
        if (op.remove) t.clocks = t.clocks.filter((c) => c.id !== op.remove);
        else { const c = t.clocks.find((x) => x.id === op.id); if (c) Object.assign(c, op); }
      }
    },
    addClock: async (c) => { t.clocks.push({ ...c }); },
    canClock: () => true,
    toast: (msg, bad) => t.toasts.push({ msg, bad: !!bad }),
    undoToast: (text, undo) => { t.undo = { text, undo }; return true; },
    card: (spec) => { t.cards.push(spec); return spec.id; },
    dropCard: (id) => t.dropped.push(id),
    flow: () => true,
  };
  return t;
}
const ALARM = { id: 'c1', name: 'Alarm', size: 4, filled: 1, kind: 'danger', hidden: true };
const BOATS = { id: 'c2', name: 'Reach the boats', size: 6, filled: 0, kind: 'danger', hidden: true };
const DOVETAIL = { id: 'c3', name: 'Dovetail Crew heat', size: 8, filled: 7, kind: 'danger', hidden: false };
const fresh = () => { C._reset(); return table([ALARM, BOATS, DOVETAIL]); };

await test('the module loads under Node, and as a plain script it defines window.B68GmBladeChips (no longer a stub)', () => {
  assert.ok(C && typeof C === 'object');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const M = win.B68GmBladeChips;
  assert.ok(M && typeof M.parseTick === 'function' && typeof M.tick === 'function' && typeof M.typed === 'function' && typeof M.panel === 'function');
  assert.equal(M.stub, undefined, 'it is filled');
  assert.equal(JSON.stringify(M.parseTick('▶ tick: Alarm / 2')), JSON.stringify({ name: 'Alarm', n: 2 }), 'it parses in a bare context too');
});

// ---------- the verb (the contract RK03 calls) ----------
await test('parseTick: both lead-ins, the name, the count (default 1, 1 to 12), fields split at " / " only', () => {
  assert.deepEqual(C.parseTick('▶ tick: Alarm'), { name: 'Alarm', n: 1 });
  assert.deepEqual(C.parseTick('▶ tick: Alarm / 2'), { name: 'Alarm', n: 2 });
  assert.deepEqual(C.parseTick('>> Tick:  Reach the boats  /  3 '), { name: 'Reach the boats', n: 3 });
  assert.deepEqual(C.parseTick('▶️ tick: Floor 1/2 / 12'), { name: 'Floor 1/2', n: 12 }, 'a slash without spaces is part of the name; U+FE0F after the triangle');
  assert.ok(C.parseTick('▶ tick: Alarm / 0').bad, 'zero');
  assert.ok(C.parseTick('▶ tick: Alarm / 13').bad, 'over twelve');
  assert.ok(C.parseTick('▶ tick: Alarm / two').bad);
  assert.ok(C.parseTick('▶ tick: Alarm / 1 / 1').bad, 'a third field');
  assert.equal(C.parseTick('▶ tick:'), null, 'no argument: not a tick span');
  assert.equal(C.parseTick('▶ clock: Alarm / 4'), null, 'another verb');
  assert.equal(C.parseTick('tick: Alarm'), null, 'no lead-in');
  assert.equal(C.parseTick(''), null);
  assert.equal(C.parseTick(null), null);
});
await test('findTick: the first usable tick span in a Markdown line; line() writes one that parses back', () => {
  assert.deepEqual(C.findTick('The doorman throws you out `▶ tick: Alarm / 1` and `▶ tick: Reach the boats`.'), { name: 'Alarm', n: 1, text: '▶ tick: Alarm / 1' });
  assert.equal(C.findTick('Nothing here `▶ clock: Alarm / 4`'), null);
  assert.deepEqual(C.findTick('`▶ tick: X / 99` then `▶ tick: Y / 2`'), { name: 'Y', n: 2, text: '▶ tick: Y / 2' }, 'an unusable one is skipped');
  assert.equal(C.line('Alarm', 2), '▶ tick: Alarm / 2');
  assert.deepEqual(C.parseTick(C.line('Reach the boats', 3)), { name: 'Reach the boats', n: 3 });
  assert.equal(C.line('Alarm', 99), '▶ tick: Alarm / 12', 'capped');
});

// ---------- the bare command ----------
await test('isBare: "tick …" and "make a … clock …" are commands; questions, other talk and the old lanes are not', () => {
  for (const t of ['tick the alarm 1', 'Tick alarm', 'please tick the alarm twice', 'ticks the reach the boats clock', 'make a 6 clock called Escape', 'Make a six clock called Escape.',
    'add a clock called Guards', 'start a new 8 clock', 'create the escape clock', 'make a clock'])
    assert.equal(C.isBare(t), true, t);
  for (const t of ['', 'tick', 'tick?', 'how do I tick a clock?', 'what does the clock do', 'make a new NPC called Clockwork', 'make it darker', 'a clock ticks', 'Blade, tick the alarm', '/tick alarm', 'tock the alarm',
    'make a plan for the clock tower heist and then a long list of other words that is not a clock command at all', 'tick the alarm?'])
    assert.equal(C.isBare(t), false, t);
});

// ---------- the clock match ----------
await test('matchClock: exact name first, then the cue’s loose match; none and several say so', () => {
  const l = [ALARM, BOATS, { id: 'c4', name: 'Alarm bells', size: 6, filled: 0 }];
  assert.equal(C.matchClock('alarm', l).hit.id, 'c1', 'an exact name wins over a longer one');
  assert.equal(C.matchClock('The Reach the Boats', l).hit.id, 'c2', 'without the');
  assert.equal(C.matchClock('Reech the boats', l).hit.id, 'c2', 'within a letter');
  assert.ok(C.matchClock('Nothing', l).none);
  assert.ok(C.matchClock('', l).none);
  assert.equal(C.matchClock('guards', [{ id: 'a', name: 'Guards', size: 4, filled: 0 }, { id: 'b', name: 'guards!', size: 4, filled: 0 }]).many.length, 2);
});

// ---------- ticking ----------
await test('tick: one absolute clockOps { id, filled }, capped at the size, with a toast that has Undo', async () => {
  const t = fresh();
  const r = await C.tick(t.host, t.host.clocks()[0], 1);
  assert.deepEqual(r, { ok: true, from: 1, to: 2 });
  assert.deepEqual(t.ops, [[{ id: 'c1', filled: 2 }]], 'an absolute fill, never "plus one"');
  assert.match(t.undo.text, /Alarm ticks 1 to 2 of 4/);
  C._reset();
  await C.tick(t.host, t.host.clocks().find((c) => c.id === 'c3'), 5);
  assert.deepEqual(t.ops[1], [{ id: 'c3', filled: 8 }], '7 + 5 is capped at the size, 8');
});
await test('tick: a full clock changes nothing and says so; a failed write says so and is not remembered', async () => {
  const t = fresh();
  const full = { ...ALARM, filled: 4 };
  const r = await C.tick(t.host, full, 1);
  assert.equal(r.ok, false); assert.equal(t.ops.length, 0);
  assert.match(t.toasts[0].msg, /already full \(4\/4\)/);
  t.ticksFail = true;
  const r2 = await C.tick(t.host, t.host.clocks()[1], 1);
  assert.equal(r2.ok, false);
  assert.match(t.toasts[1].msg, /Could not tick the clock: offline/); assert.equal(t.toasts[1].bad, true);
  t.ticksFail = false;
  assert.equal((await C.tick(t.host, t.host.clocks()[1], 1)).ok, true, 'the next try is not blocked');
});
await test('tick: a second tap before the table has caught up builds on the first (the chip said so)', async () => {
  const t = fresh();
  const stale = t.host.clocks()[0];                    // the page's copy has not caught up: still 1
  const origClocks = t.host.clocks;
  t.host.clocks = () => origClocks().map((c) => (c.id === 'c1' ? { ...stale } : c));
  await C.tick(t.host, stale, 1);                      // 1 -> 2
  assert.equal(C.bumped({ ...stale }).filled, 2, 'the page reads what it has just left');
  await C.tick(t.host, stale, 1);                      // the same stale copy: 2 -> 3
  assert.deepEqual(t.ops.map((o) => o[0].filled), [2, 3]);
  const caught = { ...stale, filled: 5 };              // somebody else moved it: the bump is dropped, the table wins
  assert.equal(C.bumped(caught).filled, 5);
});
await test('tick: Undo sets it back only while the clock is as it was left', async () => {
  const t = fresh();
  await C.tick(t.host, t.host.clocks()[0], 2);        // 1 -> 3
  const msg = await t.undo.undo();
  assert.match(msg, /Undone: Alarm is back to 1 of 4/);
  assert.equal(t.clocks[0].filled, 1);
  C._reset();
  await C.tick(t.host, t.host.clocks()[0], 1);        // 1 -> 2
  t.clocks[0].filled = 3;                             // changed on the table since
  const m2 = await t.undo.undo();
  assert.match(m2, /Not undone: the clock has changed since/);
  assert.equal(t.clocks[0].filled, 3, 'left as it is');
  const t2 = fresh(); await C.tick(t2.host, t2.host.clocks()[0], 1); t2.clocks = [];
  assert.match(await t2.undo.undo(), /the clock is gone/);
});
await test('tick: with no clockOps the page says so; with no undoToast the text is a plain toast', async () => {
  const t = fresh();
  const h1 = { ...t.host, clockOps: undefined };
  assert.equal((await C.tick(h1, ALARM, 1)).ok, false);
  assert.match(t.toasts.pop().msg, /not available here/);
  C._reset();
  const h2 = { ...t.host, undoToast: undefined };
  assert.equal((await C.tick(h2, ALARM, 1)).ok, true);
  assert.match(t.toasts.pop().msg, /Alarm ticks 1 to 2 of 4/);
});

// ---------- the bare typed lane ----------
await test('typed: "tick the alarm 1" ticks the fixture’s Alarm clock, with Undo (the Done-when)', async () => {
  const t = fresh();
  const r = await C.typed('tick the alarm 1', t.host);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(t.ops, [[{ id: 'c1', filled: 2 }]]);
  assert.ok(t.undo && typeof t.undo.undo === 'function', 'Undo is offered');
  await t.undo.undo(); assert.equal(t.clocks[0].filled, 1);
});
await test('typed: amounts and names as a cue hears them', async () => {
  let t = fresh(); await C.typed('Tick the Reach the Boats twice', t.host); assert.deepEqual(t.ops, [[{ id: 'c2', filled: 2 }]]);
  t = fresh(); await C.typed('please tick alarm by two.', t.host); assert.deepEqual(t.ops, [[{ id: 'c1', filled: 3 }]]);
  t = fresh(); await C.typed('tick the dovetail crew heat', t.host); assert.deepEqual(t.ops, [[{ id: 'c3', filled: 8 }]]);
  t = fresh(); assert.equal((await C.typed('tick the dovetail crew heat 3', t.host)).ok, true); assert.deepEqual(t.ops, [[{ id: 'c3', filled: 8 }]], 'capped at 8');
});
await test('typed: a name that matches nothing says so and the words stay (ok false); nothing is written', async () => {
  const t = fresh();
  const r = await C.typed('tick the lighthouse once', t.host);
  assert.deepEqual(r, { ok: false });
  assert.equal(t.ops.length, 0);
  assert.match(t.toasts[0].msg, /No clock called/);
});
await test('typed: two clocks that match ask which (a card with the answers as buttons); a tap ticks that one and takes the card down', async () => {
  const t = table([{ id: 'a', name: 'Guards', size: 4, filled: 0 }, { id: 'b', name: 'Guards!', size: 4, filled: 1 }]); C._reset();
  const r = await C.typed('tick guards', t.host);
  assert.deepEqual(r, { ok: true });
  assert.equal(t.cards.length, 1); assert.equal(t.ops.length, 0, 'nothing ticked yet');
  const card = t.cards[0];
  assert.match(card.headline, /Which clock/);
  assert.deepEqual(card.actions.map((a) => a.label), ['Guards', 'Guards!']);
  await card.actions[1].run();
  assert.deepEqual(t.ops, [[{ id: 'b', filled: 2 }]]);
  assert.deepEqual(t.dropped, [card.id]);
});
await test('typed: "make a 6 clock called Reach the roof" adds a hidden clock, with Undo; a size the page does not allow is refused; a name already there is not added again', async () => {
  let t = fresh();
  assert.deepEqual(await C.typed('make a 6 clock called Reach the roof', t.host), { ok: true });
  const made = t.clocks.find((c) => c.name === 'Reach the roof');
  assert.ok(made && made.size === 6 && made.filled === 0 && made.hidden === true && made.kind === 'danger', JSON.stringify(made));
  assert.match(t.undo.text, /Clock added, hidden from the players: Reach the roof 0\/6/);
  assert.match(await t.undo.undo(), /Undone: the clock is off the table/);
  assert.ok(!t.clocks.find((c) => c.name === 'Reach the roof'));
  t = fresh();
  assert.deepEqual(await C.typed('make a 10 clock called Too big', t.host), { ok: false }, 'cue.js knows 10; the page does not (4, 6, 8, 12)');
  assert.ok(!t.clocks.find((c) => c.name === 'Too big'));
  assert.match(t.toasts[0].msg, /4, 6, 8 or 12/);
  t = fresh();
  assert.deepEqual(await C.typed('make a 4 clock called alarm', t.host), { ok: false });
  assert.equal(t.clocks.length, 3, 'no second Alarm'); assert.match(t.toasts[0].msg, /on the table already/);
  t = fresh();
  assert.deepEqual(await C.typed('make a 12 clock called Long way down and mark 2', t.host), { ok: true });
  assert.equal(t.clocks.find((c) => c.name === 'Long way down').filled, 2);
});
await test('typed: a clock with no size asks how big (4, 6, 8, 12); the name is kept', async () => {
  const t = fresh();
  assert.deepEqual(await C.typed('make a clock called Reach the roof', t.host), { ok: true });
  const card = t.cards[0];
  assert.match(card.headline, /How big is .Reach the roof/);
  assert.deepEqual(card.actions.map((a) => a.label), ['4', '6', '8', '12']);
  await card.actions[2].run();
  assert.equal(t.clocks.find((c) => c.name === 'Reach the roof').size, 8);
});
await test('typed: no table to write to is said, not thrown; a sheet word outside a clock name is refused by the cue', async () => {
  const t = fresh();
  const h = { ...t.host, canClock: () => false };
  assert.deepEqual(await C.typed('make a 6 clock called Reach the roof', h), { ok: false });
  assert.match(t.toasts.pop().msg, /not available here/);
  assert.deepEqual(await C.typed('tick the stress test', t.host), { ok: false });
  assert.equal(t.ops.length, 0);
});

// ---------- what the panel is handed ----------
await test('panel: is / run / chip / decorate go where they should, and the same host gets the same object', async () => {
  const t = fresh(), seen = [];
  const A = { decorate: (el, h) => seen.push(['d', el, h === t.host]), refresh: (el, h) => seen.push(['r', el, h === t.host]), tap: (b, h) => seen.push(['t', b, h === t.host]) };
  const p = C.panel(t.host, A);
  assert.equal(C.panel(t.host, A), p, 'cached per host');
  assert.equal(p.is('tick alarm'), true); assert.equal(p.is('what is the rule'), false);
  p.decorate('E1'); p.refresh('E2'); p.chip('B');
  assert.deepEqual(seen, [['d', 'E1', true], ['r', 'E2', true], ['t', 'B', true]]);
  assert.deepEqual(await p.run('tick alarm'), { ok: true });
  p.refresh(null); assert.equal(seen.length, 3, 'no element, no refresh');
});

// ---------- prep-actions: the verb and Tick +1, only while the flow is on ----------
await test('prep-actions: ▶ tick: is a tick chip with the flow on, and an unknown verb with it off (as today)', () => {
  PA.setFlow(false);
  assert.equal(PA.parse('▶ tick: Alarm / 1').kind, 'unknown', 'off: today');
  assert.equal(PA.setFlow(true), true);
  const p = PA.parse('▶ tick: Alarm / 2');
  assert.equal(p.kind, 'tick'); assert.deepEqual(p.tick, { name: 'Alarm', n: 2 });
  assert.ok(PA.parse('▶ tick: Alarm / 99').tick.bad);
  assert.equal(PA.parse('▶ tick:').kind, 'unknown', 'no argument');
  PA.setFlow(false);
  assert.equal(PA.parse('▶ tick: Alarm / 1').kind, 'unknown');
});

// a chip drawn the way the page draws one: a button with data-pa, painted and tapped through the module (the mini DOM cannot run :not(), so it starts with its class)
function miniDoc() {
  const doc = { chips: [], createElement: (tag) => { const e = new MiniEl(tag); e.ownerDocument = doc; return e; }, createTextNode: (s) => new MiniText(s), querySelectorAll: () => doc.chips };
  return doc;
}
function chipOn(text, doc) {
  const btn = doc.createElement('button'); btn.className = 'pa-chip'; btn.setAttribute('data-pa', text); btn.setAttribute('data-gm', 'pa');
  const box = doc.createElement('div'); box.appendChild(btn); doc.chips.push(btn);
  return { btn, box };
}
await test('prep-actions: the tick chip says which clock it found and what a tap does; a tap ticks once with Undo; the chip then reads the new count', async () => {
  const t = fresh(); const doc = miniDoc();
  const { btn, box } = chipOn('▶ tick: alarm / 2', doc);
  PA.refresh(box, t.host);
  assert.equal(btn.className, 'pa-chip pa-tick');
  assert.match(btn.textContent, /Tick: Alarm 1 to 3 of 4/);
  assert.match(btn.title, /Undo is offered/);
  PA.tap(btn, t.host); await tickle(); await tickle();
  assert.deepEqual(t.ops, [[{ id: 'c1', filled: 3 }]]);
  assert.match(btn.textContent, /Tick: Alarm 3 to 4 of 4/, 'it reads what the page left');
  assert.ok(t.undo && /Alarm ticks 1 to 3 of 4/.test(t.undo.text), 'with Undo');
  PA.setFlow(false);
});
await test('prep-actions: no clock of that name, several, or a bad count: a muted chip that says why; a tap only toasts', async () => {
  const t = fresh(); const doc = miniDoc();
  t.clocks.push({ id: 'g1', name: 'Guards', size: 4, filled: 0 }, { id: 'g2', name: 'Guards!', size: 4, filled: 0 });
  for (const [txt, why] of [['▶ tick: Lighthouse', /No clock called/], ['▶ tick: guards', /More than one clock matches/], ['▶ tick: Alarm / 40', /from 1 to 12/]]) {
    const { btn, box } = chipOn(txt, doc);
    PA.refresh(box, t.host);
    assert.match(btn.className, /pa-muted/, txt); assert.match(btn.title, why, txt);
    t.toasts.length = 0; PA.tap(btn, t.host);
    assert.equal(t.ops.length, 0, 'nothing written'); assert.equal(t.toasts.length, 1);
  }
  PA.setFlow(false);
});
await test('prep-actions: ▶ clock: on a clock that is there reads "Tick +1" and a tap ticks it once; full reads full; with the flow off it is as it was', async () => {
  const t = fresh(); const doc = miniDoc();
  const { btn, box } = chipOn('▶ clock: Alarm / 4 / 0', doc);
  PA.refresh(box, t.host);
  assert.match(btn.textContent, /Clock: Alarm 1\/4 · Tick \+1/); assert.match(btn.title, /Tap to tick it once/);
  PA.tap(btn, t.host); await tickle(); await tickle();
  assert.deepEqual(t.ops, [[{ id: 'c1', filled: 2 }]]);
  const t2 = fresh(); const d2 = miniDoc();
  t2.clocks.find((c) => c.id === 'c3').filled = 8;
  const b2 = chipOn('▶ clock: Dovetail Crew heat / 8 / 0', d2);
  PA.refresh(b2.box, t2.host);
  assert.match(b2.btn.textContent, /8\/8 full/);
  // flow off: the host says so, and the chip is today's
  const t3 = fresh(); const d3 = miniDoc();
  const off = { ...t3.host, flow: () => false };
  const b3 = chipOn('▶ clock: Alarm / 4 / 0', d3);
  PA.refresh(b3.box, off);
  assert.match(b3.btn.textContent, /^.Clock: Alarm 1\/4$/); assert.equal(b3.btn.title, 'On the table already, hidden from the players');
  t3.toasts.length = 0; PA.tap(b3.btn, off); await tickle();
  assert.equal(t3.ops.length, 0, 'off: a tap only says where it stands'); assert.match(t3.toasts[0].msg, /Nothing added/);
  assert.equal(PA.setFlow(false), false);
});
await test('prep-actions: a host with no flow(), or a flow that throws, is the flow off', () => {
  const t = fresh(); const doc = miniDoc();
  const h = { ...t.host }; delete h.flow;
  const a = chipOn('▶ tick: Alarm', doc); PA.refresh(a.box, h);
  assert.match(a.btn.className, /pa-unknown/);
  const h2 = { ...t.host, flow: () => { throw new Error('x'); } };
  const b = chipOn('▶ tick: Alarm', doc); PA.refresh(b.box, h2);
  assert.match(b.btn.className, /pa-unknown/);
});

// ---------- the Ask cards (assist-panel.js) ----------
await test('assist-panel: a code span that is an action stays code in a bullet while the flow is on; every other code span, and every bullet with the flow off, is as before', () => {
  const doc = miniDoc();
  const P = AP._pure;
  const on = P.inlineNodes(doc, 'Do `▶ clock: Reach the boats / 4 / 0` then **go** `plain`', true);
  const kinds = on.map((n) => (n.nodeType === 3 ? 't:' + n.data : n.tagName.toLowerCase() + ':' + (n.textContent || '')));
  assert.equal(kinds[1], 'code:▶ clock: Reach the boats / 4 / 0');
  assert.ok(kinds.some((k) => k === 'strong:go'), 'bold is still bold');
  assert.ok(kinds.some((k) => /^t:.*`plain`/.test(k)), 'a code span that is not an action is left as typed');
  const off = P.inlineNodes(doc, 'Do `▶ clock: Reach the boats / 4 / 0`', false);
  assert.equal(off.length, 1); assert.equal(off[0].data, 'Do `▶ clock: Reach the boats / 4 / 0`', 'off: literal text, as today');
  assert.deepEqual(P.inlineNodes(doc, 'Do `▶ clock: X`').map((n) => n.data), ['Do `▶ clock: X`'], 'no flag at all: the same');
  const two = P.inlineNodes(doc, '`▶ tick: A / 1` and `>> tick: B`', true).filter((n) => n.nodeType === 1);
  assert.equal(two.length, 2);
  assert.equal(P.inlineNodes(doc, 'no action `x` here', true).length, 1, 'no action span: the old path');
});
await test('assist-panel: the source holds every RK04 branch behind o.flow (off means today)', () => {
  const s = fs.readFileSync(path.join(ROOT, 'app/gm/assist-panel.js'), 'utf8');
  assert.ok(/function fl\(\) \{ try \{ return typeof o\.flow === 'function' \? o\.flow\(\) \|\| null : null;/.test(s), 'fl() is null without o.flow');
  assert.ok(s.includes('function isTyped(t) { return /^\\s*(?:blade\\s*,|\\/)/i.test(str(t)) || isBare(t); }'), 'the old test first, then the bare one');
  assert.ok(/function isBare\(t\) \{ var f = fl\(\); return !!\(f && /.test(s), 'bare needs the flow');
  assert.ok(/return deco\(root\);/.test(s) && /deco\(kc\)/.test(s), 'both desks’ cards are decorated');
});
await test('gm-page.js: the page hands the panel a flow only while night.flow is on and the module is here; paHost carries flow, card and dropCard', () => {
  const s = fs.readFileSync(path.join(ROOT, 'app/gm-page.js'), 'utf8');
  assert.ok(s.includes("function flowOn() { return !!(S && W.B68GmBladeChips && W.B68GmPrepActions && W.B68Features && W.B68Features.valueOf(S.doc, 'night.flow')); }"));
  assert.ok(s.includes('flow: function () { return S === me && flowOn() ? W.B68GmBladeChips.panel(paHost(), W.B68GmPrepActions) : null; }'));
  assert.ok(s.includes('flow: function () { return S === me && flowOn(); }') && s.includes('dropCard: function (id)'));
});

// ---------- RK04.4: the Ask seat's prompt, only while the stored setting is on (the handler's injected fake client: no key, no network) ----------
async function askWith(features) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_test000001' })).run();
  if (features !== undefined) await patchState(db, 'c', { features });
  const calls = [];
  const client = { messages: { async create(req) {
    calls.push(req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text));
    return { content: [{ type: 'text', text: JSON.stringify({ kind: 'other', headline: 'Done', bullets: [], say: '', secret: '', more: '' }) }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
  } } };
  const handler = makeHandler({ clientFor: () => client, now: () => Date.parse('2030-06-01T09:00:00.000Z') });
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000' };
  const res = await handler({ request: new Request('https://blades.example.test/api/gm/assist/ask', { method: 'POST', body: JSON.stringify({ q: 'tick the alarm twice' }), headers: { 'Content-Type': 'application/json' } }), env, data: { me: { role: 'gm', id: 'gm@example.test' } } });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, 'one fake call');
  return calls[0].join('\n---\n');
}
await test('RK04.4: the seat is told to answer a clock command with ▶ lines only while night.flow is stored on', async () => {
  const on = await askWith({ 'night.flow': true });
  assert.ok(on.includes(SEATS.ask.instructions), 'the seat’s own instructions are all still there');
  assert.ok(on.includes(ASK_ACTIONS_NOTE), 'the note follows them');
  assert.ok(on.indexOf(ASK_ACTIONS_NOTE) > on.indexOf(SEATS.ask.instructions));
  for (const w of ['`▶ tick: <clock name> / <n>`', '`▶ clock: <name> / <size> / <ticks so far>`', '4, 6, 8 or 12']) assert.ok(on.includes(w), w);
  for (const state of [{ 'night.flow': false }, {}, undefined, { 'stamp.brief': true }]) {
    const off = await askWith(state);
    assert.ok(!off.includes('▶'), 'off (' + JSON.stringify(state) + '): the seat is asked as it always was');
    assert.ok(off.includes(SEATS.ask.instructions));
  }
});
await test('RK04.4: the note is public code with no campaign word, and the seat’s own instructions are unchanged by it', () => {
  assert.ok(!SEATS.ask.instructions.includes('▶'), 'the seat itself says nothing about the chips: the note is added at the call');
  assert.ok(ASK_ACTIONS_NOTE.length < 1200, 'short: ' + ASK_ACTIONS_NOTE.length);
  for (const w of ['Pelican', 'Nell', 'Arbuthnot', 'Dovetail', 'Quist', 'Kessler', 'GM-ONLY']) assert.ok(!ASK_ACTIONS_NOTE.includes(w), w);
  assert.ok(/nothing happens until it is tapped/.test(ASK_ACTIONS_NOTE));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
