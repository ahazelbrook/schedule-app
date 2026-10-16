// The GM pack's `screen` part (scripts/lib/screen-export.mjs): the note with gm_screen: true, cut at its ## headings.
// Invented text only (the real screen is book text and never comes near git).
//   node checks/runtime/gm-screen.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { cutScreen, unlink, buildScreen } from '../../scripts/lib/screen-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}

await test('cut: title, intro, one section per ##, ### stays inside, a heading in a code fence is not a cut, Related ends it', () => {
  const c = cutScreen(['', '# The screen', '', '> [!danger] Law', '> Geese first.', '', '## One', '', 'a', '', '### Sub', '', 'b', '',
    '## Two', '', '```', '## not a heading', '```', '', '## Related', '', '- [[x]]', '', '## After', '', 'never'].join('\n'));
  assert.equal(c.title, 'The screen');
  assert.equal(c.intro, '> [!danger] Law\n> Geese first.');
  assert.deepEqual(c.sections.map((s) => s.id), ['one', 'two']);
  assert.ok(c.sections[0].md.includes('### Sub') && c.sections[0].md.endsWith('b'));
  assert.ok(c.sections[1].md.includes('## not a heading'));
  assert.ok(c.stopped && !JSON.stringify(c).includes('never'));
});

await test('cut: duplicate titles get distinct ids; an empty section is dropped; Provenance and Sources also stop it', () => {
  const c = cutScreen('## Heat\n\nx\n\n## Heat\n\ny\n\n## Empty\n\n## Provenance\n\nz');
  assert.deepEqual(c.sections.map((s) => s.id), ['heat', 'heat-x']);
  assert.deepEqual(cutScreen('## A\n\nq\n\n## Sources\n\nz').sections.length, 1);
});

await test('unlink: wikilinks become their text, embeds go', () => {
  assert.equal(unlink('see [[Page]], [[Page#Head|the head]] and [[Other#Bit]]. ![[img.png]]'), 'see Page, the head and Other. ');
});

await test('build: no note opts in -> null; the opted-in note under the \'68 folder -> the part; two -> a warning, the first by path', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-screen-'));
  const w = (rel, t) => { const f = path.join(v, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  const B = 'Wiki/Games/Blades in the Dark';
  w(B + '/Rules/plain.md', '# Plain\n\n## A\n\nx\n');
  assert.equal(buildScreen({ vault: v, repo: ROOT, exportedAt: 'T' }), null);
  w(B + '/Rules/b-screen.md', '---\ngm_screen: true\n---\n\n# B screen\n\n## Rolls\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  w('Elsewhere/c-screen.md', '---\ngm_screen: true\n---\n\n## Outside\n\nno\n');
  const warns = [];
  let p = buildScreen({ vault: v, repo: ROOT, exportedAt: 'T', warn: (m) => warns.push(m) });
  assert.deepEqual([p.v, p.title, p.rel, p.sections.length, p.sections[0].id, p.src.exportedAt], [1, 'B screen', B + '/Rules/b-screen.md', 1, 'rolls', 'T']);
  assert.ok(/^[0-9a-f]{64}$/.test(p.src.blockSha)); assert.equal(warns.length, 0, 'a note outside the \'68 folder is not looked at');
  const sha = p.src.blockSha;
  assert.equal(buildScreen({ vault: v, repo: ROOT, exportedAt: 'U' }).src.blockSha, sha, 'same note, same hash');
  w(B + '/Rules/a-screen.md', '---\ngm_screen: yes\n---\n\n## First\n\nx\n');
  p = buildScreen({ vault: v, repo: ROOT, exportedAt: 'T', warn: (m) => warns.push(m) });
  assert.equal(p.rel, B + '/Rules/a-screen.md'); assert.ok(/2 notes have gm_screen/.test(warns[0]));
  fs.rmSync(v, { recursive: true, force: true });
});

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
