// Unit test for app/gm/npc.js (the NPC generator port) and the npc part of scripts/gm-pack.mjs.
// Committed tests use only the invented fixture checks/runtime/fixtures/gm/npc-pack.json. When a real pack with an `npc`
// part is available (gm-private/b68-gm-pack.json, or the file named by B68_NPC_PACK), the same sweeps also run on the real
// tables; nothing from the real pack is printed, only counts.
//   node checks/runtime/gm-npc.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const N = require(path.join(ROOT, 'app', 'gm', 'npc.js'));
const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const CAST = require(path.join(ROOT, 'app', 'figures', 'cast.js'));
const Pack = await import(pathToFileURL(path.join(ROOT, 'scripts', 'gm-pack.mjs')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const read = (f) => fs.readFileSync(f, 'utf8');

const fixture = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'npc-pack.json')));
const FIX = { T: fixture.parts.npc.T, cast: fixture.parts.npc.cast, F: fixture.parts.npc.F, campaign: fixture.parts.campaign };

let REAL = null;
{
  const cands = [process.env.B68_NPC_PACK, path.join(ROOT, 'gm-private', 'b68-gm-pack.json')].filter(Boolean);
  for (const f of cands) {
    if (!fs.existsSync(f)) continue;
    try {
      const p = JSON.parse(read(f));
      if (p.parts && p.parts.npc && p.parts.npc.T) { REAL = { T: p.parts.npc.T, cast: p.parts.npc.cast, F: p.parts.npc.F, campaign: p.parts.campaign || {} }; break; }
    } catch (e) { /* not a pack */ }
  }
}

const seedOf = (i) => (Math.imul(i + 1, 2654435761) ^ 0x1234567) >>> 0;
const BAD = /\bundefined\b|\bNaN\b|\[object|\{v\}|\$\{/;

function cardText(card) {
  return card.lines.map((l) => (l.md || '') + (l.rows || []).map((r) => r.k + r.md).join('') + (l.chips || []).join('')).join('\n') + card.meta.all.join('\n');
}
function checkRoll(r, label) {
  const o = r.npc;
  const text = cardText(r.card) + JSON.stringify(o);
  assert.ok(!/\bnull\b/.test(cardText(r.card)), label + ': null in the card');
  assert.ok(!BAD.test(text), label + ': bad token in ' + (text.match(BAD) || [])[0]);
  assert.ok(Number.isInteger(r.seed) && r.seed >= 0, label + ': seed');
  assert.ok(o.name && o.profession && o.district && o.goal && o.errand && o.quirk && o.attitude, label + ': core fields');
  assert.ok(o.quality >= 1 && o.quality <= 6, label + ': quality');
  const ids = r.card.lines.map((l) => l.id);
  for (const id of ['look', 'traits', 'want', 'play', 'chips', 'levers']) assert.ok(ids.includes(id), label + ': card section ' + id);
  const play = r.card.lines.find((l) => l.id === 'play').rows.map((x) => x.k);
  assert.deepEqual(play.slice(-3), ['Dial', 'Mannerism', 'Verb'], label + ': play rows');
  const lev = r.card.lines.find((l) => l.id === 'levers').rows.map((x) => x.k);
  if (o.isHull) { assert.ok(lev.includes('Memory') && !lev.includes('Key') && !lev.includes('Vice'), label + ': Hull levers'); assert.ok(r.card.meta.figureNote, label + ': Hull note'); assert.equal(o.presentation, 'Hull'); }
  else { assert.ok(lev.includes('Key') && lev.includes('Vice') && lev.includes('Roots') && lev.includes('Trouble') && lev.includes('Quirk'), label + ': levers'); assert.ok(!r.card.meta.figureNote); }
  if (o.leverage) assert.equal(lev[0], 'Leverage', label + ': leverage first');
  assert.ok(o.faction ? (typeof o.factionTier === 'number' && o.rank) : (o.factionTier === undefined), label + ': faction fields');
  assert.equal(r.card.meta.title, o.alias ? o.name + ' — "' + o.alias + '"' : o.name);
}

/* ---------- the generator ---------- */
for (const [label, pk] of [['fixture', FIX], ['real', REAL]]) {
  if (!pk) { console.log('SKIP ' + label + ' pack sweeps: no real pack with an npc part (gm-private/ or B68_NPC_PACK)'); continue; }
  const count = label === 'real' ? 500 : 300;

  await test(label + ': ' + count + ' seeds roll without throwing; cards hold every section', () => {
    const g = N.create(pk);
    let hulls = 0, factions = 0, cast = 0;
    for (let i = 0; i < count; i++) {
      const r = g.roll({ seed: seedOf(i) });
      checkRoll(r, label + ' #' + i);
      if (r.npc.isHull) hulls++;
      if (r.npc.faction) factions++;
      if (r.npc.cast) cast++;
    }
    assert.ok(hulls > 0 && hulls < count / 4, 'hull share ' + hulls + '/' + count);
    assert.ok(factions > count / 3, 'faction share');
    if (pk.cast.length) assert.equal(cast, count, 'every NPC has a cast anchor when the pack has a cast');
  });

  await test(label + ': exact replay, including the repeat-guard memory', () => {
    const g = N.create(pk);
    const mem = {};
    for (let i = 0; i < 40; i++) g.roll({ seed: seedOf(1000 + i), mem });          // warm the guard
    for (let i = 0; i < count; i++) {
      const r = g.roll({ seed: seedOf(i), mem });
      assert.deepEqual(r.replay.seed, r.seed);
      const again = N.create(pk).roll({ seed: r.replay.seed, mem: clone(r.replay.mem) });
      assert.deepEqual(again.npc, r.npc, 'npc #' + i);
      assert.deepEqual(again.card, r.card, 'card #' + i);
      assert.deepEqual(again.replay.mem, r.replay.mem, 'replay mem #' + i);
    }
    // the instance memory is the default and is mutated; a roll without mem moves it
    const g2 = N.create(pk); const before = clone(g2.mem());
    g2.roll({ seed: 1 });
    assert.notDeepEqual(g2.mem(), before);
    // stateEntry replays
    const r = g2.roll({ seed: 77 });
    const st = g2.stateEntry(r, { at: '2026-10-14T00:00:00.000Z', s: 3 });
    assert.deepEqual(Object.keys(st).sort(), ['at', 'mem', 's', 'seed']);
    assert.deepEqual(N.create(pk).roll({ seed: st.seed, mem: clone(st.mem) }).npc, r.npc);
  });

  await test(label + ': the repeat guard stops back-to-back repeats of a small pool', () => {
    const g = N.create(pk);
    let same = 0, prev = null;
    for (let i = 0; i < 200; i++) { const r = g.roll({ seed: seedOf(i) }); if (prev && r.npc.errand === prev) same++; prev = r.npc.errand; }
    assert.equal(same, 0, 'errand repeated back to back');
  });

  await test(label + ': initials in play and cast anchors already taken come from the campaign', () => {
    const camp = pk.campaign;
    const initials = new Set();
    (camp.pcs || []).forEach((p) => initials.add(String(p.file || p.name).replace(/^The\s+/i, '').charAt(0).toUpperCase()));
    (camp.npcs || []).forEach((n) => { if (n.playedBy) initials.add(String(n.name).replace(/^The\s+/i, '').charAt(0).toUpperCase()); });
    const g = N.create(pk);
    let named = 0, clash = 0;
    const takenBy = {};
    (camp.npcs || []).forEach((n) => { if (n.playedBy && n.faction) (takenBy[n.faction] = takenBy[n.faction] || []).push(n.playedBy); });
    for (let i = 0; i < count; i++) {
      const o = g.roll({ seed: seedOf(i) }).npc;
      if (!o.isHull) { named++; if (initials.has(o.name.charAt(0).toUpperCase())) clash++; }
      if (o.faction && takenBy[o.faction] && o.cast && pk.cast.length > takenBy[o.faction].length) assert.ok(!takenBy[o.faction].includes(o.cast.n), 'anchor already taken in ' + 'that faction');
    }
    assert.ok(clash / named < 0.05, 'initial clashes ' + clash + '/' + named);
    // with the campaign swapped for an empty one the clashes come back
    const g2 = N.create(Object.assign({}, pk, { campaign: {} }));
    let clash2 = 0, named2 = 0;
    for (let i = 0; i < count; i++) { const o = g2.roll({ seed: seedOf(i) }).npc; if (!o.isHull) { named2++; if (initials.has(o.name.charAt(0).toUpperCase())) clash2++; } }
    assert.ok(clash2 / named2 > clash / named, 'an empty campaign should clash more');
  });
}

await test('leverage shapes are data and fill from the rolled card', () => {
  const g = N.create(FIX);
  let seen = 0;
  for (let i = 0; i < 300; i++) {
    const r = g.roll({ seed: seedOf(i) });
    if (!r.npc.leverage) continue;
    seen++;
    assert.ok(!r.npc.leverage.includes('{v}'));
    const shape = FIX.T.leverage.find((s) => N.applyLeverage(s, r.npc[s.f]) === r.npc.leverage);
    assert.ok(shape, 'leverage text is some shape applied to a rolled field');
  }
  assert.ok(seen > 200);
  assert.equal(N.applyLeverage({ t: 'A {v} B', lower: true, head: true }, 'Mixed Case — Tail'), 'A mixed case B');
  assert.equal(N.applyLeverage({ t: '{v}!' }, 'a$&b'), 'a$&b!');
});

await test('noteBody, dossier, castDoc and the cast record', () => {
  const g = N.create(FIX);
  let withFaction = null, withoutDossier = null, hull = null, plain = null;
  for (let i = 0; i < 400 && !(withFaction && withoutDossier && hull && plain); i++) {
    const r = g.roll({ seed: seedOf(i) });
    const o = r.npc;
    if (o.isHull) hull = hull || r;
    else if (o.faction && FIX.T.factionDetail[o.faction]) withFaction = withFaction || r;
    else if (o.faction) withoutDossier = withoutDossier || r;
    else plain = plain || r;
  }
  for (const r of [withFaction, withoutDossier, hull, plain]) assert.ok(r, 'sample NPCs of every kind');
  const o = withFaction.npc;
  const note = g.noteBody(o, { date: '14/10/2026' });
  assert.ok(note.startsWith('---\nwiki: entity\ncreated: 14/10/2026\nupdated: 14/10/2026\nquality: ' + o.quality + '\ndistrict: ' + o.district + '\nfaction: ' + o.faction + '\nattitude: ' + o.attitude + '\nplayed_by: ' + o.cast.n + '\ncampaign: group\ntags:\n  - wiki/games\n  - wiki/blades-in-the-dark\n  - wiki/npc\n---\n# '));
  for (const h of ['> [!quote] At a glance', '> [!example] How to play', '## Say it out loud', '## Levers', "## What they're said to be", '## In play']) assert.ok(note.includes(h), h);
  assert.ok(note.includes('- **Cast** **' + o.cast.n + '**'));
  assert.ok(!note.includes('![['));
  const withEmbed = g.noteBody(o, { date: '14/10/2026', embed: '![[Figure.svg|160]]' });
  assert.ok(withEmbed.includes('*' + N.role(o) + '*\n\n![[Figure.svg|160]]\n\n> [!quote]'));
  assert.equal(withEmbed.replace('![[Figure.svg|160]]\n\n', ''), note);
  assert.ok(plain.npc.cast && g.noteBody(plain.npc, { date: '14/10/2026' }).includes('faction:\n'));
  assert.ok(g.noteBody(hull.npc, { date: '14/10/2026' }).includes('- **Memory** — A fragment'));
  assert.ok(/^\d\d\/\d\d\/\d{4}$/.test(g.noteBody(o).match(/created: (.*)/)[1]), 'default date is DD/MM/YYYY');

  const d = g.dossier(o, { date: '14/10/2026' });
  assert.equal(d.slug, N.facSlug(o.faction));
  assert.ok(d.body.includes('# ' + o.faction) && d.body.includes('## Who we\'ve met'));
  assert.equal(d.line, '- [[' + N.safeName(o.name) + ']] — ' + o.profession + ', ' + o.rank + ' ' + o.faction + '\n');
  assert.equal(g.dossierLine(o, { file: 'Chosen 2' }), '- [[Chosen 2]] — ' + o.profession + ', ' + o.rank + ' ' + o.faction + '\n');
  assert.equal(g.dossier(withoutDossier.npc), null);
  assert.equal(g.dossierLine(withoutDossier.npc), null);
  assert.equal(g.dossier(plain.npc), null);

  const spec = g.figure(o, { seed: withFaction.seed, K }).spec;
  const doc = g.castDoc(o, spec);
  assert.equal(doc.revealed, false); assert.equal(doc.role, ''); assert.equal(doc.faction, ''); assert.equal(doc.firstSeen, null);
  assert.equal(doc.name, o.name); assert.equal(doc.alias, o.alias || '');
  assert.ok(doc.description.length > 10 && !/[*_]/.test(doc.description), 'public description is the plain look line');
  assert.ok(!doc.description.includes(o.faction) && !doc.description.includes(o.quirk), 'no secrets in the public fields');
  assert.ok(doc.gmNotes.includes(o.faction) && doc.gmNotes.includes('How to play') && doc.gmNotes.includes(o.quirk), 'levers are in gmNotes');
  assert.deepEqual(doc.spec, spec);
  assert.ok(doc.gmNotes.length < 8000 && doc.description.length < 2000);
  assert.ok(g.castDoc(hull.npc, null).gmNotes.includes('human figure'));
  const rec = g.npcRecord(o);
  assert.equal(rec.name, o.name); assert.equal(rec.playedBy, o.cast.n); assert.equal(rec.faction, o.faction);
});

/* ---------- figures ---------- */
const kitSays = (spec) => K.render(spec).warnings.concat(K.portrait(spec).warnings);

for (const [label, pk] of [['fixture', FIX], ['real', REAL]]) {
  if (!pk) continue;
  const count = label === 'real' ? 500 : 300;
  await test(label + ': figure() always gives a spec the kit renders and draws with no warnings (' + count + ' seeds)', () => {
    const g = N.create(pk);
    let fallback = 0, hulls = 0; const tries = {};
    for (let i = 0; i < count; i++) {
      const r = g.roll({ seed: seedOf(i) });
      const f = g.figure(r.npc, { seed: r.seed, K });
      assert.deepEqual(f.warnings, [], label + ' #' + i + ' warnings');
      assert.deepEqual(kitSays(f.spec), [], label + ' #' + i + ' kit warnings');
      assert.ok(f.tries >= 0 && f.tries <= 4);
      tries[f.tries] = (tries[f.tries] || 0) + 1;
      if (f.fallback) fallback++;
      assert.equal(f.spec.name, r.npc.name);
      if (r.npc.isHull) { hulls++; assert.equal(f.spec.plate, r.npc.name); }
      else assert.ok(new RegExp('^.+ · ' + r.npc.name.charAt(0) + '\\.$').test(f.spec.plate) && f.spec.plate.startsWith(r.npc.name.split(' ').slice(1).join(' ')), 'plate ' + f.spec.plate);
      assert.ok(/^NPC-968-\d{4}$/.test(f.spec.code));
      // deterministic: the same seed draws the same figure, and the NPC's own stream is not touched
      if (i % 25 === 0) assert.deepEqual(g.figure(r.npc, { seed: r.seed, K }).spec, f.spec);
    }
    console.log('     ' + label + ' figures: ' + count + ' seeds, ' + hulls + ' Hulls, fallback ' + fallback + ', tries ' + JSON.stringify(tries));
  });
}

await test('figure(): the retry ladder strips props, patterns, hat, eyewear (one fault each), then falls back to an archetype', () => {
  const g = N.create(FIX);
  const r = g.roll({ seed: seedOf(5) });
  const base = () => ({ figure: 'masc', heightIn: 68, shape: 'lean', skin: 'fair', age: 40, hair: { style: 'short', color: 'cloth-brown' },
    outfit: { base: { type: 'shirt', color: 'cloth-cream' }, bottom: { type: 'trousers', color: 'cloth-charcoal' }, feet: { type: 'oxfords', color: 'cloth-black' } } });
  const run = (mut) => g.figure(r.npc, { seed: 9, K, map: () => { const s = base(); mut(s); return s; } });
  const clean = run(() => {});
  assert.equal(clean.tries, 1); assert.equal(clean.fallback, false);
  const props = run((s) => { s.props = [{ type: 'cane', color: 'not-a-colour' }]; });
  assert.equal(props.fallback, false); assert.ok(props.notes.includes('stripped props')); assert.deepEqual(props.spec.props, []); assert.equal(props.tries, 2);
  const pat = run((s) => { s.outfit.base.pattern = { type: 'check', color: 'not-a-colour' }; });
  assert.equal(pat.fallback, false); assert.ok(pat.notes.includes('stripped patterns')); assert.equal(pat.spec.outfit.base.pattern, undefined);
  const hat = run((s) => { s.hair.hat = { type: 'trilby', color: 'not-a-colour' }; });
  assert.equal(hat.fallback, false); assert.ok(hat.notes.includes('stripped hat')); assert.equal(hat.spec.hair.hat, undefined);
  const eye = run((s) => { s.face = { eyewear: { type: 'shades', frame: 'not-a-colour' } }; });
  assert.equal(eye.fallback, false); assert.ok(eye.notes.includes('stripped eyewear')); assert.equal(eye.spec.face.eyewear, undefined);
  for (const x of [clean, props, pat, hat, eye]) assert.deepEqual(kitSays(x.spec), []);
  // names the kit does not know are dropped before the first render
  const unk = run((s) => { s.hair.style = 'not-a-hairstyle'; s.outfit.base.type = 'not-a-top'; s.shape = 'not-a-shape'; s.props = [{ type: 'not-a-prop' }]; });
  assert.equal(unk.fallback, false); assert.ok(unk.notes.filter((n) => n.startsWith('dropped')).length >= 4); assert.deepEqual(kitSays(unk.spec), []);
  // a fault no strip can cure, a map that throws, a map that returns nothing: the archetype, name swapped
  for (const map of [() => { const s = base(); s.heightIn = 'tall'; return s; }, () => { throw new Error('boom'); }, () => null]) {
    const fb = g.figure(r.npc, { seed: 9, K, map });
    assert.equal(fb.fallback, true); assert.deepEqual(fb.warnings, []); assert.deepEqual(kitSays(fb.spec), []);
    assert.equal(fb.spec.name, r.npc.name); assert.equal(fb.spec.plate, N.plateOf(r.npc)); assert.equal(fb.spec.archetype, undefined);
  }
});

await test('every archetype in B68Cast.npcs is a clean fallback once its name is swapped', () => {
  assert.ok(CAST.npcs.length >= 12);
  const g = N.create(FIX);
  const people = [g.roll({ seed: seedOf(1) }).npc, g.roll({ seed: seedOf(2) }).npc];
  for (let i = 3; !people.some((p) => p.isHull) && i < 100; i++) { const o = g.roll({ seed: seedOf(i) }).npc; if (o.isHull) people.push(o); }
  assert.ok(people.some((p) => p.isHull));
  for (const arch of CAST.npcs) for (const npc of people) {
    const spec = N.fromArchetype(arch, npc, 4321);
    assert.deepEqual(kitSays(spec), [], arch.id + ' as ' + npc.name);
    assert.equal(spec.name, npc.name); assert.equal(spec.plate, N.plateOf(npc)); assert.ok(spec.halo);
  }
  // the nearest-archetype pick prefers the same figure
  const fem = N.nearestArchetype({ figure: 'fem', shape: 'hourglass', heightIn: 67 }, CAST.npcs);
  assert.equal(fem.figure, 'fem');
});

await test('a figure map module is used when present, with the documented signature (npc, F, rngFn, K)', () => {
  const g = N.create(FIX);
  const r = g.roll({ seed: seedOf(8) });
  let args = null;
  const f = g.figure(r.npc, { seed: 3, K, map: function () { args = [].slice.call(arguments); return { figure: 'masc', heightIn: 70, outfit: { base: { type: 'tee', color: 'cloth-cream' } } }; } });
  assert.equal(args.length, 4);
  assert.equal(args[0], r.npc); assert.deepEqual(args[1], FIX.F); assert.equal(typeof args[2], 'function'); assert.equal(args[3], K);
  const a = args[2](); assert.ok(a >= 0 && a < 1);
  assert.deepEqual(kitSays(f.spec), []);
  assert.equal(f.spec.halo, 'file-500');                      // stamped when the map gives none
  // the figure stream is its own: figure() never moves the roll's memory or the instance
  const before = JSON.stringify(g.mem());
  g.figure(r.npc, { seed: 3, K });
  assert.equal(JSON.stringify(g.mem()), before);
});

await test('the real figure map (B68GmFigureMap.map returns { spec, notes }) draws the NPC: no fallback to a stock figure', () => {
  const sets = [['fixture', FIX]].concat(REAL ? [['real', REAL]] : []);
  for (const [label, P] of sets) {
    const g = N.create(P);
    let fb = 0, n = 60;
    for (let i = 0; i < n; i++) {
      const r = g.roll({ seed: seedOf(i + 40) });
      const f = g.figure(r.npc, { K });
      if (f.fallback) fb++;
      assert.deepEqual(f.warnings, [], label + ': the final spec draws clean');
    }
    assert.equal(fb, 0, label + ': ' + fb + ' of ' + n + ' rolls fell back to a stock archetype (the figure map returns { spec, notes }, which must be unwrapped)');
  }
});

await test('internal map honours F.halo and F = null', () => {
  const g = N.create(FIX), g0 = N.create(Object.assign({}, FIX, { F: null }));
  let hit = 0;
  for (let i = 0; i < 100; i++) {
    const r = g.roll({ seed: seedOf(i) });
    const f = g.figure(r.npc, { seed: r.seed, K, map: false });
    const want = FIX.F.halo[r.npc.faction || ''];
    if (want) { assert.equal(f.spec.halo, f.fallback ? f.spec.halo : want); hit++; }
    assert.deepEqual(g0.figure(r.npc, { seed: r.seed, K, map: false }).warnings, []);
  }
  assert.ok(hit > 10);
});

await test('B14: a tier carried as text still gives a numeric quality; a figure failure is a note on the result, never a throw', () => {
  const P = clone(FIX); P.T.faction = P.T.faction.map((f) => [f[0], String(f[1]), f[2]]);
  const g = N.create(P), g0 = N.create(FIX);
  for (let i = 0; i < 80; i++) {
    const f = FIX.T.faction[i % FIX.T.faction.length][0];
    const r = g.roll({ seed: seedOf(i), ui: { faction: f } }), r0 = g0.roll({ seed: seedOf(i), ui: { faction: f } });
    assert.ok(Number.isInteger(r.npc.quality) && r.npc.quality >= 1 && r.npc.quality <= 6, 'quality ' + r.npc.quality);
    assert.deepEqual(r.npc, r0.npc, 'the same NPC as with a numeric tier (the tier reads as the number)');
    assert.deepEqual(r.card, r0.card);
    assert.ok(!/NaN|undefined/.test(JSON.stringify(r.card)) && !/NaN/.test(g.noteBody(r.npc, { date: '14/10/2026' })));
  }
  // no number at all: a middling quality (2, drifted one step), the tier shown as written ('?' when there is none)
  for (const [tier, shown] of [['III', 'III'], ['', '?'], [null, '?']]) {
    const Q = clone(FIX); Q.T.faction = Q.T.faction.map((f) => [f[0], tier, f[2]]);
    for (let i = 0; i < 20; i++) {
      const q = N.create(Q).roll({ seed: seedOf(i), ui: { faction: Q.T.faction[0][0] } });
      assert.ok(q.npc.quality >= 1 && q.npc.quality <= 3, 'quality ' + q.npc.quality);
      assert.ok(q.card.meta.sub.includes('(Tier ' + shown + ', ') && !/undefined|NaN/.test(JSON.stringify(q.card)), q.card.meta.sub);
    }
    assert.deepEqual(N.check(Q.T), Q.T.faction.map((f) => 'faction.' + f[0] + '.tier'), 'check() names each tier that is no number');
  }
  assert.deepEqual(N.check(P.T), [], 'a tier written "3" reads as 3: not reported');
  // figure(): every result carries `note` and `failed`; a map that throws falls back to a stock figure and says so;
  // with no archetypes either, or a kit that throws, the result is failed with a "No portrait" note instead of a throw
  const r = g0.roll({ seed: 9 });
  const clean = g0.figure(r.npc, { seed: 9, K });
  assert.equal(typeof clean.note, 'string'); assert.equal(clean.failed, false);
  if (!clean.fallback && !clean.notes.some((n) => /^(stripped|dropped)/.test(n))) assert.equal(clean.note, '');
  const thrown = g0.figure(r.npc, { seed: 9, K, map: () => { throw new Error('boom'); } });
  assert.ok(!thrown.failed && thrown.fallback && thrown.notes.some((n) => /the map threw: boom/.test(n)) && /^Portrait: a stock figure/.test(thrown.note), JSON.stringify(thrown.note));
  const none = g0.figure(r.npc, { seed: 9, K, map: () => { throw new Error('boom'); }, archetypes: [] });
  assert.ok(none.failed && !none.fallback && /^No portrait: /.test(none.note) && none.warnings.length > 0 && JSON.stringify(none.spec) === '{}', JSON.stringify(none));
  const badKit = Object.assign({}, K, { options: () => { throw new Error('no options'); } });
  const kf = g0.figure(r.npc, { seed: 9, K: badKit });
  assert.ok(kf.failed && !kf.fallback && /^No portrait: .*no options/.test(kf.note) && JSON.stringify(kf.spec) === '{}', JSON.stringify(kf));
  // a fault no strip cures and no archetype to fall back on: the spec as it stands, and the note says the kit warns
  const warned = g0.figure(r.npc, { seed: 9, K, archetypes: [], map: () => ({ figure: 'masc', heightIn: 'tall', shape: 'lean', skin: 'fair', age: 40, hair: { style: 'short', color: 'cloth-brown' },
    outfit: { base: { type: 'shirt', color: 'cloth-cream' }, bottom: { type: 'trousers', color: 'cloth-charcoal' }, feet: { type: 'oxfords', color: 'cloth-black' } } }) });
  assert.ok(!warned.failed && !warned.fallback && warned.warnings.length > 0 && warned.spec.name === r.npc.name && /^Portrait: drawn with the kit's warning/.test(warned.note), JSON.stringify(warned.note));
  const stripped = g0.figure(r.npc, { seed: 9, K, map: () => ({ figure: 'masc', heightIn: 70, outfit: { base: { type: 'tee', color: 'cloth-cream' } }, props: ['no-such-prop'] }) });
  assert.ok(/^Portrait: /.test(stripped.note) || stripped.note === '', stripped.note);
});

await test('B8: check(T) names what a pack is missing or has empty; the fixture is complete', () => {
  assert.deepEqual(N.check(FIX.T), [], 'the fixture is complete');
  if (REAL) assert.deepEqual(N.check(REAL.T), [], 'the real pack is complete');
  assert.deepEqual(N.check(null), ['T']);
  const optional = ['place', 'factionDetail', 'telltaleHeritage'];       // (telltale is needed while telltaleHeritage is set)
  for (const k of Object.keys(FIX.T)) {
    const del = clone(FIX.T); delete del[k];
    if (optional.includes(k)) { assert.deepEqual(N.check(del), [], k + ' is optional'); continue; }
    assert.ok(N.check(del).includes(k), 'delete ' + k + ': ' + JSON.stringify(N.check(del)));
    if (Array.isArray(FIX.T[k])) { const emp = clone(FIX.T); emp[k] = []; assert.ok(N.check(emp).includes(k), 'empty ' + k); }
  }
  const tt = clone(FIX.T); delete tt.telltale; assert.deepEqual(N.check(tt), ['telltale'], 'a telltale heritage needs the telltale list');
  delete tt.telltaleHeritage; assert.deepEqual(N.check(tt), [], 'and without one, no telltale list is needed');
  const hole = clone(FIX.T); hole.wearing[0].a = []; hole.heritage[1].d = []; hole.key[0] = ['k', 'flip'];
  assert.deepEqual(N.check(hole), ['heritage', 'wearing', 'key'], 'a row with an empty inner list is reported under its table');
});

/* ---------- the exporter (invented vault page) ---------- */
await test('exporter: leverage functions become data, and a function that does not round-trip fails loudly', () => {
  const shapes = [
    [(v) => `Is allied with ${v}.`, { t: 'Is allied with {v}.' }],
    [(v) => `The ${v.toLowerCase()} thing.`, { t: 'The {v} thing.', lower: true }],
    [(v) => `Can do *${v.split(' — ')[0].toLowerCase()}*.`, { t: 'Can do *{v}*.', lower: true, head: true }],
    [(v) => `${v.split(' — ')[0]}!`, { t: '{v}!', head: true }],
  ];
  for (const [fn, want] of shapes) {
    const got = Pack.leverageToData(fn, 'f', 0);
    assert.deepEqual(got, Object.assign({ f: 'f' }, want));
    for (const v of ['Plain', 'Two Parts — Tail', 'a$&b']) assert.equal(Pack.applyLeverage(got, v), fn(v));
  }
  const bad = [
    (v) => v.slice(1), (v) => v.toUpperCase(), (v) => v + v, (v) => 'no argument at all',
    (v) => v + (v.length > 3 ? '!' : '?'), (v) => `{v} ${v}`, (v) => v.replace('a', 'b'),
  ];
  for (const fn of bad) assert.throws(() => Pack.leverageToData(fn, 'f', 0), /T\.leverage\[0\]/);
});

await test('exporter: cast rows, the figure-map blocks, and the npc part from an invented page', () => {
  const castText = ['| Anchor | Status | Pace | Borrow | Never | Warm-up |', '|---|---|---|---|---|---|',
    '| **Aunt A** (a role) | High | Slow | The sigh | The giggle | A clip |', '| **Nobody** | | | | | |', 'not a row', '| **Cap B** | Low | Fast | The salute | The shout | A clip |'].join('\n');
  const cast = Pack.parseCast(castText);
  assert.deepEqual(cast, [{ n: 'Aunt A', status: 'High', pace: 'Slow', borrow: 'The sigh', never: 'The giggle' }, { n: 'Cap B', status: 'Low', pace: 'Fast', borrow: 'The salute', never: 'The shout' }]);

  assert.equal(Pack.parseFigureMap('# nothing\n```json\n{"x":1}\n```\n'), null);
  assert.deepEqual(Pack.parseFigureMap('```json F\n{"a":{"b":1},"c":[1]}\n```\ntext\n```json F.halo\n{"x":"ink-700"}\n```\n```js\nnope\n```'), { a: { b: 1 }, c: [1], halo: { x: 'ink-700' } });
  assert.deepEqual(Pack.parseFigureMap('```json F.a\n[1]\n```\n```json F.b\n{"k":2}\n```'), { a: [1], b: { k: 2 } });
  assert.throws(() => Pack.parseFigureMap('```json F\n{oops}\n```'), /not valid JSON/);
  assert.throws(() => Pack.parseFigureMap('```json F\n[1]\n```'), /must be a JSON object/);
  assert.throws(() => Pack.parseFigureMap('```json F\n{}\n'), /not closed/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-npc-'));
  try {
    const tools = path.join(dir, 'Wiki', 'Games', 'Blades in the Dark', 'Tools');
    fs.mkdirSync(tools, { recursive: true });
    const page = (lev) => ['# invented', '', '```dataviewjs', 'const Math = Object.create(globalThis.Math);', 'const T = {};', 'T.heritage = [{n:"Wex", d:["a","b"]}];',
      'T.leverage = [', lev, '];', 'const POOL = { x: T.heritage.flat() };', 'function generate() { const o = {}; const h = pick(T.heritage);',
      '  o.telltale = h.n === "Wex" ? pick(T.telltale) : null; }', '```', ''].join('\n');
    const gen = path.join(tools, 'blades-68-npc-generator.md');
    fs.writeFileSync(gen, page('{f:"faction", t: v => `Allied with ${v}.`}, {f:"key", t: v => `The ${v.toLowerCase()} thing.`}'));
    fs.writeFileSync(path.join(tools, 'blades-68-npc-cast.md'), castText);
    const before = Pack.exportWarnings.length;
    const part = Pack.buildNpc(dir, '2026-10-14T00:00:00.000Z');
    assert.deepEqual(clone(part.T.leverage), [{ f: 'faction', t: 'Allied with {v}.' }, { f: 'key', t: 'The {v} thing.', lower: true }]);
    assert.equal(part.T.telltaleHeritage, 'Wex');
    assert.equal(part.cast.length, 2); assert.equal(part.F, null);
    assert.ok(Pack.exportWarnings.slice(before).some((w) => /figure-map/.test(w)), 'F: null warns');
    assert.ok(!('POOL' in part.T) && part.T.heritage.length === 1, 'tables are cut before POOL');
    fs.writeFileSync(path.join(tools, 'blades-68-npc-figure-map.md'), '# map\n```json F\n{"halo":{"":"ink-700"}}\n```\n');
    assert.deepEqual(Pack.buildNpc(dir, 'x').F, { halo: { '': 'ink-700' } });
    // a leverage function that does not round-trip fails the export
    fs.writeFileSync(gen, page('{f:"faction", t: v => `Allied with ${v.slice(1)}.`}'));
    assert.throws(() => Pack.buildNpc(dir, 'x'), /T\.leverage\[0\]/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the GM's choices: faction, district, place (15/10/2026) ----
await test('choices: controls, defaults and cleanUi come from the tables', () => {
  const g = N.create(FIX);
  assert.deepEqual(g.controls.map((c) => c.id), ['faction', 'district', 'place']);
  for (const c of g.controls) assert.deepEqual(c.options[0], { value: '', label: 'any' }, c.id + ': any first');
  const fac = g.controls[0].options.map((o) => o.value);
  assert.equal(fac[1], '-'); assert.deepEqual(fac.slice(2), FIX.T.faction.map((x) => x[0]));
  assert.deepEqual(g.controls[2].options.slice(1).map((o) => o.value), Object.keys(FIX.T.place));
  assert.deepEqual(g.defaults(), { faction: '', district: '', place: '' });
  assert.deepEqual(g.cleanUi({ faction: 'Nobody', district: 'Atlantis', place: 'toString', x: 1 }), { faction: '', district: '', place: '' });
  assert.deepEqual(g.cleanUi({ faction: '-', district: 'Gnome Hill', place: 'Casino' }), { faction: '-', district: 'Gnome Hill', place: 'Casino' });
  assert.deepEqual(g.cleanUi(null), { faction: '', district: '', place: '' });
  const T2 = clone(FIX.T); delete T2.place;
  assert.deepEqual(N.create({ ...FIX, T: T2 }).controls.map((c) => c.id), ['faction', 'district'], 'an older pack: no place picker');
});

await test('choices: no choice (or only unknown ones) draws exactly as before', () => {
  for (let i = 0; i < 200; i++) {
    const a = N.create(FIX).roll({ seed: seedOf(i), mem: {} });
    const b = N.create(FIX).roll({ seed: seedOf(i), mem: {}, ui: { faction: '', district: '', place: '' } });
    const c = N.create(FIX).roll({ seed: seedOf(i), mem: {}, ui: { faction: 'Nobody', place: 'Atlantis' } });
    assert.deepEqual(b.npc, a.npc); assert.deepEqual(c.npc, a.npc);
    assert.ok(!('place' in a.npc));
  }
});

await test('choices: a chosen faction, unaffiliated, a district and a place are honoured on every roll', () => {
  const g = N.create(FIX);
  const mem = {};
  for (let i = 0; i < 300; i++) {
    const r = g.roll({ seed: seedOf(i), mem, ui: { faction: 'Teapot Union', district: 'Gnome Hill', place: 'Test shop' } });
    checkRoll(r, 'chosen #' + i);
    assert.equal(r.npc.faction, 'Teapot Union'); assert.equal(r.npc.factionTier, 4); assert.ok(FIX.T.rank.includes(r.npc.rank));
    assert.equal(r.npc.district, 'Gnome Hill');
    assert.equal(r.npc.place, 'Test shop'); assert.ok(FIX.T.place['Test shop'].work.includes(r.npc.profession), 'profession from the place');
    assert.ok(r.card.meta.sub.endsWith(' · Gnome Hill · Test shop'), 'the role line names the place');
    const u = g.roll({ seed: seedOf(i), mem: {}, ui: { faction: '-' } });
    assert.equal(u.npc.faction, null); assert.ok(u.npc.quality >= 1 && u.npc.quality <= 2);
  }
});

await test('choices: a place\'s factions take about half the affiliated rolls; its districts fill an "any" district', () => {
  const g = N.create(FIX);
  let aff = 0, home = 0;
  for (let i = 0; i < 1200; i++) {
    const r = g.roll({ seed: seedOf(i), mem: {}, ui: { place: 'Test shop' } });
    if (r.npc.faction) { aff++; if (FIX.T.place['Test shop'].factions.includes(r.npc.faction)) home++; }
  }
  const share = home / aff, base = 2 / FIX.T.faction.length;
  assert.ok(share > 0.55 && share < 0.8, 'place factions share ' + share.toFixed(2) + ' (base ' + base.toFixed(2) + ')');
  for (let i = 0; i < 100; i++) {
    assert.equal(g.roll({ seed: seedOf(i), mem: {}, ui: { place: 'Casino' } }).npc.district, 'Teapot Row');
    assert.equal(g.roll({ seed: seedOf(i), mem: {}, ui: { place: 'Casino', district: 'Puddle End' } }).npc.district, 'Puddle End', 'the district picker wins');
  }
});

await test('choices: the replay carries the cleaned ui and redraws the same NPC; stateEntry keeps ui only when chosen', () => {
  const g = N.create(FIX);
  const mem = {};
  for (let i = 0; i < 50; i++) g.roll({ seed: seedOf(i), mem, ui: { place: 'Test depot' } });
  const r = g.roll({ mem, ui: { faction: 'Gnome Lodge', place: 'Casino', junk: 1 } });
  assert.deepEqual(r.replay.ui, { faction: 'Gnome Lodge', district: '', place: 'Casino' });
  const again = N.create(FIX).roll({ seed: r.replay.seed, mem: clone(r.replay.mem), ui: r.replay.ui });
  assert.deepEqual(again.npc, r.npc); assert.deepEqual(again.card, r.card);
  const e = g.stateEntry(r, { at: 'x' });
  assert.deepEqual(e.ui, r.replay.ui);
  assert.ok(!('ui' in g.stateEntry(g.roll({ seed: 1, mem: {} }), { at: 'x' })), 'no choices: no ui key (older entries look the same)');
  assert.ok(g.noteBody(r.npc, { date: '15/10/2026' }).includes(' · Casino*'), 'the saved note names the place');
});

if (REAL && REAL.T.place) {
  await test('real pack: every place, with and without a faction, rolls clean cards', () => {
    const g = N.create(REAL);
    const places = Object.keys(REAL.T.place);
    let n = 0;
    for (const p of places) for (let i = 0; i < 40; i++) {
      const f = i % 4 === 0 ? REAL.T.faction[i % REAL.T.faction.length][0] : i % 4 === 1 ? '-' : '';
      const r = g.roll({ seed: seedOf(n++), ui: { place: p, faction: f } });
      checkRoll(r, 'real place #' + n);
      assert.equal(r.npc.place, p);
      if (f && f !== '-') assert.equal(r.npc.faction, f);
    }
    console.log('  (' + n + ' rolls over ' + places.length + ' places)');
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
