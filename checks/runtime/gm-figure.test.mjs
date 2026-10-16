// Unit test for app/gm/figure-map.js (NPC fields -> figure kit v2 spec). Uses only the invented fixture
// checks/runtime/fixtures/gm/figure-map.json (generic words, made-up factions); no real table text.
//   node checks/runtime/gm-figure.test.mjs                       run the checks (a 100-seed sweep)
//   node checks/runtime/gm-figure.test.mjs --sweep=500           the full sweep (npm run check:sweep; or B68_SWEEP=500)
//   node checks/runtime/gm-figure.test.mjs --sheet <file.html>   also write a contact sheet of 24 portraits
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FM = require(path.join(ROOT, 'app', 'gm', 'figure-map.js'));
const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const Cast = require(path.join(ROOT, 'app', 'figures', 'cast.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'figure-map.json'), 'utf8'));
const F = fixture.F, W = fixture.words;

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------- invented NPCs ---------- */
const FIRST = ['Ada', 'Bram', 'Cora', 'Dell', 'Edda', 'Finn', 'Gus', 'Hana', 'Ivo', 'Jena', 'Kit', 'Lena', 'Milo', 'Nell', 'Oren', 'Pia'];
const FAMILY = ['Arden', 'Birch', 'Cobb', 'Dunmore', 'Everett', 'Fairley', 'Grange', 'Holt', 'Ives', 'Jessop', 'Keane', 'Lowe'];
const PROF = ['guard', 'trader', 'host', 'labourer', 'clerk', 'driver', 'server', 'runner', 'owner', 'seer', 'detective', 'activist', 'baker', 'welder'];
function mkNpc(seed) {
  const g = mulberry32(seed * 2654435761 >>> 0);
  const pick = (a) => a[Math.floor(g() * a.length)];
  const odd = (a) => g() < 0.08 ? 'zzq unlisted word' : pick(a);
  const npc = { name: pick(FIRST) + ' ' + pick(FAMILY), alias: g() < 0.5 ? 'the ' + pick(['Owl', 'Ghost', 'Penny']) : null };
  npc.isHull = g() < 0.08;
  npc.presentation = npc.isHull ? 'Hull' : pick(W.presentation);
  if (!npc.isHull) npc.heritage = odd(W.heritage);
  npc.profession = pick(PROF); npc.district = 'District ' + pick(['One', 'Two', 'Three']);
  if (g() < 0.7) { npc.faction = pick(W.faction); npc.rank = odd(W.rank); } else npc.faction = null;
  npc.quality = 1 + Math.floor(g() * 6);
  if (npc.isHull) { npc.chassis = pick(['boxy, rust', 'sleek, chrome', 'bulky, heavy']); npc.wears = pick(W.garment) + (g() < 0.67 ? '' : ', ' + pick(W.accessory)); }
  else {
    npc.build = odd(W.build); npc.featuresLook = odd(W.features); npc.hairLook = odd(W.hair); npc.mannerLook = odd(W.manner);
    npc.standout = odd(W.standout); npc.register = odd(W.register);
    npc.wears = odd(W.garment) + (g() < 0.33 ? '' : ', ' + odd(W.accessory));
  }
  return npc;
}
/* seeds in the sweep: 100 in npm test, 500 in check:sweep (--sweep=<n> or B68_SWEEP=<n>) */
const N = Math.max(24, Number((process.argv.find((a) => /^--sweep=\d+$/.test(a)) || '').slice(8) || process.env.B68_SWEEP) || 100);
const runs = [];
for (let s = 1; s <= N; s++) {
  const npc = mkNpc(s);
  const m = FM.map(npc, F, mulberry32(s), K);
  runs.push({ s, npc, m, w: FM.check(m.spec, K) });
}

/* ---------- tests ---------- */
await test('map() returns { spec, notes } with full identity and a numeric heightIn', () => {
  for (const { npc, m } of runs.slice(0, 60)) {
    const sp = m.spec;
    assert.ok(Array.isArray(m.notes));
    assert.match(sp.id, /^[a-z0-9-]+$/);
    assert.equal(sp.name, npc.name);
    if (!npc.isHull) assert.match(sp.plate, /^[A-Za-z]+ · [A-Z]\.$/, sp.plate);
    assert.match(sp.code, /^[A-Z]{2,3}-968-\d{4}$/);
    assert.ok(typeof sp.halo === 'string' && sp.halo.length > 0);
    assert.ok(Number.isFinite(sp.heightIn) && sp.heightIn >= 48 && sp.heightIn <= 90, 'heightIn ' + sp.heightIn);
    assert.ok(sp.outfit && (sp.outfit.dress || sp.outfit.bottom) && sp.outfit.feet);
  }
});

await test('halo and every colour are kit tokens; every part name is in K.options()', () => {
  const o = K.options(), tok = K.tokens;
  const isTok = (c) => /^#[0-9a-f]{6}$/i.test(c) || c in tok.CLOTH || c in tok.BRAND || c in tok.MATTER;
  const kindOf = { base: 'top', mid: 'mid', outer: 'outer', neck: 'neckwear', bottom: 'bottom', dress: 'dress', legs: 'legwear', feet: 'footwear', waist: 'belt', hands: 'gloves' };
  for (const { m } of runs) {
    const sp = m.spec;
    assert.ok(isTok(sp.halo), 'halo ' + sp.halo);
    for (const [slot, p] of Object.entries(sp.outfit)) {
      assert.ok(o[kindOf[slot]].includes(p.type), slot + ' ' + p.type);
      assert.ok(isTok(p.color), slot + ' colour ' + p.color);
      if (p.pattern) assert.ok(o.textile.includes(p.pattern.type));
    }
    assert.ok(o.hair.includes(sp.hair.style));
    if (sp.hair.hat) assert.ok(o.hat.includes(sp.hair.hat.type) && isTok(sp.hair.hat.color));
    assert.ok(isTok(sp.hair.color));
    for (const p of sp.props) assert.ok(o.prop.includes(p.type));
    assert.ok(o.skins.includes(sp.skin));
    assert.ok(sp.shape in o.shapes);
  }
});

await test('100% determinism: same inputs and seed give the same spec and notes', () => {
  for (const { s, npc, m } of runs.slice(0, 120)) {
    const again = FM.map(clone(npc), clone(F), mulberry32(s), K);
    assert.deepEqual(again, m);
  }
});

await test('exactly 64 rng draws per call, whatever F and the NPC hold', () => {
  const counts = new Set();
  for (const s of [1, 2, 3, 77, 400]) for (const FF of [F, {}, { defaults: {} }]) {
    let n = 0; const g = mulberry32(s);
    FM.map(mkNpc(s), FF, () => { n++; return g(); }, K);
    counts.add(n);
  }
  FM.map({}, F, () => { counts.add('x'); return 0.5; }, K);
  counts.delete('x');
  assert.deepEqual([...counts], [64]);
});

await test('a different seed changes the result (the rng is really used)', () => {
  const npc = mkNpc(9);
  const a = FM.map(npc, F, mulberry32(1), K).spec, b = FM.map(npc, F, mulberry32(2), K).spec, c = FM.map(npc, F, mulberry32(3), K).spec;
  assert.ok(JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(b) !== JSON.stringify(c));
});

await test('before any retry at least 95% render and portrait with no warnings (' + N + ' seeds)', () => {
  const clean = runs.filter((r) => r.w.length === 0).length;
  console.log('   clean on first map: ' + clean + '/' + N);
  if (clean < N) console.log('   first warnings: ' + runs.filter((r) => r.w.length).slice(0, 4).map((r) => r.s + ': ' + r.w[0].slice(0, 110)).join(' | '));
  assert.ok(clean / N >= 0.95, 'clean ' + clean + '/' + N);
});

await test('after dropping props, pattern, hat, eyewear (3 tries) every spec is clean, no fallback needed', () => {
  let counts = [0, 0, 0, 0];
  for (const r of runs) {
    let w = r.w, level = 0;
    while (w.length && level < 3) { level++; w = FM.check(FM.strip(r.m.spec, level), K); }
    assert.equal(w.length, 0, 'seed ' + r.s + ' still warns: ' + w[0]);
    counts[level]++;
  }
  console.log('   cleared at level 0/1/2/3: ' + counts.join('/'));
});

await test('fit() runs the whole ladder and agrees with map() when clean', () => {
  for (const r of runs.slice(0, 40)) {
    const f = FM.fit(r.npc, F, mulberry32(r.s), K, Cast);
    assert.equal(f.warnings.length, 0);
    assert.equal(f.fallback, false);
    if (r.w.length === 0) { assert.equal(f.tries, 0); assert.deepEqual(f.spec, r.m.spec); }
  }
});

await test('strip() levels remove props, then pattern, then hat and eyewear, without mutating the input', () => {
  const sp = { outfit: { outer: { type: 'blazer', color: 'cloth-navy', pattern: { type: 'check' } } }, props: [{ type: 'cane' }], hair: { style: 'short', hat: { type: 'trilby', color: 'cloth-black' } }, face: { eyewear: { type: 'shades' } } };
  const copy = clone(sp);
  assert.deepEqual(FM.strip(sp, 1).props, []);
  assert.ok(FM.strip(sp, 1).outfit.outer.pattern);
  assert.equal(FM.strip(sp, 2).outfit.outer.pattern, undefined);
  assert.ok(FM.strip(sp, 2).hair.hat);
  const s3 = FM.strip(sp, 3);
  assert.equal(s3.hair.hat, undefined); assert.equal(s3.face.eyewear, undefined);
  assert.deepEqual(sp, copy);
});

await test('unknown words fall through to defaults with notes and never throw', () => {
  const npc = { name: 'Quinn Rook', presentation: 'qqq', heritage: 'zzz', faction: 'Nowhere Club', rank: 'a nobody', build: 'qwx', featuresLook: 'wibble', hairLook: 'fnord', mannerLook: 'blorp', standout: 'quux', register: 'xyzzy', wears: 'a thing, another thing' };
  const m = FM.map(npc, F, mulberry32(5), K);
  const notes = m.notes.join('\n');
  for (const t of ['presentation', 'heritage', 'faction', 'build', 'features', 'hair', 'manner', 'standout', 'register', 'garment', 'accessory']) assert.ok(notes.includes('no match: ' + t), 'note for ' + t + '\n' + notes);
  assert.equal(FM.check(m.spec, K).length, 0);
  assert.ok(m.spec.heightIn > 0);
  // nothing at all, junk F, no kit, null rng
  for (const args of [[{}, F, mulberry32(1), K], [{}, {}, mulberry32(1), K], [null, null, null, null], [{ name: 5, faction: {}, wears: [] }, 'junk', 'nope', {}], [undefined, undefined, undefined, undefined]]) {
    const r = FM.map(...args);
    assert.ok(r && r.spec && Array.isArray(r.notes));
  }
  assert.equal(FM.check(FM.map({}, {}, mulberry32(1), K).spec, K).length, 0);
});

await test('invalid part names and colours in F are dropped with notes, and the spec still renders clean', () => {
  const bad = clone(F);
  bad.garment['heavy coat'] = { outer: ['not-a-coat', { type: 'also-bad' }], base: { type: 'tee', color: 'hot-pink' }, hat: 'no-such-hat', props: ['laser-gun', 'cane'] };
  bad.hair['short crop'] = { style: 'not-a-style', facialHair: 'not-a-beard' };
  bad.faction['Faction B'].palette = ['cloth-nonexistent', 'cloth-oxblood'];
  bad.faction['Faction B'].halo = 'nope-500';
  bad.standout['round glasses'] = { eyewear: 'monocle', marks: ['warts'] };
  const npc = { name: 'Ward Plum', presentation: 'masculine', heritage: 'Lineage One', faction: 'Faction B', rank: 'lieutenant', build: 'Broad', featuresLook: 'stern', hairLook: 'a short crop', mannerLook: 'calm', standout: 'round glasses', register: 'Plain', wears: 'a heavy coat' };
  const m = FM.map(npc, bad, mulberry32(11), K);
  const n = m.notes.join('\n');
  for (const x of ['not-a-coat', 'no-such-hat', 'laser-gun', 'not-a-style', 'monocle', 'warts', 'cloth-nonexistent', 'nope-500', 'hot-pink']) assert.ok(n.includes(x), 'note for ' + x + '\n' + n);
  assert.equal(FM.check(m.spec, K).length, 0);
  assert.equal(m.spec.halo, 'ink-500');
  assert.ok(!m.spec.props.some((p) => p.type === 'laser-gun'));
});

await test('lookup: exact key, then match list, then substring, then keyword; longest key wins', () => {
  const t = { broad: { a: 1 }, 'broad shouldered': { a: 2 }, stout: { a: 3, match: ['stocky', 'thickset'] }, _skip: { a: 9 } };
  assert.equal(FM.parts.lookup(t, 'Broad').entry.a, 1);
  assert.equal(FM.parts.lookup(t, 'stocky').entry.a, 3);
  assert.equal(FM.parts.lookup(t, 'very broad shouldered man').entry.a, 2);
  assert.equal(FM.parts.lookup(t, 'a thickset fellow').entry.a, 3);
  assert.equal(FM.parts.lookup(t, 'skip'), null);
  assert.equal(FM.parts.lookup(t, 'nothing'), null);
});

await test('wears splits into garment and accessory; plate and code are deterministic', () => {
  assert.deepEqual(FM.parts.splitWears({ wears: 'a heavy coat, a flat cap' }), { garment: 'a heavy coat', accessory: 'a flat cap' });
  assert.deepEqual(FM.parts.splitWears({ wears: 'overalls' }), { garment: 'overalls', accessory: '' });
  assert.deepEqual(FM.parts.splitWears({ garment: 'g', accessory: 'a', wears: 'x, y' }), { garment: 'g', accessory: 'a' });
  assert.equal(FM.parts.plateFor({ name: 'Mara Quill' }), 'Quill · M.');
  assert.equal(FM.parts.plateFor({ name: 'Solo' }), 'Solo');
  assert.equal(FM.parts.codeFor({ name: 'Mara Quill', faction: 'x' }, 'ab'), FM.parts.codeFor({ name: 'Mara Quill', faction: 'x' }, 'ab'));
  assert.match(FM.parts.codeFor({ name: 'Mara Quill' }, ''), /^NPC-968-\d{4}$/);
});

await test('props only appear when F lists them, and a prop that needs a hand gets one', () => {
  const none = clone(F); delete none.standout; delete none.accessory; delete none.garment; none.faction['Faction C'].props = [];
  for (const r of runs.slice(0, 120)) {
    const m = FM.map(r.npc, none, mulberry32(r.s), K);
    assert.equal(m.spec.props.length, 0, 'seed ' + r.s);
  }
  const withCane = runs.find((r) => r.m.spec.props.some((p) => p.type === 'cane'));
  assert.ok(withCane, 'some cane in ' + N + ' runs');
  const a = withCane.m.spec.pose.arms;
  assert.ok(a.R === 'carry' || a.L === 'carry');
  const withBook = runs.find((r) => r.m.spec.props.some((p) => p.type === 'book'));
  assert.ok(withBook && ['R', 'L'].includes(withBook.m.spec.props.find((p) => p.type === 'book').side));
});

await test('faction palette and halo carry through; a fem figure under a fem-only faction rule gets the dress', () => {
  const r = runs.find((x) => x.npc.faction === 'Faction D' && x.m.spec.figure === 'fem' && !x.npc.isHull);
  assert.ok(r, 'a Faction D fem figure exists');
  assert.equal(r.m.spec.halo, 'swing-500');
  assert.ok(r.m.spec.outfit.dress || r.m.spec.outfit.bottom);
  const a = runs.find((x) => x.npc.faction === 'Faction A');
  assert.equal(a.m.spec.halo, 'file-500');
  assert.match(a.m.spec.code, /^FAA-968-\d{4}$/);
  if (a.m.spec.hair.hat) assert.equal(a.m.spec.hair.hat.type, 'peaked-cap');
});

await test('rank sets the age band; heritage sets the skin', () => {
  for (const r of runs) {
    if (r.npc.rank === 'a made name inside') assert.ok(r.m.spec.age >= 48 && r.m.spec.age <= 72, 'age ' + r.m.spec.age);
    if (r.npc.rank === 'a hanger-on of') assert.ok(r.m.spec.age >= 17 && r.m.spec.age <= 30, 'age ' + r.m.spec.age);
    if (r.npc.heritage === 'Lineage Three') assert.ok(['brown', 'deep', 'ebony'].includes(r.m.spec.skin));
  }
});

await test('build words steer shape and height band', () => {
  for (const r of runs) {
    if (r.npc.isHull) continue;
    if (/^Tall$/i.test(r.npc.build)) assert.ok(r.m.spec.heightIn >= 73 && ['lanky', 'lean'].includes(r.m.spec.shape));
    if (/^Compact$/i.test(r.npc.build)) assert.ok(r.m.spec.heightIn <= 65);
  }
});

await test('facial hair is dropped on a fem figure, with a note', () => {
  const r = runs.find((x) => x.m.spec.figure === 'fem' && /beard|moustache/.test(x.npc.hairLook || ''));
  assert.ok(r);
  assert.equal(r.m.spec.face.facialHair, undefined);
  assert.ok(r.m.notes.some((n) => /facial hair/.test(n)));
});

await test('Hulls are drawn as human figures with a note', () => {
  const hulls = runs.filter((r) => r.npc.isHull);
  assert.ok(hulls.length > N / 50, hulls.length + ' Hulls in ' + N + ' seeds');   /* about 8% of them */
  for (const h of hulls) assert.ok(h.m.notes.some((n) => /Hull/.test(n)));
});

await test('variety: at least 12 visibly different results (shape x height band x hair x garment)', () => {
  const sig = (sp) => [sp.shape, Math.floor(sp.heightIn / 4), sp.hair.style, Object.entries(sp.outfit).filter(([k]) => ['outer', 'dress', 'base', 'mid'].includes(k)).map(([k, v]) => k + ':' + v.type).join('+')].join('|');
  const all = new Set(runs.map((r) => sig(r.m.spec)));
  const first24 = new Set(runs.slice(0, 24).map((r) => sig(r.m.spec)));
  const shapes = new Set(runs.map((r) => r.m.spec.shape)), hairs = new Set(runs.map((r) => r.m.spec.hair.style));
  console.log('   distinct looks: ' + all.size + ' of ' + N + '; first 24: ' + first24.size + '; shapes ' + shapes.size + '; hair styles ' + hairs.size);
  assert.ok(all.size >= 12 && first24.size >= 12);
  assert.ok(shapes.size >= 7 && hairs.size >= 10);
});

await test('fallbackArchetype: every archetype choice is clean, copied (not shared) and renamed', () => {
  let n = 0;
  for (const r of runs) {
    const before = JSON.stringify(Cast.npcs);
    const sp = FM.fallbackArchetype(r.npc, K, Cast, F);
    assert.equal(sp.name, r.npc.name);
    assert.equal(sp.id, FM.parts.idFor(r.npc));
    assert.equal(sp.plate, FM.parts.plateFor(r.npc));
    assert.match(sp.code, /-968-\d{4}$/);
    assert.equal(JSON.stringify(Cast.npcs), before, 'Cast mutated');
    assert.equal(sp.notes, undefined);
    assert.equal(FM.check(sp, K).length, 0, 'seed ' + r.s);
    n++;
  }
  // the archetype is also reachable with no F at all
  assert.equal(FM.check(FM.fallbackArchetype({ name: 'Plain Jane', presentation: 'feminine' }, K, Cast), K).length, 0);
  assert.equal(FM.fallbackArchetype({ name: 'No Cast' }, K, null).name, 'No Cast');
  // each of the 12 archetypes is clean as-is
  for (const a of Cast.npcs) assert.equal(FM.check(a, K).length, 0, a.id);
});

await test('fallbackArchetype matches by F keywords, then by presentation, then by shape', () => {
  assert.equal(FM.fallbackArchetype({ name: 'A B', presentation: 'masculine', profession: 'a trader of goods' }, K, Cast, F).archetype, 'Criminal');
  const fem = FM.fallbackArchetype({ name: 'C D', presentation: 'feminine', profession: 'baker' }, K, Cast, F);
  assert.equal(fem.figure, 'fem');
  const masc = FM.fallbackArchetype({ name: 'E F', presentation: 'masculine', profession: 'baker' }, K, Cast, F);
  assert.notEqual(masc.figure, 'fem');
  assert.equal(FM.fallbackArchetype({ name: 'G H', presentation: 'masculine', build: 'Tall', profession: 'baker' }, K, Cast, F).shape, 'lanky');
});

await test('fit() falls back to an archetype when nothing else clears the warnings', () => {
  const brokenK = Object.assign({}, K, { render: (spec, o) => ({ warnings: spec.id === 'ok' || spec.name === 'Fallback Fred' ? [] : ['always warns'] }), portrait: () => ({ warnings: [] }) });
  const f = FM.fit({ name: 'Fallback Fred', presentation: 'masculine' }, F, mulberry32(3), brokenK, Cast);
  assert.equal(f.fallback, false); // name is special-cased clean, so no fallback
  const g = FM.fit({ name: 'Other Person', presentation: 'masculine' }, F, mulberry32(3), brokenK, Cast);
  assert.equal(g.tries, 3);
  assert.equal(g.fallback, true);
  assert.ok(g.notes.some((n) => /fell back/.test(n)));
  assert.equal(g.spec.name, 'Other Person');
});

await test('the public file holds no long string literals and names no setting or faction', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'figure-map.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const line of code.split(/\r?\n/)) for (const m of line.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)) assert.ok(m[0].length <= 222, 'long literal: ' + m[0].slice(0, 40));
  for (const bad of ['Doskvol', 'Duskwall', 'Limmerfield', 'Blueraker', 'Blackthorn']) assert.ok(!src.includes(bad), bad);
});

/* ---------- optional contact sheet ---------- */
const si = process.argv.indexOf('--sheet');
if (si > 0 && process.argv[si + 1]) {
  const pick = runs.slice(0, 24);
  const cell = ({ s, npc, m }) => {
    const p = K.portrait(m.spec);
    const sp = m.spec;
    const cap = [sp.name + (npc.isHull ? ' (Hull)' : ''), sp.figure || 'masc', sp.shape + ' · ' + sp.heightIn + 'in · ' + sp.age, sp.hair.style + (sp.hair.hat ? ' + ' + sp.hair.hat.type : '') + (sp.face.facialHair ? ' + ' + sp.face.facialHair.type : ''), Object.values(sp.outfit).map((x) => x.type).join(', '), (npc.faction || 'no faction') + ' · seed ' + s];
    return '<figure>' + p.svg.replace(/<svg /, '<svg style="width:100%;height:auto" ') + '<figcaption>' + cap.map((c, i) => i === 0 ? '<b>' + c + '</b>' : c).join('<br>') + '</figcaption></figure>';
  };
  const html = '<!doctype html><meta charset="utf-8"><title>Figure map contact sheet (invented data)</title><style>body{font:12px system-ui;background:#222;color:#ddd;margin:16px}h1{font-size:16px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}figure{margin:0;background:#2d2d2d;padding:6px;border-radius:4px}figcaption{padding:4px 2px;line-height:1.4}</style><h1>Figure map: 24 portraits from the invented fixture (seeds 1-24)</h1><div class="g">' + pick.map(cell).join('') + '</div>';
  fs.writeFileSync(process.argv[si + 1], html);
  console.log('contact sheet written: ' + process.argv[si + 1]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
