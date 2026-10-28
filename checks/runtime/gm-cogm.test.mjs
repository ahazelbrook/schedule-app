// Unit test for the co-GM's page side (app/gm/cogm.js, ticket C2; no browser, no network): the pre-filter patterns (a hand-made set, then a few hundred noisy phrasings per
// intent made with the local model and reviewed by hand: fixtures/gm/cogm-phrasings.json), the window builder and its two cursors, the keys, the state sent to the Worker, the
// apply planner (the write, the offer or the drop, against the LIVE table) and the compare-and-swap undo planner. Every name and sentence is invented.
//   node checks/runtime/gm-cogm.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, 'app', 'gm', 'cogm.js'));

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* ---------- 1. the pre-filter ---------- */
await test('planApply: an action the server marked seen (another page or an earlier window has its key) is dropped, never written', () => {
  const p = C.planApply({ type: 'clock_add', mode: 'seen', key: 'k1', name: 'Harbour Bell', size: 6, quote: 'x' }, { clocks: [], npcs: [], pcs: [] }, { id: 'c_new' }, { confirmed: true });
  assert.deepEqual(p, { op: 'drop', why: 'seen' });
});

await test('1. match: the five intents, in the words of design 5.2', () => {
  const m = (s) => C.match(s).join();
  assert.equal(m("right, that's going to be a six-segment clock"), 'clock');
  assert.equal(m('make it a four part thing'), 'clock');
  assert.equal(m('eight segments'), 'clock');
  assert.equal(m('there is a clock on the wall'), 'clock', 'the word clock matches: the seat decides, a miss costs more than a call');
  assert.equal(m('tick that'), 'tick');
  assert.equal(m('tick it once'), 'tick');
  assert.equal(m('tick the guards'), 'tick');
  assert.equal(m('mark one'), 'tick');
  assert.equal(m('fill one'), 'tick');
  assert.equal(m("his name's Wren Alder"), 'name');
  assert.equal(m("she's called Odette"), 'name');
  assert.equal(m('a woman called Odette at the door'), 'name');
  assert.equal(m('level two harm'), 'pool');
  assert.equal(m('take two stress'), 'pool');
  assert.equal(m("take a devil's bargain"), 'bargain');
  assert.equal(m('flashback to the morning'), 'bargain');
  assert.equal(m('flash back to the morning'), 'bargain');
});
await test('1. match: speech-to-text errors, case, and two intents in one line', () => {
  assert.ok(C.match('TIC that').includes('tick'), 'tic that');
  assert.ok(C.match('sick segment clock').includes('clock'), 'sick for six');
  assert.ok(C.match('a for part clock').includes('clock'), 'for for four');
  assert.ok(C.match('Level Won Harm').includes('pool'), 'won for one');
  assert.ok(C.match('devils bargain?').includes('bargain'), 'no apostrophe');
  assert.deepEqual(C.match("tick that, and his name's Orrin"), ['tick', 'name']);
  assert.ok(C.match("he's called Orrin").includes('name'));
  assert.deepEqual(C.match('he is called'), ['name'], 'called with nothing after still matches the he-is-called pattern');
});
await test('1. match: chatter does not match', () => {
  for (const s of ['', '   ', 'pass me the dice', 'we go through the back door', 'what can i see from here', 'the room is dark and smells of oil', 'um, uh, so who is rolling',
    'the lamp flickers', 'i would like another biscuit', 'are we on the roof now', 'she nods slowly', 'a quiet street', 'ok let me think']) assert.deepEqual(C.match(s), [], JSON.stringify(s));
  assert.deepEqual(C.match(null), []); assert.deepEqual(C.match(undefined), []); assert.deepEqual(C.match(42), []);
});
await test('1. match: a name after "called" matches with a capital AND in an all-lowercase transcript', () => {
  assert.ok(C.match('a man called Hobrik waits').includes('name'), 'capitalised');
  assert.ok(C.match('a man called hobrik waits').includes('name'), 'lowercase');
  assert.ok(C.match('A MAN CALLED HOBRIK WAITS').includes('name'), 'upper case');
  assert.ok(C.match('a woman named orrin by the door').includes('name'), 'named, lowercase');
  assert.ok(C.match('a woman named Orrin by the door').includes('name'), 'named, capitalised');
  assert.ok(C.match('the porter goes by pell').includes('name'), 'goes by, lowercase');
  assert.ok(C.match("and the name's wynne").includes('name'), "name's, lowercase");
  assert.ok(C.match('what is it called again').includes('name'), 'permissive by design: any word after "called" passes, the seat decides');
  assert.deepEqual(C.match('it was called'), [], 'called at the end of the line has no name after it');
});

/* the model-made fixtures: every line was read by hand; the floors are what the patterns do on them, minus a margin */
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'cogm-phrasings.json'), 'utf8'));
const FLOOR = { clock: 0.9, tick: 0.9, name: 0.9, pool: 0.9, bargain: 0.9 };
for (const intent of Object.keys(FLOOR)) {
  await test('1. fixtures: ' + intent + ' (' + FIX[intent].length + ' phrasings): the pre-filter finds the intent in at least ' + Math.round(FLOOR[intent] * 100) + '%', () => {
    const lines = FIX[intent], hit = lines.filter((l) => C.match(l).includes(intent));
    const rate = hit.length / lines.length;
    assert.ok(lines.length >= 90, 'at least 90 reviewed phrasings per intent, found ' + lines.length);
    assert.ok(rate >= FLOOR[intent], intent + ' recall ' + rate.toFixed(3) + ' misses: ' + JSON.stringify(lines.filter((l) => !C.match(l).includes(intent)).slice(0, 8)));
  });
}
await test('1. fixtures: chatter (' + FIX.chatter.length + ' lines) is passed on at most 2% of the time', () => {
  const hit = FIX.chatter.filter((l) => C.match(l).length);
  assert.ok(FIX.chatter.length >= 90);
  assert.ok(hit.length / FIX.chatter.length <= 0.02, 'false positives ' + hit.length + ': ' + JSON.stringify(hit.slice(0, 8)));
});
await test('1. fixtures: invented names only (every capitalised word is from the allowed list, a sentence start or I)', () => {
  const ok = new Set(FIX.meta.allowedNames.map((s) => s.toLowerCase()));
  for (const intent of Object.keys(FIX)) {
    if (intent === 'meta') continue;
    for (const l of FIX[intent]) {
      const words = l.split(/\s+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, '')).filter(Boolean);
      words.forEach((w, i) => { if (!/^[A-Z]/.test(w) || w === 'I' || /^I'/.test(w) || /^(Devil's|Devils)$/.test(w)) return; if (!ok.has(w.toLowerCase()) && i > 0 && !/[.?!]$/.test(words[i - 1])) assert.fail('an unlisted capitalised word ' + JSON.stringify(w) + ' in ' + JSON.stringify(l)); });
    }
  }
});

/* ---------- 2. the window builder and the two cursors ---------- */
const T0 = Date.parse('2030-06-01T09:00:00.000Z');
const row = (seq, text, sec = seq * 4, kind = 'line') => ({ seq, kind, text, at: new Date(T0 + sec * 1000).toISOString(), speaker: 0, session: '1' });
const quiet = (seq, sec) => row(seq, 'we look around the room', sec);

await test('2. start: begins at the newest seq; nothing before it is ever matched', () => {
  const st = C.newState(); C.start(st, 40);
  C.ingest(st, [row(38, 'tick that'), row(41, 'quiet line'), row(42, 'another')], 42, T0);
  assert.equal(st.pending.length, 0, 'seq 38 is below the start');
  assert.equal(st.readAfter, 42);
  assert.deepEqual(st.buf.map((l) => l.seq), [41, 42]);
});
await test('2. ingest: marks are not talk; a line is noted once; the read cursor follows the highest seq, and `last` only when the read came back empty', () => {
  const st = C.newState(); C.start(st, 0);
  C.ingest(st, [row(1, 'tick that', 4), { seq: 2, kind: 'mark', text: 'tick the world', at: row(2, '').at }, row(3, 'tick it', 12)], 900, T0);
  assert.deepEqual(st.pending.map((p) => p.seq), [1, 3], 'a mark is skipped');
  assert.equal(st.readAfter, 3, 'rows came back: the cursor is the last row, not `last` (a full page must be read on)');
  C.ingest(st, [row(3, 'tick it', 12)], 900, T0);
  assert.equal(st.pending.length, 2, 'the same line twice is one match');
  C.ingest(st, [], 900, T0);
  assert.equal(st.readAfter, 900, 'an empty read takes `last`');
});
await test('2. window: the matching line plus two either side', () => {
  const st = C.newState(); C.start(st, 0);
  const rows = [];
  for (let i = 1; i <= 12; i++) rows.push(i === 6 ? row(i, 'tick that', i * 20) : quiet(i, i * 20));      // 20 s apart: the 30 s widening takes nothing more
  C.ingest(st, rows, 12, T0);
  const w = C.nextWindow(st, T0 + 1000);
  assert.deepEqual([w.from, w.to, w.seqs], [4, 8, [6]]);
});
await test('2. window: widened to about 30 s of talk, and no more than 30 lines', () => {
  const st = C.newState(); C.start(st, 0);
  const rows = [];
  for (let i = 1; i <= 90; i++) rows.push(i === 45 ? row(i, 'tick that', i) : quiet(i, i));      // a line a second
  C.ingest(st, rows, 90, T0);
  const w = C.nextWindow(st, T0);
  assert.ok(w.to - w.from + 1 <= 30 && w.to - w.from + 1 >= 25, 'about 30 lines: ' + (w.to - w.from + 1));
  assert.ok(w.from <= 45 - 2 && w.to >= 45 + 2 && w.from > 20 && w.to < 70);
  assert.ok(w.to - w.from <= 200);
});
await test('2. window: seqs shared with marks stay within the Worker\'s 200', () => {
  const st = C.newState(); C.start(st, 0);
  const rows = [row(1, 'x', 0), row(2, 'y', 2), row(3, 'tick that', 4), row(900, 'z', 6), row(901, 'w', 8)];
  C.ingest(st, rows, 901, T0);
  const w = C.nextWindow(st, T0);
  assert.ok(w.to - w.from <= 200, 'from ' + w.from + ' to ' + w.to);
  assert.ok(w.from <= 3 && w.to >= 3);
});
await test('2. settle: a match at the tail waits for its two lines after it, or TIMING.settle, then goes anyway', () => {
  const st = C.newState(); C.start(st, 0);
  C.ingest(st, [quiet(1, 0), quiet(2, 4), row(3, 'tick that', 8)], 3, T0);
  assert.equal(C.nextWindow(st, T0 + 1000), null, 'no lines after it yet');
  C.ingest(st, [quiet(4, 12)], 4, T0 + 5000);
  assert.equal(C.nextWindow(st, T0 + 5000), null, 'one line after it');
  const w = C.nextWindow(st, T0 + C.TIMING.settle + 10);
  assert.deepEqual([w.from, w.to], [1, 4], 'settled by time');
  C.ingest(st, [quiet(5, 16)], 5, T0 + 5500);
  assert.deepEqual([C.nextWindow(st, T0 + 5600).from, C.nextWindow(st, T0 + 5600).to], [1, 5], 'two lines after it: ready now');
});
await test('2. cursors: the handled cursor moves only when the Worker answered; a 429 leaves the window to go again after the gap', () => {
  const st = C.newState(); C.start(st, 0);
  C.ingest(st, [quiet(1, 0), row(2, 'tick that', 4), quiet(3, 8), quiet(4, 12)], 4, T0);
  const w = C.nextWindow(st, T0);
  assert.equal(C.windowFailed(st, w, T0, true), 'retry');
  assert.equal(st.handled, 0, 'a 429 does not advance the cursor');
  assert.equal(st.pending.length, 1, 'the match is still pending');
  assert.equal(C.nextWindow(st, T0 + 1000), null, 'not before the gap');
  const w2 = C.nextWindow(st, T0 + C.TIMING.gap + 1);
  assert.deepEqual([w2.from, w2.to], [w.from, w.to], 'the same window goes again');
  C.windowSent(st, w2, T0 + C.TIMING.gap + 1);
  assert.equal(st.handled, w.to); assert.equal(st.pending.length, 0);
  assert.equal(C.nextWindow(st, T0 + C.TIMING.gap + 2), null, 'and the gap starts again');
});
await test('2. cursors: repeated 429s never drop a window; other failures are given up on after TIMING.giveUpAfter tries', () => {
  const st = C.newState(); C.start(st, 0);
  C.ingest(st, [quiet(1, 0), row(2, 'tick that', 4), quiet(3, 8), quiet(4, 12)], 4, T0);
  const w = C.nextWindow(st, T0);
  for (let i = 0; i < 20; i++) assert.equal(C.windowFailed(st, w, T0, true), 'retry');
  assert.equal(st.pending.length, 1);
  assert.equal(C.windowFailed(st, w, T0, false), 'retry');
  assert.equal(C.windowFailed(st, w, T0, false), 'retry');
  assert.equal(C.windowFailed(st, w, T0, false), 'dropped');
  assert.equal(st.handled, w.to); assert.equal(st.pending.length, 0, 'one bad window cannot hold the line for the night');
});
await test('2. a later match is not lost behind an earlier window; matches inside a sent window are covered', () => {
  const st = C.newState(); C.start(st, 0);
  const rows = [];
  for (let i = 1; i <= 40; i++) rows.push(i === 4 || i === 5 ? row(i, 'tick that', i * 30) : i === 30 ? row(i, "his name's Orrin", i * 30) : quiet(i, i * 30));
  C.ingest(st, rows, 40, T0);
  const w = C.nextWindow(st, T0);
  assert.deepEqual(w.seqs, [4, 5], 'one window for both neighbours');
  C.windowSent(st, w, T0);
  assert.deepEqual(st.pending.map((p) => p.seq), [30]);
  const w2 = C.nextWindow(st, T0 + C.TIMING.gap + 1);
  assert.deepEqual(w2.seqs, [30]);
});
await test('2. the buffer is bounded, and a match that has left it is forgotten', () => {
  const st = C.newState(); C.start(st, 0);
  const rows = [row(1, 'tick that', 0)]; for (let i = 2; i <= 300; i++) rows.push(quiet(i, i));
  C.ingest(st, rows, 300, T0);
  assert.ok(st.buf.length <= 80); assert.equal(st.pending.length, 0);
});

/* ---------- 3. keys ---------- */
await test('3. keys: seen is exact, offers count, and a key is only ever what the Worker gave', () => {
  const st = C.newState();
  assert.equal(C.seen(st, 'clock_add:drains-below:0a1b2c3d'), false);
  C.mark(st, 'clock_add:drains-below:0a1b2c3d', 'applied');
  assert.equal(C.seen(st, 'clock_add:drains-below:0a1b2c3d'), true);
  assert.equal(C.seen(st, 'clock_add:drains-below:0a1b2c3e'), false);
  C.mark(st, 'npc_add:wren:aaaaaaaa', 'offered');
  assert.equal(C.seen(st, 'npc_add:wren:aaaaaaaa'), true, 'a dismissed offer does not come back');
  assert.equal(C.seen(st, undefined), false); assert.equal(C.seen(st, ''), false); assert.equal(C.seen(st, '__proto__'), false); assert.equal(C.seen(st, 'toString'), false);
  C.mark(st, '', 'applied'); C.mark(st, 7, 'applied'); assert.deepEqual(Object.keys(st.keys), ['clock_add:drains-below:0a1b2c3d', 'npc_add:wren:aaaaaaaa']);
  assert.ok(!/actionKey|hash/.test(fs.readFileSync(path.join(ROOT, 'app', 'gm', 'cogm.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), 'cogm.js never works out a key (the comments say so; the code does not)');
});

/* ---------- 4. the state sent to the Worker ---------- */
await test('4. buildState: the shape the Worker takes, with bad items dropped instead of making the call a 400', () => {
  const s = C.buildState({
    clocks: [{ id: 'k1', name: ' Lamp Oil ', size: 6, filled: 9, hidden: 1 }, { id: '', name: 'No id', size: 4, filled: 0 }, { id: 'k3', name: '   ', size: 4, filled: 0 }, { id: 'k4', name: 'Odd', size: 99, filled: 2.7 }, { id: 'k5', name: 'Zero', size: 0, filled: -3 }, null, 'x'],
    npcs: [{ id: 'n1', name: 'Mirelle Tanager', tags: [] }, { id: 'n2', name: 'Gone One', tags: ['cogm', 'undone'] }, { id: 'n3', name: '' }],
    pcs: [{ id: 'p1', name: 'Odo Vance' }], }, 'Mirelle Tanager');
  assert.deepEqual(s.clocks.map((c) => c.id), ['k1', 'k4', 'k5']);
  assert.deepEqual(s.clocks[0], { id: 'k1', name: 'Lamp Oil', size: 6, filled: 6, hidden: false }, 'filled clamped to size; hidden is a true boolean only');
  assert.deepEqual(s.clocks[1], { id: 'k4', name: 'Odd', size: 12, filled: 2, hidden: false }, 'size clamped to 12, filled whole');
  assert.deepEqual(s.clocks[2], { id: 'k5', name: 'Zero', size: 4, filled: 0, hidden: false });
  assert.deepEqual(s.npcs.map((n) => n.name), ['Mirelle Tanager'], 'an NPC the GM undid is not known, so its name can be added again');
  assert.equal(s.onStage, 'Mirelle Tanager');
  assert.deepEqual(C.buildState(null, null), { clocks: [], npcs: [], pcs: [], onStage: '' });
});
await test('4. buildState: counts and bytes are capped (40 clocks, 100 NPCs, 12 PCs, 8 KB), names at 80', () => {
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const s = C.buildState({ clocks: many(60, (i) => ({ id: 'k' + i, name: 'Clock ' + i, size: 6, filled: 1 })), npcs: many(150, (i) => ({ id: 'n' + i, name: 'Npc ' + i })), pcs: many(20, (i) => ({ id: 'p' + i, name: 'Pc ' + i })) }, 'x'.repeat(200));
  assert.ok(s.clocks.length <= 40 && s.npcs.length <= 100 && s.pcs.length === 12 && s.onStage.length === 80);
  const big = C.buildState({ clocks: many(40, (i) => ({ id: 'k' + i, name: 'N'.repeat(80), size: 6, filled: 1 })), npcs: many(100, (i) => ({ id: 'n' + i, name: 'M'.repeat(80) })), pcs: [] }, '');
  assert.ok(new TextEncoder().encode(JSON.stringify(big)).length <= 8 * 1024, 'under the Worker\'s 8 KB: ' + new TextEncoder().encode(JSON.stringify(big)).length);
  const multibyte = C.buildState({ clocks: [], npcs: many(100, (i) => ({ id: 'n' + i, name: '日本語'.repeat(26) })), pcs: [] }, '');
  assert.ok(new TextEncoder().encode(JSON.stringify(multibyte)).length <= 8 * 1024, 'bytes, not characters');
  assert.ok(C.buildState({ clocks: [{ id: 'x'.repeat(65), name: 'Long id', size: 4, filled: 0 }] }, '').clocks.length === 0, 'an id over 64 characters would be a 400');
});

/* ---------- 5. the apply planner ---------- */
const LIVE = () => ({
  clocks: [{ id: 'k1', name: 'Lamp Oil Running Low', size: 6, filled: 2, hidden: false }, { id: 'k2', name: 'Harbour Watch Wakes', size: 4, filled: 1, hidden: true }, { id: 'k3', name: 'Full One', size: 4, filled: 4, hidden: true }],
  mineClocks: [], npcs: [{ id: 'n1', name: 'Mirelle Tanager', tags: [] }, { id: 'n2', name: 'Old Ghost', tags: ['cogm', 'undone'] }], pcs: [{ id: 'p1', name: 'Odo Vance' }], ipadClocks: false });
const act = (o) => Object.assign({ mode: 'act', key: 'k:x:00000001', quote: 'that is a clock', at: '22:41', confidence: 0.9 }, o);

await test('5. clock_add: a HIDDEN danger clock with a new id, whatever the model said about hidden', () => {
  const p = C.planApply(act({ type: 'clock_add', name: 'Drains Below', size: 6, hidden: false }), LIVE(), { id: 'c_new' });
  assert.equal(p.op, 'do'); assert.deepEqual(p.clock, { id: 'c_new', name: 'Drains Below', size: 6, filled: 0, kind: 'danger', hidden: true });
});
await test('5. clock_add: a clock with the same name (as a name is compared) is an offer, and the GM\'s Do it makes it', () => {
  for (const name of ['lamp oil running low', 'Lamp-Oil Running LOW!', '  Lamp  Oil Running Low ']) {
    const p = C.planApply(act({ type: 'clock_add', name, size: 6 }), LIVE(), { id: 'c_new' });
    assert.equal(p.op, 'offer', name); assert.match(p.why, /already on the table/);
    assert.equal(C.planApply(act({ type: 'clock_add', name, size: 6 }), LIVE(), { id: 'c_new' }, { confirmed: true }).op, 'do', 'Do it');
  }
  const l = LIVE(); l.mineClocks = ['Drains Below'];
  assert.equal(C.planApply(act({ type: 'clock_add', name: 'drains below', size: 6 }), l, { id: 'c2' }).op, 'offer', 'one this page just made, which the snapshot may not show yet');
  assert.equal(C.planApply(act({ type: 'clock_add', name: '', size: 6 }), LIVE(), { id: 'c' }).op, 'drop');
  assert.equal(C.planApply(act({ type: 'clock_add', name: 'No id', size: 6 }), LIVE(), {}).op, 'drop');
});
await test('5. clock_tick: one write from the live fill; the live table decides', () => {
  const a = act({ type: 'clock_tick', clock_id: 'k2', by: 1, from_filled: 1, to_filled: 2, size: 4 });
  const p = C.planApply(a, LIVE(), {});
  assert.deepEqual([p.op, p.type, p.id, p.from, p.to, p.size], ['do', 'clock_tick', 'k2', 1, 2, 4]);
  const moved = LIVE(); moved.clocks[1].filled = 3;
  const o = C.planApply(a, moved, {});
  assert.equal(o.op, 'offer'); assert.match(o.why, /moved since/); assert.equal(o.to, 4, 'an offer holds the amount applied to what is there now');
  const c = C.planApply(a, moved, {}, { confirmed: true });
  assert.deepEqual([c.op, c.from, c.to], ['do', 3, 4], 'Do it adds the amount to what is there');
  assert.equal(C.planApply(act({ type: 'clock_tick', clock_id: 'gone', by: 1, from_filled: 0 }), LIVE(), {}).op, 'drop');
  assert.equal(C.planApply(act({ type: 'clock_tick', clock_id: 'k3', by: 1, from_filled: 4, to_filled: 4 }), LIVE(), {}).op, 'drop', 'a full clock: nothing to do');
  const neg = C.planApply(act({ type: 'clock_tick', clock_id: 'k1', by: -5, from_filled: 2, to_filled: 0 }), LIVE(), {});
  assert.deepEqual([neg.from, neg.to], [2, 0], 'a clear stops at zero');
});
await test('5. clock_tick: a clock the players can see, while the iPad follows the clocks, is an offer; a hidden one is not', () => {
  const l = LIVE(); l.ipadClocks = true;
  const vis = C.planApply(act({ type: 'clock_tick', clock_id: 'k1', by: 1, from_filled: 2, to_filled: 3 }), l, {});
  assert.equal(vis.op, 'offer'); assert.match(vis.why, /iPad/);
  assert.equal(C.planApply(act({ type: 'clock_tick', clock_id: 'k2', by: 1, from_filled: 1, to_filled: 2 }), l, {}).op, 'do');
  assert.equal(C.planApply(act({ type: 'clock_tick', clock_id: 'k1', by: 1, from_filled: 2, to_filled: 3 }), l, {}, { confirmed: true }).op, 'do', 'the GM\'s tap');
  l.ipadClocks = false;
  assert.equal(C.planApply(act({ type: 'clock_tick', clock_id: 'k1', by: 1, from_filled: 2, to_filled: 3 }), l, {}).op, 'do', 'not following: a plain tick');
});
await test('5. npc_add: hidden, tagged, with the look as the description; a known name is dropped; an undone one may come back', () => {
  const a = act({ type: 'npc_add', name: 'Hobrik Dunmoor', look: 'a tall man in a green coat', role: 'fence', quote: "his name's Hobrik Dunmoor, tall, green coat" });
  const p = C.planApply(a, LIVE(), { id: 'npc_cogm_1' });
  assert.equal(p.op, 'do'); assert.equal(p.doc.revealed, false); assert.deepEqual(p.doc.tags, ['cogm']); assert.equal(p.doc.firstSeen, null);
  assert.equal(p.doc.description, 'a tall man in a green coat'); assert.equal(p.doc.role, 'fence'); assert.deepEqual(p.doc.spec, {});
  assert.match(p.doc.gmNotes, /Heard at 22:41/);
  assert.deepEqual(Object.keys(p.doc).sort(), ['alias', 'description', 'faction', 'firstSeen', 'gmNotes', 'name', 'revealed', 'role', 'spec', 'tags'], 'only fields checkNpc knows');
  for (const name of ['mirelle tanager', 'Odo Vance', ' ODO  vance ']) { const d = C.planApply(act({ type: 'npc_add', name }), LIVE(), { id: 'n' }); assert.equal(d.op, 'drop', name); assert.equal(d.why, 'already known'); }
  assert.equal(C.planApply(act({ type: 'npc_add', name: 'Old Ghost' }), LIVE(), { id: 'n' }).op, 'do', 'tagged undone: not known');
  assert.equal(C.planApply(Object.assign(a, { mode: 'offer' }), LIVE(), { id: 'n' }).op, 'offer');
  assert.equal(C.planApply(Object.assign(a, { mode: 'offer' }), LIVE(), { id: 'n' }, { confirmed: true }).op, 'do');
});
await test('5. capture and roll_log: the bucket letters; a roll is only ever an offer until the GM taps', () => {
  assert.deepEqual(['name', 'loose_end', 'moment'].map((b) => C.planApply(act({ type: 'capture', bucket: b, text: 'a thing' }), LIVE(), {}).bucket), ['n', 'x', 'm']);
  assert.equal(C.planApply(act({ type: 'capture', bucket: 'whatever', text: 'a thing' }), LIVE(), {}).op, 'drop');
  assert.equal(C.planApply(act({ type: 'capture', bucket: 'moment', text: '   ' }), LIVE(), {}).op, 'drop');
  const r = act({ type: 'roll_log', who: 'Odo', action: 'Prowl', position: 'risky', effect: 'standard', result: 'partial' });
  const o = C.planApply(r, LIVE(), {});
  assert.equal(o.op, 'offer'); assert.equal(o.bucket, 'r'); assert.equal(o.text, 'Odo · Prowl · risky / standard / partial');
  assert.equal(C.planApply(r, LIVE(), {}, { confirmed: true }).op, 'do');
});
await test('5. an offer from the Worker (low confidence) stays an offer for every type, and a drop stays a drop', () => {
  for (const a of [{ type: 'clock_add', name: 'New One', size: 4 }, { type: 'clock_tick', clock_id: 'k2', by: 1, from_filled: 1, to_filled: 2 }, { type: 'npc_add', name: 'Fresh Face' }, { type: 'capture', bucket: 'moment', text: 'x y' }]) {
    assert.equal(C.planApply(act(Object.assign({ mode: 'offer' }, a)), LIVE(), { id: 'i' }).op, 'offer', a.type);
    assert.equal(C.planApply(act(Object.assign({ mode: 'offer' }, a)), LIVE(), { id: 'i' }, { confirmed: true }).op, 'do', a.type + ' + Do it');
  }
  assert.equal(C.planApply(act({ mode: 'offer', type: 'clock_tick', clock_id: 'gone', by: 1 }), LIVE(), {}).op, 'drop');
  for (const bad of [null, 'x', {}, { type: 'nope' }, { type: 'harm', who: 'x' }]) assert.equal(C.planApply(bad, LIVE(), { id: 'i' }).op, 'drop');
});
await test('5. nothing here has a path to a player\'s sheet: no plan names characters, and no plan writes revealed: true', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'cogm.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/revealed:\s*true/.test(src) && !/characters/.test(src) && !/display/i.test(src));
  for (const a of [{ type: 'clock_add', name: 'A B', size: 4 }, { type: 'npc_add', name: 'Zed Qux' }]) { const p = C.planApply(act(a), LIVE(), { id: 'i' }); assert.notEqual((p.doc || {}).revealed, true); assert.notEqual((p.clock || {}).hidden, false); }
});

/* ---------- 6. undo: a compare-and-swap ---------- */
await test('6. undo clock_add: removed only if still as made; changed asks; force removes; gone is done', () => {
  const rec = C.recordOf(C.planApply(act({ type: 'clock_add', name: 'Drains Below', size: 6 }), LIVE(), { id: 'c_new' }));
  const as = { id: 'c_new', name: 'Drains Below', size: 6, filled: 0, hidden: true };
  assert.deepEqual(C.planUndo(rec, { clock: as }), { ok: true, write: { remove: 'c_new' } });
  for (const change of [{ filled: 1 }, { hidden: false }, { name: 'Renamed' }, { size: 8 }]) {
    const r = C.planUndo(rec, { clock: Object.assign({}, as, change) });
    assert.equal(r.ok, false, JSON.stringify(change)); assert.equal(r.why, 'changed'); assert.ok(r.now && r.was);
    assert.deepEqual(C.planUndo(rec, { clock: Object.assign({}, as, change) }, true), { ok: true, write: { remove: 'c_new' } }, 'forced');
  }
  assert.deepEqual(C.planUndo(rec, { clock: null }), { ok: true, noop: 'gone' });
  C.noteEdit(rec, { name: 'Renamed' });
  assert.equal(C.planUndo(rec, { clock: Object.assign({}, as, { name: 'Renamed' }) }).ok, true, 'the card\'s own Rename is not "changed since"');
  C.noteEdit(rec, { hidden: false });
  assert.equal(C.planUndo(rec, { clock: Object.assign({}, as, { name: 'Renamed', hidden: false }) }).ok, true, 'nor is its own Show');
});
await test('6. undo clock_tick: sets back only while the clock still holds what was set', () => {
  const rec = C.recordOf(C.planApply(act({ type: 'clock_tick', clock_id: 'k1', by: 1, from_filled: 2, to_filled: 3 }), Object.assign(LIVE(), { ipadClocks: false }), {}));
  assert.deepEqual(rec, { type: 'clock_tick', id: 'k1', from: 2, to: 3 });
  assert.deepEqual(C.planUndo(rec, { clock: { id: 'k1', size: 6, filled: 3 } }), { ok: true, write: { id: 'k1', filled: 2 } });
  const r = C.planUndo(rec, { clock: { id: 'k1', size: 6, filled: 5 } });
  assert.deepEqual([r.ok, r.why, r.now, r.was, r.back], [false, 'changed', '5/6', '3/6', 2]);
  assert.deepEqual(C.planUndo(rec, { clock: { id: 'k1', size: 6, filled: 5 } }, true), { ok: true, write: { id: 'k1', filled: 2 } });
  assert.deepEqual(C.planUndo(rec, { clock: null }), { ok: true, noop: 'gone' });
});
await test('6. undo npc_add: tags it undone and keeps it hidden; never a delete; refused if revealed or edited since', () => {
  const rec = C.recordOf(C.planApply(act({ type: 'npc_add', name: 'Hobrik Dunmoor', look: 'a tall man', role: 'fence' }), LIVE(), { id: 'npc_cogm_1' }));
  const as = { name: 'Hobrik Dunmoor', description: 'a tall man', role: 'fence', revealed: false, tags: ['cogm'] };
  assert.deepEqual(C.planUndo(rec, { npc: as }), { ok: true, write: { revealed: false, tags: ['cogm', 'undone'] } });
  const rev = C.planUndo(rec, { npc: Object.assign({}, as, { revealed: true }) });
  assert.equal(rev.ok, false); assert.equal(rev.now, 'revealed to the players');
  assert.equal(C.planUndo(rec, { npc: Object.assign({}, as, { name: 'Hobrik D' }) }).ok, false);
  assert.equal(C.planUndo(rec, { npc: Object.assign({}, as, { description: 'changed by hand' }) }).ok, false);
  const forced = C.planUndo(rec, { npc: Object.assign({}, as, { revealed: true }) }, true);
  assert.deepEqual(forced, { ok: true, write: { revealed: false, tags: ['cogm', 'undone'] } });
  assert.deepEqual(C.planUndo(rec, { npc: null }), { ok: true, noop: 'gone' });
  assert.deepEqual(C.planUndo(rec, { npc: Object.assign({}, as, { tags: ['cogm', 'undone'] }) }), { ok: true, noop: 'gone' }, 'already undone');
  assert.ok(!('delete' in C.planUndo(rec, { npc: as }).write));
});
await test('6. undo capture: removes that line if it still says what was filed', () => {
  const rec = Object.assign(C.recordOf(C.planApply(act({ type: 'capture', bucket: 'moment', text: 'The lamp went out' }), LIVE(), {})), { id: 'c123' });
  assert.deepEqual(C.planUndo(rec, { capture: 'The lamp went out' }), { ok: true, write: { remove: 'c123' } });
  assert.equal(C.planUndo(rec, { capture: 'edited since' }).ok, false);
  assert.equal(C.planUndo(rec, { capture: 'edited since' }, true).ok, true);
  assert.deepEqual(C.planUndo(rec, { capture: null }), { ok: true, noop: 'gone' });
  assert.deepEqual(C.planUndo(null, {}), { ok: true, noop: 'gone' }); assert.deepEqual(C.planUndo({ type: 'x' }, {}), { ok: true, noop: 'gone' });
});

/* ---------- 7. the words on the cards ---------- */
await test('7. headlines: an asterisk in model text cannot make bold; the quote is its own line', () => {
  const p = C.planApply(act({ type: 'clock_add', name: '**Loud** *Name*', size: 6 }), LIVE(), { id: 'c' });
  assert.ok(!/\*/.test(C.headline(p, true)) && !/\*/.test(C.headline(p, false)));
  assert.equal(C.headline(C.planApply(act({ type: 'clock_add', name: 'Drains Below', size: 6 }), LIVE(), { id: 'c' }), true), 'Clock made (hidden): Drains Below (6)');
  assert.equal(C.headline(C.planApply(act({ type: 'npc_add', name: 'Hobrik Dunmoor' }), LIVE(), { id: 'n' }), true), 'New NPC (hidden): Hobrik Dunmoor');
  assert.equal(C.headline(C.planApply(act({ type: 'clock_tick', clock_id: 'k2', by: 1, from_filled: 1, to_filled: 2 }), LIVE(), {}), true), 'Ticked: Harbour Watch Wakes 1→2/4');
  assert.equal(C.heard({ at: '22:41', quote: ' that is\n a   clock ' }), 'Heard at 22:41: “that is a clock”');
  assert.equal(C.heard({ quote: 'x' }), 'Heard: “x”');
});

/* ---------- 8. the page's co-GM section, read as source: what it must never reach for ---------- */
await test('8. gm-page.js co-GM section: no health, no sheet, no innerHTML, no storage, the display only through pushDisplay, the key as given', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const a = src.indexOf('function mountCogm()'), b = src.indexOf('function loadShown()');
  assert.ok(a > 0 && b > a);
  const sec = src.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const bad of ['absorb', 'healthStep', 'innerHTML', 'localStorage', 'sessionStorage', 'updateCharacter', 'openCharacter', "collection('characters')", 'setDisplay', 'patchAmbient', 'actionKey', 'hash(']) assert.ok(!sec.includes(bad), 'the co-GM section reaches for ' + bad);
  assert.ok(/pushDisplay\(\{ kind: 'npc'/.test(sec) && (sec.match(/pushDisplay\(/g) || []).length === 1, 'the display is reached only through pushDisplay, once, from Reveal and show');
  assert.ok((sec.match(/revealed:\s*true/g) || []).length === 1, 'revealed: true appears once, in Reveal and show');
  assert.ok(/C\.seen\(cm\.st, a\.key\)/.test(sec) && /C\.mark\(cm\.st, a\.key, 'applied'\)/.test(sec), 'the key as given is checked and marked');
  const cf = fs.readFileSync(path.join(ROOT, 'app', 'runtime', 'cf.js'), 'utf8');
  assert.ok(/assistAct: function \(req\) \{ return api\('POST', '\/gm\/assist\/act'/.test(cf), 'cf.js has the assistAct client');
});

/* ---------- 9. the cue lane (C4d) ---------- */
const CLIVE = { clocks: [{ id: 'c_a', name: 'Escape Invented', size: 6, filled: 1, hidden: true }, { id: 'c_b', name: 'Ferry Late Invented', size: 4, filled: 0, hidden: true }], npcs: [], pcs: [], lastClock: '' };
const CT0 = 1_700_000_000_000;
const crow = (seq, text, o = {}) => ({ seq, id: 'row' + seq, kind: 'line', at: new Date(o.at === undefined ? CT0 : o.at).toISOString(), text, speaker: o.speaker === undefined ? 0 : o.speaker });
const clane = (rows, live = CLIVE, now = CT0) => { const st = C.newState(); C.start(st, 0); C.ingest(st, rows, rows.length ? rows[rows.length - 1].seq : 0, now, live); return st; };

await test('9. a cue line is found at ingest and parsed at once: no settling, no gap, the row id is the cue line id', () => {
  const st = clane([crow(1, 'we sneak in'), crow(2, 'Blade, make a six segment clock called Night Boat Invented'), crow(3, 'and so on')]);
  assert.equal(st.cues.length, 1);
  assert.equal(st.pending.length, 0, 'a cue line is never an uncued window');
  const j = C.cueNext(st, CT0, CLIVE);
  assert.equal(j.kind, 'post'); assert.equal(j.cueLineId, 'row2'); assert.equal(j.from, 2); assert.equal(j.to, 2); assert.equal(j.joined, false);
  assert.equal(j.parsed.length, 1); assert.equal(j.parsed[0].type, 'clock_add'); assert.equal(j.parsed[0].size, 6); assert.ok(!('key' in j.parsed[0]), 'the page never makes a key');
  assert.equal(C.cueNext(st, CT0 + 1, CLIVE), null, 'and it is taken');
});

await test('9. without live, nothing is a cue (the old callers are unchanged)', () => {
  const st = C.newState(); C.start(st, 0); C.ingest(st, [crow(1, 'Blade, make a six segment clock called X Invented')], 1, CT0);
  assert.equal(st.cues.length, 0);
});

await test('9. a cut-off cue waits for ONE more line, joins it whatever its speaker label, and parses again', () => {
  const st = clane([crow(1, 'Blade, make a six', { speaker: 1 })]);
  assert.equal(C.cueNext(st, CT0 + 100, CLIVE), null, 'no next line yet, inside the wait: nothing');
  C.ingest(st, [crow(2, 'segment clock called Night Boat Invented', { speaker: 0 })], 2, CT0 + 300, CLIVE);
  const j = C.cueNext(st, CT0 + 400, CLIVE);
  assert.equal(j.kind, 'post'); assert.equal(j.joined, true); assert.equal(j.cueLineId, 'row1'); assert.equal(j.from, 1); assert.equal(j.to, 2);
  assert.equal(j.parsed[0].name, 'Night Boat Invented'); assert.equal(j.parsed[0].quote, 'Blade, make a six segment clock called Night Boat Invented', 'joined with one space (joinLines)');
});

await test('9. still cut off after the join, or no line within cueWait: the model path (parsed: null)', () => {
  const a = clane([crow(1, 'Blade, make a six')]);
  const j = C.cueNext(a, CT0 + C.TIMING.cueWait + 1, CLIVE);
  assert.equal(j.kind, 'post'); assert.equal(j.parsed, null); assert.equal(j.to, 1);
  const b = clane([crow(1, 'Blade, make a six')]); C.ingest(b, [crow(2, 'um')], 2, CT0 + 200, CLIVE);
  const k = C.cueNext(b, CT0 + 300, CLIVE);
  assert.equal(k.kind, 'post'); assert.equal(k.parsed, null); assert.equal(k.to, 2); assert.equal(k.joined, true);
});

await test('9. a bare "Blade," then a command in the next line', () => {
  const st = clane([crow(1, 'Blade,', { speaker: 0 })]); C.ingest(st, [crow(2, 'tick Escape Invented twice', { speaker: 1 })], 2, CT0 + 50, CLIVE);
  const j = C.cueNext(st, CT0 + 100, CLIVE);
  assert.equal(j.kind, 'post'); assert.equal(j.parsed[0].type, 'clock_tick'); assert.equal(j.parsed[0].clock_id, 'c_a'); assert.equal(j.parsed[0].by, 2);
});

await test('9. at most one cue call every cueGap; cards are not calls and are not held', () => {
  const st = clane([crow(1, 'Blade, tick Escape Invented'), crow(2, 'Blade, tick Ferry Late Invented'), crow(3, 'Blade, show the map to everyone')]);
  assert.equal(C.cueNext(st, CT0, CLIVE).kind, 'post');
  assert.equal(C.cueNext(st, CT0 + 500, CLIVE), null, 'the second call waits');
  assert.equal(C.cueNext(st, CT0 + C.TIMING.cueGap - 1, CLIVE), null);
  const j2 = C.cueNext(st, CT0 + C.TIMING.cueGap, CLIVE);
  assert.equal(j2.kind, 'post'); assert.equal(j2.cueLineId, 'row2');
  const card = C.cueNext(st, CT0 + C.TIMING.cueGap + 1, CLIVE);
  assert.equal(card.kind, 'card'); assert.equal(card.res.refused, 'show');
});

await test('9. refused and missing cues are cards, never posted; which and clock do not wait for a next line', () => {
  const st = clane([crow(1, 'Blade, tick Invented'), crow(2, 'Blade, tick Nonexistent Pier'), crow(3, 'Blade, take a stress'), crow(4, 'Blade, make a clock called Sizeless Invented')]);
  const w = C.cueNext(st, CT0, CLIVE); assert.equal(w.kind, 'card'); assert.equal(w.res.missing, 'which'); assert.deepEqual(w.res.candidates.map((c) => c.id), ['c_a', 'c_b']);
  const cl = C.cueNext(st, CT0, CLIVE); assert.equal(cl.kind, 'card'); assert.equal(cl.res.missing, 'clock');
  const sh = C.cueNext(st, CT0, CLIVE); assert.equal(sh.kind, 'card'); assert.equal(sh.res.refused, 'sheet');
  assert.equal(C.cueNext(st, CT0 + 100, CLIVE), null, 'a missing size waits for one more line');
  const sz = C.cueNext(st, CT0 + C.TIMING.cueWait, CLIVE); assert.equal(sz.kind, 'card'); assert.equal(sz.res.missing, 'size'); assert.deepEqual(sz.res.candidates, [4, 6, 8]);
});

await test('9. a cue is joined only with a line that is not a cue itself', () => {
  const st = clane([crow(1, 'Blade, make a six'), crow(2, 'Blade, tick Escape Invented')]);
  const a = C.cueNext(st, CT0, CLIVE);
  assert.equal(a.kind, 'post'); assert.equal(a.parsed, null, 'cut off, the next line is its own cue: not joined'); assert.equal(a.to, 1); assert.equal(a.joined, false);
  assert.equal(C.cueNext(st, CT0 + C.TIMING.cueGap, CLIVE).cueLineId, 'row2');
});

await test('9. a cue older than cueStale (a hidden page coming back) is "stale": a card that acts only when tapped', () => {
  const st = C.newState(); C.start(st, 0); st.away = CT0 - 70_000; C.ingest(st, [crow(1, 'Blade, tick Escape Invented', { at: CT0 - 90_000 })], 1, CT0, CLIVE);
  const j = C.cueNext(st, CT0, CLIVE);
  assert.equal(j.kind, 'stale'); assert.ok(j.parsed && j.parsed.length === 1);
  assert.equal(st.cueNotBefore, 0, 'a stale cue does not use the call gap');
  const drift = clane([crow(1, 'Blade, tick Escape Invented', { at: CT0 - 90_000 })], CLIVE, CT0);
  assert.equal(C.cueNext(drift, CT0, CLIVE).kind, 'post', 'an old time with the page never away (a drifting iPad clock) is not stale');
  const fresh = clane([crow(1, 'Blade, tick Escape Invented', { at: CT0 - 5_000 })], CLIVE, CT0);
  assert.equal(C.cueNext(fresh, CT0, CLIVE).kind, 'post');
});

await test('9. "tick that" uses lastClock, which the page gives only inside ten minutes', () => {
  const st = clane([crow(1, 'Blade, tick that')], Object.assign({}, CLIVE, { lastClock: 'c_b' }));
  const j = C.cueNext(st, CT0, Object.assign({}, CLIVE, { lastClock: 'c_b' }));
  assert.equal(j.kind, 'post'); assert.equal(j.parsed[0].clock_id, 'c_b');
  const none = clane([crow(1, 'Blade, tick that')]);
  assert.equal(C.cueNext(none, CT0, CLIVE).res.missing, 'which');
});

await test('9. catchUp: what was said while the uncued switch was off is not sent', () => {
  const st = C.newState(); C.start(st, 0);
  C.ingest(st, [crow(1, 'a six segment clock for the cannery')], 1, CT0, CLIVE);
  assert.equal(st.pending.length, 1);
  C.catchUp(st);
  assert.equal(st.pending.length, 0); assert.equal(C.nextWindow(st, CT0 + 60_000), null);
});

await test('9. planApply: a cue clock carries filled; Undo\'s snapshot agrees; a rolled name shows on the card', () => {
  const p = C.planApply({ type: 'clock_add', key: 'cue:x:0', name: 'Ferry', size: 4, filled: 2, hidden: true, quote: 'q' }, { clocks: [], npcs: [], pcs: [] }, { id: 'c_n' }, { confirmed: true });
  assert.equal(p.op, 'do'); assert.equal(p.clock.filled, 2); assert.equal(p.clock.hidden, true);
  assert.equal(C.recordOf(p).snap.filled, 2);
  assert.equal(C.planUndo(C.recordOf(p), { clock: { name: 'Ferry', size: 4, filled: 2, hidden: true } }).ok, true, 'a filled cue clock can be undone');
  assert.equal(C.headline(p, true), 'Clock made (hidden): Ferry (4), 2 marked');
  assert.equal(C.planApply({ type: 'clock_add', name: 'Ferry', size: 4, filled: 9, quote: 'q' }, { clocks: [], npcs: [], pcs: [] }, { id: 'c_n' }, { confirmed: true }).clock.filled, 4, 'clamped to the size');
  const n = C.planApply({ type: 'npc_add', key: 'cue:x:1', name: 'Rolled Name Invented', nameRolled: true, look: 'tired', role: '', quote: 'q' }, { clocks: [], npcs: [], pcs: [] }, { id: 'n_1' }, { confirmed: true });
  assert.equal(n.op, 'do'); assert.equal(n.doc.revealed, false); assert.equal(C.headline(n, true), 'New NPC (hidden): Rolled Name Invented (name rolled)');
  assert.deepEqual(C.planApply({ type: 'undo', key: 'k' }, {}, {}, { confirmed: true }), { op: 'page', type: 'undo' });
  assert.deepEqual(C.planApply({ type: 'rename', name: 'X', key: 'k' }, {}, {}, { confirmed: true }), { op: 'page', type: 'rename' });
});

await test('9. gm-page.js cue lane: no key made, answers applied confirmed, seen skipped, undo and rename page-only, a name rolled by the generator, never retried', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const a = src.indexOf('function mountCogm()'), b = src.indexOf('function loadShown()');
  const sec = src.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/key:\s*['"`]/.test(sec) && !/\bkey\s*=\s*['"`]cue/.test(sec) && !/'cue:'/.test(sec), 'the page never makes an action key');
  assert.ok(/mode: 'cue'/.test(sec) && /cueLineId: job\.cueLineId/.test(sec) && /seenOk: true/.test(sec), 'a cue is posted as mode cue with the cue line id');
  assert.ok(/\{ confirmed: true \}/.test(sec) && /a\.mode !== 'seen'/.test(sec), 'a cue is applied confirmed, and a seen action is skipped');
  assert.ok(/g\.roll\(\{ mem: clone\(S\.npcMem/.test(sec) && /nameRolled: true/.test(sec), 'a missing NPC name is rolled by the NPC generator\'s own draw');
  assert.ok((sec.match(/g\.assistAct\(/g) || []).length === 2, 'assistAct is called from exactly two places (the window and the cue post); the cue post is not retried');
  assert.ok(/cm\.uncued && !cm\.capped && !cm\.winBusy/.test(sec), 'uncued windows run only behind the second switch');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
