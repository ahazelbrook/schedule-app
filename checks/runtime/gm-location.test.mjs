// Unit test for app/gm/location.js (the location generator port). Committed tests use only the invented fixture in
// checks/runtime/fixtures/gm/location-pack.json. If the private GM pack exists on this machine (gm-private/, never
// committed) the same sweep also runs on the real tables, and the map kit is exercised on real rolls; nothing from
// the real pack is printed.
//   node checks/runtime/gm-location.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = o => JSON.parse(JSON.stringify(o));

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
const FIX = { T: fixture.T, extra: fixture.extra };
const packPath = path.join(ROOT, 'gm-private', 'b68-gm-pack.json');
let REAL = null;
if (fs.existsSync(packPath)) {
  try { const p = JSON.parse(fs.readFileSync(packPath, 'utf8')); if (p.parts && p.parts.location) REAL = { T: p.parts.location.T, extra: p.parts.location.extra }; } catch (e) { /* no real pack */ }
}

/* ---------- structural checks on one roll ---------- */
function walk(v, p, bad) {
  if (v === undefined) bad.push(p + ' is undefined');
  else if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p + ' is not finite');
  else if (typeof v === 'string') {
    if (/\bundefined\b|\bNaN\b|\[object|%F%|\{[A-Za-z_]\w*\}|\$\{/.test(v)) bad.push(p + ' has a placeholder or bad value: ' + v.slice(0, 60));
  } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, p + '[' + i + ']', bad));
  else if (v && typeof v === 'object' && p !== 'gaz') for (const k of Object.keys(v)) walk(v[k], p + '.' + k, bad);
}
function checkRoll(pack, o, label) {
  const bad = [];
  walk(o, 'roll', bad);
  const text = JSON.stringify(o) + L.cardLines(o, pack).join('\n') + L.noteBody(o, { date: '01/01/2026', pack }) + L.playerSummary(o).text;
  if (/undefined|NaN|\[object|%F%|\{[A-Za-z_]\w*\}/.test(text)) bad.push('rendered text has a bad token');
  if (!(o.rooms.length >= 6 && o.rooms.length <= 14)) bad.push('room count ' + o.rooms.length);
  const names = new Set(o.rooms.map(r => r.name));
  if (o.rooms.filter(r => r.isTarget).length !== 1) bad.push('target count');
  if (!names.has(o.targetRoom)) bad.push('targetRoom not a room');
  for (const r of o.rooms) {
    if (!pack.T.bandOrder.includes(r.band)) bad.push('band ' + r.band);
    if (!r.detail) bad.push('room without detail: ' + r.name);
    if (r.pairedWith && !names.has(r.pairedWith)) bad.push('pairedWith dangling');
    if (r.holdsAnswerTo && !names.has(r.holdsAnswerTo)) bad.push('holdsAnswerTo dangling');
  }
  for (const s of o.skips) if (!names.has(s.from) || !names.has(s.to)) bad.push('skip dangling');
  if (o.vectors.length !== 3) bad.push('vectors');
  if (!Number.isInteger(o.seed)) bad.push('seed not recorded');
  if (bad.length) throw new Error(label + ': ' + bad.slice(0, 5).join('; '));
}

/* ---------- the sweep ---------- */
function sweep(pack, seeds, label) {
  let n = 0;
  const { controls } = L.controls(pack);
  const targets = controls.find(c => c.key === 'target').options.map(o => o.value);
  const districts = controls.find(c => c.key === 'district').options.map(o => o.value);
  const approaches = controls.find(c => c.key === 'approach').options.map(o => o.value);
  for (const target of targets) for (const district of districts) for (const mix of [false, true]) for (let s = 0; s < seeds; s++) {
    const seed = (s * 2654435761 + n * 97) >>> 0;
    const approach = approaches[(n + s) % approaches.length];
    const o = L.generate(pack, { target, district, mix, approach }, { seed, mem: {} });
    checkRoll(pack, o, label + ' ' + JSON.stringify({ target, district, mix, approach, seed }));
    n++;
  }
  return n;
}

await test('fixture sweep: every target x district x mix x many seeds', () => {
  const n = sweep(FIX, 12, 'fixture');
  assert.ok(n > 1000, 'rolls: ' + n);
  console.log('     ' + n + ' fixture rolls');
});

await test('faction and approach seeds, and a long run sharing one mem', () => {
  const mem = {}; const seen = [];
  for (let i = 0; i < 400; i++) {
    const o = L.generate(FIX, { faction: FIX.T.faction[i % 12][0], mix: i % 3 === 0 }, { seed: i + 1, mem });
    checkRoll(FIX, o, 'run ' + i);
    assert.equal(o.faction, FIX.T.faction[i % 12][0]);
    seen.push(o.target);
  }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], 'fresh() repeated a target back to back at ' + i);
  assert.ok(Object.values(mem).every(a => a.length <= 20), 'mem window is capped at 20');
  for (const a of FIX.T.approach) {
    const o = L.generate(FIX, { approach: a.n }, { seed: 5, mem: {} });
    assert.equal(o.approachName, a.n);
    if (a.n === 'Paranormal') assert.equal(o.mixName, 'Anomalous Zone');
  }
});

await test('seeds: target, district and the printed special cases', () => {
  const o1 = L.generate(FIX, { target: 'Ship' }, { seed: 3, mem: {} });
  assert.equal(o1.district, 'Dockside Test'); assert.equal(o1.name, 'The Test Hulk'); assert.equal(o1.districtClash, false);
  const o2 = L.generate(FIX, { target: 'Ship', district: 'Testfield' }, { seed: 3, mem: {} });
  assert.equal(o2.districtClash, true); assert.notEqual(o2.name, 'The Test Hulk');
  assert.ok(o2.tensions.some(t => t.includes('outside')), 'clash is printed');
  const o3 = L.generate(FIX, { target: 'Bank' }, { seed: 9, mem: {} });
  assert.equal(o3.mixName, 'Fixture Hall');
  for (let s = 1; s < 40; s++) {
    const r = L.generate(FIX, { target: 'Records office', mix: true }, { seed: s, mem: {} });
    assert.ok(r.rooms.some(x => x.name === FIX.T.theme['Fixture Offices'].areas[3].split('. ')[0]), 'forced room present'); assert.ok(r.rooms.length <= 12, 'forced room does not add a slot');
    const m = L.generate(FIX, { target: 'Mansion', district: 'Hightown Test' }, { seed: s, mem: {} });
    const wealth = FIX.T.district.find(d => d[0] === 'Hightown Test')[1];
    assert.equal(m.themeName, (wealth === 'Very high' || wealth === 'High') ? 'Fixture Villa' : 'Fixture Manor');
  }
});

await test('same seed, opts and mem replays the same roll (deep-equal, and the mem it leaves)', () => {
  for (let i = 0; i < 60; i++) {
    const opts = { target: i % 2 ? 'Bank' : '', district: i % 3 ? '' : 'Testfield', mix: i % 4 === 0, approach: i % 5 ? '' : 'Loud' };
    const mem0 = { target: ['Test shop'], colour: [FIX.T.colour[0]] };
    const m1 = clone(mem0), m2 = clone(mem0);
    const a = L.generate(FIX, opts, { seed: 1000 + i, mem: m1 });
    const b = L.generate(FIX, opts, { seed: 1000 + i, mem: m2 });
    assert.deepEqual(a, b); assert.deepEqual(m1, m2);
    assert.equal(a.seed, 1000 + i);
    // an injected rng is the same stream
    const c = L.generate(FIX, opts, { rng: L.seedRng(1000 + i), mem: clone(mem0) });
    assert.deepEqual({ ...c, seed: a.seed }, a);
  }
  const x = L.generate(FIX, {}, { seed: 1, mem: {} }), y = L.generate(FIX, {}, { seed: 2, mem: {} });
  assert.notDeepEqual(x, y);
  const noSeed = L.generate(FIX, {}, {});
  assert.ok(Number.isInteger(noSeed.seed), 'a missing seed is drawn and recorded');
  assert.deepEqual(L.generate(FIX, {}, { seed: noSeed.seed, mem: {} }), noSeed, 'and that seed replays it');
});

await test('controls and defaults', () => {
  const c = L.controls(FIX);
  assert.deepEqual(c.controls.map(x => x.key), ['target', 'district', 'approach', 'faction', 'mix']);
  assert.equal(c.controls[0].options[0].value, ''); assert.equal(c.controls[0].options[0].label, 'any');
  assert.equal(c.controls[0].options.length, FIX.T.targetNames.length + 1);
  assert.deepEqual(c.defaults, L.defaults());
  assert.equal(c.controls[4].kind, 'toggle');
});

await test('cardLines: markdown only, GM sections flagged, no HTML', () => {
  const o = L.generate(FIX, { target: 'Test shop' }, { seed: 77, mem: {} });
  const secs = L.cardSections(o, FIX);
  assert.ok(secs.length >= 9);
  assert.equal(secs[0].gm, false); assert.equal(secs[1].gm, false);
  assert.ok(secs.filter(s => s.gm).length >= 6);
  const lines = L.cardLines(o, FIX);
  assert.ok(Array.isArray(lines) && lines.every(l => typeof l === 'string'));
  const text = lines.join('\n');
  assert.ok(!/<\/?(small|br|div|span|b|i|p)\b/i.test(text), 'no HTML');
  assert.ok(text.includes(o.name) && text.includes(o.targetRoom) && text.includes(o.physThreatName));
  assert.ok(lines.some(l => l.startsWith('## [GM] ')));
  // the street-facing sections hold no secrets
  const open = secs.filter(s => !s.gm).map(s => s.lines.join('\n')).join('\n');
  for (const s of [o.targetRoom, o.physThreatName, o.socThreatName, o.faction, o.rumour]) assert.ok(!open.includes(s), 'open section leaks ' + s);
  assert.ok(text.includes('**Secret:**'), 'dossier included when the pack is passed');
});

await test('noteBody and canvas', () => {
  const o = L.generate(FIX, {}, { seed: 5, mem: {} });
  const n = L.noteBody(o, { date: '14/10/2026' });
  assert.ok(n.startsWith('---\nwiki: entity') && n.includes('created: 14/10/2026') && n.includes('## Rooms') && n.includes('## In play'));
  const bare = L.noteBody(o, { frontmatter: false });
  assert.ok(bare.startsWith('# ' + o.name) && !bare.includes('[[blades-68-location-generator]]'));
  const cv = JSON.parse(L.canvas(o, FIX));
  assert.ok(cv.nodes.length >= o.rooms.length + 4 && cv.edges.length >= 3);
  assert.equal(L.canvas(o, FIX), L.canvas(o, FIX), 'canvas ids are deterministic');
  assert.ok(new Set(cv.nodes.map(x => x.id)).size === cv.nodes.length, 'node ids unique');
});

/* ---------- the player leak test ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function hiddenStrings(o, reveal) {
  const shown = new Set(o.rooms.filter(r => reveal.includes(r.band)).map(r => r.name));
  const out = [];
  for (const r of o.rooms) {
    if (!reveal.includes(r.band) && !shown.has(r.name)) out.push(r.name);
    if (r.obstacle) out.push(r.obstacle);
    if (r.loot) out.push(r.loot);
    if (r.isTarget && !reveal.includes(r.band)) out.push(r.name);
  }
  for (const v of [o.physThreatName, o.physThreatText, o.socThreatName, o.socThreatText, o.faction, o.rumour,
    o.vectors[1].how, o.vectors[1].cost, o.vectors[2].how, o.vectors[2].cost, o.watcher, o.targetWhy, o.approach.gambit, ...o.tensions,
    o.geometry.note, o.bandNote, o.also, ...o.circulation, ...o.impressions, o.detail, o.condition, o.volume].filter(Boolean)) out.push(v);
  for (const s of o.skips) out.push(s.via);
  return [...new Set(out)].filter(s => s && s.length >= 4);
}
function sources(o, reveal) { // text a hidden string may legitimately coincide with
  const s = [o.name, o.streetDesc, o.streetType, o.streetSound, o.streetSmell, o.blockUse, o.style, o.colour, o.district, o.namedStreet,
    o.timeOfDay, o.weather, o.landmark, o.neighbours.join(' '), o.props.join(' '), o.vectors[0].how, o.vectors[0].cost];
  for (const r of o.rooms) if (reveal.includes(r.band)) s.push(r.name, r.detail);
  return s.join('\n');
}
function leakCheck(o, label) {
  let checked = 0, skipped = 0;
  for (const reveal of [['public'], ['public', 'working'], ['public', 'working', 'controlled']]) {
    const ps = L.playerSummary(o, reveal), text = ps.text, src = sources(o, reveal);
    const all = JSON.stringify(ps);
    for (const h of hiddenStrings(o, reveal)) {
      if (src.includes(h)) { skipped++; continue; }
      checked++;
      assert.ok(!text.includes(h) && !all.includes(h), label + ': player summary (' + reveal + ') leaks a hidden string');
    }
    assert.deepEqual(ps.rooms.map(r => r.band).filter(b => !reveal.includes(b)), [], label + ': a room outside the revealed bands');
    assert.equal(ps.rooms.length, o.rooms.filter(r => reveal.includes(r.band)).length);
    for (const key of Object.keys(ps)) assert.ok(!['vectors', 'threats', 'target', 'faction', 'rumour', 'skips'].includes(key));
  }
  return { checked, skipped };
}

await test('playerSummary leak test: fixture, hidden strings never appear', () => {
  let c = 0, sk = 0, n = 0;
  for (const target of FIX.T.targetNames) for (let s = 0; s < 30; s++) {
    const o = L.generate(FIX, { target, mix: s % 3 === 0, approach: FIX.T.approach[s % 6].n }, { seed: s * 31 + 7, mem: {} });
    const r = leakCheck(o, target + '#' + s); c += r.checked; sk += r.skipped; n++;
  }
  assert.ok(c > 5000, 'checked ' + c);
  console.log('     ' + n + ' rolls, ' + c + ' hidden-string checks (' + sk + ' skipped as coincident with shown text)');
  // and the positive case: what the crew should see is there
  const o = L.generate(FIX, { target: 'Test shop' }, { seed: 1, mem: {} });
  const ps = L.playerSummary(o);
  assert.ok(ps.text.includes(o.name) && ps.text.includes(o.district) && ps.text.includes(o.namedStreet));
  for (const r of o.rooms.filter(x => x.band === 'public')) assert.ok(ps.text.includes(r.name));
  assert.ok(L.playerSummary(o, []).rooms.every(r => r.band === 'public'), 'empty reveal falls back to public');
});

/* ---------- the real pack (private; skipped when absent) ---------- */
if (!REAL) {
  console.log('SKIP real-pack sweep, leak test and map kit (gm-private/b68-gm-pack.json not present)');
} else {
  await test('REAL pack sweep: no throw, no placeholder, structure intact', () => {
    const n = sweep(REAL, 3, 'real');
    assert.ok(n > 500);
    console.log('     ' + n + ' real rolls');
  });
  await test('REAL pack: replay and leak test', () => {
    for (let i = 0; i < 40; i++) {
      const a = L.generate(REAL, { mix: i % 2 === 0 }, { seed: 500 + i, mem: {} }), b = L.generate(REAL, { mix: i % 2 === 0 }, { seed: 500 + i, mem: {} });
      assert.deepEqual(a, b);
    }
    let c = 0, sk = 0, n = 0;
    for (const target of REAL.T.targetNames) for (let s = 0; s < 8; s++) {
      const o = L.generate(REAL, { target, mix: s % 2 === 0, approach: REAL.T.approach[s % 6].n }, { seed: s * 131 + 11, mem: {} });
      const r = leakCheck(o, 'real#' + n); c += r.checked; sk += r.skipped; n++;
    }
    console.log('     ' + n + ' rolls, ' + c + ' hidden-string checks (' + sk + ' skipped as coincident)');
  });

  const kitPath = path.join(ROOT, 'app', 'maps', 'map-kit.js');
  if (!fs.existsSync(kitPath)) console.log('SKIP map kit render (app/maps/map-kit.js not present)');
  else await test('REAL rolls through B68Map: 4 views x 4 themes x 2 layers, no warnings, player SVG leaks nothing', () => {
    const Map = require(kitPath);
    const views = ['rings', 'plan', 'iso', 'section'], themes = ['rulebook', 'blueprint', 'casefile', 'board'];
    const combos = []; for (const v of views) for (const t of themes) combos.push([v, t]);
    const warned = [], leaks = [];
    let renders = 0, gmRenders = 0, playerRenders = 0;
    const rolls = [];
    const mem = {};
    for (let i = 0; i < 200; i++) {
      const o = L.generate(REAL, { mix: i % 3 === 0, approach: REAL.T.approach[i % 6].n }, { seed: 9000 + i * 17, mem });
      rolls.push(o);
    }
    const one = (o, i, view, theme, layer) => {
      const r = Map.render(o, { view, theme, layer, reveal: ['public'] });
      renders++; layer === 'gm' ? gmRenders++ : playerRenders++;
      if (r.warnings && r.warnings.length) warned.push({ i, name: o.name, target: o.target, view, theme, layer, warnings: r.warnings.slice(0, 2) });
      if (layer === 'player') {
        const shown = new Set(o.rooms.filter(x => x.band === 'public').map(x => x.name));
        const src = sources(o, ['public']);
        const hidden = [];
        for (const rm of o.rooms) if (rm.band !== 'public' && !shown.has(rm.name)) hidden.push(rm.name);
        hidden.push(o.physThreatName, o.socThreatName);
        if (!shown.has(o.targetRoom)) hidden.push(o.targetRoom);
        for (const h of new Set(hidden)) {
          if (!h || src.includes(h)) continue;
          if (r.svg.includes(h) || r.svg.includes(esc(h)) || r.svg.includes(h.replace(/'/g, '&#39;')) || r.svg.includes(h.replace(/'/g, '&apos;')))
            leaks.push({ i, name: o.name, view, theme, hidden: h });
        }
      }
    };
    rolls.forEach((o, i) => {
      const a = combos[i % 16], b = combos[(i * 7 + 3) % 16];
      one(o, i, a[0], a[1], 'gm'); one(o, i, a[0], a[1], 'player');
      one(o, i, b[0], b[1], 'gm'); one(o, i, b[0], b[1], 'player');
    });
    for (let i = 0; i < 6; i++) for (const [v, t] of combos) for (const layer of ['gm', 'player']) one(rolls[i * 11], i * 11, v, t, layer);
    console.log('     ' + rolls.length + ' rolls, ' + renders + ' renders (' + gmRenders + ' gm, ' + playerRenders + ' player)');
    if (warned.length) console.log('     kit warnings on ' + warned.length + ' renders; first: ' + JSON.stringify(warned.slice(0, 5)));
    assert.equal(warned.length, 0, 'kit warned on ' + warned.length + ' renders');
    assert.deepEqual(leaks, [], 'player SVG leaked hidden strings');
  });
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failed ? 1 : 0);
