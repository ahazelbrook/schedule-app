// The assist part v2 (scripts/lib/assist-export.mjs): NPC How to play blocks, the player table, block order, Must land.
// Invented fixtures only. No network, no key.
//   node checks/runtime/gm-assist-export.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildAssist, extractHowToPlay, collectHowToPlay, playersFromNotes, readPlayersFile, mergePlayers, DEFAULT_RULES, DEFAULT_CAST, NPC_BLOCK_NAME, PLAYERS_NAME, CHARACTERS } from '../../scripts/lib/assist-export.mjs';
import { NPCS } from '../../scripts/lib/vault.mjs';

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
await test('block order is stable (rules, cast, NPC cards, players, prep last); same inputs give the same sha', () => {
  put(CHARACTERS + '/Ann Test.md', PC('Ann Test', 'Zed'));
  const a = build().part, b = build().part;
  assert.deepEqual(names(a), [path.basename(DEFAULT_RULES), path.basename(DEFAULT_CAST), NPC_BLOCK_NAME, PLAYERS_NAME, 'Tonight.md']);
  assert.equal(a.src.blockSha, b.src.blockSha);
  const noPrep = build({ prep: '' }).part;
  assert.deepEqual(names(noPrep), names(a).slice(0, 4));
  assert.ok(a.prefix.startsWith(noPrep.prefix), 'everything before the prep is identical, so a new prep only changes the tail');
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
