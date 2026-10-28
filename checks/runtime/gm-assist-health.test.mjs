// The panel header's seat-health dots and reaped note (P5; design 2.1 and 3.4), as logic: healthStep / healthView on a hand-held clock,
// then the box on a small fake DOM fed tick answers carrying `health`. Colour, shape and the accessible text are checked in the browser
// (gm-assist-health.e2e.mjs). Every name and sentence is invented. No network, no key.
//   node checks/runtime/gm-assist-health.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { MiniEl, MiniText } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const A = require(path.join(ROOT, 'app', 'gm', 'assist-panel.js'));
const P = A._pure;
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const MIN = 60_000, T0 = Date.parse('2030-05-05T10:00:00.000Z');
const st = (view, seat) => view.find((d) => d.seat === seat).state;
const step = (prev, health, at) => P.healthStep(prev, health, at);
const H = (o) => ({ skipped: [], reaped: [], ran: [], ...o });
const flight = (seat) => ({ seat, why: 'in-flight' });

await test('before any tick every dot is unknown (never amber, never green)', () => {
  const v = P.healthView(undefined, T0);
  assert.deepEqual(v.map((d) => d.seat), ['tripwire', 'ref', 'voice']);
  assert.deepEqual(v.map((d) => d.state), ['unknown', 'unknown', 'unknown']);
  assert.match(v[0].word, /no reading/);
});

await test('a tick that ran the Tripwire only: Tripwire ok, Ref and Voice asleep (not woken is not a fault)', () => {
  const v = P.healthView(step(undefined, H({ ran: ['tripwire'] }), T0), T0);
  assert.deepEqual(v.map((d) => d.state), ['ok', 'asleep', 'asleep']);
});

await test('green lasts 10 minutes exactly, and 10 minutes and a second is grey', () => {
  const s = step(undefined, H({ ran: ['ref'] }), T0);
  assert.equal(st(P.healthView(s, T0 + 10 * MIN), 'ref'), 'ok');
  assert.equal(st(P.healthView(s, T0 + 10 * MIN + 1000), 'ref'), 'asleep');
  assert.equal(st(P.healthView(s, T0 + 10 * MIN + 1000), 'tripwire'), 'asleep');
});

await test('one in-flight skip is not amber; two in a row are; a run or a quiet answer in between resets the count', () => {
  let s = step(undefined, H({ skipped: [flight('voice')] }), T0);
  assert.equal(st(P.healthView(s, T0), 'voice'), 'asleep');
  s = step(s, H({ skipped: [flight('voice')] }), T0 + MIN);
  assert.equal(st(P.healthView(s, T0 + MIN), 'voice'), 'stuck');
  const r = step(step(undefined, H({ skipped: [flight('voice')] }), T0), H({ ran: ['voice'] }), T0 + MIN);
  s = step(r, H({ skipped: [flight('voice')] }), T0 + 2 * MIN);
  assert.equal(st(P.healthView(s, T0 + 2 * MIN), 'voice'), 'ok', 'run, then one skip: the streak restarted at one');
  const q = step(step(step(undefined, H({ skipped: [flight('ref')] }), T0), H(), T0 + MIN), H({ skipped: [flight('ref')] }), T0 + 2 * MIN);
  assert.notEqual(st(P.healthView(q, T0 + 2 * MIN), 'ref'), 'stuck', 'skip, quiet, skip is two ticks apart, not in a row');
});

await test('only in-flight counts: cooldown and budget skips, however many, are asleep and never amber', () => {
  let s;
  for (let i = 0; i < 4; i++) s = step(s, H({ skipped: [{ seat: 'ref', why: i % 2 ? 'cooldown' : 'budget' }] }), T0 + i * MIN);
  assert.equal(st(P.healthView(s, T0 + 3 * MIN), 'ref'), 'asleep');
  s = step(step(undefined, H({ skipped: [flight('ref')] }), T0), H({ skipped: [{ seat: 'ref', why: 'cooldown' }] }), T0 + MIN);
  assert.notEqual(st(P.healthView(s, T0 + MIN), 'ref'), 'stuck', 'a cooldown skip between two in-flight skips breaks the run');
});

await test('stuck beats green; a reaped lease clears stuck', () => {
  let s = step(undefined, H({ ran: ['tripwire'] }), T0);
  s = step(s, H({ skipped: [flight('tripwire')] }), T0 + MIN);
  s = step(s, H({ skipped: [flight('tripwire')] }), T0 + 2 * MIN);
  assert.equal(st(P.healthView(s, T0 + 2 * MIN), 'tripwire'), 'stuck', 'it ran two minutes ago and is still amber');
  s = step(s, H({ reaped: ['tripwire'] }), T0 + 3 * MIN);
  assert.equal(st(P.healthView(s, T0 + 3 * MIN), 'tripwire'), 'ok', 'the lease was swept; the earlier run still counts');
});

await test('an answer without health (ask, fit, an error) changes nothing; seats outside the three are ignored; the input is not mutated', () => {
  const s = step(undefined, H({ ran: ['ref'], skipped: [flight('voice'), flight('stall')] }), T0);
  const frozen = JSON.stringify(s);
  assert.strictEqual(step(s, undefined, T0 + MIN), s);
  assert.strictEqual(step(s, 'nope', T0 + MIN), s);
  const s2 = step(s, H({ skipped: [flight('voice')], ran: ['stall'] }), T0 + MIN);
  assert.equal(JSON.stringify(s), frozen);
  assert.deepEqual(Object.keys(s2.seats), ['tripwire', 'ref', 'voice']);
  assert.equal(st(P.healthView(s2, T0 + MIN), 'voice'), 'stuck');
});

await test('reapedLine: one quiet line naming the seats; empty when nothing was reaped', () => {
  assert.equal(P.reapedLine(step(undefined, H(), T0)), '');
  assert.equal(P.reapedLine(undefined), '');
  assert.match(P.reapedLine(step(undefined, H({ reaped: ['ref'] }), T0)), /^Blade freed a stuck seat \(Ref\)\./);
  assert.match(P.reapedLine(step(undefined, H({ reaped: ['voice', 'tripwire'] }), T0)), /\(Voice, Tripwire\)/);
  assert.equal(P.reapedLine(step(step(undefined, H({ reaped: ['ref'] }), T0), H(), T0 + MIN)), '', 'gone on the next tick that reports none');
});

await test('absorb folds a tick answer\'s health in, keyed to the answer\'s own time', () => {
  const box = { cards: [], updates: [] };
  P.absorb(box, { cards: [], updates: [], last: 1, health: H({ ran: ['tripwire'] }) }, new Date(T0).toISOString());
  assert.equal(st(P.healthView(box.health, T0 + 5 * MIN), 'tripwire'), 'ok');
  assert.equal(st(P.healthView(box.health, T0 + 11 * MIN), 'tripwire'), 'asleep');
  const before = box.health;
  P.absorb(box, { cards: [], updates: [], last: 2 }, new Date(T0 + MIN).toISOString());
  assert.strictEqual(box.health, before, 'no health in the answer: untouched');
});

await test('meter: steps at 60% and 85%, cells are fifths', () => {
  assert.equal(P.meterOf({ tonight: 11.9, cap: 20 }).tone, 'ok');
  assert.equal(P.meterOf({ tonight: 12, cap: 20 }).tone, 'mid');
  assert.equal(P.meterOf({ tonight: 16.9, cap: 20 }).tone, 'mid');
  assert.equal(P.meterOf({ tonight: 17, cap: 20 }).tone, 'warn');
  assert.deepEqual([0, 4, 10, 16, 20].map((t) => P.meterOf({ tonight: t, cap: 20 }).cells), [0, 1, 3, 4, 5]);
});

// ---------- the box, on a fake DOM ----------
function rig(reply, clock) {
  const els = {}; let made = 0;
  const stub = (sel) => els[sel] || (els[sel] = Object.assign(new MiniEl('div', (e) => { doc.activeElement = e; }), { sel }));
  const host = { className: '', innerHTML: '', parentNode: null, setAttribute() {}, addEventListener() {}, contains() { return true; }, querySelector: (sel) => stub(sel), querySelectorAll: () => [] };
  const doc = { hidden: false, activeElement: null, createElement(tag) { return made++ === 0 ? host : new MiniEl(tag, (e) => { doc.activeElement = e; }); }, createTextNode: (t) => new MiniText(t),
    body: { appendChild(e) { e.parentNode = doc.body; }, removeChild() {} }, addEventListener() {}, removeEventListener() {} };
  const g = { stt: async () => ({ doc: { want: 'on' } }), assistTick: async () => g.reply };
  g.reply = reply;
  const ctl = A.create({ gm: g, doc, win: { matchMedia: () => ({ matches: false }) }, noTimer: true, nowMs: () => clock.t, setTimeout: () => 1, clearTimeout() {} });
  return { ctl, g, stub };
}
const BASE = { cards: [], updates: [], flags: [], spend: { tonight: 1, cap: 20, tier: 'all' }, last: 3 };
const dot = (r, seat) => r.stub('#as-hd-' + seat).getAttribute('data-health');

await test('the box: dots follow the tick answers, the title says it in words, and time alone greys a green dot', async () => {
  const clock = { t: Date.now() };
  const r = rig({ ...BASE, health: H({ ran: ['tripwire', 'ref'], skipped: [flight('voice')] }) }, clock);
  await r.ctl.poll();
  assert.deepEqual(['tripwire', 'ref', 'voice'].map((s) => dot(r, s)), ['ok', 'ok', 'asleep']);
  assert.equal(r.stub('#as-hd-ref').getAttribute('title'), 'Ref: ran in the last 10 minutes');
  r.g.reply = { ...BASE, last: 4, health: H({ ran: ['tripwire'], skipped: [flight('voice')] }) };
  await r.ctl.poll();
  assert.equal(dot(r, 'voice'), 'stuck'); assert.equal(dot(r, 'ref'), 'ok');
  assert.match(r.stub('#as-hd-voice').getAttribute('title'), /^Voice: stuck/);
  clock.t += 11 * MIN; r.g.reply = { ...BASE, last: 5 };       // an answer with no health at all, 11 minutes on
  await r.ctl.poll();
  assert.equal(dot(r, 'ref'), 'asleep', 'no tick ran it for 11 minutes');
  assert.equal(dot(r, 'voice'), 'stuck', 'a health-less answer does not clear amber');
});

await test('the box: the reaped note shows for the answer that reports it and is hidden after', async () => {
  const clock = { t: Date.now() };
  const r = rig({ ...BASE, health: H({ reaped: ['ref'] }) }, clock);
  await r.ctl.poll();
  const n = r.stub('#as-reaped');
  assert.equal(n.hidden, false); assert.match(n.textContent, /freed a stuck seat \(Ref\)/);
  r.g.reply = { ...BASE, last: 4, health: H() }; await r.ctl.poll();
  assert.equal(n.hidden, true); assert.equal(n.textContent, '');
});

await test('the box: the meter says its fill in words and steps its tone at 60% and 85%', async () => {
  const clock = { t: Date.now() };
  const r = rig({ ...BASE, spend: { tonight: 13, cap: 20, tier: 'reduced' } }, clock);
  await r.ctl.poll();
  const m = r.stub('#as-meter');
  assert.equal(m.getAttribute('data-tone'), 'mid'); assert.equal(m.getAttribute('data-cells'), '3');
  assert.match(m.getAttribute('aria-label'), /65% of tonight.s cap, past 60%/);
  r.g.reply = { ...BASE, last: 4, spend: { tonight: 18, cap: 20, tier: 'core' } }; await r.ctl.poll();
  assert.equal(m.getAttribute('data-tone'), 'warn'); assert.match(m.getAttribute('aria-label'), /90% .*nearly used up/);
});

await test('the box: a warn is spoken through the assertive region, only when it arrives; a rule is not', async () => {
  const clock = { t: Date.now() };
  const r = rig({ ...BASE, cards: [{ seat: 'ref', kind: 'rule', at: new Date().toISOString(), text: 'Invented rule slip.' }] }, clock);
  await r.ctl.poll();
  const al = r.stub('#as-alert');
  assert.equal(al.textContent || '', '');
  r.g.reply = { ...BASE, last: 4, cards: [{ seat: 'ref', kind: 'warn', at: new Date(Date.now() + 1000).toISOString(), text: 'Invented warning: the clock is nearly full.' }] };
  await r.ctl.poll();
  assert.match(al.textContent, /^Warning: /);
  assert.match(al.textContent, /clock is nearly full/);
});

console.log((failed ? failed + ' FAILED, ' : '') + passed + ' passed');
process.exit(failed ? 1 : 0);
