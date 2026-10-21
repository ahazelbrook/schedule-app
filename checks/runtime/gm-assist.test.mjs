// Claude at the table, GM side (the assist build plan, Phase 1): the Conductor and Editor (pure), and POST /api/gm/assist/{tick,fit}
// on an in-memory D1 with a FAKE Anthropic client. No network and no key: nothing here can reach the API. Every name and
// sentence is invented.
//   node checks/runtime/gm-assist.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { decide, budgetTier, canRun, isRepeatSlip, slipKeys, COOLDOWN_MS, DEFAULT_CAP } from '../../functions/_lib/assist/conductor.js';
import { toCandidate, merge, pendingRefs, CARD_GAP_MS, STALE_MS } from '../../functions/_lib/assist/editor.js';
import { callSeat, countTokens } from '../../functions/_lib/assist/claude.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { makeHandler, cleanDraws, DRAW_MAX, onRequest as realHandler } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';
import { gmNotFound } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// ---------- the Conductor ----------
const T = 1_000_000_000_000;

await test('budget ladder: all under 60%, reduced to 85%, core to 100%, off at the cap (and with no cap)', () => {
  assert.equal(DEFAULT_CAP, 20);
  const tiers = [0, 11.99, 12, 16.99, 17, 19.99, 20, 25].map((s) => budgetTier(s, 20));
  assert.deepEqual(tiers, ['all', 'all', 'reduced', 'reduced', 'core', 'core', 'off', 'off']);
  assert.equal(budgetTier(0, 0), 'off');
  assert.equal(budgetTier(5), 'all', 'the default cap is $20');
  assert.equal(budgetTier(12), 'reduced');
});

await test('ladder: reduced drops Meanwhile, Showrunner and Mystery; core keeps the Fixer, Ref and Ledger only; off keeps nothing', () => {
  const wakes = { ref: ['a'], clerk: ['a'], ledger: ['a'], showrunner: ['a'], mystery: ['a'], meanwhile: ['a'], fixer: ['a'] };
  const run = (spent) => decide({ flags: ['a'], now: T, spent, cap: 20, wakes }).seats;
  assert.deepEqual(run(0), ['ref', 'clerk', 'ledger', 'showrunner', 'mystery', 'meanwhile', 'fixer']);
  assert.deepEqual(run(13), ['ref', 'clerk', 'ledger', 'fixer']);
  assert.deepEqual(run(18), ['ref', 'ledger', 'fixer']);
  assert.deepEqual(run(20), []);
});

await test('flags wake seats through WAKES; no flag, no call', () => {
  assert.deepEqual(decide({ flags: [], now: T }).seats, []);
  assert.deepEqual(decide({ flags: ['scene_change', 'stall'], now: T }).seats, []);
  assert.deepEqual(decide({ flags: ['roll_talk'], now: T }).seats, ['ref', 'ledger']);
  assert.deepEqual(decide({ flags: ['new_name'], now: T }).seats, ['clerk']);
  assert.deepEqual(decide({ flags: ['harm', 'clue_mention'], now: T }).seats, ['ref', 'clerk', 'ledger']);
});

await test('one of each in flight, and a per-seat cooldown', () => {
  let d = decide({ flags: ['harm'], now: T, inFlight: new Set(['ref']) });
  assert.deepEqual(d.seats, ['ledger']);
  assert.deepEqual(d.skipped, [{ seat: 'ref', why: 'in-flight' }]);
  d = decide({ flags: ['harm'], now: T, inFlight: ['ledger'] });
  assert.deepEqual(d.seats, ['ref']);
  d = decide({ flags: ['harm'], now: T, lastRun: { ref: T - COOLDOWN_MS.ref + 1, ledger: T - COOLDOWN_MS.ledger } });
  assert.deepEqual(d.seats, ['ledger'], 'the ref is cooling down, the ledger just clear of it');
  assert.deepEqual(d.skipped, [{ seat: 'ref', why: 'cooldown' }]);
  assert.equal(canRun('fixer', { now: T, tier: 'core' }).ok, true);
  assert.equal(canRun('fixer', { now: T, tier: 'off' }).why, 'budget');
  assert.equal(canRun('tripwire', { now: T, tier: 'core' }).ok, true, 'the tripwire gates the others, so it runs until the cap');
});

await test('a Ref card that repeats the same slip within 10 minutes is suppressed', () => {
  const slip = { slip: true, said_at: '22:14', what_was_said: 'x', rule: 'Harm penalty (p.152)', card: 'No penalty for harm' };
  assert.deepEqual(slipKeys(slip), ['ref:at:22 14', 'ref:rule:harm penalty p 152']);
  const shown = [{ at: T, keys: slipKeys(slip) }];
  assert.equal(isRepeatSlip(slip, shown, T + 60_000), true, 'the next minute');
  assert.equal(isRepeatSlip({ ...slip, said_at: '22:15' }, shown, T + 9 * 60_000), true, 'same rule, a different stamp');
  assert.equal(isRepeatSlip({ ...slip, rule: 'Position before the roll (p.9)' }, shown, T + 60_000), true, 'same stamp, a different rule');
  assert.equal(isRepeatSlip({ ...slip, said_at: '22:20', rule: 'Position before the roll (p.9)' }, shown, T + 60_000), false, 'a different slip');
  assert.equal(isRepeatSlip(slip, shown, T + 10 * 60_000), false, 'after 10 minutes it can show again');
  assert.equal(isRepeatSlip({ slip: false, said_at: '', rule: '', card: '' }, [], T), true, 'no slip means nothing to show');
});

// ---------- the Editor ----------
await test('editor: silence is normal; one card per five minutes; a slip outranks a ledger entry outranks a canon note', () => {
  assert.deepEqual(merge([], { now: T }), { card: null, updates: [], held: [], dropped: [] });
  assert.equal(toCandidate('ref', { slip: false, said_at: '', what_was_said: '', rule: '', card: '' }), null);
  assert.equal(toCandidate('clerk', { new_names: [], drift: [], clues_landed: [] }), null);
  assert.equal(toCandidate('ledger', { events: [], xp_totalled: false }), null);
  const ref = toCandidate('ref', { slip: true, said_at: '22:14', what_was_said: 'x', rule: 'Rule (p.1)', card: 'Check the rule' }, { now: T });
  const ledger = toCandidate('ledger', { events: [{ at: '22:13', who: 'Quill', kind: 'stress', note: '+2' }], xp_totalled: false }, { now: T });
  const clerk = toCandidate('clerk', { new_names: ['Zarbo'], drift: [], clues_landed: [] }, { now: T });
  let m = merge([clerk, ledger, ref], { now: T });
  assert.equal(m.card.seat, 'ref');
  assert.deepEqual(m.updates.map((u) => u.seat), ['ledger'], 'the ledger is an update, not a card');
  assert.deepEqual(m.dropped, [{ seat: 'clerk', why: 'ref-waiting' }], 'a Clerk card is dropped when a Ref card is waiting');
  m = merge([clerk, ledger], { now: T });
  assert.equal(m.card.seat, 'clerk', 'with no slip the canon note takes the slot, never the ledger');
  assert.equal(m.updates.length, 1);
  m = merge([ref], { now: T, lastShownAt: T - CARD_GAP_MS + 1000 });
  assert.equal(m.card, null);
  assert.deepEqual(m.dropped, [{ seat: 'ref', why: 'throttle' }]);
  assert.deepEqual(m.held, [ref], 'a throttled slip is held, not lost');
  assert.equal(merge([ref], { now: T, lastShownAt: T - CARD_GAP_MS }).card.seat, 'ref');
});

await test('editor: Ledger updates ignore the card gap and never use the slot', () => {
  const ledger = toCandidate('ledger', { events: [{ at: '22:13', who: 'Quill', kind: 'stress', note: '+2' }, { at: '22:14', who: 'Vex', kind: 'harm', note: 'level 1' }], xp_totalled: false }, { now: T });
  assert.equal(ledger.items.length, 2);
  const m = merge([ledger], { now: T, lastShownAt: T - 1000 });
  assert.equal(m.card, null); assert.equal(m.updates.length, 1);
  const clerk = toCandidate('clerk', { new_names: ['Zarbo'], drift: [], clues_landed: [] }, { now: T });
  assert.equal(merge([clerk], { now: T, lastShownAt: T - 1000 }).card, null, 'a Clerk card is dropped by the gap, not queued');
  assert.deepEqual(merge([clerk], { now: T, lastShownAt: T - 1000 }).held, []);
});

await test('editor: a held Ref card stays pending until stale, is not repeated, and loses to a newer slip', () => {
  const slip = { slip: true, said_at: '22:14', what_was_said: 'x', rule: 'Harm penalty (p.152)', card: 'No penalty for harm' };
  const row = { at: T, card: { text: slip.card, keys: slipKeys(slip) } };
  const p1 = pendingRefs([row], { now: T + 3 * 60_000 });
  assert.equal(p1.length, 1); assert.equal(p1[0].pending, true);
  assert.deepEqual(pendingRefs([row], { now: T + STALE_MS + 1 }), [], 'stale after four minutes');
  assert.deepEqual(pendingRefs([row], { now: T + 3 * 60_000, recent: [{ at: T + 60_000, keys: slipKeys(slip) }] }), [], 'already shown');
  let m = merge(p1, { now: T + 3 * 60_000, lastShownAt: T - 60_000 });
  assert.equal(m.card, null); assert.equal(m.held.length, 1);
  m = merge(p1, { now: T + 3 * 60_000, lastShownAt: T - CARD_GAP_MS });
  assert.equal(m.card.text, slip.card, 'shown at the next opportunity');
  const clerk = toCandidate('clerk', { new_names: ['Zarbo'], drift: [], clues_landed: [] }, { now: T });
  m = merge([clerk, ...p1], { now: T + 3 * 60_000 });
  assert.equal(m.card.seat, 'ref'); assert.deepEqual(m.dropped, [{ seat: 'clerk', why: 'ref-waiting' }]);
  const newer = toCandidate('ref', { slip: true, said_at: '22:20', what_was_said: 'y', rule: 'Position (p.9)', card: 'Position after the roll' }, { now: T + 3 * 60_000 });
  m = merge([...p1, newer], { now: T + 3 * 60_000 });
  assert.equal(m.card.text, 'Position after the roll'); assert.equal(m.held.length, 1);
  const same = toCandidate('ref', slip, { now: T + 3 * 60_000 });
  m = merge([...p1, same], { now: T + 3 * 60_000 });
  assert.equal(m.held.length, 0, 'a pending copy of a slip that is seen fresh counts once');
});

await test('editor: Clerk and Ledger items shown in the last 10 minutes are not shown again', () => {
  const clerk = { new_names: ['Zarbo', 'Mott'], drift: [], clues_landed: [] };
  const first = toCandidate('clerk', clerk, { now: T });
  assert.match(first.text, /Zarbo/);
  const recent = [{ at: T, keys: ['clerk:name:zarbo'] }];
  const second = toCandidate('clerk', clerk, { recent, now: T + 60_000 });
  assert.ok(second.text.includes('Mott') && !second.text.includes('Zarbo'), second.text);
  assert.equal(toCandidate('clerk', { new_names: ['Zarbo'], drift: [], clues_landed: [] }, { recent, now: T + 60_000 }), null);
  assert.ok(toCandidate('clerk', { new_names: ['Zarbo'], drift: [], clues_landed: [] }, { recent, now: T + 11 * 60_000 }), 'back after 10 minutes');
  const ev = { events: [{ at: '22:13', who: 'Quill', kind: 'stress', note: '+2' }], xp_totalled: true };
  const l1 = toCandidate('ledger', ev, { now: T });
  assert.equal(toCandidate('ledger', ev, { recent: [{ at: T, keys: l1.keys }], now: T + 1000 }), null);
});

// ---------- the endpoint ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-01-01T09:30:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();

function fakeClient(replies, calls) {
  // answers by which seat's instructions are in `system`; usage is fixed so the cost is checkable
  return {
    messages: {
      async create(req) {
        const texts = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
        const ins = texts[0];
        const doc = req.messages[0].content.find((b) => b.type === 'document');
        const seat = /listen to a live/.test(ins) ? 'tripwire' : /rules referee/.test(ins) ? 'ref' : /keep the canon/.test(ins) ? 'clerk' : /keep the ledger/.test(ins) ? 'ledger' : /fixer/.test(ins) ? 'fixer' : 'other';
        calls.push({ seat, max: req.max_tokens, model: req.model, effort: req.output_config.effort, cached: !!doc, doc, ins, user: texts[texts.length - 1] });
        const r = replies[seat];
        if (replies.__ms) clock.t += replies.__ms[seat] || 0;          // a fake wall-clock for the call
        if (r instanceof Error) throw r;
        return { content: [{ type: 'text', text: JSON.stringify(typeof r === 'function' ? r() : r) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: (replies.__stop && replies.__stop[seat]) || 'end_turn' };
      },
    },
  };
}
const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
const REF_SLIP = { slip: true, said_at: '09:29', what_was_said: 'rolled first', rule: 'Position comes before the roll (p.9)', card: 'Position was named after the roll' };
const REPLIES = () => ({
  tripwire: { ...NONE, roll_talk: true },
  ref: REF_SLIP,
  ledger: { events: [], xp_totalled: false },
  clerk: { new_names: [], drift: [], clues_landed: [] },
  fixer: { read: 'who, where, risky standard', one_three: 'a', four_five: 'b', six: 'c', crit: 'd', bargain: 'e' },
});

async function setup(opts = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const calls = [], replies = REPLIES();
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...(opts.env || {}) };
  const handler = makeHandler({ clientFor: () => fakeClient(replies, calls), now: () => clock.t });
  const lines = (n, extra = {}) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: n }, (_, i) => ({ id: 'l' + Math.random().toString(36).slice(2, 10) + i, at: iso(clock.t - 20_000 + i), session: '3', conn: 'x', speaker: 0, text: 'we roll the dice now ' + i, ...extra })) }));
  const post = (action, body, data = { me: GM }) => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' } }), env, data });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  return { exec, db, calls, replies, env, handler, lines, post, rows };
}
const body = async (res) => JSON.parse(await res.text());
const DRAWS = { low: 'Lost opportunity: the way in is shut.', mid: 'Complication: a second watcher arrives.' };

await test('router: /api/gm/assist/tick and /fit reach the handler, other paths under it stay the GM-only 404', () => {
  for (const p of ['/api/gm/assist/tick', '/api/gm/assist/tick/', '/api/gm/assist/fit']) assert.equal(matchApi(p).handler, realHandler, p);
  for (const p of ['/api/gm/assist', '/api/gm/assist/', '/api/gm/assist/other', '/api/gm/assist/tick/x']) assert.equal(matchApi(p).handler, gmNotFound, p);
});

await test('a player, the table display and an unknown caller get 403 on every method, before the body, the method check or the database', async () => {
  const touched = [];
  const request = (method) => ({
    method, url: 'https://blades.example.test/api/gm/assist/tick', headers: new Headers({ 'Content-Length': String(50 * 1024 * 1024) }),
    arrayBuffer() { touched.push('arrayBuffer'); throw new Error('read'); }, json() { touched.push('json'); throw new Error('read'); },
    text() { touched.push('text'); throw new Error('read'); }, get body() { touched.push('body'); return null; },
  });
  const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
  const handler = makeHandler({ clientFor: () => { touched.push('client'); throw new Error('no'); } });
  for (const h of [handler, realHandler]) {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
        let err = null;
        try { await h({ request: request(m), env, data: { me } }); } catch (e) { err = e; }
        assert.ok(err && err.status === 403, m + ': expected a 403, got ' + (err ? err.status + ' ' + err.message : 'an answer'));
      }
    }
  }
  assert.deepEqual(touched, []);
});

await test('GM: GET is 405, a bad body is 400, no key is 503, and nothing is called', async () => {
  const s = await setup();
  const get = await s.handler({ request: new Request('https://blades.example.test/api/gm/assist/tick'), env: s.env, data: { me: GM } });
  assert.equal(get.status, 405);
  await assert.rejects(s.handler({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: '[1]' }), env: s.env, data: { me: GM } }), (e) => e.status === 400);
  await assert.rejects(s.post('tick', { after: -1 }), (e) => e.status === 400);
  await assert.rejects(s.post('fit', {}), (e) => e.status === 400);
  await assert.rejects(s.post('fit', { position: 'risky' }), (e) => e.status === 400, 'no draws: a clear 400');
  const noKey = makeHandler({ now: () => clock.t });
  await assert.rejects(noKey({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: '{}' }), env: { DB: s.db, CAMPAIGN: 'c' }, data: { me: GM } }), (e) => e.status === 503 && !/sk-/.test(e.message));
  assert.equal(s.calls.length, 0);
});

await test('tick: Tripwire flags wake Ref and Ledger; the Ref slip comes back as one card; every call is logged with its cost', async () => {
  const s = await setup();
  await s.lines(3);
  const res = await s.post('tick', {});
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.deepEqual(out.flags, ['roll_talk']);
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].seat, 'ref');
  assert.equal(out.cards[0].text, REF_SLIP.card);
  assert.deepEqual(s.calls.map((c) => c.seat).sort(), ['ledger', 'ref', 'tripwire']);
  assert.ok(s.calls.every((c) => c.cached === false), 'no assist part in the pack: no prefix block');
  assert.deepEqual(out.warnings, ['no assist part in the GM pack']);
  const rows = s.rows();
  assert.deepEqual(rows.map((r) => r.seat), ['tripwire', 'ref', 'ledger']);
  const ref = rows.find((r) => r.seat === 'ref');
  assert.equal(ref.model, 'claude-sonnet-5-5');
  assert.equal(ref.effort, 'low');
  assert.equal(ref.input_tokens, 1000); assert.equal(ref.output_tokens, 200); assert.equal(ref.cache_read, 10000); assert.equal(ref.cache_write, 0);
  // sonnet: 1000*2 + 10000*0.2 + 200*10 = 6000 per million tokens -> $0.006 = 0.6 cents
  assert.ok(Math.abs(ref.cents - 0.6) < 1e-9, 'cents ' + ref.cents);
  const tw = rows.find((r) => r.seat === 'tripwire');
  // haiku: 1000*0.1 + 10000*0.01 + 200*0.5 = 300 per million -> $0.0003 = 0.03 cents
  assert.ok(Math.abs(tw.cents - 0.03) < 1e-9, 'haiku cents ' + tw.cents);
  assert.equal(tw.flags, 'roll_talk');
  assert.equal(JSON.parse(ref.card).shown, 1);
  assert.equal(JSON.parse(rows.find((r) => r.seat === 'ledger').card).shown, 0);
  const total = rows.reduce((n, r) => n + r.cents, 0) / 100;
  assert.ok(Math.abs(out.spend.tonight - Math.round(total * 10000) / 10000) < 1e-9);
  assert.equal(out.spend.tier, 'all');
  assert.equal(out.spend.cap, 20);
});

await test('tick: the key is never returned, logged or stored; a provider failure shows only a status', async () => {
  const s = await setup();
  await s.lines(2);
  s.replies.ref = Object.assign(new Error('401 invalid x-api-key sk-ant-test-0000'), { status: 401 });
  const res = await s.post('tick', {});
  const text = await res.text();
  assert.ok(!text.includes('sk-ant'), text);
  const out = JSON.parse(text);
  assert.deepEqual(out.errors, [{ seat: 'ref', error: 'provider status 401' }]);
  assert.deepEqual(out.cards, []);
  assert.ok(!JSON.stringify(s.rows()).includes('sk-ant'));
  assert.equal(JSON.parse(s.rows().find((r) => r.seat === 'ref').card).error, 'provider status 401');
});

await test('tick: nothing new to read, or nothing flagged, costs nothing or only the Tripwire', async () => {
  const s = await setup();
  let out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, []); assert.equal(s.calls.length, 0, 'no lines, no calls');
  await s.lines(2);
  s.replies.tripwire = { ...NONE };
  out = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire']);
  assert.deepEqual(out.flags, []); assert.deepEqual(out.cards, []);
  const last = out.last;
  s.calls.length = 0;
  clock.t += 120_000;
  out = await body(await s.post('tick', { after: last }));
  assert.equal(s.calls.length, 0, 'after the newest line there is nothing new');
});

await test('tick: the same slip a minute later is a repeat (no card); a different one inside five minutes is held back; after five it shows', async () => {
  clock.t = Date.parse('2030-01-01T10:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  let out = await body(await s.post('tick', {}));
  assert.equal(out.cards.length, 1);
  clock.t += 120_000;                       // past the ref and ledger cooldowns
  await s.lines(2);
  out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, [], 'same slip, two minutes on');
  const refRows = s.rows().filter((r) => r.seat === 'ref');
  assert.equal(refRows.length, 2, 'the repeat was still called, and logged as not shown');
  assert.equal(JSON.parse(refRows[1].card).shown, 0);
  s.replies.ref = { slip: true, said_at: '10:03', what_was_said: 'y', rule: 'Stress costs (p.20)', card: 'Stress cost looks wrong' };
  clock.t += 120_000;                       // 4 minutes after the first card
  await s.lines(2);
  out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, [], 'a different slip but inside five minutes');
  clock.t += 120_000;                       // 6 minutes after
  await s.lines(2);
  out = await body(await s.post('tick', {}));
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].text, 'Stress cost looks wrong');
});

await test('tick: the Tap seats read the last four minutes of talk, however many lines that is', async () => {
  clock.t = Date.parse('2030-01-01T10:30:00.000Z');
  const s = await setup();
  await s.lines(40, { text: 'old batch' });
  clock.t += 5 * 60_000;
  for (const name of ['batch A', 'batch B', 'batch C']) { await s.lines(40, { text: name }); clock.t += 60_000; }
  clock.t -= 20_000;
  await s.post('tick', {});
  const ref = s.calls.find((c) => c.seat === 'ref');
  const count = (re) => (ref.user.match(re) || []).length;
  assert.equal(count(/batch A/g), 40); assert.equal(count(/batch B/g), 40); assert.equal(count(/batch C/g), 40);
  assert.equal(count(/old batch/g), 0, 'older than four minutes is left out');
});

await test('tick: a held Ref card shows at the next opportunity; ledger entries come as updates and never take the slot', async () => {
  clock.t = Date.parse('2030-01-01T16:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  let out = await body(await s.post('tick', {}));
  assert.equal(out.cards.length, 1); assert.deepEqual(out.updates, []);
  const second = { slip: true, said_at: '16:02', what_was_said: 'y', rule: 'Stress costs (p.20)', card: 'Stress cost looks wrong' };
  s.replies.ref = second;
  s.replies.ledger = { events: [{ at: '16:02', who: 'Quill', kind: 'stress', note: '+2' }], xp_totalled: false };
  clock.t += 120_000; await s.lines(2);
  out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, [], 'inside the gap');
  assert.equal(out.updates.length, 1); assert.equal(out.updates[0].seat, 'ledger'); assert.match(out.updates[0].text, /Quill/);
  assert.equal(JSON.parse(s.rows().filter((r) => r.seat === 'ref').pop().card).held, 1);
  s.replies.ref = { slip: false, said_at: '', what_was_said: '', rule: '', card: '' };
  s.replies.ledger = { events: [], xp_totalled: false };
  clock.t += 180_000; await s.lines(2);        // five minutes after the first card, three after the held one
  out = await body(await s.post('tick', {}));
  assert.equal(out.cards.length, 1); assert.equal(out.cards[0].text, second.card);
  assert.ok(s.rows().some((r) => r.seat === 'editor' && JSON.parse(r.card).shown === 1));
  clock.t += 120_000; await s.lines(2);
  out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, [], 'shown once only');
});

await test('tick: a held Ref card that has gone stale is never shown', async () => {
  clock.t = Date.parse('2030-01-01T17:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  await s.post('tick', {});
  s.replies.ref = { slip: true, said_at: '17:02', what_was_said: 'y', rule: 'Stress costs (p.20)', card: 'Stress cost looks wrong' };
  clock.t += 120_000; await s.lines(2);
  await s.post('tick', {});                    // held
  s.replies.ref = { slip: false, said_at: '', what_was_said: '', rule: '', card: '' };
  clock.t += 6 * 60_000; await s.lines(2);     // four minutes on from the held one, and past the gap
  clock.t += 60_000;
  const out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, []);
});

await test('cooldowns come from the log: a second tick inside a seat\'s gap does not call it', async () => {
  clock.t = Date.parse('2030-01-01T11:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  await s.post('tick', {});
  s.calls.length = 0;
  clock.t += 50_000;                        // tripwire gap is 45 s, ref's is 60 s
  await s.lines(2);
  await s.post('tick', {});
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire'], 'ref and ledger were run 50 s ago');
});

await test('budget ladder in the endpoint: 60% drops the optional seats, 85% leaves the core, the cap stops every call', async () => {
  clock.t = Date.parse('2030-01-01T12:00:00.000Z');
  const s = await setup();
  const seed = (cents) => s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, seat, model, cents) VALUES ('c', ?, 'seed', 'm', ?)").run(iso(clock.t - 3 * 3600_000), cents);
  s.replies.tripwire = { ...NONE, roll_talk: true, new_name: true };
  await s.lines(2);
  seed(1300);                               // $13 of $20 = 65%: reduced (clerk is still on)
  let out = await body(await s.post('tick', {}));
  assert.equal(out.spend.tier, 'reduced');
  assert.deepEqual(s.calls.map((c) => c.seat).sort(), ['clerk', 'ledger', 'ref', 'tripwire']);
  clock.t += 600_000; s.calls.length = 0; await s.lines(2);
  seed(500);                                // now about $18.1 of $20: core
  out = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat).sort(), ['ledger', 'ref', 'tripwire'], 'clerk is dropped at 85%');
  assert.equal(out.spend.tier, 'core');
  clock.t += 600_000; s.calls.length = 0; await s.lines(2);
  seed(500);
  out = await body(await s.post('tick', {}));
  assert.equal(s.calls.length, 0, 'at the cap no seat is called, not even the tripwire');
  assert.equal(out.spend.tier, 'off');
  assert.deepEqual(out.cards, []);
  await assert.rejects(s.post('fit', { position: 'risky', draws: DRAWS }), (e) => e.status === 429 && /cap/.test(e.message));
  assert.equal(s.calls.length, 0);
});

await test('the cap is a Worker setting (ASSIST_CAP_USD) and spend older than 12 hours does not count', async () => {
  clock.t = Date.parse('2030-01-01T13:00:00.000Z');
  const s = await setup({ env: { ASSIST_CAP_USD: '1' } });
  s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, seat, model, cents) VALUES ('c', ?, 'seed', 'm', 5000)").run(iso(clock.t - 13 * 3600_000));
  await s.lines(2);
  let out = await body(await s.post('tick', {}));
  assert.equal(out.spend.cap, 1);
  assert.equal(out.spend.tier, 'all', 'last night does not count');
  s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, seat, model, cents) VALUES ('c', ?, 'seed', 'm', 100)").run(iso(clock.t - 3600_000));
  clock.t += 600_000; s.calls.length = 0; await s.lines(2);
  out = await body(await s.post('tick', {}));
  assert.equal(out.spend.tier, 'off'); assert.equal(s.calls.length, 0);
});

const FID = 'file_011TESTinvented0000';
async function tickWith(partBody, mkErr) {
  clock.t += 3_600_000;
  const s = await setup();
  if (partBody) s.exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?)").run(JSON.stringify(partBody));
  const seen = [];
  const handler = makeHandler({ now: () => clock.t, clientFor: () => ({ messages: { async create(req) { seen.push(req); if (mkErr) throw mkErr; return fakeClient(s.replies, s.calls).messages.create(req); } } }) });
  await s.lines(2);
  const out = await body(await handler({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: '{}' }), env: s.env, data: { me: GM } }));
  return { s, seen, out };
}

await test('the prefix is a file id in the Worker: a document block first in the user turn, the 1-hour breakpoint on it, no system prompt, seat extras after it', async () => {
  const { seen, out } = await tickWith({ file_id: FID, hash: 'h', extra: { ref: 'EXTRA FOR REF' } });
  assert.equal(out.warnings, undefined);
  assert.ok(seen.length >= 2);
  for (const r of seen) {
    assert.equal(r.system, undefined, 'nothing seat-specific goes before the breakpoint: no system prompt at all');
    const c = r.messages[0].content;
    assert.deepEqual(c[0], { type: 'document', source: { type: 'file', file_id: FID }, title: 'context', cache_control: { type: 'ephemeral', ttl: '1h' } });
    assert.ok(c.slice(1).every((b) => b.type === 'text' && !b.cache_control), 'only the document carries a breakpoint');
    assert.equal(c.length, 3, 'document, seat instructions, the talk');
  }
  const ref = seen.find((r) => /rules referee/.test(r.messages[0].content[1].text));
  assert.match(ref.messages[0].content[1].text, /EXTRA FOR REF$/);
  const docs = new Set(seen.map((r) => JSON.stringify(r.messages[0].content[0])));
  assert.equal(docs.size, 1, 'every seat sends the identical document block, (each seat still caches separately, because its schema sits ahead of the messages)');
});

await test('a part that still carries prefix text: nothing is sent to the provider, the box stays quiet and says to re-push', async () => {
  const { seen, out, s } = await tickWith({ prefix: 'OLD FORMAT PREFIX TEXT', extra: { ref: 'x' } });
  assert.equal(seen.length, 0);
  assert.deepEqual(out.cards, []); assert.deepEqual(out.flags, []);
  assert.deepEqual(out.warnings, ['re-push the assist part']);
  assert.equal(s.rows().length, 0);
  const fit = await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  assert.deepEqual(fit.cards, []); assert.deepEqual(fit.warnings, ['re-push the assist part']);
  assert.equal(s.calls.length, 0);
});

await test('a missing or deleted file: a re-push warning, never the provider message', async () => {
  for (const err of [Object.assign(new Error('404 {"error":{"message":"File not found: file_011SECRETDETAIL"}}'), { status: 404 }), Object.assign(new Error('400 invalid file_id file_011SECRETDETAIL'), { status: 400 })]) {
    const { out, seen } = await tickWith({ file_id: FID, hash: 'h' }, err);
    assert.deepEqual(out.warnings, ['re-push the assist part']);
    assert.equal(out.errors, undefined);
    assert.deepEqual(out.cards, []);
    assert.equal(seen.length, 1, 'the Tripwire found the file gone and nothing else was called');
    assert.ok(!JSON.stringify(out).includes('SECRETDETAIL') && !JSON.stringify(out).includes('not found'));
  }
  const { out } = await tickWith({ file_id: FID, hash: 'h' }, Object.assign(new Error('overloaded'), { status: 529 }));
  assert.deepEqual(out.errors, [{ seat: 'tripwire', error: 'provider status 529' }], 'other failures stay as before');
  assert.equal(out.warnings, undefined);
});

await test('the Worker request carries a file id, not the prefix', async () => {
  const { seen } = await tickWith({ file_id: FID, hash: 'h' });
  assert.ok(JSON.stringify(seen[0]).length < 3000);
});

await test('callSeat/countTokens layout: file id form for the Worker, inline text form for scripts, same order, nothing before the breakpoint', async () => {
  const sent = [];
  const rec = { messages: { async create(req) { sent.push(req); return { content: [{ type: 'text', text: '{}' }], usage: {}, stop_reason: 'end_turn' }; }, async countTokens(req) { sent.push(req); return { input_tokens: 7 }; } } };
  await callSeat(rec, { model: 'claude-haiku-5-5', effort: 'low', prefixFileId: FID, instructions: 'INS', user: 'TALK' });
  await callSeat(rec, { model: 'claude-haiku-5-5', effort: 'low', prefix: 'INLINE TEXT', instructions: 'INS', user: 'TALK' });
  await callSeat(rec, { model: 'claude-haiku-5-5', effort: 'low', instructions: 'INS', user: 'TALK' });
  assert.equal(await countTokens(rec, { model: 'claude-haiku-5-5', prefix: 'INLINE TEXT', instructions: 'INS', user: 'TALK' }), 7);
  assert.equal(await countTokens(rec, { model: 'claude-haiku-5-5', prefixFileId: FID, user: 'TALK' }), 7);
  const bp = { type: 'ephemeral', ttl: '1h' };
  assert.deepEqual(sent[0].messages[0].content, [{ type: 'document', source: { type: 'file', file_id: FID }, title: 'context', cache_control: bp }, { type: 'text', text: 'INS' }, { type: 'text', text: 'TALK' }]);
  assert.deepEqual(sent[1].messages[0].content, [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'INLINE TEXT' }, title: 'context', cache_control: bp }, { type: 'text', text: 'INS' }, { type: 'text', text: 'TALK' }]);
  assert.deepEqual(sent[2].messages[0].content, [{ type: 'text', text: 'INS' }, { type: 'text', text: 'TALK' }], 'no prefix: no document block');
  assert.deepEqual(sent[3].messages[0].content, sent[1].messages[0].content, 'countTokens counts the same layout');
  assert.deepEqual(sent[4].messages[0].content, [sent[0].messages[0].content[0], { type: 'text', text: 'TALK' }]);
  for (const r of sent) assert.equal(r.system, undefined);
});

await test('seats: Ref runs at low effort, the closer seat is retired, and nothing wakes it', async () => {
  assert.equal(SEATS.ref.effort, 'low');
  assert.equal(SEATS.closer, undefined);
  assert.ok(!JSON.stringify(WAKES).includes('closer'));
});

await test('fit: the Fixer for a named position; logged; the position reaches the prompt; busy and cooldown are 429', async () => {
  clock.t = Date.parse('2030-01-01T15:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  const res = await s.post('fit', { position: 'desperate', effect: 'limited', draws: DRAWS });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].seat, 'fixer');
  assert.equal(out.cards[0].bargain, 'e');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].model, 'claude-opus-5-5');
  assert.match(s.calls[0].user, /position: desperate\. Effect: limited\./);
  const rows = s.rows();
  assert.equal(rows.length, 1); assert.equal(rows[0].seat, 'fixer'); assert.equal(rows[0].flags, 'fit');
  // opus: 1000*4 + 10000*0.2 + 200*20 = 10000 per million -> $0.01 = 1 cent
  assert.ok(Math.abs(rows[0].cents - 1) < 1e-9, 'cents ' + rows[0].cents);
  await assert.rejects(s.post('fit', { position: 'risky', draws: DRAWS }), (e) => e.status === 429 && /busy/.test(e.message));
  assert.equal(s.calls.length, 1);
  clock.t += COOLDOWN_MS.fixer + 1;
  assert.equal((await s.post('fit', { position: 'risky', draws: DRAWS })).status, 200);
});

// ---------- the box's memory: GET/POST /api/gm/assist/cards ----------
const cardsReq = (s, method, qs = '', b, data = { me: GM }) => s.handler({ request: new Request('https://blades.example.test/api/gm/assist/cards' + qs, { method, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) }), env: s.env, data });

await test('cards: the route is wired, and a player, the display and an unknown caller get 403 on every method before anything is read', async () => {
  assert.equal(matchApi('/api/gm/assist/cards').handler, realHandler); assert.equal(matchApi('/api/gm/assist/cards/').handler, realHandler);
  const touched = [];
  const env = { get DB() { touched.push('DB'); return undefined; }, CAMPAIGN: 'x' };
  const request = (method) => ({ method, url: 'https://blades.example.test/api/gm/assist/cards', headers: new Headers(), json() { touched.push('json'); throw new Error('read'); }, text() { touched.push('text'); throw new Error('read'); }, arrayBuffer() { touched.push('ab'); throw new Error('read'); } });
  for (const m of ['GET', 'POST', 'PUT', 'DELETE']) for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    let err = null; try { await realHandler({ request: request(m), env, data: { me } }); } catch (e) { err = e; }
    assert.ok(err && err.status === 403, m + ' expected 403');
  }
  assert.deepEqual(touched, []);
});

await test('cards: a tick\'s shown Ref card and Ledger update come back after a reload (no key needed); held ones do not', async () => {
  clock.t = Date.parse('2030-01-01T17:00:00.000Z');
  const s = await setup();
  s.replies.ledger = { events: [{ at: '17:00', who: 'Quill', kind: 'stress', note: '+2' }], xp_totalled: false };
  await s.lines(2);
  const tick = await body(await s.post('tick', {}));
  assert.equal(tick.cards.length, 1); assert.equal(tick.updates.length, 1);
  const noKey = makeHandler({ now: () => clock.t, clientFor: () => { throw new Error('no key needed'); } });
  const res = await noKey({ request: new Request('https://blades.example.test/api/gm/assist/cards'), env: { DB: s.db, CAMPAIGN: 'c' }, data: { me: GM } });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.equal(out.cards.length, 1);
  const c = out.cards[0];
  assert.equal(c.seat, 'ref'); assert.equal(c.at, tick.cards[0].at); assert.equal(c.text, tick.cards[0].text, 'the same (at, text) the tick carried: one card');
  assert.deepEqual(c.detail, { said_at: '09:29', rule: REF_SLIP.rule }); assert.equal(c.important, true);
  assert.equal(c.seen, false); assert.equal(c.kept, false); assert.equal(c.filed, false);
  assert.equal(out.updates.length, 1); assert.equal(out.updates[0].at, tick.updates[0].at); assert.equal(out.updates[0].text, tick.updates[0].text); assert.equal(out.updates[0].key, tick.updates[0].key);
  // a second slip inside the gap is held (not shown): not restored
  s.replies.ref = { slip: true, said_at: '17:03', what_was_said: 'y', rule: 'Stress costs (p.20)', card: 'Stress cost looks wrong' };
  clock.t += 120_000; await s.lines(2); await s.post('tick', {});
  assert.equal((await body(await cardsReq(s, 'GET'))).cards.length, 1);
  assert.equal((await body(await cardsReq(s, 'GET', '?since=' + encodeURIComponent(iso(clock.t + 1000))))).cards.length, 0, '?since cuts it');
  await assert.rejects(cardsReq(s, 'GET', '?since=nope'), (e) => e.status === 400);
  clock.t += 13 * 3600_000;
  assert.equal((await body(await cardsReq(s, 'GET'))).cards.length, 0, 'more than twelve hours ago is not tonight');
  assert.equal((await body(await cardsReq(s, 'GET', '?since=' + encodeURIComponent('2030-01-01T00:00:00Z')))).cards.length, 1);
});

await test('cards: seen, dismiss and keep are kept on the log; dismissed stay dismissed; a Ledger item is dismissed one at a time; bad marks are 400', async () => {
  clock.t = Date.parse('2030-01-01T18:00:00.000Z');
  const s = await setup();
  s.replies.ledger = { events: [{ at: '18:00', who: 'Quill', kind: 'stress', note: '+2' }, { at: '18:00', who: 'Vex', kind: 'harm', note: 'level 1' }], xp_totalled: false };
  await s.lines(2); await s.post('tick', {});
  const get = async () => body(await cardsReq(s, 'GET'));
  let g = await get();
  const card = { at: g.cards[0].at, text: g.cards[0].text };
  assert.equal(g.updates.length, 2);
  assert.deepEqual(await body(await cardsReq(s, 'POST', '', { op: 'seen', items: [card] })), { marked: 1 });
  g = await get(); assert.equal(g.cards[0].seen, true);
  await cardsReq(s, 'POST', '', { op: 'keep', items: [card] });
  g = await get(); assert.equal(g.cards[0].kept, true);
  const u0 = { at: g.updates[0].at, key: g.updates[0].key, text: g.updates[0].text };
  await cardsReq(s, 'POST', '', { op: 'dismiss', items: [u0] });
  g = await get(); assert.equal(g.updates.length, 1); assert.notEqual(g.updates[0].text, u0.text, 'the other item is still open');
  assert.deepEqual(await body(await cardsReq(s, 'POST', '', { op: 'keep', items: [{ at: g.updates[0].at, key: g.updates[0].key, text: g.updates[0].text }] })), { marked: 0 }, 'a Ledger item is not starred');
  await cardsReq(s, 'POST', '', { op: 'dismiss', items: [card] });
  g = await get(); assert.equal(g.cards.length, 0, 'dismissed stays dismissed');
  assert.deepEqual(await body(await cardsReq(s, 'POST', '', { op: 'dismiss', items: [{ at: card.at, text: 'not a card' }] })), { marked: 0 });
  for (const bad of [{ op: 'nope', items: [card] }, { op: 'seen', items: [] }, { op: 'seen' }, { op: 'seen', items: [{ at: 1, text: 'x' }] }, { op: 'seen', items: Array.from({ length: 51 }, () => card) }, { op: 'seen', items: [{ at: card.at, text: 'x'.repeat(601) }] }]) {
    await assert.rejects(cardsReq(s, 'POST', '', bad), (e) => e.status === 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await cardsReq(s, 'PUT', '')).status, 405);
  const n = s.calls.length; await get(); assert.equal(s.calls.length, n, 'reading and marking cards never calls a model');
});

// ---------- WP2: the Fixer fits the console's own draws; timing, stop reasons, the 8k limit, refusals ----------
await test('fit: the draws reach the prompt, the call is capped at 8k tokens, and the seat prompt keeps the draws\' kind of outcome', async () => {
  clock.t = Date.parse('2030-01-01T18:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  assert.equal(SEATS.fixer.maxTokens, 8000);
  const out = await body(await s.post('fit', { position: 'risky', effect: 'standard', draws: { low: '  Lost opportunity:\r\nthe way in is shut.  ', mid: DRAWS.mid } }));
  assert.equal(out.cards.length, 1);
  assert.equal(s.calls[0].max, 8000, 'the Fixer asks for 8k output tokens');
  assert.match(s.calls[0].user, /1-3 draw:\nLost opportunity:\nthe way in is shut\.\n4-5 draw:\nComplication: a second watcher arrives\./);
  assert.match(s.calls[0].ins, /draws are fixed/); assert.match(s.calls[0].ins, /never change the kind of outcome/);
  assert.deepEqual(Object.keys(SEATS.fixer.schema.properties), ['read', 'one_three', 'four_five', 'six', 'crit', 'bargain']);
});

await test('fit: the endpoint rejects missing, malformed and over-long draws with 400 and never calls the model', async () => {
  clock.t = Date.parse('2030-01-01T18:10:00.000Z');
  const s = await setup();
  await s.lines(2);
  const long = 'x'.repeat(DRAW_MAX + 1);
  const bad = [undefined, null, 'text', [], {}, { low: 'a' }, { mid: 'b' }, { low: 'a', mid: '' }, { low: '  ', mid: 'b' }, { low: 'a', mid: 7 }, { low: long, mid: 'b' }, { low: 'a', mid: long }];
  for (const draws of bad) await assert.rejects(s.post('fit', { position: 'risky', ...(draws === undefined ? {} : { draws }) }), (e) => e.status === 400, String(JSON.stringify(draws)).slice(0, 50));
  assert.equal(s.calls.length, 0); assert.equal(s.rows().length, 0);
  assert.deepEqual(cleanDraws({ low: 'a'.repeat(DRAW_MAX), mid: 'b' }), { low: 'a'.repeat(DRAW_MAX), mid: 'b' }, 'exactly the limit is fine');
  assert.equal((await s.post('fit', { position: 'risky', draws: { low: 'a'.repeat(DRAW_MAX), mid: 'b' } })).status, 200);
});

await test('every seat call logs its seconds and stop reason in the card JSON (tick rows and the fit row)', async () => {
  clock.t = Date.parse('2030-01-01T18:20:00.000Z');
  const s = await setup();
  s.replies.__ms = { tripwire: 1200, ref: 4300, ledger: 0, fixer: 21500 };
  s.replies.__stop = { ref: 'max_tokens' };
  await s.lines(3);
  await body(await s.post('tick', {}));
  const rows = s.rows(); const card = (seat) => JSON.parse(rows.find((r) => r.seat === seat).card);
  assert.equal(card('tripwire').secs, 1.2); assert.equal(card('tripwire').stop, 'end_turn');
  assert.equal(card('ref').secs, 4.3); assert.equal(card('ref').stop, 'max_tokens');
  assert.equal(typeof card('ledger').secs, 'number'); assert.equal(card('ledger').stop, 'end_turn');
  clock.t += 60_000;
  await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  const fx = JSON.parse(s.rows().find((r) => r.seat === 'fixer').card);
  assert.deepEqual(fx.draws, DRAWS, 'the two draws, as sent, are kept in the row'); assert.equal(fx.secs, 21.5); assert.equal(fx.stop, 'end_turn'); assert.equal(fx.shown, 0); assert.ok(fx.out && fx.out.one_three);
});

await test('a failed call still logs its seconds', async () => {
  clock.t = Date.parse('2030-01-01T18:30:00.000Z');
  const s = await setup();
  s.replies.fixer = Object.assign(new Error('boom'), { status: 500 }); s.replies.__ms = { fixer: 3000 };
  await s.lines(2);
  const out = await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  assert.deepEqual(out.cards, []); assert.deepEqual(out.errors, [{ seat: 'fixer', error: 'provider status 500' }]);
  const c = JSON.parse(s.rows()[0].card);
  assert.equal(c.secs, 3); assert.equal(c.error, 'provider status 500');
});

await test('a refusal shows nothing and the row records it (fit and tick); there is no fallback', async () => {
  clock.t = Date.parse('2030-01-01T18:40:00.000Z');
  const s = await setup();
  s.replies.__stop = { fixer: 'refusal', ref: 'refusal' };
  await s.lines(3);
  const fit = await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  assert.deepEqual(fit.cards, [], 'the card shows nothing');
  const fx = JSON.parse(s.rows().find((r) => r.seat === 'fixer').card);
  assert.equal(fx.refusal, 1); assert.equal(fx.stop, 'refusal'); assert.equal(fx.error, 'refusal'); assert.equal(fx.out, undefined);
  assert.equal(s.calls.filter((c) => c.seat === 'fixer').length, 1, 'no second call, no server-side fallback');
  const tick = await body(await s.post('tick', {}));
  assert.deepEqual(tick.cards, [], 'a refused Ref call produces no card');
  const rf = JSON.parse(s.rows().find((r) => r.seat === 'ref').card);
  assert.equal(rf.refusal, 1); assert.equal(rf.shown, 0); assert.equal(rf.stop, 'refusal');
  const back = await body(await cardsReq(s, 'GET', ''));
  assert.deepEqual(back.cards, [], 'and nothing is restored after a reload');
});

// ---------- WP2: the replay script's way to supply draws ----------
await test('replay draws: from a JSON file, or drawn from a pack\'s console part with fixed seeds (the same pair every time); the user turn is shared with the endpoint', async () => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const { makeDrawsFor, parsePositionAt } = await import('../../scripts/lib/fixer-draws.mjs');
  const { fitUser } = await import('../../functions/_lib/assist/prompts.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-draws-'));
  try {
    const f = path.join(dir, 'draws.json');
    fs.writeFileSync(f, JSON.stringify({ '22:09': { position: 'desperate', low: 'L1', mid: 'M1' }, default: { low: 'L0', mid: 'M0' } }));
    const fromFile = makeDrawsFor({ file: f, position: 'risky', positionAt: parsePositionAt('22:12=controlled') });
    assert.deepEqual(fromFile('22:09'), { position: 'desperate', low: 'L1', mid: 'M1' });
    assert.deepEqual(fromFile('22:12'), { position: 'controlled', low: 'L0', mid: 'M0' });
    fs.writeFileSync(f, JSON.stringify({ '22:09': { low: 'only low' } }));
    assert.throws(() => makeDrawsFor({ file: f })('22:09'), /no draws for 22:09/);

    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'console-pack.json'), 'utf8')).parts;
    const pk = path.join(dir, 'pack.json'); fs.writeFileSync(pk, JSON.stringify({ parts: { console: fixture.console, campaign: fixture.campaign } }));
    const moments = ['22:09', '22:12', '22:23'];
    const a = makeDrawsFor({ moments, packFile: pk, seed: 7, position: 'risky', positionAt: { '22:12': 'desperate' } });
    const b = makeDrawsFor({ moments, packFile: pk, seed: 7, position: 'risky', positionAt: { '22:12': 'desperate' } });
    for (const m of moments) {
      const d = a(m);
      assert.deepEqual(d, b(m), 'fixed seed: the same pair every time');
      assert.ok(d.low.startsWith('A 1–3 (') && d.mid.startsWith('A 4/5 ('), 'the console\'s own situation cards, as the page sends them');
      assert.ok(d.low.length <= 1200 && d.mid.length <= 1200);
    }
    assert.equal(a('22:12').position, 'desperate'); assert.equal(a('22:09').position, 'risky');
    assert.throws(() => makeDrawsFor({ packFile: path.join(dir, 'missing.json') }), /no draws/);
    const user = fitUser({ position: 'risky', effect: 'limited', draws: { low: 'L', mid: 'M' }, stamp: '22:09', talk: '[22:08] A: x' });
    assert.equal(user, 'A roll is about to be made. The GM names the position: risky. Effect: limited.\nThe console has drawn these. Fit them to the scene and keep what each one says happens.\n1-3 draw:\nL\n4-5 draw:\nM\nLast five minutes, up to 22:09:\n[22:08] A: x');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'gm-assist-replay.mjs'), 'utf8');
  assert.ok(/arg\('fixer-at'\)/.test(src) && /fixer-moments\.md/.test(src) && /--draws-file/.test(src), 'the script takes --fixer-at with draws and writes fixer-moments.md');
});

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
