// Unit test for app/gm/downtime.js (personal business: the downtime activities' scene prompts, and an overindulgence's cost).
// The tables are the module's own writing, so every check runs on them as committed; the book's purveyors come from
// app/content.js (B68Content.VICES), as the page passes them.
//   node checks/runtime/gm-downtime.test.mjs
import path from 'node:path';
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const D = require(path.join(ROOT, 'app', 'gm', 'downtime.js'));
const box = {}; box.window = box;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'content.js'), 'utf8'), box);
const CT = box.B68Content;

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const ACTS = ['indulge', 'recover', 'project', 'train', 'contact', 'heat', 'acquire'];
const PURVEYORS = [].concat(...CT.VICES.map((v) => v.purveyors));
/* text that went wrong: a slot left in, a value that was not there, doubled or orphaned punctuation, a clock marker */
const JUNK = /[{}]|undefined|null|NaN|\[object|\s\s|\s[.,:;!?]|(?<!\.)\.\.(?!\.)|\b(?:a|an) (?:a|an|the)\b|\|\|/;
const texts = (r) => r.meta.all.concat(r.meta.actions.map((a) => a.label), r.over ? r.over.options.flatMap((o) => [o.title, o.mech, o.md, o.source]) : []).filter(Boolean);

await test('check(): the built-in tables are complete; a broken replacement is named; create() refuses it', () => {
  assert.deepEqual(D.check(), []);
  assert.deepEqual(D.check({}), []);
  assert.deepEqual(D.check('nope'), ['T']);
  assert.deepEqual(D.check({ vice: { Faith: { lead: [] } } }), ['vice.Faith.lead']);
  assert.ok(D.check({ vice: { Cards: { lead: ['x'] } } }).includes('vice.Cards.hosts'), 'a new vice needs every table');
  assert.ok(D.check({ recover: { band: { '13': ['x'] } } }).includes('recover.healers'), 'a replaced activity table is checked whole');
  assert.ok(D.check({ over: [{ id: 'brag', title: 'Brag', mech: 'x' }] }).includes('over'), 'all four overindulgences');
  assert.throws(() => D.create({ T: { vice: { Faith: { lead: [] } } } }), /vice\.Faith\.lead/);
  const dt = D.create({ T: { vice: { Faith: { lead: ['{Host} waits at {place}.'] } } } });
  assert.equal(dt.roll({ act: 'indulge', vice: 'Faith', purveyor: 'Preceptor Aldo, the Sanctorium grand cathedral, Brightstone' }, { seed: 1 }).meta.text, 'Preceptor Aldo waits at the Sanctorium.', 'a replaced table is used');
});

await test('every activity, result and choice: 2,800 rolls with no broken text, each one replaying identically', () => {
  const dt = D.create({ vices: CT.VICES });
  let n = 0;
  for (const act of ACTS) for (let seed = 1; seed <= 400; seed++) {
    const ui = {
      act, who: seed % 3 ? 'Mags' : '', vice: seed % 9 ? CT.VICES[seed % CT.VICES.length].name : '', purveyor: seed % 4 ? PURVEYORS[seed % PURVEYORS.length] : '',
      res: act === 'indulge' ? (seed % 2 ? 'over' : '') : ['13', '45', '6', 'crit', ''][seed % 5], pick: ['', 'trouble', 'brag', 'lost', 'tapped'][seed % 5],
      attr: ['', 'Insight', 'Prowess', 'Resolve', 'Playbook'][seed % 5], rel: ['', 'friend', 'rival'][seed % 3], contact: seed % 2 ? 'Vanden, a lazy Bluecoat' : '',
      project: seed % 2 ? 'Build the still' : '', district: seed % 7 ? '' : 'Crowfoot'
    };
    const r = dt.roll(ui, { seed });
    for (const t of texts(r)) assert.ok(!JUNK.test(t), act + ' seed ' + seed + ': ' + t);
    assert.ok(r.lines.length >= 2 && r.lines[0].kind === 'want' && r.lines[0].md, 'a lead box first');
    const again = dt.replay(JSON.parse(JSON.stringify(r.replay)));
    assert.deepEqual(again.lines, r.lines, 'replay lines ' + act + ' ' + seed);
    assert.deepEqual(again.meta, r.meta, 'replay meta ' + act + ' ' + seed);
    assert.deepEqual(again.over, r.over, 'replay options ' + act + ' ' + seed);
    n++;
  }
  assert.equal(n, 2800);
});

await test('the memory keeps indices, stays small, and keeps a lead from coming back within half its list', () => {
  const mem = {}, dt = D.create({ mem });
  const leads = [];
  for (let i = 0; i < 200; i++) {
    const r = dt.roll({ act: ACTS[i % ACTS.length], vice: 'Gambling', res: '45' });
    if (i % ACTS.length === 0) leads.push(r.meta.text);
  }
  for (const k of Object.keys(mem)) assert.ok(mem[k].every((x) => Number.isInteger(x)), 'indices only: ' + k);
  assert.ok(JSON.stringify(mem).length < 4000, 'small: ' + JSON.stringify(mem).length);
  const win = Math.floor(D.TABLES.vice.Gambling.lead.length / 2);
  for (let i = win; i < leads.length; i++) assert.ok(!leads.slice(i - win, i).includes(leads[i]), 'a lead repeated within ' + win + ': ' + leads[i]);
});

await test('indulge: "Overindulged" and the option switch leave the scene above as it was; the cost line is bold, its scene under it', () => {
  const dt = D.create({ vices: CT.VICES });
  const base = { act: 'indulge', who: 'Mags', vice: 'Gambling', purveyor: 'Vesper, bookmaker at the Vreen Autodrome, Nightmarket' };
  const mem = { 'Gambling.lead': [2] };
  const plainRoll = dt.roll(base, { seed: 99, mem: JSON.parse(JSON.stringify(mem)) });
  assert.equal(plainRoll.over.shown, false);
  assert.ok(!plainRoll.lines.some((l) => l.id === 'over'), 'no cost line unless overindulged');
  assert.deepEqual(plainRoll.meta.chips, ['Indulged', 'Gambling']);
  for (const pick of ['trouble', 'brag', 'lost', 'tapped']) {
    const r = dt.roll(Object.assign({ res: 'over', pick }, base), { seed: 99, mem: JSON.parse(JSON.stringify(mem)) });
    assert.deepEqual(r.lines[0], plainRoll.lines[0], 'the scene stays (' + pick + ')');
    assert.deepEqual(r.lines.find((l) => l.id === 'more'), plainRoll.lines.find((l) => l.id === 'more'), 'the rows stay (' + pick + ')');
    assert.deepEqual(r.over.options, plainRoll.over.options, 'the four options are drawn whatever is picked');
    assert.equal(r.over.pick, pick);
    const o = r.over.options.find((x) => x.id === pick), line = r.lines[1];
    assert.equal(line.id, 'over', 'the cost comes straight under the scene');
    assert.ok(line.md.startsWith('**Overindulged: ' + o.title + '.**') && line.md.includes(o.mech), 'the mechanical line, in bold');
    assert.ok(line.small.startsWith(o.md), 'the scene prompt under it');
    assert.deepEqual(r.meta.chips, ['Overindulged', 'Gambling']);
    assert.match(r.meta.label, new RegExp('^Mags · Gambling · over: ' + o.title + '$'));
    if (pick === 'trouble') assert.ok(r.meta.actions.some((a) => a.intent.type === 'clock' && a.intent.name === o.clock.name && a.intent.size === o.clock.size), 'trouble offers its clock');
    if (pick === 'brag') assert.match(o.mech, /\+2 heat/);
    if (pick === 'tapped') {
      assert.match(o.mech, /^Vesper cuts you off/);
      const book = CT.VICES.find((v) => v.name === 'Gambling').purveyors;
      assert.ok(book.includes(o.source) && !/^Vesper/.test(o.source), 'a new source from the book, never the old one: ' + o.source);
      assert.ok(line.small.includes('A new source to find: ' + o.source));
    }
  }
  const drawn = dt.roll(Object.assign({ res: 'over' }, base), { seed: 99, mem: JSON.parse(JSON.stringify(mem)) });
  assert.ok(['trouble', 'brag', 'lost', 'tapped'].includes(drawn.over.pick), 'no pick: one is drawn');
});

await test('indulge: the sheet\'s vice and purveyor; curly or straight apostrophes; an unknown vice is drawn; no purveyor gets a stock one', () => {
  const dt = D.create({ vices: CT.VICES });
  for (const v of ['Gettin’ Fucked Up', "gettin' fucked up", 'GAMBLING']) {
    const r = dt.roll({ act: 'indulge', vice: v }, { seed: 5 });
    assert.ok(dt.VICES.includes(r.meta.chips[1]) && r.meta.chips[1].toLowerCase().replace(/’/g, "'") === v.toLowerCase().replace(/’/g, "'"), v + ' -> ' + r.meta.chips[1]);
  }
  assert.ok(dt.VICES.includes(dt.roll({ act: 'indulge', vice: 'Collecting stamps' }, { seed: 5 }).meta.chips[1]));
  const stock = dt.roll({ act: 'indulge', vice: 'Faith' }, { seed: 8 });
  const V = D.TABLES.vice.Faith, where = stock.lines.find((l) => l.id === 'more').rows[0].md;
  assert.ok(V.places.some((p) => where.toLowerCase().includes(p.toLowerCase())) && V.hosts.some((h) => where.includes(h)), where);
  assert.deepEqual(dt.VICES, Array.from(CT.VICES, (v) => v.name.replace('’', "'")), 'the seven vices, in the book\'s order');   // Array.from: the vm's arrays have another prototype
});

await test('purveyor(): every line in the book reads as a host and a place; typed lines too', () => {
  for (const p of PURVEYORS) {
    const x = D.purveyor(p);
    assert.ok(x.host && x.place, p + ' -> ' + JSON.stringify(x));
    assert.ok(!/^(?:a|an) /i.test(x.place) && !/\b(?:pilot|guide|dealer|player|construct|controller|handler|leader|bookmaker|librarian|president)\b/i.test(x.place), 'a place, not a role: ' + x.place);
  }
  assert.deepEqual(D.purveyor('Vesper, bookmaker at the Vreen Autodrome, Nightmarket'), { host: 'Vesper', place: 'the Vreen Autodrome', district: 'Nightmarket', near: '' });
  assert.deepEqual(D.purveyor('Karter, the Sky High casino, above Doskvol'), { host: 'Karter', place: 'the Sky High casino', district: '', near: 'above Doskvol' });
  assert.deepEqual(D.purveyor('Jimmy at the Rusty Anchor, Docks'), { host: 'Jimmy', place: 'the Rusty Anchor', district: 'the Docks', near: '' });
  assert.deepEqual(D.purveyor("Old Mo, Mo's Bar, crowfoot"), { host: 'Old Mo', place: "Mo's Bar", district: 'Crowfoot', near: '' });
  assert.deepEqual(D.purveyor('Aunt Bea'), { host: 'Aunt Bea', place: '', district: '', near: '' });
  assert.deepEqual(D.purveyor(''), { host: '', place: '', district: '', near: '' });
});

await test('the dice: recover and project carry the sheet\'s ticks (1 / 2 / 3 / 5); before the dice there are none', () => {
  const dt = D.create();
  const want = { '13': 1, '45': 2, '6': 3, crit: 5 };
  for (const [res, n] of Object.entries(want)) {
    assert.deepEqual(dt.roll({ act: 'recover', res }, { seed: 1 }).meta.chips, [D.BAND_LABEL[res], 'healing +' + n]);
    assert.deepEqual(dt.roll({ act: 'project', res }, { seed: 1 }).meta.chips, [D.BAND_LABEL[res], '+' + n + ' on the clock']);
    const lead = dt.roll({ act: 'recover', res }, { seed: 1 }).meta.text;
    assert.ok(D.TABLES.recover.band[res].some((t) => lead.endsWith(t.replace(/^\{Healer\}/, '').slice(-25))), 'the lead comes from the ' + res + ' list');
  }
  assert.deepEqual(dt.roll({ act: 'recover' }, { seed: 1 }).meta.chips, ['before the dice']);
  assert.deepEqual(dt.roll({ act: 'train', attr: 'Prowess' }, { seed: 1 }).meta.chips, ['Prowess', '+1 xp']);
  assert.equal(dt.roll({ act: 'recover', res: '7' }, { seed: 1 }).replay.ui.res, '', 'a result that is not one is dropped');
  assert.equal(dt.roll({ act: 'nope' }, { seed: 1 }).meta.act, 'indulge', 'an unknown activity reads as indulge');
});

await test('friend or rival: the sheet\'s contact by name; the clock a lead suggests becomes an action', () => {
  const dt = D.create();
  const r = dt.roll({ act: 'contact', who: 'Mags', contact: 'Vanden, a lazy Bluecoat', rel: 'rival' }, { seed: 4 });
  assert.equal(r.meta.title, 'Mags · Rival: Vanden');
  assert.equal(r.meta.sub, 'A lazy Bluecoat');
  assert.ok(r.meta.text.includes('Vanden'), r.meta.text);
  let clocks = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const x = dt.roll({ act: 'contact', contact: 'Vanden, a lazy Bluecoat', rel: 'friend' }, { seed });
    for (const a of x.meta.actions) { clocks++; assert.match(a.label, /^Start a clock: .*Vanden.* \(4\)$/); assert.equal(a.intent.type, 'clock'); }
  }
  assert.ok(clocks > 0, 'some friends bring a clock');
  assert.equal(dt.roll({ act: 'contact', rel: 'friend' }, { seed: 2 }).meta.title, 'Friend: An old friend');
});

await test('the module ships no rules text: no page references, no dice procedure beyond the sheet\'s own numbers', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'downtime.js'), 'utf8');
  assert.ok(!/\bp(?:age|p)?\.\s?\d+/i.test(src), 'no page references');
  for (const v of Object.values(D.TABLES.vice)) for (const k of ['lead', 'hook']) for (const t of v[k]) assert.ok(t.length <= 160, 'short enough to read at a glance: ' + t);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
