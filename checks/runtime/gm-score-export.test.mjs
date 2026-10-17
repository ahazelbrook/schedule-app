// Unit test for the score part of scripts/gm-pack.mjs (buildScore, layLocation, crossCheckScore) and the crew that buildCampaign reads
// from the crew sheet, on an INVENTED temp-dir vault: a score page in the real page's shape (written from the invented fixture tables),
// a location part in the real location page's shape (a district as a row, a district's factions as one comma-separated string) and
// crew sheets. Nothing from a real vault or pack. The app module rolls on what the exporter makes, so the two stay in step.
//   node checks/runtime/gm-score-export.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, 'app', 'gm', 'score.js'));
const Pack = await import(pathToFileURL(path.join(ROOT, 'scripts', 'gm-pack.mjs')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'score-pack.json'), 'utf8')).parts;
const T0 = FIX.score.T, LOC0 = T0.loc;
const { loc: _loc, ...TABLES } = T0;                      /* the tables the page holds: T.loc is not written in the vault */
const NOW = '2026-10-17T00:00:00.000Z';
const warned = () => { const w = Pack.exportWarnings.slice(); Pack.exportWarnings.length = 0; return w; };
const only = (w, re) => w.filter((m) => re.test(m));

/* the score page: a dataviewjs block, `const T = {};`, the tables, `// --- Machinery`, then the page's own roller */
function pageOf(T, extra) {
  const lines = ['---', 'wiki: reference', '---', '', '# Invented score page', '', '```dataviewjs', 'const T = {};'];
  for (const k of Object.keys(T)) lines.push('T.' + k + ' = ' + JSON.stringify(T[k]) + ';');
  lines.push('', '// --- Machinery -----------------------------------------------------', 'const pick = (a) => a[0];', 'dv.paragraph(pick(Object.keys(T.op)));', '```', '');
  return (extra && extra.before ? extra.before : '') + lines.join('\n');
}
/* the location part as the exporter builds it from the real location page */
function locationPart() {
  const gaz = {}, targetType = {};
  for (const d of LOC0.district) gaz[d] = { streets: 'Invented streets', named: ['A', 'B'], buildings: 'Invented buildings', landmarks: ['L'], notables: LOC0.gaz[d].notables.slice(), factions: LOC0.gaz[d].factions.join(', '), special: 'Invented special' };
  for (const t of LOC0.targetNames) targetType[t] = { theme: 'invented' };
  return { src: { file: 'x', blockSha: '1', exportedAt: NOW }, T: { district: LOC0.district.map((d) => [d, 'Low', 'Moderate', 'High', 'Low']), gaz, targetType, targetNames: LOC0.targetNames.slice(),
    factionDetail: clone(LOC0.factionDetail), factionThumb: clone(LOC0.factionThumb), faction: clone(T0.faction), physThreat: [['a', 'b']] }, extra: {} };
}
const SHEET = (o = {}) => ['---', 'wiki: reference', 'campaign: group', 'crew_type: ' + (o.type ?? 'Tunnellers'), 'crew_name: ' + (o.name ?? 'The Invented Crew'), 'tier: ' + (o.tier ?? 1), 'hold: weak',
  ...(o.noEnemies ? [] : ['enemies:', '  - "[[invented-dunmore|The Dunmore30 Firm]]"', '  - "[[The Ibex30 Crew]]"', '  - The Mott30 Firm']), ...(o.noAbilities ? [] : ['abilities:', '  - Tunnel rats', '  - "[[ability-dark-eyes|Dark eyes]]"']),
  'status: ' + (o.status ?? 'active'), ...(o.campaign ? ['campaign: ' + o.campaign] : []), '---', '', '# ' + (o.type ?? 'Tunnellers'), ''].join('\n');

function withVault(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-score-export-'));
  try {
    const root = path.join(dir, 'Wiki', 'Games', 'Blades in the Dark');
    for (const [rel, text] of Object.entries(files)) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
    fs.mkdirSync(path.join(root, 'Campaigns', 'Group'), { recursive: true });
    return fn(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const PAGE = 'Tools/blades-68-score-generator.md';

await test('layLocation: districts as names, a district\'s factions as a list, and only the fields the generator reads', () => {
  const lo = Pack.layLocation(locationPart().T);
  assert.deepEqual(lo, LOC0, 'the laid tables are the ones the module is documented to read');
  assert.deepEqual(Object.keys(lo.gaz[LOC0.district[0]]).sort(), ['factions', 'notables'], 'no streets, buildings or landmarks');
  assert.deepEqual(Pack.layLocation({ gaz: { 'Invented End': { factions: ' A , B,, C ', notables: ['n', 7, ''] } } }),
    { factionDetail: {}, factionThumb: {}, district: ['Invented End'], gaz: { 'Invented End': { factions: ['A', 'B', 'C'], notables: ['n'] } }, targetNames: [] }, 'no district list: the gazetteer\'s keys; a messy factions string is tidied');
  assert.deepEqual(Pack.layLocation({ district: ['Bare Name', ['Row Name', 'High']], targetType: { 'Invented Shop': {} } }).district, ['Bare Name', 'Row Name'], 'a bare name or a row');
  assert.deepEqual(Pack.layLocation({ targetType: { 'Invented Shop': {} } }).targetNames, ['Invented Shop'], 'the building types fall back to the keys of targetType');
  assert.deepEqual(Pack.layLocation({}), { factionDetail: {}, factionThumb: {}, district: [], gaz: {}, targetNames: [] });
});

await test('buildScore: the page\'s tables with the location part laid over them as T.loc; the module finds the pack complete and no warning is made', () => {
  warned();
  withVault({ [PAGE]: pageOf(TABLES) }, (dir) => {
    const part = Pack.buildScore(dir, NOW, locationPart());
    assert.equal(part.src.file, 'Wiki/Games/Blades in the Dark/' + PAGE + " (+ the location part's dossiers)");
    assert.match(part.src.blockSha, /^[0-9a-f]{64}$/); assert.equal(part.src.exportedAt, NOW);
    for (const k of Object.keys(TABLES)) assert.deepEqual(part.T[k], TABLES[k], 'the page\'s table ' + k + ' came through unchanged');
    assert.ok(!('pick' in part.T), 'the tables are cut at the Machinery marker');
    assert.deepEqual(part.T.loc, LOC0);
    assert.deepEqual(S.check(part.T), [], 'the app\'s own check finds the tables complete');
    assert.doesNotThrow(() => JSON.stringify(part));
  });
  assert.deepEqual(warned(), [], 'nothing to warn of');
});

await test('the app module rolls on what the exporter makes, with the crew the exporter reads from the sheet', () => {
  warned();
  withVault({ [PAGE]: pageOf(TABLES), 'Campaigns/Group/Tunnellers crew sheet.md': SHEET() }, (dir) => {
    const part = Pack.buildScore(dir, NOW, locationPart()), camp = Pack.buildCampaign(dir, NOW);
    assert.deepEqual(camp.crew, { name: 'The Invented Crew', type: 'Tunnellers', tier: 1, hold: 'weak', enemies: ['The Dunmore30 Firm', 'The Ibex30 Crew', 'The Mott30 Firm'], abilities: ['Tunnel rats', 'Dark eyes'] });
    const g = S.create({ T: part.T, campaign: camp }), names = new Set(part.T.faction.map((f) => f[0])), mem = {};
    let enemy = 0;
    for (let i = 1; i <= 300; i++) {
      const r = g.roll({ seed: i * 7919, mem, ui: { crew: camp.crew.type, tier: camp.crew.tier } });
      assert.equal(r.score.crew.type, 'Tunnellers'); assert.ok(names.has(r.score.target.name), r.score.target.name);
      assert.deepEqual(g.replay(r.replay).card, r.card); if (r.score.target.enemy) enemy++;
    }
    assert.ok(enemy > 0, 'the sheet\'s enemies are in play');
    const ctl = g.controls({ crew: camp.crew, npcs: [], nowIn: '' }, {}).filter((c) => c.id === 'target')[0];
    assert.ok(ctl.options.some((o) => o.value === 'enemy'), 'the Target picker offers the crew\'s enemies');
  });
  assert.deepEqual(only(warned(), /^score:|crew/), []);
});

await test('blockSha follows the page and the location part; an unchanged source gives the same part', () => {
  warned();
  withVault({ [PAGE]: pageOf(TABLES) }, (dir) => {
    const a = Pack.buildScore(dir, NOW, locationPart()), b = Pack.buildScore(dir, 'later', locationPart());
    assert.equal(a.src.blockSha, b.src.blockSha, 'the same sources, the same sha');
    assert.deepEqual(a.T, b.T);
    const lp = locationPart(); lp.T.factionDetail[Object.keys(lp.T.factionDetail)[0]].secret = 'Changed secret';
    assert.notEqual(Pack.buildScore(dir, NOW, lp).src.blockSha, a.src.blockSha, 'a changed dossier is a changed part');
    fs.appendFileSync(path.join(dir, 'Wiki', 'Games', 'Blades in the Dark', PAGE), '\nmore\n');
    assert.equal(Pack.buildScore(dir, NOW, locationPart()).src.blockSha, a.src.blockSha, 'prose outside the dataviewjs block is not the part');
    fs.writeFileSync(path.join(dir, 'Wiki', 'Games', 'Blades in the Dark', PAGE), pageOf({ ...TABLES, cost: ['one more cost'] }));
    assert.notEqual(Pack.buildScore(dir, NOW, locationPart()).src.blockSha, a.src.blockSha, 'a changed table is a changed part');
  });
  warned();
});

await test('no page: no part and a warning; no location part: no T.loc and a warning; a page that sets T.loc has it replaced, with a warning', () => {
  warned();
  withVault({}, (dir) => assert.equal(Pack.buildScore(dir, NOW, locationPart()), null));
  let w = warned(); assert.equal(w.length, 1); assert.match(w[0], /^score: Tools\/blades-68-score-generator\.md does not exist yet, so there is no score part/);
  withVault({ [PAGE]: pageOf(TABLES) }, (dir) => {
    const part = Pack.buildScore(dir, NOW, null);
    assert.ok(!('loc' in part.T)); assert.equal(part.src.file, 'Wiki/Games/Blades in the Dark/' + PAGE);
    w = warned(); assert.equal(w.length, 1); assert.match(w[0], /^score: there is no location part to lay/);
    const mine = Pack.buildScore(dir, NOW, locationPart());
    assert.notEqual(mine.src.blockSha, part.src.blockSha, 'the laid dossiers are in the sha');
  });
  warned();
  withVault({ [PAGE]: pageOf({ ...TABLES, loc: { district: ['Written Here'] } }) }, (dir) => {
    const part = Pack.buildScore(dir, NOW, locationPart());
    assert.deepEqual(part.T.loc, LOC0, 'the location part\'s wins');
    w = warned(); assert.equal(w.length, 1); assert.match(w[0], /^score: the page sets T\.loc; the location part's replaces it/);
  });
});

await test('warnings, one finding each: a table lacking, a faction master that differs, borrowed names the location page lacks', () => {
  warned();
  const run = (mut, lmut) => withVault({ [PAGE]: pageOf((() => { const T = clone(TABLES); mut && mut(T); return T; })()) }, (dir) => { const lp = locationPart(); lmut && lmut(lp.T); Pack.buildScore(dir, NOW, lp); return warned(); });
  assert.deepEqual(run(), [], 'the clean case');
  let w = run((T) => { delete T.why; delete T.op['Lift'].def; });
  assert.equal(w.length, 1); assert.match(w[0], /^score: the tables lack .*why/); assert.match(w[0], /op\.Lift\.def/);
  w = run(null, (L) => { L.faction[0][1] += 1; L.faction.pop(); L.faction.push(['The Invented Newcomers', 2, 'W']); });
  assert.equal(w.length, 1, w.join('|')); assert.match(w[0], /^score: T\.faction is not the location page's: 1 only here \(The Mott30 Firm\); 1 only there \(The Invented Newcomers\); 1 with another Tier or hold \(The Brisk30 Guild\)$/);
  w = run((T) => { T.site.place.push('Invented Pier'); T.holding['The Calp30 Crew'].push(['Calp Dock', 'Invented Pier', 'Nowhere Test']); T.holding['The Invented Outfit'] = [['Somewhere', 'Bank', '']]; T.districtRule['Elsewhere Test'] = { say: 'x', pay: 0, engage: 0, heat: 0 }; });
  assert.deepEqual(w, [
    'score: building types the location page lacks, so Roll the site would not match: Invented Pier',
    'score: T.holding names factions the faction master lacks: The Invented Outfit',
    'score: districts the location page lacks (in T.holding or T.districtRule): Nowhere Test, Elsewhere Test']);
  w = run(null, (L) => { L.gaz[L.district[0][0]].factions += ', The Invented Alias'; delete L.gaz[L.district[1][0]]; });
  assert.deepEqual(w, ["score: the location page's gazetteer names factions the faction master lacks: The Invented Alias", 'score: districts with no gazetteer entry on the location page: ' + LOC0.district[1]]);
  w = run((T) => { T.crew.Tunnellers.seeds[0].ops.push('Invented Op'); });
  assert.deepEqual(w, ['score: the tables lack crew.Tunnellers.seeds.0.ops.Invented Op'], "the app module's own check names a seed's unknown operation");
  w = run((T) => { for (let i = 0; i < 9; i++) T.site.place.push('Missing Type ' + i); });
  assert.match(w[0], /Missing Type 0, Missing Type 1, Missing Type 2, Missing Type 3, … \(\+5 more\)$/, 'a long list is cut');
});

await test('a page that cannot be read as tables stops the export (the scenes and location pages are treated the same)', () => {
  const must = (page, re, label) => withVault({ [PAGE]: page }, (dir) => assert.throws(() => Pack.buildScore(dir, NOW, locationPart()), re, label));
  const good = pageOf(TABLES);
  must(good.replace('```dataviewjs', '```js'), /score: no ```dataviewjs block found/, 'no dataviewjs block');
  must(good.replace('const T = {};', 'const U = {};'), /score: `const T = \{\};` not found/, 'no table object');
  must(good.replace('// --- Machinery', '// --- Gears'), /score: `\/\/ --- Machinery` not found/, 'no Machinery marker');
  must(good.replace('T.cost = ', 'T.cost = (() => { throw new Error("boom"); })() || '), /score: table statements threw: boom/, 'a statement that throws');
  must(good.replace('T.cost = ', 'T.cost = () => 1; T.unused = '), /score: non-JSON values in T would be dropped: T\.cost \(function\)/, 'a value that is not JSON');
  must(good.replace('\n```\n', '\n'), /score: the dataviewjs block is not closed/, 'an open block');
  const late = good.replace('dv.paragraph(', 'T.late = 1;\ndv.paragraph(');
  warned();
  withVault({ [PAGE]: late }, (dir) => { Pack.buildScore(dir, NOW, locationPart()); });
  assert.ok(only(warned(), /^score: `T\.x = \.\.\.` statements exist AFTER/).length === 1, 'a table written after the Machinery marker is flagged');
});

await test('crew: read from the active sheet with a crew_type, wikilinks reduced to their text; no sheet is null with a warning', () => {
  warned();
  withVault({ 'Campaigns/Group/Tunnellers crew sheet.md': SHEET(), 'Campaigns/Group/b68g-other.md': '---\nwiki: reference\nstatus: active\n---\nnot a crew\n' }, (dir) => {
    const c = Pack.buildCampaign(dir, NOW);
    assert.deepEqual(c.crew, { name: 'The Invented Crew', type: 'Tunnellers', tier: 1, hold: 'weak', enemies: ['The Dunmore30 Firm', 'The Ibex30 Crew', 'The Mott30 Firm'], abilities: ['Tunnel rats', 'Dark eyes'] });
    assert.match(c.src.file, /Campaigns\/Group\/ \(the crew sheet\)/); assert.match(c.src.file, /\(1 files\)$/, 'only the crew sheet is read of the notes here, and counted');
    const was = c.src.blockSha;
    fs.writeFileSync(path.join(dir, 'Wiki', 'Games', 'Blades in the Dark', 'Campaigns', 'Group', 'Tunnellers crew sheet.md'), SHEET({ tier: 2 }));
    const c2 = Pack.buildCampaign(dir, NOW); assert.equal(c2.crew.tier, 2); assert.notEqual(c2.src.blockSha, was, 'a changed sheet is a changed part');
  });
  assert.deepEqual(only(warned(), /crew/), []);
  withVault({}, (dir) => assert.equal(Pack.buildCampaign(dir, NOW).crew, null));
  let w = only(warned(), /crew/); assert.equal(w.length, 1); assert.match(w[0], /^campaign: no active note under Campaigns\/Group\/ has crew_type, so the campaign part has no crew$/);
  withVault({ 'Campaigns/Group/Old crew sheet.md': SHEET({ status: 'retired' }), 'Campaigns/Group/Solo crew sheet.md': SHEET({ campaign: 'solo' }) }, (dir) => assert.equal(Pack.buildCampaign(dir, NOW).crew, null, 'a retired sheet and a solo one are not the crew'));
  warned();
});

await test('crew: a sheet without enemies or abilities is a crew with none, and a warning; two sheets take the first; Tier and strings are tidied', () => {
  warned();
  withVault({ 'Campaigns/Group/A crew sheet.md': SHEET({ noEnemies: true, noAbilities: true, tier: 'x', name: '' }) }, (dir) => {
    const c = Pack.buildCampaign(dir, NOW);
    assert.deepEqual(c.crew, { name: '', type: 'Tunnellers', tier: 0, hold: 'weak', enemies: [], abilities: [] });
    const w = only(warned(), /crew sheet/); assert.equal(w.length, 2); assert.match(w[0], /has no `enemies:` property/); assert.match(w[1], /has no `abilities:` property/);
  });
  withVault({ 'Campaigns/Group/B crew sheet.md': SHEET({ type: 'Stagehands', tier: 3 }), 'Campaigns/Group/A crew sheet.md': SHEET() }, (dir) => {
    const c = Pack.buildCampaign(dir, NOW);
    assert.equal(c.crew.type, 'Tunnellers', 'the first by name');
    const w = only(warned(), /crew_type/); assert.equal(w.length, 1); assert.match(w[0], /^campaign: 2 active notes under Campaigns\/Group\/ have crew_type; the first \(A crew sheet\.md\) is the crew$/);
  });
  warned();
});

await test('crossCheckScore: the crew sheet\'s type, its enemies and the board\'s standing must be ones the tables know', () => {
  warned();
  const score = { T: TABLES };
  Pack.crossCheckScore(score, { crew: { type: 'tunnellers', enemies: ['The Dunmore30 Firm', 'the ibex30 crew'] }, standing: [{ faction: 'The Flit30 Crew', status: -2 }] });
  assert.deepEqual(warned(), [], 'a type and names match without case or a leading "the"');
  Pack.crossCheckScore(score, { crew: { type: 'Invented Unit', enemies: ['The Invented Outfit'] }, standing: [{ faction: 'The Other Invented Outfit', status: -1 }] });
  assert.deepEqual(warned(), [
    "score: the crew sheet's type (Invented Unit) has no row in T.crew (Tunnellers, Stagehands), so the Score tab has no seeds, favoured operations or ability notes for it",
    "score: the crew sheet's enemies the faction master lacks: The Invented Outfit",
    "score: the board's standing names factions the faction master lacks: The Other Invented Outfit"]);
  Pack.crossCheckScore(score, { crew: null, standing: [] });
  const w = warned(); assert.equal(w.length, 1); assert.match(w[0], /^score: the campaign part has no crew sheet/);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
