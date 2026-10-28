// The co-GM's hands (C1): the `hands` seat and POST /api/gm/assist/act. The validation rules of design 5.4 one by one (hands.js), then the route on an
// in-memory D1 with a FAKE Anthropic client: no network, no key. Every name and sentence here is invented.
//   node checks/runtime/gm-assist-hands.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { CORE_SEATS, COOLDOWN_MS, canRun, budgetTier } from '../../functions/_lib/assist/conductor.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { STORY_SEATS, handsUser } from '../../functions/_lib/assist/prompts.js';
import { makeLeases, LEASE_TTL_MS, DEADLINE_MS } from '../../functions/_lib/assist/leases.js';
import { normalise, cleanRange, cleanState, cleanActBody, validateActions, actionKey, STATE_MAX_BYTES, CONFIDENCE_MIN, LINES_MAX } from '../../functions/_lib/assist/hands.js';
import { makeHandler } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-06-01T09:00:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();

// ---------- fixtures: an invented table ----------
const STATE = {
  clocks: [
    { id: 'ck1', name: 'Lamp Oil Running Low', size: 6, filled: 2, hidden: false },
    { id: 'ck2', name: 'Harbour Watch Wakes', size: 4, filled: 4, hidden: true },
    { id: 'ck3', name: 'Empty One', size: 8, filled: 0, hidden: false },
  ],
  npcs: [{ id: 'n1', name: 'Mirelle Tanager' }],
  pcs: [{ id: 'p1', name: 'Odo Vance' }],
  onStage: 'Mirelle Tanager',
};
const row = (seq, text, kind = 'line') => ({ seq, kind, text, at: iso(clock.t), session: '3', speaker: 0 });
const LINES = [
  row(1, "Right, that's going to be a six-segment clock, call it Drains Below."),
  row(2, 'Tick that once, the lamp oil is going.'),
  row(3, "The fence there? His name's Wren Alder, and he wears a green coat."),
  row(4, 'Mirelle looks at you flat.'),
];
const act = (over = {}) => ({ type: 'clock_add', quote: "that's going to be a six-segment clock", at: '09:00', confidence: 0.95, name: 'Drains Below', size: 6, hidden: false, clock_id: '', by: 0, look: '', role: '', bucket: '', text: '', who: '', action: '', position: '', effect: '', result: '', ...over });
const check = (actions, extra = {}) => validateActions(actions, { state: cleanState(STATE), lines: LINES, ...extra });
const body = async (res) => JSON.parse(await res.text());

// ---------- the seat ----------
await test('seat: Haiku 5.5 at low, 1500 tokens, no prefix; Core tier; 8 s cooldown; lease 30 s and deadline 15 s; woken by no flag', () => {
  const h = SEATS.hands;
  assert.deepEqual([h.model, h.effort, h.maxTokens, h.noPrefix], ['claude-haiku-5-5', 'low', 1500, true]);
  assert.ok(CORE_SEATS.includes('hands'));
  assert.equal(COOLDOWN_MS.hands, 8000);
  assert.equal(LEASE_TTL_MS.hands, 30_000); assert.equal(DEADLINE_MS.hands, 15_000);
  assert.ok(!Object.values(WAKES).some((f) => f.includes('hands')) && !('hands' in WAKES), 'a tick never calls it');
  assert.ok(!STORY_SEATS.includes('hands'));
  // Core: it runs at every tier but the cap
  assert.deepEqual(['all', 'reduced', 'core', 'off'].map((tier) => canRun('hands', { now: 1, tier }).ok), [true, true, true, false]);
});

await test('seat: generic instructions, and a flat schema with every field required', () => {
  const h = SEATS.hands;
  assert.ok(!/gm-private|\[\[/.test(h.instructions));
  assert.match(h.instructions, /DECIDED aloud/); assert.match(h.instructions, /Never act on a player's suggestion/); assert.match(h.instructions, /Never invent anything/);
  assert.match(h.instructions, /verbatim/); assert.match(h.instructions, /confidence from 0 to 1/); assert.match(h.instructions, /"That" and "it" mean the clock/);
  const s = h.schema, item = s.properties.actions.items;
  assert.equal(s.additionalProperties, false); assert.deepEqual(s.required, ['actions']);
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, Object.keys(item.properties), 'every field is required: a field that does not apply is empty');
  assert.deepEqual(item.properties.type.enum, ['clock_add', 'clock_tick', 'npc_add', 'capture', 'roll_log']);
  for (const k of ['anyOf', 'oneOf', 'minimum', 'maximum']) assert.ok(!JSON.stringify(s).includes('"' + k + '"'), k + ' is not used: ranges are checked in code');
});

// ---------- the request ----------
await test('request: from and to are whole numbers, from <= to, at most 200 apart; anything else is not a range', () => {
  assert.deepEqual(cleanRange(5, 5), { from: 5, to: 5 }); assert.deepEqual(cleanRange(0, 200), { from: 0, to: 200 });
  for (const [a, b] of [[5, 4], [-1, 3], [1.5, 3], ['1', 3], [1, null], [undefined, 2], [0, 201], [NaN, 1]]) assert.equal(cleanRange(a, b), null, JSON.stringify([a, b]));
});

await test('request: state is { clocks, npcs, pcs, onStage }; unknown keys go, sizes and fills are checked, the fill is held within the size', () => {
  const s = cleanState({ ...STATE, junk: 1, clocks: [{ ...STATE.clocks[0], filled: 99, extra: 'x' }] });
  assert.deepEqual(s.clocks, [{ id: 'ck1', name: 'Lamp Oil Running Low', size: 6, filled: 6, hidden: false }]);
  assert.equal(s.junk, undefined);
  assert.deepEqual(cleanState({}), { clocks: [], npcs: [], pcs: [], onStage: '' });
  const bad = [null, [], 'x', { clocks: 'x' }, { clocks: [{ id: 'a', name: 'n', size: 0, filled: 0 }] }, { clocks: [{ id: 'a', name: 'n', size: 6, filled: -1 }] }, { clocks: [{ id: 'a', name: 'n', size: 6.5, filled: 0 }] },
    { clocks: [{ id: '', name: 'n', size: 6, filled: 0 }] }, { clocks: [{ id: 'a', name: '', size: 6, filled: 0 }] }, { npcs: [{ id: 'a' }] }, { pcs: [5] }, { onStage: 5 }, { onStage: 'x'.repeat(81) },
    { clocks: Array.from({ length: 41 }, (_, i) => ({ id: 'c' + i, name: 'n', size: 4, filled: 0 })) }, { npcs: Array.from({ length: 101 }, (_, i) => ({ id: 'n' + i, name: 'n' })) }, { pcs: Array.from({ length: 13 }, (_, i) => ({ id: 'p' + i, name: 'n' })) }];
  for (const b of bad) assert.throws(() => cleanState(b), (e) => e.status === 400, JSON.stringify(b).slice(0, 60));
});

await test('request: state is at most 8 KB of UTF-8 JSON, else 400 (counted in bytes, not characters)', () => {
  const sized = (nameLen, ch) => ({ clocks: [], npcs: [{ id: 'n1', name: 'x' }], pcs: [], pad: ch.repeat(nameLen) });
  const exact = (ch, perCh) => { const base = JSON.stringify(sized(0, ch)).length; return Math.floor((STATE_MAX_BYTES - base) / perCh); };
  assert.doesNotThrow(() => cleanState(sized(exact('a', 1), 'a')), '8192 bytes of ASCII is allowed');
  assert.throws(() => cleanState(sized(exact('a', 1) + 1, 'a')), (e) => e.status === 400 && /8 KB/.test(e.message));
  // 2-byte characters: fewer characters, the same byte cap
  const n2 = exact('é', 2);
  assert.doesNotThrow(() => cleanState(sized(n2, 'é')));
  assert.throws(() => cleanState(sized(n2 + 1, 'é')), (e) => e.status === 400);
  assert.throws(() => cleanActBody({ from: 1, to: 2, state: sized(9000, 'a') }), (e) => e.status === 400);
  assert.throws(() => cleanActBody({ from: 1, to: 2 }), (e) => e.status === 400, 'no state');
  assert.throws(() => cleanActBody({ from: 3, to: 2, state: {} }), (e) => e.status === 400, 'a bad range');
  const ok = cleanActBody({ from: 1, to: 4, state: STATE, lines: [{ text: 'ignored' }] });
  assert.deepEqual(Object.keys(ok).sort(), ['from', 'state', 'to'], 'no lines come through from the page');
});

// ---------- validation (design 5.4), one rule at a time ----------
await test('rule: a clock id must be in the state that was sent; the clock\'s name rides along', () => {
  const r = check([act({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'ck1', by: 1 }), act({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'nope', by: 1 }), act({ type: 'clock_tick', quote: 'Tick that once', clock_id: '', by: 1 })]);
  assert.equal(r.actions.length, 1);
  assert.deepEqual([r.actions[0].clock_id, r.actions[0].clock_name, r.actions[0].from_filled, r.actions[0].to_filled, r.actions[0].size], ['ck1', 'Lamp Oil Running Low', 2, 3, 6]);
  assert.deepEqual(r.dropped.map((d) => d.why), ['unknown clock', 'unknown clock']);
});

await test('rule: a new clock\'s size must be 4, 6, 8, 10 or 12', () => {
  for (const size of [4, 6, 8, 10, 12]) assert.equal(check([act({ size })]).actions.length, 1, 'size ' + size);
  for (const size of [0, 1, 3, 5, 7, 9, 11, 13, 100, -6, 6.5, '6', null]) { const r = check([act({ size })]); assert.equal(r.actions.length, 0, 'size ' + size); assert.equal(r.dropped[0].why, 'illegal size'); }
  assert.equal(check([act({ name: '   ' })]).dropped[0].why, 'no name');
});

await test('rule: ticks are clamped, to -3..+6 and then to the clock; a tick with nothing left to do is dropped, not sent as zero', () => {
  const t = (clock_id, by) => check([act({ type: 'clock_tick', quote: 'Tick that once', clock_id, by })]);
  assert.equal(t('ck3', 99).actions[0].by, 6, 'ck3 is 0/8: +6 is the most one action does');
  assert.equal(t('ck1', 99).actions[0].by, 4, 'ck1 is 2/6: only four segments left');
  assert.equal(t('ck1', 99).actions[0].to_filled, 6);
  assert.equal(t('ck1', -99).actions[0].by, -2, 'ck1 is 2/6: -3 is the most, and only two can come off');
  assert.equal(t('ck1', -99).actions[0].to_filled, 0);
  assert.equal(t('ck3', -2).actions.length, 0, 'ck3 is empty: nothing to clear'); assert.equal(t('ck3', -2).dropped[0].why, 'no change');
  assert.equal(t('ck2', 1).actions.length, 0, 'ck2 is full'); assert.equal(t('ck2', 1).dropped[0].why, 'no change');
  assert.equal(t('ck2', -3).actions[0].to_filled, 1);
  assert.equal(t('ck1', 2.9).actions[0].by, 2, 'whole segments');
  assert.equal(t('ck1', 0).dropped[0].why, 'no change');
  for (const by of [NaN, '2', null, undefined]) assert.equal(t('ck1', by).dropped[0].why, 'no amount', String(by));
});

await test('rule: a new NPC whose name is already known (an NPC or a PC, any case or punctuation) is dropped and says so', () => {
  const n = (name) => check([act({ type: 'npc_add', quote: 'Mirelle looks at you flat', name })]);
  for (const name of ['Mirelle Tanager', 'mirelle  tanager', 'MIRELLE TANAGER!', 'Odo Vance']) {
    const r = n(name); assert.equal(r.actions.length, 0, name);
    assert.deepEqual(r.dropped, [{ type: 'npc_add', why: 'already known', name: name.replace(/\s+/g, ' ').trim() }], name);
  }
  const ok = check([act({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder', look: 'a green coat'.repeat(40), role: 'fence' })]);
  assert.equal(ok.actions.length, 1); assert.equal(ok.actions[0].look.length, 200, 'look is clipped to 200');
  assert.equal(ok.actions[0].role, 'fence');
});

await test('rule: the quote must appear in the lines after normalising (case, punctuation and spacing do not matter); an invented quote drops the action', () => {
  const q = (quote) => check([act({ quote })]);
  assert.equal(q("that's going to be a six-segment clock").actions.length, 1, 'verbatim');
  assert.equal(q("THAT'S GOING TO BE A SIX-SEGMENT CLOCK").actions.length, 1, 'case');
  assert.equal(q('that\u2019s going to be a six segment clock').actions.length, 1, 'a curly apostrophe and a hyphen');
  assert.equal(q('  call   it   Drains   Below  ').actions.length, 1, 'spacing');
  assert.equal(q('Below. Tick that once').actions.length, 1, 'across two lines');
  assert.equal(q('green coat').actions.length, 1, 'inside a line');
  for (const quote of ['the harbour bell rings thrice', "that's going to be a ten-segment clock", 'Wren Alder is a spy']) { const r = q(quote); assert.equal(r.actions.length, 0, quote); assert.equal(r.dropped[0].why, 'quote not in the talk'); }
  assert.equal(q('').dropped[0].why, 'quote not in the talk', 'an empty quote');
  assert.equal(q('call').dropped[0].why, 'quote not in the talk', 'a quote too short to prove anything');
  assert.equal(q('ock call it Drains').actions.length, 0, 'a quote starts and ends on whole words: "ock" is not "clock"');
  assert.equal(q(undefined).actions.length, 0); assert.equal(q(42).actions.length, 0);
  // only the lines the Worker read count: the state\'s own names and the stamps are not talk
  assert.equal(check([act({ quote: 'Odo Vance' })]).actions.length, 0);
  assert.equal(check([act({ quote: '09:00' })]).actions.length, 0);
  assert.equal(check([act()], { lines: [row(9, 'a mark', 'mark'), row(10, "that's going to be a six-segment clock", 'mark')] }).actions.length, 0, 'a mark is not talk');
});

await test('rule: a confidence under 0.7 comes back as an offer; 0.7 and over is an act; a missing or odd confidence is an offer', () => {
  const m = (confidence) => check([act({ confidence })]).actions[0].mode;
  assert.equal(CONFIDENCE_MIN, 0.7);
  assert.deepEqual([0.69, 0.699, 0, 0.5].map(m), ['offer', 'offer', 'offer', 'offer']);
  assert.deepEqual([0.7, 0.71, 0.95, 1, 7].map(m), ['act', 'act', 'act', 'act', 'act']);
  assert.deepEqual([NaN, '0.9', null, undefined, Infinity].map(m), ['offer', 'offer', 'offer', 'offer', 'offer']);
  assert.equal(check([act({ confidence: 7 })]).actions[0].confidence, 1); assert.equal(check([act({ confidence: 0.123456 })]).actions[0].confidence, 0.12);
});

await test('rule: each action has a stable key (type, normalised target, hash of the line the quote starts on); at, confidence and the amount are not in it', () => {
  const a = check([act()]).actions[0], b = check([act({ at: '10:11', confidence: 0.71 })]).actions[0];
  assert.match(a.key, /^clock_add:drains-below:[0-9a-f]{8}$/);
  assert.equal(a.key, b.key, 'stable across calls');
  assert.equal(check([act({ quote: "THAT'S going to be a six segment clock" })]).actions[0].key, a.key, 'normalised first');
  const t = (quote, by = 1) => check([act({ type: 'clock_tick', quote, clock_id: 'ck1', by })]).actions[0];
  assert.equal(t('Tick that once').key, t('Tick that once', 3).key); assert.match(t('Tick that once').key, /^clock_tick:ck1:/);
  assert.equal(actionKey('npc_add', 'Wren  Alder!', 'x'), actionKey('npc_add', 'wren alder', 'x'));
  assert.notEqual(actionKey('npc_add', 'Wren', 'x'), actionKey('npc_add', 'Wren', 'y'));
  assert.notEqual(actionKey('npc_add', 'Wren', 'x'), actionKey('clock_add', 'Wren', 'x'));
  // the live replay\'s pair: one line, quoted short in one window and long in the next. The same decision keeps one key.
  const short = t('Tick that once'), long = t('Tick that once, the lamp oil is going.'), mid = t('the lamp oil is going');
  assert.equal(short.key, long.key, 'a short quote and the whole line'); assert.equal(short.key, mid.key, 'a quote that starts mid-line');
  assert.equal(t('Tick that once, the lamp oil is going').key, long.key, 'whatever the punctuation');
  // a different line is a different key, and a quote across two lines takes the first
  const cap = (quote) => check([act({ type: 'capture', quote, bucket: 'moment', text: 'x' })]).actions[0];
  assert.notEqual(cap("His name's Wren Alder").key, cap('Mirelle looks at you flat').key, 'two lines, one type and target');
  assert.equal(cap('green coat').key, cap('The fence there').key, 'two spans of line 3');
  const nameOf = (quote) => check([act({ quote })]).actions[0].key;
  assert.equal(nameOf('Below. Tick that once'), nameOf('call it Drains Below'), 'across lines 1 and 2: anchored on line 1');
  assert.notEqual(nameOf('Below. Tick that once'), nameOf('Tick that once, the lamp oil'), 'not on line 2');
  // two identical actions in one reply: one survives
  const d = check([act(), act({ at: '09:01' })]);
  assert.equal(d.actions.length, 1); assert.equal(d.dropped[0].why, 'duplicate');
});

await test('validation: capture buckets, roll_log is offer-only, unknown types and non-lists, and no more than 8 actions looked at', () => {
  const cap = (bucket, text) => check([act({ type: 'capture', quote: 'Mirelle looks at you flat', bucket, text })]);
  assert.equal(cap('loose_end', 'who is the fence?').actions[0].bucket, 'loose_end');
  assert.equal(cap('mood', 'x').dropped[0].why, 'unknown bucket'); assert.equal(cap('moment', '  ').dropped[0].why, 'no text');
  const roll = check([act({ type: 'roll_log', quote: 'Tick that once', confidence: 0.99, who: 'Odo', action: 'sneak', position: 'risky', effect: 'bogus', result: 'partial' })]).actions[0];
  assert.deepEqual([roll.mode, roll.position, roll.effect, roll.result], ['offer', 'risky', 'unclear', 'partial'], 'roll_log never acts (the page has no apply path for it yet)');
  assert.equal(check([act({ type: 'harm' })]).dropped[0].why, 'unknown type');
  for (const junk of [undefined, null, 'x', {}, 5]) assert.deepEqual(check(junk), { actions: [], dropped: [] });
  assert.equal(check([null, 5, 'x']).dropped.length, 3);
  const many = check(Array.from({ length: 12 }, (_, i) => act({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Person ' + i })));
  assert.equal(many.actions.length, 8); assert.ok(many.dropped.some((d) => d.why === 'too many'));
});

await test('validation: linear and small, 8 actions over 40 lines is well under a millisecond', () => {
  const lines = Array.from({ length: 40 }, (_, i) => row(i + 1, 'the table talks about the quay and the lamp oil and something else, line ' + i));
  const acts = Array.from({ length: 8 }, (_, i) => act({ type: 'npc_add', quote: 'the table talks about the quay and the lamp oil and something else, line ' + i, name: 'Person ' + i }));
  const st = cleanState(STATE), N = 300;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) validateActions(acts, { state: st, lines });
  const per = (performance.now() - t0) / N;
  assert.ok(per < 2, per.toFixed(3) + ' ms per call');
});

await test('prompt: the user turn is the state as JSON and the window; no prefix text', () => {
  const u = handsUser({ state: cleanState(STATE), stamp: '09:00', talk: '[09:00] S0: hello' });
  assert.match(u, /"id":"ck1"/); assert.match(u, /up to 09:00:\n\[09:00\] S0: hello$/);
});

// ---------- the route ----------
function fakeClient(st, calls) {
  return { messages: { async create(req, opts) {
    calls.push({ req, opts, ins: req.messages[0].content.filter((b) => b.type === 'text')[0].text, user: req.messages[0].content.filter((b) => b.type === 'text').pop().text, blocks: req.messages[0].content.map((b) => b.type) });
    if (st.hold) await st.hold;
    if (st.error) throw st.error;
    return { content: [{ type: 'text', text: typeof st.reply === 'string' ? st.reply : JSON.stringify(st.reply) }], usage: { input_tokens: 2000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: st.stop || 'end_turn' };
  } } };
}
async function setup({ env = {}, pack = true, handlerOpts = {} } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  if (pack) await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_test000001', extra: { hands: 'EXTRA-FOR-HANDS' } })).run();
  const sqls = [], origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => { sqls.push(sql); return origPrepare(sql); };
  const calls = [], st = { reply: { actions: [] } };
  const handler = makeHandler({ clientFor: () => fakeClient(st, calls), now: () => clock.t, ...handlerOpts });
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...env };
  let n = 0;
  const lines = (texts, { session = '3', kind = 'line' } = {}) => addLines(db, 'c', cleanLines({ lines: texts.map((text, i) => ({ id: 'l' + (++n), at: iso(clock.t - 20_000 + n), session, conn: 'x', speaker: 0, text, kind })) }));
  const post = (b, route = 'act') => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + route, { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } }), env: e, data: { me: GM } });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  const seed = (seat, at, cents = 0, card = null) => db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '3', ?2, 'm', 'low', ?3, '', ?4)").bind(iso(at), seat, cents, card).run();
  const dump = () => JSON.stringify({ c: exec.db.prepare('SELECT * FROM campaigns').all(), n: exec.db.prepare('SELECT * FROM npcs ORDER BY id').all(), p: exec.db.prepare('SELECT * FROM gm_pack ORDER BY part').all() });
  return { exec, db, calls, st, post, lines, rows, seed, dump, sqls, env: e, handler };
}
const TALK = ["Right, that's going to be a six-segment clock, call it Drains Below.", 'Tick that once, the lamp oil is going.', "The fence there? His name's Wren Alder, and he wears a green coat.", 'Mirelle looks at you flat.'];
const REQ = { from: 1, to: 4, state: STATE };
const good = (over) => act(over);

await test('route: /api/gm/assist/act is wired (with or without a slash); a player or the display gets 403 before anything is read', async () => {
  const real = matchApi('/api/gm/assist/act');
  assert.ok(real && real.handler); assert.equal(matchApi('/api/gm/assist/act/').handler, real.handler); assert.equal(matchApi('/api/gm/assist/acts').handler, matchApi('/api/gm/nope').handler, 'only the one name');
  const touched = [];
  const request = { method: 'POST', url: 'https://blades.example.test/api/gm/assist/act', headers: new Headers(), json() { touched.push('json'); throw new Error('read'); }, text() { touched.push('text'); throw new Error('read'); }, arrayBuffer() { touched.push('buf'); throw new Error('read'); } };
  const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    let err = null; try { await real.handler({ request, env, data: { me } }); } catch (e) { err = e; }
    assert.ok(err && err.status === 403);
  }
  assert.deepEqual(touched, []);
});

await test('route: every bad request is a 400 before the database or the key are touched (no key set, DB getter would throw), and a GET is a 405', async () => {
  const s = await setup({ env: { ANTHROPIC_API_KEY: undefined }, handlerOpts: { clientFor: undefined } });
  let touched = 0; Object.defineProperty(s.env, 'DB', { get() { touched++; return s.db; } });
  const bigState = { clocks: [], npcs: [{ id: 'n', name: 'x' }], pcs: [], pad: 'a'.repeat(9000) };
  for (const b of [{}, { from: 1 }, { from: 2, to: 1, state: STATE }, { from: 1, to: 999, state: STATE }, { from: 1, to: 4 }, { from: 1, to: 4, state: 'x' }, { from: 1, to: 4, state: bigState }, { from: 1, to: 4, state: { clocks: [{ id: 'a', name: 'b', size: 99, filled: 0 }] } }]) {
    await assert.rejects(s.post(b), (e) => e.status === 400, JSON.stringify(b).slice(0, 50));
  }
  assert.equal(touched, 0); assert.equal(s.calls.length, 0);
  await assert.rejects(s.post('not an object'), (e) => e.status === 400);
  // with a good body and no key: 503, and only then
  await assert.rejects(s.post(REQ), (e) => e.status === 503);
  const get = await s.handler({ request: new Request('https://blades.example.test/api/gm/assist/act', { method: 'GET' }), env: s.env, data: { me: GM } });
  assert.equal(get.status, 405);
});

await test('route: a state over 8 KB is a 400 (not the generic 413), and a body far over is refused as too large', async () => {
  const s = await setup();
  await assert.rejects(s.post({ ...REQ, state: { clocks: [], npcs: [{ id: 'n', name: 'x' }], pcs: [], pad: 'a'.repeat(STATE_MAX_BYTES) } }), (e) => e.status === 400 && /8 KB/.test(e.message));
  await assert.rejects(s.post({ ...REQ, state: { pad: 'a'.repeat(40 * 1024) } }), (e) => e.status === 413);
});

await test('route: the Worker reads lines from..to from D1 itself; lines the page sends are ignored, and an invented quote is dropped while a real one is kept', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [
    good(),                                                                                                 // real
    good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder', look: 'a green coat', role: 'fence' }),   // real
    good({ type: 'clock_add', quote: 'a clock for the ferry bell tolling', name: 'Ferry Bell', size: 4 }),       // INVENTED: nobody said it
    good({ type: 'clock_tick', quote: 'The page said this phrase unique-zebra-quote', clock_id: 'ck1', by: 1 }),  // said only in the page\'s own `lines`
  ] };
  const res = await s.post({ ...REQ, lines: [{ seq: 9, kind: 'line', text: 'The page said this phrase unique-zebra-quote', at: iso(clock.t), session: '3', speaker: 0 }] });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.deepEqual(out.actions.map((a) => a.type), ['clock_add', 'npc_add']);
  assert.deepEqual(out.dropped.map((d) => d.why), ['quote not in the talk', 'quote not in the talk']);
  assert.ok(out.actions.every((a) => typeof a.key === 'string' && a.mode === 'act'));
  assert.equal(s.calls.length, 1);
  assert.ok(!JSON.stringify(s.calls[0].req).includes('unique-zebra-quote'), 'the page\'s lines never reached the seat');
  assert.match(s.calls[0].user, /\[\d\d:\d\d\] S0: Right, that's going to be a six-segment clock/);
  assert.match(s.calls[0].user, /"id":"ck1"/);
  assert.equal(typeof out.spend.tonight, 'number'); assert.ok(out.spend.tick > 0);
});

await test('route: the seat gets no prefix: no document block, no file id, and not even the vault-built extra for hands', async () => {
  const s = await setup();
  await s.lines(TALK);
  await s.post(REQ);
  const c = s.calls[0];
  assert.ok(!c.blocks.includes('document'), 'blocks: ' + c.blocks);
  const wire = JSON.stringify(c.req);
  assert.ok(!wire.includes('file_test000001') && !wire.includes('file_id') && !wire.includes('EXTRA-FOR-HANDS'));
  assert.deepEqual(c.blocks, ['text', 'text']);
  assert.equal(c.req.model, 'claude-haiku-5-5'); assert.equal(c.req.max_tokens, 1500); assert.deepEqual(c.req.output_config.effort, 'low');
  assert.equal(c.req.output_config.format.type, 'json_schema');
  assert.deepEqual(c.opts && c.opts.timeout, 15_000, 'the 15 s deadline and one retry go on the call'); assert.equal(c.opts.maxRetries, 1);
});

await test('route: it needs no assist part (none in the pack, a legacy one, a bad one): it still runs, with no warning', async () => {
  for (const pack of [false]) {
    const s = await setup({ pack });
    await s.lines(TALK); s.st.reply = { actions: [good()] };
    const out = await body(await s.post(REQ));
    assert.equal(out.actions.length, 1); assert.equal(out.warnings, undefined);
  }
  const s2 = await setup({ pack: false });
  await s2.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ prefix: 'LEGACY PREFIX TEXT' })).run();
  await s2.lines(TALK); s2.st.reply = { actions: [good()] };
  const out2 = await body(await s2.post(REQ));
  assert.equal(out2.actions.length, 1); assert.equal(out2.warnings, undefined); assert.ok(!JSON.stringify(s2.calls[0].req).includes('LEGACY PREFIX'));
});

await test('CPU: exactly one read of the transcript, one read for spend and the last run, one for speakers, one log write; nothing else', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.sqls.length = 0;
  s.st.reply = { actions: [good()] };
  await s.post(REQ);
  const touches = s.sqls.filter((q) => /gm_transcript/.test(q));
  assert.equal(touches.length, 1, 'transcript reads: ' + touches.length);
  assert.match(touches[0], /seq BETWEEN \?2 AND \?3/); assert.match(touches[0], /LIMIT \?4/);
  assert.equal(s.sqls.length, 4, s.sqls.map((q) => q.slice(0, 60)).join(' | '));
  assert.ok(!s.sqls.some((q) => /gm_pack/.test(q)), 'the assist part is never read');
  assert.ok(!s.sqls.some((q) => /campaigns|npcs/.test(q)), 'the table\'s own data is never read: the page sent its state');
});

await test('lines: at most 40, the latest 40 of the range; marks are not read; an empty range makes no call and writes no row', async () => {
  const s = await setup();
  await s.lines(Array.from({ length: 30 }, (_, i) => 'filler talk number ' + (i + 1)));
  await s.lines(Array.from({ length: 30 }, (_, i) => 'filler talk number ' + (i + 31)));
  await s.lines(['a mark here'], { kind: 'mark' });
  s.st.reply = { actions: [] };
  await s.post({ from: 1, to: 61, state: STATE });
  const talk = s.calls[0].user.split('\n').filter((l) => /^\[\d\d:\d\d\] /.test(l));
  assert.equal(talk.length, LINES_MAX); assert.ok(talk[0].includes('filler talk number 21') && talk[39].includes('filler talk number 60'), talk[0] + ' .. ' + talk[39]);
  assert.ok(!s.calls[0].user.includes('a mark here'));
  // a window past the end of the transcript is empty: nothing to read, nothing to ask, nothing to pay
  clock.t += 9_000;
  const before = s.calls.length, rowsBefore = s.rows().length;
  const out = await body(await s.post({ from: 500, to: 520, state: STATE }));
  assert.deepEqual([out.actions, out.dropped, s.calls.length - before, s.rows().length - rowsBefore], [[], [], 0, 0]);
  assert.deepEqual(out.health, { skipped: [], reaped: [], ran: [] });
});

await test('route: it applies nothing: the campaign\'s clocks, the NPC table and the pack are byte-identical after an act that returns clock_add, clock_tick and npc_add', async () => {
  const s = await setup();
  await s.db.prepare("INSERT INTO campaigns (id, updated_at, doc) VALUES ('c', ?1, ?2)").bind(iso(clock.t), JSON.stringify({ clocks: [{ id: 'ck1', name: 'Lamp Oil Running Low', size: 6, filled: 2, kind: 'danger', hidden: false }] })).run();
  await s.lines(TALK);
  const before = s.dump();
  s.st.reply = { actions: [good(), good({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'ck1', by: 1 }), good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder' })] };
  const out = await body(await s.post(REQ));
  assert.deepEqual(out.actions.map((a) => a.type), ['clock_add', 'clock_tick', 'npc_add']);
  assert.equal(s.dump(), before);
  assert.ok(before.includes('Lamp Oil Running Low'));
});

await test('route: one log row, seat hands, flags act, never shown (it must not hold back a card), with the actions and what was dropped', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good(), good({ type: 'clock_add', quote: 'a clock for the ferry bell tolling', name: 'Ferry Bell', size: 4 })] };
  await s.post(REQ);
  const rows = s.rows();
  assert.equal(rows.length, 1); const r = rows[0];
  assert.deepEqual([r.seat, r.flags, r.model, r.effort], ['hands', 'act', 'claude-haiku-5-5', 'low']);
  assert.ok(r.cents > 0 && r.input_tokens === 2000 && r.cache_read === 0);
  const card = JSON.parse(r.card);
  assert.equal(card.shown, 0); assert.equal(card.update, undefined); assert.equal(card.act, 1);
  assert.deepEqual([card.from, card.to, card.n], [1, 4, 4]);
  assert.deepEqual(card.actions.map((a) => [a.type, a.mode]), [['clock_add', 'act']]);
  assert.deepEqual(card.dropped, [{ type: 'clock_add', why: 'quote not in the talk' }]);
  assert.ok(card.secs >= 0 && card.stop === 'end_turn');
  assert.equal(r.session, '3');
});

await test('route: confidence under 0.7 reaches the page as an offer', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good({ confidence: 0.69 }), good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder', confidence: 0.7 })] };
  const out = await body(await s.post(REQ));
  assert.deepEqual(out.actions.map((a) => [a.type, a.mode]), [['clock_add', 'offer'], ['npc_add', 'act']]);
});

await test('route: a refusal, a cut-off and unusable JSON show nothing, and the row says why', async () => {
  for (const [stop, reply, why] of [['refusal', { actions: [good()] }, 'refusal'], ['max_tokens', { actions: [good()] }, 'cut off'], ['end_turn', 'not json at all', 'no JSON'], ['end_turn', { nope: 1 }, 'no JSON']]) {
    const s = await setup();
    await s.lines(TALK); s.st.stop = stop; s.st.reply = reply;
    const out = await body(await s.post(REQ));
    assert.deepEqual([out.actions, out.dropped], [[], []], why);
    const card = JSON.parse(s.rows()[0].card);
    assert.equal(card.error, why); assert.equal(card.shown, 0); if (stop === 'refusal') assert.equal(card.refusal, 1); if (stop === 'max_tokens') assert.equal(card.truncated, 1);
  }
});

await test('route: a provider error is a short status, a deadline is a timeout row; neither shows an action, neither leaks the key', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.error = Object.assign(new Error('boom sk-ant-test-0000'), { status: 529 });
  const out = await body(await s.post(REQ));
  assert.deepEqual(out.actions, []); assert.deepEqual(out.errors, [{ seat: 'hands', error: 'provider status 529' }]);
  assert.ok(!JSON.stringify(out).includes('sk-ant'));
  assert.deepEqual(out.health.ran, [], 'a call that failed did not run');
  // a model that never answers: the seat\'s own deadline ends it
  const s2 = await setup({ handlerOpts: { deadlines: { hands: 30 } } });
  await s2.lines(TALK); s2.st.hold = new Promise(() => {});
  const out2 = await body(await s2.post(REQ));
  assert.deepEqual(out2.errors, [{ seat: 'hands', error: 'timed out' }]);
  const card = JSON.parse(s2.rows()[0].card); assert.equal(card.timeout, 1); assert.equal(card.shown, 0);
});

await test('route: one at a time (429 busy), at most every 8 s (429 cooling down, then fine at 8 s), and it runs to the cap (core tier) but not past it', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [] };
  // busy: the first call is held at the provider
  let release; s.st.hold = new Promise((r) => { release = r; });
  const first = s.post(REQ);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s.post(REQ), (e) => e.status === 429 && /busy/.test(e.message));
  release(); await first;
  s.st.hold = null;
  // cooling down
  clock.t += 7_000;
  await assert.rejects(s.post(REQ), (e) => e.status === 429 && /cooling down/.test(e.message));
  clock.t += 1_000;
  assert.equal((await s.post(REQ)).status, 200);
  // the ladder: 90% of the cap (core tier) still runs; at the cap it does not
  clock.t += 60_000;
  await s.seed('ref', clock.t - 1000, 2700);                       // $27 of the $30 default cap
  assert.equal(budgetTier(27, 30), 'core');
  assert.equal((await s.post(REQ)).status, 200, 'core tier: hands still runs');
  clock.t += 60_000;
  await s.seed('ref', clock.t - 1000, 300);                        // $30: the cap
  await assert.rejects(s.post(REQ), (e) => e.status === 429 && /cap/.test(e.message));
});

await test('route: it leaves the tick\'s reaped report alone, and a hung hands lease lapses on its own', async () => {
  const leases = makeLeases();
  const s = await setup({ handlerOpts: { leases } });
  await s.lines(TALK);
  s.st.reply = { actions: [good()] };
  leases.acquire('ref', clock.t - 100_000);                         // a Ref lease from a cancelled tick, long past its ttl
  const out = await body(await s.post(REQ));
  assert.deepEqual(out.health, { skipped: [], reaped: [], ran: ['hands'] });
  assert.deepEqual(leases.takeReaped(), ['ref'], 'the lapse is still there for the tick to report');
  // a stuck hands lease (its request was killed) lapses at 30 s
  const L2 = makeLeases(); const s2 = await setup({ handlerOpts: { leases: L2 } });
  await s2.lines(TALK); s2.st.reply = { actions: [] };
  L2.acquire('hands', clock.t);
  await assert.rejects(s2.post(REQ), (e) => e.status === 429);
  clock.t += 31_000;
  assert.equal((await s2.post(REQ)).status, 200);
});

await test('route: the same window sent twice gives the same keys, so the page can dedupe', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good(), good({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'ck1', by: 1 })] };
  const a = await body(await s.post(REQ));
  clock.t += 9_000;
  const b = await body(await s.post(REQ));
  assert.deepEqual(a.actions.map((x) => x.key), b.actions.map((x) => x.key));
  assert.equal(new Set(a.actions.map((x) => x.key)).size, 2);
  // a model that copies a different span of the same lines the second time (the live replay saw this) still gives the same keys, even in a narrower window
  clock.t += 9_000;
  s.st.reply = { actions: [good({ quote: "Right, that's going to be a six-segment clock, call it Drains Below." }), good({ type: 'clock_tick', quote: 'the lamp oil is going', clock_id: 'ck1', by: 2 })] };
  const c = await body(await s.post({ ...REQ, from: 2, to: 3 }));
  assert.deepEqual(c.actions.map((x) => x.type), ['clock_tick'], 'line 1 is outside the narrower window: its quote is not in the talk');
  assert.equal(c.actions[0].key, a.actions[1].key);
  clock.t += 9_000;
  const d = await body(await s.post(REQ));
  assert.deepEqual(d.actions.map((x) => x.key), a.actions.map((x) => x.key));
});

// ---------- the replay script's helpers and guards ----------
const TRANSCRIPT = [
  '# invented', '',
  ...Array.from({ length: 45 }, (_, i) => `- **[21:00] Gm:** busy line ${i}`),
  '- **[21:01] Gm:** a later minute', '- **[21:03] Pia:** another later one', 'not a line',
].join('\n');

await test('replay helpers: rows are in transcript order with a seq; windows overlap, are capped at the latest 40 lines, and skip empty or repeated ones', async () => {
  const { rowsOf, windowsOf, talkOf, applyToState, fakeHandsCall } = await import('../../scripts/lib/act-replay.mjs');
  const rows = rowsOf(TRANSCRIPT);
  assert.equal(rows.length, 47); assert.deepEqual([rows[0].seq, rows[46].seq, rows[46].stamp], [1, 47, '21:03']);
  const w = windowsOf(rows, { window: 2, step: 1 });
  assert.equal(w.length, 3, '21:00 (46 lines), 21:01 (the one line left), 21:02 (holds 21:03); the 21:03 window repeats the 21:02 one and is skipped');
  assert.equal(w[0].rows.length, LINES_MAX, 'capped at 40'); assert.equal(w[0].to, 46); assert.equal(w[0].from, 7, 'the latest 40 of the 46 in 21:00-21:01');
  assert.match(talkOf(w[2]), /^\[21:03\] Pia: another later one$/);
  assert.deepEqual(windowsOf(rows, { from: 21 * 60 + 3, to: 21 * 60 + 3 }).map((x) => [x.from, x.to]), [[47, 47]]);
  assert.deepEqual(windowsOf([], {}), []);
  // the fake model: a clock phrase and a tick phrase, plus an invented quote every third window that validation must drop
  const user = handsUser({ state: cleanState(STATE), stamp: '09:00', talk: "[09:00] Gm: That's a six-segment clock. Tick that, please." });
  const f = fakeHandsCall({ user, n: 3 });
  const v = validateActions(f.json.actions, { state: cleanState(STATE), lines: [row(1, "That's a six-segment clock. Tick that, please.")] });
  assert.deepEqual(v.actions.map((a) => a.type), ['clock_add', 'clock_tick']); assert.deepEqual(v.dropped.map((d) => d.why), ['quote not in the talk']);
  // the stand-in apply step: acts only, each key once, offers left alone
  const keys = new Set();
  const st1 = applyToState(cleanState(STATE), v.actions, keys);
  assert.equal(st1.applied.length, 2); assert.equal(st1.state.clocks.length, 4); assert.equal(st1.state.clocks[0].filled, 3);
  const st2 = applyToState(st1.state, v.actions, keys);
  assert.deepEqual([st2.applied.length, st2.skipped.length, st2.state.clocks.length], [0, 2, 4], 'a re-sent window applies nothing twice');
  const offer = validateActions([act({ confidence: 0.2 })], { state: cleanState(STATE), lines: LINES }).actions;
  assert.equal(applyToState(cleanState(STATE), offer, new Set()).applied.length, 0);
});

await test('replay script guards: no key and no --fake, a budget over $0.50, and an --out outside gm-private/ all stop at once with exit 2 and no output files', async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os'), fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-')), tf = path.join(dir, 't.md'), sf = path.join(dir, 's.json');
  fs.writeFileSync(tf, '- **[21:00] Gm:** hello there\n'); fs.writeFileSync(sf, JSON.stringify(STATE));
  const script = path.join(ROOT, 'scripts', 'gm-assist-act-replay.mjs');
  const run = (extra, env = {}) => spawnSync(process.execPath, [script, '--transcript', tf, '--state', sf, ...extra], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });
  const noKey = run([]); assert.equal(noKey.status, 2); assert.match(noKey.stderr, /B68_ANTHROPIC_KEY/);
  const withApiKey = run([], { ANTHROPIC_API_KEY: 'sk-ant-should-not-be-used' }); assert.equal(withApiKey.status, 2, 'ANTHROPIC_API_KEY is never read');
  assert.ok(!withApiKey.stdout.includes('sk-ant') && !withApiKey.stderr.includes('sk-ant'));
  assert.equal(run(['--fake', '--max-spend', '0.6']).status, 2);
  assert.equal(run(['--fake', '--max-spend', '0']).status, 2);
  const out = run(['--fake', '--out', path.join(dir, 'elsewhere')]); assert.equal(out.status, 2); assert.match(out.stderr, /gm-private/);
  assert.ok(!fs.existsSync(path.join(dir, 'elsewhere')));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log('\n' + (failed ? failed + ' FAILED, ' + passed + ' passed' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
