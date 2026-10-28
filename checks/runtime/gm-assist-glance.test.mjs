// The glance fields (P1; design 3.6): every card in a tick answer, a fit answer and GET /cards carries { kind, headline, bullets } (and cite / check
// where they apply) beside the `text` and `detail` the older page reads. One test per seat mapping, the cite extraction on its own, the round trip
// through the log (tick -> GET /cards), a held Ref card, and old rows with no glance fields. Fake `call`, in-memory D1, no network and no key.
// Every name and sentence is invented.
//   node checks/runtime/gm-assist-glance.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { toCandidate, toVoice, toStall, toMeanwhile, toHandout, handoutIds, handoutTitles, pendingRefs, merge } from '../../functions/_lib/assist/editor.js';
import { citeOf, splitSentence, restoreGlance, glance, bulletsOf, GLANCE_KIND, REF_CHECKS } from '../../functions/_lib/assist/glance.js';
import { nightCards } from '../../functions/_lib/assist/cards.js';
import { makeHandler } from '../../functions/api/gm/assist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const MIN = 60_000;
const T = Date.parse('2030-05-05T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const GM = { role: 'gm', id: 'gm@example.test' };

// ---------- the cite, on its own ----------
await test('citeOf: the page cite in a rule, first three joined; none gives an empty string (so the key is left out)', () => {
  assert.equal(citeOf('Position comes before the roll (p.9)'), 'p.9');
  assert.equal(citeOf('Resist with the matching attribute, pp. 12-13'), 'pp. 12-13');
  assert.equal(citeOf('see page 40 and p.41, p.42, p.43 and p.41'), 'page 40, p.41, p.42', 'in order, no repeats, three at most');
  assert.equal(citeOf('a house rule with no page'), '');
  assert.equal(citeOf(''), ''); assert.equal(citeOf(null), ''); assert.equal(citeOf(undefined), '');
  assert.equal(citeOf('the paper 12 and the pages of it'), '', 'a bare number or the word alone is not a cite');
});

await test('splitSentence and bulletsOf: first sentence and the rest; bullets are one line, 120 characters, five at most', () => {
  assert.deepEqual(splitSentence('A runner leaves the quay. The watch doubles.  Nobody sees.'), ['A runner leaves the quay.', 'The watch doubles. Nobody sees.']);
  assert.deepEqual(splitSentence('no full stop here'), ['no full stop here', '']);
  assert.deepEqual(splitSentence(''), ['', '']);
  const b = bulletsOf(['a', '', '  ', 'b\n\nc', 'x'.repeat(200), 'd', 'e', 'f', 7, null]);
  assert.equal(b.length, 5); assert.equal(b[1], 'b c'); assert.equal(b[2].length, 120); assert.ok(b[2].endsWith('…'));
  assert.deepEqual(bulletsOf('nope'), []);
});

// ---------- one test per seat mapping (the pure side) ----------
const SLIP = { slip: true, said_at: '21:14', what_was_said: 'rolled before naming the risk', rule: 'Name position and effect first (p.32)', card: 'Position was named after the roll' };

await test('ref -> rule: headline = card; bullets = what was said (with its time), then the rule; cite from the rule; text and detail unchanged', () => {
  const c = toCandidate('ref', SLIP, { now: T });
  assert.equal(c.text, 'Position was named after the roll');
  assert.deepEqual(c.detail, { said_at: '21:14', rule: 'Name position and effect first (p.32)' });
  assert.deepEqual(c.glance, { kind: 'rule', headline: 'Position was named after the roll', bullets: ['[21:14] rolled before naming the risk', 'Name position and effect first (p.32)'], cite: 'p.32' });
  assert.ok(!('secret' in c.glance), 'secret is Ask Blade\'s alone');
});

await test('ref: check is copied only when it is one of the six; absent or unknown leaves the key out; a rule with no page has no cite', () => {
  for (const check of REF_CHECKS) assert.equal(toCandidate('ref', { ...SLIP, check }, { now: T }).glance.check, check);
  assert.ok(!('check' in toCandidate('ref', SLIP, { now: T }).glance), 'absent: no key');
  assert.ok(!('check' in toCandidate('ref', { ...SLIP, check: 'vibes' }, { now: T }).glance), 'unknown: no key');
  const g = toCandidate('ref', { ...SLIP, rule: 'Hard mode allows one resistance roll' }, { now: T }).glance;
  assert.ok(!('cite' in g)); assert.deepEqual(g.bullets, ['[21:14] rolled before naming the risk', 'Hard mode allows one resistance roll']);
  const noSaid = toCandidate('ref', { ...SLIP, said_at: '', what_was_said: '' }, { now: T }).glance;
  assert.deepEqual(noSaid.bullets, ['Name position and effect first (p.32)']);
});

await test('ref: a long card line is cut to a 90-character headline, but text is the whole line (the identity the marks match on)', () => {
  const card = 'The position was only named once the dice were already on the table and everyone had agreed it was fine anyway';
  const c = toCandidate('ref', { ...SLIP, card }, { now: T });
  assert.equal(c.text, card); assert.equal(c.glance.headline.length, 90); assert.ok(c.glance.headline.endsWith('…'));
});

await test('clerk -> note: headline = the first item (New name / Canon); bullets = the rest; items the Editor dropped are not in it', () => {
  const c = toCandidate('clerk', { new_names: ['Zarbo', 'Mott'], drift: ['The bridge was said to be north'], clues_landed: [] }, { now: T });
  assert.equal(c.text, 'New name: Zarbo / New name: Mott / Canon: The bridge was said to be north');
  assert.deepEqual(c.glance, { kind: 'note', headline: 'New name: Zarbo', bullets: ['New name: Mott', 'Canon: The bridge was said to be north'] });
  const known = toCandidate('clerk', { new_names: ['Zarbo', 'Mott'], drift: [], clues_landed: [] }, { now: T, known: ['Zarbo'] });
  assert.deepEqual(known.glance, { kind: 'note', headline: 'New name: Mott', bullets: [] }, 'a known name never headlines');
  const seen = toCandidate('clerk', { new_names: ['Zarbo', 'Mott'], drift: [], clues_landed: [] }, { now: T + MIN, recent: [{ at: T, keys: ['clerk:name:zarbo'] }] });
  assert.equal(seen.glance.headline, 'New name: Mott');
});

await test('mystery -> idea: headline = push_next; bullets = how, then the Must land entry', () => {
  const c = toCandidate('mystery', { push_next: 'The ferryman mentions the second key', must_land_item: '#2 The second key', how: 'Let him drop it while he is paid.' }, { now: T });
  assert.deepEqual(c.glance, { kind: 'idea', headline: 'The ferryman mentions the second key', bullets: ['Let him drop it while he is paid.', 'Must land: #2 The second key'] });
  assert.match(c.text, /^Push next: /);
});

await test('showrunner -> idea: headline = advice; bullets = who needs the spotlight; with no advice the spotlight is the headline', () => {
  const a = toCandidate('showrunner', { speak: true, advice: 'Cut to the chase now', needs_spotlight: 'Quill' }, { now: T });
  assert.deepEqual(a.glance, { kind: 'idea', headline: 'Cut to the chase now', bullets: ['Spotlight: Quill'] });
  const b = toCandidate('showrunner', { speak: true, advice: '', needs_spotlight: 'Quill' }, { now: T });
  assert.deepEqual(b.glance, { kind: 'idea', headline: 'Spotlight: Quill', bullets: [] });
  const c = toCandidate('showrunner', { speak: true, advice: 'Move on', needs_spotlight: 'nobody' }, { now: T });
  assert.deepEqual(c.glance, { kind: 'idea', headline: 'Move on', bullets: [] });
});

await test('stall: headline = offer, bullets = why_now; its own kind stays complication | clue (the Rack reads it), never idea', () => {
  const s = toStall({ stalled: true, kind: 'clue', offer: 'A stranger offers a lead', why_now: 'Nobody has spoken for a minute' }, { now: T });
  assert.equal(s.kind, 'clue'); assert.equal(s.headline, 'A stranger offers a lead'); assert.deepEqual(s.bullets, ['Nobody has spoken for a minute']);
  assert.equal(toStall({ stalled: true, kind: 'whatever', offer: 'x', why_now: '' }, { now: T }).kind, 'complication');
  assert.deepEqual(toStall({ stalled: true, kind: 'clue', offer: 'x', why_now: '' }, { now: T }).bullets, []);
});

await test('meanwhile -> idea: headline = the first sentence; bullets = the rest, then the suggested tick', () => {
  const m = toMeanwhile({ faction: 'The Lamplighters', cutaway: 'Their runners post a watch at the quay. The harbour office is shut early.', clock: 'Seal the quay', suggest_ticks: 2, why: 'x' });
  assert.equal(m.kind, 'idea'); assert.equal(m.headline, 'Their runners post a watch at the quay.');
  assert.deepEqual(m.bullets, ['The harbour office is shut early.', 'Tick Seal the quay +2']);
  const n = toMeanwhile({ cutaway: 'One short line', suggest_ticks: 0 });
  assert.deepEqual([n.headline, n.bullets], ['One short line', []]);
});

await test('handout -> idea: "Show handout: <title>?" with the title from the live part (the id when it has none); bullets = why', () => {
  const part = { items: [{ id: 'torn-map', title: 'Torn map', file: 'a.png' }, { id: 'receipt', file: 'b.png' }] };
  const ids = handoutIds(part), titles = handoutTitles(part);
  assert.deepEqual([...titles], [['torn-map', 'Torn map']]);
  assert.deepEqual(toHandout({ handout_id: 'torn-map', handout_why: 'They found the route' }, ids, titles), { id: 'torn-map', why: 'They found the route', kind: 'idea', headline: 'Show handout: Torn map?', bullets: ['They found the route'] });
  assert.equal(toHandout({ handout_id: 'receipt', handout_why: '' }, ids, titles).headline, 'Show handout: receipt?');
  assert.equal(handoutTitles(null).size, 0);
});

await test('voice -> say: the answer gains kind and nothing else of the glance (it keeps its Rack layout)', () => {
  const v = toVoice({ who: 'Mrs Test', want: 'to be paid', line_a: 'Pay up, dear.', line_b: '' }, { now: T });
  assert.deepEqual(Object.keys(v).sort(), ['keys', 'lines', 'want', 'who']);
  assert.equal(GLANCE_KIND.voice, 'say'); assert.equal(GLANCE_KIND.fixer, 'say');
});

// ---------- old rows ----------
await test('restoreGlance: a row with no glance fields gives { kind by seat, headline: text, bullets: [] }; a ref, a clerk and an Editor row each', () => {
  const long = 'Q'.repeat(200);
  assert.deepEqual(restoreGlance({ text: long, shown: 1 }, 'ref'), { kind: 'rule', headline: long, bullets: [] }, 'whole text, not clipped');
  assert.deepEqual(restoreGlance({ text: 'New name: Zarbo' }, 'clerk'), { kind: 'note', headline: 'New name: Zarbo', bullets: [] });
  assert.deepEqual(restoreGlance({ text: 'Push next: x', glance: {} }, 'mystery'), { kind: 'idea', headline: 'Push next: x', bullets: [] }, 'an empty glance is no glance');
  assert.deepEqual(restoreGlance({ text: 'x', glance: { kind: 'bogus', headline: 'H', bullets: ['b', 3] } }, 'clerk'), { kind: 'note', headline: 'H', bullets: ['b'] }, 'an unknown kind falls back to the seat\'s');
});

await test('the glance of a candidate survives pendingRefs (a held Ref card keeps its fields)', () => {
  const c = toCandidate('ref', SLIP, { now: T });
  const rows = [{ at: T, card: { text: c.text, keys: c.keys, detail: c.detail, glance: c.glance, held: 1 } }];
  const [p] = pendingRefs(rows, { now: T + MIN });
  assert.deepEqual(p.glance, c.glance);
  assert.deepEqual(merge([p], { now: T + MIN }).card.glance, c.glance);
  const [old] = pendingRefs([{ at: T, card: { text: c.text, keys: c.keys, detail: c.detail, held: 1 } }], { now: T + MIN });
  assert.ok(!('glance' in old), 'an older held row has none; the answer restores one from the text');
});

// ---------- the handler: tick, fit and GET /cards ----------
const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
const REPLIES = () => ({
  tripwire: { ...NONE, roll_talk: true },
  ref: SLIP,
  ledger: { events: [{ at: '21:14', who: 'Quill', kind: 'stress', note: '+2' }], xp_totalled: false },
  clerk: { new_names: [], drift: [], clues_landed: [] },
  voice: { who: 'Mrs Test', want: 'to be paid', line_a: 'Pay up, dear.', line_b: 'I could forget I saw you.' },
  fixer: { read: 'Quill, quay, risky standard', one_three: 'a', four_five: 'b', six: 'c', crit: 'd', bargain: 'e' },
  stall: { stalled: true, kind: 'clue', offer: 'A stranger offers a lead', why_now: 'Nobody has spoken for a minute' },
  showrunner: { spotlight: [], needs_spotlight: '', beat: 'rising', elapsed_minutes: 30, advice: '', speak: false },
  mystery: { known: [], theories: [], push_next: 'The ferryman mentions the second key', must_land_item: '#2 The second key', how: 'Let him drop it.', handout_id: 'torn-map', handout_why: 'They found the route' },
  scribe: { story: 'The crew met a fence.', corrections: [] },
  meanwhile: { faction: 'The Lamplighters', cutaway: 'Their runners post a watch at the quay. The harbour office is shut.', clock: 'Seal the quay', suggest_ticks: 1, why: 'they know' },
});
function fakeClient(replies, calls) {
  return { messages: { async create(req) {
    const texts = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
    const seat = Object.keys(SEATS).find((k) => texts[0].startsWith(SEATS[k].instructions)) || 'other';
    calls.push(seat);
    return { content: [{ type: 'text', text: JSON.stringify(replies[seat]) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
  } } };
}
const clock = { t: T };
async function setup(wakes) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const calls = [], replies = REPLIES();
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ASSIST_CAP_USD: '20' };
  const handler = makeHandler({ clientFor: () => fakeClient(replies, calls), now: () => clock.t, ...(wakes ? { wakes } : {}) });
  const lines = (n) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: n }, (_, i) => ({ id: 'l' + Math.random().toString(36).slice(2, 10) + i, at: iso(clock.t - 20_000 + i), session: '3', conn: 'x', speaker: 0, text: 'we roll the dice now ' + i, kind: 'line' })) }));
  const req = (action, method, b, qs = '') => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action + qs, { method, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) }), env, data: { me: GM } });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  return { exec, db, calls, replies, env, handler, lines, req, rows };
}
const body = async (res) => JSON.parse(await res.text());
const LEGACY = { ref: WAKES.ref, clerk: WAKES.clerk, ledger: WAKES.ledger, voice: WAKES.voice };

await test('tick -> GET /cards round trip: the Ref card, the Ledger update and the Voice answer carry the glance, and the restored card has the very same fields', async () => {
  clock.t = Date.parse('2030-05-05T11:00:00.000Z');
  const s = await setup(LEGACY);
  s.replies.tripwire = { ...NONE, roll_talk: true, npc_change: true };
  await s.lines(3);
  const tick = await body(await s.req('tick', 'POST', { npc: 'Mrs Test' }));
  assert.equal(tick.cards.length, 1);
  const c = tick.cards[0];
  assert.equal(c.seat, 'ref'); assert.equal(c.text, SLIP.card); assert.equal(c.kind, 'rule'); assert.equal(c.headline, SLIP.card);
  assert.deepEqual(c.bullets, ['[21:14] rolled before naming the risk', 'Name position and effect first (p.32)']); assert.equal(c.cite, 'p.32');
  assert.deepEqual(c.detail, { said_at: '21:14', rule: SLIP.rule }, 'detail is unchanged');
  assert.ok(!('secret' in c));
  assert.equal(tick.updates.length, 1);
  assert.deepEqual([tick.updates[0].kind, tick.updates[0].headline, tick.updates[0].bullets], ['note', tick.updates[0].text, []]);
  assert.equal(tick.voice.kind, 'say'); assert.deepEqual(tick.voice.lines, ['Pay up, dear.', 'I could forget I saw you.']); assert.equal(tick.voice.who, 'Mrs Test');
  // the log stored it: the row carries the glance, and the reload reads it back
  const logged = JSON.parse(s.rows().find((r) => r.seat === 'ref').card);
  assert.deepEqual(logged.glance, { kind: 'rule', headline: SLIP.card, bullets: c.bullets, cite: 'p.32' });
  const back = await body(await s.req('cards', 'GET'));
  assert.equal(back.cards.length, 1);
  const b = back.cards[0];
  assert.equal(b.text, c.text); assert.equal(b.at, c.at);
  assert.deepEqual([b.kind, b.headline, b.bullets, b.cite], [c.kind, c.headline, c.bullets, c.cite], 'restored in the same shape');
  assert.deepEqual(b.detail, c.detail);
  assert.deepEqual([back.updates[0].kind, back.updates[0].headline, back.updates[0].bullets], ['note', tick.updates[0].text, []]);
});

await test('tick: a Ref card with a check from the seat carries it into the answer and the reload', async () => {
  clock.t = Date.parse('2030-05-05T12:00:00.000Z');
  const s = await setup(LEGACY);
  s.replies.ref = { ...SLIP, check: 'order' };
  await s.lines(3);
  const tick = await body(await s.req('tick', 'POST', {}));
  assert.equal(tick.cards[0].check, 'order');
  assert.equal((await body(await s.req('cards', 'GET'))).cards[0].check, 'order');
});

await test('a held Ref card shown on a later tick keeps its glance, in the answer and after a reload', async () => {
  clock.t = Date.parse('2030-05-05T13:00:00.000Z');
  const s = await setup(LEGACY);
  await s.lines(3);
  const first = await body(await s.req('tick', 'POST', {}));
  assert.equal(first.cards.length, 1);
  // a second, different slip two minutes later is held back by the five-minute gap
  s.replies.ref = { slip: true, said_at: '21:16', what_was_said: 'stress paid twice', rule: 'Stress is paid once (p.20)', card: 'Stress was paid twice' };
  clock.t += 2 * MIN; await s.lines(3);
  const held = await body(await s.req('tick', 'POST', {}));
  assert.deepEqual(held.cards, []);
  assert.equal(JSON.parse(s.rows().filter((r) => r.seat === 'ref').pop().card).held, 1);
  // the table goes quiet for the Ref; four minutes on the gap has opened and the held card is shown from the log
  s.replies.ref = { slip: false, said_at: '', what_was_said: '', rule: '', card: '' };
  clock.t += 3.2 * MIN; await s.lines(3);
  const later = await body(await s.req('tick', 'POST', {}));
  assert.equal(later.cards.length, 1, JSON.stringify(later.cards));
  const c = later.cards[0];
  assert.equal(c.text, 'Stress was paid twice');
  assert.deepEqual([c.kind, c.headline, c.bullets, c.cite], ['rule', 'Stress was paid twice', ['[21:16] stress paid twice', 'Stress is paid once (p.20)'], 'p.20']);
  const back = (await body(await s.req('cards', 'GET'))).cards.find((x) => x.text === 'Stress was paid twice');
  assert.deepEqual([back.kind, back.headline, back.bullets, back.cite], [c.kind, c.headline, c.bullets, c.cite], 'the Editor\'s own row carries it too');
});

await test('GET /cards: log rows from before the glance (a ref row, a clerk row, an Editor row, a ledger row) restore as { kind by seat, headline: text, bullets: [] }', async () => {
  const s = await setup(LEGACY);
  const ins = (at, seat, card) => s.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '3', ?2, 'm', 'low', 0, '', ?3)").bind(iso(at), seat, JSON.stringify(card)).run();
  const now = Date.parse('2030-05-05T14:00:00.000Z');
  await ins(now - 5 * MIN, 'ref', { text: 'Old ref line', keys: ['ref:a'], shown: 1, detail: { said_at: '20:00', rule: 'Old rule (p.5)' } });
  await ins(now - 4 * MIN, 'clerk', { text: 'New name: Corva', keys: ['clerk:name:corva'], shown: 1 });
  await ins(now - 3 * MIN, 'editor', { seat: 'ref', text: 'Old held line', keys: ['ref:b'], shown: 1, from_pending: 1 });
  await ins(now - 2 * MIN, 'ledger', { update: 1, text: 'Quill stress +2', keys: ['ledger:x'], items: [{ key: 'ledger:x', text: 'Quill stress +2' }] });
  const out = await nightCards(s.db, 'c', { now });
  const by = (t) => out.cards.find((c) => c.text === t);
  assert.deepEqual([by('Old ref line').kind, by('Old ref line').headline, by('Old ref line').bullets], ['rule', 'Old ref line', []]);
  assert.ok(!('cite' in by('Old ref line')), 'no glance, no cite (the panel still finds one in detail.rule)');
  assert.deepEqual([by('New name: Corva').kind, by('New name: Corva').headline, by('New name: Corva').bullets], ['note', 'New name: Corva', []]);
  assert.deepEqual([by('Old held line').seat, by('Old held line').kind, by('Old held line').headline, by('Old held line').bullets], ['ref', 'rule', 'Old held line', []], 'an Editor row is a ref');
  assert.deepEqual([out.updates[0].kind, out.updates[0].headline, out.updates[0].bullets], ['note', 'Quill stress +2', []]);
  assert.deepEqual(by('Old ref line').detail, { said_at: '20:00', rule: 'Old rule (p.5)' }, 'the older fields stay');
});

await test('fit: the Fixer card is a say with its read as the headline and no bullets; the model\'s own fields cannot override them', async () => {
  clock.t = Date.parse('2030-05-05T15:00:00.000Z');
  const s = await setup(LEGACY);
  s.replies.fixer = { ...REPLIES().fixer, kind: 'warn', headline: 'injected', bullets: ['injected'] };
  await s.lines(3);
  const out = await body(await s.req('fit', 'POST', { position: 'risky', draws: { low: 'Lost opportunity: the way in is shut.', mid: 'Complication: a second watcher arrives.' } }));
  assert.equal(out.cards.length, 1);
  const c = out.cards[0];
  assert.equal(c.seat, 'fixer'); assert.equal(c.text, 'Quill, quay, risky standard'); assert.equal(c.kind, 'say'); assert.equal(c.headline, 'Quill, quay, risky standard'); assert.deepEqual(c.bullets, []);
  assert.equal(c.one_three, 'a', 'the Fixer\'s own fields stay');
});

await test('tick: Mystery\'s card and handout, Stall and Meanwhile carry the glance; Stall\'s kind stays clue; the handout headline uses the live title', async () => {
  clock.t = Date.parse('2030-05-05T16:00:00.000Z');
  const s = await setup({ mystery: WAKES.mystery, stall: WAKES.stall, meanwhile: WAKES.meanwhile, ref: WAKES.ref });
  s.exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'handouts', 'v', '{}', 0, ?)").run(JSON.stringify({ v: 1, items: [{ id: 'torn-map', title: 'Torn map', file: 'a.png' }] }));
  s.replies.tripwire = { ...NONE, clue_mention: true, stall: true, scene_change: true };
  s.replies.ref = { ...SLIP, slip: false };
  await s.lines(3);
  const tick = await body(await s.req('tick', 'POST', {}));
  assert.equal(tick.cards.length, 1); const c = tick.cards[0];
  assert.deepEqual([c.seat, c.kind, c.headline, c.bullets], ['mystery', 'idea', 'The ferryman mentions the second key', ['Let him drop it.', 'Must land: #2 The second key']]);
  assert.match(c.text, /^Push next: /);
  assert.deepEqual([tick.handout.id, tick.handout.kind, tick.handout.headline, tick.handout.bullets, tick.handout.why], ['torn-map', 'idea', 'Show handout: Torn map?', ['They found the route'], 'They found the route']);
  assert.deepEqual([tick.stall.kind, tick.stall.headline, tick.stall.bullets, tick.stall.offer], ['clue', 'A stranger offers a lead', ['Nobody has spoken for a minute'], 'A stranger offers a lead']);
  assert.deepEqual([tick.meanwhile.kind, tick.meanwhile.headline, tick.meanwhile.bullets], ['idea', 'Their runners post a watch at the quay.', ['The harbour office is shut.', 'Tick Seal the quay +1']]);
  assert.equal(tick.meanwhile.cutaway, 'Their runners post a watch at the quay. The harbour office is shut.', 'the older fields stay');
});

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
