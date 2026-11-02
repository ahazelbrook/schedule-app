// Unit test for the cue's verb registry (app/cue-verbs.js and its hooks in app/cue.js), suite ticket W0.5. A fixture verb is registered by the test and removed again:
// none ships. It goes through find() AND parse(), and every action a registered verb may return must be a type the Worker's validateActions accepts (hands.js CUE_TYPES).
// A2 fills the registry; this file is the gate its verbs pass. Invented names only.
//   node checks/runtime/gm-cue-verbs.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Cue = require(path.join(ROOT, 'app', 'cue.js'));
const V = require(path.join(ROOT, 'app', 'cue-verbs.js'));
const hands = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'assist', 'hands.js')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  V.reset();
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } finally { V.reset(); }
}
const LIVE = { clocks: [{ id: 'c1', name: 'The Fuse', size: 6, filled: 1, hidden: false }], pcs: [], rooms: [] };
const ping = () => V.register({ id: 'ping', words: ['ping', 'pings'], actionTypes: ['capture'], label: 'Ping',
  parse: (c) => (c.rest ? { action: { type: 'capture', bucket: 'moment', text: c.rest } } : { missing: 'text', draft: { type: 'capture', bucket: 'moment' } }) });

await test('with nothing registered the cue is main\'s: the registry is empty and a fixture word is not a cue', () => {
  assert.deepEqual(V.list(), []);
  assert.equal(Cue.find('Blade, ping the lamp'), null, 'ping is not a verb yet');
  assert.equal(Cue.find('Blade, tick the fuse', LIVE).verb, 'tick');
});
await test('a registered verb is found and parsed: find() names it, parse() returns its action with the quote added by cue.js', () => {
  ping();
  const f = Cue.find('Okay Blade, ping the lamp by the door'); assert.equal(f.verb, 'ping'); assert.equal(f.word, 'Blade');
  const r = Cue.parse('Blade, ping the lamp by the door.', LIVE);
  assert.equal(r.refused, null); assert.equal(r.missing, null); assert.equal(r.cue.verb, 'ping');
  assert.deepEqual(r.actions, [{ type: 'capture', bucket: 'moment', text: 'the lamp by the door', quote: 'Blade, ping the lamp by the door.' }]);
  assert.equal(Cue.parse('Blade, pings the lamp', LIVE).actions.length, 1, 'a second word of the same verb');
});
await test('a registered verb may say what it still needs (missing), and refuse', () => {
  ping();
  const m = Cue.parse('Blade, ping', LIVE); assert.equal(m.missing, 'text'); assert.deepEqual(m.actions, []); assert.deepEqual(m.draft, { type: 'capture', bucket: 'moment' });
  V.register({ id: 'nope', words: ['nope'], actionTypes: ['capture'], parse: () => ({ refused: 'nochange' }) });
  assert.equal(Cue.parse('Blade, nope that', LIVE).refused, 'nochange');
  V.register({ id: 'nul', words: ['nul'], actionTypes: ['capture'], parse: () => null });
  assert.equal(Cue.parse('Blade, nul that', LIVE).refused, 'unparsed');
});
await test('the registry checks what parse returns: an undeclared type, a key and a quote are refused, a throw is refused', () => {
  V.register({ id: 'bad1', words: ['bada'], actionTypes: ['capture'], parse: () => ({ action: { type: 'clock_tick', clock_id: 'c1', by: 1 } }) });
  V.register({ id: 'bad2', words: ['badb'], actionTypes: ['capture'], parse: () => ({ action: { type: 'capture', bucket: 'moment', text: 'x', key: 'k' } }) });
  V.register({ id: 'bad3', words: ['badc'], actionTypes: ['capture'], parse: () => ({ action: { type: 'capture', bucket: 'moment', text: 'x', quote: 'forged' } }) });
  V.register({ id: 'bad4', words: ['badd'], actionTypes: ['capture'], parse: () => { throw new Error('boom'); } });
  for (const w of ['bada', 'badb', 'badc', 'badd']) { const r = Cue.parse('Blade, ' + w + ' it', LIVE); assert.equal(r.refused, 'unparsed', w); assert.deepEqual(r.actions, [], w); }
});
await test('a registered verb cannot take a word or an id that is cue.js\'s own, nor another verb\'s; the show and sheet refusals still guard the built-ins', () => {
  for (const w of ['tick', 'make', 'note', 'undo', 'move', 'send', 'put', 'created', 'stress', 'reveal']) assert.throws(() => V.register({ id: 'z' + w, words: [w], actionTypes: ['capture'], parse() {} }), /built-in/, w);
  for (const id of ['make', 'tick', 'move', 'undo', 'sheet', 'show']) assert.throws(() => V.register({ id, words: ['zzzz'], actionTypes: ['capture'], parse() {} }), /already exists/, id);
  ping(); assert.throws(() => V.register({ id: 'pong', words: ['ping'], actionTypes: ['capture'], parse() {} }), /already belongs to ping/);
  assert.throws(() => V.register({ id: 'ping', words: ['pang'], actionTypes: ['capture'], parse() {} }), /already exists/);
  assert.equal(Cue.parse('Blade, show the map', LIVE).refused, 'show'); assert.equal(Cue.parse('Blade, stress two', LIVE).refused, 'sheet');
});
await test('register checks its definition: id, words, declared action types, a parse function', () => {
  assert.throws(() => V.register(null), /object/);
  assert.throws(() => V.register({ id: 'Bad', words: ['aa'], actionTypes: ['capture'], parse() {} }), /id/);
  assert.throws(() => V.register({ id: 'ok', words: [], actionTypes: ['capture'], parse() {} }), /at least one word/);
  assert.throws(() => V.register({ id: 'ok', words: ['two words'], actionTypes: ['capture'], parse() {} }), /single/);
  assert.throws(() => V.register({ id: 'ok', words: ['aa'], actionTypes: [], parse() {} }), /action types/);
  assert.throws(() => V.register({ id: 'ok', words: ['aa'], actionTypes: ['capture'] }), /parse/);
  assert.deepEqual(V.list(), []);
});
await test('unregister takes the word with it; list and words describe what is registered', () => {
  ping(); assert.deepEqual(V.list(), [{ id: 'ping', words: ['ping', 'pings'], actionTypes: ['capture'], label: 'Ping' }]); assert.deepEqual(V.words().sort(), ['ping', 'pings']);
  assert.equal(V.unregister('ping'), true); assert.equal(V.unregister('ping'), false); assert.equal(Cue.find('Blade, ping the lamp'), null);
});
await test('the gate A2\'s verbs pass: every action type a registered verb declares is in hands.js CUE_TYPES (the Worker would drop it otherwise); the fixture verb passes it', () => {
  ping();
  for (const v of V.list()) for (const t of v.actionTypes) assert.ok(hands.CUE_TYPES.includes(t), 'verb ' + v.id + ' declares ' + t + ', which validateActions does not accept: add it to CUE_TYPES and its branch');
  // and a registered verb's action really passes validateActions as the page sends it (a cue that parsed)
  const r = Cue.parse('Blade, ping the lamp by the door', LIVE);
  const v = hands.validateActions(r.actions, { state: { clocks: [], npcs: [], pcs: [] }, lines: [{ id: 'l1', kind: 'line', text: r.quote }], cue: { parsed: true, cueLineId: 'l1' } });
  assert.equal(v.actions.length, 1, JSON.stringify(v.dropped)); assert.equal(v.actions[0].type, 'capture');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
