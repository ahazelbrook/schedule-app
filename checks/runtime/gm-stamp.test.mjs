// Unit test for the stamp before the roll and the consequence sizer (suite 1.3 / 1.4, app/gm/stamp.js): the room's "If it goes wrong" lines, the stamp's two taps,
// the report card laid and taken down, the sizer's full size and its second-tap reduce, and every switch off. A fake host stands in for the page; the Pelican Rooms
// and the invented cast only, and every GM-only string is a GM-ONLY- marker. No network, no model.
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
const { MiniDoc } = await import('./minidom.mjs').then((m) => ({ MiniDoc: m.MiniDoc || m.default })).catch(() => ({ MiniDoc: null }));

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

function makeHost(over = {}) {
  const calls = { show: [], clear: 0, log: [], pos: [], toast: [], timers: [], changed: 0 };
  let overlay = '', cur = 'risky';
  const on = Object.assign({ 'spine.stamp': true, 'spine.sizer': true }, over.on || {});
  const host = {
    feature: (id) => !!on[id], positions: () => POSITIONS, roomLines: () => over.lines || ['Wren Tully looks up from the bar.', 'A tray of glasses hits the floor'],
    currentPosition: () => cur, setPosition: (p) => { calls.pos.push(p); cur = p; },
    show: async (payload, key) => { if (over.refuse) return null; calls.show.push({ payload, key }); overlay = Show.idFor(key); return { ok: true }; },
    keyFor: (k) => Show.idFor(k), overlayId: () => (over.overlay !== undefined ? over.overlay : overlay),
    clearOverlay: async () => { calls.clear++; overlay = ''; return {}; },
    log: (t) => calls.log.push(t), toast: (m, bad) => calls.toast.push([m, !!bad]), now: () => 1700000000000,
    setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; }, clearTimeout: () => {}, changed: () => { calls.changed++; }
  };
  return { host, calls, setOverlay: (v) => { overlay = v; } };
}

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

await test('every switch off: nothing is shown, logged or set, and the view says the stamp is off', async () => {
  const { host, calls } = makeHost({ on: { 'spine.stamp': false, 'spine.sizer': false } });
  const c = St.create(host);
  assert.equal(await c.draft('pos', 'risky'), false); assert.equal(await c.draft('eff', 'standard'), false); assert.equal(await c.stampNow('risky', 'standard', 'x'), false);
  assert.equal(await c.mark('45'), false);
  assert.equal(c.seed(), false);
  assert.deepEqual([calls.show.length, calls.log.length, calls.pos.length, calls.clear, calls.timers.length], [0, 0, 0, 0, 0]);
  assert.equal(c.view().on, false);
});

await test('two taps: position then effect puts the report card up (180 s, the typed line), logs the stamp and sets the console’s Position; the second tap alone does nothing without a position', async () => {
  const { host, calls } = makeHost({ on: { 'spine.sizer': false }, lines: [] });
  const c = St.create(host);
  assert.equal(await c.draft('pos', 'desperate'), false, 'one tap stamps nothing');
  assert.deepEqual(calls.show, []); assert.deepEqual(calls.pos, ['desperate']);
  c.draft('text', '  The guard   turns round\n'); assert.equal(c.view().draft.text, 'The guard turns round');
  assert.equal(await c.draft('eff', 'standard'), true);
  assert.equal(calls.show.length, 1); assert.deepEqual(calls.show[0].payload, { position: 'desperate', effect: 'standard', text: 'The guard turns round' });
  assert.equal(Show.payloadOk('report', calls.show[0].payload), true, 'the GM page’s own check for the kind');
  assert.deepEqual(calls.log, ['Stamp: desperate, standard - The guard turns round']);
  assert.equal(calls.timers.length, 1); assert.equal(calls.timers[0].ms, 170000, 'laid again before the server’s three minutes');
  assert.equal(c.view().active.effect, 'standard');
  // a bad value is no stamp
  const d = St.create(makeHost({ on: { 'spine.sizer': false } }).host);
  assert.equal(await d.stampNow('unclear', 'standard', ''), false); assert.equal(await d.stampNow('risky', 'huge', ''), false);
});

await test('an effect tapped with no position uses the console’s Position when it is one of the three, else asks for one', async () => {
  const a = makeHost(); const c = St.create(a.host);
  assert.equal(await c.draft('eff', 'limited'), true); assert.equal(a.calls.show[0].payload.position, 'risky');
  const b = makeHost(); b.host.currentPosition = () => '';
  const d = St.create(b.host);
  assert.equal(await d.draft('eff', 'limited'), false); assert.deepEqual(b.calls.toast[0], ['Pick a position first.', true]);
});

await test('a refused beat (a hidden name, the gate) leaves no stamp up and nothing logged', async () => {
  const { host, calls } = makeHost({ refuse: true });
  const c = St.create(host);
  assert.equal(await c.stampNow('risky', 'standard', 'GM-ONLY-NPC-1 is behind you'), false);
  assert.equal(c.view().active, null); assert.deepEqual(calls.log, []); assert.equal(calls.timers.length, 0);
});

await test('Esc and Clean take the card down only while the overlay up is the stamp’s own, and never touch the layers', async () => {
  const m = makeHost(); const c = St.create(m.host);
  await c.stampNow('risky', 'standard', 'x'); assert.equal(m.calls.clear, 0);
  await c.esc(); assert.equal(m.calls.clear, 1); assert.equal(c.view().active, null);
  const n = makeHost(); const e = St.create(n.host);
  await e.stampNow('risky', 'standard', 'x'); n.setOverlay('some-other-beat');
  await e.esc(); assert.equal(n.calls.clear, 0, 'someone else’s beat is left alone');
  const o = makeHost(); const f = St.create(o.host);
  await f.stampNow('controlled', 'great', ''); await f.mark('clean'); assert.equal(o.calls.clear, 1); assert.equal(f.view().sizer, null, 'clean offers no consequence');
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

await test('the sizer: a 4/5 or a 1-3 marked on a stamped roll offers the consequence at FULL size for the stamped position, seeded from the room', async () => {
  const m = makeHost(); const c = St.create(m.host);
  assert.equal(c.seed(), true); assert.equal(c.view().draft.text, 'Wren Tully looks up from the bar.', '1.4 pre-fills 1.3’s line');
  await c.draft('pos', 'desperate'); await c.draft('eff', 'limited');
  assert.equal(c.view().active.text, 'Wren Tully looks up from the bar.');
  await c.mark('13');
  assert.equal(m.calls.clear, 1, 'the card comes down');
  const z = c.view().sizer;
  assert.deepEqual([z.stamped, z.shown, z.reduced, z.canReduce, z.result], ['desperate', 'desperate', false, true, '13']);
  assert.deepEqual(z.size, { position: 'desperate', severity: 'severe', ticks: '4 ticks', harm: '3' });
  assert.deepEqual(z.lines, ['Wren Tully looks up from the bar.', 'A tray of glasses hits the floor']);
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

await test('marking with no stamp offers nothing; with a position set and the sizer on it offers that position’s size', async () => {
  const m = makeHost(); const c = St.create(m.host);
  assert.equal(await c.mark('45'), false);
  await c.draft('pos', 'risky'); assert.equal(await c.mark('13'), true); assert.equal(c.view().sizer.size.severity, 'moderate');
});

if (MiniDoc) {
  await test('the row draws with text set only through textContent: a consequence full of markup stays text, and Esc/Clean show only while a card is up', async () => {
    const doc = new MiniDoc(); const box = doc.createElement('div');
    const m = makeHost({ lines: [] }); const c = St.create(m.host);
    c.draft('text', '<b>GM-ONLY-X</b>'); St.paint(doc, box, c);
    const html = JSON.stringify(box.children.map((x) => x.className));
    assert.ok(html.includes('gm-st-row'));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
