// gm-glance-crew (RK20 of the room key build, setting gm.glance): the crew at a glance. No browser, no network.
//   node checks/runtime/gm-glance-crew.test.mjs
// 1. The module's builders on INVENTED data (the Dovetail Crew, checks/runtime/fixtures/gm/glance-crew.mjs): a PC's Stress/Drain, harm by level, deadlocked keys, xp and stacks;
//    the crew's type, preferred operations, upgrades, cohorts, claims, project clocks, Heat, Wanted, Rep and Stacks, read from the real playbook text (app/crews.js).
// 2. The panel keeps what the old Crew box had (h3.gm-band "Crew: ...", dl.gm-stats with the five .gm-stat cells, the session line and the #t link), escapes what a player typed,
//    and shows no "undefined" or "NaN".
// 3. It is read-only (it writes nothing), repaints only when something it shows changed, and asks for the crews bundle once, only when B68Crews is missing.
// 4. GM-ONLY: its files are in the gm-glance bundle alone, and no phone, display or table file names it. glance.css holds nothing under 12 px and no C1 control character.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CREW, CLOCKS, RAW, PCS, slim } from './fixtures/gm/glance-crew.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const APP = path.join(ROOT, 'app');
const M = require(path.join(APP, 'gm', 'glance-crew.js'));
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const win = {}; win.self = win; win.window = win;
vm.runInNewContext(read('crews.js'), win, { filename: 'app/crews.js' });
const Crews = win.B68Crews;
assert.ok(Crews && Crews.byId.shadows, 'the real playbook text loads');
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

await test('gm-glance-crew: the module is filled (no longer a stub) and exposes create and the builders', () => {
  assert.ok(M && !M.stub, 'not a stub');
  for (const k of ['create', 'crewModel', 'pcModel', 'html', 'hash']) assert.equal(typeof M[k], 'function', k);
  const w = {}; w.self = w; w.window = w;
  vm.runInNewContext(read('gm/glance-crew.js'), w, { filename: 'app/gm/glance-crew.js' });
  assert.equal(typeof w.B68GmGlanceCrew.create, 'function', 'as a plain script it defines window.B68GmGlanceCrew');
});

await test('gm-glance-crew: a PC: Stress n/max, harm by level in the player\'s words (worst first), deadlocked keys, xp n/8, stacks', () => {
  const nell = M.pcModel(PCS[0]);
  assert.equal(nell.name, 'Nell Arbuthnot'); assert.equal(nell.playbook, 'Hound');
  assert.equal(nell.stressName, 'Stress'); assert.equal(nell.stress, 5); assert.equal(nell.stressMax, 9); assert.equal(nell.full, false);
  assert.deepEqual(nell.harm.map((h) => h.lv + ' ' + h.name + ': ' + h.text), ['3 Critical: Broken arm', '2 Major: Cracked jaw', '1 Passing: Bruised ribs']);
  assert.deepEqual(nell.locks, ['KEY-1'], 'only the deadlocked key, not KEY-2');
  assert.equal(nell.xp, 4); assert.equal(nell.xpMax, 8); assert.equal(nell.stacks, 2); assert.equal(nell.fresh, false);
  const tam = M.pcModel(PCS[2]);
  assert.equal(tam.stress, 9); assert.equal(tam.full, true, 'full Stress is flagged'); assert.deepEqual(tam.harm, []); assert.deepEqual(tam.locks, []);
  const ray = M.pcModel(PCS[1]); assert.deepEqual(ray.harm.map((h) => h.lv), [2]);
});
await test('gm-glance-crew: a Hull reads Drain and level 4 is Destroyed; a new sheet says so; a PC with no facts does not throw', () => {
  const hull = M.pcModel(slim({ id: 'h', name: 'Dov Kessler', playbook: 'hull', playbookName: 'Hull', play: { stress: 3, harm: { l4: 'Core breach' }, xp: { playbook: 1 } } }, { stressName: 'Drain', stressMax: 10 }));
  assert.equal(hull.stressName, 'Drain'); assert.equal(hull.stressMax, 10); assert.equal(hull.harm[0].name, 'Destroyed');
  const fresh = M.pcModel({ id: 'f', name: 'Lotte Brand', playbook: 'veteran', glance: { play: {}, facts: { fresh: true } } });
  assert.equal(fresh.fresh, true); assert.match(M.html({ crew: M.crewModel({}, {}), pcs: [fresh] }), /new sheet/);
  for (const bad of [null, {}, { id: 'x' }, { id: 'x', glance: null }, { id: 'x', glance: { facts: 5 } }]) assert.doesNotThrow(() => M.pcModel(bad));
});

await test('gm-glance-crew: the crew: type, preferred operations (the playbook\'s list and the write-in grounds), upgrades, cohorts, claims, project clocks, Heat, Wanted, Rep, Stacks', () => {
  const m = M.crewModel(CREW, { Crews, clocks: CLOCKS, session: 4 });
  assert.equal(m.type, 'Shadows'); assert.equal(m.known, true); assert.equal(m.tier, 1); assert.equal(m.hold, 'strong');
  assert.deepEqual(m.ops, Crews.byId.shadows.preferred.ops); assert.equal(m.grounds.label, 'Hunting grounds'); assert.deepEqual(m.grounds.list, ['The ferry quays']);
  assert.equal(m.upgrades.length, 4);
  for (const u of ['Hidden', 'Vault 1/2', 'Insight', 'Multifaceted (+1 key/deadlock) 2/3']) assert.ok(m.upgrades.includes(u), 'upgrade ' + u + ' in ' + m.upgrades.join(' | '));
  assert.deepEqual(m.cohorts.map((c) => [c.name, c.type, c.harm, c.armor]), [['The Lamplighters', 'gang', 'weak', true], ['Ada Vell', 'Forger', '', false]]);
  assert.equal(m.claims.n, 4, 'four held, the Base cell not counted'); assert.deepEqual(m.claims.names, ['Turf ×2', 'Informants', 'Lounge Bar']);
  assert.deepEqual(m.projects.map((p) => [p.name, p.filled, p.size, p.hidden]), [['Buy the ferry office', 3, 8, false], ['GM-ONLY-PROJECT: the quiet ledger', 1, 6, true]], 'project clocks only, the hidden one marked');
  assert.deepEqual([m.heat, m.wanted, m.rep, m.stacks, m.vault, m.session], [3, 1, 5, 6, 6, 4]);
});
await test('gm-glance-crew: with no playbook text (the crews bundle not in yet) it falls back to crew.type and says the operations are not known; a legacy claims array and junk do not throw', () => {
  const m = M.crewModel(Object.assign({}, CREW, { playbook: '', preferred: [], claims: [{ name: 'Dockside lock-up', held: true }, { name: 'Gone', held: false }] }), { Crews: null, clocks: [], session: 1 });
  assert.equal(m.type, 'Shadows'); assert.equal(m.known, false); assert.deepEqual(m.ops, []);
  assert.deepEqual(m.claims.names, ['Dockside lock-up']); assert.ok(m.upgrades.includes('Hidden'));
  assert.match(M.html({ crew: m, pcs: [] }), /not known/);
  for (const bad of [null, undefined, 5, [], { heat: 'x', cohorts: [1, null, {}], upgrades: 4, claims: 7, preferred: 'no' }]) assert.doesNotThrow(() => M.crewModel(bad, { Crews, clocks: 'no' }));
});

await test('gm-glance-crew: the recap reads off one panel (harm, stacks, crew type, preferred operations), and keeps the old Crew box\'s hooks', () => {
  const h = M.html({ crew: M.crewModel(CREW, { Crews, clocks: CLOCKS, session: 4 }), pcs: PCS.map(M.pcModel) }), t = text(h);
  assert.match(h, /^<section class="gm-box gl-crew" id="gl-crew" data-sig="[0-9a-z]+"/, 'one box, one id, a signature');
  assert.match(h, /<h3 class="gm-band">Crew: The Dovetail Crew<\/h3>/, 'the old band text');
  assert.equal((h.match(/class="gm-stat"/g) || []).length, 5, 'the five stat cells');
  for (const [k, v] of [['Heat', '3/9'], ['Wanted', '1/4'], ['Rep', '5/12'], ['Stacks', '6'], ['Vault', '6/16']]) assert.ok(new RegExp(k + ' ' + v.replace('/', ' ?/')).test(t), k + ' ' + v + ' in: ' + t);
  assert.match(h, /<a href="#t">the table<\/a>/); assert.match(t, /Session 4 · read-only here; change it on the table/);
  for (const s of ['Shadows', 'Tier 1', 'strong hold', 'Surveillance', 'Heists', 'Subterfuge', 'Cleanup', 'Hunting grounds: The ferry quays', 'Vault 1/2', 'Hidden', 'The Lamplighters', 'gang', 'weak', 'armor', 'Ada Vell',
    '4 held', 'Turf ×2', 'Informants', 'Buy the ferry office', '3/8', 'hidden from players']) assert.ok(t.includes(s), 'the panel shows ' + s + ' in: ' + t);
  assert.ok(!t.includes('Win back the marker'), 'a progress clock is not a project clock');
  for (const s of ['Nell Arbuthnot', 'Hound', 'Stress 5/9', 'XP 4/8', 'Stacks 2', '3 Critical Broken arm', '2 Major Cracked jaw', '1 Passing Bruised ribs', 'Deadlocks KEY-1',
    'Ray Okonjo', 'Stress 2/9', 'XP 6/8', 'Tam Petrakis', 'Stress 9/9 full', 'No harm']) assert.ok(t.includes(s), 'the panel shows ' + s + ' in: ' + t);
  assert.ok(h.indexOf('Ray Okonjo') > h.indexOf('Nell Arbuthnot'), 'the PCs in the order given');
  assert.ok(!/undefined|NaN|\[object/.test(h), 'no undefined, NaN or [object]');
  assert.equal((h.match(/<li class="gl-crew-pc/g) || []).length, 3, 'three PCs');
  assert.ok(/is-hot" data-pc="char_gl1"/.test(h) && /is-hot" data-pc="char_gl3"/.test(h) && !/is-hot" data-pc="char_gl2"/.test(h), 'Nell (Critical harm, a deadlock) and Tam (full Stress) are marked; Ray is not');
});
await test('gm-glance-crew: what a player or the table typed is escaped; the PC list is capped at eight', () => {
  const evil = Object.assign({}, CREW, { name: '<img src=x onerror=GL1>', preferred: ['<script>GL2</script>'] });
  const pc = slim({ id: 'p"x', name: '<b>GL3</b>', playbook: 'hound', playbookName: 'Hound', play: { stress: 1, harm: { l3: '<u onclick=GL4>' }, keys: [{ name: '<i>GL5</i>', deadlock: 'up' }] } });
  const h = M.html({ crew: M.crewModel(evil, { Crews, clocks: [{ kind: 'project', name: '<s>GL6</s>', size: 4, filled: 1 }] }), pcs: [M.pcModel(pc)] });
  assert.ok(!/<img|<script|<b>GL3|<u onclick|<i>GL5|<s>GL6/.test(h), 'no raw tag from the data');
  for (const g of ['GL1', 'GL2', 'GL3', 'GL4', 'GL5', 'GL6']) assert.ok(h.includes(g), g + ' is shown, as text');
  assert.ok(h.includes('data-pc="p&quot;x"'), 'an id is escaped in its attribute');
  const many = M.html({ crew: M.crewModel(CREW, { Crews }), pcs: Array.from({ length: 11 }, (_, i) => M.pcModel(slim(Object.assign({}, RAW[1], { id: 'q' + i, name: 'Mabel ' + i })))) });
  assert.equal((many.match(/<li class="gl-crew-pc/g) || []).length, 8); assert.match(many, /\+3 more on the Players tab/);
});

// a minimal DOM: one #gl-crew element whose outerHTML can be replaced
function fakeRoot(initial) {
  const root = { html: initial, swaps: 0 };
  const el = { getAttribute: (k) => (k === 'data-sig' ? (/data-sig="([^"]+)"/.exec(root.html) || [])[1] : null) };
  Object.defineProperty(el, 'outerHTML', { set(v) { root.html = v; root.swaps++; } });
  root.querySelector = (sel) => (sel === '#gl-crew' && root.html ? el : null);
  return root;
}
await test('gm-glance-crew: create(host): read-only, sync() repaints only when what it shows changed, and nothing is written', () => {
  let camp = { crew: CREW, clocks: CLOCKS, session: { number: 4 } }; const pcs = PCS.map((p) => JSON.parse(JSON.stringify(p))); let calls = 0;
  const host = { campaign: () => camp, pcs: () => pcs, crews: () => Crews, need: () => { calls++; return Promise.resolve(); }, again: () => { calls++; }, patch: () => { calls++; }, save: () => { calls++; } };
  const g = M.create(host), s0 = g.sig(), root = fakeRoot(g.html());
  assert.equal(g.sync(root), false, 'unchanged: no swap'); assert.equal(root.swaps, 0); assert.equal(g.sig(), s0);
  pcs[0].glance.facts.stress = 6; pcs[0].glance.play.stress = 6;
  assert.notEqual(g.sig(), s0, 'a stress tick moves the signature');
  assert.equal(g.sync(root), true, 'changed: one swap'); assert.equal(root.swaps, 1); assert.match(text(root.html), /Stress 6\/9/);
  assert.equal(g.sync(root), false, 'and then it is settled again');
  camp = Object.assign({}, camp, { crew: Object.assign({}, CREW, { heat: 4 }) });
  assert.equal(g.sync(root), true, 'a crew change swaps too'); assert.match(text(root.html), /Heat 4 ?\/9/);
  assert.equal(g.sync({ querySelector: () => null }), false, 'no panel in the rail: nothing to do');
  assert.equal(calls, 0, 'it called neither patch, save, need nor again while B68Crews was there');
});
await test('gm-glance-crew: with B68Crews missing it asks for the crews bundle ONCE, and draws the rail again when it is in', async () => {
  const asked = []; let again = 0;
  const g = M.create({ campaign: () => ({ crew: CREW }), pcs: () => PCS, crews: () => null, need: (n) => { asked.push(n); return Promise.resolve(n); }, again: () => { again++; } });
  g.html(); g.html(); g.sig(); g.model();
  assert.deepEqual(asked, ['crews'], 'one request, for the crews bundle'); await Promise.resolve(); await Promise.resolve();
  assert.equal(again, 1, 'the rail drew again once');
  assert.ok(M.create({ campaign: () => ({ crew: CREW }), pcs: () => PCS, crews: () => Crews, need: () => { throw new Error('asked'); } }).html().length > 100, 'with the playbook text in, no request');
  assert.doesNotThrow(() => M.create({ campaign: () => null, pcs: () => { throw new Error('boom'); } }).html(), 'no campaign and a failing PC list still draw');
  assert.doesNotThrow(() => M.create({}).html(), 'a bare host');
});

await test('gm-glance-crew: GM-only: the files are in the gm-glance bundle alone, and no phone, display, table or core file names the module', () => {
  const w = {}; w.self = w; w.window = w; vm.runInNewContext(read('routes.js'), w, { filename: 'app/routes.js' });
  const B = w.B68Load.BUNDLES;
  assert.deepEqual(Object.keys(B).filter((n) => B[n].includes('gm/glance-crew.js')), ['gm-glance'], 'gm/glance-crew.js is in exactly one bundle');
  assert.deepEqual(Object.keys(B).filter((n) => B[n].includes('gm/glance.css')), ['gm-glance']);
  const NAMED = /B68GmGlanceCrew|glance-crew/, allowed = new Set(['gm-page.js', 'gm/glance-crew.js', 'routes.js']);
  for (const [name, list] of Object.entries(B)) for (const f of list) if (f.endsWith('.js') && !allowed.has(f)) assert.ok(!NAMED.test(read(f)), name + ': ' + f + ' names the glance module');
  for (const f of ['boot.js', 'display-page.js', 'sw.js', 'index.html']) assert.ok(!NAMED.test(read(f)), f + ' names the glance module');
  for (const n of ['core', 'display', 'table', 'print', 'phone-glance', 'phone-find', 'handouts', 'room-intro']) assert.ok(B[n] && !B[n].some((f) => /^gm\/glance/.test(f)), n + ' has no gm/glance file');
  assert.ok(/B68GmGlanceCrew/.test(read('gm-page.js')), 'the GM page is the one reader');
});
await test('gm-glance-crew: glance.css: nothing under 12 px, no C1 control character, every rule on a .gl- class, kit rules scoped under the desk and unlayered', () => {
  const css = read('gm/glance.css'), bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/[\u0080-\u009f]/.test(css), 'no U+0080 to U+009F');
  const sizes = [...bare.matchAll(/font(?:-size)?\s*:\s*(?:[0-9]+\s+)?([0-9.]+)px/g)].map((m) => +m[1]); assert.ok(sizes.length > 10 && sizes.every((n) => n >= 12), 'every font size is 12 px or more: ' + sizes.join(','));
  assert.ok(!/!important|@layer/.test(bare), 'no !important and no @layer');
  for (const rule of bare.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean)) for (const sel of rule.split(',')) assert.ok(/^(#gm-page|:root\[data-kit~="desk"\] #gm-page) \.gl-/.test(sel.trim()), 'a rule outside the .gl- classes: ' + sel.trim());
  const js = read('gm/glance-crew.js'); assert.ok(![...js.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].some((m) => m[1].length > 220), 'no string literal over 220 characters');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
