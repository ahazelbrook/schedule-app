// Unit test for the cue (app/cue.js, ticket C4a; no browser, no network): every command row of design 1.3, every refusal, number words and mishearings, the clause rule,
// decoys that must never fire, split commands parsed on the joined text, a bare "Blade," as pending, Alex's two phrasings, the quote and the no-key contract, then the
// fixture file (fixtures/gm/cue-phrasings.json: hand-written plain phrasings, noisy ones made with the local model and reviewed by hand, and decoys). Every name is invented.
//   node checks/runtime/gm-cue.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Cue = require(path.join(ROOT, 'app', 'cue.js'));
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'cue-phrasings.json'), 'utf8'));

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const LIVE = FX.live;
const byName = (n) => LIVE.clocks.find((c) => c.name === n);
const nameOf = (id) => (LIVE.clocks.find((c) => c.id === id) || {}).name;
/* a parse, in the fixture's compact shape: a (actions without the quote, a tick naming its clock), m, r, c, p, none */
function shape(text, last) {
  const r = Cue.parse(text, Object.assign({}, LIVE, last ? { lastClock: byName(last).id } : {}));
  if (!r.cue) return { none: true };
  if (r.pending) return { a: [], p: true };
  const o = { a: r.actions.map((a) => { const x = Object.assign({}, a); delete x.quote; if (x.clock_id) { x.clock_name = nameOf(x.clock_id); delete x.clock_id; } return x; }) };
  if (r.missing) { o.m = r.missing; if (r.candidates.length) o.c = r.candidates.map((c) => (c && typeof c === 'object' ? c.name : c)); }
  if (r.refused) o.r = r.refused;
  return o;
}
const norm = (e) => ({ a: e.a || [], m: e.m, c: e.c, r: e.r, p: e.p, none: e.none });
const lc = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "string" ? v.toLowerCase() : v)));
const same = (got, want, ci) => { try { assert.deepEqual(ci ? lc(norm(got)) : norm(got), ci ? lc(norm(want)) : norm(want)); return true; } catch (e) { return false; } };
const textOf = (f) => (f.l ? Cue.joinLines(f.l[0], f.l[1]) : f.t);
const P = (text, last) => Cue.parse(text, Object.assign({}, LIVE, last ? { lastClock: byName(last).id } : {}));

/* ---------- 1. every command row ---------- */
await test('1a. clock_add: make / start / new / create, a size word or digits, called / named / for', () => {
  for (const v of ['make', 'start', 'new', 'create']) {
    const r = P(`Blade, ${v} a six segment clock called Escape`);
    assert.deepEqual(r.actions.map((a) => [a.type, a.name, a.size, a.hidden]), [['clock_add', 'Escape', 6, true]], v);
  }
  assert.deepEqual(P('Blade, make a 6 clock named escape').actions[0].name, 'Escape');
  assert.equal(P('Blade, make a four-segment clock for the escape').actions[0].size, 4);
  assert.deepEqual([4, 6, 8, 10, 12].map((n) => P(`Blade, make a ${n} segment clock called Tide Watch`).actions[0].size), [4, 6, 8, 10, 12]);
  assert.equal(P('Blade, make a 6 segment clock called Tide Watch').actions[0].filled, undefined, 'no "and mark" means no filled field');
});
await test('1b. clock_add: no size is missing size (candidates 4, 6, 8), an odd size too; no name is missing name; "and mark two" fills', () => {
  let r = P('Blade, make a clock called Tide Watch');
  assert.deepEqual([r.actions, r.missing, r.candidates, r.draft.name], [[], 'size', [4, 6, 8], 'Tide Watch']);
  assert.equal(P('Blade, make a five clock called Tide Watch').missing, 'size');
  assert.equal(P('Blade, make a six clock').missing, 'name');
  r = P('Blade, make a six clock called Tide Watch and mark two');
  assert.equal(r.actions[0].filled, 2); assert.equal(r.actions[0].name, 'Tide Watch');
  assert.equal(P('Blade, make a four clock called Tide Watch and mark nine').actions[0].filled, 4, 'filled never passes the size');
  assert.equal(P('Blade, make a six clock called Salt and Pepper').actions[0].name, 'Salt and Pepper', '"and" inside a name stays in it');
});
await test('1c. clock_tick: tick X (n), mark n on X, X plus n, fill X, clear n on X', () => {
  const t = (s, by, name) => { const r = P(s); assert.deepEqual(r.actions.map((a) => [a.type, a.clock_name, a.by]), [['clock_tick', name, by]], s); };
  t('Blade, tick Escape', 1, 'Escape'); t('Blade, tick Escape two', 2, 'Escape'); t('Blade, mark two on Escape', 2, 'Escape'); t('Blade, Escape plus two', 2, 'Escape');
  t('Blade, Escape plus', 1, 'Escape'); t('Blade, fill Escape', 5, 'Escape'); t('Blade, clear two on Escape', -2, 'Escape'); t('Blade, tick Escape twice', 2, 'Escape');
  assert.equal(P('Blade, tick Escape').actions[0].clock_id, byName('Escape').id, 'the id is the live clock id');
  assert.equal(P('Blade, clear Escape').missing, 'amount');
  assert.equal(P('Blade, fill Customs Squeeze').refused, 'nochange', 'a full clock has nothing to fill');
});
await test('1d. clock names: exact, ignoring the/a, one letter off; two matches is which (with the candidates), none is clock', () => {
  assert.equal(P('Blade, tick escape').actions[0].clock_name, 'Escape');
  assert.equal(P('Blade, tick broken lantern').actions[0].clock_name, 'The Broken Lantern', 'ignoring "the"');
  assert.equal(P('Blade, tick the escape').actions[0].clock_name, 'Escape', 'ignoring "the" on the spoken side');
  assert.equal(P('Blade, tick gull markit raid').actions[0].clock_name, 'Gull Market Raid', 'one letter off, words of five or more');
  assert.equal(P('Blade, tick Broken Lanterns').actions[0].clock_name, 'The Broken Lantern');
  let r = P('Blade, tick ferry');
  assert.deepEqual([r.actions, r.missing, r.candidates.map((c) => c.name), r.candidates[0].id], [[], 'which', ['Ferry Deal', 'Ferry Tolls'], byName('Ferry Deal').id]);
  r = P('Blade, tick Moonlight Job');
  assert.deepEqual([r.actions, r.missing, r.name], [[], 'clock', 'Moonlight Job']);
  assert.equal(P('Blade, tick Ferry Deal').actions[0].clock_name, 'Ferry Deal', 'an exact match beats a looser one');
  assert.equal(P('Blade, tick Ferry Deal').missing, null);
  const m = Cue.matchClock('tol', LIVE.clocks); assert.deepEqual(m, [], 'short words must match exactly');
  assert.equal(Cue.matchClock('ferry toll', LIVE.clocks).length, 0, 'four-letter words are not fuzzy: "toll" is not "tolls"');
});
await test('1e. "tick that / it": the clock Blade last made or ticked (live.lastClock), otherwise which with every clock', () => {
  let r = P('Blade, tick that', 'Salt Fog'); assert.deepEqual(r.actions.map((a) => [a.clock_name, a.by]), [['Salt Fog', 1]]);
  r = P('Blade, tick it twice', 'Escape'); assert.deepEqual(r.actions.map((a) => [a.clock_name, a.by]), [['Escape', 2]]);
  r = P('Blade, tick that'); assert.deepEqual([r.missing, r.candidates.length, r.actions], ['which', LIVE.clocks.length, []]);
  r = Cue.parse('Blade, tick that', { clocks: LIVE.clocks, lastClock: { id: 'gone' } }); assert.equal(r.missing, 'which', 'a last clock that is not on the table is which');
});
await test('1f. npc_add: named, with a look and a role; no name leaves name empty and needsName true', () => {
  let r = P('Blade, new NPC called Ruddock, who looks like a tall man, a bouncer');
  assert.deepEqual(r.actions.map((a) => [a.type, a.name, a.look, a.role, a.needsName]), [['npc_add', 'Ruddock', 'a tall man', 'bouncer', false]]);
  r = P('Blade, new NPC');
  assert.deepEqual(r.actions.map((a) => [a.name, a.needsName, a.look, a.role]), [['', true, '', '']]);
  assert.equal(P('Blade, new NPC called Ruddock, a bouncer').actions[0].role, 'bouncer');
  assert.equal(P('Blade, make an NPC named Ottilie Marsh').actions[0].name, 'Ottilie Marsh');
  assert.equal(P('Blade, new N P C called Ruddock').actions[0].type, 'npc_add');
});
await test('1g. capture: note is a moment, loose end a loose end, name a name', () => {
  const c = (s, b, t) => assert.deepEqual(P(s).actions.map((a) => [a.type, a.bucket, a.text]), [['capture', b, t]], s);
  c('Blade, note the guard turns at midnight', 'moment', 'the guard turns at midnight');
  c('Blade, loose end: who paid the porter', 'loose_end', 'who paid the porter');
  c('Blade, name: Hesper Quill, the new harbour clerk', 'name', 'Hesper Quill, the new harbour clerk');
  assert.equal(P('Blade, note').missing, 'text');
});
await test('1h. rename and undo are ordinary parsed actions with a quote and no key', () => {
  assert.deepEqual(P('Blade, call him Old Hettie').actions.map((a) => [a.type, a.name]), [['rename', 'Old Hettie']]);
  assert.deepEqual(P('Blade, rename that to Harbour Patrol').actions.map((a) => [a.type, a.name]), [['rename', 'Harbour Patrol']]);
  assert.equal(P('Blade, rename that').missing, 'name');
  for (const s of ['Blade, undo', 'Blade, undo that', 'Blade, scratch that', 'Blade, cancel']) assert.deepEqual(P(s).actions.map((a) => a.type), ['undo'], s);
  assert.equal(P('Blade, undo that').actions[0].quote, 'Blade, undo that');
  assert.equal(P('Blade, cancel the clock').refused, 'unparsed', 'cancel with an object is not an undo');
  assert.equal(shape('scratch that').none, true, 'scratch that needs the wake word');
  assert.equal(shape('cancel').none, true, 'cancel needs the wake word');
});

/* ---------- 2. refusals ---------- */
await test('2. refusals: show/reveal/put up, a sheet (stress, harm, xp, coin), anything it cannot parse', () => {
  for (const s of ['Blade, show the players the map', 'Blade, reveal the clock', 'Blade, put up the harbour map', 'Blade, tick Escape and show it']) { const r = P(s); assert.deepEqual([r.actions, r.refused], [[], 'show'], s); }
  for (const s of ['Blade, add two stress to Tansy', 'Blade, harm Ruddock', 'Blade, two xp for Tansy', 'Blade, add three coin']) { const r = P(s); assert.deepEqual([r.actions, r.refused], [[], 'sheet'], s); }
  for (const s of ['Blade, make sure they know', 'Blade, call the shots', 'Blade, new rule']) { const r = P(s); assert.deepEqual([r.actions, r.refused], [[], 'unparsed'], s); }
  assert.equal(P('Blade, note the stress on his face').actions[0].type, 'capture', 'a note may mention a sheet word: it files text, it changes no sheet');
});

/* ---------- 3. number words and mishearings ---------- */
await test('3a. number words: Deepgram hears to/too for 2, for for 4, sick for 6, ate for 8 (in a number slot only)', () => {
  assert.equal(P('Blade, make a sick segment clock called Night Ferry').actions[0].size, 6);
  assert.equal(P('Blade, make an ate segment clock called Night Ferry').actions[0].size, 8);
  assert.equal(P('Blade, make a for segment clock called Night Ferry').actions[0].size, 4);
  assert.equal(P('Blade, make a for clock called Night Ferry').actions[0].size, 4);
  assert.equal(P('Blade, mark to on Salt Fog').actions[0].by, 2);
  assert.equal(P('Blade, mark too on Escape').actions[0].by, 2);
  assert.equal(P('Blade, make a clock for Night Ferry with six segments').actions[0].name, 'Night Ferry', '"for" before a name is a marker, not a 4');
  assert.equal(P('Blade, make a six clock for Quiet Exit').actions[0].name, 'Quiet Exit');
  assert.equal(Cue.numOf('six'), 6); assert.equal(Cue.numOf('12'), 12); assert.equal(Cue.numOf('sick'), 6); assert.equal(Cue.numOf('escape'), null);
});
await test('3b. mishearings (Blades, Blaid, Blayed, Played, Blake, Blaine) count when a command word follows straight after', () => {
  for (const w of ['Blades,', 'Blaid,', 'Blayed', 'Played,', 'Blake,', 'Blaine', 'BLADES']) assert.equal(P(`${w} tick Escape two`).actions[0].by, 2, w);
  assert.equal(shape('Blades, the tick Escape').none, true, 'a mishearing with a word in between is not a cue');
  assert.equal(Cue.find('Blake, tick Salt Fog').word, 'Blake');
  assert.equal(P('Blade, can you tick Escape').actions[0].by, 1, 'can you / please / just are skipped');
  assert.equal(P('Blade, please just tick Escape').actions[0].by, 1);
});

/* ---------- 4. the clause rule and the wake word ---------- */
await test('4a. a clause start: line start, after . ? ! , ; or a filler (okay, ok, right, alright, hey, so, um, uh), or a new line', () => {
  for (const s of ['Blade, tick Escape', 'The guard looks nervous. Blade, tick Escape', 'Is it open? Blade, tick Escape', 'They run! Blade, tick Escape', 'Fine, Blade, tick Escape', 'Fine; Blade, tick Escape',
    'okay Blade tick Escape', 'ok blade tick Escape', 'right blade tick Escape', 'alright blade tick Escape', 'hey blade tick Escape', 'so blade tick Escape', 'um blade tick Escape', 'uh blade tick Escape', 'the door shuts\nblade tick Escape'])
    assert.equal(P(s).actions.length, 1, s);
  const f = Cue.find('The guard looks nervous. Blade, tick Escape'); assert.equal('The guard looks nervous. Blade, tick Escape'.slice(f.index), 'Blade, tick Escape', 'index is an offset into the original text');
});
await test('4b. never after the, a, an, my, his, her, their, your, that, this; a command word must come within three words', () => {
  for (const w of ['the', 'a', 'an', 'my', 'his', 'her', 'their', 'your', 'that', 'this']) assert.equal(shape(`${w} blade, tick Escape`).none, true, w + ' blade');
  assert.equal(shape('Blade, one two three tick Escape').none, true, 'the fourth word is too far');
  assert.equal(P('Blade, Ferry Tolls plus two').actions[0].by, 2, 'the third word is in reach');
  assert.equal(shape("Blade's name is Escape, make a note").none, true, 'a possessive is not a call');
});
await test('4c. decoys never fire (fixture decoys, 100%)', () => {
  const bad = FX.decoys.filter((d) => Cue.find(d) !== null);
  assert.deepEqual(bad, []);
  for (const d of ['the blade, make sure', 'blades in the dark', 'I played it safe']) assert.equal(Cue.find(d), null, d);
  assert.ok(FX.decoys.length >= 30);
});

/* ---------- 5. splits, pending, must-pass phrasings ---------- */
await test('5a. splits are parsed on the joined text (joinLines: one space), and the quote spans the join', () => {
  assert.equal(Cue.joinLines('Blade,  ', '  make a six'), 'Blade, make a six');
  assert.equal(Cue.joinLines('', 'x'), 'x'); assert.equal(Cue.joinLines('x', ''), 'x');
  for (const [a, b] of [['Blade,', 'make a six clock called escape'], ['Blade, make a six', 'clock called escape'], ['Blade, make a six clock', 'called escape']]) {
    const j = Cue.joinLines(a, b), r = P(j);
    assert.deepEqual(r.actions.map((x) => [x.type, x.name, x.size]), [['clock_add', 'Escape', 6]], j);
    assert.equal(r.actions[0].quote, j, 'the quote spans the join');
  }
  assert.equal(P(Cue.joinLines('Blade, make a six', 'clock called escape')).actions.length, 1);
  assert.equal(P('Blade, make a six').missing, 'more', 'the first half alone is not enough: the page waits for the next line');
  assert.equal(Cue.find('Blade, make a six').verb, 'make');
});
await test('5b. a bare "Blade," is pending (and only a wake word at a clause start, with no command word yet)', () => {
  for (const s of ['Blade,', 'Blade', 'blade.', 'okay Blade', 'so, blade,', 'That was close. Blade,', 'Blade, please', 'Blade, um', 'Blade, uh...', 'okay Blade, um, okay']) { const f = Cue.find(s); assert.ok(f && f.pending === true, s); assert.equal(f.verb, null); }
  assert.equal(Cue.find('Blade,').index, 0);
  assert.equal(Cue.find('Blade, tick').pending, undefined, 'a command word means a cue, not pending');
  assert.equal(Cue.find('the blade,'), null, 'after an article it is nothing');
  assert.equal(Cue.find('Blades,'), null, 'a mishearing on its own never arms');
  assert.equal(Cue.find('Played'), null);
  const r = P('Blade,'); assert.deepEqual([r.pending, r.actions, r.refused, r.missing], [true, [], null, null]);
});
await test('5c. Alex\'s two phrasings, in their shape (both must pass)', () => {
  let r = P('blade create a six segment clock called escape');
  assert.deepEqual(r.actions.map((a) => [a.type, a.name, a.size, a.hidden]), [['clock_add', 'Escape', 6, true]]);
  assert.equal(r.missing, null); assert.equal(r.refused, null);
  r = P('blade create and NPC who looks like tiny sailor');
  assert.deepEqual(r.actions.map((a) => [a.type, a.name, a.look, a.role, a.needsName]), [['npc_add', '', 'tiny sailor', '', true]]);
  assert.equal(r.missing, null); assert.equal(r.refused, null);
});

/* ---------- 6. the contract ---------- */
await test('6. every action carries quote (wake word to end of the text, as given) and no key', () => {
  const text = 'Okay. Blade, Make a SIX clock called escape!  ';
  const r = P(text); assert.equal(r.quote, 'Blade, Make a SIX clock called escape!');
  for (const s of ['Blade, make a six clock called Escape', 'Blade, tick Escape two', 'Blade, new NPC called Ruddock', 'Blade, note x y z', 'Blade, undo', 'Blade, call him Old Hettie', 'Okay, so Blade, tick it. And then more talk', 'blade create and NPC who looks like tiny sailor']) {
    const rr = P(s, 'Escape'); assert.ok(rr.actions.length === 1, s);
    const a = rr.actions[0], f = Cue.find(s);
    assert.equal(a.quote, s.slice(f.index).replace(/\s+$/, ''), s);
    assert.ok(!('key' in a) && !('mode' in a) && !('confidence' in a) && !('at' in a), 'cue.js never makes a key: ' + s);
    assert.ok(s.includes(a.quote), 'the quote is in the input');
  }
  assert.equal(P('nothing to see here').cue, null);
  assert.deepEqual(P('nothing to see here').actions, []);
});
await test('6a. the quote survives the real validator: validateActions (hands.js) drops none of them as "quote not in the talk"', async () => {
  const { validateActions } = await import(new URL('../../functions/_lib/assist/hands.js', import.meta.url));
  const state = { clocks: LIVE.clocks, npcs: [], pcs: [] };
  const cases = [
    ['Blade, make a six clock called Tide Watch and mark two', 'clock_add'], ['Blade, tick Escape two', 'clock_tick'], ['Blade, new NPC called Ruddock, a bouncer', 'npc_add'],
    ['Blade, note the guard turns at midnight', 'capture'], ['Blade, loose end: who paid the porter', 'capture'], ['okay. So Blade, mark two on Salt Fog. Then the guards turn.', 'clock_tick']];
  for (const [text, type] of cases) {
    const r = P(text); assert.equal(r.actions.length, 1, text);
    const v = validateActions(r.actions.map((a) => Object.assign({ confidence: 1 }, a)), { state, lines: [{ kind: 'line', text: 'earlier talk about the ferry' }, { kind: 'line', text }] });
    assert.deepEqual(v.dropped, [], text); assert.equal(v.actions.length, 1, text); assert.equal(v.actions[0].type, type);
    assert.ok(/^[a-z_]+:/.test(v.actions[0].key), 'the Worker makes the key');
  }
  /* a split command: two rows, the quote spans the join, and the validator reads the rows as one stretch of talk */
  const joined = Cue.joinLines('Blade, make a six', 'clock called escape'), r = P(joined);
  const v = validateActions(r.actions.map((a) => Object.assign({ confidence: 1 }, a)), { state, lines: [{ kind: 'line', text: 'Blade, make a six' }, { kind: 'line', text: 'clock called escape' }] });
  assert.deepEqual(v.dropped, []); assert.equal(v.actions[0].name, 'Escape');
});
await test('6b. UMD and pure: no DOM, no network, no storage; on the global in a browser', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'cue.js'), 'utf8');
  assert.ok(!/\b(?:document|window|fetch|localStorage|sessionStorage|XMLHttpRequest|Date\.now|setTimeout|innerHTML)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.ok(/root\.B68Cue\s*=\s*M/.test(src));
  assert.equal(typeof Cue._pure.parse, 'function');
  const live = { clocks: [{ id: 'a', name: 'Escape', size: 6, filled: 0 }] };
  const before = JSON.stringify(live); Cue.parse('Blade, tick Escape', live); assert.equal(JSON.stringify(live), before, 'live is not changed');
  assert.deepEqual(Cue.parse('Blade, tick Escape', null).missing, 'clock', 'no table is an answer, not a crash');
  assert.doesNotThrow(() => { Cue.parse(undefined, undefined); Cue.find(null); Cue.parse(42, {}); });
});

/* ---------- 7. the fixtures: exact parses ---------- */
function score(list, label, ci) {
  const bad = [];
  for (const f of list) if (!same(shape(textOf(f), f.last), f.e, ci)) bad.push(textOf(f) + '  =>  ' + JSON.stringify(shape(textOf(f), f.last)) + '  (want ' + JSON.stringify(f.e) + ')');
  const pct = 100 * (list.length - bad.length) / list.length;
  console.log(`     ${label}: ${list.length - bad.length}/${list.length} exact (${pct.toFixed(1)}%)`);
  if (bad.length) console.log('     misses:\n       ' + bad.join('\n       '));
  return pct;
}
await test('7a. plain fixtures: at least 95% exact (actions, missing, refused, candidates, pending)', () => {
  assert.ok(FX.plain.length >= 150, 'about 150 plain phrasings: ' + FX.plain.length);
  const pct = score(FX.plain, 'plain'); assert.ok(pct >= 95, pct + '%');
});
await test('7b. noisy fixtures (made with the local model, reviewed by hand): at least 85% exact', () => {
  assert.ok(FX.noisy.length >= 60, 'noisy count ' + FX.noisy.length);
  const pct = score(FX.noisy, "noisy", true); assert.ok(pct >= 85, pct + '%');
});
await test('7c. every command row is in the plain fixtures, and every refusal kind', () => {
  const kinds = new Set();
  for (const f of FX.plain) for (const a of f.e.a || []) { kinds.add(a.type); if (a.bucket) kinds.add('capture:' + a.bucket); }
  for (const k of ['clock_add', 'clock_tick', 'npc_add', 'capture', 'undo', 'rename', 'capture:moment', 'capture:loose_end', 'capture:name']) assert.ok(kinds.has(k), k);
  const ms = new Set(FX.plain.map((f) => f.e.m || f.e.r || (f.e.p && 'pending')).filter(Boolean));
  for (const k of ['which', 'clock', 'size', 'name', 'text', 'amount', 'more', 'show', 'sheet', 'unparsed', 'nochange', 'pending']) assert.ok(ms.has(k), k);
  assert.ok(FX.plain.some((f) => f.l), 'splits are in the fixtures');
  assert.ok(FX.noisy.every((f) => f.base !== undefined && f.e), 'every noisy line names its plain base and inherits its parse');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log('ALL PASSED');
