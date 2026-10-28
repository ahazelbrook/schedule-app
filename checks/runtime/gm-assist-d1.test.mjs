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
function fakeClient(tripwire) {
  return {
    messages: {
      async create(req) {
        const ins = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text)[0];
        const seat = Object.keys(SEATS).find((k) => ins.startsWith(SEATS[k].instructions));
        const out = seat === 'tripwire' ? tripwire : REPLY[seat] || {};
        return { content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
      },
    },
  };
}

// an in-memory D1 with a counting facade: `trips` is round trips (exec.batch runs once per first/all/run/batch), `statements` is every prepare
async function world({ tripwire = quiet, lines = 90, logRows = 150, wakes = WAKES } = {}) {
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
  const handler = makeHandler({ clientFor: () => fakeClient(tripwire), now: () => clock.t, wakes });
  const post = (action, body) => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' } }), env, data: { me: GM } });
  // the first request pays the once-per-isolate schema batch: it is not the tick's, so the counts are taken around the one under test
  await handler({ request: new Request('https://blades.example.test/api/gm/assist/cards'), env, data: { me: GM } });
  const measure = async (action, body) => {
    const t0 = exec.calls, s0 = statements;
    const res = await post(action, body);
    return { res, json: await res.json(), trips: exec.calls - t0, statements: statements - s0 };
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
  assert.ok(a.statements <= 24 && b.statements <= 26, 'statements ' + a.statements + ' / ' + b.statements);
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

await test('a bad cursor or a bad rolled is still a 400', async () => {
  const w = await world();
  for (const bad of [-1, 1.5, 'x']) await assert.rejects(() => w.post('tick', { after: bad }), (e) => e.status === 400, String(bad));
  await assert.rejects(() => w.post('tick', { rolled: 'yes' }), (e) => e.status === 400);
});

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
