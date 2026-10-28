// The iPad autopilot's controller (app/gm/autopilot.js, B68GmAutopilot; design 6): every transition and every guard, on a fake clock.
// Pure: no DOM, no network, no timers. INVENTED ids only.
//   node checks/runtime/gm-autopilot.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const A = require(path.join(ROOT, 'app', 'gm', 'autopilot.js'));
const D = A.DURATIONS;

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const T0 = 1000000;
const make = (prefix) => A.create({ now: () => T0, idPrefix: prefix || 'p1-' });
const clock = (id, at, visible) => ({ type: 'clock', clockId: id, visible: visible === undefined ? true : visible, at });
const npc = (id, at, over) => ({ type: 'npc', npcId: id, staged: true, revealed: true, portrait: true, at, ...(over || {}) });
const push = (kind, at) => ({ type: 'push', kind, at });
const sec = (n) => n * 1000;

test('the durations are the design 6.2 table', () => {
  assert.deepEqual([D.clockMs, D.clockCapMs, D.npcMinMs, D.npcTailMs, D.npcMaxMs, D.cooldownMs, D.liveMs, D.handoutMs], [8000, 20000, 10000, 20000, 180000, 15000, 15000, 30000]);
  assert.deepEqual(A.PRIORITY, ['npc', 'clock', 'text'], 'NPC before clock before text (the dawn is the GM\'s and never queues)');
});

// ---------- Ready -> Showing ----------
test('Ready -> Showing: a visible clock changed sets a clock overlay carrying the clock id only, marked auto', () => {
  const ap = make();
  assert.equal(ap.state().mode, 'ready');
  const a = ap.event(clock('c_fuse', T0));
  assert.equal(a.do, 'set');
  assert.deepEqual(Object.keys(a.overlay).sort(), ['auto', 'clockId', 'id', 'kind', 'ms'], 'nothing but the id, kind, ms, clockId and the auto mark: no name, size or fill');
  assert.deepEqual([a.overlay.kind, a.overlay.clockId, a.overlay.ms, a.overlay.auto], ['clock', 'c_fuse', 8000, true]);
  const s = ap.state();
  assert.equal(s.mode, 'showing'); assert.equal(s.showing.key, 'c_fuse'); assert.equal(s.showing.until, T0 + 8000);
});

test('a HIDDEN clock never shows (positive control: the same event, visible, does)', () => {
  const ap = make();
  assert.equal(ap.event(clock('c_secret', T0, false)), null);
  assert.equal(ap.event({ type: 'clock', clockId: 'c_secret', at: T0 }), null, 'no visible flag at all is not visible');
  assert.equal(ap.event({ type: 'clock', clockId: 'c_secret', visible: 'yes', at: T0 }), null, 'only true counts');
  assert.deepEqual([ap.state().mode, ap.state().pending], ['ready', {}], 'and nothing waits');
  ap.tick(T0 + sec(60));
  assert.equal(ap.state().mode, 'ready');
  assert.equal(ap.event(clock('c_secret', T0 + sec(61), true)).do, 'set');
});

test('Ready -> Showing: a revealed NPC with a portrait, on stage, speaking; every one of the three flags is needed (positive control last)', () => {
  for (const over of [{ staged: false }, { revealed: false }, { portrait: false }, { staged: undefined }, { revealed: 'true' }, { portrait: 1 }]) {
    const ap = make();
    assert.equal(ap.event(npc('npc_a', T0, over)), null, JSON.stringify(over));
    assert.deepEqual([ap.state().mode, ap.state().pending], ['ready', {}]);
  }
  const ap = make();
  const a = ap.event(npc('npc_a', T0));
  assert.equal(a.do, 'set');
  assert.deepEqual(Object.keys(a.overlay).sort(), ['auto', 'id', 'kind', 'ms', 'npcId']);
  assert.deepEqual([a.overlay.kind, a.overlay.npcId, a.overlay.ms], ['npc', 'npc_a', 180000], 'a 3-minute backstop; the module clears it itself');
  assert.equal(ap.state().showing.until, T0 + 20000, 'at least 10 s, and 20 s after the last word');
});

test('overlay ids are opaque counters: a prefix and a number, never a clock or NPC id or name, and different across a reload (a new prefix)', () => {
  const ap = make('zq9-');
  const a = ap.event(clock('c_the_vault_job', T0)), b = ap.event(clock('c_the_vault_job', T0 + 1000));
  assert.match(a.overlay.id, /^zq9-\d+$/); assert.match(b.overlay.id, /^zq9-\d+$/);
  assert.notEqual(a.overlay.id, b.overlay.id, 'each overlay is a new id (the display shows an id once)');
  assert.ok(!/vault|job|c_/.test(a.overlay.id + b.overlay.id));
  const other = make('b4m-').event(clock('c_the_vault_job', T0));
  assert.notEqual(other.overlay.id, a.overlay.id, 'a reloaded page has another prefix, so its first id is not an id the display has seen');
  const n = make('q-').event(npc('npc_ada_k', T0));
  assert.ok(!/ada|npc/.test(n.overlay.id), 'nor an NPC: ' + n.overlay.id);
});

// ---------- Showing -> Showing ----------
test('Showing -> Showing: the same kind again extends a clock by 8 s from now, up to 20 s in all, each as a NEW overlay id', () => {
  const ap = make();
  const a = ap.event(clock('c_one', T0));
  const b = ap.event(clock('c_one', T0 + sec(3)));
  assert.equal(b.do, 'set'); assert.notEqual(b.overlay.id, a.overlay.id); assert.equal(b.overlay.ms, 8000);
  assert.equal(ap.state().showing.until, T0 + sec(11), 'now + 8 s');
  const c = ap.event(clock('c_two', T0 + sec(14)));
  assert.equal(c.overlay.clockId, 'c_two', 'a different clock of the same kind takes the card');
  assert.equal(c.overlay.ms, 6000, 'only 6 s of the 20 s cap are left: ' + c.overlay.ms);
  assert.equal(ap.state().showing.until, T0 + sec(20), 'never past 20 s from the first');
  // under a second of cap left: it waits instead of flashing
  const d = ap.event(clock('c_two', T0 + sec(19.5)));
  assert.equal(d, null);
  assert.equal(ap.state().pending.clock.key, 'c_two');
});

test('Showing -> Showing: the same NPC still talking moves the end out (no new overlay): 20 s after the last word, never past 3 minutes', () => {
  const ap = make();
  const a = ap.event(npc('npc_a', T0));
  assert.equal(ap.event(npc('npc_a', T0 + sec(15))), null, 'the card is up already');
  assert.equal(ap.state().showing.until, T0 + sec(35));
  assert.equal(ap.state().showing.id, a.overlay.id);
  assert.equal(ap.tick(T0 + sec(34)), null, 'still on');
  ap.event(npc('npc_a', T0 + sec(170)));
  assert.equal(ap.state().showing.until, T0 + sec(180), 'capped at 3 minutes from the start');
  const x = ap.tick(T0 + sec(180));
  assert.deepEqual([x.do, x.id], ['clear', a.overlay.id]);
});

test('Showing -> Showing: another NPC replaces the card (a new overlay for them)', () => {
  const ap = make();
  const a = ap.event(npc('npc_a', T0));
  const b = ap.event(npc('npc_b', T0 + sec(5)));
  assert.equal(b.do, 'set'); assert.equal(b.overlay.npcId, 'npc_b'); assert.notEqual(b.overlay.id, a.overlay.id);
  assert.equal(ap.state().showing.key, 'npc_b');
});

test('a different kind while showing waits (nothing preempts), and at most one waits per kind, the newest', () => {
  const ap = make();
  ap.event(clock('c_one', T0));
  assert.equal(ap.event(npc('npc_a', T0 + sec(1))), null);
  assert.equal(ap.event(npc('npc_b', T0 + sec(2))), null);
  assert.equal(ap.state().pending.npc.key, 'npc_b', 'newest wins');
  assert.equal(Object.keys(ap.state().pending).length, 1);
  assert.equal(ap.state().showing.key, 'c_one', 'the clock is still on');
});

// ---------- Showing -> Ready ----------
test('Showing -> Ready: time\'s up clears the overlay it set, then a 15 s cooldown holds the next one back (positive control: then it shows)', () => {
  const ap = make();
  const a = ap.event(clock('c_one', T0));
  assert.equal(ap.tick(T0 + sec(7.9)), null, 'not yet');
  const x = ap.tick(T0 + sec(8));
  assert.deepEqual([x.do, x.id], ['clear', a.overlay.id]);
  assert.equal(ap.state().mode, 'ready'); assert.equal(ap.state().showing, null);
  assert.equal(ap.event(clock('c_two', T0 + sec(10))), null, 'inside the cooldown');
  assert.equal(ap.state().pending.clock.key, 'c_two');
  assert.equal(ap.tick(T0 + sec(22.9)), null, 'cooldown to 23 s');
  const y = ap.tick(T0 + sec(23));
  assert.deepEqual([y.do, y.overlay.clockId], ['set', 'c_two'], 'the one that waited is shown when the cooldown is over');
  // a quiet table: after the cooldown a new event shows at once
  const ap2 = make(); ap2.event(clock('c_one', T0)); ap2.tick(T0 + sec(8));
  assert.equal(ap2.event(clock('c_one', T0 + sec(23))).do, 'set');
});

test('Showing -> Ready: the GM pushes an NPC, a handout, a rule or lights out, and the GM wins (cleared now, no cooldown); a map push does not', () => {
  for (const kind of ['npc', 'handout', 'rule', 'dark']) {
    const ap = make();
    const a = ap.event(clock('c_one', T0));
    const x = ap.event(push(kind, T0 + sec(2)));
    assert.deepEqual([x && x.do, x && x.id], ['clear', a.overlay.id], kind);
    assert.equal(ap.state().mode, 'ready'); assert.equal(ap.state().cool, 0, 'no cooldown after the GM wins');
  }
  for (const kind of ['map', 'text', 'cards', 'blank', 'live', 'clocks']) {
    const ap = make();
    ap.event(clock('c_one', T0));
    assert.equal(ap.event(push(kind, T0 + sec(2))), null, kind);
    assert.equal(ap.state().mode, 'showing', kind + ' leaves it');
  }
});

test('the subject goes (hidden, off stage): cleared now if showing, dropped if waiting; another subject is left alone (positive control)', () => {
  const ap = make();
  const a = ap.event(clock('c_one', T0));
  assert.equal(ap.event({ type: 'gone', kind: 'clock', key: 'c_other', at: T0 + 1000 }), null);
  assert.equal(ap.state().mode, 'showing', 'a different clock going changes nothing');
  assert.equal(ap.event({ type: 'gone', kind: 'npc', key: 'c_one', at: T0 + 1000 }), null, 'nor the same key under another kind');
  const x = ap.event({ type: 'gone', kind: 'clock', key: 'c_one', at: T0 + 1500 });
  assert.deepEqual([x.do, x.id], ['clear', a.overlay.id]);
  assert.equal(ap.state().mode, 'ready');
  // waiting: dropped, so it never shows
  const b = make(); b.event(clock('c_one', T0)); b.event(npc('npc_w', T0 + 100));
  assert.equal(b.state().pending.npc.key, 'npc_w');
  b.event({ type: 'gone', kind: 'npc', key: 'npc_w', at: T0 + 200 });
  assert.deepEqual(b.state().pending, {});
  b.tick(T0 + sec(8)); assert.equal(b.tick(T0 + sec(30)), null, 'and nothing comes out when the slot frees');
});

// ---------- Hold, Off ----------
test('Ready -> Hold -> Ready: Take over holds (every table event ignored, nothing queues); Hand back resumes', () => {
  const ap = make();
  assert.equal(ap.event({ type: 'takeover', at: T0 }), null);
  assert.equal(ap.state().mode, 'hold');
  assert.equal(ap.event(clock('c_one', T0 + 1000)), null); assert.equal(ap.event(npc('npc_a', T0 + 1000)), null);
  assert.deepEqual(ap.state().pending, {}, 'nothing queued on Hold');
  assert.equal(ap.tick(T0 + sec(60)), null);
  assert.equal(ap.event({ type: 'handback', at: T0 + sec(61) }), null);
  assert.equal(ap.state().mode, 'ready');
  assert.equal(ap.event(clock('c_one', T0 + sec(62))).do, 'set');
});

test('Showing -> Hold: Take over clears the overlay now and holds', () => {
  const ap = make();
  const a = ap.event(clock('c_one', T0));
  const x = ap.event({ type: 'takeover', at: T0 + sec(2) });
  assert.deepEqual([x.do, x.id], ['clear', a.overlay.id]);
  assert.equal(ap.state().mode, 'hold'); assert.equal(ap.state().showing, null);
  assert.equal(ap.event({ type: 'takeover', at: T0 + sec(3) }), null, 'twice is nothing');
  assert.equal(ap.tick(T0 + sec(30)), null, 'no timer clear after the take over');
});

test('Hold keeps tracking the GM\'s pushes, so the guards are right when it is handed back (lights out stays a guard)', () => {
  const ap = make();
  ap.event({ type: 'takeover', at: T0 });
  ap.event(push('dark', T0 + 1000));
  ap.event({ type: 'handback', at: T0 + 2000 });
  assert.equal(ap.event(clock('c_one', T0 + 3000)), null, 'still lights out');
  assert.equal(ap.state().pending.clock.key, 'c_one');
});

test('Ready -> Off -> Ready; Showing -> Off clears; Off ignores events', () => {
  const ap = make();
  assert.equal(ap.event({ type: 'off', at: T0 }), null);
  assert.equal(ap.state().mode, 'off');
  assert.equal(ap.event(clock('c_one', T0 + 1000)), null); assert.deepEqual(ap.state().pending, {});
  assert.equal(ap.event({ type: 'takeover', at: T0 + 1500 }), null); assert.equal(ap.state().mode, 'off', 'Take over is for a running autopilot');
  assert.equal(ap.event({ type: 'handback', at: T0 + 1500 }), null); assert.equal(ap.state().mode, 'off', 'Hand back is for Hold');
  ap.event({ type: 'on', at: T0 + 2000 });
  assert.equal(ap.state().mode, 'ready');
  assert.equal(ap.event(clock('c_one', T0 + 3000)).do, 'set');
  const b = make(); const a = b.event(clock('c_one', T0));
  const x = b.event({ type: 'off', at: T0 + 1000 });
  assert.deepEqual([x.do, x.id], ['clear', a.overlay.id]); assert.equal(b.state().mode, 'off');
  assert.equal(b.event({ type: 'on', at: 5 }), null);
  assert.equal(make().event({ type: 'on', at: 5 }), null, 'On is for Off');
});

// ---------- guards ----------
function guardCase(name, arm, lift, liftAt) {
  test('guard: ' + name + ' holds an overlay back, and it shows when the guard lifts (positive control)', () => {
    const ap = make();
    arm(ap);
    assert.equal(ap.event(clock('c_one', T0 + 100)), null, 'held');
    assert.equal(ap.state().mode, 'ready');
    assert.equal(ap.state().pending.clock.key, 'c_one');
    assert.equal(ap.tick(T0 + 200), null, 'and a tick while it holds sends nothing');
    lift(ap);
    const x = ap.tick(liftAt);
    assert.deepEqual([x && x.do, x && x.overlay.clockId], ['set', 'c_one'], 'shown once it lifts');
    // the same guard, an NPC
    const b = make(); arm(b);
    assert.equal(b.event(npc('npc_a', T0 + 100)), null, 'an NPC is held too');
  });
}
guardCase('lights out', (ap) => ap.event(push('dark', T0)), (ap) => ap.event(push('blank', T0 + sec(5))), T0 + sec(6));
guardCase('a rules entry on the iPad', (ap) => ap.event(push('rule', T0)), (ap) => ap.event(push('map', T0 + sec(5))), T0 + sec(6));
guardCase('a live-reveal push in the last 15 s', (ap) => ap.event(push('live', T0)), () => {}, T0 + sec(15));
guardCase('a handout pushed in the last 30 s', (ap) => ap.event(push('handout', T0)), () => {}, T0 + sec(30));
guardCase('the page being hidden', (ap) => ap.event({ type: 'visible', visible: false, at: T0 }), (ap) => ap.event({ type: 'visible', visible: true, at: T0 + sec(5) }), T0 + sec(6));
guardCase('a running dawn', (ap) => ap.event({ type: 'dawn', ms: 30000, at: T0 }), () => {}, T0 + sec(30));

test('guard edges: 14.9 s after a live push still holds, 15 s does not; 29.9 s after a handout holds, 30 s does not', () => {
  const a = make(); a.event(push('live', T0));
  assert.equal(a.event(clock('c_one', T0 + sec(14.9))), null);
  assert.equal(make().event(push('live', T0)) || 'x', 'x');
  const b = make(); b.event(push('live', T0));
  assert.equal(b.event(clock('c_one', T0 + sec(15))).do, 'set');
  const c = make(); c.event(push('handout', T0));
  assert.equal(c.event(clock('c_one', T0 + sec(29.9))), null);
  const d = make(); d.event(push('handout', T0));
  assert.equal(d.event(clock('c_one', T0 + sec(30))).do, 'set');
});

test('a waiter older than 60 s is dropped (a stale card never appears), a fresher one is kept', () => {
  const ap = make();
  ap.event(push('dark', T0));
  ap.event(clock('c_old', T0 + 100));
  ap.event(npc('npc_new', T0 + sec(69)));
  ap.event(push('blank', T0 + sec(70)));
  assert.equal(ap.tick(T0 + sec(71)).overlay.npcId, 'npc_new', 'the NPC, 2 s old, is shown; the clock, 70 s old, was dropped');
  assert.equal(ap.state().pending.clock, undefined);
});

test('a guard that arrives while showing is not a reason to take the card down; only the GM\'s pushes do', () => {
  const ap = make();
  ap.event(clock('c_one', T0));
  ap.event(push('live', T0 + 1000)); ap.event({ type: 'visible', visible: false, at: T0 + 1500 });
  assert.equal(ap.state().mode, 'showing');
  const x = ap.tick(T0 + sec(8));
  assert.equal(x.do, 'clear', 'it still ends on time');
});

test('a clock extension is held by a guard too (a live push mid-card): it waits instead of sending', () => {
  const ap = make();
  ap.event(clock('c_one', T0));
  ap.event(push('live', T0 + 1000));
  assert.equal(ap.event(clock('c_one', T0 + 2000)), null);
  assert.equal(ap.state().pending.clock.key, 'c_one');
});

// ---------- priority and the dawn ----------
test('priority: when two wait for the slot, the NPC goes before the clock (positive control: the clock goes next)', () => {
  const ap = make();
  const a = ap.event(clock('c_one', T0));
  ap.event(clock('c_two', T0 + 1000));       // same kind while showing extends; so wait for time's up first
  ap.tick(T0 + sec(20));                     // time's up (the extension ran to 9 s; cleared)
  assert.equal(ap.state().mode, 'ready');
  ap.event(push('dark', T0 + sec(21)));      // hold the slot with a guard, so both wait
  ap.event(clock('c_three', T0 + sec(22)));
  ap.event(npc('npc_a', T0 + sec(23)));
  assert.deepEqual(Object.keys(ap.state().pending).sort(), ['clock', 'npc']);
  ap.event(push('blank', T0 + sec(24)));
  const first = ap.tick(T0 + sec(40));
  assert.deepEqual([first.overlay.kind, first.overlay.npcId], ['npc', 'npc_a']);
  assert.ok(a.overlay.id);
  assert.equal(ap.state().pending.clock.key, 'c_three', 'the clock still waits');
  const n = ap.tick(T0 + sec(60));            // the NPC's 20 s are up (cleared), then the cooldown
  assert.equal(n.do, 'clear');
  const c = ap.tick(T0 + sec(75));
  assert.deepEqual([c.do, c.overlay.clockId], ['set', 'c_three']);
});

test('the dawn is the GM\'s: it goes even on Hold (the page sends it), takes the slot without a clear of ours, and nothing is set over it', () => {
  const ap = make();
  ap.event({ type: 'takeover', at: T0 });
  assert.equal(ap.event({ type: 'dawn', ms: 30000, at: T0 + 1000 }), null, 'the page sends the dawn itself; the module only learns of it');
  assert.equal(ap.state().guards.dawnUntil, T0 + 31000);
  const b = make();
  const a = b.event(clock('c_one', T0));
  assert.equal(b.event({ type: 'dawn', ms: 30000, at: T0 + 2000 }), null, 'no clear: it would clear the dawn');
  assert.equal(b.state().mode, 'ready'); assert.equal(b.state().showing, null);
  assert.equal(b.tick(T0 + sec(9)), null, 'and the clock\'s 8 s timer does not clear the dawn');
  assert.equal(b.event(clock('c_two', T0 + sec(10))), null, 'nothing is laid over it');
  const x = b.tick(T0 + sec(32));
  assert.deepEqual([x.do, x.overlay.clockId], ['set', 'c_two'], 'and it shows once the dawn is over');
  assert.ok(a.overlay.id);
});

test('replaced: the overlay in the document is no longer ours (the GM cleared it): back to Ready with no clear and no cooldown', () => {
  const ap = make();
  ap.event(clock('c_one', T0));
  assert.equal(ap.event({ type: 'replaced', at: T0 + 1000 }), null);
  assert.equal(ap.state().mode, 'ready');
  assert.equal(ap.tick(T0 + sec(9)), null, 'its timer does not clear what is not ours');
  assert.equal(ap.event(clock('c_one', T0 + 2000)).do, 'set', 'no cooldown after the GM cleared it');
});

// ---------- the log, and bad input ----------
test('the log keeps the last 20 and carries ids, never a name; note() adds the driver\'s lines', () => {
  const ap = make();
  for (let i = 0; i < 30; i++) { ap.event(clock('c_' + i, T0 + i * sec(40))); ap.tick(T0 + i * sec(40) + sec(9)); }
  const log = ap.state().log;
  assert.equal(log.length, 20);
  assert.ok(log.every((x) => typeof x.at === 'number' && typeof x.do === 'string' && typeof x.why === 'string'));
  assert.ok(log.some((x) => x.do === 'set') && log.some((x) => x.do === 'clear'));
  ap.note({ do: 'refused', kind: 'clock', key: 'c_x', why: 'HTTP 400', at: 5 });
  const last = ap.state().log[19];
  assert.deepEqual([last.do, last.kind, last.key], ['refused', 'clock', 'c_x']);
  assert.equal(ap.state().log.length, 20);
  assert.deepEqual(Object.keys(last).sort(), ['at', 'do', 'key', 'kind', 'why']);
});

test('malformed events are ignored without throwing, and a bad id is not accepted', () => {
  const ap = make();
  for (const e of [null, undefined, 5, 'clock', [], {}, { type: 5 }, { type: 'nope' }, { type: 'clock' }, { type: 'clock', clockId: '', visible: true },
    { type: 'clock', clockId: 'has space', visible: true }, { type: 'clock', clockId: 7, visible: true }, { type: 'npc', npcId: 'x y', staged: true, revealed: true, portrait: true },
    { type: 'gone', kind: 'text', key: 'k' }, { type: 'gone', kind: 'clock' }, { type: 'push' }, { type: 'push', kind: 5 }]) {
    assert.doesNotThrow(() => ap.event(e), JSON.stringify(e));
  }
  assert.deepEqual([ap.state().mode, ap.state().pending], ['ready', {}]);
  assert.equal(ap.tick('x') === null || true, true);
  assert.equal(ap.event(clock('c_ok', T0)).do, 'set', 'and it still works');
});

test('the default clock is the injected one (no real time is read): an event without `at` and a tick without a time use now()', () => {
  let t = 500000;
  const ap = A.create({ now: () => t, idPrefix: 'n-' });
  const a = ap.event({ type: 'clock', clockId: 'c_one', visible: true });
  assert.equal(ap.state().showing.t0, 500000);
  t += 9000;
  const x = ap.tick();
  assert.deepEqual([x.do, x.id], ['clear', a.overlay.id]);
});

test('no module-level state: two controllers are independent', () => {
  const a = make('a-'), b = make('b-');
  a.event(clock('c_one', T0));
  assert.equal(b.state().mode, 'ready'); assert.equal(a.state().mode, 'showing');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
