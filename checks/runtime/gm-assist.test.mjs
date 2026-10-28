// Claude at the table, GM side (the assist build plan, Phase 1): the Conductor and Editor (pure), and POST /api/gm/assist/{tick,fit}
// on an in-memory D1 with a FAKE Anthropic client. No network and no key: nothing here can reach the API. Every name and
// sentence is invented.
//   node checks/runtime/gm-assist.test.mjs
import fs from 'node:fs';
import { showrunnerUser, mysteryUser } from '../../functions/_lib/assist/prompts.js';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { followsThrough, FOLLOW_WINDOW_MS, decide, budgetTier, canRun, isRepeatSlip, slipKeys, COOLDOWN_MS, DEFAULT_CAP, DROPPED_WHEN_REDUCED, CORE_SEATS } from '../../functions/_lib/assist/conductor.js';
import { toCandidate, toVoice, toAnother, toStall, toHandout, handoutIds, merge, pendingRefs, CARD_GAP_MS, STALE_MS } from '../../functions/_lib/assist/editor.js';
import { callSeat, countTokens } from '../../functions/_lib/assist/claude.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { makeHandler, cleanDots, cleanDraws, cleanNpc, cleanShown, DRAW_MAX, onRequest as realHandler } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';
import { gmNotFound } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// ---------- the Conductor ----------
const T = 1_000_000_000_000;

await test('budget ladder: all under 60%, reduced to 85%, core to 100%, off at the cap (and with no cap)', () => {
  assert.equal(DEFAULT_CAP, 30);
  const tiers = [0, 11.99, 12, 16.99, 17, 19.99, 20, 25].map((s) => budgetTier(s, 20));
  assert.deepEqual(tiers, ['all', 'all', 'reduced', 'reduced', 'core', 'core', 'off', 'off']);
  assert.equal(budgetTier(0, 0), 'off');
  assert.equal(budgetTier(5), 'all', 'the default cap is $30');
  assert.equal(budgetTier(12), 'all'); assert.equal(budgetTier(18), 'reduced'); assert.equal(budgetTier(25.5), 'core'); assert.equal(budgetTier(30), 'off');
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
  assert.deepEqual(decide({ flags: ['scene_change'], now: T }).seats, ['meanwhile'], 'a scene change wakes Meanwhile');
  assert.deepEqual(decide({ flags: ['roll_talk'], now: T }).seats, ['ref', 'ledger']);
  assert.deepEqual(decide({ flags: ['new_name'], now: T }).seats, ['clerk']);
  assert.deepEqual(decide({ flags: ['harm', 'clue_mention'], now: T }).seats, ['ref', 'clerk', 'ledger', 'mystery']);
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
        const seat = Object.keys(SEATS).find((k) => ins.startsWith(SEATS[k].instructions)) || 'other';
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
  voice: { who: 'Mrs Test', want: 'to be paid', line_a: 'Pay up, dear.', line_b: 'I could forget I saw you.' },
  voice_plus: { who: 'Mrs Test', line: 'The door is open, if you are quick.' },
  fixer: { read: 'who, where, risky standard', one_three: 'a', four_five: 'b', six: 'c', crit: 'd', bargain: 'e' },
  stall: { stalled: false, kind: 'none', offer: '', why_now: '' },
  showrunner: { spotlight: [], needs_spotlight: '', beat: 'rising', elapsed_minutes: 30, advice: '', speak: false },
  mystery: { known: [], theories: [], push_next: '', must_land_item: '', how: 'no list' },
});

// the Scribe and Meanwhile (gm-assist-scribe.test.mjs) came after these tests: P1_WAKES is the table they were written for
const { scribe: _sc, meanwhile: _mw, ...P1_WAKES } = WAKES;
const LEGACY_WAKES = { ref: WAKES.ref, clerk: WAKES.clerk, ledger: WAKES.ledger, voice: WAKES.voice };
async function setup(opts = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const calls = [], replies = REPLIES();
  // WP1-3's tests predate Stall, Mystery and the Showrunner (which wakes on every tick): they run with the table those tests were written for;
  // the WP4 tests pass opts.wakes = WAKES
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ASSIST_CAP_USD: '20', ...(opts.env || {}) };   // these scenarios are written against $20; the default (30) is tested in gm-assist-ask
  const handler = makeHandler({ clientFor: () => fakeClient(replies, calls), now: () => clock.t, wakes: opts.wakes || LEGACY_WAKES });
  const lines = (n, extra = {}) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: n }, (_, i) => ({ id: 'l' + Math.random().toString(36).slice(2, 10) + i, at: iso(clock.t - 20_000 + i), session: '3', conn: 'x', speaker: 0, text: 'we roll the dice now ' + i, ...extra })) }));
  const post = (action, body, data = { me: GM }) => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' } }), env, data });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  return { exec, db, calls, replies, env, handler, lines, post, rows };
}
const body = async (res) => JSON.parse(await res.text());
const DRAWS = { low: 'Lost opportunity: the way in is shut.', mid: 'Complication: a second watcher arrives.' };

await test('router: /api/gm/assist/tick and /fit reach the handler, other paths under it stay the GM-only 404', () => {
  for (const p of ['/api/gm/assist/tick', '/api/gm/assist/tick/', '/api/gm/assist/fit', '/api/gm/assist/another']) assert.equal(matchApi(p).handler, realHandler, p);
  for (const p of ['/api/gm/assist', '/api/gm/assist/', '/api/gm/assist/other', '/api/gm/assist/another/x', '/api/gm/assist/tick/x']) assert.equal(matchApi(p).handler, gmNotFound, p);
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
  const handler = makeHandler({ now: () => clock.t, wakes: LEGACY_WAKES, clientFor: () => ({ messages: { async create(req) { seen.push(req); if (mkErr) throw mkErr; return fakeClient(s.replies, s.calls).messages.create(req); } } }) });
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

// ---------- Voice and Another (WP3) ----------
await test('conductor: Voice wakes on npc_change and each minute, but only with an NPC on stage; Ref goes first', () => {
  assert.deepEqual(WAKES.voice, ['npc_change']);
  assert.deepEqual(decide({ flags: ['npc_change'], now: T }).seats, [], 'no NPC on stage: silence, even on npc_change');
  assert.deepEqual(decide({ flags: [], now: T }).seats, []);
  assert.deepEqual(decide({ flags: ['npc_change'], now: T, onStage: true }).seats, ['voice']);
  assert.deepEqual(decide({ flags: [], now: T, onStage: true }).seats, ['voice'], 'the per-minute wake');
  assert.deepEqual(decide({ flags: ['roll_talk', 'npc_change'], now: T, onStage: true }).seats, ['ref', 'ledger', 'voice'], 'Ref first, Voice last');
  assert.deepEqual(decide({ flags: ['npc_change'], now: T, onStage: true }).skipped, []);
});

await test('conductor: Voice has a gap shorter than a tick, one in flight, drops at 85% of the cap; voice_plus stays until the cap', () => {
  assert.ok(COOLDOWN_MS.voice < 60_000, 'a tick about each minute must find Voice ready again');
  let d = decide({ flags: [], now: T, onStage: true, lastRun: { voice: T - COOLDOWN_MS.voice + 1 } });
  assert.deepEqual(d.seats, []); assert.deepEqual(d.skipped, [{ seat: 'voice', why: 'cooldown' }]);
  assert.deepEqual(decide({ flags: [], now: T, onStage: true, lastRun: { voice: T - COOLDOWN_MS.voice } }).seats, ['voice']);
  d = decide({ flags: ['npc_change'], now: T, onStage: true, inFlight: ['voice'] });
  assert.deepEqual(d.skipped, [{ seat: 'voice', why: 'in-flight' }]);
  assert.deepEqual(decide({ flags: [], now: T, onStage: true, spent: 13, cap: 20 }).seats, ['voice'], 'reduced still has Voice');
  assert.deepEqual(decide({ flags: [], now: T, onStage: true, spent: 18, cap: 20 }).seats, [], 'core: Voice is dropped');
  assert.deepEqual(decide({ flags: [], now: T, onStage: true, spent: 20, cap: 20 }).seats, []);
  assert.equal(canRun('voice_plus', { now: T, tier: 'core' }).ok, true);
  assert.equal(canRun('voice_plus', { now: T, tier: 'off' }).why, 'budget');
  assert.equal(canRun('voice_plus', { now: T, lastRun: { voice_plus: T - 1000 } }).why, 'cooldown');
});

await test('seats: voice_plus is Opus 5.5 at medium effort and its instructions stay generic', () => {
  assert.equal(SEATS.voice_plus.model, 'claude-opus-5-5'); assert.equal(SEATS.voice_plus.effort, 'medium');
  assert.deepEqual(SEATS.voice_plus.schema.required, ['who', 'line']);
  assert.equal(SEATS.voice.model, 'claude-sonnet-5-5');
});

await test('editor: Voice lines already shown in the last 10 minutes are dropped; nobody on stage or no lines is nothing', () => {
  const j = { who: 'Mrs Test', want: 'to be paid', line_a: 'Pay up, dear.', line_b: 'I could forget I saw you.' };
  const v = toVoice(j, { now: T });
  assert.deepEqual(v.lines, ['Pay up, dear.', 'I could forget I saw you.']); assert.equal(v.who, 'Mrs Test'); assert.equal(v.keys.length, 2);
  const w = toVoice({ ...j, line_b: 'A new one.' }, { recent: [{ at: T, keys: v.keys }], now: T + 60_000 });
  assert.deepEqual(w.lines, ['A new one.'], 'the repeated line is dropped, the new one stays');
  assert.equal(toVoice(j, { recent: [{ at: T, keys: v.keys }], now: T + 60_000 }), null, 'both repeated: nothing');
  assert.ok(toVoice(j, { recent: [{ at: T, keys: v.keys }], now: T + 11 * 60_000 }), 'back after 10 minutes');
  assert.equal(toVoice({ ...j, who: '' }, { now: T }), null);
  assert.equal(toVoice({ ...j, line_a: '', line_b: '  ' }, { now: T }), null);
  assert.equal(toVoice(null), null);
  assert.equal(toAnother({ who: 'Mrs Test', line: 'Pay up, dear!' }, ['Pay up, dear.']), null, 'a line equal to a shown one (bar punctuation) is nothing');
  assert.equal(toAnother({ who: 'Mrs Test', line: '' }, ['x']), null);
  assert.equal(toAnother({ who: 'Mrs Test', line: 'Fresh.' }, ['x']).line, 'Fresh.');
});

await test('voice: the on-stage name and the shown lines are cleaned and length-limited', () => {
  assert.equal(cleanNpc(undefined), ''); assert.equal(cleanNpc(null), ''); assert.equal(cleanNpc('  Mrs   Test '), 'Mrs Test');
  assert.equal(cleanNpc(5), null); assert.equal(cleanNpc({}), null); assert.equal(cleanNpc('x'.repeat(81)), null); assert.equal(cleanNpc('x'.repeat(80)).length, 80);
  assert.deepEqual(cleanShown([' a  b ', 'c']), ['a b', 'c']);
  for (const bad of [undefined, 'a', [], [''], [1], ['x'.repeat(401)], ['a', 'b', 'c', 'd', 'e', 'f', 'g']]) assert.equal(cleanShown(bad), null, JSON.stringify(bad));
});

await test('tick: an NPC on stage and npc_change wake Voice; its two lines come back as voice, not as a card; the row has secs and stop', async () => {
  clock.t = Date.parse('2030-02-01T09:30:00.000Z');
  const s = await setup();
  await s.lines(3);
  s.replies.tripwire = { ...NONE, npc_change: true };
  s.replies.__ms = { voice: 3200 };
  const out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.deepEqual(out.flags, ['npc_change']);
  assert.deepEqual(out.cards, [], 'Voice lines never take the card slot');
  assert.deepEqual(out.voice.lines, ['Pay up, dear.', 'I could forget I saw you.']);
  assert.equal(out.voice.who, 'Mrs Test'); assert.equal(out.voice.want, 'to be paid'); assert.ok(out.voice.at);
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'voice']);
  const v = s.calls.find((c) => c.seat === 'voice');
  assert.equal(v.model, 'claude-sonnet-5-5'); assert.equal(v.effort, 'medium');
  assert.match(v.user, /^The GM has this NPC on stage: Mrs Test\./, 'the page names the NPC');
  assert.match(v.user, /we roll the dice now/, 'and the last four minutes follow');
  const row = s.rows().find((r) => r.seat === 'voice');
  assert.equal(row.model, 'claude-sonnet-5-5'); assert.equal(row.effort, 'medium'); assert.equal(row.flags, 'npc_change');
  assert.ok(row.cents > 0);
  const card = JSON.parse(row.card);
  assert.equal(card.secs, 3.2); assert.equal(card.stop, 'end_turn'); assert.equal(card.voice, 1); assert.equal(card.shown, undefined);
  assert.deepEqual(card.keys.length, 2);
  // the cards endpoint (the box's chat) does not list Voice rows
  const cards = await body(await s.handler({ request: new Request('https://blades.example.test/api/gm/assist/cards'), env: s.env, data: { me: GM } }));
  assert.deepEqual(cards.cards, []);
});

await test('tick: with an NPC on stage Voice also wakes each minute with no flag at all; without one it is silent', async () => {
  clock.t = Date.parse('2030-02-01T10:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  s.replies.tripwire = { ...NONE };
  let out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.deepEqual(out.flags, []);
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'voice']);
  assert.equal(out.voice.lines.length, 2);
  // a minute on, a new pair of lines: the gap is shorter than a tick
  s.calls.length = 0; clock.t += 60_000; await s.lines(2);
  s.replies.voice = { who: 'Mrs Test', want: 'to be paid', line_a: 'Is that the time already.', line_b: 'Sit. Sit.' };
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'voice'], 'a minute later Voice runs again');
  assert.equal(out.voice.lines[0], 'Is that the time already.');
  // no NPC on stage: even npc_change and a quiet table call nobody but the Tripwire
  s.calls.length = 0; clock.t += 120_000; await s.lines(2);
  out = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire']); assert.equal(out.voice, undefined);
  s.calls.length = 0; clock.t += 120_000; await s.lines(2);
  s.replies.tripwire = { ...NONE, npc_change: true };
  out = await body(await s.post('tick', { npc: '   ' }));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire'], 'a blank name is no name'); assert.equal(out.voice, undefined);
  assert.equal(s.rows().filter((r) => r.seat === 'voice').length, 2);
});

await test('tick: Ref goes first and keeps the card slot; Voice runs beside it', async () => {
  clock.t = Date.parse('2030-02-01T11:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  s.replies.tripwire = { ...NONE, roll_talk: true, npc_change: true };
  const out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'ref', 'ledger', 'voice']);
  assert.equal(out.cards.length, 1); assert.equal(out.cards[0].seat, 'ref');
  assert.equal(out.voice.lines.length, 2);
  assert.deepEqual(s.rows().map((r) => r.seat), ['tripwire', 'ref', 'ledger', 'voice']);
});

await test('tick: a repeated Voice line is dropped by the Editor; a repeat of both is silence (still logged, cost counted)', async () => {
  clock.t = Date.parse('2030-02-01T12:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  s.replies.tripwire = { ...NONE };
  let out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.voice.lines.length, 2);
  clock.t += 60_000; await s.lines(2);
  s.replies.voice = { who: 'Mrs Test', want: 'to be paid', line_a: 'Pay up, dear.', line_b: 'A fresh line.' };
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.deepEqual(out.voice.lines, ['A fresh line.']);
  clock.t += 60_000; await s.lines(2);
  s.replies.voice = { who: 'Mrs Test', want: 'x', line_a: 'Pay up, dear.', line_b: 'A fresh line.' };
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.voice, undefined, 'both repeated: nothing shows');
  const vrows = s.rows().filter((r) => r.seat === 'voice');
  assert.equal(vrows.length, 3); assert.equal(JSON.parse(vrows[2].card).voice, undefined); assert.ok(vrows[2].cents > 0);
  // an empty "who" (the seat found nobody on stage) shows nothing either
  clock.t += 60_000; await s.lines(2);
  s.replies.voice = { who: '', want: '', line_a: '', line_b: '' };
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.voice, undefined);
});

await test('tick: a refusal or a failed Voice call shows nothing and is logged; the ladder drops Voice at 85% and the cap stops it', async () => {
  clock.t = Date.parse('2030-02-01T13:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  s.replies.tripwire = { ...NONE };
  s.replies.__stop = { voice: 'refusal' };
  let out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.voice, undefined);
  const rc = JSON.parse(s.rows().find((r) => r.seat === 'voice').card);
  assert.equal(rc.refusal, 1); assert.equal(rc.stop, 'refusal');
  s.replies.__stop = {};
  clock.t += 60_000; await s.lines(2);
  s.replies.voice = Object.assign(new Error('boom'), { status: 500 });
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.voice, undefined); assert.deepEqual(out.errors, [{ seat: 'voice', error: 'provider status 500' }]);
  // the ladder
  const seed = (cents) => s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, seat, model, cents) VALUES ('c', ?, 'seed', 'm', ?)").run(iso(clock.t - 3 * 3600_000), cents);
  s.replies.voice = REPLIES().voice; s.calls.length = 0;
  clock.t += 60_000; await s.lines(2); seed(1300);
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.spend.tier, 'reduced'); assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'voice']);
  s.calls.length = 0; clock.t += 60_000; await s.lines(2); seed(500);
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.spend.tier, 'core'); assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire'], 'core: no Voice'); assert.equal(out.voice, undefined);
  s.calls.length = 0; clock.t += 60_000; await s.lines(2); seed(500);
  out = await body(await s.post('tick', { npc: 'Mrs Test' }));
  assert.equal(out.spend.tier, 'off'); assert.equal(s.calls.length, 0, 'at the cap nothing runs'); assert.equal(out.voice, undefined);
});

await test('tick: a bad npc is a 400 before any call; the body stays small', async () => {
  const s = await setup();
  await s.lines(2);
  await assert.rejects(s.post('tick', { npc: 5 }), (e) => e.status === 400);
  await assert.rejects(s.post('tick', { npc: 'x'.repeat(81) }), (e) => e.status === 400);
  assert.equal(s.calls.length, 0);
});

await test('another: validation is a 400 and calls nothing', async () => {
  const s = await setup();
  await s.lines(2);
  for (const b of [{}, { npc: 'Mrs Test' }, { shown: ['a'] }, { npc: '', shown: ['a'] }, { npc: 'x'.repeat(81), shown: ['a'] }, { npc: 'Mrs Test', shown: [] },
    { npc: 'Mrs Test', shown: 'a' }, { npc: 'Mrs Test', shown: [1] }, { npc: 'Mrs Test', shown: ['x'.repeat(401)] }, { npc: 'Mrs Test', shown: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, { npc: 'Mrs Test', shown: [' '] }]) {
    await assert.rejects(s.post('another', b), (e) => e.status === 400, JSON.stringify(b).slice(0, 80));
  }
  const get = await s.handler({ request: new Request('https://blades.example.test/api/gm/assist/another'), env: s.env, data: { me: GM } });
  assert.equal(get.status, 405);
  assert.equal(s.calls.length, 0);
});

await test('another: voice_plus (Opus 5.5, medium) writes one more line for the NPC, told what was already shown; logged with secs and stop', async () => {
  clock.t = Date.parse('2030-02-01T14:00:00.000Z');
  const s = await setup();
  await s.lines(3);
  s.replies.__ms = { voice_plus: 4100 };
  const res = await s.post('another', { npc: ' Mrs  Test ', shown: ['Pay up, dear.', 'I could forget I saw you.'] });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.deepEqual(out.voice.lines, ['The door is open, if you are quick.']); assert.equal(out.voice.who, 'Mrs Test'); assert.deepEqual(out.cards, []);
  assert.equal(s.calls.length, 1);
  const c = s.calls[0];
  assert.equal(c.seat, 'voice_plus'); assert.equal(c.model, 'claude-opus-5-5'); assert.equal(c.effort, 'medium');
  assert.match(c.user, /one more line for this NPC: Mrs Test\./); assert.match(c.user, /1\. Pay up, dear\.\n2\. I could forget I saw you\./); assert.match(c.user, /we roll the dice now/);
  const row = s.rows()[0];
  assert.equal(row.seat, 'voice_plus'); assert.equal(row.model, 'claude-opus-5-5'); assert.equal(row.effort, 'medium'); assert.equal(row.flags, 'another');
  // opus: 1000*4 + 10000*0.2 + 200*20 = 10000 per million -> $0.01 = 1 cent
  assert.ok(Math.abs(row.cents - 1) < 1e-9, 'cents ' + row.cents);
  const card = JSON.parse(row.card);
  assert.equal(card.secs, 4.1); assert.equal(card.stop, 'end_turn'); assert.equal(card.voice, 1);
  assert.equal(out.spend.tick, 0.01);
});

await test('another: the line the GM was shown comes back as nothing; a refusal shows nothing; the busy gate and the cap answer 429', async () => {
  clock.t = Date.parse('2030-02-01T15:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  s.replies.voice_plus = { who: 'Mrs Test', line: 'pay up dear' };
  let out = await body(await s.post('another', { npc: 'Mrs Test', shown: ['Pay up, dear.'] }));
  assert.equal(out.voice, undefined, 'the same line again is dropped');
  assert.equal(JSON.parse(s.rows()[0].card).voice, undefined);
  // busy: a second tap inside the gap (a call just ran) is refused without a call
  s.calls.length = 0;
  await assert.rejects(s.post('another', { npc: 'Mrs Test', shown: ['x'] }), (e) => e.status === 429 && /busy/.test(e.message) && !/cap/.test(e.message));
  assert.equal(s.calls.length, 0);
  clock.t += 20_000;
  s.replies.__stop = { voice_plus: 'refusal' }; s.replies.voice_plus = { who: 'Mrs Test', line: 'Never shown.' };
  out = await body(await s.post('another', { npc: 'Mrs Test', shown: ['x'] }));
  assert.equal(out.voice, undefined);
  assert.equal(JSON.parse(s.rows().filter((r) => r.seat === 'voice_plus').pop().card).refusal, 1);
  // in flight in this isolate: refused as busy while the first is still out
  s.replies.__stop = {}; clock.t += 20_000;
  let release; const gate = new Promise((r) => { release = r; });
  s.replies.voice_plus = () => { throw new Error('unused'); };
  const slow = makeHandler({ clientFor: () => ({ messages: { async create() { await gate; return { content: [{ type: 'text', text: JSON.stringify({ who: 'Mrs Test', line: 'Late.' }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }; } } }), now: () => clock.t });
  const mk = () => slow({ request: new Request('https://blades.example.test/api/gm/assist/another', { method: 'POST', body: JSON.stringify({ npc: 'Mrs Test', shown: ['x'] }) }), env: s.env, data: { me: GM } });
  const first = mk();
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(mk(), (e) => e.status === 429 && /busy/.test(e.message));
  release(); assert.equal((await first).status, 200);
  // the cap
  clock.t += 600_000;
  s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, seat, model, cents) VALUES ('c', ?, 'seed', 'm', 2500)").run(iso(clock.t - 3600_000));
  s.calls.length = 0;
  await assert.rejects(s.post('another', { npc: 'Mrs Test', shown: ['x'] }), (e) => e.status === 429 && /cap/.test(e.message));
  assert.equal(s.calls.length, 0);
});

await test('another: a GM-only door (a player gets 403), an old-format assist part sends nothing', async () => {
  const s = await setup();
  await assert.rejects(s.post('another', { npc: 'Mrs Test', shown: ['x'] }, { me: { role: 'player', id: 'p@example.test' } }), (e) => e.status === 403);
  s.exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?)").run(JSON.stringify({ prefix: 'old text' }));
  await s.lines(2);
  const out = await body(await s.post('another', { npc: 'Mrs Test', shown: ['x'] }));
  assert.deepEqual(out.cards, []); assert.equal(out.voice, undefined); assert.equal(s.calls.length, 0);
});

await test('voice: the prompts name the NPC and the shown lines, and the replay script runs Voice through the Conductor', async () => {
  const { voiceUser, anotherUser } = await import('../../functions/_lib/assist/prompts.js');
  assert.equal(voiceUser({ npc: 'Mrs Test', stamp: '09:30', talk: '[09:29] A: hi' }), 'The GM has this NPC on stage: Mrs Test.\nLast four minutes, up to 09:30:\n[09:29] A: hi');
  assert.match(anotherUser({ npc: 'Mrs Test', shown: ['a', 'b'], stamp: '09:30', talk: 't' }), /for this NPC: Mrs Test\.\nLines already shown .*:\n1\. a\n2\. b\nLast four minutes, up to 09:30:\nt$/);
  const src = (await import('node:fs')).default.readFileSync(path.join(ROOT, 'scripts', 'gm-assist-replay.mjs'), 'utf8');
  assert.ok(/arg\('voice-at'\)/.test(src) && /onStage: !!npc/.test(src) && /lines\.md/.test(src) && /voice_plus/.test(src), 'the script takes --voice-at, gates on the NPC name and writes lines.md');
});

// ---------- Stall, Showrunner and Mystery (WP4) ----------
const FULL = { wakes: P1_WAKES };
const ALL_FLAGS = { ...NONE, roll_talk: true, harm: true, new_name: true, clue_mention: true, stall: true };
const seed = (s, seat, atMs, cents = 0, card = '{}') => s.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '', ?2, 'seed', '', ?3, '', ?4)").bind(iso(atMs), seat, cents, card).run();
const STALL_OFFER = { stalled: true, kind: 'complication', offer: 'A runner bursts in with bad news.', why_now: 'The table has gone quiet.' };
const SHOW = (n = 1) => ({ spotlight: [{ who: 'Quill', minutes_since: 12, note: 'quiet' }], needs_spotlight: 'Quill', beat: 'rising', elapsed_minutes: 40, advice: 'Give the scene to Quill. ' + n, speak: true });
const MYS = (n = 1) => ({ known: ['The ledger is forged ' + n], theories: [], push_next: 'The ferryman mentions the second key ' + n, must_land_item: '#' + n + ' The second key', how: 'Let the ferryman drop it while he is paid.' });

await test('conductor: Stall wakes on stall, Mystery on clue_mention, Showrunner on every tick; Ref stays first', () => {
  assert.deepEqual(WAKES.stall, ['stall']); assert.deepEqual(WAKES.mystery, ['clue_mention']); assert.deepEqual(WAKES.showrunner, ['tick']);
  assert.deepEqual(decide({ flags: ['stall'], now: T }).seats, ['stall']);
  assert.deepEqual(decide({ flags: ['clue_mention'], now: T }).seats, ['clerk', 'mystery']);
  assert.deepEqual(decide({ flags: ['tick'], now: T, wakes: P1_WAKES }).seats, ['showrunner']);
  assert.deepEqual(decide({ flags: ['scene_change'], now: T, wakes: P1_WAKES }).seats, [], 'a Tripwire flag alone never wakes the Showrunner: only the endpoint adds tick');
  assert.deepEqual(decide({ flags: ['stall', 'clue_mention', 'roll_talk', 'tick'], now: T, wakes: P1_WAKES }).seats, ['ref', 'clerk', 'ledger', 'stall', 'mystery', 'showrunner'], 'Ref is first in the list');
});

await test('conductor: Showrunner every 10 minutes, Mystery every 15, Stall every 5; one of each in flight', () => {
  assert.equal(COOLDOWN_MS.showrunner, 10 * 60_000); assert.equal(COOLDOWN_MS.mystery, 15 * 60_000); assert.equal(COOLDOWN_MS.stall, 5 * 60_000);
  const run = (flags, seat, ago, extra = {}) => decide({ flags, now: T, lastRun: { [seat]: T - ago }, ...extra }).seats.includes(seat);
  assert.equal(run(['tick'], 'showrunner', 10 * 60_000 - 1), false); assert.equal(run(['tick'], 'showrunner', 10 * 60_000), true);
  assert.equal(run(['clue_mention'], 'mystery', 15 * 60_000 - 1), false); assert.equal(run(['clue_mention'], 'mystery', 15 * 60_000), true);
  assert.equal(run(['stall'], 'stall', 5 * 60_000 - 1), false); assert.equal(run(['stall'], 'stall', 5 * 60_000), true);
  assert.equal(run(['tick'], 'showrunner', 99 * 60_000, { inFlight: ['showrunner'] }), false);
  assert.deepEqual(decide({ flags: ['tick'], now: T, lastRun: { showrunner: T - 1000 } }).skipped, [{ seat: 'showrunner', why: 'cooldown' }]);
});

await test('conductor cap tiers: Showrunner and Mystery stop at 60%, Stall and Voice at 85%, Ref, Ledger and Another run to the cap', () => {
  const flags = ['stall', 'clue_mention', 'roll_talk', 'tick'];
  const seatsAt = (spent) => decide({ flags, now: T, spent, cap: 20, onStage: true, wakes: P1_WAKES }).seats;
  assert.deepEqual(seatsAt(0), ['ref', 'clerk', 'ledger', 'stall', 'mystery', 'showrunner', 'voice']);
  assert.deepEqual(seatsAt(11.9), ['ref', 'clerk', 'ledger', 'stall', 'mystery', 'showrunner', 'voice']);
  assert.deepEqual(seatsAt(12), ['ref', 'clerk', 'ledger', 'stall', 'voice'], 'at 60% Showrunner and Mystery go, before Ref');
  assert.deepEqual(seatsAt(16.9), ['ref', 'clerk', 'ledger', 'stall', 'voice']);
  assert.deepEqual(seatsAt(17), ['ref', 'ledger'], 'at 85% Stall and Voice go; Ref and Ledger stay');
  assert.deepEqual(seatsAt(19.99), ['ref', 'ledger']);
  assert.deepEqual(seatsAt(20), [], 'at the cap nothing');
  for (const seat of ['showrunner', 'mystery']) assert.ok(DROPPED_WHEN_REDUCED.includes(seat));
  assert.ok(!CORE_SEATS.includes('stall') && !CORE_SEATS.includes('showrunner') && !CORE_SEATS.includes('mystery') && CORE_SEATS.includes('ref'));
});

await test('seats: Mystery names its Must land entry; the instructions say so and stay generic', () => {
  const m = SEATS.mystery;
  assert.ok(/Must land/.test(m.instructions) && /MUST come from/.test(m.instructions));
  assert.ok(m.schema.required.includes('must_land_item') && m.schema.properties.must_land_item);
  assert.equal(m.schema.additionalProperties, false);
});

await test('editor: a Mystery card needs a Must land entry; a Showrunner card needs something to say; repeats are dropped', () => {
  assert.equal(toCandidate('mystery', MYS(1), { now: T }).seat, 'mystery');
  assert.match(toCandidate('mystery', MYS(1), { now: T }).text, /^Push next: The ferryman mentions the second key 1 How: /);
  assert.equal(toCandidate('mystery', { ...MYS(1), must_land_item: '' }, { now: T }), null, 'not grounded in the list: dropped');
  assert.equal(toCandidate('mystery', { ...MYS(1), push_next: '  ' }, { now: T }), null, 'no push: dropped');
  assert.equal(toCandidate('mystery', null, { now: T }), null);
  const c = toCandidate('mystery', MYS(1), { now: T });
  assert.equal(toCandidate('mystery', MYS(1), { recent: [{ at: T, keys: c.keys }], now: T + 9 * 60_000 }), null, 'same push or same entry within 10 minutes');
  assert.ok(toCandidate('mystery', MYS(1), { recent: [{ at: T, keys: c.keys }], now: T + 11 * 60_000 }));
  const s1 = toCandidate('showrunner', SHOW(1), { now: T });
  assert.match(s1.text, /^Spotlight: Quill\. Give the scene to Quill/);
  assert.equal(toCandidate('showrunner', { ...SHOW(1), speak: false }, { now: T }), null, 'no clear pacing problem: no card, whatever the advice says');
  assert.equal(toCandidate('showrunner', { ...SHOW(1), speak: undefined }, { now: T }), null);
  assert.ok(SEATS.showrunner.schema.required.includes('speak'));
  assert.equal(toCandidate('showrunner', { ...SHOW(1), advice: '', needs_spotlight: 'none' }, { now: T }), null);
  assert.equal(toCandidate('showrunner', { ...SHOW(1), advice: '', needs_spotlight: '' }, { now: T }), null);
  assert.equal(toCandidate('showrunner', SHOW(1), { recent: [{ at: T, keys: s1.keys }], now: T + 60_000 }), null);
});

await test('editor: Ref beats Clerk beats Mystery beats Showrunner for the one slot; the rest are dropped, not queued; the gap holds them all', () => {
  const ref = toCandidate('ref', { slip: true, said_at: '22:14', what_was_said: 'x', rule: 'Rule (p.1)', card: 'Check the rule' }, { now: T });
  const clerk = toCandidate('clerk', { new_names: ['Zarbo'], drift: [], clues_landed: [] }, { now: T });
  const mys = toCandidate('mystery', MYS(2), { now: T }), show = toCandidate('showrunner', SHOW(2), { now: T });
  let m = merge([show, mys, clerk, ref], { now: T });
  assert.equal(m.card.seat, 'ref'); assert.deepEqual(m.dropped.map((d) => d.seat + ':' + d.why).sort(), ['clerk:ref-waiting', 'mystery:ref-waiting', 'showrunner:ref-waiting']);
  assert.deepEqual(m.held, [], 'only Ref is ever held');
  m = merge([show, mys, clerk], { now: T }); assert.equal(m.card.seat, 'clerk');
  m = merge([show, mys], { now: T }); assert.equal(m.card.seat, 'mystery'); assert.deepEqual(m.dropped, [{ seat: 'showrunner', why: 'outranked' }]);
  m = merge([show], { now: T }); assert.equal(m.card.seat, 'showrunner');
  m = merge([show, mys], { now: T, lastShownAt: T - CARD_GAP_MS + 1000 });
  assert.equal(m.card, null); assert.deepEqual(m.held, []); assert.deepEqual(m.dropped.map((d) => d.seat + ':' + d.why).sort(), ['mystery:throttle', 'showrunner:throttle']);
  assert.equal(merge([show], { now: T, lastShownAt: T - CARD_GAP_MS }).card.seat, 'showrunner');
});

await test('editor: Stall is nothing unless the table is stalled and the offer is new', () => {
  const v = toStall(STALL_OFFER, { now: T });
  assert.equal(v.kind, 'complication'); assert.equal(v.offer, 'A runner bursts in with bad news.'); assert.equal(v.keys.length, 1);
  assert.equal(toStall({ ...STALL_OFFER, stalled: false }, { now: T }), null);
  assert.equal(toStall({ ...STALL_OFFER, offer: '  ' }, { now: T }), null);
  assert.equal(toStall(null, { now: T }), null);
  assert.equal(toStall(STALL_OFFER, { recent: [{ at: T, keys: v.keys }], now: T + 60_000 }), null);
  assert.ok(toStall(STALL_OFFER, { recent: [{ at: T, keys: v.keys }], now: T + 11 * 60_000 }));
  assert.equal(toStall({ ...STALL_OFFER, kind: 'bogus' }, { now: T }).kind, 'complication');
});

await test('tick: the stall flag wakes Stall; its offer goes to the Rack (stall), not the card stream; the row has secs and stop', async () => {
  clock.t = Date.parse('2030-03-01T09:00:00.000Z');
  const s = await setup(FULL);
  s.replies.__ms = { stall: 3500, showrunner: 500 };
  await s.lines(3);
  s.replies.tripwire = { ...NONE, stall: true };
  s.replies.stall = STALL_OFFER;
  s.replies.showrunner = { ...s.replies.showrunner, speak: false };
  const out = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'stall', 'showrunner']);
  const stallCall = s.calls.find((c) => c.seat === 'stall');
  assert.equal(stallCall.model, 'claude-sonnet-5-5'); assert.equal(stallCall.effort, 'low');
  assert.deepEqual(out.cards, [], 'not a card');
  assert.equal(out.stall.offer, 'A runner bursts in with bad news.'); assert.equal(out.stall.kind, 'complication'); assert.ok(out.stall.at);
  const row = s.rows().find((r) => r.seat === 'stall'), card = JSON.parse(row.card);
  assert.equal(card.stall, 1); assert.ok(card.secs >= 3.5 && card.secs <= 4, 'the fake clock is shared with the Showrunner'); assert.equal(card.stop, 'end_turn'); assert.equal(card.shown, undefined, 'never in the card gap');
  // a minute later the flag is still set: the 5-minute cooldown means no second call
  s.calls.length = 0; clock.t += 60_000; await s.lines(2);
  const again = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire']); assert.equal(again.stall, undefined);
  // 5 minutes on, the same offer is a repeat: logged, shows nothing; a new one shows
  s.calls.length = 0; clock.t += 5 * 60_000; await s.lines(2);
  assert.equal((await body(await s.post('tick', {}))).stall, undefined, 'the same offer inside 10 minutes');
  s.calls.length = 0; clock.t += 6 * 60_000; await s.lines(2);
  s.replies.stall = { ...STALL_OFFER, offer: 'The lamps go out.' };
  assert.equal((await body(await s.post('tick', {}))).stall.offer, 'The lamps go out.');
  // the table is not stalled: nothing shows
  s.calls.length = 0; clock.t += 6 * 60_000; await s.lines(2);
  s.replies.stall = { stalled: false, kind: 'none', offer: '', why_now: 'busy' };
  const quiet = await body(await s.post('tick', {}));
  assert.equal(quiet.stall, undefined); assert.deepEqual(quiet.cards, []);
});

await test('tick: Showrunner runs every ten minutes (not each tick), reads 20 minutes of talk, and its card obeys the five-minute gap', async () => {
  clock.t = Date.parse('2030-03-02T09:00:00.000Z');
  const s = await setup(FULL);
  s.replies.tripwire = { ...NONE };
  let n = 0; s.replies.showrunner = () => SHOW(++n);
  const seen = [];
  for (let min = 0; min <= 22; min++) {
    s.calls.length = 0; await s.lines(2);
    const out = await body(await s.post('tick', {}));
    if (s.calls.some((c) => c.seat === 'showrunner')) seen.push({ min, user: s.calls.find((c) => c.seat === 'showrunner').user, card: out.cards[0] || null });
    clock.t += 60_000;
  }
  assert.deepEqual(seen.map((x) => x.min), [0, 10, 20], 'every ten minutes');
  assert.match(seen[0].user, /^Talk of the last 20 minutes, up to \d\d:\d\d/);
  assert.ok(seen.every((x) => x.card && x.card.seat === 'showrunner' && /^Spotlight: Quill/.test(x.card.text)), 'each run is a card, ten minutes apart');
  assert.equal(s.rows().filter((r) => r.seat === 'showrunner' && JSON.parse(r.card).shown === 1).length, 3);
  // a card shown a minute ago: the Showrunner's is held back by the gap and dropped, not queued
  clock.t += 10 * 60_000; await s.lines(2);
  await seed(s, 'ref', clock.t - 60_000, 0, JSON.stringify({ shown: 1, text: 'a slip', keys: ['ref:x'] }));
  s.calls.length = 0;
  const held = await body(await s.post('tick', {}));
  assert.ok(s.calls.some((c) => c.seat === 'showrunner')); assert.deepEqual(held.cards, [], 'the gap holds it');
  assert.equal(JSON.parse(s.rows().filter((r) => r.seat === 'showrunner').pop().card).shown, 0);
});

await test('tick: Mystery runs on clue_mention at most every 15 minutes, is handed what it reported known, and needs a Must land entry', async () => {
  clock.t = Date.parse('2030-03-03T09:00:00.000Z');
  const s = await setup(FULL);
  await seed(s, 'showrunner', clock.t - 60_000);        // keep the Showrunner out of this one
  s.replies.tripwire = { ...NONE };
  let n = 0; s.replies.mystery = () => MYS(++n);
  await s.lines(3);
  let out = await body(await s.post('tick', {}));
  assert.ok(!s.calls.some((c) => c.seat === 'mystery'), 'no clue_mention, no Mystery');
  s.replies.tripwire = { ...NONE, clue_mention: true };
  s.calls.length = 0; clock.t += 60_000; await s.lines(3);
  out = await body(await s.post('tick', {}));
  const m1 = s.calls.find((c) => c.seat === 'mystery');
  assert.ok(m1 && m1.model === 'claude-sonnet-5-5' && m1.effort === 'medium');
  assert.match(m1.user, /^Talk of the last 15 minutes, up to /); assert.ok(!/reported these as known/.test(m1.user), 'first run: nothing known yet');
  assert.equal(out.cards.length, 1); assert.equal(out.cards[0].seat, 'mystery'); assert.match(out.cards[0].text, /^Push next: The ferryman mentions the second key 1/);
  // inside 15 minutes: no second call, though the flag is still set
  s.calls.length = 0; clock.t += 14 * 60_000; await s.lines(3);
  await body(await s.post('tick', {}));
  assert.ok(!s.calls.some((c) => c.seat === 'mystery'));
  // at 15 minutes it runs again, told what it reported known
  s.calls.length = 0; clock.t += 60_000; await s.lines(3);
  s.replies.mystery = { ...MYS(2), must_land_item: '' };
  out = await body(await s.post('tick', {}));
  const m2 = s.calls.find((c) => c.seat === 'mystery');
  assert.ok(m2 && /reported these as known earlier tonight[^]*- The ledger is forged 1/.test(m2.user));
  assert.ok(!out.cards.some((c) => c.seat === 'mystery'), 'a push that names no Must land entry is dropped');
  const rows = s.rows().filter((r) => r.seat === 'mystery').map((r) => JSON.parse(r.card));
  assert.equal(rows.length, 2); assert.equal(rows[0].shown, 1); assert.equal(rows[1].shown, 0); assert.ok(rows.every((c) => typeof c.secs === 'number' && c.stop === 'end_turn'));
});

await test('tick: with every seat on, Ref takes the slot and the others are dropped; across 30 minutes no two cards are closer than five', async () => {
  clock.t = Date.parse('2030-03-04T09:00:00.000Z');
  const s = await setup({ wakes: P1_WAKES, env: { ASSIST_CAP_USD: '1000' } });
  s.replies.tripwire = { ...ALL_FLAGS };
  let n = 0;
  s.replies.ref = () => ({ slip: true, said_at: '09:0' + (n % 10), what_was_said: 'x', rule: 'Rule number ' + n + ' (p.' + n + ')', card: 'Slip ' + n });
  s.replies.clerk = () => ({ new_names: ['Name' + n], drift: [], clues_landed: [] });
  s.replies.mystery = () => MYS(n + 1); s.replies.showrunner = () => SHOW(n + 1); s.replies.stall = () => ({ ...STALL_OFFER, offer: 'Offer ' + n });
  const shown = [];
  let first = null;
  for (let min = 0; min < 31; min++) {
    n++; s.calls.length = 0; await s.lines(2);
    const out = await body(await s.post('tick', {}));
    if (min === 0) first = { seats: s.calls.map((c) => c.seat), out };
    assert.ok(out.cards.length <= 1, 'at most one card a tick');
    if (out.cards.length) shown.push({ min, seat: out.cards[0].seat });
    clock.t += 60_000;
  }
  assert.deepEqual(first.seats, ['tripwire', 'ref', 'clerk', 'ledger', 'stall', 'mystery', 'showrunner'], 'every seat woke, Ref first');
  assert.equal(first.out.cards[0].seat, 'ref'); assert.ok(first.out.stall, 'Stall went to the Rack beside the card');
  const gaps = shown.slice(1).map((c, i) => c.min - shown[i].min);
  assert.ok(shown.length >= 5 && shown.length <= 7, 'a card about every five minutes: ' + JSON.stringify(shown));
  assert.ok(gaps.every((g) => g >= 5), 'never closer than five minutes: ' + JSON.stringify(gaps));
  const dropped = s.rows().filter((r) => ['mystery', 'showrunner', 'clerk'].includes(r.seat)).filter((r) => JSON.parse(r.card).shown === 0).length;
  assert.ok(dropped > 0, 'cards the gap or Ref held back are logged, not shown');
});

await test('tick: the cap tiers on the endpoint: past 60% no Showrunner or Mystery, past 85% no Stall either, at the cap nothing', async () => {
  clock.t = Date.parse('2030-03-05T09:00:00.000Z');
  const calls = async (cents) => {
    const s = await setup(FULL);
    await seed(s, 'fixer', clock.t - 3 * 3600_000, cents);
    await s.lines(3);
    s.replies.tripwire = { ...ALL_FLAGS };
    s.replies.stall = STALL_OFFER;
    const out = await body(await s.post('tick', {}));
    return { seats: s.calls.map((c) => c.seat), out };
  };
  assert.deepEqual((await calls(0)).seats, ['tripwire', 'ref', 'clerk', 'ledger', 'stall', 'mystery', 'showrunner']);
  assert.deepEqual((await calls(1300)).seats, ['tripwire', 'ref', 'clerk', 'ledger', 'stall']);
  const core = await calls(1800);
  assert.deepEqual(core.seats, ['tripwire', 'ref', 'ledger']); assert.equal(core.out.stall, undefined); assert.equal(core.out.spend.tier, 'core');
  const off = await calls(2000);
  assert.deepEqual(off.seats, []); assert.deepEqual(off.out.cards, []); assert.equal(off.out.stall, undefined); assert.equal(off.out.spend.tier, 'off');
});

await test('tick: a cap of 0, or a refusal: Stall, Showrunner and Mystery show nothing and nothing breaks', async () => {
  clock.t = Date.parse('2030-03-06T09:00:00.000Z');
  let s = await setup({ ...FULL, env: { ASSIST_CAP_USD: '0' } });
  await s.lines(3);
  let out = await body(await s.post('tick', {}));
  assert.equal(s.calls.length, 0); assert.deepEqual(out.cards, []); assert.equal(out.stall, undefined);
  // a refusal on Stall, Showrunner and Mystery: logged as such, nothing shown
  clock.t += 3600_000;
  s = await setup(FULL);
  await s.lines(3);
  s.replies.tripwire = { ...ALL_FLAGS }; s.replies.stall = STALL_OFFER; s.replies.mystery = MYS(1); s.replies.showrunner = SHOW(1);
  s.replies.__stop = { stall: 'refusal', mystery: 'refusal', showrunner: 'refusal' };
  out = await body(await s.post('tick', {}));
  assert.equal(out.stall, undefined); assert.deepEqual(out.cards.map((c) => c.seat), ['ref'], 'only Ref shows');
  for (const seat of ['stall', 'mystery', 'showrunner']) {
    const c = JSON.parse(s.rows().find((r) => r.seat === seat).card);
    assert.equal(c.refusal, 1, seat); assert.equal(c.stop, 'refusal'); assert.ok(!c.shown && !c.stall);
  }
});

await test('tick: every new seat call logs its secs and stop reason, even a failed one', async () => {
  clock.t = Date.parse('2030-03-07T09:00:00.000Z');
  const s = await setup(FULL);
  await s.lines(3);
  s.replies.tripwire = { ...NONE, stall: true, clue_mention: true };
  s.replies.__ms = { stall: 2000, mystery: 4000, showrunner: 1000 };
  s.replies.stall = new Error('boom');
  const out = await body(await s.post('tick', {}));
  const by = Object.fromEntries(s.rows().map((r) => [r.seat, JSON.parse(r.card)]));
  assert.ok(by.mystery.secs >= 4 && by.showrunner.secs >= 1 && by.stall.secs >= 2, 'the fake clock is shared, so each is at least its own time');
  assert.equal(by.stall.error, 'call failed'); assert.deepEqual(out.errors, [{ seat: 'stall', error: 'call failed' }]);
});

await test('tick: Ref has priority: a non-Ref card never holds a slip back, a Ref card does, and a held slip is released by a quiet tick', async () => {
  clock.t = Date.parse('2030-03-08T09:00:00.000Z');
  let s = await setup(FULL);
  await seed(s, 'showrunner', clock.t - 60_000);
  await seed(s, 'showrunner', clock.t - 90_000, 0, JSON.stringify({ shown: 1, text: 'pacing note', keys: ['showrunner:x'] }));
  await s.lines(2);
  s.replies.tripwire = { ...NONE, roll_talk: true };
  let out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards.map((c) => c.seat), ['ref'], 'a pacing note 90 seconds ago does not hold the slip');
  // but a non-Ref card cannot show within five minutes of a Ref card
  clock.t += 60_000; await s.lines(2);
  s.replies.tripwire = { ...NONE, clue_mention: true }; s.replies.mystery = MYS(1);
  out = await body(await s.post('tick', {}));
  assert.ok(!out.cards.some((c) => c.seat === 'mystery'), 'Mystery waits out the Ref card');
  // a second slip inside five minutes of a Ref card IS held, and a quiet tick releases it once the gap passes
  clock.t += 60_000; await s.lines(2);
  s.replies.tripwire = { ...NONE, roll_talk: true }; s.replies.ref = { ...REF_SLIP, said_at: '09:40', rule: 'Another rule (p.2)', card: 'A different slip' };
  out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, [], 'held behind the earlier Ref card');
  clock.t += 3.1 * 60_000; await s.lines(2); s.calls.length = 0;
  s.replies.tripwire = { ...NONE };
  out = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'ref'], 'only the Ref follow-through woke (the previous tick flagged roll_talk)');
  assert.equal(out.cards.length, 1); assert.equal(out.cards[0].text, 'A different slip');
  clock.t += 60_000; await s.lines(2);
  assert.deepEqual((await body(await s.post('tick', {}))).cards, []);
});

await test('editor: Ref outranks the gap of every non-Ref card; the gap still holds Ref-to-Ref and every non-Ref card', () => {
  const ref = toCandidate('ref', { slip: true, said_at: '22:14', what_was_said: 'x', rule: 'Rule (p.1)', card: 'Check the rule' }, { now: T });
  const mys = toCandidate('mystery', MYS(3), { now: T });
  let m = merge([ref], { now: T, lastShownAt: T - 1000, lastRefShownAt: null });
  assert.equal(m.card.seat, 'ref', 'a non-Ref card a second ago: Ref still shows');
  m = merge([ref], { now: T, lastShownAt: T - 1000, lastRefShownAt: T - 1000 });
  assert.equal(m.card, null); assert.deepEqual(m.held, [ref]);
  m = merge([mys], { now: T, lastShownAt: T - 1000, lastRefShownAt: T - 1000 });
  assert.equal(m.card, null, 'a non-Ref card waits five minutes after a Ref card');
});

await test('a reply cut off at the token limit shows nothing and is logged as truncated; the Ledger has headroom', async () => {
  assert.equal(SEATS.ledger.maxTokens, 4000);
  clock.t = Date.parse('2030-03-09T09:00:00.000Z');
  const s = await setup();
  await s.lines(3);
  s.replies.tripwire = { ...NONE, roll_talk: true };
  s.replies.ledger = { events: [{ at: '09:00', who: 'Quill', kind: 'stress', note: '+1' }], xp_totalled: false };   // parseable, but the provider says it was cut off
  s.replies.ref = { ...REF_SLIP, slip: false, card: '' };
  s.replies.__stop = { ledger: 'max_tokens' };
  const out = await body(await s.post('tick', {}));
  assert.deepEqual(out.updates, []); assert.deepEqual(out.cards, []);
  const c = JSON.parse(s.rows().find((r) => r.seat === 'ledger').card);
  assert.equal(c.stop, 'max_tokens'); assert.equal(c.truncated, 1); assert.ok(!c.update && !c.shown);
});

await test('WP4: the prompts name how far back Showrunner and Mystery read, and the replay script drives the real endpoint', () => {
  assert.equal(showrunnerUser({ stamp: '22:10', talk: 'T' }), 'Talk of the last 20 minutes, up to 22:10 (earlier talk is not shown):\nT');
  assert.equal(mysteryUser({ stamp: '22:10', talk: 'T' }), 'Talk of the last 15 minutes, up to 22:10 (earlier talk is not shown):\nT');
  assert.match(mysteryUser({ stamp: '22:10', talk: 'T', known: ['a', 'b'] }), /^You reported these as known earlier tonight \(already learned\):\n- a\n- b\nTalk of/);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'gm-assist-replay.mjs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'tap-sim.mjs'), 'utf8');   // the Tap loop lives in lib/tap-sim.mjs, shared with the gate
  assert.ok(/flag\('tap-sim'\)/.test(src) && /makeHandler\(/.test(src) && /arg\('turn-at'\)/.test(src) && /must_land_item/.test(src), 'the script takes --tap-sim (through makeHandler) and --turn-at, and checks the Must land entry');
});

await test('tripwire: the stall flag is narrow (circling, silence, unanswered question, side-chatter) and the schema says so', () => {
  const ins = SEATS.tripwire.instructions;
  const i = ins.indexOf('stall (');
  assert.ok(i > 0, 'the stall flag has its own definition');
  const def = ins.slice(i, ins.indexOf('Prefer false'));
  for (const w of ['going in circles', 'no decision', 'long silence', 'side-chatter', 'ONLY then', 'Normal planning', 'banter during action']) assert.ok(def.includes(w), w);
  assert.ok(!/idle|off-topic/.test(def), 'the old loose wording is gone');
  assert.equal(Object.keys(SEATS.tripwire.schema.properties).length, 8);
  assert.ok(/stopped or is going in circles/.test(SEATS.tripwire.schema.properties.stall.description));
  assert.equal(SEATS.tripwire.schema.properties.roll_talk.description, undefined, 'other flags keep their plain schema');
});

await test('follow-through (pure): Ref is woken once after a roll_talk tick, under the same gates, and never chains', () => {
  const P = { at: T, flags: ['roll_talk', 'tick'] }, W = WAKES;
  assert.equal(followsThrough(P, T + 60_000), true);
  assert.equal(followsThrough({ at: T, flags: ['harm'] }, T + 60_000), false, 'only roll_talk follows');
  assert.equal(followsThrough(null, T), false);
  assert.equal(followsThrough(P, T + FOLLOW_WINDOW_MS + 1), false, 'a stale tick does not follow');
  const base = { flags: ['tick'], now: T + 61_000, lastRun: { ref: T + 1 }, wakes: W };
  assert.deepEqual(decide({ ...base, follow: true }).seats.slice(0, 1), ['ref'], 'woken with no flag');
  assert.ok(!decide({ ...base }).seats.includes('ref'), 'no follow, no wake');
  assert.deepEqual(decide({ ...base, flags: ['roll_talk', 'tick'], follow: true }).seats.filter((x) => x === 'ref'), ['ref'], 'a real roll_talk wake is not doubled');
  // a follow-through tick has no roll_talk flag, so its Tripwire row cannot start another
  assert.equal(followsThrough({ at: T + 61_000, flags: ['tick'] }, T + 122_000), false, 'no chain');
  // gates
  assert.ok(!decide({ ...base, follow: true, inFlight: ['ref'] }).seats.includes('ref'), 'in flight');
  assert.ok(!decide({ ...base, follow: true, lastRun: { ref: T + 61_000 - 30_000 } }).seats.includes('ref'), 'cooldown');
  assert.ok(!decide({ ...base, follow: true, spent: 20, cap: 20 }).seats.includes('ref'), 'cap reached');
  assert.ok(decide({ ...base, follow: true, spent: 18, cap: 20 }).seats.includes('ref'), 'core tier still runs Ref');
});

await test('tick: Ref follows a roll_talk tick once on the next tick with new talk, not again, and the same slip never shows twice', async () => {
  clock.t = Date.parse('2030-04-01T09:00:00.000Z');
  const s = await setup(FULL);
  await s.lines(3);
  s.replies.tripwire = { ...NONE, roll_talk: true };
  s.replies.showrunner = { ...s.replies.showrunner, speak: false };
  const t1 = await body(await s.post('tick', {}));
  assert.equal(t1.cards.filter((c) => c.seat === 'ref').length, 1, 'tick 1 shows the slip');
  // tick 2: new talk, the Tripwire flags nothing; Ref still looks once, and finds the same slip: no second card
  s.calls.length = 0; clock.t += 61_000; await s.lines(2);
  s.replies.tripwire = { ...NONE };
  const t2 = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire', 'ref'], 'follow-through call');
  assert.deepEqual(t2.cards.filter((c) => c.seat === 'ref'), [], 'the same slip is dropped by the repeat rule');
  // tick 3: Ref does not chain
  s.calls.length = 0; clock.t += 61_000; await s.lines(2);
  const t3 = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), ['tripwire'], 'no chain');
  assert.deepEqual(t3.cards, []);
  // a tick with no new talk costs nothing and does not use the follow-through up
  s.calls.length = 0; clock.t += 61_000; s.replies.tripwire = { ...NONE, roll_talk: true }; await s.lines(2);
  await s.post('tick', {});
  s.calls.length = 0; clock.t += 61_000; s.replies.tripwire = { ...NONE };
  const idle = await body(await s.post('tick', {}));
  assert.deepEqual(s.calls.map((c) => c.seat), [], 'no new talk, no call'); assert.deepEqual(idle.cards, []);
});

// ---------- handout suggestions and the Fixer's dots ----------
const HO_PART = { v: 1, rel: 'x', items: [{ id: 'torn-map', title: 'Torn map', file: '0123456789abcdef.png', when: 'The table finds the old route' }, { id: 'receipt', title: 'Crumpled receipt', file: 'fedcba9876543210.jpg' }] };
const putHandouts = (s, body) => s.exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'handouts', 'v', '{}', 0, ?)").run(typeof body === 'string' ? body : JSON.stringify(body));
const MYS_H = (n, id, push = true) => ({ ...MYS(n), ...(push ? {} : { push_next: '', must_land_item: '' }), handout_id: id, handout_why: 'They have just found the old route.' });

await test('editor: toHandout keeps an id that is in the live handouts part and drops anything else', () => {
  const ids = handoutIds(HO_PART);
  assert.deepEqual([...ids].sort(), ['receipt', 'torn-map']);
  assert.deepEqual(toHandout({ handout_id: ' torn-map ', handout_why: 'on cue' }, ids), { id: 'torn-map', why: 'on cue', kind: 'idea', headline: 'Show handout: torn-map?', bullets: ['on cue'] }, 'no titles given: the id stands in');
  assert.equal(toHandout({ handout_id: 'unknown-one', handout_why: 'x' }, ids), null, 'not in the pack: dropped');
  assert.equal(toHandout({ handout_id: '', handout_why: 'x' }, ids), null);
  assert.equal(toHandout({ handout_id: 7 }, ids), null);
  assert.equal(toHandout({}, ids), null); assert.equal(toHandout(null, ids), null);
  assert.equal(toHandout({ handout_id: 'torn-map' }, new Set()), null, 'no handouts part: nothing can be offered');
  assert.equal(handoutIds(null).size, 0); assert.equal(handoutIds({ items: 'no' }).size, 0); assert.equal(handoutIds({ items: [null, { id: 3 }, { id: '' }] }).size, 0);
  assert.equal(merge([], { now: T }).card, null, 'merge() never sees a handout');
});

await test('tick: a Mystery handout_id in the live handouts part passes through as its own field; an unknown one is dropped', async () => {
  clock.t = Date.parse('2030-03-03T10:00:00.000Z');
  const s = await setup(FULL);
  putHandouts(s, HO_PART);
  await seed(s, 'showrunner', clock.t - 60_000);
  s.replies.tripwire = { ...NONE, clue_mention: true };
  s.replies.mystery = () => MYS_H(1, 'torn-map');
  await s.lines(3);
  let out = await body(await s.post('tick', {}));
  assert.deepEqual({ id: out.handout.id, why: out.handout.why }, { id: 'torn-map', why: 'They have just found the old route.' });
  assert.equal(out.cards.length, 1); assert.equal(out.cards[0].seat, 'mystery'); assert.ok(!('handout' in out.cards[0]), 'the card is the push, not the handout');
  assert.equal(JSON.parse(s.rows().filter((r) => r.seat === 'mystery').pop().card).handout.id, 'torn-map', 'logged on the Mystery row');
  // an id the pack does not hold is dropped, and the card is untouched
  clock.t += 16 * 60_000; await s.lines(3);
  s.replies.mystery = () => MYS_H(2, 'made-up-id');
  out = await body(await s.post('tick', {}));
  assert.ok(!('handout' in out), 'unknown id dropped');
  assert.equal(out.cards.length, 1);
});

await test('tick: a handout does not take the card slot (it comes with no card, and while the gap holds the cards back)', async () => {
  clock.t = Date.parse('2030-03-03T11:00:00.000Z');
  const s = await setup(FULL);
  putHandouts(s, HO_PART);
  await seed(s, 'showrunner', clock.t - 60_000);
  await seed(s, 'ref', clock.t - 60_000, 0, JSON.stringify({ shown: 1, text: 'a slip', keys: ['ref:x'] }));    // a card shown a minute ago: the gap is closed
  s.replies.tripwire = { ...NONE, clue_mention: true };
  s.replies.mystery = () => MYS_H(1, 'receipt');
  await s.lines(3);
  const out = await body(await s.post('tick', {}));
  assert.deepEqual(out.cards, [], 'the gap holds the push back');
  assert.equal(out.handout.id, 'receipt', 'the handout still comes');
  // and with no push at all the handout still comes, with no card
  clock.t += 16 * 60_000; await s.lines(3);
  s.replies.mystery = () => MYS_H(2, 'torn-map', false);
  const out2 = await body(await s.post('tick', {}));
  assert.deepEqual(out2.cards, []); assert.equal(out2.handout.id, 'torn-map');
});

await test('tick: no handouts part, an empty id, or a part over 16 KB means no handout', async () => {
  clock.t = Date.parse('2030-03-03T12:00:00.000Z');
  const s = await setup(FULL);
  await seed(s, 'showrunner', clock.t - 60_000);
  s.replies.tripwire = { ...NONE, clue_mention: true };
  s.replies.mystery = () => MYS_H(1, 'torn-map');
  await s.lines(3);
  assert.ok(!('handout' in await body(await s.post('tick', {}))), 'no part');
  putHandouts(s, { ...HO_PART, pad: 'z'.repeat(17 * 1024) });
  clock.t += 16 * 60_000; await s.lines(3);
  s.replies.mystery = () => MYS_H(2, 'torn-map');
  assert.ok(!('handout' in await body(await s.post('tick', {}))), 'over 16 KB: not read');
  s.exec.db.prepare("DELETE FROM gm_pack WHERE part = 'handouts'").run(); putHandouts(s, HO_PART);
  clock.t += 16 * 60_000; await s.lines(3);
  s.replies.mystery = () => MYS_H(3, '');
  assert.ok(!('handout' in await body(await s.post('tick', {}))), 'empty id');
});

await test('the Mystery schema takes an optional handout_id and its instructions say to use the list only', () => {
  const m = SEATS.mystery;
  assert.equal(m.schema.properties.handout_id.type, 'string');
  assert.ok(!m.schema.required.includes('handout_id'), 'optional');
  assert.match(m.instructions, /handouts list[^]*only when the talk shows the table has just reached the moment its cue describes[^]*only from that list/);
});

await test('fit: dots reach the Fixer turn when set; without dots the turn is as before; bad dots are a 400', async () => {
  clock.t = Date.parse('2030-01-01T16:00:00.000Z');
  const s = await setup();
  await s.lines(2);
  await body(await s.post('fit', { position: 'risky', effect: 'standard', dots: 3, draws: DRAWS }));
  assert.match(s.calls[0].user, /The GM names the position: risky\. Effect: standard\. Dots: 3\.\n/);
  clock.t += 60 * 60_000; s.calls.length = 0;
  await body(await s.post('fit', { position: 'risky', effect: 'standard', dots: 0, draws: DRAWS }));
  assert.match(s.calls[0].user, /Dots: 0\./, 'zero is a real value');
  clock.t += 60 * 60_000; s.calls.length = 0;
  await body(await s.post('fit', { position: 'risky', effect: 'standard', draws: DRAWS }));
  assert.ok(!/Dots/.test(s.calls[0].user), 'no dots, no mention');
  assert.match(s.calls[0].user, /The GM names the position: risky\. Effect: standard\.\nThe console has drawn/);
  for (const dots of [5, -1, 1.5, '2', null, true, [2]]) await assert.rejects(s.post('fit', { position: 'risky', dots, draws: DRAWS }), (e) => e.status === 400 && /dots/.test(e.message), JSON.stringify(dots));
  assert.equal(cleanDots(undefined), undefined); assert.equal(cleanDots(4), 4); assert.equal(cleanDots(0), 0); assert.equal(cleanDots(5), null);
});

console.log(failed ?`\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
