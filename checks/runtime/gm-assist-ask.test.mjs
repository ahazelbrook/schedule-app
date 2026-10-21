// Ask Blade (the GM's typed question in the box): the seat, the prompt turn, the ladder, and POST /api/gm/assist/ask plus the `asks` on
// GET /cards, on an in-memory D1 with a FAKE Anthropic client. No network and no key. Every name and sentence is invented.
//   node checks/runtime/gm-assist-ask.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { canRun, budgetTier, COOLDOWN_MS, CORE_SEATS, DROPPED_WHEN_REDUCED } from '../../functions/_lib/assist/conductor.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { askUser, clipAnswer, storyBlock, STORY_SEATS, ASK_MAX, ASK_WINDOW_MIN, ANSWER_MAX, ASK_HISTORY } from '../../functions/_lib/assist/prompts.js';
import { makeHandler, cleanAskQuestion } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';
import { nightCards } from '../../functions/_lib/assist/cards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const MIN = 60_000;
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-06-01T09:00:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();
const STORY = 'The crew met a fence and learned of a missing ledger.';
const ANSWER = 'One: a runner arrives early.\nTwo: the lamp goes out.\nThree: a stranger knocks.';

// the fake: the ask seat answers with plain text (no JSON), the others never run here
function fakeClient(state, calls) {
  return { messages: { async create(req) {
    const texts = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
    const seat = Object.keys(SEATS).find((k) => texts[0].startsWith(SEATS[k].instructions)) || 'other';
    calls.push({ seat, req, ins: texts[0], user: texts[texts.length - 1], blocks: req.messages[0].content.map((b) => b.type), doc: req.messages[0].content.find((b) => b.type === 'document') });
    if (state.hold) await state.hold;
    if (state.error) throw state.error;
    return { content: state.content || [{ type: 'text', text: state.text }], usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: state.stop || 'end_turn' };
  } } };
}
async function setup({ env = {}, pack = true } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  if (pack) await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_test000001' })).run();
  const calls = [], state = { text: ANSWER };
  const handler = makeHandler({ clientFor: () => fakeClient(state, calls), now: () => clock.t });
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...env };
  let n = 0;
  const lines = (count, { ago = 20_000, session = '3', text = 'we move on the quay now' } = {}) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: count }, (_, i) => ({ id: 'l' + (++n), at: iso(clock.t - ago + i), session, conn: 'x', speaker: 0, text: text + ' ' + n, kind: 'line' })) }));
  const req = (route, method, b, qs = '') => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + route + qs, { method, ...(b !== undefined ? { body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } } : {}) }), env: e, data: { me: GM } });
  const ask = (q) => req('ask', 'POST', { q });
  const cards = () => req('cards', 'GET');
  const mark = (op, items) => req('cards', 'POST', { op, items });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  const seed = (seat, at, cents = 0, card = null) => db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '3', ?2, 'm', 'low', ?3, '', ?4)").bind(iso(at), seat, cents, card).run();
  const seedAsk = (at, q, text) => seed('ask', at, 0, JSON.stringify({ ask: 1, q, text, shown: 0 }));
  return { exec, db, calls, state, ask, cards, mark, req, lines, rows, seed, seedAsk, env: e, handler };
}
const body = async (res) => JSON.parse(await res.text());

// ---------- the seat and the ladder ----------
await test('seat: Opus 5.5 at medium with 8000 tokens, no schema, generic; no flag wakes it; no cooldown; story rides after the breakpoint', () => {
  const a = SEATS.ask;
  assert.deepEqual([a.model, a.effort, a.maxTokens], ['claude-opus-5-5', 'medium', 8000]);
  assert.equal(a.schema, undefined, 'a plain-text reply');
  assert.ok(!(('ask') in WAKES) && !Object.values(WAKES).some((f) => f.includes('ask')), 'the GM\'s own question only');
  assert.ok(!a.instructions.includes('gm-private') && !a.instructions.includes('[['), 'generic: no vault paths or wikilinks');
  assert.match(a.instructions, /\(secret\)/); assert.match(a.instructions, /never decide what a player character does, thinks or feels/);
  assert.match(a.instructions, /Under 350 words/); assert.match(a.instructions, /Australian spelling/);
  assert.equal(COOLDOWN_MS.ask, 0);
  assert.ok(STORY_SEATS.includes('ask'));
});

await test('ladder: Ask Blade stops at 85% of the cap like Portrait and Prop (not a Core seat, not dropped at 60%); at the cap nothing', () => {
  assert.ok(!CORE_SEATS.includes('ask') && !DROPPED_WHEN_REDUCED.includes('ask'));
  const at = (spent) => canRun('ask', { now: 1, tier: budgetTier(spent, 20) }).ok;
  assert.deepEqual([0, 11.9, 12, 16.9, 17, 19.9, 20].map(at), [true, true, true, true, false, false, false]);
  assert.equal(canRun('ask', { now: 1, inFlight: new Set(['ask']) }).why, 'in-flight');
  assert.equal(canRun('ask', { now: 1, lastRun: { ask: 1 } }).ok, true, 'no cooldown');
});

// ---------- the prompt pieces ----------
await test('askUser: earlier exchanges (newest last), the talk, then the question; answers in history are clipped to 1200; clipAnswer cuts at a line break', () => {
  assert.equal(ASK_MAX, 600); assert.equal(ASK_WINDOW_MIN, 10); assert.equal(ANSWER_MAX, 4000); assert.equal(ASK_HISTORY, 2);
  const plain = askUser({ q: 'Pitch three twists.', stamp: '21:10', talk: '[21:09] A: hi' });
  assert.equal(plain, 'Talk of the last 10 minutes, up to 21:10:\n[21:09] A: hi\n\nThe GM asks: Pitch three twists.');
  const u = askUser({ q: 'Make it darker.', history: [{ q: 'first?', text: 'first answer' }, { q: 'second?', text: 'y'.repeat(2000) }], stamp: '21:10', talk: 'T' });
  assert.ok(u.startsWith('Earlier this session, the GM asked and you answered (newest last):\nGM: first?\nYou: first answer\n\nGM: second?\nYou: y'));
  assert.ok(!u.includes('y'.repeat(1201)) && u.includes('y'.repeat(1200)), 'clipped to 1200');
  assert.ok(u.indexOf('first?') < u.indexOf('second?') && u.indexOf('second?') < u.indexOf('Talk of the last') && u.endsWith('The GM asks: Make it darker.'));
  assert.match(askUser({ q: 'q', stamp: '21:10', talk: '' }), /\(nothing heard\)/);
  assert.equal(clipAnswer('  short  '), 'short');
  const long = Array.from({ length: 300 }, (_, i) => 'Line number ' + i + ' of the scene.').join('\n');
  const c = clipAnswer(long);
  assert.ok(c.length <= ANSWER_MAX + 1 && c.endsWith('…') && !c.endsWith('\n…'), 'cut ' + c.length);
  assert.ok(/of the scene\.…$/.test(c), 'at a line break: no half line');
  assert.equal(clipAnswer('x'.repeat(5000)).length, ANSWER_MAX + 1, 'one long line is cut at the limit');
  assert.equal(clipAnswer(null), '');
});

await test('cleanAskQuestion: squashes whitespace; 1 to 600 characters; anything else is null', () => {
  assert.equal(cleanAskQuestion('  pitch   three\n\ncomplications  '), 'pitch three complications');
  assert.equal(cleanAskQuestion('x'.repeat(600)).length, 600);
  for (const bad of [undefined, null, 5, [], {}, '', '   \n ', 'x'.repeat(601)]) assert.equal(cleanAskQuestion(bad), null, JSON.stringify(bad));
});

// ---------- the route ----------
await test('route: /api/gm/assist/ask is wired; a player or the display gets 403 before anything is read', async () => {
  const real = matchApi('/api/gm/assist/ask');
  assert.ok(real && real.handler); assert.equal(matchApi('/api/gm/assist/ask/').handler, real.handler);
  const touched = [];
  const request = { method: 'POST', url: 'https://blades.example.test/api/gm/assist/ask', headers: new Headers(), json() { touched.push('json'); throw new Error('read'); }, text() { touched.push('text'); throw new Error('read'); }, arrayBuffer() { touched.push('ab'); throw new Error('read'); }, get body() { touched.push('body'); return null; } };
  const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    let err = null; try { await real.handler({ request, env, data: { me } }); } catch (e) { err = e; }
    assert.ok(err && err.status === 403);
  }
  assert.deepEqual(touched, []);
});

await test('ask: GET is 405; a missing, empty, non-string or over-long q is 400 before the database or the key are touched', async () => {
  const touched = [];
  const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
  const h = makeHandler({ clientFor: () => { touched.push('client'); throw new Error('no'); } });
  const post = (b) => h({ request: new Request('https://blades.example.test/api/gm/assist/ask', { method: 'POST', body: JSON.stringify(b) }), env, data: { me: GM } });
  for (const bad of [{}, { q: '' }, { q: '   ' }, { q: 5 }, { q: ['a'] }, { q: 'x'.repeat(ASK_MAX + 1) }]) await assert.rejects(post(bad), (e) => e.status === 400, JSON.stringify(bad).slice(0, 40));
  await assert.rejects(h({ request: new Request('https://blades.example.test/api/gm/assist/ask', { method: 'POST', body: '[1]' }), env, data: { me: GM } }), (e) => e.status === 400);
  assert.equal((await h({ request: new Request('https://blades.example.test/api/gm/assist/ask'), env, data: { me: GM } })).status, 405);
  assert.deepEqual(touched, [], 'nothing was touched');
  // a good q with no key is the usual 503, with no model called
  const s = await setup();
  const noKey = makeHandler({ now: () => clock.t });
  await assert.rejects(noKey({ request: new Request('https://blades.example.test/api/gm/assist/ask', { method: 'POST', body: '{"q":"hello"}' }), env: { DB: s.db, CAMPAIGN: 'c' }, data: { me: GM } }), (e) => e.status === 503 && !/sk-/.test(e.message));
  assert.equal(s.calls.length, 0);
});

await test('ask: the answer comes back with the question and the time; the row is logged with ask:1, q and the text; the seat reads story, talk and q', async () => {
  clock.t = Date.parse('2030-06-01T09:00:00.000Z');
  const s = await setup();
  await s.seed('scribe', clock.t - 30 * MIN, 0, JSON.stringify({ story: STORY, through: 0, corrections: [] }));
  await s.db.prepare("UPDATE gm_assist_log SET session = 'a-different-session'").run();
  await s.lines(2, { text: 'near the quay' });
  await s.lines(1, { ago: 12 * MIN, text: 'long ago talk' });
  const res = await s.ask('  give me   an epilogue\nfor the night ');
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.deepEqual(out.answer, { q: 'give me an epilogue for the night', text: ANSWER, at: iso(clock.t) });
  assert.ok(out.spend && out.spend.tonight > 0 && out.spend.cap === 20 && out.spend.tier === 'all');
  assert.equal(out.warnings, undefined); assert.equal(out.errors, undefined);
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].seat, 'ask');
  const c = s.calls[0];
  assert.deepEqual(c.blocks, ['document', 'text', 'text'], 'cached prefix file, instructions + story, the turn');
  assert.equal(c.doc.source.file_id, 'file_test000001'); assert.equal(c.doc.cache_control.ttl, '1h');
  assert.equal(c.ins, SEATS.ask.instructions + storyBlock(STORY), 'the story (any session) is appended after the breakpoint');
  assert.match(c.user, /^Talk of the last 10 minutes, up to \d\d:\d\d:\n\[\d\d:\d\d\] S0: near the quay 1\n/);
  assert.ok(!c.user.includes('long ago talk'), 'only the last 10 minutes of talk'); assert.ok(!c.user.includes('Earlier this session'));
  assert.ok(c.user.endsWith('The GM asks: give me an epilogue for the night'));
  assert.equal(c.req.model, 'claude-opus-5-5'); assert.deepEqual(c.req.output_config, { effort: 'medium' }); assert.equal(c.req.max_tokens, 8000);
  const row = s.rows().find((r) => r.seat === 'ask'), card = JSON.parse(row.card);
  assert.equal(row.model, 'claude-opus-5-5'); assert.equal(row.effort, 'medium'); assert.equal(row.flags, 'ask'); assert.equal(row.at, out.answer.at);
  assert.ok(row.cents > 0 && row.input_tokens === 1000 && row.output_tokens === 300);
  assert.equal(card.ask, 1); assert.equal(card.q, 'give me an epilogue for the night'); assert.equal(card.text, ANSWER); assert.equal(card.shown, 0);
  assert.equal(card.stop, 'end_turn'); assert.ok(card.secs >= 0 && card.error === undefined);
});

await test('ask: with no story yet the instructions carry none; a long answer is cut at the last line break to 4000', async () => {
  const s = await setup();
  s.state.text = Array.from({ length: 300 }, (_, i) => 'Beat ' + i + ': the crew moves on.').join('\n');
  const out = await body(await s.ask('what next?'));
  assert.equal(s.calls[0].ins, SEATS.ask.instructions);
  assert.ok(out.answer.text.length <= ANSWER_MAX + 1 && out.answer.text.endsWith('moves on.…'));
  assert.equal(JSON.parse(s.rows()[0].card).text, out.answer.text, 'the row keeps what was shown');
});

await test('ask: the last two exchanges of the last 45 minutes ride along, oldest first; older ones and other seats do not', async () => {
  clock.t = Date.parse('2030-06-01T10:00:00.000Z');
  const s = await setup();
  await s.seedAsk(clock.t - 50 * MIN, 'too old?', 'too old answer');
  await s.seedAsk(clock.t - 30 * MIN, 'one?', 'answer one');
  await s.seedAsk(clock.t - 20 * MIN, 'two?', 'answer two ' + 'z'.repeat(2000));
  await s.seedAsk(clock.t - 10 * MIN, 'three?', 'answer three');
  await s.seed('prop', clock.t - 5 * MIN, 0, JSON.stringify({ out: {}, shown: 0 }));
  await s.seed('ask', clock.t - 4 * MIN, 0, JSON.stringify({ ask: 1, q: 'failed?', text: '', shown: 0, error: 'refusal' }));
  await body(await s.ask('make it darker'));
  const u = s.calls[0].user;
  assert.ok(u.startsWith('Earlier this session, the GM asked and you answered (newest last):\nGM: two?\nYou: answer two '), u.slice(0, 160));
  assert.ok(u.indexOf('GM: two?') < u.indexOf('GM: three?'));
  for (const gone of ['too old', 'GM: one?', 'failed?']) assert.ok(!u.includes(gone), gone);
  assert.ok(!u.includes('z'.repeat(1200)), 'an earlier answer is clipped (in D1) well under its stored length');
  assert.ok(u.endsWith('The GM asks: make it darker'));
});

await test('ask: a refusal, a reply cut off at the limit, an empty reply and a failed call all give answer null, logged with the reason and never shown', async () => {
  const s = await setup();
  const last = () => JSON.parse(s.rows().filter((r) => r.seat === 'ask').pop().card);
  s.state.stop = 'refusal'; s.state.text = 'I will not.';
  let out = await body(await s.ask('one'));
  assert.equal(out.answer, null); assert.ok(out.spend);
  assert.deepEqual([last().ask, last().q, last().text, last().shown, last().error, last().refusal], [1, 'one', '', 0, 'refusal', 1]);
  s.state.stop = 'max_tokens'; s.state.text = 'half a thought';
  out = await body(await s.ask('two')); assert.equal(out.answer, null);
  assert.deepEqual([last().text, last().error, last().truncated], ['', 'cut off', 1]);
  s.state.stop = 'end_turn'; s.state.text = '   \n ';
  out = await body(await s.ask('three')); assert.equal(out.answer, null); assert.equal(last().error, 'no text'); assert.equal(last().text, '');
  s.state.text = 'fine'; s.state.error = Object.assign(new Error('provider said something private'), { status: 500 });
  out = await body(await s.ask('four'));
  assert.equal(out.answer, null); assert.deepEqual(out.errors, [{ seat: 'ask', error: 'provider status 500' }]);
  assert.ok(!JSON.stringify(out).includes('private'));
  assert.equal(last().error, 'provider status 500');
  assert.equal(s.rows().filter((r) => r.seat === 'ask').length, 4, 'every attempt is logged');
  // none of it comes back after a reload
  assert.deepEqual((await body(await s.cards())).asks, []);
});

await test('ask: no assist part (or an old one with prefix text) gives answer null and a warning, with no call and no row', async () => {
  let s = await setup({ pack: false });
  let out = await body(await s.ask('hello'));
  assert.deepEqual([out.answer, out.warnings], [null, ['no assist part in the GM pack']]); assert.equal(s.calls.length, 0); assert.equal(s.rows().length, 0);
  s = await setup({ pack: false });
  await s.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ prefix: 'old text' })).run();
  out = await body(await s.ask('hello'));
  assert.deepEqual([out.answer, out.warnings], [null, ['re-push the assist part']]); assert.equal(s.calls.length, 0);
});

await test('ask: a file the provider no longer has gives answer null and the re-push warning, nothing logged', async () => {
  const s = await setup();
  s.state.error = Object.assign(new Error('file not found'), { status: 404 });
  const out = await body(await s.ask('hello'));
  assert.deepEqual([out.answer, out.warnings], [null, ['re-push the assist part']]); assert.equal(s.rows().length, 0);
});

await test('ask: 429 at the cap and from 85% (the ladder); the wording matches the Screen; at 60% it still runs', async () => {
  clock.t = Date.parse('2030-06-01T11:00:00.000Z');
  let s = await setup();
  await s.seed('fixer', clock.t - 60 * MIN, 17 * 100);            // $17 of a $20 cap = 85%
  await assert.rejects(s.ask('hi'), (e) => e.status === 429 && /budget ladder has dropped this for tonight/.test(e.message));
  s = await setup();
  await s.seed('fixer', clock.t - 60 * MIN, 20 * 100);
  await assert.rejects(s.ask('hi'), (e) => e.status === 429 && /tonight's cap is reached/.test(e.message));
  s = await setup();
  await s.seed('fixer', clock.t - 60 * MIN, 12 * 100);            // 60%: Wire has gone, Ask has not
  const out = await body(await s.ask('hi'));
  assert.ok(out.answer && out.spend.tier === 'reduced');
  assert.equal(s.calls.length, 1);
});

await test('ask: one at a time (429 busy); a second request while the first waits calls nothing', async () => {
  const s = await setup();
  let release; s.state.hold = new Promise((ok) => { release = ok; });
  const first = s.ask('first');
  for (let i = 0; i < 50 && !s.calls.length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.calls.length, 1);
  await assert.rejects(s.ask('second'), (e) => e.status === 429 && /busy/.test(e.message));
  release();
  assert.ok((await body(await first)).answer);
  assert.equal(s.calls.length, 1);
  assert.ok((await body(await s.ask('third'))).answer, 'free again, and there is no cooldown');
});

// ---------- the box's memory ----------
await test('cards: GET returns asks (oldest first, the last 10, with the question and kept); dismiss hides one, keep marks it; gm:after files none', async () => {
  clock.t = Date.parse('2030-06-01T12:00:00.000Z');
  const s = await setup();
  for (let i = 1; i <= 12; i++) { clock.t += MIN; await s.ask('question ' + i); }
  let g = await body(await s.cards());
  assert.deepEqual(Object.keys(g).sort(), ['asks', 'cards', 'updates']);
  assert.deepEqual(g.cards, []); assert.deepEqual(g.updates, []);
  assert.equal(g.asks.length, 10);
  assert.deepEqual(g.asks.map((a) => a.q), Array.from({ length: 10 }, (_, i) => 'question ' + (i + 3)), 'the last ten, oldest first');
  const a = g.asks[9];
  assert.deepEqual(Object.keys(a).sort(), ['at', 'kept', 'q', 'row', 'text']); assert.equal(a.text, ANSWER); assert.equal(a.kept, false);
  assert.deepEqual(await body(await s.mark('keep', [{ at: a.at, text: a.q }])), { marked: 1 });
  assert.equal((await body(await s.cards())).asks[9].kept, true);
  assert.deepEqual(await body(await s.mark('seen', [{ at: a.at, text: a.q }])), { marked: 0 }, 'an ask is dismissed or kept, not seen');
  assert.deepEqual(await body(await s.mark('dismiss', [{ at: a.at, text: 'not the question' }])), { marked: 0 }, 'matched by the question');
  assert.deepEqual(await body(await s.mark('dismiss', [{ at: a.at, text: a.q }])), { marked: 1 });
  g = await body(await s.cards());
  assert.equal(g.asks.length, 10, 'an earlier one slides back in');
  assert.ok(!g.asks.some((x) => x.q === 'question 12') && g.asks[9].q === 'question 11');
  const all = await nightCards(s.db, 'c', { now: clock.t, all: true });
  assert.deepEqual(all.cards, [], 'gm:after reads cards only: an ask is never a shown card');
  assert.ok(all.asks.some((x) => x.q === 'question 12'), 'with `all` the dismissed one is still there');
  // a dismissed answer is left out of the history too, so a bad one does not steer the next: the last two kept are 10 and 11
  s.calls.length = 0; await s.ask('and one more');
  assert.match(s.calls[0].user, /GM: question 10\nYou:[^]*GM: question 11\nYou:/);
  assert.ok(!s.calls[0].user.includes('GM: question 12'));
});

await test('cards: asks older than twelve hours are not tonight\'s; ?since cuts them', async () => {
  clock.t = Date.parse('2030-06-01T12:00:00.000Z');
  const s = await setup();
  await s.ask('early');
  assert.equal((await body(await s.cards())).asks.length, 1);
  assert.equal((await body(await s.req('cards', 'GET', undefined, '?since=' + encodeURIComponent(iso(clock.t + 1000))))).asks.length, 0);
  clock.t += 13 * 60 * MIN;
  assert.equal((await body(await s.cards())).asks.length, 0);
});

console.log('\n' + (failed ? failed + ' FAILED, ' + passed + ' passed' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
