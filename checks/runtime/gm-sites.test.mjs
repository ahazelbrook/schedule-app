// Tests for the score sites' trip into the vault (GM.md "Score sites", SYNC.md "Pull"): lib/sync-sites.mjs files a location roll
// the GM saved against a score card as a location note and its map in Locations/, and links the card (site:); the path rules;
// and the whole pull through gm-sync.mjs on an in-memory D1. INVENTED data only: the fixture vault, a made-up score card and
// the fixture location tables (checks/runtime/fixtures/gm/location-pack.json).
//   node checks/runtime/gm-sites.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { run, parseArgs } from '../../scripts/gm-sync.mjs';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import * as V from '../../scripts/lib/vault.mjs';
import { pullSites, linkSite, fmValue, loadSiteKit } from '../../scripts/lib/sync-sites.mjs';
import { emptyCampaign } from '../../scripts/lib/ledger.mjs';
import { newReport, formatReport } from '../../scripts/lib/report.mjs';
import { patchState } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'vault');
const SCHEMA = path.join(ROOT, 'schema.sql');
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
const PK = { T: FIXL.T, extra: FIXL.extra };
const KIT = { L, K, pk: PK };

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* ---------- the invented table ---------- */
const KEY = 'b68g-score-goose', CARD = V.SCORES + '/' + KEY + '.md';
const CARD_TEXT = '﻿' + ['---', 'wiki: guide', 'tags:', '  - wiki/b68-score', 'status: draft', '---', '', '**Steal the goose.**', ''].join('\r\n');
const NOW = Date.parse('2026-10-18T01:00:00.000Z');                 // 12:00 on 18/10 in Melbourne
const rollOf = (seed, ui = {}) => L.generate(PK, ui, { seed, mem: {} });
function site(seed, extra = {}) {
  const r = rollOf(seed);
  return { seed, ui: {}, mem: '{}', name: r.name, district: r.district, label: 'F · The goose job', map: { view: 'plan', theme: 'blueprint' }, at: '2026-10-17T09:00:00.000Z', ...extra };
}
/* two seeds that give two different place names */
const S1 = 12345;
let S2 = 777; while (rollOf(S2).name === rollOf(S1).name) S2++;

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.writeFileSync(d, fs.readFileSync(s, 'utf8').replace(/\r\n/g, '\n'));
  }
}
function snapshot(dir) {
  const out = {};
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(d, e.name))).digest('hex');
    }
  })(dir, '');
  return out;
}
const bases = [];
function makeVault() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b68 sites ')); bases.push(base);
  const vault = path.join(base, "Alex's Vault (sites)");
  copyDir(FIXTURE, vault);
  write(vault, CARD, CARD_TEXT);
  return vault;
}
function write(vault, rel, text) { const f = V.abs(vault, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
const read = (vault, rel) => fs.readFileSync(V.abs(vault, rel), 'utf8');
const locRel = (name, ext = 'md') => V.LOCATIONS + '/' + name + '.' + ext;
const exists = (vault, rel) => fs.existsSync(V.abs(vault, rel));
function ctxFor(vault, doc, o = {}) {
  return { vault, doc, ledger: o.ledger || emptyCampaign(), report: newReport(), dryRun: !!o.dry, now: NOW, root: ROOT, privateDir: o.priv || path.join(vault, '..', 'no private dir') };
}

/* =================================================================================================================== */
await test('paths: Locations/ takes a new .md or .svg and nothing deeper; the site link only goes into a score card in Scores/', async () => {
  assert.equal(V.assertWritable(V.LOCATIONS + '/The Gilded Pike.md'), V.LOCATIONS + '/The Gilded Pike.md');
  assert.equal(V.assertWritable(V.LOCATIONS + '/The Gilded Pike.svg'), V.LOCATIONS + '/The Gilded Pike.svg');
  for (const bad of [V.LOCATIONS + '/deeper/x.md', V.LOCATIONS + '/x.png', V.LOCATIONS + '/.x.md', CARD]) assert.throws(() => V.assertWritable(bad), undefined, bad);
  assert.equal(V.assertSiteWritable(CARD), CARD);
  for (const bad of [V.GROUP + '/b68g-s02-pocket-scores.md', V.SCORES + '/deeper/x.md', V.GROUP + '/b68g-factions.md', V.LOCATIONS + '/x.md', 'TTRPG/x.md'])
    assert.throws(() => V.assertSiteWritable(bad), undefined, bad);
});

await test('linkSite: added before the closing ---; replaced with anything indented under it; null when it already says so; CRLF kept', async () => {
  const crlf = ['---', 'a: 1', '---', 'body'].join('\r\n');
  assert.equal(linkSite(crlf, '\r\n', 'The Pike'), ['---', 'a: 1', 'site: "[[The Pike]]"', '---', 'body'].join('\r\n'));
  const listed = ['---', 'site:', '  - "[[Old]]"', '  - "[[Older]]"', 'b: 2', '---', ''].join('\n');
  assert.equal(linkSite(listed, '\n', 'New'), ['---', 'site: "[[New]]"', 'b: 2', '---', ''].join('\n'));
  assert.equal(linkSite(linkSite(crlf, '\r\n', 'The Pike'), '\r\n', 'The Pike'), null);
  assert.throws(() => linkSite('no frontmatter\n', '\n', 'x'), /no frontmatter/);
  assert.equal(fmValue('---\nscore: "[[b68g-score-goose]]"\nsite_seed: 12\n---\n', 'score'), '[[b68g-score-goose]]');
  assert.equal(fmValue('---\nscore: x\n---\n', 'site_seed'), null);
});

await test('pull: a dry run writes nothing and says what it would do', async () => {
  const vault = makeVault(), before = snapshot(vault), c = ctxFor(vault, { sites: { [KEY]: site(S1) } }, { dry: true });
  pullSites(c, KIT);
  assert.deepEqual(snapshot(vault), before);
  assert.deepEqual(c.report.filed.map((f) => [f.kind, f.id, f.dry]), [['site', KEY, true], ['sitelink', KEY, true]]);
  const out = formatReport(c.report, { mode: 'pull', campaign: 'default', dryRun: true }).join('\n');
  assert.ok(out.includes('Score sites (app -> vault)') && out.includes('would create Locations/' + rollOf(S1).name + '.md and its map, the site for ' + KEY) && out.includes('would link ' + KEY + '.md'), out);
});

await test('pull: a saved site becomes a location note and its map; the card gets site: (BOM and CRLF kept); one log entry; a second run changes nothing', async () => {
  const vault = makeVault(), r = rollOf(S1), c = ctxFor(vault, { sites: { [KEY]: site(S1) } });
  const logBefore = read(vault, V.LOG);
  pullSites(c, KIT);
  assert.deepEqual(c.report.refused, []);
  const note = read(vault, locRel(r.name)), svg = read(vault, locRel(r.name, 'svg'));
  assert.equal(fmValue(note, 'wiki'), 'entity'); assert.equal(fmValue(note, 'score'), '[[' + KEY + ']]'); assert.equal(fmValue(note, 'site_seed'), String(S1));
  assert.ok(/\n {2}- wiki\/location\n/.test(note), 'the Locations base lists it');
  assert.ok(note.includes('# ' + r.name + '\n\n![[' + r.name + '.svg]]\n'), 'the map under the title');
  assert.ok(note.includes('- **18/10/2026 (app):** the site for [[' + KEY + '|F · The goose job]], saved in the GM app.'), 'the In play line');
  assert.ok(note.indexOf('the site for [[') > note.indexOf('## In play') && note.indexOf('the site for [[') < note.indexOf('Rolled from'), 'inside In play');
  assert.ok(/^<svg[\s>]/.test(svg.trim()));
  const ids = (s) => s.replace(/b68m\d+-/g, 'b68m-');                // the kit numbers its ids per render
  assert.equal(ids(svg), ids(K.render(r, { view: 'plan', theme: 'blueprint', layer: 'gm', reveal: ['public', 'working', 'controlled', 'secure'], width: 1400 }).svg), 'the GM layer, in the view and theme saved with the site');
  assert.notEqual(ids(svg), ids(K.render(r, { view: 'rings', theme: 'rulebook', layer: 'gm', reveal: ['public'], width: 1400 }).svg));
  const card = fs.readFileSync(V.abs(vault, CARD));
  assert.deepEqual([...card.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM stays');
  assert.equal(card.toString('utf8').slice(1), CARD_TEXT.slice(1).replace('status: draft\r\n', 'status: draft\r\nsite: "[[' + r.name + ']]"\r\n'), 'one line added, CRLF');
  assert.deepEqual(c.ledger.sites[KEY].seed, S1);
  const log = read(vault, V.LOG);
  assert.ok(log.startsWith(logBefore) && (log.match(/## \[18\/10\/2026\] sync \| GM app: 1 score site\n/g) || []).length === 1, log.slice(logBefore.length));
  assert.ok(log.includes('[[' + r.name + ']] for [[' + KEY + '|F · The goose job]]'));
  const snap = snapshot(vault), c2 = ctxFor(vault, { sites: { [KEY]: site(S1) } });
  pullSites(c2, KIT);
  assert.deepEqual(snapshot(vault), snap, 'byte-identical');
  assert.deepEqual(c2.report.skipped.map((s) => [s.kind, s.why]), [['site', 'already in the vault']]);
  assert.deepEqual(c2.report.filed, []);
});

await test('pull: a link removed by hand comes back; a site saved again gets a new note and the link moves; the old note stays', async () => {
  const vault = makeVault(), a = rollOf(S1), b = rollOf(S2);
  pullSites(ctxFor(vault, { sites: { [KEY]: site(S1) } }), KIT);
  write(vault, CARD, read(vault, CARD).replace(/site: .*\r\n/, ''));
  const c = ctxFor(vault, { sites: { [KEY]: site(S1) } }); pullSites(c, KIT);
  assert.ok(read(vault, CARD).includes('site: "[[' + a.name + ']]"'), 'relinked'); assert.deepEqual(c.report.filed.map((f) => f.kind), ['sitelink']);
  const c2 = ctxFor(vault, { sites: { [KEY]: site(S2) } }); pullSites(c2, KIT);
  assert.ok(exists(vault, locRel(a.name)) && exists(vault, locRel(a.name, 'svg')), 'the old note and map stay');
  assert.ok(exists(vault, locRel(b.name)), 'a new note for the new roll');
  const card = read(vault, CARD);
  assert.ok(card.includes('site: "[[' + b.name + ']]"') && !card.includes(a.name), 'the link moved');
  assert.equal((card.match(/^site:/gm) || []).length, 1);
});

await test('pull: refusals: no card, the tables changed, no local pack; a card outside Scores/ gets its note but not the link', async () => {
  const vault = makeVault(), before = snapshot(vault);
  let c = ctxFor(vault, { sites: { 'b68g-score-nobody': site(S1) } }); pullSites(c, KIT);
  assert.match(c.report.refused[0].why, /no score card named b68g-score-nobody\.md/);
  c = ctxFor(vault, { sites: { [KEY]: site(S1, { name: 'Somewhere Else Entirely' }) } }); pullSites(c, KIT);
  assert.match(c.report.refused[0].why, /tables changed/);
  c = ctxFor(vault, { sites: { [KEY]: site(S1) } }); pullSites(c);            // no kit injected, no pack on disk
  assert.match(c.report.refused[0].why, /cannot replay it: no local pack/);
  c = ctxFor(vault, { sites: { [KEY]: { seed: 'x' }, 'a/b': site(S1) } }); pullSites(c, KIT);
  assert.equal(c.report.refused.length, 2);
  assert.deepEqual(snapshot(vault), before, 'nothing written by any of them');
  write(vault, V.GROUP + '/b68g-score-loose.md', '---\ntags: [wiki/b68-score]\n---\n');
  c = ctxFor(vault, { sites: { 'b68g-score-loose': site(S1) } }); pullSites(c, KIT);
  assert.ok(exists(vault, locRel(rollOf(S1).name)), 'the note is filed');
  assert.match(c.report.refused[0].why, /not linked: not a score card/);
  assert.ok(!read(vault, V.GROUP + '/b68g-score-loose.md').includes('site:'));
});

await test('pull: a place name already taken in the vault (a note or a map anywhere) gets " (location)"', async () => {
  const vault = makeVault(), r = rollOf(S1);
  write(vault, 'Personal/' + r.name + '.md', '# Somebody\n');
  const c = ctxFor(vault, { sites: { [KEY]: site(S1) } }); pullSites(c, KIT);
  assert.ok(exists(vault, locRel(r.name + ' (location)')) && exists(vault, locRel(r.name + ' (location)', 'svg')));
  assert.ok(read(vault, CARD).includes('site: "[[' + r.name + ' (location)]]"'));
  assert.ok(read(vault, locRel(r.name + ' (location)')).includes('![[' + r.name + ' (location).svg]]'));
  const v2 = makeVault(); write(v2, 'Wiki/Games/Blades in the Dark/NPCs/figures/' + r.name + '.svg', '<svg/>');
  pullSites(ctxFor(v2, { sites: { [KEY]: site(S1) } }), KIT);
  assert.ok(exists(v2, locRel(r.name + ' (location)')), 'an svg of that name elsewhere counts too');
});

await test('gm-sync: --only sites reads the state from D1, loads the kit from the local pack, files the site and prints it; the run log holds no place name', async () => {
  const vault = makeVault(), base = path.dirname(vault), priv = path.join(base, "gm private 'dir'"), r = rollOf(S1);
  fs.mkdirSync(priv, { recursive: true });
  fs.writeFileSync(path.join(priv, 'b68-gm-pack.json'), JSON.stringify({ format: 1, parts: { location: { src: {}, T: FIXL.T, extra: FIXL.extra } } }));
  const exec = await memoryExec({ schemaFile: SCHEMA });
  await patchState(asD1(exec), 'default', { sites: { [KEY]: site(S1) } });
  const out = [];
  const res = await run({ ...parseArgs(['pull', '--only', 'sites']), vault, privateDir: priv, exec, now: NOW, print: (s) => out.push(s), root: ROOT });
  const text = out.join('\n');
  assert.equal(res.code, 0, text);
  assert.ok(exists(vault, locRel(r.name)) && read(vault, CARD).includes('site: "[[' + r.name + ']]"'));
  assert.ok(text.includes('Score sites (app -> vault)') && text.includes('created Locations/' + r.name + '.md and its map') && text.includes('linked ' + KEY + '.md to its site'), text);
  const log = fs.readFileSync(path.join(priv, 'sync-log.jsonl'), 'utf8');
  assert.ok(log.includes(KEY) && !log.includes(r.name), 'ids and file names only');
  const led = JSON.parse(fs.readFileSync(path.join(priv, 'sync-ledger.json'), 'utf8'));
  assert.equal(led.campaigns.default.sites[KEY].seed, S1);
  assert.ok(!loadSiteKit(ROOT, path.join(priv, 'nope.json')).L && loadSiteKit(ROOT, path.join(priv, 'b68-gm-pack.json')).L);
});

for (const b of bases) fs.rmSync(b, { recursive: true, force: true });
console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
