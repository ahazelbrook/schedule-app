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
import { createHash } from 'node:crypto';

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

/* the panel (15/10/2026): a glance card and folds. Nothing is lost from the card, the roll is not changed, and the SAY
   line is the start of what the players are already shown */
function panelCheck(pack, o, label) {
  const before = JSON.stringify(o);
  const g = L.glance(o, pack, ['public']), F = L.folds(o, pack, ['public']);
  assert.equal(JSON.stringify(o), before, label + ': glance/folds changed the roll');
  assert.ok(L.playerSummary(o, ['public']).text.includes(g.say), label + ': SAY is not inside the player summary');
  assert.ok(g.say.length < 220, label + ': SAY is short');
  assert.ok(F.every(f => f.gm === true), label + ': every fold is GM-only');
  const ids = F.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length, label + ': fold ids unique');
  assert.ok(ids.every(id => /^[a-z-]{1,24}$/.test(id)), label + ': fold ids are plain words (they go to localStorage)');
  const all = JSON.stringify(g) + F.map(f => f.title + '\n' + f.hint + '\n' + f.lines.join('\n')).join('\n') + L.glanceLines(o, pack).join('\n');
  assert.ok(!/undefined|NaN|\[object|%F%|<\/?(div|span|p|br)\b/.test(all), label + ': bad token or HTML');
  // every room sits in exactly one band fold, the target is starred, and the room tags survive
  for (const r of o.rooms) {
    // a mixed roll can hold the same room name from both themes: the room is its name plus its theme
    const head = '- **' + (r.isTarget ? '★ ' : '') + r.name + '**' + (r.mix ? ' *(' + r.mix + ')*' : '') + ' — ';
    const holders = F.filter(f => f.id.startsWith('band-') && f.lines.some(l => l.startsWith(head)));
    assert.equal(holders.length, 1, label + ': room ' + r.name + ' in ' + holders.length + ' band folds');
    assert.equal(holders[0].id, 'band-' + r.band);
    for (const t of [r.obstacle, r.loot, r.connects, r.pairedWith, r.holdsAnswerTo].filter(Boolean)) assert.ok(holders[0].lines.join('\n').toLowerCase().includes(String(t).toLowerCase()), label + ': room tag lost: ' + t);
  }
  assert.equal(g.bands.reduce((s, b) => s + b.count, 0), o.rooms.length);
  assert.equal(g.bands.filter(b => b.target).length, 1);
  assert.equal(g.bands.reduce((s, b) => s + b.locks, 0), o.rooms.filter(r => r.obstacle).length);
  assert.deepEqual(g.bands.filter(b => b.shown).map(b => b.band), g.bands.some(b => b.band === 'public') ? ['public'] : []);
  // nothing moved off the card is lost: it is in a fold
  const folded = F.map(f => f.lines.join('\n')).join('\n');
  const keep = [o.rumour, o.physThreatText, o.socThreatText, o.also, o.bandNote, o.targetWhy, o.targetNote, o.geometry.note, o.landmark, o.watcher, o.special,
    o.vectors[0].cost, shownHow(o.vectors[1]), o.vectors[1].cost, o.vectors[2].cost, o.approach.gambit, ...ratingsOf(o), ...o.skips.map(s => s.via)].filter(Boolean);
  for (const s of keep) assert.ok(folded.includes(s), label + ': lost from the folds: ' + String(s).slice(0, 40));
  for (const t of o.tensions) assert.ok(folded.includes(t.replace(/^\*\*(.+?)\*\*\s*/, '').slice(0, 30)), label + ': tension lost');
  if (pack.T.factionDetail && pack.T.factionDetail[o.faction]) assert.ok(folded.includes(pack.T.factionDetail[o.faction].secret), label + ': dossier lost');
}
const ratingsOf = o => ['Wealth ' + o.wealth, 'Security ' + o.security, 'Criminal ' + o.criminal, 'Paranormal ' + o.paranormal];
// a way in as the card shows it: the vault's author note on the service side reads as a neutral line (B12)
const shownHow = v => /^\s*\[TODO\b/i.test(v.how) ? 'No staff door is printed for this kind of place' : v.how;

await test('panel: glance card and folds keep everything, change nothing, and SAY is player-safe', () => {
  let n = 0;
  for (const target of FIX.T.targetNames) for (let s = 0; s < 25; s++) {
    const o = L.generate(FIX, { target, mix: s % 3 === 0, approach: FIX.T.approach[s % 6].n }, { seed: s * 53 + 3, mem: {} });
    panelCheck(FIX, o, target + '#' + s); n++;
  }
  console.log('     ' + n + ' fixture rolls');
  const o = L.generate(FIX, { target: 'Test shop' }, { seed: 77, mem: {} });
  const deep = L.glance(o, FIX, ['public', 'working', 'controlled']);
  assert.deepEqual(deep.bands.filter(b => b.shown).map(b => b.band), deep.bands.map(b => b.band).filter(b => b !== 'secure'), 'shown follows the reveal');
  const pinText = L.glanceLines(o, FIX).join('\n');
  assert.ok(pinText.length < 1500, 'the pinned glance fits a pin: ' + pinText.length);
  assert.ok(pinText.includes(o.name) && pinText.includes(o.targetRoom));
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

/* the generator review (16/10/2026), robustness: B9 a pack with no faction dossiers still rolls, with the same draws;
   B8 check(T) names every key a pack is missing or has empty */
await test('B9: no faction dossiers: the rumour names a faction and the roll is otherwise the same draw', () => {
  const TEMPL = ["Word is that %F%'s allies are restless.", "Word is that %F%'s enemies are close.", "Word is that %F%'s goals have changed.", "Word is that %F%'s quirk or situation is talked about."];
  const noD = clone(FIX); noD.T.factionDetail = {}; noD.T.rumour = TEMPL;
  const gone = clone(FIX); delete gone.T.factionDetail; gone.T.rumour = TEMPL;
  const withD = clone(FIX); withD.T.rumour = TEMPL;
  const strip = x => { const y = clone(x); delete y.rumour; return y; };
  for (let s = 0; s < 60; s++) {
    const opts = { approach: FIX.T.approach[s % FIX.T.approach.length].n, mix: s % 3 === 0 };
    const a = L.generate(noD, opts, { seed: s, mem: {} }), b = L.generate(withD, opts, { seed: s, mem: {} }), c = L.generate(gone, opts, { seed: s, mem: {} });
    assert.ok(!/undefined|%F%/.test(a.rumour) && /'s (allies|enemies|goals|situation)/.test(a.rumour), a.rumour);
    assert.ok(FIX.T.faction.some(f => a.rumour.includes(f[0])), 'names a faction: ' + a.rumour);
    assert.equal(a.rumour, c.rumour, 'an empty map and no map read the same');
    assert.deepEqual(strip(a), strip(b), 'one draw either way: everything but the rumour is the same roll');
    assert.ok(/ run with | are up against |: | — /.test(b.rumour) && !/%F%/.test(b.rumour), 'with dossiers the rumour carries the dossier line: ' + b.rumour);
    checkRoll(noD, a, 'no dossiers #' + s); checkRoll(gone, c, 'no dossier map #' + s);
    for (const t of [L.cardLines(a, noD).join('\n'), L.folds(a, noD).map(f => f.lines.join('\n')).join('\n'), JSON.stringify(L.glance(a, noD))]) assert.ok(!/undefined/.test(t));
  }
  assert.deepEqual(L.check(noD.T), ['factionDetail']); assert.deepEqual(L.check(gone.T), ['factionDetail']);
});

await test('B8: check(T) names what a pack is missing or has empty; the fixture is complete', () => {
  assert.deepEqual(L.check(FIX.T), [], 'the fixture is complete'); assert.deepEqual(L.check(FIX), [], 'a whole part is accepted');
  if (REAL) assert.deepEqual(L.check(REAL.T), [], 'the real pack is complete');
  assert.deepEqual(L.check(null), ['T']);
  const optional = ['factionThumb'];
  for (const k of Object.keys(FIX.T)) {
    const del = clone(FIX.T); delete del[k];
    if (optional.includes(k)) { assert.deepEqual(L.check(del), [], k + ' is optional'); continue; }
    assert.ok(L.check(del).includes(k), 'delete ' + k + ': ' + JSON.stringify(L.check(del)));
    const emp = clone(FIX.T); emp[k] = Array.isArray(FIX.T[k]) ? [] : {};
    if (k === 'geometry') { assert.deepEqual(L.check(emp), [], 'an empty geometry map: every style takes the default'); continue; }
    assert.ok(L.check(emp).some(x => x === k || x.startsWith(k + '.')), 'empty ' + k + ': ' + JSON.stringify(L.check(emp)));
  }
  // inner holes are named by their path
  const T = clone(FIX.T), th = FIX.T.themeNames[1], d = FIX.T.district[2][0];
  T.theme[th].impressions = ['only one']; T.theme[th].bands = T.theme[th].bands.slice(1); T.gaz[d].notables = []; T.weather.Night = [];
  T.targetType.Ship.district = 'Nowhere Test'; T.targetType['Records office'].forceRoom = 99; T.bandLabel.secure = '';
  assert.deepEqual(L.check(T), ['weather.Night', 'bandLabel.secure', 'targetType.Ship.district', 'targetType.Records office.forceRoom',
    'theme.' + th + '.bands', 'theme.' + th + '.impressions', 'gaz.' + d + '.notables']);
  // a theme only a target type or the Paranormal approach names is checked too
  const U = clone(FIX.T); delete U.theme['Anomalous Zone'];
  assert.ok(L.check(U).includes('theme.Anomalous Zone'), JSON.stringify(L.check(U)));
});

/* the generator review (16/10/2026), reading: B6 flags that are not always on, the rule as text, ring-skips in the Plan
   hint; idea 7 the one-line plan; B21 band labels true to the star; B12 no author notes where the GM reads. Presentation
   only: the roll is the vault's (see the byte-identity digests below) */
await test('review: flags, the rule, the plan line under Say, band labels true to the star, no author notes', () => {
  let withRule = 0, withSkips = 0, flagged = 0, rolls = 0;
  for (let s = 0; s < 150; s++) {
    const o = L.generate(FIX, { approach: FIX.T.approach[s % FIX.T.approach.length].n, mix: s % 4 === 0 }, { seed: s * 7 + 1, mem: {} });
    const g = L.glance(o, FIX), F = L.folds(o, FIX), ps = L.playerSummary(o);
    assert.ok(!g.flags.some(f => /District rule|ring-skip/.test(f)), 'always-on flags are gone: ' + g.flags.join(' · '));
    for (const f of g.flags) assert.ok(/^(Off their turf|Tier [IVX0]+ holding|Paranormal |.+ outside )/.test(f), 'a real flag: ' + f);
    if (g.flags.length) flagged++;
    if (o.special) { withRule++; assert.ok(g.rule && g.rule.length <= 110 && o.special.replace(/\s+/g, ' ').trim().startsWith(g.rule.replace(/…$/, '')), 'the rule text, shortened: ' + g.rule); }
    else assert.equal(g.rule, '');
    assert.equal(g.skips, o.skips.length); if (o.skips.length) withSkips++;
    assert.equal(F.find(f => f.id === 'plan').hint, o.styleName + ' · ' + o.skips.length + ' skip' + (o.skips.length === 1 ? '' : 's'), 'ring-skips in the Plan hint');
    // idea 7: one sentence, from what the glance and the player summary already show
    const locks = g.bands.slice(0, g.bands.findIndex(b => b.target) + 1).reduce((n, b) => n + b.locks, 0);
    const obstacle = o.streetObstacle.toLowerCase().replace(/[.\s]+$/, '');
    assert.equal(g.target.locks, locks);
    assert.equal(g.plan, 'Front door on ' + o.namedStreet + ' (outside: ' + obstacle + '); the target, ' + o.targetRoom + ' (' + g.target.band.toLowerCase() + '), ' +
      (locks ? 'is behind ' + locks + ' lock' + (locks === 1 ? '' : 's') : 'has no lock in the way') + '.');
    assert.ok(ps.front.includes(o.namedStreet) && ps.front.toLowerCase().includes(obstacle), 'the front is what the players are shown');
    assert.ok(!g.plan.includes(o.vectors[2].how.replace(/ — there is always one\.$/, '')), 'no back route: neither the glance nor the summary shows it');
    const gl = L.glanceLines(o, FIX);
    assert.equal(gl[gl.indexOf('**Target:** ★ ' + g.target.room + ' (' + g.target.band.toLowerCase() + ') — ' + g.target.what) + 1], '**Plan:** ' + g.plan, 'Plan follows Target');
    assert.equal(gl.some(l => l.startsWith('**Rule:** ')), !!o.special); assert.ok(gl.join('\n').length < 1500);
    // B21: the ★ band's own label carries the star (room headings, the saved note and the Reference fold)
    const label = FIX.T.bandLabel[o.targetBand];
    assert.ok(L.cardLines(o, FIX).includes('### ' + label + ' ★ (' + o.rooms.filter(r => r.band === o.targetBand).length + ')'), 'card heading');
    assert.ok(L.noteBody(o, { pack: FIX }).includes('### ' + label + ' ★\n'), 'note heading');
    assert.ok(F.find(f => f.id === 'ref').lines.some(l => l.includes(label + ' ★')), 'reference');
    rolls++;
  }
  assert.ok(withRule > 0 && withSkips > 0 && flagged < rolls, 'rule ' + withRule + ' skips ' + withSkips + ' flagged ' + flagged + ' of ' + rolls);
});

await test('B12: a theme with no staff-side room and a faction with neither dossier nor thumbnail read as plain words; the roll keeps the vault\'s text', () => {
  const thin = clone(FIX);
  for (const k of Object.keys(thin.T.theme)) thin.T.theme[k].alsoRooms = thin.T.theme[k].alsoRooms.filter(nb => nb[1] !== 'working' && nb[1] !== 'controlled');
  thin.T.factionDetail = {}; thin.T.factionThumb = {};
  let n = 0;
  for (let s = 0; s < 40; s++) {
    const o = L.generate(thin, { mix: s % 2 === 0 }, { seed: s, mem: {} });
    assert.ok(/^\[TODO: /.test(o.vectors[1].how), 'the roll is the vault\'s, author note and all');
    const shown = [L.cardLines(o, thin).join('\n'), L.folds(o, thin).map(f => f.lines.join('\n')).join('\n'), L.noteBody(o, { pack: thin }), L.canvas(o, thin), L.glanceLines(o, thin).join('\n'), L.playerSummary(o).text];
    for (const t of shown) assert.ok(!/\[TODO|flagged for/i.test(t), 'an author note where the GM reads');
    for (const t of shown.slice(0, 4)) assert.ok(t.includes('No staff door is printed for this kind of place: invent one'), 'the service side in plain words');
    for (const t of shown.slice(0, 2)) assert.ok(t.includes('No dossier or thumbnail is printed for this faction'), 'the opposition in plain words');
    n++;
  }
  assert.equal(n, 40);
});

await test('B21: a Secure label that says "the target" stays true when the ★ sits elsewhere', () => {
  const named = clone(FIX);
  named.T.bandLabel = { public: 'Public — anyone can be here', working: 'Working — staff only', controlled: 'Controlled — most locks are here', secure: 'Secure — the target' };
  let elsewhere = 0, there = 0;
  for (let s = 0; s < 60; s++) {
    const o = L.generate(named, { approach: named.T.approach[s % named.T.approach.length].n }, { seed: s, mem: {} });
    const ref = L.folds(o, named).find(f => f.id === 'ref').lines.find(l => l.startsWith('- **Bands**'));
    const card = L.cardLines(o, named).join('\n'), note = L.noteBody(o, { pack: named });
    assert.equal((ref.match(/★/g) || []).length, o.targetBand === 'secure' ? 1 : 2, ref);
    if (o.targetBand === 'secure') { there++; assert.ok(ref.includes('Secure — the target ★') && !/usually/.test(ref + card + note), ref); }
    else {
      elsewhere++;
      const short = named.T.bandLabel[o.targetBand].split(' — ')[0];
      const secure = 'Secure — the target, usually (★ in ' + short + ' this time)';
      assert.ok(ref.includes(secure) && ref.includes(named.T.bandLabel[o.targetBand] + ' ★'), ref);
      assert.ok(!/### Secure — the target \(/.test(card) && card.includes('### ' + named.T.bandLabel[o.targetBand] + ' ★ ('), 'the room headings too');
      if (o.rooms.some(r => r.band === 'secure')) assert.ok(card.includes('### ' + secure + ' (') && note.includes('### ' + secure + '\n'), 'the Secure heading, card and note');
    }
  }
  assert.ok(elsewhere > 5 && there > 5, 'target seats: ' + elsewhere + ' elsewhere, ' + there + ' secure');
});

/* Byte-identity (the generator review, 16/10/2026): generate() is the vault's roll, so the fixes never change it. These
   digests were taken from location.js at 7fce4b9 over the fixture (every target x district x mix, 3 seeds each, then a
   200-roll run sharing one memory); a change here changes a stored roll. Change them only with the fixture.
   Schema 2 (21/10/2026) added fields and no draws: the digest is taken with those fields off, so it still holds. */
const LOC_DIGEST = '468 4cdf81bd0df501ed98ab409e986326e680b8a0a0f45f98f84cc1b94009c10476';
const preSchema2 = o => { o = clone(o); delete o.schema; for (const v of o.vectors) { delete v.room; delete v.level; delete v.means; } return o; };
await test('byte-identity: generate() over the fixture hashes to the digest taken before the review fixes', () => {
  const h = createHash('sha256');
  const T = FIX.T, targets = [''].concat(T.targetNames), districts = [''].concat(T.district.map(d => d[0]));
  const approaches = [''].concat(T.approach.map(a => a.n)), factions = [''].concat(T.faction.map(f => f[0]));
  let n = 0;
  for (const target of targets) for (const district of districts) for (const mix of [false, true]) for (let s = 0; s < 3; s++) {
    const opts = { target, district, mix, approach: approaches[(n + s) % approaches.length], faction: factions[(n * 7 + s) % factions.length] };
    h.update(JSON.stringify(preSchema2(L.generate(FIX, opts, { seed: (s * 2654435761 + n * 97) >>> 0, mem: {} }))) + '\n'); n++;
  }
  const mem = {};
  for (let i = 0; i < 200; i++) h.update(JSON.stringify(preSchema2(L.generate(FIX, { faction: factions[i % factions.length], mix: i % 3 === 0 }, { seed: i + 1, mem }))) + '\n');
  h.update(JSON.stringify(mem));
  assert.equal(n + ' ' + h.digest('hex'), LOC_DIGEST, 'the rolls changed');
});

/* Schema 2 (the map kit's INTEGRATION.md §3): the front carries no fields; the service side's room is the room its
   words name and one of the roll's rooms, or null; the back route has no room, and its level and means come from
   the circulation table beside each entry (the fixture's invented entries have none, so the vault's six are tried
   through a copy of the fixture that uses them). */
await test('schema 2: the ways in say where they land', () => {
  const VAULT_CIRC = ['circular stairs and ladders', 'a secret door', 'catwalks', 'skylights', 'a balcony', 'a cellar'];
  const LEVELS = ['roof', 'upper', 'street', 'below'];
  const P = { T: Object.assign({}, FIX.T, { circulation: VAULT_CIRC }), extra: FIX.extra };
  let rooms = 0, backs = 0;
  for (let s = 1; s <= 300; s++) {
    const o = L.generate(P, { mix: s % 3 === 0 }, { seed: s * 7919, mem: {} }), [f, sv, bk] = o.vectors;
    assert.equal(o.schema, 2);
    assert.ok(!('room' in f) && !('level' in f) && !('means' in f), 'the front needs nothing');
    if (sv.room !== null) {
      rooms++;
      assert.ok(o.rooms.some(r => r.name === sv.room), 'the service room is one of the roll\'s rooms');
      assert.equal('In through the ' + sv.room.toLowerCase() + '.', sv.how, 'and the one its words name');
    }
    assert.equal(bk.room, null);
    assert.ok(LEVELS.includes(bk.level) && typeof bk.means === 'string', 'the back route says its floor and means');
    assert.ok(VAULT_CIRC.some(c => bk.how.toLowerCase().startsWith(c)), bk.how);
    backs++;
  }
  assert.ok(rooms > 20 && backs === 300, 'service rooms named: ' + rooms);
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
  await test('REAL pack: panel keeps everything and SAY is player-safe', () => {
    let n = 0;
    for (const target of REAL.T.targetNames) for (let s = 0; s < 6; s++) {
      const o = L.generate(REAL, { target, mix: s % 2 === 0, approach: REAL.T.approach[s % 6].n }, { seed: s * 977 + 5, mem: {} });
      panelCheck(REAL, o, 'real#' + n); n++;
    }
    console.log('     ' + n + ' real rolls');
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
