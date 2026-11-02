// Turning a key and the key cabinet (suite 1.8 and 5.6): app/sheet/keys.js (pure parts, drawing), app/gm/keyturn.js, and the keyturn payload the Worker takes.
// INVENTED data only; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/sheet-keys.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanShowPayload } from '../../functions/_lib/show.js';
const require = createRequire(import.meta.url);
const SK = require('../../app/sheet/keys.js');
const GK = require('../../app/gm/keyturn.js');
const F = require('../../app/features.js');

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mk = () => ({ stress: 6, keys: [{ name: 'KEY-1', down: 'Reversed word', up: 'Intensified word', hits: 3 }, { name: 'KEY-2', down: 'd', up: 'u', hits: 2 }, { name: 'KEY-3', down: 'd', up: 'u', hits: 3, deadlock: 'up' }] });
const ctx = (play, over) => ({ esc, input: (p, v) => '<input data-path="' + p + '" value="' + esc(v) + '">', pipRow: (n, f, a) => '<pips ' + a + ' ' + f + '/' + n + '>', play, pb: {}, ui: {}, commit() {}, note() {}, confirm: () => true, now: () => Date.UTC(2026, 10, 3, 9, 0, 0), turn: true, ...over });

test('both switches are registered, default off, phone surface, bland', () => {
  for (const id of ['spine.keyturn', 'between.keys']) { const s = F.get(id); assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.surface, 'phone'); }
  assert.deepEqual(F.publicIds().filter((i) => /keyturn|keys/.test(i)).sort(), ['between.keys', 'spine.keyturn']);
});
test('canTurn: three hits, not struck, not a glitch playbook', () => {
  const p = mk();
  assert.equal(SK.canTurn(p.keys[0], {}), true);
  assert.equal(SK.canTurn(p.keys[1], {}), false, 'two hits offers nothing');
  assert.equal(SK.canTurn(p.keys[2], {}), false, 'a struck key');
  for (const flag of ['ghost', 'timetraveler', 'vampire']) assert.equal(SK.canTurn(p.keys[0], { [flag]: true }), false, flag);
  assert.equal(SK.canTurn({ hits: 3, glitch: 'x' }, {}), false);
  assert.equal(SK.canTurn(null, {}), false);
});
test('turn: deadlocks the key, clears Stress, owes a critical, records the turn', () => {
  const p = mk(), r = SK.turn(p, 0, 'down', Date.UTC(2026, 10, 3, 9, 0, 0));
  assert.deepEqual(r, { name: 'KEY-1', word: 'Reversed word', dir: 'down', seq: 1 });
  assert.equal(p.keys[0].deadlock, 'down'); assert.equal(p.stress, 0);
  assert.equal(p.autoCrit.name, 'KEY-1'); assert.equal(p.keyTurn.seq, 1); assert.equal(p.keyTurn.at, '2026-11-03T09:00:00.000Z');
  assert.equal(SK.turn(p, 0, 'up'), null, 'a turned key cannot be turned again');
  const q = mk(); q.keys[1].hits = 3; assert.equal(SK.turn(q, 1, 'up').seq, 1); q.keys[0].hits = 3;
  q.keyTurn.seq = 4; assert.equal(SK.turn(q, 0, 'down').seq, 5, 'the sequence counts on');
  assert.equal(SK.turn(mk(), 1, 'up'), null, 'under three hits does nothing');
  assert.equal(SK.turn(mk(), 0, 'sideways'), null);
  assert.equal(SK.turn(mk(), 0, 'up', 0, { ghost: true }), null);
});
test('autoCrit makes the roll a critical, once', () => {
  const p = mk(); SK.turn(p, 0, 'up');
  const res = { dice: [2, 3], value: 3, crit: false, reading: 'failure', n: 2 };
  assert.equal(SK.autoCrit(res, p), true);
  assert.deepEqual([res.dice, res.crit, res.reading, res.auto], [[6, 6], true, 'critical', true]);
  assert.equal(p.autoCrit, undefined);
  assert.equal(SK.autoCrit({ dice: [1] }, p), false);
});
test('the offer says nothing for a key under three hits', () => {
  const p = mk(); p.keys[0].hits = 2;
  assert.equal(SK.offer(ctx(p)), '');
  p.keys[0].hits = 3;
  const h = SK.offer(ctx(p));
  assert.ok(/You can turn this key/.test(h) && /data-act="kturn"/.test(h) && /KEY-1/.test(h) && !/KEY-2/.test(h));
  assert.equal(SK.offer(ctx(p, { turn: true, pb: { ghost: true } })), '');
});
test('the cabinet draws a card per key, a flip shows both deadlocks, a struck key shows its deadlock', () => {
  const p = mk(), h = SK.cards(ctx(p));
  assert.equal((h.match(/class="ds-kcard/g) || []).length, 3);
  assert.ok(/ds-kcard full/.test(h) && /ds-kcard locked/.test(h) && /1 more hit to turn it/.test(h) && /Deadlocked: ▲ u/.test(h));
  assert.ok(!/ds-kc-dl/.test(h));
  const back = SK.cards(ctx(p, { ui: { keyFlip: { 0: true } } }));
  assert.ok(/Reversed<\/span>/.test(back) && /Intensified<\/span>/.test(back) && /keys\.0\.down/.test(back) && /keys\.0\.up/.test(back));
  assert.ok(!/data-act="kturn"/.test(SK.cards(ctx(p, { turn: false }))), 'no turn button with spine.keyturn off');
});
test('act: flip toggles; turn asks first and refuses a key under three hits', () => {
  const p = mk(), c = ctx(p);
  assert.equal(SK.act('kflip', { i: '0' }, c), true); assert.equal(c.ui.keyFlip[0], true);
  SK.act('kflip', { i: '0' }, c); assert.equal(c.ui.keyFlip[0], undefined);
  c.confirm = () => false; SK.act('kturn', { i: '0', dir: 'down' }, c); assert.equal(p.keys[0].deadlock, undefined, 'declined');
  c.confirm = () => true; SK.act('kturn', { i: '1', dir: 'down' }, c); assert.equal(p.keys[1].deadlock, undefined);
  SK.act('kturn', { i: '0', dir: 'up' }, c); assert.equal(p.keys[0].deadlock, 'up');
  assert.equal(SK.act('other', {}, c), false);
});
test('GM: a fresh turn fires one card, keyed by character and seq; a stale or repeated one does not', () => {
  GK.reset();
  const now = Date.UTC(2026, 10, 3, 9, 0, 30), shown = [], toasts = [];
  const host = (pcs) => ({ pcs: () => pcs, show: (k, p, o) => { shown.push([k, p, o]); return Promise.resolve(true); }, toast: (m) => toasts.push(m), now: () => now });
  const pc = { id: 'c1', name: 'Nell Arbuthnot', keyTurn: { seq: 1, name: 'KEY-1', word: 'Reversed word', dir: 'down', at: '2026-11-03T09:00:00.000Z' } };
  assert.equal(GK.sync(host([pc])).length, 1);
  assert.deepEqual(shown[0], ['keyturn', { label: 'KEY-1', pc: 'Nell Arbuthnot', to: 'Reversed: Reversed word', crit: true }, { key: 'c1-1' }]);
  assert.equal(GK.sync(host([pc])).length, 0, 'the same turn twice');
  assert.equal(GK.sync(host([{ id: 'c2', name: 'Odo', keyTurn: { ...pc.keyTurn, at: '2026-11-03T08:00:00.000Z' } }])).length, 0, 'an old turn is marked seen, not shown');
  assert.equal(GK.sync(host([{ id: 'c1', name: 'Nell Arbuthnot', keyTurn: { ...pc.keyTurn, seq: 2 } }])).length, 1, 'the next seq fires');
  assert.equal(GK.sync(host([{ id: 'c3', name: 'No turn' }])).length, 0);
  assert.equal(shown.length, 2);
});
test('the keyturn payload: the new fields are optional, checked and mirrored', () => {
  assert.deepEqual(cleanShowPayload('keyturn', { label: 'KEY-1', pc: 'Nell Arbuthnot' }), { label: 'KEY-1', pc: 'Nell Arbuthnot' });
  assert.deepEqual(cleanShowPayload('keyturn', { label: 'KEY-1', to: ' Reversed:  x ', crit: true, stray: 1 }), { label: 'KEY-1', to: 'Reversed: x', crit: true });
  assert.deepEqual(cleanShowPayload('keyturn', { label: 'KEY-1', crit: false }), { label: 'KEY-1' });
  assert.throws(() => cleanShowPayload('keyturn', { label: 'K', crit: 'yes' }), (e) => e.status === 400);
  assert.throws(() => cleanShowPayload('keyturn', { label: 'K', to: 'x'.repeat(61) }), (e) => e.status === 400);
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
