// The never-reveal block of the assist part (scripts/lib/assist-export.mjs): what is extracted from prep and NPC notes, where the block
// sits in the prefix, and that the cache order is stable. Invented fixtures only. No network, no key.
//   node checks/runtime/gm-assist-never.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildAssist, extractSecretSections, extractMustLand, neverRevealText, collectNever, DEFAULT_RULES, DEFAULT_CAST, NPC_BLOCK_NAME, PLAYERS_NAME, NEVER_NAME, CHARACTERS } from '../../scripts/lib/assist-export.mjs';
import { NPCS } from '../../scripts/lib/vault.mjs';

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'assist-never-'));
const put = (root, rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const names = (p) => [...p.prefix.matchAll(/<context name="([^"]+)">/g)].map((m) => m[1]);
const blockOf = (prefix, name) => prefix.split('<context name="' + name + '">')[1].split('</context>')[0];
const PREP = 'Notes/Tonight.md';
const MARK_A = 'ZZ-clue-alpha', MARK_B = 'ZZ-clue-beta', MARK_C = 'ZZ-clue-gamma', MARK_N = 'ZZ-npc-truth', MARK_S = 'ZZ-secret-box';

function vault(prepText, { npc = true } = {}) {
  const v = mk();
  put(v, DEFAULT_RULES, '# Rules\nRoll the dice.\n');
  put(v, DEFAULT_CAST, '# Cast\n- Pip: a baker\n');
  put(v, CHARACTERS + '/Ann Test.md', '---\nplayer: Zed\ncharacter: Ann Test\n---\n# Ann Test\n');
  put(v, NPCS + '/Pip.md', '# Pip\n\n> [!example] How to play\n> - **Verb** fuss\n\n' + (npc ? '## Knows / doesn\'t know\n\n- **Knows:** ' + MARK_N + ' about the till.\n- **Doesn\'t know:** the buyer.\n\n## After\nplain text\n' : '## After\nplain text\n'));
  if (prepText !== null) put(v, PREP, prepText);
  return v;
}
const PREP_TEXT = '# Prep\n\n## Must land\n\n> [!important] Get these out\n> Three ways in each.\n\n- [ ] **#1 · First.** ' + MARK_A + ' goes here.\n  - sub-point kept\n- [x] **#2 · Second.** ' + MARK_B + ' already landed.\n- [ ] **#3 · Third.** ' + MARK_C + '\n\n## Other\nx\n';
const build = (v, o = {}) => { const w = []; const part = buildAssist({ vault: v, exportedAt: 'x', warn: (m) => w.push(m), prep: PREP, ...o }); return { part, w }; };

// ---------- extraction ----------
await test('Must land: unticked list items are entries (with their indented lines), ticked ones are counted not listed', () => {
  const m = extractMustLand(PREP_TEXT);
  assert.equal(m.found, true); assert.equal(m.landed, 1);
  assert.equal(m.entries.length, 2);
  assert.match(m.entries[0], /^\*\*#1 · First\.\*\* ZZ-clue-alpha goes here\.\nsub-point kept$|^\*\*#1 · First\.\*\* ZZ-clue-alpha goes here\.\n- sub-point kept$/);
  assert.match(m.entries[1], /ZZ-clue-gamma/);
  assert.ok(!m.entries.join('\n').includes(MARK_B), 'the landed clue is not a secret');
  assert.ok(!m.entries.join('\n').includes('Three ways in'), 'the callout above the list is not an entry');
});

await test('Must land: odd headings (level, case, hyphen, count), numbered lists, no checkboxes, and a section with no list', () => {
  for (const head of ['### MUST LAND', '## Must-land clues', '## Must land (3)', '# must land:']) {
    const m = extractMustLand(head.replace(/:$/, '') + '\n\n1. One ' + MARK_A + '\n2. Two\n\n## Next\nz\n');
    assert.equal(m.found, true, head); assert.equal(m.entries.length, 2, head);
  }
  const plain = extractMustLand('## Must land\n\nJust a sentence, no list.\n\n## After\nx\n');
  assert.deepEqual(plain.entries, ['Just a sentence, no list.']);
  assert.equal(extractMustLand('## Must land\n\n## After\nx\n').entries.length, 0);
  assert.equal(extractMustLand('## Must landing gear\n- x\n').found, false, 'a heading that only starts with those letters is not it');
  assert.deepEqual(extractMustLand('# Prep\nnothing\n'), { found: false, entries: [], landed: 0 });
  assert.equal(extractMustLand('## Must land\n- [X] done\n- [ ] open\n').entries.length, 1, 'a capital X is ticked too');
});

await test('secret sections: secret-style headings and callouts, GM-only wording, folded callouts; "Knows / doesn\'t know" only for NPC notes', () => {
  const t = [
    '# N', '', '## Knows / doesn\'t know', '', '- **Knows:** ' + MARK_N, '', '## Chatter', 'nothing', '',
    '### The Truth', '', 'body one', '', '## Other', '', '> [!danger]- GM only: the ledger', '> ' + MARK_S, '> second line', '', 'after', '',
    '> [!tip] Say it plainly', '> not secret', '', '## Secrets of the shop', 'body two',
  ].join('\n');
  const npc = extractSecretSections(t, { knows: true });
  assert.deepEqual(npc.map((s) => s.title), ['Knows / doesn\'t know', 'The Truth', 'GM only: the ledger', 'Secrets of the shop']);
  assert.equal(npc[2].body, MARK_S + '\nsecond line');
  assert.equal(npc[1].body, 'body one');
  const prep = extractSecretSections(t);
  assert.ok(!prep.some((s) => /Knows/.test(s.title)), 'a prep note\'s "Knows" section is not a convention');
  assert.deepEqual(extractSecretSections('# X\nsecret in the prose only\n> [!note] Hidden truth\n').length, 0, 'empty callout, prose mentions: nothing');
  assert.equal(extractSecretSections('## Never reveal\nthis\n', {}).length, 1);
  assert.equal(extractSecretSections('## Open secretary notes\nx\n').length, 0, 'whole words only');
});

await test('neverRevealText: empty when nothing, NPC part before tonight\'s part, never an invented entry', () => {
  assert.equal(neverRevealText({}), '');
  assert.equal(neverRevealText({ npc: [], prep: { name: 'T.md', entries: [], sections: [] } }), '');
  const t = neverRevealText({ npc: [{ name: 'Pip', sections: [{ title: 'Knows / doesn\'t know', body: '- x' }] }], prep: { name: 'T.md', entries: ['**#1** a'], sections: [{ title: 'Secrets', body: 'b' }] } });
  assert.ok(t.startsWith('# Never reveal'));
  assert.ok(t.indexOf('### Pip') < t.indexOf('Clues not yet landed') && t.indexOf('Clues not yet landed') < t.indexOf('### Secrets'));
});

// ---------- the block in the prefix ----------
await test('found: the block carries the NPC truth and the unlanded clues only, from the vault\'s own text', () => {
  const v = vault(PREP_TEXT);
  const { part, w } = build(v);
  const nv = blockOf(part.prefix, NEVER_NAME);
  assert.ok(nv.includes(MARK_N) && nv.includes(MARK_A) && nv.includes(MARK_C));
  assert.ok(!nv.includes(MARK_B), 'the landed clue is left out');
  assert.ok(!nv.includes('plain text') && !nv.includes('Roll the dice'), 'nothing else leaks in');
  assert.equal(part.src.mustLand, 2); assert.equal(part.src.mustLandLanded, 1); assert.equal(part.src.neverNpc, 1);
  assert.ok(!w.some((m) => /never-reveal|Must land/.test(m)), w.join('; '));
});

await test('order: rules, cast, how-to-play, players, never-reveal, prep', () => {
  const { part } = build(vault(PREP_TEXT));
  assert.deepEqual(names(part), [path.basename(DEFAULT_RULES), path.basename(DEFAULT_CAST), NPC_BLOCK_NAME, PLAYERS_NAME, NEVER_NAME, 'Tonight.md']);
});

await test('cache order: everything before the never-reveal block is byte-identical with or without prep, and the NPC part of the block is a stable head', () => {
  const v = vault(PREP_TEXT);
  const withPrep = build(v).part.prefix, noPrep = build(v, { prep: '' }).part.prefix;
  const cut = (s) => s.slice(0, s.indexOf('<context name="' + NEVER_NAME + '">'));
  assert.ok(cut(withPrep).length > 0 && cut(withPrep) === cut(noPrep), 'stable blocks identical');
  const nvWith = blockOf(withPrep, NEVER_NAME), nvNo = blockOf(noPrep, NEVER_NAME);
  const head = nvNo.slice(0, nvNo.lastIndexOf('\n'));
  assert.ok(nvWith.startsWith(head) || nvWith.startsWith(nvNo.trimEnd()), 'the NPC part comes first and is unchanged by tonight\'s prep');
  assert.ok(!nvNo.includes(MARK_A), 'no tonight part without a prep');
  // a different night changes only the tail
  const v2 = vault(PREP_TEXT.replace(MARK_A, 'ZZ-other-night'));
  assert.equal(cut(build(v2).part.prefix), cut(withPrep));
  // prep itself is last, after the never-reveal block
  assert.ok(withPrep.lastIndexOf('<context name="Tonight.md">') > withPrep.indexOf('<context name="' + NEVER_NAME + '">'));
  // same inputs, same prefix
  assert.equal(build(v).part.prefix, withPrep);
});

await test('none found: no block, a warning, and nothing invented', () => {
  const v = vault('# Prep\n\nJust notes. The word secret appears in prose only.\n', { npc: false });
  const { part, w } = build(v);
  assert.ok(!names(part).includes(NEVER_NAME));
  assert.ok(w.some((m) => /nothing found for the never-reveal list/.test(m)), w.join('; '));
  assert.equal(w.filter((m) => /never-reveal|Must land/.test(m)).length, 1, 'one warning, not two');
  assert.equal(part.src.mustLand, 0);
});

await test('NPC truths but a prep with no Must land section: the block stands and the missing section is warned about', () => {
  const { part, w } = build(vault('# Prep\n\nJust notes.\n'));
  assert.ok(names(part).includes(NEVER_NAME));
  assert.ok(w.some((m) => /no "Must land" section/.test(m)), w.join('; '));
  assert.ok(!w.some((m) => /nothing found/.test(m)));
});

await test('NPC truths only (no prep named): the block exists and holds just the NPC part', () => {
  const { part, w } = build(vault(PREP_TEXT), { prep: '' });
  const nv = blockOf(part.prefix, NEVER_NAME);
  assert.ok(nv.includes(MARK_N) && !nv.includes(MARK_A) && !nv.includes('Tonight'));
  assert.ok(w.some((m) => /no prep note named/.test(m)));
});

await test('Must land with every entry ticked: a warning, and the NPC part still stands', () => {
  const { part, w } = build(vault('## Must land\n\n- [x] one\n- [x] two\n'));
  assert.ok(w.some((m) => /no unlanded entries \(2 ticked\)/.test(m)), w.join('; '));
  const nv = blockOf(part.prefix, NEVER_NAME);
  assert.ok(nv.includes(MARK_N) && !nv.includes('Tonight'));
});

await test('secret-style headings in the prep note join the block under tonight\'s part', () => {
  const { part } = build(vault(PREP_TEXT + '\n## Secrets for tonight\n\n' + MARK_S + '\n'));
  const nv = blockOf(part.prefix, NEVER_NAME);
  assert.ok(nv.includes('### Secrets for tonight') && nv.includes(MARK_S));
});

await test('collectNever: sorted, top level only, a note without a section is skipped, an absent folder is flagged', () => {
  const v = vault(PREP_TEXT);
  put(v, NPCS + '/Aaa.md', '## The secret\nA truth ' + MARK_S + '\n');
  put(v, NPCS + '/Quiet.md', '# Quiet\nnothing\n');
  put(v, NPCS + '/figures/Ghost.md', '## Secret\nno\n');
  assert.deepEqual(collectNever(v).npc.map((n) => n.name), ['Aaa', 'Pip']);
  assert.equal(collectNever(mk()).absent, true);
});

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
