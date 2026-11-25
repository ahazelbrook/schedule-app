// Unit test for the stamp before the roll and the consequence sizer (suite 1.3 / 1.4, app/gm/stamp.js), as part of the Roll since the night rebuild (N4):
// the room's "If it goes wrong" lines and the Roll's one line prefilled from them (seedLine), the stamp fired from what is set (the console's position, an
// effect that never fires it, the Roll's line), the report card laid and taken down, Stamp again when what is set changed, the sizer's full size and its
// second-tap reduce, no key listener of its own (Esc reaches it through gm/esc.js), and every switch off. A fake host stands in for the page; the Pelican
// Rooms and the invented cast only, and every GM-only string is a GM-ONLY- marker. No network, no model.
//   node checks/runtime/gm-stamp.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const St = require(path.join(ROOT, 'app', 'gm', 'stamp.js'));
const Rooms = require(path.join(ROOT, 'app', 'gm', 'room-notes.js'));
const Show = require(path.join(ROOT, 'app', 'gm', 'show.js'));
const Esc = require(path.join(ROOT, 'app', 'gm', 'esc.js'));

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const POSITIONS = [
  { value: 'controlled', severity: 'lesser', ticks: '1 tick', harm: '1 (lesser)' },
  { value: 'risky', severity: 'moderate', ticks: '2 ticks', harm: '2' },
  { value: 'desperate', severity: 'severe', ticks: '4 ticks', harm: '3' }
];
const ROOM_MD = [
  'Plain description of the room.',
  '- **Costume:** a waiter’s jacket',
  '- **If it goes wrong:** Wren Tully looks up from the bar.',
  '',
  '**If it goes wrong**',
  '- A tray of glasses hits the floor',
  '- The band stops mid-song',
  '',
  'Something else.',
  '```',
  'If it goes wrong: GM-ONLY-FENCED-LINE',
  '```'
].join('\n');

/* the page's side. over.line: give the host the Roll's one line (line() / setLine()), starting with this text */
function makeHost(over = {}) {
  const calls = { show: [], clear: 0, log: [], pos: [], toast: [], timers: [], changed: 0, setLine: [], keyListeners: 0 };
  let overlay = '', cur = over.pos === undefined ? 'risky' : over.pos, line = typeof over.line === 'string' ? over.line : null;
  const on = Object.assign({ 'spine.stamp': true, 'spine.sizer': true }, over.on || {});
  const doc = { addEventListener: () => { calls.keyListeners++; }, removeEventListener: () => {} };
  const host = {
    feature: (id) => !!on[id], positions: () => POSITIONS, roomLines: () => over.lines || ['Wren Tully looks up from the bar.', 'A tray of glasses hits the floor'],
    currentPosition: () => cur, setPosition: (p) => { calls.pos.push(p); cur = p; },
    show: async (payload, key) => { if (over.refuse) return null; calls.show.push({ payload, key }); overlay = Show.idFor(key); return { ok: true }; },
    keyFor: (k) => Show.idFor(k), overlayId: () => (over.overlay !== undefined ? over.overlay : overlay),
    clearOverlay: async () => { calls.clear++; overlay = ''; return {}; },
    log: (t) => calls.log.push(t), toast: (m, bad) => calls.toast.push([m, !!bad]), now: () => 1700000000000,
    setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; }, clearTimeout: () => {}, changed: () => { calls.changed++; },
    doc: () => doc        /* a page used to hand its document over for the Esc key: the stamp must never listen on it now */
  };
  if (line !== null) { host.line = () => line; host.setLine = (t) => { calls.setLine.push(t); line = t; }; }
  return { host, calls, setOverlay: (v) => { overlay = v; }, setPos: (p) => { cur = p; }, setLineText: (t) => { line = t; }, lineNow: () => line };
}

await test('08/11: every stamp that goes up calls host.stamped once with its position, effect and line (fire, Stamp again, a cue); a refused one and a draft never do', async () => {
  const m = makeHost({ line: 'Wren Tully looks up' }), got = [];
  m.host.stamped = (st) => got.push(st);
  const c = St.create(m.host);
  await c.draft('pos', 'desperate'); await c.draft('eff', 'great'); await c.draft('text', 'the floor gives way');
  assert.equal(got.length, 0, 'setting what goes up asks nothing');
  assert.equal(await c.fire(), true);
  assert.equal(got.length, 1); assert.equal(got[0].position, 'desperate'); assert.equal(got[0].effect, 'great'); assert.equal(got[0].text, 'the floor gives way'); assert.equal(typeof got[0].at, 'number');
  await c.draft('text', 'the guard turns');
  assert.equal(await c.fire(), true, 'Stamp again');
  assert.equal(got.length, 2); assert.equal(got[1].text, 'the guard turns');
  assert.equal(await c.stampNow('risky', 'standard', ''), true, 'a cue with no text stamps the Roll\'s line');
  assert.equal(got.length, 3); assert.equal(got[2].position, 'risky'); assert.equal(got[2].text, 'the guard turns');
  const r = makeHost({ refuse: true }), none = [];
  r.host.stamped = (st) => none.push(st);
  assert.equal(await St.create(r.host).fire(), false);
  assert.equal(none.length, 0, 'refused: nothing went up, nothing is asked');
  const b = makeHost(); b.host.stamped = () => { throw new Error('a broken page'); };
  assert.equal(await St.create(b.host).fire(), true, 'a page that throws never stops the stamp');
});

await test('goesWrong: an inline line, a bare label with bullets under it, a quote callout form; fenced text and other lines are never read', () => {
  assert.deepEqual(St.goesWrong(ROOM_MD), ['Wren Tully looks up from the bar.', 'A tray of glasses hits the floor', 'The band stops mid-song']);
  assert.deepEqual(St.goesWrong('> **If it goes wrong:** the lights fail\n> - and the door sticks'), ['the lights fail']);
  assert.deepEqual(St.goesWrong('#### If it goes wrong\nOne line under a heading.\n\n#### Next'), ['One line under a heading.']);
  assert.deepEqual(St.goesWrong('Nothing relevant here'), []);
  assert.ok(St.goesWrong(Array.from({ length: 12 }, (_, i) => '- If it goes wrong: line ' + i).join('\n')).length <= 5, 'at most five');
});

await test('this room: the room most of the crew are in; its lines come from the prep note’s Rooms section, matched the way the Run view matches rooms', () => {
  assert.equal(St.pickRoom({ a: 'Showroom', b: 'Cocktail lounge', c: 'Showroom' }), 'Showroom');
  assert.equal(St.pickRoom({}), ''); assert.equal(St.pickRoom(null), '');
  const prep = { notes: [{ id: 'n1', title: 'Prep', blocks: [{ k: 'md', src: '## Rooms\n\n### Showroom\n' + ROOM_MD + '\n\n### Cocktail lounge\nQuiet.\n' }] }] };
  const rn = Rooms.find(prep, ['Showroom', 'Cocktail lounge']);
  assert.equal(St.roomLines(rn, 'The showroom', Rooms.normRoom)[0], 'Wren Tully looks up from the bar.');
  assert.deepEqual(St.roomLines(rn, 'Cocktail lounge', Rooms.normRoom), []);
  assert.deepEqual(St.roomLines(rn, 'Luxury penthouse', Rooms.normRoom), []);
  assert.deepEqual(St.roomLines(null, 'Showroom'), []);
});

await test('sizes come from the table the page hands over, not from this file: the ladder only says which position is one down', () => {
  assert.deepEqual(St.sizeOf(POSITIONS, 'risky'), { position: 'risky', severity: 'moderate', ticks: '2 ticks', harm: '2' });
  assert.equal(St.sizeOf(POSITIONS, 'nope'), null); assert.equal(St.sizeOf(null, 'risky'), null);
  assert.deepEqual([St.lower('desperate'), St.lower('risky'), St.lower('controlled')], ['risky', 'controlled', '']);
  assert.ok(!/['"](?:severe|moderate|lesser)['"]/i.test(require('node:fs').readFileSync(path.join(ROOT, 'app', 'gm', 'stamp.js'), 'utf8')), 'no rules wording in code');
});

await test('the Roll’s line, prefilled from the room (seedLine): empty takes the room’s first line; it follows the room while it is the room’s own; the GM’s own is never replaced', () => {
  const mem = {}, SHOW = ['Dov Kessler turns round.', 'A glass breaks'], LOUNGE = ['Lotte Brand looks up from the bar.'];
  assert.equal(St.seedLine('', 'Showroom', SHOW, mem), 'Dov Kessler turns round.', 'empty: the room’s first line');
  assert.deepEqual(mem.seed, { room: 'Showroom', line: 'Dov Kessler turns round.' });
  assert.equal(St.seedLine('Dov Kessler turns round.', 'Showroom', SHOW, mem), null, 'already the room’s line: nothing to do');
  assert.equal(St.seedLine('Dov Kessler turns round.', 'Cocktail lounge', LOUNGE, mem), 'Lotte Brand looks up from the bar.', 'the crew moves: the seeded line follows the room');
  assert.equal(St.seedLine('My own line', 'Showroom', SHOW, mem), null, 'a line the GM typed is never replaced');
  assert.equal(St.seedLine('', 'Luxury penthouse', [], mem), null, 'a room with no line leaves an empty line empty');
  assert.equal(St.seedLine('x', 'Showroom', SHOW, null), null, 'no memory: no change');
  const back = {};                                   /* a reload: the memory is gone, the stored line is still this room's */
  assert.equal(St.seedLine('Dov Kessler turns round.', 'Showroom', SHOW, back), null); assert.equal(back.seed.room, 'Showroom', 'and it is the room’s own again');
  assert.equal(St.seedLine('  Dov   Kessler turns round. ', 'Showroom', SHOW, {}), null, 'compared as one cut line');
});

await test('a line the GM emptied stays empty in that room (lineCleared), and the next room fills it again', () => {
  const mem = {}, SHOW = ['Dov Kessler turns round.'], LOUNGE = ['Lotte Brand looks up from the bar.'];
  St.seedLine('', 'Showroom', SHOW, mem);
  St.lineCleared('Showroom', mem);
  assert.equal(St.seedLine('', 'Showroom', SHOW, mem), null, 'emptied here: stays empty');
  assert.equal(St.seedLine('', 'Cocktail lounge', LOUNGE, mem), 'Lotte Brand looks up from the bar.', 'a new room: its line');
  assert.equal(mem.cleared, null);
  assert.equal(St.seedLine('', 'Showroom', SHOW, mem), 'Dov Kessler turns round.', 'and back in the first room, its line again');
});

await test('every switch off: nothing is shown, logged or set, and the view says the stamp is off', async () => {
  const { host, calls } = makeHost({ on: { 'spine.stamp': false, 'spine.sizer': false } });
  const c = St.create(host);
  assert.equal(await c.draft('pos', 'risky'), false); assert.equal(await c.draft('eff', 'standard'), false); assert.equal(await c.stampNow('risky', 'standard', 'x'), false);
  assert.equal(await c.fire(), false); assert.equal(await c.mark('45'), false);
  assert.equal(c.seed(), false);
  assert.deepEqual([calls.show.length, calls.log.length, calls.pos.length, calls.clear, calls.timers.length], [0, 0, 0, 0, 0]);
  assert.equal(c.view().on, false);
});

await test('picking never fires: position and effect are set, then fire() puts the report card up (180 s, the line), logs the stamp and keeps the console’s Position', async () => {
  const { host, calls } = makeHost({ on: { 'spine.sizer': false }, lines: [] });
  const c = St.create(host);
  assert.equal(c.view().draft.effect, 'standard', 'standard until another is picked');
  assert.equal(await c.draft('pos', 'desperate'), false, 'a position stamps nothing');
  assert.deepEqual(calls.show, []); assert.deepEqual(calls.pos, ['desperate']);
  c.draft('text', '  The guard   turns round\n'); assert.equal(c.view().draft.text, 'The guard turns round');
  assert.equal(await c.draft('eff', 'great'), false, 'an effect stamps nothing either');
  assert.deepEqual(calls.show, []); assert.equal(c.view().draft.effect, 'great');
  assert.equal(await c.fire(), true);
  assert.equal(calls.show.length, 1); assert.deepEqual(calls.show[0].payload, { position: 'desperate', effect: 'great', text: 'The guard turns round' });
  assert.equal(Show.payloadOk('report', calls.show[0].payload), true, 'the GM page’s own check for the kind');
  assert.deepEqual(calls.log, ['Stamp: desperate, great - The guard turns round']);
  assert.equal(calls.timers.length, 1); assert.equal(calls.timers[0].ms, 170000, 'laid again before the server’s three minutes');
  assert.equal(c.view().active.effect, 'great');
  // a bad value is no stamp
  const d = St.create(makeHost({ on: { 'spine.sizer': false } }).host);
  assert.equal(await d.stampNow('unclear', 'standard', ''), false); assert.equal(await d.stampNow('risky', 'huge', ''), false);
  assert.equal(await d.draft('eff', 'huge'), false); assert.equal(d.view().draft.effect, 'standard', 'an unknown effect is not set');
});

await test('one position: fire() stamps the console’s Position as it is now; with none of the three it asks for one', async () => {
  const a = makeHost(); const c = St.create(a.host);
  assert.equal(c.view().draft.position, 'risky', 'the console’s position, untouched');
  a.setPos('controlled'); assert.equal(c.view().draft.position, 'controlled', 'it follows the console');
  assert.equal(await c.fire(), true); assert.equal(a.calls.show[0].payload.position, 'controlled');
  const b = makeHost({ pos: '' });
  const d = St.create(b.host);
  assert.equal(await d.fire(), false); assert.deepEqual(b.calls.toast[0], ['Pick a position first.', true]);
});

await test('the Roll’s one line (host.line): fire() and a bare cue stamp it; a cue’s own line becomes the line', async () => {
  const m = makeHost({ line: 'Dov Kessler turns round.', on: { 'spine.sizer': false } }); const c = St.create(m.host);
  assert.equal(c.view().draft.text, 'Dov Kessler turns round.', 'the draft is the page’s line');
  await c.fire(); assert.equal(m.calls.show[0].payload.text, 'Dov Kessler turns round.');
  assert.deepEqual(m.calls.setLine, [], 'stamping the line as it is writes nothing back');
  await c.stampNow('desperate', 'limited', ''); assert.equal(m.calls.show[1].payload.text, 'Dov Kessler turns round.', '"Blade, desperate, limited": the Roll’s line');
  await c.stampNow('risky', 'standard', 'the lights fail'); assert.equal(m.calls.show[2].payload.text, 'the lights fail');
  assert.deepEqual(m.calls.setLine, ['the lights fail'], 'a cue’s line becomes the Roll’s line (one field, one value)');
  c.draft('text', 'typed  here'); assert.deepEqual(m.calls.setLine.slice(-1), ['typed here'], 'a typed line goes to the page');
  assert.equal(c.seed(), false, 'the page prefills its own line: seed() leaves it alone');
});

await test('Stamp again: the view says the stamp is stale once the position, the effect or the line set now differs from what is up', async () => {
  const m = makeHost({ line: 'Dov Kessler turns round.' }); const c = St.create(m.host);
  await c.fire(); assert.equal(c.view().stale, false);
  m.setLineText('Dov Kessler shouts.'); assert.equal(c.view().stale, true, 'the line changed');
  m.setLineText('Dov Kessler turns round.'); assert.equal(c.view().stale, false);
  await c.draft('eff', 'limited'); assert.equal(c.view().stale, true, 'the effect changed');
  await c.draft('eff', 'standard'); m.setPos('desperate'); assert.equal(c.view().stale, true, 'the position changed');
  await c.fire(); assert.equal(c.view().stale, false, 'stamped again: what is up is what is set');
  assert.equal(c.view().active.position, 'desperate');
});

await test('no key listener: Esc reaches the stamp through the page’s one Esc (gm/esc.js), registered as kind stamp', async () => {
  const m = makeHost(); const c = St.create(m.host);
  await c.fire(); await c.esc(); await c.fire();
  assert.equal(m.calls.keyListeners, 0, 'the stamp never adds a document listener');
  Esc.reset();
  Esc.register('stamp', { priority: 10, kind: 'stamp', isOpen: () => !!c.view().active, close: () => { c.esc(); } });
  let panics = 0; const ctx = { field: null, isField: () => false, panic: () => { panics++; } };
  assert.equal(Esc.handle(ctx), 'stamp', 'up: Esc takes it down'); await new Promise((r) => setImmediate(r));
  assert.equal(c.view().active, null); assert.equal(m.calls.clear, 2, 'the second card came down too');
  assert.equal(Esc.handle(ctx), 'panic', 'down: the next Esc is PANIC'); assert.equal(panics, 1);
  Esc.reset();
});

await test('a refused beat (a hidden name, the gate) leaves no stamp up and nothing logged', async () => {
  const { host, calls } = makeHost({ refuse: true });
  const c = St.create(host);
  assert.equal(await c.stampNow('risky', 'standard', 'GM-ONLY-NPC-1 is behind you'), false);
  assert.equal(c.view().active, null); assert.deepEqual(calls.log, []); assert.equal(calls.timers.length, 0);
});

await test('Esc and Clean take the card down only while the overlay up is the stamp’s own, and never touch the layers; Esc keeps what is set, a resolved roll is standard again', async () => {
  const m = makeHost(); const c = St.create(m.host);
  await c.draft('eff', 'great'); await c.stampNow('risky', 'great', 'x'); assert.equal(m.calls.clear, 0);
  await c.esc(); assert.equal(m.calls.clear, 1); assert.equal(c.view().active, null);
  assert.equal(c.view().draft.effect, 'great', 'Esc: what is set stays, to go up again');
  const n = makeHost(); const e = St.create(n.host);
  await e.stampNow('risky', 'standard', 'x'); n.setOverlay('some-other-beat');
  await e.esc(); assert.equal(n.calls.clear, 0, 'someone else’s beat is left alone');
  const o = makeHost(); const f = St.create(o.host);
  await f.stampNow('controlled', 'great', ''); await f.mark('clean'); assert.equal(o.calls.clear, 1); assert.equal(f.view().sizer, null, 'clean offers no consequence');
  assert.equal(f.view().draft.effect, 'standard', 'the roll is resolved: the effect is standard again');
});

await test('the card is laid again before the server’s three minutes while it is pending, with a new id; not once something else is up', async () => {
  const m = makeHost(); const c = St.create(m.host);
  await c.stampNow('risky', 'standard', 'x');
  const first = m.calls.show[0].key;
  m.calls.timers[0].fn(); await new Promise((r) => setImmediate(r));
  assert.equal(m.calls.show.length, 2); assert.notEqual(m.calls.show[1].key, first);
  assert.equal(m.calls.timers.length, 2, 'and scheduled again');
  m.setOverlay('other'); m.calls.timers[1].fn(); await new Promise((r) => setImmediate(r));
  assert.equal(m.calls.show.length, 2, 'not laid over something else');
});

await test('the sizer: a 4/5 or a 1-3 marked on a stamped roll offers the consequence at FULL size for the stamped position, with the stamped line and the room’s', async () => {
  const m = makeHost(); const c = St.create(m.host);
  assert.equal(c.seed(), true); assert.equal(c.view().draft.text, 'Wren Tully looks up from the bar.', 'without a line of the page’s own, 1.4 still pre-fills 1.3’s line');
  await c.draft('pos', 'desperate'); await c.draft('eff', 'limited'); await c.fire();
  assert.equal(c.view().active.text, 'Wren Tully looks up from the bar.');
  await c.mark('13');
  assert.equal(m.calls.clear, 1, 'the card comes down');
  const z = c.view().sizer;
  assert.deepEqual([z.stamped, z.shown, z.reduced, z.canReduce, z.result, z.text], ['desperate', 'desperate', false, true, '13', 'Wren Tully looks up from the bar.']);
  assert.deepEqual(z.size, { position: 'desperate', severity: 'severe', ticks: '4 ticks', harm: '3' });
  assert.deepEqual(z.lines, ['Wren Tully looks up from the bar.', 'A tray of glasses hits the floor']);
  assert.equal(c.view().draft.effect, 'standard', 'the roll is resolved');
});

await test('a typed line is never replaced by the seed; the seed is not re-applied once the GM clears the box', async () => {
  const m = makeHost(); const c = St.create(m.host);
  c.draft('text', 'My own line'); assert.equal(c.seed(), false); assert.equal(c.view().draft.text, 'My own line');
  const d = St.create(makeHost({ lines: [] }).host); assert.equal(d.seed(), false);
});

await test('reducing takes a second, deliberate tap: the first arms (and lapses), the second shows the next size down; Restore returns to full', async () => {
  const m = makeHost(); const c = St.create(m.host);
  await c.stampNow('risky', 'standard', 'x'); await c.mark('45');
  assert.equal(c.reduce(), false, 'the first tap only arms'); assert.equal(c.view().sizer.armed, true); assert.equal(c.view().sizer.reduced, false);
  assert.equal(c.view().sizer.size.severity, 'moderate', 'still full size');
  const arm = m.calls.timers.filter((t) => t.ms === 6000)[0]; arm.fn(); assert.equal(c.view().sizer.armed, false, 'it lapses');
  c.reduce(); assert.equal(c.reduce(), true);
  const z = c.view().sizer; assert.deepEqual([z.reduced, z.shown, z.size.severity, z.stamped], [true, 'controlled', 'lesser', 'risky']);
  assert.equal(c.restore(), true); assert.equal(c.view().sizer.size.severity, 'moderate');
  c.dismiss(); assert.equal(c.view().sizer, null);
  // the smallest has nothing below it
  const d = St.create(makeHost().host); await d.stampNow('controlled', 'standard', ''); await d.mark('45');
  assert.equal(d.view().sizer.canReduce, false); assert.equal(d.reduce(), false);
});

await test('sizer off: marking the result takes the card down and offers nothing', async () => {
  const m = makeHost({ on: { 'spine.sizer': false } }); const c = St.create(m.host);
  await c.stampNow('risky', 'standard', 'x'); await c.mark('45');
  assert.equal(c.view().sizer, null); assert.equal(m.calls.clear, 1);
  assert.equal(c.seed(), false);
});

await test('marking with no stamp up offers nothing (the Roll always has a position: the size belongs to the stamped promise); the effect is standard again', async () => {
  const m = makeHost(); const c = St.create(m.host);
  assert.equal(await c.mark('45'), false); assert.equal(c.view().sizer, null);
  await c.draft('pos', 'desperate'); await c.draft('eff', 'great');
  assert.equal(await c.mark('13'), false); assert.equal(c.view().sizer, null, 'a position alone offers no size');
  assert.equal(c.view().draft.effect, 'standard'); assert.equal(m.calls.clear, 0, 'and nothing is taken down');
});

/* ---------- RK02 (stamp.brief): a stamp leaves the iPad after 10 s ---------- */
/* a host with a clock and a scheduler the test drives. The stored overlay keeps its id after the server lets it go, as the page's AM.doc does. */
function makeBriefHost(over = {}) {
  const calls = { show: [], clear: 0, log: [], toast: [], changed: 0, stamped: 0, threat: 0 };
  let t = 1700000000000, overlay = '', covered = false, tid = 0, timers = [];
  const on = Object.assign({ 'spine.stamp': true, 'spine.sizer': true, 'stamp.brief': true }, over.on || {});
  const host = {
    feature: (id) => !!on[id], positions: () => POSITIONS, roomLines: () => ['Dov Kessler turns round.'], currentPosition: () => 'risky', setPosition: () => {},
    line: () => 'Dov Kessler turns round.', setLine: () => {},
    show: async (payload, key, ms, o) => {
      const call = { payload, key, ms, replace: !!(o && o.replace) }; calls.show.push(call);
      if (over.refuse && over.refuse(call)) return null;
      overlay = Show.idFor(key); return { ok: true };
    },
    keyFor: (k) => Show.idFor(k), overlayId: () => overlay, clearOverlay: async () => { calls.clear++; overlay = ''; return {}; },
    who: () => 'Nell Arbuthnot', covered: () => covered, vet: () => true, againBlocked: () => (over.blocked ? over.blocked() : ''),
    log: (x) => calls.log.push(x), toast: (m, bad) => calls.toast.push([m, !!bad]), now: () => t, changed: () => { calls.changed++; },
    threat: () => { calls.threat++; }, stamped: () => { calls.stamped++; },
    setTimeout: (fn, ms) => { const h = ++tid; timers.push({ h, at: t + ms, ms, fn }); return h; }, clearTimeout: (h) => { timers = timers.filter((x) => x.h !== h); }
  };
  /* advance the clock, running each timer when it falls due (and the ones those set) */
  async function advance(ms) {
    const to = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= to).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due); t = Math.max(t, due.at); due.fn(); await Promise.resolve(); await Promise.resolve();
    }
    t = to; await Promise.resolve();
  }
  return { host, calls, on, advance, cover: (v) => { covered = v; }, timers: () => timers.map((x) => x.ms), set: (v) => { overlay = v; } };
}
async function briefStamp(over) { const m = makeBriefHost(over); const c = St.create(m.host); assert.equal(await c.fire(), true); return { ...m, c }; }

await test('RK02 on: the stamp is laid for 10 s (not 180 s) with the same payload, and nothing lays it again however long the roll takes', async () => {
  const { c, calls, advance, timers } = await briefStamp();
  assert.equal(calls.show.length, 1); assert.equal(calls.show[0].ms, 10000);
  assert.deepEqual(calls.show[0].payload, { position: 'risky', effect: 'standard', text: 'Dov Kessler turns round.' });
  assert.notEqual(Show.overlayFor('report', calls.show[0].payload, { id: 'x', ms: calls.show[0].ms }), null, 'the GM page takes 10 s for a report');
  assert.ok(!timers().includes(170000), 'no 170 s refresh is scheduled');
  await advance(600000);
  assert.equal(calls.show.length, 1, 'ten minutes on: still one write, never laid again');
  assert.equal(calls.clear, 0, 'and nothing is cleared: the server lets it go');
  assert.equal(c.view().active.position, 'risky', 'the Roll still has its stamp');
});

await test('RK02 off, same host: 180 s and the 170 s refresh, as today; the view carries no left and no gone, and Show again does nothing', async () => {
  const { c, calls, advance, timers } = await briefStamp({ on: { 'stamp.brief': false } });
  assert.equal(calls.show[0].ms, 180000); assert.deepEqual(timers(), [170000]);
  await advance(171000); assert.equal(calls.show.length, 2, 'laid again at 170 s'); assert.equal(calls.show[1].ms, 180000);
  const v = c.view(); assert.equal(v.gone, undefined); assert.equal(v.active.left, undefined);
  assert.equal(typeof c.again, 'function'); assert.equal(await c.again(), false);
  await advance(2000000); assert.equal(c.view().gone, undefined, 'never gone by the clock');
});

await test('RK02: the Roll counts the seconds down (view().active.left), says gone at 10 s, and keeps the stamp line until the roll resolves', async () => {
  const { c, calls, advance } = await briefStamp();
  assert.equal(c.view().active.left, 10); assert.equal(c.view().gone, undefined);
  const n0 = calls.changed;
  await advance(3000); assert.equal(c.view().active.left, 7); assert.ok(calls.changed >= n0 + 3, 'the Roll is redrawn each second');
  await advance(6900); assert.equal(c.view().active.left, 1); assert.equal(c.view().gone, undefined, 'still up at 9.9 s');
  await advance(200);
  assert.equal(c.view().gone, true, 'gone at 10 s'); assert.equal(c.view().active.left, undefined);
  assert.equal(c.view().active.position, 'risky'); assert.equal(c.view().active.text, 'Dov Kessler turns round.');
  const n1 = calls.changed; await advance(5000); assert.equal(calls.changed, n1, 'nothing redraws on an idle Roll once it has gone');
});

await test('RK02: Esc and Take it down while it is up clear the overlay; once it has gone they clear only the Roll’s line (no write to the iPad)', async () => {
  const a = await briefStamp(); await a.advance(4000);
  await a.c.esc(); assert.equal(a.calls.clear, 1, 'early Esc takes it down'); assert.equal(a.c.view().active, null);
  const b = await briefStamp(); await b.advance(11000); assert.equal(b.c.view().gone, true);
  await b.c.clear(); assert.equal(b.calls.clear, 0, 'gone: nothing to take down'); assert.equal(b.c.view().active, null);
});

await test('RK02: Show again lays the same report for another 10 s under a new id, logs and asks Blade nothing more; only a gone stamp can be shown again', async () => {
  const { c, calls, advance } = await briefStamp();
  assert.equal(await c.again(), false, 'still up: nothing to show again'); assert.equal(calls.show.length, 1);
  await advance(10500); assert.equal(c.view().gone, true);
  assert.equal(await c.again(), true);
  assert.equal(calls.show.length, 2); assert.equal(calls.show[1].ms, 10000); assert.equal(calls.show[1].replace, false);
  assert.notEqual(calls.show[1].key, calls.show[0].key, 'a new id: the server shows it');
  assert.deepEqual(calls.show[1].payload, calls.show[0].payload);
  assert.equal(c.view().gone, undefined); assert.equal(c.view().active.left, 10);
  assert.equal(calls.log.length, 1, 'one Stamp line in the night log'); assert.equal(calls.stamped, 1, 'one fit asked'); assert.equal(calls.threat, 1, 'one glyph');
  await advance(10500); assert.equal(c.view().gone, true, 'and it goes again after 10 s'); assert.equal(calls.show.length, 2, 'never laid a third time by itself');
  assert.equal(await c.again(), true); assert.equal(calls.show.length, 3, 'as often as the GM asks');
});

await test('RK02: Show again that the iPad refuses changes nothing and says so; it never punches through PANIC, Blank, the hard start or a frozen iPad', async () => {
  const m = makeBriefHost(); const c = St.create(m.host); await c.fire(); await m.advance(11000);
  m.cover(true); assert.equal(await c.again(), false, 'a blank iPad or PANIC (covered)'); assert.equal(m.calls.show.length, 1); assert.equal(m.calls.toast.length, 1); assert.equal(m.calls.toast[0][1], true);
  assert.ok(/blank|PANIC/.test(m.calls.toast[0][0]), 'and says why: ' + m.calls.toast[0][0]); assert.equal(c.view().gone, true, 'still gone, still on the Roll');
  m.cover(false); assert.equal(await c.again(), true, 'clear again: it goes up'); assert.equal(m.calls.show.length, 2);
  for (const why of ['the hard start is running', 'the iPad is frozen', 'PANIC is on']) {
    const b = makeBriefHost({ blocked: () => why }); const e = St.create(b.host); await e.fire(); await b.advance(11000);
    assert.equal(await e.again(), false, why); assert.equal(b.calls.show.length, 1); assert.ok(b.calls.toast[0][0].indexOf(why) >= 0, 'the toast names it'); assert.equal(e.view().gone, true);
  }
  const n = makeBriefHost({ refuse: (call) => call.key.indexOf('stamp-2-') === 0 }); const d = St.create(n.host); await d.fire(); await n.advance(11000);
  assert.equal(await d.again(), false); assert.equal(n.calls.show.length, 2); assert.equal(d.view().gone, true, 'refused: still gone, as it was');
  assert.equal(n.calls.toast.length, 1);
  assert.equal(await St.create(makeBriefHost().host).again(), false, 'no stamp, nothing to show');
});

await test('RK02: a roll marked after the stamp has gone resolves as a roll with no card up: no clear is written, and a 4/5 still offers the size', async () => {
  const { c, calls, advance } = await briefStamp(); await advance(15000);
  assert.equal(await c.mark('45'), true);
  assert.equal(calls.clear, 0, 'it was already off the iPad'); assert.equal(c.view().active, null);
  assert.equal(c.view().sizer.stamped, 'risky'); assert.equal(c.view().sizer.result, '45', 'the size belongs to the stamped promise');
  const up = await briefStamp(); await up.advance(2000); await up.c.mark('13');
  assert.equal(up.calls.clear, 1, 'marked while up: taken down, as today');
});

await test('RK02 + kit.stage: a result recorded after the stamp has gone still lays its own 8 s beat; it folds after 8 s', async () => {
  const { c, calls, advance } = await briefStamp({ on: { 'kit.stage': true } }); await advance(20000);
  assert.equal(c.view().gone, true);
  assert.equal(await c.mark('45'), true);
  const r = calls.show[calls.show.length - 1];
  assert.equal(calls.show.length, 2); assert.equal(r.ms, 8000); assert.equal(r.replace, true); assert.equal(r.payload.result, '45'); assert.equal(r.key, calls.show[0].key);
  assert.equal(c.view().active.result, '45'); assert.equal(c.view().gone, undefined, 'a result beat is up, not gone'); assert.ok(c.view().cost, 'the cost field is offered');
  await advance(8500); assert.equal(c.view().active, null, 'folded after 8 s');
  const k = await briefStamp({ on: { 'kit.stage': true } }); await k.advance(20000); await k.c.mark('clean');
  assert.equal(k.calls.show[1].payload.result, 'clean'); assert.equal(k.calls.show[1].ms, 8000);
});

await test('RK02 + kit.stage: a result marked while the card is up is the same 8 s beat as today; over a different show, or a blank iPad, it is today’s plain mark', async () => {
  const a = await briefStamp({ on: { 'kit.stage': true } }); await a.advance(3000); await a.c.mark('13');
  assert.equal(a.calls.show[1].ms, 8000); assert.equal(a.calls.show[1].replace, true);
  const b = await briefStamp({ on: { 'kit.stage': true } }); await b.advance(20000); b.set('some-other-show'); await b.c.mark('45');
  assert.equal(b.calls.show.length, 1, 'another show took over: nothing laid');
  const d = await briefStamp({ on: { 'kit.stage': true } }); await d.advance(20000); d.cover(true); await d.c.mark('45');
  assert.equal(d.calls.show.length, 1, 'PANIC or blank: nothing laid');
});

await test('RK02 + kit.stage: the cost field has no 8 s cut-off: it stays open, with its draft, until the next stamp, Clean, another show or PANIC; Enter lays its own 10 s cost beat', async () => {
  const { c, calls, advance } = await briefStamp({ on: { 'kit.stage': true } }); await advance(2000);
  await c.mark('45'); assert.ok(c.view().cost); c.costDraft('a favour is owed');
  await advance(60000);
  assert.ok(c.view().cost, 'a minute on, the card long gone: the field is still open'); assert.equal(c.view().cost.draft, 'a favour is owed', 'with what was typed');
  assert.equal(calls.show.length, 2, 'and nothing was laid by itself');
  assert.equal(await c.sendCost(), true, 'Enter after the card has gone lays a cost beat of its own');
  const s = calls.show[calls.show.length - 1]; assert.equal(s.ms, 10000); assert.equal(s.payload.cost, 'a favour is owed'); assert.equal(s.payload.result, '45'); assert.equal(s.replace, true);
  assert.equal(c.view().cost.sent, 'a favour is owed'); await advance(30000); assert.ok(c.view().cost, 'it stays open after its own 10 s too');
  c.costDraft('and a debt'); assert.equal(await c.sendCost(), true, 'and can be changed and sent again'); assert.equal(calls.show.length, 4);
  await c.mark('clean'); assert.equal(c.view().cost, undefined, 'Clean ends it');
  const a2 = await briefStamp({ on: { 'kit.stage': true } }); await a2.c.mark('13'); await a2.advance(30000); assert.ok(a2.c.view().cost);
  a2.set('some-other-show'); await a2.advance(1500); assert.equal(a2.c.view().cost, undefined, 'another show taking over ends it');
  const b2 = await briefStamp({ on: { 'kit.stage': true } }); await b2.c.mark('13'); await b2.advance(30000); assert.ok(b2.c.view().cost);
  assert.equal(await b2.c.fire(), true); assert.equal(b2.c.view().cost, undefined, 'the next stamp ends it');
  const p = await briefStamp({ on: { 'kit.stage': true } }); await p.c.mark('13'); await p.advance(30000); p.cover(true); await p.advance(1500);
  assert.equal(p.c.view().cost, undefined, 'PANIC or Blank ends it'); assert.equal(await p.c.sendCost('late'), false); assert.equal(p.calls.show.length, 2, 'and nothing is laid over it');
  /* a result laid at 9 s is the beat up until 17 s: the field is open then too (and, with no cut-off, after) */
  const w = await briefStamp({ on: { 'kit.stage': true } }); await w.advance(9000); await w.c.mark('45'); await w.advance(4000);
  assert.ok(w.c.view().cost, 'open at 13 s');
  await w.c.esc(); assert.equal(w.calls.clear, 1, 'and Esc at 13 s takes the result beat down: it carries its own end, not the stamp card (which ran out at 10 s)');
  /* the setting off: the stored id alone says it is up, and the field stays, as today */
  const o = await briefStamp({ on: { 'kit.stage': true, 'stamp.brief': false } }); await o.advance(2000); await o.c.mark('45'); await o.advance(9000);
  assert.ok(o.c.view().cost, 'off: the field stays, as today'); assert.equal(await o.c.sendCost('late'), true);
});

await test('RK02: a stamp keeps the clock it was laid with (the setting is read at each lay); a second stamp replaces the first and starts its own 10 s', async () => {
  const { c, calls, advance, on } = await briefStamp();
  on['stamp.brief'] = false; await advance(11000);
  assert.equal(c.view().gone, true, 'laid with it on: gone at 10 s even if it is switched off since');
  on['stamp.brief'] = true;
  await advance(500); assert.equal(await c.fire(), true); assert.equal(calls.show.length, 2); assert.equal(c.view().gone, undefined); assert.equal(c.view().active.left, 10);
  assert.equal(calls.log.length, 2, 'a new stamp is logged');
  await advance(4000); assert.equal(await c.fire(), true); assert.equal(c.view().active.left, 10, 'Stamp again: its own 10 s');
});

await test('RK02: destroy stops the clock (no redraw after the page is gone)', async () => {
  const { c, calls, advance, timers } = await briefStamp(); c.destroy(); assert.deepEqual(timers(), []); const n = calls.changed; await advance(12000); assert.equal(calls.changed, n);
});

await test('RK02: both Rolls draw it: "Gone from the iPad" with Show again, Clear and Clean (one Primary); up, the seconds; off, today’s markup', async () => {
  const Roll = require(path.join(ROOT, 'app', 'gm', 'roll.js')), Ui = require(path.join(ROOT, 'app', 'ui', 'ui.js')), KR = require(path.join(ROOT, 'app', 'gm', 'kit', 'roll.js'));
  KR._ui = Ui; KR._old = Roll;
  const act = { position: 'risky', effect: 'standard', text: 'x' }, base = { on: true, draft: { position: 'risky', effect: 'standard', text: 'x' }, sizer: null, stale: false };
  for (const [name, R] of [['old desk', Roll], ['kit desk', KR]]) {
    const up = R.stampHtml(Object.assign({}, base, { active: Object.assign({ left: 7 }, act) }));
    assert.ok(/On the iPad/.test(up) && /7 s/.test(up) && /data-gm="stamp-down"/.test(up) && !/stamp-again/.test(up), name + ' up: the seconds and Take it down');
    const gone = R.stampHtml(Object.assign({}, base, { active: act, gone: true }));
    assert.ok(/Gone from the iPad/.test(gone) && !/On the iPad/.test(gone), name + ' gone: says so');
    assert.ok(/data-gm="stamp-again"[^>]*>(?:<span[^>]*>)?Show again/.test(gone), name + ': Show again');
    assert.ok(/data-gm="stamp-down"[^>]*>(?:<span[^>]*>)?Clear/.test(gone) && /data-gm="stamp-clean"/.test(gone), name + ': Clear and Clean stay');
    assert.equal((gone.match(/(?:btn|ui-btn)[^"]*primary/g) || []).length, 1, name + ': one Primary');
    const tagOf = (h) => (h.match(/<button[^>]*data-gm="stamp-again"[^>]*>/) || [''])[0];
    assert.ok(/primary/.test(tagOf(gone)), name + ': Show again is the Primary');
    const stale = R.stampHtml(Object.assign({}, base, { active: act, gone: true, stale: true }));
    assert.ok(/data-gm="stamp"[^>]*>(?:<span[^>]*>)?Stamp again/.test(stale) && !/primary/.test(tagOf(stale)), name + ' changed since: Stamp again offered, Show again is not Primary');
    assert.equal((stale.match(/(?:btn|ui-btn)[^"]*primary/g) || []).length, 1, name + ' changed since: still one Primary');
    const off = R.stampHtml(Object.assign({}, base, { active: act }));
    assert.ok(/On the iPad/.test(off) && !/\d s</.test(off) && !/Gone|stamp-again/.test(off), name + ' off: no seconds, no Gone');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
