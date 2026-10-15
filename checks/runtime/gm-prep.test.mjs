// Tests for the Prep tab (GM.md "Prep", SYNC.md "Prep") and the planning meeting's cards, on an INVENTED vault written to a
// temp folder: the line scan and its anchors (scripts/lib/prep.mjs), the pack part (lib/prep-export.mjs), the page module
// (app/gm/prep.js with app/markdown.js), the pull that ticks boxes (lib/sync-prep.mjs), and the `cards` display kind.
//   node checks/runtime/gm-prep.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scanNote, tickLines, sectionOf, embedOf, alignTasks } from '../../scripts/lib/prep.mjs';
import { buildPrep, loadMarkdown } from '../../scripts/lib/prep-export.mjs';
import { pullPrep, fileAtTable } from '../../scripts/lib/sync-prep.mjs';
import { basenames, assertPrepWritable, AT_TABLE } from '../../scripts/lib/vault.mjs';
import { emptyCampaign } from '../../scripts/lib/ledger.mjs';
import { newReport } from '../../scripts/lib/report.mjs';
import { cleanDisplay, DISPLAY_KINDS } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* ---------- the invented vault ---------- */
const G = 'Wiki/Games/Blades in the Dark/Campaigns/Group';
const SESSION = [
  '---', 'session: 9', 'date: 01/01/2030', 'status: prep', 'gm_prep: true', '---', '',
  '# Session 9: prep', '',
  '## Run order', '',
  '| # | Beat | About | Jump |', '|---|---|---|---|',
  '| 0 | Chat | 10 min | |', '| 1 | **The heist** | 35–40 min | [[#Must land]] |', '',
  '---', '',
  '## Must land', '',
  '- [ ] **#1** The kettle whistles',
  '- [x] **#2** The cat is grey',
  '- [ ] **#1** The kettle whistles', '',
  '| # | Clue | ✓ |', '|---|---|---|', '| 1 | Kettle | ☐ |', '',
  '> [!quote] SAY', '> *"Nobody moves."* `[Invented pitch]`', '',
  '## Cards', '',
  '![[pip-pockets#A. The goose job]]', '',
  '![[pip-pockets#B. Missing heading]]', '',
  '## Cast', '', 'See [[Odo Plim]] and [[pip-pockets|the pockets]], and [[Nowhere At All]].', '',
  '---', '', '# Play log', '', '## Names', '', '-', '', '## Loose ends', '', '-', '', '## Moments', '', '-', '', '## Rolled at the table', '', '-', ''
].join('\n');
const POCKETS = ['# Pockets', '', '## A. The goose job', '', '- [ ] Ask the goose', '', '| | |', '|---|---|', '| **Pays** | 2 |', '', '## B. Other job', '', 'Nothing.', ''].join('\n');
function makeVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-prep-'));
  const w = (rel, text, bom) => { const f = path.join(v, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, (bom ? '﻿' : '') + text); };
  w(G + '/Sessions/b68g-s09.md', SESSION.replace(/\n/g, '\r\n'), true);          // CRLF and a BOM: both must survive
  w(G + '/pip-pockets.md', POCKETS);
  w(G + '/Sessions/b68g-s09-transcript.md', '- [ ] not prep\n');
  w('Wiki/Games/Blades in the Dark/NPCs/Odo Plim.md', '# Odo\n');
  w('Wiki/log.md', '# Log\n');
  return v;
}

/* ---------- 1. the line scan ---------- */
await test('scan: anchors are stable, repeat tasks are told apart, rewording or moving a task makes a new one, fences and callouts handled', async () => {
  const a = scanNote(SESSION, 'x.md'), b = scanNote(SESSION.replace('# Session 9: prep', '# Session 9: prep, edited\n\nA new paragraph.'), 'x.md');
  assert.deepEqual(a.tasks.map((t) => t.anchor), b.tasks.map((t) => t.anchor), 'an edit elsewhere, and a renamed title, keep every anchor');
  const moved = scanNote(SESSION.replace('## Must land', '## Must land, renamed'), 'x.md');
  assert.notEqual(moved.tasks[0].anchor, a.tasks[0].anchor, 'its own heading renamed: a new anchor');
  assert.equal(a.tasks.length, 3); assert.notEqual(a.tasks[0].anchor, a.tasks[2].anchor, 'the same text twice: two anchors');
  assert.equal(a.tasks[1].done, true);
  const re = scanNote(SESSION.replace('The kettle whistles', 'The kettle sings'), 'x.md');
  assert.notEqual(re.tasks[0].anchor, a.tasks[0].anchor, 'reworded: a new anchor');
  const fenced = scanNote('```\n- [ ] not a task\n```\n> - [ ] in a quote\n', 'y.md');
  assert.deepEqual(fenced.tasks.map((t) => t.text), ['in a quote']);
  assert.deepEqual(embedOf('![[pip-pockets#A. The goose job]]'), { page: 'pip-pockets', heading: 'A. The goose job' });
  assert.equal(embedOf('![[map.png]]'), null);
  const sec = sectionOf(scanNote(POCKETS, 'p.md'), 'a. the goose job');
  assert.deepEqual([sec.start, sec.text], [2, 'A. The goose job'], 'case-insensitive fallback, to the next ## heading');
});

await test('tickLines: [ ] -> [x], one character; never unticks; missing and ambiguous reported', async () => {
  const s = scanNote(SESSION, 'x.md');
  const r = tickLines(SESSION, 'x.md', [s.tasks[0].anchor, s.tasks[1].anchor, 'tdeadbeef0000']);
  assert.deepEqual(r.results[s.tasks[0].anchor], 'ticked'); assert.equal(r.results[s.tasks[1].anchor], 'already'); assert.equal(r.results.tdeadbeef0000, 'missing');
  const out = r.lines.join('\n'), diff = [...out].filter((c, i) => c !== SESSION[i]);
  assert.equal(out.length, SESSION.length); assert.deepEqual(diff, ['x']);
  assert.deepEqual(alignTasks([{ text: 'a' }, { text: 'zzz' }, { text: 'b' }], [{ text: 'a' }, { text: 'b' }]).map((t) => t && t.text), ['a', null, 'b']);
});

/* ---------- 2. the pack part ---------- */
const V = makeVault();
const warns = [];
const part = buildPrep({ vault: V, repo: ROOT, exportedAt: '2030-01-01T00:00:00Z', basenames: basenames(V), warn: (m) => warns.push(m) });

await test('pack: only opted-in notes; transclusions carried in; every task box anchored; links by kind; blank blocks dropped', async () => {
  assert.ok(part && part.notes.length === 1, 'one note (the transcript and the pockets did not opt in)');
  const n = part.notes[0];
  assert.deepEqual([n.id, n.session, n.status], ['b68g-s09', '9', 'prep']);
  assert.deepEqual(n.blocks.map((b) => b.k), ['md', 'embed', 'md'], 'the unresolved transclusion stays in the Markdown');
  const emb = n.blocks[1];
  assert.equal(emb.from, G + '/pip-pockets.md'); assert.equal(emb.heading, 'A. The goose job'); assert.ok(!/Other job/.test(emb.src));
  const tasks = n.blocks.flatMap((b) => b.tasks);
  assert.equal(tasks.length, 4); assert.ok(tasks.every((t) => /^t[0-9a-f]{12}$/.test(t.a)), 'all anchored');
  assert.equal(tasks[1].d, true);
  assert.equal(part.links['odo plim'].k, 'npc'); assert.equal(part.links['pip-pockets'].k, 'note'); assert.ok(!part.links['nowhere at all']);
  assert.ok(warns.some((w) => /heading/.test(w)) && warns.some((w) => /not in the vault/.test(w)), 'warnings: ' + warns.join(' | '));
  assert.ok(!warns.some((w) => /could not be matched/.test(w)));
  assert.ok(JSON.stringify(part.src).length < 2048, 'src fits the server cap');
  const again = buildPrep({ vault: V, repo: ROOT, exportedAt: '2030-01-01T00:00:00Z', basenames: basenames(V) });
  assert.equal(JSON.stringify(again), JSON.stringify(part), 'deterministic');
});

/* ---------- 3. the page module ---------- */
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'markdown.js'), 'utf8'), ctx);
const M = ctx.window.B68Markdown, PR = require(path.join(ROOT, 'app', 'gm', 'prep.js'));

await test('page: the note renders with the exporter\'s anchors on its boxes, a rail of ## sections, links the page handles', async () => {
  const v = PR.view(part, 'b68g-s09', { M });
  const ids = [...v.html.matchAll(/data-task="(t[0-9a-f]{12})"/g)].map((m) => m[1]);
  assert.deepEqual(ids, part.notes[0].blocks.flatMap((b) => b.tasks.map((t) => t.a)), 'same boxes, same order');
  assert.deepEqual(v.rail.map((r) => r.text), ['Run order', 'Must land', 'Cards', 'Cast', 'Names', 'Loose ends', 'Moments', 'Rolled at the table']);
  assert.ok(/href="#pp:npc:odo%20plim"/.test(v.html) && /href="#pp:h:Must%20land"/.test(v.html));
  assert.ok(!/<script/i.test(v.html) && /Open in Obsidian/.test(v.html) && /obsidian:\/\/open\?vault=/.test(v.html));
  const pin = PR.section(part, 'b68g-s09', 'pp-must-land', { M });
  assert.deepEqual([...pin.matchAll(/data-task="(t[0-9a-f]{12})"/g)].map((m) => m[1]), ids.slice(0, 3), 'a pinned section keeps its boxes');
  assert.deepEqual(PR.link('#pp:npc:odo%20plim'), { type: 'page', kind: 'npc', key: 'odo plim', frag: '' });
  assert.deepEqual([PR.budget('10 min'), PR.budget('35–40 min'), PR.budget('1 h'), PR.budget('soon')], [10, 40, 60, null]);
  assert.equal(PR.hash('a'), PR.hash('a')); assert.notEqual(PR.hash('a'), PR.hash('b'));
  // the rules wiki's own render is untouched by the new hooks
  assert.equal(M.render('- [ ] x\n## H'), '<ul><li><span class="rl-task" aria-hidden="true">☐</span> x</li></ul>\n<h3>H</h3>');
  assert.equal(M.render('see [[#Heading]]'), '<p>see Heading</p>');
});

await test('page: the keys R (prep) and O (cards); the display line for cards', async () => {
  const GP = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
  assert.equal(GP.keyAction({ key: 'r' }).panel, 'prep'); assert.equal(GP.keyAction({ key: 'O' }).panel, 'cards'); assert.equal(GP.keyAction({ key: 'r', typing: true }), null);
  assert.equal(GP.displayLine({ kind: 'cards', cards: [{}, {}], mode: 'spread' }), 'Cards · 2, spread');
});

/* ---------- 4. the pull ---------- */
function run(doc, ledger, dry) {
  const report = newReport();
  const res = pullPrep({ vault: V, doc, ledger, report, dryRun: !!dry, now: Date.parse('2030-01-01T10:00:00Z') });
  return { res, report };
}
const notePath = path.join(V, ...(G + '/Sessions/b68g-s09.md').split('/')), pocketPath = path.join(V, ...(G + '/pip-pockets.md').split('/'));
await test('pull: a tick ticks its box in place (BOM and CRLF kept), a box in a transcluded note too; a second run changes nothing', async () => {
  const tasks = part.notes[0].blocks.flatMap((b) => b.tasks.map((t) => ({ ...t, rel: b.from })));
  const doc = { prep: { ticks: {} } };
  for (const i of [0, 3]) doc.prep.ticks[tasks[i].a] = { at: '2030-01-01T09:00:00Z', s: 9, rel: tasks[i].rel, t: tasks[i].t };
  const before = fs.readFileSync(notePath);
  const ledger = emptyCampaign();
  const dry = run(doc, ledger, true);
  assert.equal(dry.res.ticked, 2); assert.deepEqual(fs.readFileSync(notePath), before, 'a dry run writes nothing');
  const { res } = run(doc, ledger);
  assert.equal(res.ticked, 2);
  const after = fs.readFileSync(notePath), a = after.toString('utf8');
  assert.equal(after.length, before.length); assert.ok(a.startsWith('﻿') && a.includes('\r\n- [x] **#1** The kettle whistles\r\n- [x] **#2**'));
  assert.ok(a.includes('- [ ] **#1** The kettle whistles\r\n\r\n|'), 'the second kettle is a different box: untouched');
  assert.ok(fs.readFileSync(pocketPath, 'utf8').includes('- [x] Ask the goose'));
  const again = run(doc, ledger); assert.equal(again.res.ticked, 0); assert.deepEqual(fs.readFileSync(notePath), after);
  // the GM unticks by hand: the ledger remembers, so it is not ticked again
  fs.writeFileSync(pocketPath, fs.readFileSync(pocketPath, 'utf8').replace('- [x] Ask', '- [ ] Ask'));
  run(doc, ledger); assert.ok(fs.readFileSync(pocketPath, 'utf8').includes('- [ ] Ask the goose'));
});

await test('pull: a reworded box, beats and table ticks go under ## At the table (app), once; nothing is guessed', async () => {
  const ledger = emptyCampaign();
  const doc = { prep: {
    ticks: { t000000000001: { at: '2030-01-01T09:05:00Z', s: 9, rel: G + '/Sessions/b68g-s09.md', t: 'An old task' } },
    beats: { b1234abcd: { at: '2030-01-01T09:10:00Z', s: 9, label: '1 The heist' } },
    cells: { c99: { at: '2030-01-01T09:20:00Z', s: 9, label: '1 Kettle' } } } };
  const { res, report } = run(doc, ledger);
  assert.equal(res.filed, 3);
  const t = fs.readFileSync(notePath, 'utf8'), at = t.indexOf('## ' + AT_TABLE);
  assert.ok(at > t.indexOf('## Rolled at the table'), 'after the play log headings');
  assert.ok(/Ticked at the table: An old task \(not found in b68g-s09\) \^b68-tick-t000000000001\r\n/.test(t));
  assert.ok(/Beat started: 1 The heist \^b68-beat-b1234abcd/.test(t) && /Ticked at the table: 1 Kettle \^b68-cell-c99/.test(t));
  assert.equal(report.filed.filter((f) => f.kind === 'tickline').length, 1);
  const snap = fs.readFileSync(notePath); run(doc, ledger); assert.deepEqual(fs.readFileSync(notePath), snap, 'filed once');
  assert.throws(() => fileAtTable('## Names\n## Loose ends\n## Moments\n', '\n', []), /missing heading/);
});

await test('pull: the paths a tick may edit', async () => {
  assert.equal(assertPrepWritable(G + '/pip-pockets.md'), G + '/pip-pockets.md');
  assert.equal(assertPrepWritable(G + '/Sessions/b68g-s09.md'), G + '/Sessions/b68g-s09.md');
  for (const bad of [G + '/Sessions/b68g-s09-transcript.md', G + '/b68g-factions.md', G + '/Characters/Pip.md', 'Wiki/Games/Blades in the Dark/Clocks/c.md', 'TTRPG/x.md', 'Personal/x.md'])
    assert.throws(() => assertPrepWritable(bad), undefined, bad);
});

/* ---------- 5. the planning meeting's cards ---------- */
await test('cards: the server keeps only the six lines of up to 8 cards; mode, interval and start are clamped', async () => {
  assert.ok(DISPLAY_KINDS.includes('cards'));
  const d = cleanDisplay({ kind: 'cards', title: 'Opportunities', cards: [{ from: 'Pip', client: 'A client', payout: '6 stacks', extra: 'dropped' }, {}], mode: 'nope', interval: 999, start: 5 });
  assert.deepEqual(d.cards[0], { from: 'Pip', client: 'A client', target: '', type: '', note: '', payout: '6 stacks' });
  assert.deepEqual([d.mode, d.interval, d.start], ['carousel', 0, 0]);
  assert.equal(cleanDisplay({ kind: 'cards', cards: [{}], mode: 'spread', interval: 12 }).mode, 'spread');
  for (const bad of [{ cards: [] }, { cards: new Array(9).fill({}) }, { cards: [{ from: 3 }] }, { cards: ['x'] }, { cards: [{ from: 'x'.repeat(121) }] }])
    assert.throws(() => cleanDisplay({ kind: 'cards', ...bad }));
  const DP = require(path.join(ROOT, 'app', 'display-page.js'));
  const Pure = DP.Pure || DP._pure || DP;
  const vmodel = Pure.viewModel({ kind: 'cards', title: 'T', cards: [{ from: 'Pip', gm: 'secret' }], interval: 8 });
  assert.deepEqual([vmodel.kind, vmodel.cards[0].from, 'gm' in vmodel.cards[0], vmodel.interval], ['cards', 'Pip', false, 8]);
  assert.deepEqual([Pure.cardStep(0, 3, -1), Pure.cardStep(2, 3, 1)], [2, 0]);
});

fs.rmSync(V, { recursive: true, force: true });
console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
