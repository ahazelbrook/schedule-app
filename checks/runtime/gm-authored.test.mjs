// Tests for authored sites (GM.md, "Authored sites"): a hand-built location in a vault note's ```json b68-site block, carried in
// the location part (scripts/lib/authored-export.mjs), bound to a score card by its site:, and drawn by the GM page as a base
// roll with the patch laid over it (gm-page.js authoredRoll). INVENTED data only: a made-up site in a temporary vault and the
// fixture location tables (checks/runtime/fixtures/gm/location-pack.json).
//   node checks/runtime/gm-authored.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildAuthored, parseSite, siteLink, LOCATIONS_REL, SCORES_REL } from '../../scripts/lib/authored-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* ---------- the invented site ---------- */
const PATCH = {
  name: 'The Goose House', district: 'Nowhere Ward', styleName: 'Old relic',
  rooms: [
    { name: 'The grand lobby', band: 'public' }, { name: 'Main floor', band: 'public' },
    { name: 'Kitchens', band: 'working' }, { name: 'Private card rooms', band: 'controlled' },
    { name: 'Luxury penthouse', band: 'secure', isTarget: true },
  ],
  vectors: [{ n: 'The front', how: 'A door on the square.', know: 'free', room: 'The grand lobby', level: 'street', means: 'door' }],
  skips: [{ from: 'Kitchens', to: 'Luxury penthouse', via: 'a goose chute' }],
  physThreatName: 'Heron', socThreatName: 'Egret',
};
const BLOCK = (j) => '```json b68-site\n' + JSON.stringify(j) + '\n```';
const NOTE = (j) => ['---', 'wiki: entity', '---', '# The Goose House', '', 'Some prose.', '', BLOCK(j), ''].join('\n');
const CARD = (site) => ['---', 'wiki: guide', 'tags:', '  - wiki/b68-score', 'site: "[[' + site + ']]"', '---', '', '**Steal the goose.**', ''].join('\r\n');

function tmpVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-authored-'));
  fs.mkdirSync(path.join(v, ...LOCATIONS_REL.split('/')), { recursive: true });
  fs.mkdirSync(path.join(v, ...SCORES_REL.split('/')), { recursive: true });
  return v;
}
const put = (v, rel, text) => fs.writeFileSync(path.join(v, ...rel.split('/')), text);

/* ---------- the exporter ---------- */
test('siteLink reads the frontmatter link, quoted or not, alias and heading off', () => {
  assert.equal(siteLink(CARD('The Goose House')), 'The Goose House');
  assert.equal(siteLink('---\nsite: [[A b|c]]\n---\n'), 'A b');
  assert.equal(siteLink('---\nsite: "[[X#y]]"\n---'), 'X');
  assert.equal(siteLink('no frontmatter\nsite: [[X]]'), '');
  assert.equal(siteLink('---\nwiki: x\n---\nsite: [[X]]'), '');
});

test('parseSite: a note without the block is not a site; a bad block says why', () => {
  assert.equal(parseSite('# just a note', 'n', 'r'), null);
  assert.match(parseSite(BLOCK({}).replace('{}', '{ nope'), 'n', 'r').why, /not valid JSON/);
  assert.match(parseSite(BLOCK({ rooms: [] }), 'n', 'r').why, /no "patch"/);
  assert.match(parseSite(BLOCK({ patch: { rooms: [] } }), 'n', 'r').why, /1 to 40 rooms/);
  assert.match(parseSite(BLOCK({ patch: { rooms: [{ name: 'A', band: 'vip' }] } }), 'n', 'r').why, /band/);
  assert.match(parseSite(BLOCK({ base: { seed: 1.5 }, patch: PATCH }), 'n', 'r').why, /base.seed/);
});

test('parseSite: base and map are kept in a fixed shape; a bad view or theme is dropped', () => {
  const r = parseSite(BLOCK({ base: { seed: 7, ui: { target: 'Casino' }, mem: { a: [1] } }, patch: PATCH, map: { view: 'section', theme: 'nope' } }), 'The Goose House', 'x/The Goose House.md');
  assert.deepEqual(r.site.base, { seed: 7, ui: { target: 'Casino' }, mem: '{"a":[1]}' });
  assert.deepEqual(r.site.map, { view: 'section' });
  assert.equal(r.site.name, 'The Goose House');
  assert.equal(r.site.patch.rooms.length, 5);
});

test('buildAuthored: sites from Locations/, bound to the score cards whose site: names them (any case)', () => {
  const v = tmpVault(), warns = [];
  put(v, LOCATIONS_REL + '/The Goose House.md', NOTE({ patch: PATCH }));
  put(v, LOCATIONS_REL + '/A rolled place.md', '---\nscore: "[[x]]"\nsite_seed: 4\n---\n# A rolled place\n');
  put(v, LOCATIONS_REL + '/Broken.md', BLOCK({ patch: { rooms: 'no' } }));
  put(v, SCORES_REL + '/b68g-score-goose.md', CARD('the goose house'));
  put(v, SCORES_REL + '/b68g-score-other.md', CARD('A rolled place'));
  const a = buildAuthored({ vault: v, warn: (w) => warns.push(w) });
  assert.deepEqual(Object.keys(a.sites), ['The Goose House']);
  assert.deepEqual(a.bind, { 'b68g-score-goose': 'The Goose House' });
  assert.equal(a.sites['The Goose House'].rel, LOCATIONS_REL + '/The Goose House.md');
  assert.equal(warns.length, 1); assert.match(warns[0], /Broken skipped/);
  fs.rmSync(v, { recursive: true, force: true });
});

test('buildAuthored: no authored site, no key (null)', () => {
  const v = tmpVault();
  put(v, LOCATIONS_REL + '/Plain.md', '# Plain\n');
  assert.equal(buildAuthored({ vault: v }), null);
  fs.rmSync(v, { recursive: true, force: true });
});

/* ---------- the GM page ---------- */
const PK = { T: FIXL.T, extra: FIXL.extra, authored: { v: 1, sites: { 'The Goose House': { name: 'The Goose House', rel: 'x', patch: PATCH } }, bind: { 'b68g-score-goose': 'The Goose House' } } };
const SITE = PK.authored.sites['The Goose House'];

test('authoredRoll: the patch over a base roll; the same roll every time; auth names it', () => {
  const r = P.authoredRoll(L, PK, SITE), r2 = P.authoredRoll(L, PK, SITE);
  assert.equal(r.name, 'The Goose House');
  assert.equal(r.auth, 'The Goose House');
  assert.deepEqual(r.rooms.map((x) => x.name), PATCH.rooms.map((x) => x.name));
  assert.deepEqual(r.areas, PATCH.rooms.map((x) => x.name));
  assert.equal(r.targetRoom, 'Luxury penthouse'); assert.equal(r.targetBand, 'secure');
  assert.deepEqual(r.skips, PATCH.skips);
  assert.ok(typeof r.seed === 'number', 'the base roll\'s seed rides along');
  assert.ok(r.streetType, 'the base gives the street the card reads');
  assert.equal(JSON.stringify(r), JSON.stringify(r2));
  assert.notEqual(SITE.patch.rooms, r.rooms, 'the patch is copied, never shared');
});

test('authoredRoll: a base seed is the base; no patch skips or vectors drops the base\'s (they name its rooms)', () => {
  const lean = { name: 'Lean', patch: { rooms: [{ name: 'Main floor', band: 'public' }, { name: 'A vault', band: 'secure' }] }, base: { seed: 1234, ui: {}, mem: '{}' } };
  const r = P.authoredRoll(L, PK, lean), base = L.generate(PK, {}, { seed: 1234, mem: {} });
  assert.equal(r.seed, base.seed);
  assert.equal(r.name, 'Lean');
  assert.deepEqual(r.skips, []);
  const rooms = new Set(r.rooms.map((x) => x.name));
  (r.vectors || []).forEach((v) => assert.ok(!v.room || rooms.has(v.room), 'a way in names a room of the patch, or none: ' + v.room));
  assert.ok(!r.targetRoom || rooms.has(r.targetRoom), 'the target is a room of the patch, or none');
});

test('authoredRoll: nothing to draw is null, never a throw', () => {
  assert.equal(P.authoredRoll(L, PK, null), null);
  assert.equal(P.authoredRoll(L, PK, { name: 'x', patch: { rooms: [] } }), null);
  assert.equal(P.authoredRoll(null, PK, SITE), null);
});

test('locKey and rollKey: an authored card and its roll match; a seeded card matches its roll; the two never match each other', () => {
  const r = P.authoredRoll(L, PK, SITE);
  assert.equal(P.locKey({ auth: 'The Goose House' }), P.rollKey(r));
  assert.equal(P.locKey({ seed: 5 }), 5); assert.equal(P.rollKey({ seed: 5 }), 5);
  assert.notEqual(P.locKey({ seed: r.seed }), P.rollKey(r));
  assert.equal(P.locKey(null), undefined);
});

test('authoredOf: the part\'s authored, or empty maps', () => {
  assert.deepEqual(P.authoredOf({ T: {} }), { sites: {}, bind: {} });
  assert.equal(P.authoredOf(PK).bind['b68g-score-goose'], 'The Goose House');
});

test('the card and the map take an authored roll: glance, folds, player summary, note, every view', () => {
  const r = P.authoredRoll(L, PK, SITE);
  assert.equal(L.glance(r, PK, ['public']).title, 'The Goose House');
  assert.ok(L.folds(r, PK, ['public']).length);
  assert.ok(L.playerSummary(r, ['public']).title);
  assert.match(L.noteBody(r, { date: '01/01/2026', pack: PK }), /The Goose House/);
  for (const view of ['rings', 'plan', 'iso', 'section']) assert.match(K.render(r, { view, layer: 'gm' }).svg, /^\s*<svg/);
});

test('Show on iPad\'s player map never names a hidden room of an authored site, at every reveal', () => {
  const r = P.authoredRoll(L, PK, SITE), steps = [['public'], ['public', 'working'], ['public', 'working', 'controlled']];
  for (const reveal of steps) {
    const map = { layer: 'player', view: 'iso', theme: 'rulebook', reveal: {} };
    reveal.forEach((b) => { map.reveal[b] = true; });
    const d = P.playerDisplay(r, map, K.render);
    assert.deepEqual(P.leaks(d.svg, r, d.reveal), [], 'nothing hidden at ' + reveal.join('+'));
    const text = P.svgText(d.svg);
    assert.ok(text.length > 0, 'the player map has words at ' + reveal.join('+'));
    assert.ok(!/Heron/.test(d.svg) && !/Egret/.test(d.svg), 'no threat name at ' + reveal.join('+'));
    assert.ok(!/a goose chute/.test(d.svg) || reveal.includes('working'), 'no hidden skip at ' + reveal.join('+'));
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
