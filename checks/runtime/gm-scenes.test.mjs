// Unit test for app/gm/scenes.js (the district street-scene roller port) and buildScenes() in scripts/gm-pack.mjs.
// Committed tests use only the invented fixtures checks/runtime/fixtures/gm/scenes-page.md (a made-up vault page in the real
// page's shape) and scenes-pack.json (what the exporter makes of it). When a real pack with a `scenes` part is available
// (gm-private/b68-gm-pack.json, or the file named by B68_SCENES_PACK) the sweeps also run on the real tables; nothing from
// the real pack is printed, only counts.
//   node checks/runtime/gm-scenes.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, 'app', 'gm', 'scenes.js'));
const Pack = await import(pathToFileURL(path.join(ROOT, 'scripts', 'gm-pack.mjs')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const read = (f) => fs.readFileSync(f, 'utf8');
const FX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const T = JSON.parse(read(path.join(FX, 'scenes-pack.json'))).parts.scenes.T;
const PAGE = read(path.join(FX, 'scenes-page.md'));

let REAL = null;
for (const f of [process.env.B68_SCENES_PACK, path.join(ROOT, 'gm-private', 'b68-gm-pack.json')].filter(Boolean)) {
  if (!fs.existsSync(f)) continue;
  try { const p = JSON.parse(read(f)); if (p.parts && p.parts.scenes && p.parts.scenes.T) { REAL = p.parts.scenes.T; break; } } catch (e) { /* not a pack */ }
}

// every string literal of a JS source (comments skipped, escapes honoured)
function stringLiterals(src) {
  const out = [];
  const NL = String.fromCharCode(10), BS = String.fromCharCode(92), SQ = String.fromCharCode(39), DQ = String.fromCharCode(34);
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; }
    else if (c === "/" && src[i + 1] === "/") { const e = src.indexOf(NL, i); i = e < 0 ? src.length : e; }
    else if (c === SQ || c === DQ) {
      let j = i + 1, v = "";
      while (j < src.length && src[j] !== c && src[j] !== NL) { if (src[j] === BS) { v += src[j + 1]; j += 2; } else v += src[j++]; }
      out.push(v); i = j + 1;
    } else i++;
  }
  return out;
}
const seedOf = (i) => (Math.imul(i + 1, 2654435761) ^ 0x1234567) >>> 0;
const BAD = /\bundefined\b|\bNaN\b|\[object|%F%|\$\{/;
const cardText = (r) => r.lines.map((l) => (l.md || '') + (l.rows || []).map((x) => x.k + x.md).join('') + (l.chips || []).join('')).join('\n') + r.meta.all.join('\n');

function checkRoll(r, label, tables) {
  const o = r.scene;
  assert.ok(!BAD.test(cardText(r) + JSON.stringify(o)), label + ': bad token');
  assert.deepEqual(r.lines.map((l) => l.id), ['look', 'build', 'beats', 'chips', 'scene'], label + ': line ids');
  const keys = Object.keys(tables.weather);
  assert.ok(keys.includes(o.timeOfDay) && tables.weather[o.timeOfDay].includes(o.weather), label + ': weather belongs to the time of day');
  assert.ok(o.d.named.includes(o.street), label + ': street is one of the district\'s');
  assert.ok(o.d.landmarks.includes(o.landmark), label + ': landmark is the district\'s');
  assert.ok(o.d.notables.some((n) => n[0] === o.who[0]), label + ': who is the district\'s');
  assert.equal(o.beats.length, Math.min(2, o.d.scene.length), label + ': beats');
  assert.equal(r.meta.chips.length, 4, label + ': four ratings');
  r.meta.chips.forEach((c, i) => assert.ok(c.startsWith(tables.ratingLabels[i] + ' ' + o.d.r[i]), label + ': rating ' + i));
  const grid = r.lines.find((l) => l.id === 'scene').rows.map((x) => x.k);
  assert.deepEqual(grid.slice(0, 5), ['Landmark', "Who's out", 'In the way', 'Word out', 'Factions'], label + ': rows');
  assert.equal(grid.includes('Rule here'), !!o.d.special, label + ': Rule here only when the district has a special');
  assert.ok(Number.isInteger(r.seed) && r.seed >= 0, label + ': seed');
  assert.equal(r.meta.id, 'scenes'); assert.equal(r.replay.id, 'scenes');
}

for (const [name, tables] of [['fixture', T], ['real', REAL]]) {
  if (!tables) { console.log('SKIP real tables: no pack with a scenes part'); continue; }
  const sc = S.create({ T: tables });

  await test(name + ': 400 rolls anywhere are clean, complete and cover every district', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) { const r = sc.roll({ sel: '' }, { seed: seedOf(i), mem: {} }); checkRoll(r, name + ' #' + i, tables); seen.add(r.scene.d.n); }
    assert.equal(seen.size, sc.districts.length, 'every district came up');
  });

  await test(name + ': a chosen district is honoured, and an unknown one means anywhere', () => {
    for (const n of sc.districts) for (let i = 0; i < 6; i++) {
      const r = sc.roll({ sel: n }, { seed: seedOf(i), mem: {} });
      assert.equal(r.scene.d.n, n); checkRoll(r, n, tables);
    }
    const r = sc.roll({ sel: 'Nowhere At All' }, { seed: 1, mem: {} });
    assert.ok(sc.districts.includes(r.scene.d.n));
  });

  await test(name + ': the same { seed, mem, ui } gives the same scene; replay.mem is a copy from before the roll', () => {
    const mem = {};
    for (let i = 0; i < 8; i++) {
      const before = clone(mem);
      const a = sc.roll({ sel: i % 2 ? sc.districts[0] : '' }, { seed: seedOf(i), mem });
      assert.deepEqual(a.replay.mem, before, 'replay.mem is the memory as it was before');
      const b = sc.replay(a.replay);
      assert.deepEqual(clone(b.scene), clone(a.scene)); assert.deepEqual(b.lines, a.lines);
      const c = sc.roll({ sel: a.replay.ui.sel }, { seed: a.seed, mem: clone(a.replay.mem) });
      assert.deepEqual(c.lines, a.lines);
    }
  });

  await test(name + ': the repeat-guard holds across a JSON-cloned memory (notables included)', () => {
    const d = tables.district.filter((x) => x.notables.length > 1)[0];
    let mem = {}, last = null;
    for (let i = 0; i < 12; i++) {
      const r = sc.roll({ sel: d.n }, { seed: seedOf(i), mem });
      mem = clone(mem);                                        // what a sticky replay does between rolls
      if (last) assert.notEqual(r.scene.who[0], last, 'the notable repeated at roll ' + i);
      last = r.scene.who[0];
    }
  });

  await test(name + ': the instance keeps its own memory between rolls when none is passed', () => {
    const one = S.create({ T: tables });
    one.roll({ sel: '' }, { seed: 3 });
    assert.ok(Object.keys(one.mem()).length > 0);
  });
}

await test('controls: a district select with "anywhere" first; defaults; create() refuses a missing T', () => {
  const sc = S.create({ T });
  assert.equal(sc.controls.length, 1);
  assert.deepEqual(sc.controls[0].options[0], { label: 'anywhere', value: '' });
  assert.equal(sc.controls[0].options.length, T.district.length + 1);
  assert.deepEqual(sc.defaults(), { sel: '' });
  assert.throws(() => S.create({}), /scenes\.T/);
  assert.throws(() => S.create({ T: { district: [] } }), /scenes\.T/);
});

await test('card text: the read-aloud and the grid read like the vault (a worked fixture roll)', () => {
  const sc = S.create({ T });
  const r = sc.roll({ sel: 'Cobb Hill' }, { seed: 77, mem: {} });
  const o = r.scene;
  assert.equal(r.lines[0].md, `${o.timeOfDay}, ${o.weather}. Wide and swept. You're just off ${o.street}, in ${o.streetType.charAt(0).toLowerCase() + o.streetType.slice(1)}.`);
  assert.equal(r.lines[1].md, `Tall houses with iron gates. Next door, ${o.neighbour}.`);
  assert.equal(r.lines[2].md, `${o.beats.join(' ')} ${o.sound.charAt(0).toUpperCase() + o.sound.slice(1)}, ${o.smell}.`);
  assert.deepEqual(r.meta.chips, ['Wealth Very high', 'Security Very high', 'Criminal Low', 'Paranormal Moderate']);
  assert.equal(r.meta.title, 'Cobb Hill');
  assert.equal(r.meta.sub, `${o.timeOfDay} · ${o.street} · p.3`);
  assert.equal(r.meta.label, 'Cobb Hill · ' + o.street);
  const g = r.lines.find((l) => l.id === 'scene').rows;
  assert.equal(g[0].md, `**${o.landmark}** — *p.3*`);
  assert.equal(g[1].md, `**Sir Marl** *(Pompous, Lonely)* — Owns half the lamps.`);
  assert.equal(g[5].k, 'Rule here');
  assert.ok(r.meta.all.every((x) => !/\*\*|\*/.test(x)), 'plain lines carry no markdown');
});

// ---- B8 (the generator review, 16/10/2026): check(T) names what a pack is missing or has empty -------------------------
await test('B8: check(T) names every key a pack is missing or has empty; the fixture is complete', () => {
  assert.deepEqual(S.check(T), [], 'the fixture is complete');
  if (REAL) assert.deepEqual(S.check(REAL), [], 'the real pack is complete');
  assert.deepEqual(S.check(undefined), ['T']);
  for (const k of Object.keys(T)) {
    const del = clone(T); delete del[k];
    assert.ok(S.check(del).includes(k), 'delete ' + k + ': ' + JSON.stringify(S.check(del)));
    const emp = clone(T); emp[k] = Array.isArray(T[k]) ? [] : {};
    assert.ok(S.check(emp).includes(k), 'empty ' + k + ': ' + JSON.stringify(S.check(emp)));
  }
  const d = T.district[1].n, times = Object.keys(T.weather);
  const U = clone(T); U.district[1].notables = [['Only a name']]; delete U.district[1].streets; U.district[1].r = ['High']; U.weather[times[1]] = [];
  delete U.district[0].special;                                   // a district rule is optional
  assert.deepEqual(S.check(U), ['district.' + d + '.r', 'district.' + d + '.streets', 'district.' + d + '.notables', 'weather.' + times[1]]);
  // a complete pack rolls clean cards; check() is what the page shows before a sparse one fails
  const sc = S.create({ T });
  for (let i = 0; i < 20; i++) checkRoll(sc.roll({ sel: '' }, { seed: seedOf(i), mem: {} }), 'complete #' + i, T);
});

// ---- Byte-identity (the generator review, 16/10/2026): the scene is the vault's roll; the fixes never change it. These
// digests were taken from scenes.js at 7fce4b9 (anywhere and each district, 100 seeds each, then a 200-roll run sharing
// one memory). Change them only with the fixture.
const SCN_DIGEST = '400 525ffee17f90db69a24a9ceda2ec33c0792132dd8a40ea548a5f361cdb637903';
await test('byte-identity: roll() over the fixture hashes to the digest taken before the review fixes', () => {
  const h = createHash('sha256');
  const sc = S.create({ T }), sels = [''].concat(T.district.map(d => d.n));
  let n = 0;
  for (const sel of sels) for (let s = 0; s < 100; s++) { h.update(JSON.stringify(sc.roll({ sel }, { seed: (s * 2654435761) >>> 0, mem: {} })) + '\n'); n++; }
  const mem = {};
  for (let i = 0; i < 200; i++) h.update(JSON.stringify(sc.roll({ sel: sels[i % sels.length] }, { seed: i * 13 + 1, mem })) + '\n');
  h.update(JSON.stringify(mem));
  assert.equal(n + ' ' + h.digest('hex'), SCN_DIGEST, 'the rolls changed');
});

// ---- the port against the invented vault page, run as the vault runs it (node:vm, one seeded Math.random) -------------
function vaultRunner(block) {
  // the one deliberate difference (see the header of scenes.js): the notable guard is keyed by name in the port
  const patched = block.replace('fresh("notable-" + d.n, d.notables)', 'fresh("notable-" + d.n, d.notables, x => x[0])');
  assert.notEqual(patched, block, 'the notable call was found to patch');
  const ctx = vm.createContext({ dv: {}, document: {}, localStorage: { getItem: () => null, setItem() {} }, console });
  vm.runInContext('(function(){\n' + patched + '\nglobalThis.__set = (f) => { __rng = f; }; globalThis.__gen = generate; globalThis.__MEM = MEM; globalThis.__T = T; globalThis.__ratings = ratings;\n})()', ctx);
  return ctx;
}
await test('parity with the invented vault page: 300 rolls, every field and the memory after, identical', () => {
  const block = PAGE.match(/```dataviewjs\r?\n([\s\S]*?)\r?\n```/)[1];
  const ctx = vaultRunner(block);
  const sc = S.create({ T });
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const seed = seedOf(i), sel = i % 3 ? '' : T.district[i % T.district.length].n;
    // a warm memory from a few earlier rolls, JSON-cloned between rolls like a sticky replay
    const mem = {}; if (i % 5) { sc.roll({ sel: '' }, { seed: seedOf(i + 1000), mem }); sc.roll({ sel: '' }, { seed: seedOf(i + 2000), mem }); }
    const warm = clone(mem);
    for (const k of Object.keys(ctx.__MEM)) delete ctx.__MEM[k];
    Object.assign(ctx.__MEM, clone(warm));
    ctx.__set(S.seedRng(seed));
    const forced = sel ? ctx.__T.district.find((x) => x.n === sel) : null;
    const v = ctx.__gen(forced);
    const r = sc.roll({ sel }, { seed, mem: clone(warm) });
    assert.deepEqual(clone(r.scene), clone(v), 'scene #' + i);
    const memAfter = clone(warm); sc.roll({ sel }, { seed, mem: memAfter });
    assert.deepEqual(memAfter, clone(ctx.__MEM), 'memory #' + i);
    n++;
  }
  assert.equal(n, 300);
});

// ---- the exporter, on invented pages ------------------------------------------------------------------------------------
await test('exporter: the scenes part from an invented page, and the checks that stop a drifting vault page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-scenes-'));
  try {
    const tools = path.join(dir, 'Wiki', 'Games', 'Blades in the Dark', 'Tools');
    fs.mkdirSync(tools, { recursive: true });
    const file = path.join(tools, 'blades-68-district-scenes.md');
    fs.writeFileSync(file, PAGE);
    const part = Pack.buildScenes(dir, '2026-10-15T00:00:00.000Z');
    assert.deepEqual(part.T.ratingLabels, ['Wealth', 'Security', 'Criminal', 'Paranormal']);
    assert.equal(part.T.district.length, 3); assert.deepEqual(Object.keys(part.T.weather), ['Bluetime', 'Night']);
    assert.ok(!('pick' in part.T) && !('MEM' in part.T), 'tables are cut at the Machinery marker');
    assert.equal(part.src.file, 'Wiki/Games/Blades in the Dark/Tools/blades-68-district-scenes.md');
    const must = (mut, re) => { fs.writeFileSync(file, mut(PAGE)); assert.throws(() => Pack.buildScenes(dir, 'x'), re); };
    must((p) => p.replace('oneIn(2) ? "Bluetime" : "Night"', 'oneIn(2) ? "Night" : "Bluetime"'), /timeOfDay rule/);
    must((p) => p.replace('oneIn(2) ? "Bluetime" : "Night"', 'oneIn(2) ? "Bluetime" : "Dusk"'), /timeOfDay rule/);
    must((p) => p.replace('.replace("%F%", fresh("faction", T.faction))', ''), /%F%/);
    must((p) => p.replace('streets: "Wet stone and tied-up boats.",', ''), /Alder Quay.*incomplete/);
    must((p) => p.replace('r: ["Low", "High", "High", "Low"]', 'r: ["Low", "High", "High"]'), /Brindle Row.*incomplete/);
    must((p) => p.replace('`Criminal ${r[2]}`, `Paranormal ${r[3]}`', '`Paranormal ${r[3]}`, `Criminal ${r[2]}`'), /ratings\(\) entry 2/);
    must((p) => p.replace('// --- Machinery', '// --- Gears'), /Machinery/);
    must((p) => p.replace('T.streetSound = [', 'T.streetSound = []; T.unused = ['), /streetSound/);
    must((p) => p.replace('function ratings(o) {', 'function ratingz(o) {'), /ratings\(\) not found/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

await test('the public file names no table text and holds no long string literal', () => {
  const src = read(path.join(ROOT, 'app', 'gm', 'scenes.js'));
  const lits = stringLiterals(src).filter((x) => x.length >= 40 && !/cfg.T/.test(x));   // the one error message names the pack part
  assert.deepEqual(lits, [], 'no long string literals');
  for (const d of T.district) assert.ok(!src.includes(d.n) && !src.includes(d.landmarks[0]), 'no fixture table text in the module');
  if (REAL) for (const d of REAL.district) assert.ok(!src.includes(d.n), 'no real district name in the module');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
