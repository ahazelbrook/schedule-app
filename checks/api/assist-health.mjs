// The tick answer's `health` (S1 and P5): { skipped, reaped, ran }, all arrays. `ran` names the seats whose call came back with an answer; the
// panel's seat dots depend on it, because a seat that was not woken is in neither of the other two lists. In process with a fake `call`
// and an in-memory D1: no network, no key. Every name and sentence is invented.
//   node checks/api/assist-health.mjs     (part of npm run check:api)
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { SEATS } from '../../functions/_lib/assist/seats.js';
import { makeHandler } from '../../functions/api/gm/assist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GM = { role: 'gm', id: 'gm@example.test' };
let t = Date.parse('2030-01-01T09:30:00.000Z'), failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
const REPLIES = {
  tripwire: { ...NONE, roll_talk: true },
  ref: { slip: true, said_at: '09:29', what_was_said: 'rolled first', rule: 'Position comes before the roll (p.9)', card: 'Position was named after the roll' },
  ledger: { events: [], xp_totalled: false },
};
const result = (json) => ({ json, text: JSON.stringify(json), usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, cost: 0.01, stop: 'end_turn', secs: 0.1 });
const seatOf = (args) => Object.keys(SEATS).find((k) => args.instructions.startsWith(SEATS[k].instructions));

async function tick({ talk }) {
  t += 3_600_000;
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000' };
  const called = [];
  const call = async (client, args) => { const s = seatOf(args); called.push(s); return result(REPLIES[s] || {}); };
  const handler = makeHandler({ clientFor: () => ({}), now: () => t, call });
  if (talk) await addLines(db, 'c', cleanLines({ lines: Array.from({ length: 3 }, (_, i) => ({ id: 'l' + Math.random().toString(36).slice(2, 10) + i, at: new Date(t - 20_000 + i).toISOString(), session: '3', conn: 'x', speaker: 0, text: 'we roll the dice now and see what happens' })) }, { now: t }));
  const res = await handler({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: JSON.stringify({ after: 0 }), headers: { 'Content-Type': 'application/json' } }), env, data: { me: GM }, waitUntil() {} });
  return { out: JSON.parse(await res.text()), called };
}

await test('a quiet tick answers with health.ran as an array (nothing ran)', async () => {
  const { out, called } = await tick({ talk: false });
  assert.ok(out.health && Array.isArray(out.health.ran), 'ran is present and an array');
  assert.ok(Array.isArray(out.health.skipped) && Array.isArray(out.health.reaped));
  assert.deepEqual(out.health.ran, []); assert.deepEqual(called, []);
});

await test('a tick that called the Tripwire and Ref names exactly the seats whose call came back', async () => {
  const { out, called } = await tick({ talk: true });
  assert.ok(Array.isArray(out.health.ran));
  assert.ok(called.includes('tripwire'), 'the fake Tripwire was called');
  assert.ok(out.health.ran.includes('tripwire'), 'and is in ran');
  assert.deepEqual([...out.health.ran].sort(), [...new Set(called)].sort(), 'ran is the seats that were called and answered');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
