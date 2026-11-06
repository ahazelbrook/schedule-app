// Unit test for the Roll's drawing (the GM night rebuild, N4; app/gm/roll.js): the column's ids in order, one Position control and one Effect control as
// radios, the size line from the pack's own table, the stamp's states (Stamp it on the iPad; On the iPad with Take it down, Clean and Stamp again), the four
// keys, Focus's position, the sizer's strip and the quick tables, and every string escaped. Pure: no DOM, no network, invented text only.
//   node checks/runtime/gm-roll.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const R = require(path.join(ROOT, 'app', 'gm', 'roll.js'));
const C = require(path.join(ROOT, 'app', 'gm', 'console.js'));

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const ids = (h) => [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const POS = [
  { value: 'controlled', label: 'controlled', severity: 'mild', ticks: '1 tick', harm: '1 (lesser)' },
  { value: 'risky', label: 'risky', severity: 'middling', ticks: '2 ticks', harm: '2' },
  { value: 'desperate', label: 'desperate', severity: 'spicy', ticks: '3 ticks', harm: '3' }
];
const SITS = C.SITUATIONS;

test('shell: one block whose parts the page fills, in the design’s order (the Roll card, the result card, Blade, Scene, Earlier, More tables, the Focus keys)', () => {
  const h = R.shell();
  assert.deepEqual(ids(h), ['gm-rl', 'gm-rl-h', 'gm-pos', 'gm-pos-size', 'gm-eff', 'gm-c-threat', 'gm-line-note', 'gm-stamp', 'gm-they-l', 'gm-dots-l', 'gm-dots', 'gm-buttons',
    'gm-card', 'gm-rackf', 'gm-rack-sum', 'gm-rack', 'gm-scene', 'gm-scene-chips', 'gm-scenebox', 'gm-now-s', 'gm-controls', 'gm-earlier-b', 'gm-earlier-n', 'gm-singles-b', 'gm-earlier', 'gm-singles', 'gm-mini']);
  assert.match(h, /<textarea id="gm-c-threat" data-ctl="threat"[^>]*maxlength="100"/, 'the one line is the console’s threat control, at most 100 characters');
  assert.match(h, /<label class="gm-lab" for="gm-c-threat">If it goes wrong<\/label>/);
  assert.match(h, /id="gm-scenebox" hidden/); assert.match(h, /id="gm-earlier" hidden/); assert.match(h, /id="gm-singles" hidden/);
  assert.match(h, /data-gm="scene" aria-expanded="false" aria-controls="gm-scenebox"/);
  assert.match(h, /data-rlfold="earlier" aria-expanded="false" aria-controls="gm-earlier"/); assert.match(h, /data-rlfold="singles" aria-expanded="false" aria-controls="gm-singles"/);
  assert.ok(!/data-fold=/.test(h), 'never the location card’s remembered-fold attribute');
  assert.match(h, /<select data-now id="gm-now-s">/, 'Now in lives in the Scene fold');
  assert.match(h, /<div class="gm-rl-scene"><button[^>]*id="gm-scene"/, 'the Scene button sits in a div (a button as a grid item of the scroller collapses)');
});

test('Position: three radios, the current one checked, each titled with its size; the size line is the pack’s own words', () => {
  const h = R.posHtml(POS, 'risky');
  assert.equal((h.match(/role="radio"/g) || []).length, 3); assert.equal((h.match(/data-gm="pos"/g) || []).length, 3);
  assert.match(h, /aria-checked="true" data-gm="pos" data-v="risky"[^>]*>Risky</);
  assert.equal((h.match(/aria-checked="true"/g) || []).length, 1);
  assert.match(h, /title="Desperate: spicy · 3 ticks · harm 3"/);
  assert.equal(R.sizeLine(POS, 'controlled'), 'mild · 1 tick · harm 1 (lesser)');
  assert.equal(R.sizeLine(POS, 'nope'), ''); assert.equal(R.sizeLine(null, 'risky'), ''); assert.equal(R.posHtml(null, 'risky'), '');
  const con = C.create({ T: { severity: { controlled: ['mild', '1 tick', 'a', 1], risky: ['middling', '2 ticks', 'b', 2], desperate: ['spicy', '3 ticks', 'c', 3] }, scene: { fight: { label: 'Fight' } } } });
  assert.equal(R.sizeLine(con.positions, 'risky'), 'middling · 2 ticks · harm 2', 'the console’s own positions');
});

test('Effect: three radios, standard checked by default the page passes; Dots 0-4, none checked when unset', () => {
  const e = R.effHtml('standard');
  assert.equal((e.match(/data-gm="eff"/g) || []).length, 3); assert.match(e, /aria-checked="true" data-gm="eff" data-v="standard">Standard</);
  assert.equal((R.dotsHtml(null).match(/aria-checked="true"/g) || []).length, 0);
  assert.match(R.dotsHtml(2), /aria-checked="true" data-gm="dots" data-v="2"/); assert.match(R.dotsHtml(0), /aria-checked="true" data-gm="dots" data-v="0" aria-label="0 dots"/);
});

test('the stamp: Stamp it on the iPad when nothing is up; while up, On the iPad with Take it down (Esc) and Clean, and Stamp again only once what is set has changed', () => {
  assert.equal(R.stampHtml({ on: false }), '', 'no stamp: nothing');
  const idle = R.stampHtml({ on: true, active: null });
  assert.match(idle, /data-gm="stamp"[^>]*>Stamp it on the iPad</); assert.ok(!/Take it down/.test(idle));
  const up = R.stampHtml({ on: true, active: { position: 'risky', effect: 'great', text: 'x' }, stale: false });
  assert.match(up, /<b>On the iPad<\/b><span>Risky, great<\/span>/); assert.match(up, /data-gm="stamp-down"[^>]*>Take it down <kbd>Esc<\/kbd>/);
  assert.match(up, /data-gm="stamp-clean"[^>]*>Clean \(no card\)</); assert.ok(!/Stamp again/.test(up));
  const stale = R.stampHtml({ on: true, active: { position: 'risky', effect: 'great', text: 'x' }, stale: true });
  assert.match(stale, /<button type="button" class="btn primary gm-stampb" data-gm="stamp"[^>]*>Stamp again</, 'Stamp again is the one full-width button, as Stamp it on the iPad was');
  assert.match(stale, /Changed since it went up/);
  assert.match(stale, /<\/button><div class="gm-rl-acts"><button[^>]*data-gm="stamp-down"/, 'Take it down and Clean share the row under it');
  assert.ok(!/<div class="gm-rl-acts">[^]*data-gm="stamp"[^-]/.test(stale), 'and Stamp again is not in that row');
});

test('They rolled: the four keys (1-4) with their labels, each hint in its title; Focus shows the position, the effect and a stamp that is up', () => {
  const b = R.buttonsHtml(SITS);
  assert.equal((b.match(/class="gm-btn gm-sbtn"/g) || []).length, 4);
  assert.deepEqual([...b.matchAll(/<kbd>(\d)<\/kbd><b>([^<]+)<\/b>/g)].map((m) => m[1] + ' ' + m[2]), ['1 Before', '2 4/5', '3 1–3', '4 Someone']);
  assert.match(b, /data-sit="onetothree" title="they rolled 1-3/);
  const m = R.miniHtml(SITS, 'desperate', 'great', true);
  assert.match(m, /<p class="gm-mini-pos is-desp up"[^>]*><b>Desperate<\/b><small>great<\/small><small class="gm-mini-up">● iPad<\/small><\/p>/);
  assert.equal((m.match(/<button/g) || []).length, 4, 'the position is shown, not a fifth key');
  assert.ok(!/<p class="gm-mini-pos/.test(R.miniHtml(SITS, '', '', false)), 'no position: just the keys');
});

test('the sizer’s strip: full size for the stamped position (its words for the old checks), the stamped line unless the card shows it, the room’s other lines; no buttons of its own', () => {
  assert.equal(R.sizerHtml(null), '');
  const z = { stamped: 'risky', shown: 'risky', reduced: false, armed: false, canReduce: true, size: { severity: 'middling', ticks: '2 ticks', harm: '2' }, lines: ['Dov Kessler turns round.', 'A glass breaks'], text: 'Dov Kessler turns round.', result: '13' };
  const h = R.sizerHtml(z), text = h.replace(/<[^>]+>/g, '');
  assert.match(text, /Full size for risky · a 1–3/); assert.match(text, /middling · 2 ticks · harm 2/);
  assert.match(h, /If it goes wrong<\/span>Dov Kessler turns round\./); assert.match(h, /Or, from the room<\/span><ul><li>A glass breaks<\/li><\/ul>/, 'the stamped line is not listed twice');
  assert.ok(!/<button/.test(h), 'the strip holds no button: its Reduce and Hide size are on the card’s actions row');
  const shown = R.sizerHtml(z, { lineShown: true });
  assert.ok(!/Dov Kessler turns round/.test(shown) && /A glass breaks/.test(shown), 'the card’s lead shows the promised line already: the strip leaves it out, keeps the room’s other line');
  const red = R.sizerHtml(Object.assign({}, z, { reduced: true, shown: 'controlled', canReduce: false, size: { severity: 'mild', ticks: '1 tick', harm: '1 (lesser)' }, result: '45' })).replace(/<[^>]+>/g, '');
  assert.match(red, /Reduced to controlled \(stamped risky\) · a 4\/5/);
  const bare = R.sizerHtml(Object.assign({}, z, { lines: [], text: '', size: null, canReduce: false }));
  assert.match(bare, /No "If it goes wrong" line for this room\./); assert.match(bare, /The pack has no size for risky\./);
});

test('the strip’s buttons for the card’s actions row: Reduce in two taps, Restore once reduced, Hide size; nothing to reduce at the smallest', () => {
  const z = { stamped: 'risky', shown: 'risky', reduced: false, armed: false, canReduce: true, result: '13' };
  assert.equal(R.sizerActs(null), '');
  const a = R.sizerActs(z);
  assert.match(a, /data-gm="sz-reduce"[^>]*>Reduce</); assert.match(a, /data-gm="sz-done"[^>]*>Hide size</);
  assert.match(R.sizerActs(Object.assign({}, z, { armed: true })), /class="btn sm primary" data-gm="sz-reduce"[^>]*>Tap again to reduce</, 'armed: the second tap is the strong one');
  const red = R.sizerActs(Object.assign({}, z, { reduced: true, canReduce: false }));
  assert.match(red, /data-gm="sz-restore"[^>]*>Restore full size</); assert.ok(!/sz-reduce/.test(red));
  assert.ok(!/sz-reduce/.test(R.sizerActs(Object.assign({}, z, { canReduce: false }))), 'the smallest has nothing to reduce to');
});

test('every string the page hands over is escaped (a line full of markup stays text)', () => {
  const evil = '<img src=x onerror=alert(1)> "GM-ONLY-X" & co';
  const z = { stamped: 'risky', shown: 'risky', size: { severity: evil, ticks: '', harm: '' }, lines: [evil], text: evil, result: '45' };
  for (const h of [R.sizerHtml(z), R.lineNote(evil), R.posHtml([{ value: evil, label: evil, severity: evil }], ''), R.buttonsHtml([{ key: 1, id: evil, label: evil, hint: evil }]),
    R.miniHtml([{ key: 1, label: evil }], evil, evil, false), R.stampHtml({ on: true, active: { position: evil, effect: evil } })]) {
    assert.ok(!/<img/.test(h), h); assert.ok(/&lt;img/.test(h) || !/img/.test(h), h);
  }
  assert.equal(R.lineNote(''), ''); assert.equal(R.lineNote('Showroom'), 'From the room: Showroom');
});

test('the quick tables (each only where the card has no such section) and the Blade fold’s summary', () => {
  const q = R.quickActs();
  assert.match(q, /data-gm="qt" data-n="4"[^>]*>Pay the price</); assert.match(q, /data-gm="qt" data-n="7"[^>]*>Harm &amp; resist</);
  assert.ok(!/data-n="4"/.test(R.quickActs({ pay: false })) && /data-n="7"/.test(R.quickActs({ pay: false })), 'pay: false leaves Pay the price out');
  assert.equal(R.quickActs({ pay: false, harm: false }), '', 'a card with both sections offers neither');
  assert.equal(C.BUTTONS.find((b) => b.n === 4).id, 'payThePrice'); assert.equal(C.BUTTONS.find((b) => b.n === 7).id, 'harm', 'the numbers are the console’s own tables');
  assert.equal(R.rackSummary({ fitted: 'risky' }), 'fitted for risky'); assert.equal(R.rackSummary({ fitted: 'risky', pending: true, voice: 'Mabel Quist' }), 'fitting… · Voice: Mabel Quist');
  assert.equal(R.rackSummary(null), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
