// Tests for the night contract (W0.4; app/gm/night.js): the phase, its budget, start and end, the hard start and the curfew, the
// Aftermath's step and data, and the capped log. Pure: no server, no browser. The stored document is the real server merge
// (functions/_lib/gm.js patchState, over a one-row fake D1), so the caps are the server's own.
//   node checks/runtime/gm-night.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMarkdown } from '../../scripts/lib/prep-export.mjs';
import { patchState, loadState, LIMITS } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const N = require(path.join(ROOT, 'app', 'gm', 'night.js'));
const Prep = require(path.join(ROOT, 'app', 'gm', 'prep.js'));
const Markdown = loadMarkdown(ROOT);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* ---------- an invented prep note: the run order's format (as gm-prep.test.mjs has it), the two new lines ---------- */
const RUN = [
  '| # | Beat | About | Jump |', '|---|---|---|---|',
  '| 0 | Table chat | 10 min | |',
  '| 1 | **Personal business**, two scenes | 40 min | [[#Downtime]] |',
  '| 2 | **The planning meeting** | 15 min | [[#Plan]] |',
  '| 3 | **The Pelican job** | 70–75 min | [[#Score]] |',
  '| 4 | **Close:** payout, heat, xp | 25 min | [[#Close]] |', ''];
const note = (extra) => ({ id: 'n1', title: 'Invented session', blocks: [{ k: 'md', src: ['# Invented session', '', '## Run order', ''].concat(extra || [], RUN, ['', '## Must land', '', '- [ ] a thing', ''].join('\n')).join('\n') }] });
const WITH = note(['start: 19:30', 'curfew: 22:40', '']);
const WITHOUT = note();

/* the stored document: the server's own write path over a one-row fake D1 */
function fakeDb() {
  let row = null;
  return { prepare(sql) { return { bind(...a) { return {
    first: async () => row,
    run: async () => { row = /^UPDATE/.test(sql) ? { updated_at: a[0], doc: a[1] } : { updated_at: a[1], doc: a[2] }; return { meta: { changes: 1 } }; } }; } }; } };
}
const campaign = 'camp';
const store = () => { const db = fakeDb(); return { db, write: (p) => patchState(db, campaign, p, {}), read: async () => (await loadState(db, campaign)).doc }; };
const T0 = Date.parse('2030-01-01T09:00:00.000Z');
const at = (min) => T0 + min * 60000;
const gen = (n) => () => 'id' + n++;

/* ---------- 1. the prep note ---------- */
await test('the fixture prep gives budgets of 40, 15, 75 and 25 minutes, and both times', () => {
  const r = N.parsePrep(WITH);
  assert.deepEqual(r.budgets, { pb: 40, plan: 15, score: 75, after: 25 });
  assert.equal(r.start, '19:30'); assert.equal(r.curfew, '22:40');
  assert.equal(r.rows.length, 5); assert.equal(r.rows[0].phase, null, 'the table chat names no phase and is not counted');
});
await test('a prep note without the lines gives no times and the same budgets; nothing about it is written', () => {
  const r = N.parsePrep(WITHOUT);
  assert.equal(r.start, null); assert.equal(r.curfew, null);
  assert.deepEqual(r.budgets, { pb: 40, plan: 15, score: 75, after: 25 });
  const p = N.enter({}, 'pb', at(0), r, 'a');
  assert.ok(!('startAt' in p.night) && !('curfewAt' in p.night), 'no times in the patch');
  const bare = N.parsePrep({ blocks: [{ k: 'md', src: '# Nothing\n\nJust prose.\n' }] });
  assert.deepEqual(bare, { start: null, curfew: null, budgets: { pb: null, plan: null, score: null, after: null }, rows: [] });
  const p2 = N.enter({}, 'pb', at(0), bare, 'a');
  assert.deepEqual(Object.keys(p2.night).sort(), ['log', 'phase', 'phases', 'v'], 'no prep numbers: no budgets, no times');
  assert.deepEqual(p2.night.phases.pb, { start: at(0), end: null });
});
await test('a prep note without the lines draws exactly as before: the Prep tab renders the note as it always did', () => {
  /* night.js never touches prep.js or the renderer: the same note with and without the module loaded renders to the same html */
  const part = { notes: [Object.assign({ session: '9', date: '', status: '' }, WITHOUT)] };
  const a = Prep.view(part, 'n1', { M: Markdown }).html;
  N.parsePrep(WITHOUT); N.enter({}, 'pb', at(0), N.parsePrep(WITHOUT), 'a');
  assert.equal(Prep.view(part, 'n1', { M: Markdown }).html, a);
  assert.ok(!/startAt|curfewAt/.test(a));
});
await test('parse: rows of one phase add up; a range counts its upper end; hours; an aliased wikilink; the Go to link names the phase', () => {
  const src = ['| # | Beat | Length | By | Go to |', '|---|---|---|---|---|',
    '| 1 | Scene one | 15 min | | [[#Downtime]] |', '| 2 | Scene two | 20–25 min | | [[#Downtime|more]] |',
    '| 3 | The ball | 1 h | | [[#Score]] |', '| — | Break | 5 min | | |', '| 4 | Wind down | 10 min | | [[#Aftermath]] |'].join('\n');
  const r = N.parsePrep(src);
  assert.deepEqual(r.budgets, { pb: 40, plan: null, score: 60, after: 10 });
});
await test('parse: only the first run order; fenced code and transcluded blocks are never read; a bad time is ignored; the first line wins', () => {
  const second = ['| # | Beat | About |', '|---|---|---|', '| 1 | Another personal business | 99 min |'];
  const r = N.parsePrep({ blocks: [
    { k: 'md', src: ['```', 'start: 18:00', '| # | Beat | About |', '|---|---|---|', '| 1 | Downtime | 90 min |', '```', 'curfew: 25:99', 'curfew: 23:00', 'curfew: 22:00', '- **start:** 19:45'].concat(RUN, second).join('\n') },
    { k: 'embed', from: 'other.md', src: ['start: 17:00', 'curfew: 21:00'].concat(RUN).join('\n') }] });
  assert.equal(r.start, '19:45'); assert.equal(r.curfew, '23:00');
  assert.deepEqual(r.budgets, { pb: 40, plan: 15, score: 75, after: 25 });
});
await test('parse: nothing throws on rubbish, and a table without "#" and a time column is not a run order', () => {
  [null, undefined, 7, {}, { blocks: null }, { blocks: [null, 3, { k: 'md' }, { k: 'md', src: 4 }] }, '', '|||', '| # |\n|---|\n| 1 |'].forEach((x) => {
    const r = N.parsePrep(x); assert.equal(r.start, null); assert.deepEqual(r.rows, []);
  });
  assert.deepEqual(N.parsePrep('| Beat | About |\n|---|---|\n| Personal business | 40 min |').budgets.pb, null);
});

/* ---------- 2. the state ---------- */
await test('the phases run in order, Back is allowed, and each change is logged', async () => {
  const s = store(), prep = N.parsePrep(WITH), id = gen(1);
  let doc = await s.read();
  assert.equal(N.clean(doc.night).phase, '', 'a fresh document has no phase');
  assert.equal(N.enter(doc.night, 'nope', at(0), prep), null, 'not a phase');
  for (const [ph, m] of [['pb', 0], ['plan', 40], ['score', 55]]) {
    doc = (await s.write(N.enter(doc.night, ph, at(m), prep, id()))).doc;
    assert.equal(N.bandPhase(doc.night), ph);
  }
  assert.equal(N.enter(doc.night, 'score', at(60), prep), null, 'the same phase again writes nothing');
  let n = N.clean(doc.night);
  assert.deepEqual(n.phases.pb, { budget: 40, start: at(0), end: at(40) });
  assert.deepEqual(n.phases.plan, { budget: 15, start: at(40), end: at(55) });
  assert.deepEqual(n.phases.score, { budget: 75, start: at(55), end: null });
  assert.deepEqual(n.phases.after, { budget: 25, start: null, end: null });
  assert.equal(n.startAt, '19:30'); assert.equal(n.curfewAt, '22:40');
  doc = (await s.write(N.enter(doc.night, 'plan', at(70), prep, id()))).doc;       // Back
  n = N.clean(doc.night);
  assert.equal(n.phase, 'plan'); assert.deepEqual(n.phases.plan, { budget: 15, start: at(70), end: null }); assert.equal(n.phases.score.end, at(70));
  assert.deepEqual(N.logList(doc.night).map((e) => [e.k, e.text, e.p]), [['phase', 'Personal Business', 'pb'], ['phase', 'Planning', 'plan'], ['phase', 'Score', 'score'], ['phase', 'Planning', 'plan']]);
});
await test('stamps and cues join the log with the phase they came in; the Aftermath keeps a step and flat data, and data replaces', async () => {
  const s = store(), id = gen(100);
  let doc = (await s.write(N.enter({}, 'score', at(0), null, id()))).doc;
  doc = (await s.write(N.stamp(doc.night, 'Front door  held', at(5), id()))).doc;
  doc = (await s.write(N.cue(doc.night, '3 reveal Showroom', at(6), id()))).doc;
  assert.equal(N.stamp(doc.night, '   ', at(7)), null, 'an empty stamp writes nothing');
  assert.deepEqual(N.logList(doc.night).slice(1).map((e) => [e.k, e.text, e.p]), [['stamp', 'Front door held', 'score'], ['cue', '3 reveal Showroom', 'score']]);
  doc = (await s.write(N.enter(doc.night, 'after', at(9), null, id()))).doc;
  doc = (await s.write(N.setAfter(doc.night, 'heat', { payout: 4, heatBefore: 4, tick: true, note: 'x'.repeat(500), nested: { a: 1 }, nope: null }))).doc;
  let a = N.clean(doc.night).aftermath;
  assert.equal(a.step, 'heat'); assert.deepEqual(Object.keys(a.data).sort(), ['heatBefore', 'note', 'payout', 'tick']); assert.equal(a.data.note.length, 200);
  doc = (await s.write(N.setAfter(doc.night, 'xp', { payout: 5 }))).doc;
  a = N.clean(doc.night).aftermath;
  assert.deepEqual(a, { step: 'xp', data: { payout: 5 } }, 'keys the new data lacks are gone');
  doc = (await s.write(N.reset())).doc;
  assert.ok(!('night' in doc)); assert.equal(N.bandPhase(doc.night), '');
});
await test('the iPad gets only a phase id: no time, no budget, nothing else', () => {
  const night = N.clean({ phase: 'score', phases: { score: { budget: 75, start: at(0) } }, startAt: '19:30', curfewAt: '22:40' });
  const sent = N.bandPhase(night);
  assert.equal(sent, 'score'); assert.equal(typeof sent, 'string');
  assert.ok(!/\d/.test(sent), 'no digit, so no time');
  assert.equal(N.bandPhase({ phase: '19:30' }), ''); assert.equal(N.bandPhase(null), ''); assert.equal(N.bandPhase({ phase: 'toString' }), '');
});
await test('clean: any rubbish becomes a whole night, and the log keeps 500 at most', () => {
  [null, 4, 'x', [], { phases: 3, log: 5, aftermath: [] }, { phase: 'x', startAt: '25:00', curfewAt: 'noon', phases: { pb: { budget: -4, start: 'yesterday' } } }].forEach((x) => {
    const n = N.clean(x);
    assert.equal(n.v, 1); assert.equal(n.phase, ''); assert.deepEqual(Object.keys(n.phases), ['pb', 'plan', 'score', 'after']);
    assert.equal(n.startAt, null); assert.equal(n.curfewAt, null); assert.deepEqual(n.aftermath, { step: '', data: {} }); assert.deepEqual(n.log, {});
    assert.deepEqual(N.clean(n), n, 'clean is idempotent');
  });
  const big = {}; for (let i = 0; i < 700; i++) big['k' + i] = { at: at(i), k: 'stamp', text: 't' + i };
  const n = N.clean({ log: big });
  assert.equal(Object.keys(n.log).length, 500); assert.ok(n.log.k699 && !n.log.k199 && n.log.k200);
});
await test('clockMs puts an HH:MM on the day of the time it is given', () => {
  const d = new Date(2030, 0, 1, 12, 0, 0).getTime(), t = N.clockMs('19:30', d), x = new Date(t);
  assert.equal(x.getFullYear(), 2030); assert.equal(x.getDate(), 1); assert.equal(x.getHours(), 19); assert.equal(x.getMinutes(), 30);
  assert.equal(N.clockMs('7:05', d), new Date(2030, 0, 1, 7, 5).getTime()); assert.equal(N.clockMs('24:00', d), null); assert.equal(N.clockMs(null, d), null);
});

/* ---------- 3. the caps ---------- */
await test('a full log keeps the state doc under its 240 KiB soft line, with the capture lines at their own cap, and every write is small', async () => {
  const SOFT = 240 * 1024, CAPTURE = 128 * 1024;                       // gm-page.js LIMITS.stateSoft and .captureBytes
  const s = store(); let doc = await s.read(), worstPatch = 0;
  const long = 'é'.repeat(300) + ' ' + '✓'.repeat(300);                // multi-byte, far over the text cap
  doc = (await s.write(N.enter(doc.night, 'score', at(0), N.parsePrep(WITH), 'e0'))).doc;
  for (let i = 1; i <= 650; i++) {
    const p = i % 2 ? N.stamp(doc.night, long, at(i), 'e' + i) : N.cue(doc.night, long, at(i), 'e' + i);
    worstPatch = Math.max(worstPatch, Buffer.byteLength(JSON.stringify(p)));
    doc = (await s.write(p)).doc;
  }
  const n = N.clean(doc.night), keys = Object.keys(doc.night.log);
  assert.equal(keys.length, 500, 'the stored log is capped at 500');
  assert.ok(keys.includes('e650') && !keys.includes('e100') && keys.includes('e151') && !keys.includes('e150'), 'the oldest went, the newest stayed');
  assert.equal(Object.keys(n.log).length, 500);
  assert.ok(worstPatch < 1024, 'an append is one small patch (' + worstPatch + ' bytes), not the log again');
  const nightBytes = Buffer.byteLength(JSON.stringify(doc.night));
  assert.ok(nightBytes < 95 * 1024, 'the night is ' + nightBytes + ' bytes');
  const full = Buffer.byteLength(JSON.stringify(Object.assign({}, doc, { capture: { pad: 'x'.repeat(CAPTURE) } })));
  assert.ok(full < SOFT, 'night + capture at its cap = ' + full + ' bytes, under ' + SOFT);
  assert.ok(full < LIMITS.state, 'and the server\'s own cap');
  assert.ok(nightBytes + CAPTURE < SOFT);
});
await test('two pages that appended at once leave more than 500: the next append trims what is STORED back to 500, bad entries first; setAfter nulls every stored key', async () => {
  const s = store();
  const log = {}; for (let i = 0; i < 503; i++) log['x' + i] = { at: at(i + 1), k: 'stamp', text: 's' + i };
  log.junk = 'not an entry'; log.junk2 = { at: 'x' };
  let doc = (await s.write({ night: { v: 1, log, aftermath: { step: 's', data: { a: 1, b: 2, c: 3 } } } })).doc;
  assert.equal(Object.keys(doc.night.log).length, 505);
  doc = (await s.write(N.stamp(doc.night, 'one more', at(900), 'last'))).doc;
  const keys = Object.keys(doc.night.log);
  assert.equal(keys.length, 500, 'stored keys: ' + keys.length);
  assert.ok(keys.includes('last') && keys.includes('x502') && !keys.includes('junk') && !keys.includes('junk2') && !keys.includes('x0') && !keys.includes('x3') && keys.includes('x4'));
  const big = {}; for (let i = 0; i < 30; i++) big['d' + i] = i;
  doc = (await s.write({ night: { aftermath: { data: big } } })).doc;                       // a raw store past the 24-key view
  assert.equal(Object.keys(doc.night.aftermath.data).length, 33);
  doc = (await s.write(N.setAfter(doc.night, 'x', { only: 1 }))).doc;
  assert.deepEqual(doc.night.aftermath.data, { only: 1 }, 'nothing orphaned past the view');
});
await test('the controller writes nothing until it is asked, then goes through the host\'s patch', () => {
  const calls = []; let doc = {};
  const merge = (a, b) => { const o = JSON.parse(JSON.stringify(a)); for (const k of Object.keys(b)) { if (b[k] === null) delete o[k]; else if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) o[k] = merge(o[k] || {}, b[k]); else o[k] = b[k]; } return o; };
  let clock = T0, changed = 0;
  const c = N.create({ doc: () => doc, patch: (p) => { calls.push(p); doc = merge(doc, p); return true; }, now: () => clock, prep: () => WITH, changed: () => { changed++; } });
  assert.equal(calls.length, 0, 'creating, reading and asking for the band write nothing'); assert.equal(c.phase(), ''); assert.equal(c.band(), ''); c.night();
  assert.equal(calls.length, 0);
  assert.equal(c.enter('pb'), true); assert.equal(c.phase(), 'pb'); assert.equal(c.night().phases.pb.budget, 40); assert.equal(c.night().startAt, '19:30');
  clock += 60000; assert.equal(c.stamp('hello'), true); assert.equal(c.cue('1 scene test-card'), true); assert.equal(c.enter('pb'), false, 'the same phase: nothing');
  assert.equal(c.stamp(''), false); assert.equal(calls.length, 3); assert.equal(changed, 3);
  assert.equal(c.setAfter('heat', { a: 1 }), true); assert.equal(c.night().aftermath.step, 'heat');
  assert.equal(c.reset(), true); assert.equal(c.phase(), '');
  const dead = N.create({}); assert.equal(dead.enter('pb'), false); assert.equal(dead.phase(), '');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
