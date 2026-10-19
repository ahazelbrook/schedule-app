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
import { makeHandler, onRequest as realHandler } from '../../functions/api/gm/assist.js';
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
        const ins = req.system[req.system.length - 1].text;
        const seat = /listen to a live/.test(ins) ? 'tripwire' : /rules referee/.test(ins) ? 'ref' : /keep the canon/.test(ins) ? 'clerk' : /keep the ledger/.test(ins) ? 'ledger' : /fixer/.test(ins) ? 'fixer' : 'other';
        calls.push({ seat, model: req.model, effort: req.output_config.effort, cached: req.system.length > 1, user: req.messages[0].content });
        const r = replies[seat];
        if (r instanceof Error) throw r;
        return { content: [{ type: 'text', text: JSON.stringify(typeof r === 'function' ? r() : r) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
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
  assert.equal(ref.effort, 'medium');
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
  await assert.rejects(s.post('fit', { position: 'risky' }), (e) => e.status === 429 && /cap/.test(e.message));
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

await test('the cached prefix and per-seat extras come from the GM pack part `assist`', async () => {
  clock.t = Date.parse('2030-01-01T14:00:00.000Z');
  const s = await setup();
  const part = JSON.stringify({ prefix: 'RULES DIGEST PLACEHOLDER', extra: { ref: 'EXTRA FOR REF' } });
  s.exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?)").run(part);
  const seen = [];
  const handler = makeHandler({ now: () => clock.t, clientFor: () => ({ messages: { async create(req) { seen.push(req); return fakeClient(s.replies, s.calls).messages.create(req); } } }) });
  await s.lines(2);
  const res = await handler({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: '{}' }), env: s.env, data: { me: GM } });
  const out = await body(res);
  assert.equal(out.warnings, undefined);
  const ref = seen.find((r) => /rules referee/.test(r.system[r.system.length - 1].text));
  assert.equal(ref.system[0].text, 'RULES DIGEST PLACEHOLDER');
  assert.deepEqual(ref.system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.match(ref.system[ref.system.length - 1].text, /EXTRA FOR REF$/);
});

await test('fit: the Fixer for a named position; logged; the position reaches the prompt; busy and cooldown are 429', async () => {
  clock.t = Date.parse('2030-01-01T15:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  const res = await s.post('fit', { position: 'desperate', effect: 'limited' });
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
  await assert.rejects(s.post('fit', { position: 'risky' }), (e) => e.status === 429 && /busy/.test(e.message));
  assert.equal(s.calls.length, 1);
  clock.t += COOLDOWN_MS.fixer + 1;
  assert.equal((await s.post('fit', { position: 'risky' })).status, 200);
});

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
