// S7: the tick's D1 round trips are pinned. A tick used to make 19-21 D1 calls; Workers Free gives a request 10 ms of CPU and every D1 call
// costs about 0.2 ms of it, so the reads that do not depend on each other now travel in one db.batch. This counts round trips (a batch is one;
// memoryExec's `calls`) and statements (every prepare) on an in-memory D1 with a FAKE Anthropic client. A new read in the tick path should join
// an existing batch (functions/api/gm/assist.js: tickStart, the readAll after the cooldown map, the readNamed before the seats and the one after).
// If a count here must go up, say why in the commit. No network and no key; every name and sentence is invented.
//   node checks/runtime/gm-assist-d1.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { makeHandler } from '../../functions/api/gm/assist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const GM = { role: 'gm', id: 'gm@example.test' };
const T = Date.parse('2030-01-01T09:30:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const FLAGS = ['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall', 'downtime'];
const quiet = Object.fromEntries(FLAGS.map((f) => [f, false]));
const loud = Object.fromEntries(FLAGS.map((f) => [f, true]));
const REPLY = {
  ref: { slip: true, said_at: '09:29', what_was_said: 'rolled first', rule: 'Position comes before the roll (p.9)', check: 'order', card: 'Position was named after the roll' },
  ledger: { events: [], xp_totalled: false },
  clerk: { new_names: [], drift: [], clues_landed: [] },
  voice: { who: 'Mrs Test', want: 'to be paid', line_a: 'Pay up, dear.', line_b: 'I could forget I saw you.' },
  stall: { stalled: false, kind: 'none', offer: '', why_now: '' },
  showrunner: { spotlight: [], needs_spotlight: '', beat: 'rising', elapsed_minutes: 30, advice: '', speak: false },
  mystery: { known: ['the lantern is old'], theories: [], push_next: '', must_land_item: '', how: 'none', handout_id: 'h1', handout_why: 'cue' },
  scribe: { story: 'They met at the gate.', corrections: [] },
  meanwhile: { faction: 'Test Faction', cutaway: 'Elsewhere, a lamp is lit.', clock: 'Test clock', ticks: 1, why: 'time passes' },
};
// onCall(seat) runs as each seat call starts (the world records how many D1 scripts had run by then)
function fakeClient(tripwire, replies = REPLY, onCall = () => {}) {
  return {
    messages: {
      async create(req) {
        const ins = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text)[0];
        const seat = Object.keys(SEATS).find((k) => ins.startsWith(SEATS[k].instructions));
        onCall(seat);
        const out = seat === 'tripwire' ? tripwire : replies[seat] || {};
        return { content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
      },
    },
  };
}

// an in-memory D1 with a counting facade: `trips` is round trips (exec.batch runs once per first/all/run/batch), `statements` is every prepare
// calm: the Showrunner ran a minute ago, so its 10-minute cooldown keeps it (and the wide transcript read it brings) out of the tick
async function world({ tripwire = quiet, lines = 90, logRows = 150, wakes = WAKES, replies = REPLY, calm = false } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const inner = asD1(exec);
  let statements = 0;
  const db = { prepare: (sql) => { statements++; return inner.prepare(sql); }, batch: (s) => inner.batch(s) };
  const clock = { t: T };
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ASSIST_CAP_USD: '20' };
  exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?)").run(JSON.stringify({ file_id: 'file_test000001', extra: {} }));
  exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'handouts', 'v', '{}', 0, ?)").run(JSON.stringify({ items: [{ id: 'h1', title: 'A map', cue: 'the map comes out' }] }));
  const rows = Array.from({ length: lines }, (_, i) => ({ id: 'l' + i, at: iso(T - (lines - i) * 2500), session: '3', conn: 'x', speaker: i % 3, text: 'we talk about a rope and a lantern ' + i }));
  if (rows.length) await addLines(inner, 'c', cleanLines({ lines: rows.slice(0, 50) })), await addLines(inner, 'c', cleanLines({ lines: rows.slice(50) }));
  const ins = exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?, '3', ?, 'm', 'low', 0.5, '', ?)");
  for (let i = 0; i < logRows; i++) ins.run(iso(T - (i + 2) * 120000), i % 4 === 0 ? 'ask' : i % 4 === 1 ? 'tripwire' : i % 4 === 2 ? 'ref' : 'voice', JSON.stringify(i % 4 === 0 ? { ask: 1, q: 'Earlier question', text: 'Earlier answer', shown: 1 } : { out: { a: 1 }, shown: 1 }));
  if (calm) ins.run(iso(T - 60000), 'showrunner', JSON.stringify({ out: { a: 1 }, shown: 0 }));
  const callStarts = [];          // exec.log.length when each seat call began
  const handler = makeHandler({ clientFor: () => fakeClient(tripwire, replies, () => callStarts.push(exec.log.length)), now: () => clock.t, wakes });
  const post = (action, body) => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' } }), env, data: { me: GM } });
  // the first request pays the once-per-isolate schema batch: it is not the tick's, so the counts are taken around the one under test
  await handler({ request: new Request('https://blades.example.test/api/gm/assist/cards'), env, data: { me: GM } });
  const measure = async (action, body) => {
    const t0 = exec.calls, s0 = statements, l0 = exec.log.length;
    callStarts.length = 0;
    const res = await post(action, body);
    const seats = exec.db.prepare('SELECT seat FROM gm_assist_log WHERE id > ?').all(logRows + (calm ? 1 : 0)).map((r) => r.seat);
    return { res, json: await res.json(), trips: exec.calls - t0, statements: statements - s0, scripts: exec.log.slice(l0), callStarts: callStarts.slice(), l0, seats };
  };
  return { exec, measure, post, clock, last: () => exec.db.prepare('SELECT MAX(seq) AS m FROM gm_transcript').get().m };
}

await test('a tick that wakes the usual seats makes 7 D1 round trips, with or without a cursor (it made 19 and 21)', async () => {
  const w = await world({ tripwire: { ...quiet, roll_talk: true, npc_change: true } });
  const a = await w.measure('tick', { npc: 'Mrs Test' });
  assert.equal(a.res.status, 200);
  assert.equal(a.trips, 7, 'no cursor: opening batch, cooldowns, Tripwire row, pre-seat batch, Scribe slice, post-seat batch, final write');
  const w2 = await world({ tripwire: { ...quiet, roll_talk: true, npc_change: true } });
  const b = await w2.measure('tick', { npc: 'Mrs Test', after: 40 });
  assert.equal(b.res.status, 200);
  assert.equal(b.trips, 7, 'a good cursor adds a statement to the opening batch, not a round trip');
  assert.equal(a.statements, 21, 'statements: 5 opening + 2 cooldowns + 1 Tripwire row + 2 pre-seat + 1 slice + 5 post-seat + 5 rows');
  assert.equal(b.statements, 22, 'the cursor adds exactly one statement');
});

await test('worst case, every flag set and every seat woken (Mystery names a handout): still 7 round trips', async () => {
  const w = await world({ tripwire: loud });
  const a = await w.measure('tick', { npc: 'Mrs Test', after: 10 });
  assert.equal(a.res.status, 200);
  const seats = new Set(w.exec.db.prepare("SELECT seat FROM gm_assist_log WHERE id > 150").all().map((r) => r.seat));
  for (const s of ['tripwire', 'showrunner', 'mystery', 'scribe']) assert.ok(seats.has(s), s + ' ran: ' + [...seats].join(','));
  assert.equal(a.trips, 7);
});

await test('a tick with nothing new and Listening off makes one round trip', async () => {
  const w = await world();
  const a = await w.measure('tick', { after: w.last() });
  assert.equal(a.res.status, 200);
  assert.deepEqual(a.json.cards, []);
  assert.equal(a.trips, 1);
});

await test('the cooldown map and the previous Tripwire row are read together, before the Tripwire runs', async () => {
  const w = await world({ tripwire: quiet });
  const log0 = w.exec.log.length;
  await w.post('tick', {});
  const sqls = w.exec.log.slice(log0);
  const iCool = sqls.findIndex((s) => /GROUP BY seat/.test(s)), iPrev = sqls.findIndex((s) => /seat = 'tripwire' ORDER BY id DESC LIMIT 1/.test(s)), iRow = sqls.findIndex((s) => /^\s*INSERT INTO gm_assist_log/.test(s));
  assert.ok(iCool >= 0 && iCool === iPrev, 'one script holds both reads');
  assert.ok(iRow > iCool, 'the Tripwire row is its own write, after them');
  assert.ok(!/INSERT/.test(sqls[iCool]), 'no write rides in a read batch');
});

// ---- which reads happen, and when ----
// Every statement a tick sends is in exec.log (one script per round trip). The conditional reads are told apart by their SQL.
const READS = {
  clerk: /json_each\(json_extract\(l\.card/,
  known: /seat = 'mystery' AND card IS NOT NULL/,
  clocks: /json_extract\(doc, '\$\.clocks'\)/,
  handouts: /part = 'handouts'/,
  story: /seat = 'scribe' AND json_extract\(card, '\$\.story'\)/,
  shown: /json_extract\(card, '\$\.update'\) = 1\)/,                       // the Editor's "cards the GM was shown": the post-seat batch
  voice: /json_extract\(card, '\$\.voice'\) = 1 OR json_extract\(card, '\$\.stall'\) = 1/,
};
const TRANSCRIPT_SINCE = /FROM gm_transcript WHERE campaign = '[^']*' AND at >= /g;     // the tail, the Scribe's first slice, the wide read
const countOf = (m, re) => (m.scripts.join('\n').match(re) || []).length;
const SCENARIOS = [
  // name, tripwire flags, options, the seats that must have a row afterwards, the conditional reads that appear (each once), transcript-since reads, exact statements
  { name: 'no Clerk, no Mystery, no Meanwhile, Showrunner cooling down', trip: { roll_talk: true }, calm: true, seats: ['tripwire', 'ref', 'ledger', 'scribe', 'voice'], reads: ['story', 'voice'], since: 2, statements: 19 },
  { name: 'the Showrunner awake brings the wide transcript read and nothing else', trip: { roll_talk: true }, calm: false, seats: ['tripwire', 'ref', 'ledger', 'showrunner', 'scribe', 'voice'], reads: ['story', 'voice'], since: 3, statements: 21 },
  { name: 'Clerk wakes: its names are read, nothing else is', trip: { new_name: true }, calm: true, seats: ['tripwire', 'clerk', 'scribe', 'voice'], reads: ['clerk', 'story', 'voice'], since: 2, statements: 19 },
  // a clue mention wakes Clerk as well as Mystery (WAKES), so these two carry the Clerk's read and row too
  { name: 'Mystery wakes and names a handout: what it knew, the wide read and the handouts part', trip: { clue_mention: true }, calm: true, seats: ['tripwire', 'mystery', 'clerk', 'scribe', 'voice'], reads: ['known', 'clerk', 'handouts', 'story', 'voice'], since: 3, statements: 23 },
  { name: 'Mystery wakes and names none: no handouts read', trip: { clue_mention: true }, calm: true, replies: { mystery: { ...REPLY.mystery, handout_id: '' } }, seats: ['tripwire', 'mystery', 'clerk', 'scribe', 'voice'], reads: ['known', 'clerk', 'story', 'voice'], since: 3, statements: 22 },
  { name: 'Meanwhile wakes: the clocks and the wide read', trip: { scene_change: true }, calm: true, seats: ['tripwire', 'meanwhile', 'scribe', 'voice'], reads: ['clocks', 'story', 'voice'], since: 3, statements: 20 },
];
for (const sc of SCENARIOS) {
  await test('reads: ' + sc.name, async () => {
    const w = await world({ tripwire: { ...quiet, ...sc.trip }, calm: sc.calm, ...(sc.replies ? { replies: { ...REPLY, ...sc.replies } } : {}) });
    const m = await w.measure('tick', { npc: 'Mrs Test' });
    assert.equal(m.res.status, 200);
    assert.deepEqual([...new Set(m.seats)].sort(), sc.seats.slice().sort(), 'the seats that ran');
    for (const k of Object.keys(READS)) if (k !== 'shown') assert.equal(countOf(m, new RegExp(READS[k].source, 'g')), sc.reads.includes(k) ? 1 : 0, k + ' read');
    assert.equal(countOf(m, TRANSCRIPT_SINCE), sc.since, 'transcript reads by time');
    assert.equal(m.statements, sc.statements, 'statements');
    assert.equal(m.trips, 7, 'round trips');
    // the post-seat batch is read after every seat call has started, never hoisted above them
    const iShown = m.scripts.findIndex((s) => READS.shown.test(s));
    assert.ok(iShown >= 0 && m.callStarts.length >= 3, 'the post-seat batch ran, after ' + m.callStarts.length + ' seat calls');
    assert.ok(m.l0 + iShown >= Math.max(...m.callStarts), 'post-seat batch at script ' + (m.l0 + iShown) + ', last seat call started at ' + Math.max(...m.callStarts));
  });
}

await test('a bad cursor or a bad rolled is still a 400', async () => {
  const w = await world();
  for (const bad of [-1, 1.5, 'x']) await assert.rejects(() => w.post('tick', { after: bad }), (e) => e.status === 400, String(bad));
  await assert.rejects(() => w.post('tick', { rolled: 'yes' }), (e) => e.status === 400);
});

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
