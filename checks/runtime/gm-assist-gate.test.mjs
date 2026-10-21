// The gate replay (scripts/lib/gate.mjs, scripts/gm-assist-gate.mjs). A mocked Claude client, an invented transcript and prefix: no network,
// no key, no campaign text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SEATS } from '../../functions/_lib/assist/seats.js';
import { parseMinutes } from '../../scripts/lib/tap-sim.mjs';
import { runGate, report, parseExpectRef, matchRef, cardsPer30, median, blankFromSchema, GATE } from '../../scripts/lib/gate.mjs';
import { main } from '../../scripts/gm-assist-gate.mjs';

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// An invented evening, 21:00 to 21:40. Two moments say "SLIP1" / "SLIP2": the mock Ref calls those slips.
const lines = [];
for (let m = 0; m <= 40; m++) {
  const hh = '21', mm = String(m).padStart(2, '0');
  const text = m === 10 ? 'We rolled first and SLIP1 named the risk after.' : m === 25 ? 'The dice came before the position, SLIP2.' : 'Zed the fixer shuffles the cards and chats.';
  lines.push(`- **[${hh}:${mm}] Ana:** ${text}`);
}
const TRANSCRIPT = ['---', 'status: done', '---', '## Transcript', ...lines].join('\n');
const PREFIX = '<context name="invented.md">\nRules: position first. Zed the fixer is a cast member.\n</context>';

const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
const seatOf = (ins) => Object.keys(SEATS).find((k) => ins.startsWith(SEATS[k].instructions)) || 'other';

function mockClient({ usage = { input_tokens: 1000, output_tokens: 200 }, stops = {}, ms = {}, slips = true } = {}) {
  const calls = [];
  return {
    calls, counts: 0,
    messages: {
      async create(req) {
        const texts = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
        const seat = seatOf(texts[0]), user = texts[texts.length - 1];
        calls.push({ seat, user });
        if (ms[seat]) await new Promise((r) => setTimeout(r, ms[seat]));
        let out;
        if (seat === 'tripwire') out = { ...NONE, roll_talk: /SLIP/.test(user) };
        else if (seat === 'ref') {
          const m = /SLIP(\d)/.exec(user);
          out = slips && m ? { slip: true, said_at: m[1] === '1' ? '21:10' : '21:25', what_was_said: 'roll before position', rule: 'Rule number ' + m[1] + ' (p.' + m[1] + ')', card: 'Position after the roll (' + m[1] + ')' } : { slip: false, said_at: '', what_was_said: '', rule: '', card: '' };
        } else if (seat === 'fixer') out = { read: 'r', one_three: 'fitted low', four_five: 'fitted mid', six: 's', crit: 'c', bargain: 'b' };
        else if (seat === 'voice') out = { who: 'Mrs Test', want: 'rent', line_a: 'Pay up.', line_b: 'Or else.' };
        else out = blankFromSchema(SEATS[seat].schema);
        return { content: [{ type: 'text', text: JSON.stringify(out) }], usage, stop_reason: stops[seat] || 'end_turn' };
      },
      async countTokens() { throw new Error('should not be called'); },
    },
  };
}

const DRAWS = (hhmm) => ({ position: 'risky', low: 'low draw ' + hhmm, mid: 'mid draw ' + hhmm });
const base = (client, extra = {}) => ({ client, prefix: PREFIX, allMinutes: parseMinutes(TRANSCRIPT), drawsFor: DRAWS, label: 's99', ...extra });

await test('parseExpectRef and matchRef: within 2 minutes, ~ and the window', () => {
  const e = parseExpectRef('21:10,~21:25, 21:38,22:30');
  assert.deepEqual(e.map((x) => [x.spec, x.approx]), [['21:10', false], ['~21:25', true], ['21:38', false], ['22:30', false]]);
  assert.throws(() => parseExpectRef('9pm'), /bad --expect-ref/);
  const shown = [{ t: 21 * 60 + 12, seat: 'ref' }, { t: 21 * 60 + 28, seat: 'ref' }, { t: 21 * 60 + 38, seat: 'clerk' }];
  const m = matchRef(e, shown, { fromT: 21 * 60, toT: 21 * 60 + 40 });
  assert.equal(m[0].caught, true); assert.equal(m[0].offset_min, 2);      // +2 is inside
  assert.equal(m[1].caught, false);                                       // +3 is outside
  assert.equal(m[2].caught, false);                                       // a clerk card is not Ref
  assert.equal(m[3].inWindow, false);
});

await test('cardsPer30 and median', () => {
  assert.equal(cardsPer30(3, 60), 1.5);
  assert.equal(cardsPer30(1, 90), 0.33);
  assert.equal(cardsPer30(5, 0), 0);
  assert.equal(median([9, 1, 5]), 5); assert.equal(median([4, 2, 8, 6]), 4); assert.equal(median([]), 0);
});

await test('a full mocked gate: Ref catches the expected slips, sections, spend by seat, criteria', async () => {
  const client = mockClient({ ms: { fixer: 5 } });
  const g = await runGate(base(client, { fixerAt: ['21:12', '21:30'], voiceAt: [{ at: '21:15', npc: 'Mrs Test' }, { at: '21:20', npc: '' }], expectRef: parseExpectRef('21:10,~21:25,21:39'), maxSpend: 15 }));
  assert.equal(g.partial, false);
  assert.equal(g.window.from, '21:00'); assert.equal(g.window.to, '21:40'); assert.equal(g.window.minutes, 41);
  const refCards = g.cards.filter((c) => c.seat === 'ref');
  assert.ok(refCards.length >= 2, 'both slips showed a card: ' + JSON.stringify(g.cards));
  assert.deepEqual(g.ref.map((r) => r.caught), [true, true, false]);
  assert.equal(g.criteria.find((c) => c.id === 'ref').result, 'FAIL', 'the 21:39 expectation was missed');
  assert.equal(g.cardsPer30, Math.round((g.cards.length / (41 / 30)) * 100) / 100);
  // spend adds up
  const sum = Object.values(g.spend.bySeat).reduce((a, v) => a + v.cost, 0);
  assert.ok(Math.abs(sum - g.spend.total) < 1e-9 && g.spend.total > 0);
  assert.equal(g.spend.bySeat.fixer.calls, 2); assert.equal(g.spend.bySeat.voice.calls, 1);
  assert.equal(client.calls.filter((c) => c.seat === 'voice').length, 1, 'the moment with no NPC makes no call');
  assert.equal(g.voice[1].silent, true); assert.deepEqual(g.voice[0].lines, ['Pay up.', 'Or else.']);
  assert.equal(g.fixer.calls, 2); assert.ok(g.fixer.max >= 0); assert.equal(g.fixer.moments[0].draws.low, 'low draw 21:12');
  assert.equal(g.criteria.find((c) => c.id === 'median').result, 'PASS');
  assert.equal(g.criteria.find((c) => c.id === 'keep').result, 'NEEDS-ALEX');
  assert.equal(g.criteria.find((c) => c.id === 'cpu').result, 'NEEDS-ALEX');
  assert.ok(g.spend.projectedNight > 0);
  const md = report({ ...g, label: 's03' });
  for (const h of ['## Criteria', '## Spend', '## Cards', '## Ref', '## Fixer', '## Voice', '## Refusals and truncations']) assert.ok(md.includes(h), 'section ' + h);
  assert.match(md, /- \[ \] 1\. 21:1\d \*\*ref\*\*/);                      // a numbered checklist with time and seat
  assert.match(md, /\| 1-3 \| low draw 21:12 \| fitted low \|/);           // the draw beside the fitted line
  assert.match(md, /hold-out/);                                            // s03 is flagged
  assert.match(md, /\*\*PASS\*\* \| Fixer median/);
  assert.match(md, /silent \(no NPC named/);
});

await test('every tap seat is on and the Fixer median FAILs when slow', async () => {
  const client = mockClient({ ms: { fixer: 40 } });
  const g = await runGate(base(client, { fixerAt: ['21:12'] }));
  const seats = new Set(client.calls.map((c) => c.seat));
  assert.ok(['tripwire', 'ref', 'ledger', 'showrunner'].every((s) => seats.has(s)), [...seats].join());
  assert.ok(g.fixer.moments[0].secs >= 0);
  const slow = JSON.parse(JSON.stringify(g)); slow.fixer.median = 20; slow.fixer.calls = 1;
  // the same rule, applied to a slow median
  const { criteria } = await import('../../scripts/lib/gate.mjs');
  assert.equal(criteria(slow, []).find((c) => c.id === 'median').result, 'FAIL');
  assert.equal(GATE.fixerMedianSecs, 15);
});

await test('the spend cap stops cleanly with partial results', async () => {
  const usage = { input_tokens: 5_000_000, output_tokens: 0 };           // haiku $0.50 a call, fixer/voice more
  const client = mockClient({ usage });
  const g = await runGate(base(client, { fixerAt: ['21:12'], maxSpend: 2 }));
  assert.equal(g.partial, true); assert.equal(g.stopped, 'cap');
  assert.ok(g.window.minutes < 41, 'the Tap stopped early: ' + g.window.minutes);
  assert.ok(g.spend.total >= 2 && g.spend.total < 2 + 25, 'overshoot is at most one tick: ' + g.spend.total);
  const n = client.calls.length;
  assert.ok(n < 30, 'no runaway: ' + n);
  const md = report(g);
  assert.match(md, /Partial: stopped at 21:\d\d/);
  assert.equal(g.criteria.find((c) => c.id === 'cost').result === 'PASS', false);
});

await test('a cap already spent by the Fixer skips the later moments and the Tap', async () => {
  const client = mockClient({ usage: { input_tokens: 5_000_000, output_tokens: 0 } });
  const g = await runGate(base(client, { fixerAt: ['21:12', '21:20', '21:30'], maxSpend: 1 }));
  assert.equal(g.fixer.moments.filter((m) => m.skipped).length, 2);
  assert.equal(g.window.minutes, 0, 'no Tap tick ran');
  assert.equal(client.calls.length, 1);
});

await test('a window under 30 minutes gives no night projection', async () => {
  const g = await runGate(base(mockClient(), { fromT: 21 * 60 + 5, toT: 21 * 60 + 15 }));
  assert.equal(g.spend.projectedNight, null);
  assert.equal(g.criteria.find((c) => c.id === 'cost').result, 'NEEDS-ALEX');
  assert.match(report(g), /No projection for a window this short/);
});

await test('refusals and truncations are counted per seat', async () => {
  const client = mockClient({ stops: { fixer: 'refusal', ref: 'max_tokens' } });
  const g = await runGate(base(client, { fixerAt: ['21:12'] }));
  assert.equal(g.refusals.fixer.refusals, 1);
  assert.ok(g.refusals.ref.truncations >= 1);
  assert.match(report(g), /\| fixer \| 1 \| 0 \|/);
});

await test('a dry run makes no calls and estimates spend', async () => {
  const client = mockClient();
  const g = await runGate(base(client, { fixerAt: ['21:12'], voiceAt: [{ at: '21:15', npc: 'Mrs Test' }], dryRun: true, expectRef: parseExpectRef('21:10') }));
  assert.equal(client.calls.length, 0, 'no create calls');
  assert.equal(g.dryRun, true); assert.ok(g.spend.total > 0);
  assert.ok(g.spend.bySeat.tripwire.calls >= 41, 'one Tripwire a minute');
  assert.ok(g.spend.bySeat.ref.calls > 0, 'keyword flags wake Ref on roll talk');
  assert.equal(g.cards.length, 0);
  assert.ok(g.criteria.every((c) => c.id === 'cost' ? true : c.result === 'NEEDS-ALEX'));
  assert.match(report(g), /DRY RUN/);
  // a counted prefix changes the estimate; a counter that throws falls back to chars/4
  const big = await runGate(base(client, { dryRun: true, tokenCount: async () => 90000 }));
  const small = await runGate(base(client, { dryRun: true, tokenCount: async () => { throw new Error('offline'); } }));
  assert.ok(big.spend.total > small.spend.total * 10);
  assert.equal(client.calls.length, 0);
});

await test('the CLI: dry run writes gate.md and gate.json under gm-private, refuses other folders', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-gate-'));
  fs.mkdirSync(path.join(repo, 'gm-private'));
  const t = path.join(repo, 'transcript.md'), pack = path.join(repo, 'gm-private', 'pack.json'), draws = path.join(repo, 'gm-private', 'draws.json');
  fs.writeFileSync(t, TRANSCRIPT);
  fs.writeFileSync(pack, JSON.stringify({ parts: { assist: { prefix: PREFIX } } }));
  fs.writeFileSync(draws, JSON.stringify({ default: { position: 'risky', low: 'L', mid: 'M' } }));
  const out = [], errs = [];
  const client = mockClient();
  const common = ['--transcript', t, '--prefix-from', pack, '--session-label', 's99', '--draws-file', draws, '--fixer-at', '21:12', '--expect-ref', '21:10', '--from', '21:05', '--to', '21:20'];
  const code = await main([...common, '--dry-run', '--out', 'gm-private/gate-x'], { client, repo, log: (x) => out.push(x), err: (x) => errs.push(x) });
  assert.equal(code, 0, errs.join('\n'));
  assert.equal(client.calls.length, 0);
  const g = JSON.parse(fs.readFileSync(path.join(repo, 'gm-private', 'gate-x', 'gate.json'), 'utf8'));
  assert.equal(g.window.from, '21:05'); assert.equal(g.window.to, '21:20'); assert.equal(g.dryRun, true);
  assert.ok(fs.readFileSync(path.join(repo, 'gm-private', 'gate-x', 'gate.md'), 'utf8').includes('## Criteria'));
  assert.ok(!out.join('\n').includes('Zed'), 'stdout quotes no transcript text');
  assert.equal(await main([...common, '--dry-run', '--out', 'elsewhere'], { client, repo, log() {}, err: (x) => errs.push(x) }), 2);
  assert.match(errs.join('\n'), /under gm-private/);
  assert.equal(await main(['--transcript', t], { client, repo, log() {}, err() {} }), 2);
  // a live (mocked) run through the CLI
  const code2 = await main([...common, '--out', 'gm-private/gate-y'], { client, repo, log: (x) => out.push(x), err: (x) => errs.push(x) });
  assert.equal(code2, 0, errs.join('\n'));
  const g2 = JSON.parse(fs.readFileSync(path.join(repo, 'gm-private', 'gate-y', 'gate.json'), 'utf8'));
  assert.equal(g2.dryRun, false); assert.equal(g2.ref[0].caught, true); assert.equal(g2.fixer.calls, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
