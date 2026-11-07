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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
