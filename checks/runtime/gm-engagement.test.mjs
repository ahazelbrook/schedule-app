// Unit test for app/gm/engagement.js (the engagement roll port) and buildEngagement() in scripts/gm-pack.mjs.
// Committed tests use only the invented fixtures checks/runtime/fixtures/gm/engagement-page.md (a made-up vault page in the
// real page's shape) and scenes-pack.json (what the exporter makes of it). When a real pack with an `engagement` part is
// available (gm-private/b68-gm-pack.json, or the file named by B68_ENGAGEMENT_PACK) the sweeps also run on the real tables;
// nothing from the real pack is printed, only counts.
//   node checks/runtime/gm-engagement.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const E = require(path.join(ROOT, 'app', 'gm', 'engagement.js'));
const Pack = await import(pathToFileURL(path.join(ROOT, 'scripts', 'gm-pack.mjs')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const read = (f) => fs.readFileSync(f, 'utf8');
const FX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const T = JSON.parse(read(path.join(FX, 'scenes-pack.json'))).parts.engagement.T;
const PAGE = read(path.join(FX, 'engagement-page.md'));

let REAL = null;
for (const f of [process.env.B68_ENGAGEMENT_PACK, path.join(ROOT, 'gm-private', 'b68-gm-pack.json')].filter(Boolean)) {
  if (!fs.existsSync(f)) continue;
  try { const p = JSON.parse(read(f)); if (p.parts && p.parts.engagement && p.parts.engagement.T) { REAL = p.parts.engagement.T; break; } } catch (e) { /* not a pack */ }
}
const seedOf = (i) => (Math.imul(i + 1, 2654435761) ^ 0x1234567) >>> 0;
const BAD = /\bundefined\b|\bNaN\b|\[object|\$\{/;

// every combination of the three-way factors, as ui.mods
function allMods(T) {
  let out = [{}];
  for (const f of T.factor) out = [].concat(...out.map((m) => [-1, 0, 1].map((v) => Object.assign({}, m, { [f.id]: v }))));
  return out;
}

for (const [name, tables] of [['fixture', T], ['real', REAL]]) {
  if (!tables) { console.log('SKIP real tables: no pack with an engagement part'); continue; }
  const en = E.create({ T: tables });

  await test(name + ': the pool is 1d plus the sum of the mods, for every combination', () => {
    for (const mods of allMods(tables)) {
      const sum = Object.values(mods).reduce((a, b) => a + b, 0);
      assert.equal(en.pool({ mods }), 1 + sum);
      assert.equal(en.roll({ mods }, { seed: 1 }).pool, 1 + sum);
    }
    assert.equal(en.pool({}), 1);
  });

  await test(name + ': every approach x loadout x mods rolls a clean card whose position follows the dice', () => {
    let n = 0;
    for (const app of tables.approach) for (const ld of tables.loadout) for (const mods of allMods(tables)) {
      const r = en.roll({ approach: app[0], load: ld.value, mods }, { seed: seedOf(n++) });
      const text = r.lines.map((l) => (l.md || '') + (l.rows || []).map((x) => x.k + x.md).join('')).join('\n') + r.meta.all.join('\n');
      assert.ok(!BAD.test(text), 'bad token');
      assert.equal(r.meta.title, app[0] + ' — ' + r.pool + 'd');
      assert.ok(r.meta.sub.includes(app[1]) && r.meta.sub.includes(ld.value + ' loadout, load ' + ld.load) && r.meta.sub.includes(tables.cite));
      assert.deepEqual(r.lines.map((l) => l.id), ['mods', 'result', 'roll', 'cut']);
      assert.equal(r.lines[3].md, tables.cut);
      const o = tables.outcome;
      const want = r.crit ? o.crit : r.best === 6 ? o.six : r.best >= 4 ? o.risky : o.desperate;
      assert.equal(r.position, want.pos); assert.equal(r.lines[1].md, '**' + want.pos + '**  \n' + want.how);
      assert.equal(r.dice.length, r.pool <= 0 ? 2 : r.pool);
      assert.equal(r.zero, r.pool <= 0);
      assert.equal(r.best, r.zero ? Math.min(...r.dice) : Math.max(...r.dice));
      assert.equal(r.crit, !r.zero && r.dice.filter((d) => d === 6).length >= 2);
      assert.ok(r.dice.every((d) => d >= 1 && d <= 6 && Number.isInteger(d)));
      assert.equal(r.lines[2].rows[0].md, r.zero ? '0d — rolled 2, kept the lowest: [' + r.dice.join(' ') + '] → **' + r.best + '**' : '[' + r.dice.join(' ') + '] → **' + (r.crit ? 'critical' : r.best) + '**');
    }
    assert.ok(n >= 12);
  });

  await test(name + ': the mods line names each active factor with its own +/- wording', () => {
    const f = tables.factor[0];
    const plus = en.card({ mods: { [f.id]: 1 } }).lines[0].md, minus = en.card({ mods: { [f.id]: -1 } }).lines[0].md, none = en.card({}).lines[0].md;
    assert.equal(plus, '1d base · **+1d** ' + f.plus.toLowerCase());
    assert.equal(minus, '1d base · **−1d** ' + f.minus.toLowerCase());
    assert.equal(none, '1d base · no modifiers');
  });

  await test(name + ': a seed replays the dice; replay.ui is the resolved controls; other seeds differ', () => {
    const ui = { approach: tables.approach[tables.approach.length - 1][0], load: tables.loadout[1].value, mods: { [tables.factor[0].id]: 1, [tables.factor[1].id]: 1 } };
    const a = en.roll(ui, { seed: 12345 });
    assert.deepEqual(a.replay, { id: 'engagement', seed: 12345, mem: {}, ui: { approach: ui.approach, load: ui.load, mods: Object.assign({}, ...tables.factor.map((f) => ({ [f.id]: ui.mods[f.id] || 0 }))) } });
    const b = en.replay(clone(a.replay));
    assert.deepEqual(b.dice, a.dice); assert.deepEqual(b.lines, a.lines);
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(en.roll(ui, { seed: seedOf(i) }).dice.join());
    assert.ok(seen.size > 10, 'seeds give different dice');
  });

  await test(name + ': unknown controls fall back to the first approach and loadout; odd mods clamp to -1/0/+1', () => {
    const r = en.roll({ approach: 'Nonsense', load: 'Nonsense', mods: { [tables.factor[0].id]: 5, [tables.factor[1].id]: 'x' } }, { seed: 1 });
    assert.equal(r.replay.ui.approach, tables.approach[0][0]); assert.equal(r.replay.ui.load, tables.loadout[0].value);
    assert.equal(r.replay.ui.mods[tables.factor[0].id], 1); assert.equal(r.replay.ui.mods[tables.factor[1].id], 0);
  });

  await test(name + ': the dice are fair-ish: critical about 1 in 36 on 2d, a 0d pool is the lowest of two', () => {
    let crit = 0, low = 0, N = 20000;
    for (let i = 0; i < N; i++) {
      const r = E.rollPool(2, E.seedRng(seedOf(i)));
      if (r.crit) crit++;
      const z = E.rollPool(0, E.seedRng(seedOf(i + N)));
      if (z.best <= 3) low++;
    }
    assert.ok(Math.abs(crit / N - 1 / 36) < 0.008, 'crit rate ' + crit / N);
    assert.ok(Math.abs(low / N - 0.75) < 0.02, '0d low rate ' + low / N);   // lowest of two is 1-3 three times in four
  });
}

await test('card(): the preview before a roll', () => {
  const en = E.create({ T });
  const c = en.card({ approach: 'Slip', load: 'Loud', mods: { tier: -1 } });
  assert.equal(c.pool, 0);
  assert.deepEqual(c.lines.map((l) => l.id), ['mods', 'set']);
  assert.equal(c.lines[1].md, 'Set the factors, then roll.');
  assert.equal(c.meta.title, 'Slip — 0d');
  assert.equal(c.meta.sub, "opening gambit is the unwatched door · Loud loadout, load 6 · '68 p.1–2");
});

await test('controls: approach and loadout selects, then one tri control per factor; defaults; create() refuses a missing T', () => {
  const en = E.create({ T });
  assert.deepEqual(en.controls.map((c) => c.id + ':' + c.type), ['approach:select', 'load:select', 'bold:tri', 'tier:tri']);
  assert.deepEqual(en.controls[1].options, [{ label: 'Quiet — load 3', value: 'Quiet' }, { label: 'Loud — load 6', value: 'Loud' }]);
  assert.deepEqual(en.defaults(), { approach: 'Smash', load: 'Quiet', mods: { bold: 0, tier: 0 } });
  assert.throws(() => E.create({}), /engagement\.T/);
});

// ---- the port against the invented vault page, run as the vault runs it (node:vm, a seeded Math.random) -------------------
await test('parity with the invented vault page: roll() and outcome() agree for pools -4..8 over 200 seeds', () => {
  const block = PAGE.match(/```dataviewjs\r?\n([\s\S]*?)\r?\n```/)[1];
  const ctx = vm.createContext({ dv: {}, console });
  vm.runInContext('(function(){\n' + block.split('const wrap')[0] + '\nglobalThis.__roll = roll; globalThis.__outcome = outcome;\n})()', ctx);
  const en = E.create({ T });
  for (let pool = -4; pool <= 8; pool++) for (let i = 0; i < 200; i++) {
    const seed = seedOf(i * 31 + pool + 10);
    const rng = E.seedRng(seed);
    vm.runInContext('Math.random = undefined', ctx);
    ctx.__next = rng;
    vm.runInContext('Math.random = () => __next()', ctx);
    const v = ctx.__roll(pool);
    const mine = E.rollPool(pool, E.seedRng(seed));
    assert.deepEqual(clone(mine), clone(v), 'roll pool ' + pool);
    const [pos, how] = ctx.__outcome(v);
    const o = E.outcomeOf(T, mine);
    assert.equal(o.pos, pos); assert.equal(o.how, how);
  }
});

// ---- the exporter, on invented pages -----------------------------------------------------------------------------------
await test('exporter: the engagement part from an invented page, and the checks that stop a drifting vault page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-engage-'));
  try {
    const tools = path.join(dir, 'Wiki', 'Games', 'Blades in the Dark', 'Tools');
    fs.mkdirSync(tools, { recursive: true });
    const file = path.join(tools, 'blades-68-engagement-roll.md');
    fs.writeFileSync(file, PAGE);
    const part = Pack.buildEngagement(dir, '2026-10-15T00:00:00.000Z');
    assert.deepEqual(part.T.approach.map((a) => a[0]), ['Smash', 'Charm', 'Slip']);
    assert.deepEqual(part.T.loadout, [{ value: 'Quiet', label: 'Quiet — load 3', load: 3 }, { value: 'Loud', label: 'Loud — load 6', load: 6 }]);
    assert.deepEqual(Object.keys(part.T.outcome), ['crit', 'six', 'risky', 'desperate']);
    assert.equal(part.T.outcome.risky.pos, 'Level');
    assert.equal(part.T.cut, 'Now **cut to the middle of it** — and ask someone what they are doing about it.');
    assert.equal(part.T.cite, "'68 p.1–2");
    assert.ok(!('d6' in part.T) && !('roll' in part.T), 'tables are cut at the Machinery marker');
    const must = (mut, re) => { fs.writeFileSync(file, mut(PAGE)); assert.throws(() => Pack.buildEngagement(dir, 'x'), re); };
    must((p) => p.replace('if (r.best >= 4) return', 'if (r.best >= 5) return'), /splits 4 and 5|splits 1-3/);
    must((p) => p.replace('if (r.best === 6) return ["Ahead"', 'if (r.best === 5) return ["Ahead"'), /does not distinguish|splits|groups/);
    must((p) => p.replace('loadSel.value === "Quiet" ? 3 : 6', 'loadSel.value === "Quiet" ? 3 : 7'), /disagrees with the rule/);
    must((p) => p.replace('loadSel.value === "Quiet"', 'loadSel.value === "Loud"'), /load rule does not match/);
    must((p) => p.replace(/loadSel\.createEl\("option", \{ text: "Loud[^\n]*\n/, ''), /load rule does not match the two/);
    must((p) => p.replace("· '68 p.1–2", '· p.1–2'), /page reference/);
    must((p) => p.replace('"what they are doing about it."', 'what'), /closing line/);
    must((p) => p.replace('function outcome(r) {', 'function outcomes(r) {'), /outcome\(\) not found/);
    must((p) => p.replace('["Smash",  "the weak hinge"],', '["Smash"],'), /T\.approach/);
    must((p) => p.replace('{ id: "tier",', '{ idd: "tier",'), /T\.factor/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// B8 (the generator review, 16/10/2026): check(T) names what a pack is missing or has empty
await test('B8: check(T) names every key a pack is missing or has empty; the fixture is complete', () => {
  assert.deepEqual(E.check(T), [], 'the fixture is complete');
  if (REAL) assert.deepEqual(E.check(REAL), [], 'the real pack is complete');
  assert.deepEqual(E.check(null), ['T']);
  for (const k of Object.keys(T)) {
    const del = clone(T); delete del[k];
    assert.ok(E.check(del).includes(k), 'delete ' + k + ': ' + JSON.stringify(E.check(del)));
  }
  const U = clone(T); U.outcome.six = { pos: 'Ahead' }; U.factor[1] = { id: 'tier', plus: 'x' }; U.approach.push(['Lonely']); U.cut = '';
  assert.deepEqual(E.check(U), ['approach', 'factor', 'outcome.six', 'cut']);
  const V = clone(T); V.loadout = []; V.outcome = {};
  assert.deepEqual(E.check(V), ['loadout', 'outcome.crit', 'outcome.six', 'outcome.risky', 'outcome.desperate']);
});

await test('the public file holds no table text and no long string literal', () => {
  const src = read(path.join(ROOT, 'app', 'gm', 'engagement.js'));
  const NL = String.fromCharCode(10), BS = String.fromCharCode(92), SQ = String.fromCharCode(39), DQ = String.fromCharCode(34);
  const lits = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; }
    else if (c === '/' && src[i + 1] === '/') { const e = src.indexOf(NL, i); i = e < 0 ? src.length : e; }
    else if (c === SQ || c === DQ) {
      let j = i + 1, v = '';
      while (j < src.length && src[j] !== c && src[j] !== NL) { if (src[j] === BS) { v += src[j + 1]; j += 2; } else v += src[j++]; }
      lits.push(v); i = j + 1;
    } else i++;
  }
  assert.deepEqual(lits.filter((x) => x.length >= 40 && !/cfg.T/.test(x)), [], 'no long string literals');
  for (const a of T.approach) assert.ok(!src.includes(a[1]), 'no fixture gambit in the module');
  if (REAL) {
    for (const a of REAL.approach) assert.ok(!src.includes(a[1]) && !src.includes(a[0]), 'no real approach in the module');
    for (const f of REAL.factor) assert.ok(!src.includes(f.plus) && !src.includes(f.minus), 'no real factor in the module');
    for (const o of Object.values(REAL.outcome)) assert.ok(!src.includes(o.pos) && !src.includes(o.how), 'no real outcome text in the module');
    assert.ok(!src.includes(REAL.cut), 'no real closing line in the module');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
