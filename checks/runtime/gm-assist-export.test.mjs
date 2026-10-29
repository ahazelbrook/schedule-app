// The assist part v2 (scripts/lib/assist-export.mjs): NPC How to play blocks, the player table, block order, Must land.
// Invented fixtures only. No network, no key.
//   node checks/runtime/gm-assist-export.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildAssist, extractHowToPlay, collectHowToPlay, playersFromNotes, readPlayersFile, mergePlayers, DEFAULT_RULES, DEFAULT_CAST, NPC_BLOCK_NAME, PLAYERS_NAME, FACTIONS_NAME, CHARACTERS, extractFactions, factionsText, findFactionNote, readConfig, TOKEN_WARN, estimateTokens } from '../../scripts/lib/assist-export.mjs';
import { NPCS, GROUP } from '../../scripts/lib/vault.mjs';
import { EXTRA_MAX, parseExtraSpec } from '../../scripts/lib/assist-export.mjs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-v2-'));
const put = (rel, text) => { const f = path.join(tmp, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const PREP = 'Notes/Tonight.md';
put(DEFAULT_RULES, '# Rules\nRoll the dice.\n');
put(DEFAULT_CAST, '# Cast\n- Pip: a baker\n');
put(PREP, '---\ntitle: t\n---\n# Prep\n\n## Must land\n\n- The ledger changes hands\n- Pip says the word\n  - sub-point kept\n\n## Other\nx\n');
put(NPCS + '/Pip.md', '---\nwiki: entity\n---\n# Pip\n\n> [!example] How to play\n> - **Status** Low\n> - **Verb** *fuss*\n\n## After\ntext\n');
put(NPCS + '/Odd.md', '# Odd\n\n> [!example]- How To Play:\n> - **Dial** slow\n');
put(NPCS + '/Heading.md', '# Heading\n\n## How to play\n- **Status** High\n\n## Next\nnot this\n');
put(NPCS + '/Bare.md', '# Bare\n\nNo block here. How to play is mentioned in prose only.\n');
const read = (n) => fs.readFileSync(path.join(tmp, ...NPCS.split('/'), n + '.md'), 'utf8');
const build = (o = {}) => { const w = []; const part = buildAssist({ vault: tmp, exportedAt: '2030-01-01T00:00:00.000Z', warn: (m) => w.push(m), prep: PREP, ...o }); return { part, w }; };
const names = (p) => [...p.prefix.matchAll(/<context name="([^"]+)">/g)].map((m) => m[1]);
const blockOf = (prefix, name) => prefix.split('<context name="' + name + '">')[1].split('</context>')[0];

await test('How to play: present, callout quoting removed, block ends at its last quoted line', () => {
  assert.equal(extractHowToPlay(read('Pip')), '- **Status** Low\n- **Verb** *fuss*');
});
await test('How to play: oddly headed (fold marker, capitals, colon) and a plain heading section are found', () => {
  assert.equal(extractHowToPlay('> [!tip]+ HOW TO PLAY\n> - a\n> - b\n'), '- a\n- b');
  assert.equal(extractHowToPlay(read('Odd')), '- **Dial** slow');
  assert.equal(extractHowToPlay(read('Heading')), '- **Status** High');
});
await test('How to play: missing, empty or only mentioned in prose gives nothing', () => {
  assert.equal(extractHowToPlay('# X\nhow to play it is up to you\n'), '');
  assert.equal(extractHowToPlay('> [!example] How to play\n\ntext'), '');
  assert.equal(extractHowToPlay(''), '');
});
await test('collectHowToPlay lists NPCs with and without a block, sorted, ignoring sub-folders', () => {
  put(NPCS + '/figures/Ghost.md', '> [!example] How to play\n> - nope\n');
  const c = collectHowToPlay(tmp);
  assert.deepEqual(c.entries.map((e) => e.name), ['Heading', 'Odd', 'Pip']);
  assert.deepEqual(c.missing, ['Bare']);
});
await test('the prefix carries one compact entry per NPC in its own context block, and warns about NPCs with none', () => {
  const { part, w } = build();
  const npc = blockOf(part.prefix, NPC_BLOCK_NAME);
  assert.match(npc, /## Pip\n- \*\*Status\*\* Low\n- \*\*Verb\*\* \*fuss\*/);
  assert.ok(!npc.includes('After') && !npc.includes('[!example]') && !npc.includes('Bare'));
  assert.ok(w.some((m) => /1 NPC note\(s\) have no How to play block: Bare/.test(m)));
  assert.equal(part.src.npcWith, 3); assert.equal(part.src.npcWithout, 1);
});

const PC = (character, player) => '---\nwiki: reference\n' + (player ? 'player: ' + player + '\n' : '') + 'character: ' + character + '\n---\n# ' + character + '\n';
await test('player table from a player: property on PC notes; a note without one is skipped; nothing invented', () => {
  put(CHARACTERS + '/Ann Test.md', PC('Ann Test', 'Zed'));
  put(CHARACTERS + '/No Player.md', PC('No Player', ''));
  assert.deepEqual(playersFromNotes(tmp), { 'Ann Test': 'Zed' });
  const { part } = build();
  assert.equal(part.src.players, 'notes');
  const t = blockOf(part.prefix, PLAYERS_NAME);
  assert.match(t, /\| Ann Test \| Zed \|/); assert.ok(!t.includes('No Player'));
});
await test('player table from gm-private/players.json alone; the file wins over the notes per character', () => {
  const f = path.join(tmp, 'players.json');
  fs.writeFileSync(f, JSON.stringify({ 'Ann Test': 'Yan', 'Other Pc': 'Xia' }));
  assert.deepEqual(readPlayersFile(f), { 'Ann Test': 'Yan', 'Other Pc': 'Xia' });
  assert.equal(mergePlayers({}, readPlayersFile(f)).source, 'file');
  const both = build({ playersFile: f });
  assert.equal(both.part.src.players, 'both');
  assert.match(both.part.prefix, /\| Ann Test \| Yan \|/); assert.ok(!both.part.prefix.includes('| Ann Test | Zed |'));
  assert.match(both.part.prefix, /\| Other Pc \| Xia \|/);
  fs.rmSync(path.join(tmp, ...CHARACTERS.split('/')), { recursive: true });
  assert.equal(build({ playersFile: f }).part.src.players, 'file');
  fs.writeFileSync(f, '[1]');
  assert.throws(() => readPlayersFile(f), /must be a JSON object/);
  fs.rmSync(f);
});
await test('with neither source there is no table and a warning', () => {
  const { part, w } = build({ playersFile: path.join(tmp, 'absent.json') });
  assert.ok(!names(part).includes(PLAYERS_NAME));
  assert.ok(w.some((m) => /no player table/.test(m)));
  assert.equal(part.src.players, undefined);
});
await test('block order is stable (rules, cast, NPC cards, players, never-reveal, prep last); same inputs give the same sha', () => {
  put(CHARACTERS + '/Ann Test.md', PC('Ann Test', 'Zed'));
  const a = build().part, b = build().part;
  assert.deepEqual(names(a), [path.basename(DEFAULT_RULES), path.basename(DEFAULT_CAST), NPC_BLOCK_NAME, PLAYERS_NAME, 'never-reveal.md', 'Tonight.md']);
  assert.equal(a.src.blockSha, b.src.blockSha);
  const noPrep = build({ prep: '' }).part;
  assert.deepEqual(names(noPrep), names(a).slice(0, 4));
  assert.ok(a.prefix.startsWith(noPrep.prefix), 'everything before the never-reveal block is identical, so a new prep only changes the tail');
  put(NPCS + '/Pip.md', read('Pip').replace('Low', 'High'));
  assert.notEqual(build().part.src.blockSha, a.src.blockSha);
});
await test('the prep Must land list survives into the prefix intact', () => {
  const prep = build().part.prefix.split('<context name="Tonight.md">')[1];
  assert.ok(prep.includes('## Must land\n\n- The ledger changes hands\n- Pip says the word\n  - sub-point kept\n\n## Other'));
});
await test('no NPC folder: a warning and no NPC block; the build still works', () => {
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-v2b-'));
  fs.mkdirSync(path.join(t2, 'Notes'));
  fs.writeFileSync(path.join(t2, 'Notes', 'Tonight.md'), '# P\n');
  const w = []; const part = buildAssist({ vault: t2, exportedAt: 'x', warn: (m) => w.push(m), prep: PREP });
  assert.deepEqual(names(part), ['Tonight.md']);
  assert.ok(w.some((m) => /no NPC folder/.test(m)));
});

// ---------- the factions block (Meanwhile) ----------
// An invented board: a status table with escaped-pipe wikilinks, a live clocks table, a faction only the clocks name, and long cells.
const BOARD = [
  '---', 'wiki: reference', '---', '# Invented faction board', '',
  '## Status', '',
  '| Faction | Tier | Status | Why |', '|---|---|---|---|',
  '| [[inv-lamplighters\\|The Lamplighters]] | II W | **+1** *(confirmed by the GM 01/01/2030)* | ' + 'A very long reason that must not reach the prefix. '.repeat(10) + ' |',
  '| [[inv-quay-guild\\|The Quay Guild]] | III | 0 → **−2** | Because. |',
  '| [[inv-shadow\\|The Shadow Office]] *(GM only)* | ? | **hidden** | Secret. |',
  '', '## Live faction clocks', '',
  '| Faction | Goal | Clock | Ticks |', '|---|---|---|---|',
  '| [[inv-quay-guild\\|Quay Guild]] | [[Seal the quay\\|Seal the quay]] | 8, **ambient** | **3** (01/01/2030, a long aside that goes on and on and on and on and on and on and on and on and on) |',
  '| The Lamplighters | Light every lamp | 6 | 0 |',
  '| The Salt Court | Buy the harbour | 4 | **Not tracked yet** |',
  '', '## Elsewhere', '', '| Name | Note |', '|---|---|', '| not a faction | x |', '',
].join('\n');

await test('extractFactions: name, tier and standing from the board, clocks beneath; asides, long cells and links trimmed; a clocks-only faction kept', () => {
  const l = extractFactions(BOARD);
  assert.deepEqual(l.map((f) => f.name), ['The Lamplighters', 'The Quay Guild', 'The Shadow Office', 'The Salt Court']);
  assert.deepEqual([l[0].tier, l[0].status], ['II W', '+1']);
  assert.equal(l[1].status, '0 → −2');
  assert.equal(l[2].status, 'hidden');
  assert.deepEqual(l[1].clocks.map((c) => [c.goal, c.clock]), [['Seal the quay', '8, ambient']], 'Quay Guild joins The Quay Guild');
  assert.ok(l[1].clocks[0].ticks.length <= 90 && l[1].clocks[0].ticks.startsWith('3 (01/01/2030'));
  assert.deepEqual(l[3], { name: 'The Salt Court', tier: '', status: '', clocks: [{ goal: 'Buy the harbour', clock: '4', ticks: 'Not tracked yet' }] });
  assert.deepEqual(extractFactions('# Nothing\n\n| A | B |\n|---|---|\n| 1 | 2 |\n'), []);
});

await test('factionsText is short: a line a faction, a line a clock, no Why column; empty gives nothing', () => {
  const t = factionsText(extractFactions(BOARD));
  assert.match(t, /^# Factions/);
  assert.match(t, /- The Lamplighters \| tier II W \| standing \+1\n  - clock: Light every lamp \| 6 \| ticks: 0\n/);
  assert.match(t, /- The Salt Court\n  - clock: Buy the harbour/);
  assert.ok(!t.includes('very long reason') && !t.includes('Secret.'));
  assert.ok(t.length < 1500, 'short: ' + t.length);
  assert.equal(factionsText([]), ''); assert.equal(factionsText(null), '');
});

await test('the prefix carries factions.md after the handouts and players, before never-reveal, and prep stays last', () => {
  put(GROUP + '/inv-factions.md', BOARD);
  const { part } = build();
  const n = names(part);
  assert.deepEqual(n, [path.basename(DEFAULT_RULES), path.basename(DEFAULT_CAST), NPC_BLOCK_NAME, PLAYERS_NAME, FACTIONS_NAME, 'never-reveal.md', 'Tonight.md']);
  assert.equal(part.src.factions, 4); assert.equal(part.src.factionClocks, 3);
  assert.match(blockOf(part.prefix, FACTIONS_NAME), /- The Quay Guild \| tier III \| standing 0 → −2\n  - clock: Seal the quay \| 8, ambient/);
  const withHandouts = build({ handouts: { items: [{ id: 'h1', title: 'A map', file: 'x.png' }] } }).part;
  const nh = names(withHandouts);
  assert.ok(nh.indexOf('handouts.md') < nh.indexOf(FACTIONS_NAME) && nh.indexOf(FACTIONS_NAME) < nh.indexOf('never-reveal.md') && nh[nh.length - 1] === 'Tonight.md');
  assert.ok(estimateTokens(part.prefix) < TOKEN_WARN);
});

await test('the faction note: found by name in the Group folder, a config path wins, a bad or empty one warns, none is silent; the token guard still holds', () => {
  assert.equal(findFactionNote(tmp), GROUP + '/inv-factions.md');
  assert.equal(findFactionNote(tmp, 'Notes/Other.md'), 'Notes/Other.md');
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-fac-'));
  assert.equal(findFactionNote(none), '');
  assert.deepEqual(readConfig(put('cfg.json', JSON.stringify({ factions: 'Notes/F.md' }))), { factions: 'Notes/F.md' });
  put('Notes/Bare.md', '# No tables here\n');
  let r = build({ factions: 'Notes/Bare.md' });
  assert.ok(r.w.some((m) => /faction note Notes\/Bare\.md has no table/.test(m)));
  assert.ok(!names(r.part).includes(FACTIONS_NAME));
  r = build({ factions: 'Notes/Missing.md' });
  assert.ok(r.w.some((m) => /faction note Notes\/Missing\.md is not in the vault/.test(m)));
  put('Notes/F2.md', BOARD);
  r = build({ factions: 'Notes/F2.md' });
  assert.ok(names(r.part).includes(FACTIONS_NAME));
  // the 90k guard still fires with the block in place, and prep stays last
  put('Notes/Huge.md', 'word '.repeat(80000));
  r = build({ prep: 'Notes/Huge.md' });
  assert.ok(r.w.some((m) => /prefix is about \d+k tokens \(over 90k/.test(m)), r.w.join(' | '));
  assert.ok(names(r.part).includes(FACTIONS_NAME) && names(r.part).at(-1) === 'Huge.md');
});

// ---------- seat extras (S2b): invented two-line notes ----------
const CHECKLIST = '---\ntitle: Invented checks\ntags:\n  - x\n---\n\nInvented check one: say the thing.\nInvented check two: do the other thing.\n\n';
await test('extra: the config note becomes extra.<seat>, frontmatter stripped and trimmed; src records rel, chars and sha, never the text', () => {
  put('Notes/Checks.md', CHECKLIST);
  const config = readConfig(put('cfg-extra.json', JSON.stringify({ prep: PREP, extra: { ref: 'Notes/Checks.md' } })));
  assert.deepEqual(config.extra, { ref: 'Notes/Checks.md' });
  const { part, w } = build({ config });
  const want = 'Invented check one: say the thing.\nInvented check two: do the other thing.';
  assert.deepEqual(part.extra, { ref: want });
  assert.deepEqual(part.src.extra, { ref: { rel: 'Notes/Checks.md', chars: want.length, sha: crypto.createHash('sha256').update(want).digest('hex') } });
  assert.ok(!JSON.stringify(part.src).includes('Invented check'), 'the text is not in src');
  assert.ok(!part.prefix.includes('Invented check'), 'nor in the prefix');
  assert.ok(!w.some((m) => /extra/.test(m)), 'no warning');
  assert.ok(!('extra' in build().part), 'no extra configured, no extra key');
  assert.ok(!('extra' in build().part.src));
});

await test('extra: a note over the cap is clipped with a warning that says how much; a note under it is not', () => {
  put('Notes/Long.md', '---\na: b\n---\n' + 'x'.repeat(EXTRA_MAX + 250) + '\n');
  const { part, w } = build({ extra: { ref: 'Notes/Long.md' } });
  assert.equal(part.extra.ref.length, EXTRA_MAX);
  assert.equal(part.src.extra.ref.chars, EXTRA_MAX);
  assert.equal(w.filter((m) => /clipped to 4000 \(250 left out\)/.test(m)).length, 1, w.join(' | '));
  put('Notes/Exact.md', 'y'.repeat(EXTRA_MAX));
  const r = build({ extra: { ref: 'Notes/Exact.md' } });
  assert.equal(r.part.extra.ref.length, EXTRA_MAX); assert.ok(!r.w.some((m) => /clipped/.test(m)));
});

await test('extra: an empty body (frontmatter only, or blank), a missing note and an unknown seat are errors', () => {
  put('Notes/FmOnly.md', '---\ntitle: t\n---\n\n   \n');
  put('Notes/Blank.md', '  \n');
  assert.throws(() => build({ extra: { ref: 'Notes/FmOnly.md' } }), /ref note Notes\/FmOnly\.md has no body/);
  assert.throws(() => build({ extra: { ref: 'Notes/Blank.md' } }), /has no body/);
  assert.throws(() => build({ extra: { ref: 'Notes/Nope.md' } }), /ref note Notes\/Nope\.md does not exist/);
  assert.throws(() => build({ extra: { nobody: 'Notes/Checks.md' } }), /nobody is not a seat/);
  assert.throws(() => build({ extra: { ref: '../outside.md' } }), /outside the vault/);
  assert.throws(() => readConfig(put('bad1.json', JSON.stringify({ extra: { nobody: 'Notes/Checks.md' } }))), /extra\.nobody is not a seat/);
  assert.throws(() => readConfig(put('bad2.json', JSON.stringify({ extra: { ref: '' } }))), /extra\.ref must be a vault-relative path/);
  assert.throws(() => readConfig(put('bad3.json', JSON.stringify({ extra: ['ref'] }))), /extra must be an object/);
  assert.throws(() => readConfig(put('bad4.json', JSON.stringify({ extra: { toString: 'x' } }))), /not a seat/);
});

await test('extra: the CLI map wins per seat over the config, and adds seats the config lacks', () => {
  put('Notes/Checks.md', CHECKLIST);
  put('Notes/Other.md', 'A different invented note.');
  put('Notes/Third.md', 'Third invented note.');
  const config = { extra: { ref: 'Notes/Checks.md', clerk: 'Notes/Third.md' } };
  const { part } = build({ config, extra: { ref: 'Notes/Other.md' } });
  assert.deepEqual(part.extra, { clerk: 'Third invented note.', ref: 'A different invented note.' });
  assert.deepEqual(Object.keys(part.src.extra), ['clerk', 'ref']);
  assert.equal(part.src.extra.ref.rel, 'Notes/Other.md');
});

await test('extra: --assist-extra is parsed (seat=note, the seat checked); gm-pack refuses a bad one before it reads anything', () => {
  assert.deepEqual(parseExtraSpec('ref=Notes/Checks.md'), ['ref', 'Notes/Checks.md']);
  assert.deepEqual(parseExtraSpec(' ref = Notes/My Checks.md '), ['ref', 'Notes/My Checks.md']);
  assert.throws(() => parseExtraSpec('Notes/Checks.md'), /not <seat>=<vault-relative note>/);
  assert.throws(() => parseExtraSpec('ref='), /not <seat>=/);
  assert.throws(() => parseExtraSpec('nobody=Notes/x.md'), /nobody is not a seat/);
  const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gm-pack.mjs'), ...a], { encoding: 'utf8' });
  const bad = run('--assist-extra', 'nobody=Notes/x.md');
  assert.equal(bad.status, 2); assert.match(bad.stderr, /nobody is not a seat/);
});

// ---------- Who is who: the roster the Worker validates names against ----------
await test('roster: the part carries { players, gm } beside the prefix (the Worker never holds the prefix text); the GM comes from assist-config "gm"', () => {
  put(CHARACTERS + '/Ann Test.md', PC('Ann Test', 'Zed'));
  const cfg = readConfig(put('cfg-gm.json', JSON.stringify({ gm: ' Sam Test ' })));
  assert.deepEqual(cfg, { gm: 'Sam Test' });
  const { part, w } = build({ config: cfg });
  assert.deepEqual(part.roster, { players: { 'Ann Test': 'Zed' }, gm: 'Sam Test' });
  assert.ok(!w.some((m) => /no "gm" name/.test(m)));
  assert.ok(!part.prefix.includes('Sam Test'), 'the GM name is not added to the prefix');
  const noGm = build();
  assert.deepEqual(noGm.part.roster, { players: { 'Ann Test': 'Zed' } });
  assert.ok(noGm.w.some((m) => /no "gm" name/.test(m)), 'a warning, not a failure');
  fs.rmSync(path.join(tmp, ...CHARACTERS.split('/'), 'Ann Test.md'));
  assert.deepEqual(build({ config: cfg, playersFile: path.join(tmp, 'absent.json') }).part.roster, { players: {}, gm: 'Sam Test' });
  assert.equal(build({ playersFile: path.join(tmp, 'absent.json') }).part.roster, undefined, 'no names at all: no roster');
  assert.throws(() => readConfig(put('cfg-gm-bad.json', JSON.stringify({ gm: '' }))), /gm must be the GM/);
  assert.throws(() => readConfig(put('cfg-gm-bad2.json', JSON.stringify({ gm: 5 }))), /gm must be the GM/);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
