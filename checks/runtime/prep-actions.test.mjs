// Prep actions (PA): the action-span grammar of app/gm/prep-actions.js (both lead-ins, every verb, the clock's fields), the handout-name match
// (id, title, punctuation, a unique prefix, an ambiguous one, none), the rule finder, the excerpt, and that an action span never leaves the GM
// page through the room notes (SAY, Costume: the phones) or the stamp's "If it goes wrong" line (the shared screen). Also where the files are
// bundled. No browser, no network. Invented names only.
//   node checks/runtime/prep-actions.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const A = require(path.join(ROOT, 'app', 'gm', 'prep-actions.js'));
const Rooms = require(path.join(ROOT, 'app', 'gm', 'room-notes.js'));
const St = require(path.join(ROOT, 'app', 'gm', 'stamp.js'));

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const LIST = [
  { id: 'pelican-floor-plan', title: 'The Pelican Rooms: floor plan', file: 'a1b2c3d4e5f60718.png' },
  { id: 'mabels-letter', title: 'Mabel Quist’s letter', file: 'f0e1d2c3b4a59687.png' },
  { id: 'mabels-ledger', title: 'Mabel Quist’s ledger', file: '0123456789abcdef.png' }
];

await test('parse: both lead-ins, the verbs case-folded, the argument trimmed', () => {
  assert.deepEqual(A.parse('▶ handout: Mabels letter'), { kind: 'handout', verb: 'handout', arg: 'Mabels letter', text: 'handout: Mabels letter' });
  assert.equal(A.parse('>> handout: mabels-letter').kind, 'handout');
  assert.equal(A.parse('▶️ HandOut:  The Pelican Rooms ').arg, 'The Pelican Rooms', 'U+FE0F after the triangle, case, spaces');
  assert.equal(A.parse('▶ Rule: Push yourself').kind, 'rule');
  assert.equal(A.parse('▶ rule: Push yourself').arg, 'Push yourself');
  assert.equal(A.parse('▶ crew sheet').kind, 'crew');
  assert.equal(A.parse('>> Crew Sheet').kind, 'crew');
  assert.equal(A.parse('▶ dance: now').kind, 'unknown');
  assert.equal(A.parse('▶ handout:').kind, 'unknown', 'a handout with no name');
  assert.equal(A.parse('▶ clock').kind, 'unknown');
});
await test('parse: not an action span', () => {
  for (const t of ['handout: x', '▶handout: x', '>>handout: x', '> handout: x', '[Provenance]', '{+1d}', 'a ▶ b', '', '▶ ', '>> ']) assert.equal(A.parse(t), null, JSON.stringify(t));
});
await test('the clock: name / size / ticks, " / " only, size 4 6 8 12, default 4', () => {
  assert.deepEqual(A.parse('▶ clock: Alarm bells').clock, { name: 'Alarm bells', size: 4, ticks: 0 });
  assert.deepEqual(A.parse('▶ clock: Alarm bells / 6').clock, { name: 'Alarm bells', size: 6, ticks: 0 });
  assert.deepEqual(A.parse('▶ clock: Alarm bells / 8 / 3').clock, { name: 'Alarm bells', size: 8, ticks: 3 });
  assert.deepEqual(A.parse('▶ clock: Floor 1/2 / 12').clock, { name: 'Floor 1/2', size: 12, ticks: 0 }, 'a slash without spaces is part of the name');
  assert.ok(A.parse('▶ clock: Alarm / 5').clock.bad, 'size 5');
  assert.ok(A.parse('▶ clock: Alarm / six').clock.bad);
  assert.ok(A.parse('▶ clock: Alarm / 4 / 5').clock.bad, 'more ticks than segments');
  assert.ok(A.parse('▶ clock: Alarm / 4 / 1 / 2').clock.bad, 'a fourth field');
  assert.equal(A.parse('▶ clock: Alarm | 6').clock.name, 'Alarm | 6', 'a pipe is not a separator');
});
await test('the handout match: id, title, folded for case, spaces and punctuation; a unique prefix; ambiguous; none', () => {
  assert.equal(A.matchHandout(LIST, 'pelican-floor-plan').hit.id, 'pelican-floor-plan', 'the id (the vault file stem)');
  assert.equal(A.matchHandout(LIST, 'Pelican Floor Plan').hit.id, 'pelican-floor-plan', 'the stem with spaces and capitals');
  assert.equal(A.matchHandout(LIST, 'the pelican rooms — floor plan!').hit.id, 'pelican-floor-plan', 'the title, punctuation dropped');
  assert.equal(A.matchHandout(LIST, "Mabel Quist's letter").hit.id, 'mabels-letter', 'a straight apostrophe for a curly one');
  assert.equal(A.matchHandout(LIST, 'Pelican').hit.id, 'pelican-floor-plan', 'a unique prefix');
  assert.equal(A.matchHandout(LIST, 'mabels').many.length, 2, 'an ambiguous prefix');
  assert.ok(A.matchHandout(LIST, 'Mabel Quist').many, 'an ambiguous title prefix');
  assert.ok(A.matchHandout(LIST, 'the ferry timetable').none);
  assert.ok(A.matchHandout(LIST, '').none);
  assert.ok(A.matchHandout(null, 'x').none);
  const two = [{ id: 'ledger', title: 'A ledger page' }, { id: 'ledger-two', title: 'Ledger' }];
  assert.equal(A.matchHandout(two, 'ledger').hit.id, 'ledger', 'an exact id beats an exact title of another');
});
await test('the rule finder: the GM screen section of that title, else the rules (a title that folds to it, else the best hit), else a section that holds the term', () => {
  const secs = [{ id: 'pe', title: 'Position and effect', md: 'Set the position.' }, { id: 'heat', title: 'Heat', md: 'Loud work adds heat.' }];
  assert.deepEqual(A.findRule('position and effect', secs, [{ id: 'b68/x', title: 'Position and effect' }]), { src: 'screen', id: 'pe', title: 'Position and effect', md: 'Set the position.' });
  assert.deepEqual(A.findRule('Push yourself', secs, [{ id: 'b68/a', title: 'Stress' }, { id: 'b68/b', title: 'Push Yourself' }]), { src: 'rules', id: 'b68/b' });
  assert.deepEqual(A.findRule('gambits', secs, [{ id: 'b68/c', title: 'Gambits and pushing' }]), { src: 'rules', id: 'b68/c' });
  assert.equal(A.findRule('effect', secs, []).id, 'pe', 'no rules: a screen section whose title holds it');
  assert.equal(A.findRule('flashbacks', secs, []), null);
  assert.equal(A.findRule('', secs, []), null);
});
await test('the excerpt: about 600 characters, cut at a word, an ellipsis', () => {
  const md = '# Push\n\n' + 'Word '.repeat(300);
  const e = A.excerpt(md, null);
  assert.ok(e.length <= 601 && e.length > 400 && e.endsWith('…'), e.length);
  assert.equal(A.excerpt('Short **rule**.', { plain: (s) => s.replace(/\*/g, '') }), 'Short rule.');
});
await test('strip: an action span goes whole, text and all; other code spans stay', () => {
  assert.equal(A.strip('Hand them `▶ handout: Mabels letter` now.'), 'Hand them   now.');
  assert.equal(A.strip('A `>> clock: Alarm / 6` and `{+1d}` and `[Ledger]`'), 'A   and `{+1d}` and `[Ledger]`');
  assert.equal(A.strip('``▶ rule: Push ` yourself``'), ' ');
  assert.equal(A.strip('No spans here.'), 'No spans here.');
  /* review round: a span starts only at an OPENING backtick run; leading spaces before the lead-in are still a span */
  assert.equal(A.strip('`a` >> b `c`'), '`a` >> b `c`', 'the text between two code spans is not a span');
  assert.equal(A.strip('`a` ▶ b `c` d'), '`a` ▶ b `c` d');
  assert.equal(A.strip('x `  ▶ rule: GM-ONLY-TWO` y'), 'x   y', 'two leading spaces: a chip, so stripped');
  assert.equal(A.strip('x `   >> clock: GM-ONLY-THREE / 4` y'), 'x   y');
  assert.equal(A.strip('a ` then `▶ handout: x`'), 'a ` then `▶ handout: x`', 'as Markdown pairs them: "` then `" is the span, so nothing here is an action (and none is chipped)');
  assert.equal(A.strip('a `` b `▶ handout: x`'), 'a `` b  ', 'an unmatched run is literal; the span after it still goes');
  assert.equal(A.strip('`` `▶ x` ``'), '`` `▶ x` ``', 'a span whose text starts with a backtick is not an action');
});
await test('one test decides: every code span the chip renderer would chip is exactly what strip and the room notes take out', () => {
  const contents = ['▶ handout: a', '  ▶ handout: a', '>> rule: b', '   >> rule: b', '▶️ clock: c / 6', ' ▶ crew sheet', '▶ dance: x', '▶handout: a', '>>rule: b', '> handout: a', ' ▶ ', '[Ledger]', '{+1d}', '`▶ x`', 'plain'];
  for (const c of contents) {
    const md = 'Before `` ' + c + ' `` after and `' + c.replace(/`/g, '') + '` end';
    const chip = !!A.parse(c), chip2 = !!A.parse(c.replace(/`/g, ''));
    assert.equal(chip, Rooms.isAction(c), 'parse and isAction agree: ' + JSON.stringify(c));
    const out = A.strip(md), plainOut = Rooms.plain(md), stampOut = St.goesWrong('- If it goes wrong: ' + md).join(' ');
    for (const [name, o] of [['strip', out], ['room notes', plainOut], ['stamp', stampOut]]) {
      if (chip || chip2) assert.ok(!/GM-NEVER|handout: a|rule: b|clock: c|crew sheet|dance: x/.test(o) || !(chip && chip2), name + ' takes out ' + JSON.stringify(c) + ': ' + o);
      assert.ok(/Before/.test(o) && /end/.test(o), name + ' keeps the text round it: ' + o);
    }
  }
  const md = 'Say `  ▶ rule: GM-ONLY-SAY2` it.';
  assert.equal(Rooms.plain(md), 'Say it.');
  assert.deepEqual(St.goesWrong('- If it goes wrong: doors lock `  >> clock: GM-ONLY-W2 / 4`\n- **Who:** GM-ONLY-WHO'), ['doors lock']);
  assert.deepEqual(St.goesWrong('- If it goes wrong: `   ▶ clock: GM-ONLY-W3 / 4`\n- **Who:** GM-ONLY-WHO'), [], 'a line of only a span (three spaces in): no list under it');
});
await test('secrecy: the room notes give the phones no action span (SAY, Costume), the stamp no "If it goes wrong" span', () => {
  const md = ['## Rooms', '', '### Showroom', '', '- **Costume:** A guest’s mask `▶ handout: GM-ONLY-HANDOUT-A`', '- **Who:** Mabel Quist `▶ clock: GM-ONLY-CLOCK / 6`',
    '- If it goes wrong: The doors lock `▶ rule: GM-ONLY-RULE`', '', '> [!quote] SAY', '> Welcome to the house. `>> handout: GM-ONLY-HANDOUT-B`', '',
    '### Lounge', '', '- If it goes wrong: `▶ clock: GM-ONLY-LONE / 4`', '- **Who:** GM-ONLY-WHO-LINE', ''].join('\n');
  const r = Rooms.find({ notes: [{ id: 'n1', blocks: [{ k: 'md', src: md }] }] }, ['Showroom', 'Lounge']);
  const sr = r.byRoom.Showroom;
  assert.equal(sr.costume, 'A guest’s mask');
  assert.deepEqual(sr.say, ['Welcome to the house.']);
  assert.deepEqual(St.goesWrong(sr.md), ['The doors lock']);
  assert.deepEqual(St.goesWrong(r.byRoom.Lounge.md), [], 'a line that held only an action span: no list under it (the Who line stays GM-side)');
  const out = JSON.stringify([sr.costume, sr.say, St.goesWrong(sr.md), St.goesWrong(r.byRoom.Lounge.md)]);
  assert.ok(!/GM-ONLY|▶|>>/.test(out), out);
  assert.equal(Rooms.plain('Plain `code` stays'), 'Plain code stays', 'an ordinary code span is still just its text');
});
await test('the bundle: prep-actions holds the two files, last in the routes, the stylesheet in the cascade order, fetched by gm-page.js only', () => {
  const ctx = { console, self: {} }; ctx.window = ctx.self; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8'), ctx);
  const L = ctx.self.B68Load, names = Object.keys(L.BUNDLES);
  assert.equal(names[names.length - 1], 'prep-actions');
  assert.equal(JSON.stringify(L.BUNDLES['prep-actions']), JSON.stringify(['gm/prep-actions.css', 'gm/prep-actions.js']));
  for (const [n, list] of Object.entries(L.BUNDLES)) if (n !== 'prep-actions') assert.ok(!list.some((f) => /prep-actions/.test(f)), n);
  assert.ok(L.CSS_ORDER.includes('gm/prep-actions.css'));
  const gm = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.match(gm, /B68Load\.need\('prep-actions'\)/);
  assert.match(gm, /!paHas\(el\)\) return;/, 'asked for only when the note holds an action span');
  const css = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'prep-actions.css'), 'utf8');
  assert.ok(!/[\u0080-\u009f]/.test(css), 'no mangled punctuation');
  assert.ok(!/!important/.test(css));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
