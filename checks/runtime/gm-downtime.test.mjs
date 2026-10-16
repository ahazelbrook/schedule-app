// Unit test for app/gm/downtime.js (personal business: the downtime activities' scene prompts, and the Morning After's
// Benefits and Mishaps) on its tables, app/downtime-tables.js (original writing, committed), the book's purveyors from
// app/content.js (B68Content.VICES), as the page has them, and an invented pair of morning tables (the real ones are the
// vault's, never committed).
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
const X = require(path.join(ROOT, 'app', 'downtime-tables.js'));
const T = X.T, mk = (cfg) => D.create(Object.assign({ T, places: X.PLACES }, cfg || {}));
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
const texts = (r) => r.meta.all.concat(r.meta.actions.map((a) => a.label), r.morning ? r.morning.cards.flatMap((c) => [c.title, c.md, c.play, c.cost && c.cost.mech, c.source]) : []).filter(Boolean);

await test('check(): the tables are complete; a pack\'s broken replacement is named; create() refuses it and needs the tables', () => {
  assert.deepEqual(D.check(T), []);
  assert.deepEqual(D.check(T, {}), []);
  assert.deepEqual(D.check(), ['T']);
  assert.deepEqual(D.check(T, 'nope'), ['pack']);
  assert.deepEqual(D.check(T, { vice: { Faith: { lead: [] } } }), ['vice.Faith.lead']);
  assert.ok(D.check(T, { vice: { Cards: { lead: ['x'] } } }).includes('vice.Cards.hosts'), 'a new vice needs every table');
  assert.ok(D.check(T, { recover: { band: { '13': ['x'] } } }).includes('recover.healers'), 'a replaced activity table is checked whole');
  assert.ok(D.check(T, { over: [{ id: 'brag', title: 'Brag', mech: 'x' }] }).includes('over'), 'all six overindulgences');
  assert.ok(D.check(T, { over: T.over.filter((o) => o.id !== 'brawl') }).includes('over'), 'brawl is one of the six');
  assert.deepEqual(D.check(T, { benefit: 'not a table', mishap: 7, good: [] }), [], 'the morning tables are optional and never block the cards');
  assert.ok(Object.values(T.vice).every((V) => !('over' in V)), 'the vices carry no overindulgence lines now: the Mishaps name the cost');
  assert.ok(!('benefit' in T) && !('mishap' in T), 'and no morning tables: those live only in the pack');
  assert.throws(() => mk({ pack: { vice: { Faith: { lead: [] } } } }), /vice\.Faith\.lead/);
  assert.throws(() => D.create({}), /the tables are required/);
  const dt = mk({ pack: { vice: { Faith: { lead: ['{Host} waits at {place}.'] } } } });
  assert.equal(dt.roll({ act: 'indulge', vice: 'Faith', purveyor: 'Preceptor Aldo, the Sanctorium grand cathedral, Brightstone' }, { seed: 1 }).meta.text, 'Preceptor Aldo waits at the Sanctorium.', 'a replaced table is used');
});

/* invented morning tables, as a pack part carries them (the real ones are the vault's, never committed): three bands, roll high */
const ent = (lo, hi, band, title, md, play, cost) => ({ lo, hi, band, title, md, play, cost });
const BEN = [
  ent(1, 10, '01–30 · Small', 'The biscuit', 'A baker at {place} hands you a biscuit. *"Mind the crumbs."* **Nothing much.**', 'who baked it?'),
  ent(11, 20, '01–30 · Small', 'The penny', '{Host} flips you a penny. *"Heads you win."* **A penny.**', 'what is it for?'),
  ent(21, 30, '01–30 · Small', 'The umbrella', 'Somebody lends you an umbrella. *"Bring it back dry."* **Dry feet.**', ''),
  ent(31, 50, '31–70 · Middling', 'The word', 'A neighbour stops you. *"I heard a thing."* **One answer, free.**', 'what thing?'),
  ent(51, 60, '31–70 · Middling', 'The tab', '{Host} waves your money away. *"Paid."* **A stack.**', 'who paid?'),
  ent(61, 70, '31–70 · Middling', 'The lift', 'A driver idles at the kerb. *"Hop in."* **A free ride.**', 'where to?'),
  ent(71, 90, '71–00 · Big', 'The medal', 'A clerk pins a medal on you. *"For services."* **Standing.**', 'what services?'),
  ent(91, 100, '71–00 · Big', 'The jackpot', 'Everyone cheers at {place}. *"Again!"* **Keep both cards.**', 'the best moment?')
];
const MIS = [
  ent(1, 20, '01–50 · Bad', 'The cell', 'You wake in a cell. *"Talk."* **Attract Trouble: a questioning.**', 'talk, or not?'),
  ent(21, 35, '01–50 · Bad', 'The bill', 'A bill comes for a window. *"Pay up."* **Bad Decision: the glazier\'s clock.**', 'whose window?'),
  ent(36, 50, '01–50 · Bad', 'The lost week', 'You come round on a beach. *"Morning, sleepyhead."* **Bender.**', 'what happened?'),
  ent(51, 70, '51–00 · Silly', 'The song', 'A busker sings about you. *"Here they are!"* **Brag: +2 Heat.**', 'take a bow?'),
  ent(71, 85, '51–00 · Silly', 'The scuffle', 'A man with a pie is cross. *"My pie!"* **Brawl: −1 status with the bakers, or level 2 harm.**', 'apologise?'),
  ent(86, 100, '51–00 · Silly', 'The door', '{Host} shuts the door on you at {place}. *"Not tonight."* **Tapped.**', 'who got there first?')
];
const MORN = { benefit: BEN, mishap: MIS };

await test('every activity, result and choice: 5,600 rolls with no broken text, each one replaying identically', () => {
  let n = 0;
  for (const pack of [undefined, MORN]) {
    const dt = mk({ vices: CT.VICES, pack });
    for (const act of ACTS) for (let seed = 1; seed <= 400; seed++) {
      const ui = {
        act, who: seed % 3 ? 'Mags' : '', vice: seed % 9 ? CT.VICES[seed % CT.VICES.length].name : '', purveyor: seed % 4 ? PURVEYORS[seed % PURVEYORS.length] : '',
        res: act === 'indulge' ? (seed % 2 ? 'over' : '') : ['13', '45', '6', 'crit', ''][seed % 5],
        d100: ['', String(seed % 100 + 1), '00', '0', '101', 'x'][seed % 6], keep: ['', 'roll', 'alt', 'nope'][seed % 4], deal: ['', '1', '7', '200'][(seed >> 2) % 4],
        attr: ['', 'Insight', 'Prowess', 'Resolve', 'Playbook'][seed % 5], rel: ['', 'friend', 'rival'][seed % 3], contact: seed % 2 ? 'Vanden, a lazy Bluecoat' : '',
        project: seed % 2 ? 'Build the still' : '', district: seed % 7 ? '' : 'Crowfoot'
      };
      const r = dt.roll(ui, { seed });
      for (const t of texts(r)) assert.ok(!JUNK.test(t), act + ' seed ' + seed + ': ' + t);
      assert.ok(r.lines.length >= 2 && r.lines[0].kind === 'want' && r.lines[0].md, 'a lead box first');
      if (act !== 'indulge') assert.deepEqual([r.replay.ui.d100, r.replay.ui.keep, r.replay.ui.deal, 'morning' in r], ['', '', '', false], 'only an indulgence has a morning');
      else assert.ok(['', '100'].concat(Array.from({ length: 100 }, (_, i) => String(i + 1))).includes(r.replay.ui.d100), 'a d100 or nothing: ' + r.replay.ui.d100);
      const again = dt.replay(JSON.parse(JSON.stringify(r.replay)));
      assert.deepEqual(again.lines, r.lines, 'replay lines ' + act + ' ' + seed);
      assert.deepEqual(again.meta, r.meta, 'replay meta ' + act + ' ' + seed);
      assert.deepEqual(again.morning, r.morning, 'replay morning ' + act + ' ' + seed);
      n++;
    }
  }
  assert.equal(n, 5600);
});

await test('the memory keeps indices, stays small, and keeps a lead from coming back within half its list', () => {
  const mem = {}, dt = mk({ mem });
  const leads = [];
  for (let i = 0; i < 200; i++) {
    const r = dt.roll({ act: ACTS[i % ACTS.length], vice: 'Gambling', res: '45' });
    if (i % ACTS.length === 0) leads.push(r.meta.text);
  }
  for (const k of Object.keys(mem)) assert.ok(mem[k].every((x) => Number.isInteger(x)), 'indices only: ' + k);
  assert.ok(JSON.stringify(mem).length < 4000, 'small: ' + JSON.stringify(mem).length);
  const win = Math.floor(T.vice.Gambling.lead.length / 2);
  for (let i = win; i < leads.length; i++) assert.ok(!leads.slice(i - win, i).includes(leads[i]), 'a lead repeated within ' + win + ': ' + leads[i]);
});

const BASE = { act: 'indulge', who: 'Mags', vice: 'Gambling', purveyor: 'Vesper, bookmaker at the Vreen Autodrome, Nightmarket' };
const morningIds = (r) => r.lines.filter((l) => /^morning/.test(l.id)).map((l) => l.id);

await test('the morning after, before the d100: the night only, a box to type it in; the table follows "Overindulged"', () => {
  const dt = mk({ vices: CT.VICES, pack: MORN });
  const night = dt.roll(BASE, { seed: 99, mem: {} });
  assert.deepEqual(night.over, { shown: false });
  assert.deepEqual(night.morning, { table: 'benefit', has: true, n: 0, band: '', keep: '', deal: 0, size: 8, cards: [] }, 'no d100 yet: the Benefits, no cards');
  assert.deepEqual(morningIds(night), [], 'and no morning line: the page draws the box');
  assert.deepEqual(night.lines.map((l) => l.id), ['lead', 'more']);
  assert.deepEqual(night.meta.chips, ['Indulged', 'Gambling']); assert.equal(night.meta.label, 'Mags · Gambling');
  const over = dt.roll(Object.assign({ res: 'over' }, BASE), { seed: 99, mem: {} });
  assert.deepEqual([over.over.shown, over.morning.table, over.morning.size], [true, 'mishap', 6], 'overindulged: the Mishaps');
  assert.deepEqual(over.lines[0], night.lines[0], 'the same scene'); assert.deepEqual(over.lines.find((l) => l.id === 'more'), night.lines.find((l) => l.id === 'more'), 'and the same rows');
  assert.deepEqual(over.meta.chips, ['Overindulged', 'Gambling']); assert.equal(over.meta.label, 'Mags · Gambling · overindulged');
  assert.deepEqual(over.meta.actions.length, night.meta.actions.length, 'the only clock a card offers is its hook\'s');
});

await test('the d100 lands on its entry and deals a second from the same band; 0 and 00 are 100; nothing above moves; the label names the card', () => {
  const dt = mk({ vices: CT.VICES, pack: MORN });
  const night = dt.roll(BASE, { seed: 7, mem: {} });
  for (const [d, title, band] of [['1', 'The biscuit', '01–30 · Small'], ['15', 'The penny', '01–30 · Small'], ['50', 'The word', '31–70 · Middling'], ['100', 'The jackpot', '71–00 · Big'], ['00', 'The jackpot', '71–00 · Big'], ['0', 'The jackpot', '71–00 · Big']]) {
    const r = dt.roll(Object.assign({ d100: d }, BASE), { seed: 7, mem: {} }), m = r.morning;
    assert.equal(m.cards[0].title, title, d + ' lands on ' + title);
    assert.deepEqual([m.cards[0].which, m.cards[1].which, m.band], ['roll', 'alt', band]);
    assert.ok(BEN[m.cards[1].i].band === band && m.cards[1].i !== m.cards[0].i, 'the second card is another from the same band');
    assert.deepEqual(r.lines[0], night.lines[0], 'the scene stays'); assert.deepEqual(r.lines.at(-1), night.lines.at(-1), 'and the rows');
    assert.deepEqual(morningIds(r), ['morning', 'morning2'], 'both cards, under the scene, while neither is kept');
    assert.equal(r.meta.chips[2], 'Benefit ' + (d === '0' || d === '00' ? '100' : d.padStart(2, '0')));
    assert.equal(r.meta.label, 'Mags · Gambling · ' + title, 'the label names the card rolled');
    assert.ok(r.lines[1].md.startsWith('**Benefit ' + m.cards[0].range + ' · ' + title + '.** ') && r.lines[2].md.startsWith('**Or ' + m.cards[1].range + ' · '), r.lines[1].md);
  }
  const r = dt.roll(Object.assign({ d100: '93' }, BASE), { seed: 7, mem: {} });
  assert.deepEqual([r.morning.cards[0].range, r.morning.cards[1].range], ['91–00', '71–90'], 'a two-card band: the other one');
  assert.ok(!/[{}]/.test(r.morning.cards[0].md) && /the Vreen Autodrome/.test(r.morning.cards[0].md), 'its slots filled from the purveyor: ' + r.morning.cards[0].md);
  assert.equal(r.morning.cards[0].play, 'the best moment?');
  assert.deepEqual(dt.roll(Object.assign({ d100: '101' }, BASE), { seed: 7 }).replay.ui.d100, '', 'not a d100: dropped');
  assert.equal(D.d100(' 07 '), '7'); assert.deepEqual(['00', '0', '100', '1'].map(D.d100), ['100', '100', '100', '1']); assert.deepEqual(['', 'x', '101', '-3', '4.5', '1000'].map(D.d100), ['', '', '', '', '', '']);
  /* a gap in a table: the entry below it; a number below the first entry: the first */
  const gap = mk({ pack: { benefit: [ent(10, 20, 'A', 'Low', 'Low. *"x"* **y.**', ''), ent(40, 60, 'A', 'High', 'High. *"x"* **y.**', '')] } });
  assert.deepEqual(['30', '5', '99'].map((d) => gap.roll({ act: 'indulge', d100: d }, { seed: 1 }).morning.cards[0].title), ['Low', 'Low', 'High']);
});

await test('Keep folds to one card; Another walks the band; the second card reads the memory and never writes it; remember() writes both', () => {
  const dt = mk({ vices: CT.VICES, pack: MORN });
  const both = dt.roll(Object.assign({ d100: '45' }, BASE), { seed: 5, mem: {} });
  const keepAlt = dt.roll(Object.assign({ d100: '45', keep: 'alt' }, BASE), { seed: 5, mem: {} });
  assert.deepEqual(keepAlt.morning.cards, both.morning.cards, 'keeping changes no card');
  assert.deepEqual(morningIds(keepAlt), ['morning'], 'one card in the lines: the one kept');
  assert.ok(keepAlt.lines[1].md.includes(both.morning.cards[1].title) && keepAlt.meta.label.endsWith(both.morning.cards[1].title), 'the alternative, kept, is the card and the label');
  assert.equal(dt.roll(Object.assign({ keep: 'roll' }, BASE), { seed: 5 }).replay.ui.keep, '', 'no d100: nothing to keep');
  /* Another: the band's others in turn, then round again */
  const seen = [];
  for (let k = 0; k < 4; k++) seen.push(dt.roll(Object.assign({ d100: '45', deal: String(k) }, BASE), { seed: 5, mem: {} }).morning.cards[1].title);
  assert.deepEqual(new Set(seen.slice(0, 2)).size, 2, 'two others in the band, two different cards: ' + seen);
  assert.deepEqual(seen.slice(2), seen.slice(0, 2), 'then round again');
  assert.ok(!seen.includes(both.morning.cards[0].title), 'never the card rolled');
  /* the memory: an index the guard has seen is dealt last; the roll never writes the morning into it */
  const mem = { 'morning.benefit': [] }, r1 = dt.roll(Object.assign({ d100: '45' }, BASE), { seed: 5, mem });
  assert.deepEqual(mem['morning.benefit'], [], 'the roll wrote no morning card');
  const alt = r1.morning.cards[1].i, other = [3, 4, 5].find((i) => i !== alt && i !== r1.morning.cards[0].i);
  const r2 = dt.roll(Object.assign({ d100: '45' }, BASE), { seed: 5, mem: { 'morning.benefit': [alt] } });
  assert.equal(r2.morning.cards[1].i, other, 'a card the guard has seen comes after the fresh one');
  const m = {};
  assert.equal(dt.remember(r1, m), true); assert.deepEqual(m['morning.benefit'].sort(), [r1.morning.cards[0].i, alt].sort(), 'remember(): both cards');
  assert.equal(dt.remember(r1, m), false, 'not twice');
  assert.equal(dt.remember(dt.roll(BASE, { seed: 5 }), m), false, 'no d100: nothing to remember');
  for (let i = 0; i < 20; i++) dt.remember({ morning: { table: 'benefit', n: 1, size: 8, cards: [{ i }] } }, m);
  assert.equal(m['morning.benefit'].length, 4, 'the window is half the table');
  assert.equal(dt.remember(r1), true); assert.ok(Array.isArray(dt.mem()['morning.benefit']), 'with no memory given: the instance\'s');
});

await test('a Mishap names its cost: the book\'s mechanical line beside it (in our words); Tapped brings a new source from the book', () => {
  const dt = mk({ vices: CT.VICES, pack: MORN });
  const at = (d) => dt.roll(Object.assign({ res: 'over', d100: d }, BASE), { seed: 3, mem: {} }).morning.cards[0];
  const want = { 10: 'trouble', 30: 'decision', 40: 'lost', 60: 'brag', 80: 'brawl', 99: 'tapped' };
  for (const [d, id] of Object.entries(want)) {
    const c = at(d), o = T.over.find((x) => x.id === id);
    assert.deepEqual([c.cost.id, c.cost.title], [id, o.title], d + ': ' + id);
    if (id === 'brag') assert.match(c.cost.mech, /\+2 heat/);
    if (id === 'decision') assert.match(c.cost.mech, /ticks a clock of their choice/);
    if (id === 'brawl') assert.match(c.cost.mech, /−1 status with their faction, or mark level 2 harm/);
    if (id === 'trouble') assert.ok(!/entanglement/.test(c.cost.mech) && /Crew or Local Trouble/.test(c.cost.mech), '\'68 has no entanglements: ' + c.cost.mech);
    if (id === 'lost') assert.match(c.cost.mech, /harm healed/);
    if (id === 'tapped') {
      assert.match(c.cost.mech, /^Vesper cuts you off/);
      const book = CT.VICES.find((v) => v.name === 'Gambling').purveyors;
      assert.ok(book.includes(c.source) && !/^Vesper/.test(c.source), 'a new source from the book, never the old one: ' + c.source);
    } else assert.equal(c.source, '', 'a new source only for Tapped');
  }
  const line = dt.roll(Object.assign({ res: 'over', d100: '99', keep: 'roll' }, BASE), { seed: 3, mem: {} }).lines[1];
  assert.ok(line.md.startsWith('**Mishap 86–00 · The door.** ') && /\*Cost:\* Tapped\. Vesper cuts you off/.test(line.small) && /A new source to find: /.test(line.small), JSON.stringify(line));
  assert.equal(at('10').cost.id, 'trouble', 'the cost is read off the first bold words when the pack gives none');
  assert.equal(mk({ pack: { mishap: [ent(1, 100, 'X', 'Odd', 'Odd. **Who knows.**', '', 'brag')] } }).roll({ act: 'indulge', res: 'over', d100: '5' }, { seed: 1 }).morning.cards[0].cost.id, 'brag', 'or given outright');
  assert.equal(mk({ pack: { mishap: [ent(1, 100, 'X', 'Odd', 'Odd. **Who knows.**', '')] } }).roll({ act: 'indulge', res: 'over', d100: '5' }, { seed: 1 }).morning.cards[0].cost, null, 'none named: no cost line');
  assert.equal(dt.roll(Object.assign({ d100: '60' }, BASE), { seed: 3 }).morning.cards[0].cost, null, 'a Benefit has no cost');
});

await test('no table in the pack: one line that says where the tables are; a malformed entry is left out', () => {
  const bare = mk({ vices: CT.VICES }).roll(Object.assign({ res: 'over', d100: '50' }, BASE), { seed: 31, mem: {} });
  assert.deepEqual([bare.morning.has, bare.morning.n, bare.morning.cards.length], [false, 0, 0]);
  assert.deepEqual(morningIds(bare), ['morning']);
  assert.match(bare.lines[1].md, /^\*\*A Mishap\.\*\* Roll a d100 on the table in the vault/);
  assert.match(bare.lines[1].small, /no Mishaps yet/);
  const onlyBen = mk({ pack: { benefit: BEN } }).roll({ act: 'indulge', res: 'over', d100: '50' }, { seed: 1 });
  assert.equal(onlyBen.morning.has, false, 'Benefits but no Mishaps: the Mishaps say where they are');
  const junk = [7, null, 'x', { lo: 0, hi: 5, title: 'T', md: 'M' }, { lo: 5, hi: 101, title: 'T', md: 'M' }, { lo: 9, hi: 3, title: 'T', md: 'M' }, { lo: 1, hi: 5, title: '', md: 'M' }, { lo: 1, hi: 5, title: 'T', md: ' ' }];
  assert.equal(mk({ pack: { benefit: junk } }).roll({ act: 'indulge', d100: '3' }, { seed: 1 }).morning.has, false, 'only malformed entries: no table');
  assert.equal(mk({ pack: { benefit: junk.concat([ent(1, 100, '', 'Good', 'Good. *"y"*', '')]) } }).roll({ act: 'indulge', d100: '3' }, { seed: 1 }).morning.cards.map((c) => c.title).join(), 'Good', 'the good one is kept, and a table of one deals no second card');
});

await test('indulge: the sheet\'s vice and purveyor; curly or straight apostrophes; an unknown vice is drawn; no purveyor gets a stock one', () => {
  const dt = mk({ vices: CT.VICES });
  for (const v of ['Gettin’ Fucked Up', "gettin' fucked up", 'GAMBLING']) {
    const r = dt.roll({ act: 'indulge', vice: v }, { seed: 5 });
    assert.ok(dt.VICES.includes(r.meta.chips[1]) && r.meta.chips[1].toLowerCase().replace(/’/g, "'") === v.toLowerCase().replace(/’/g, "'"), v + ' -> ' + r.meta.chips[1]);
  }
  assert.ok(dt.VICES.includes(dt.roll({ act: 'indulge', vice: 'Collecting stamps' }, { seed: 5 }).meta.chips[1]));
  const stock = dt.roll({ act: 'indulge', vice: 'Faith' }, { seed: 8 });
  const V = T.vice.Faith, where = stock.lines.find((l) => l.id === 'more').rows[0].md;
  assert.ok(V.places.some((p) => where.toLowerCase().includes(p.toLowerCase())) && V.hosts.some((h) => where.includes(h)), where);
  assert.deepEqual(dt.VICES, Array.from(CT.VICES, (v) => v.name.replace('’', "'")), 'the seven vices, in the book\'s order');   // Array.from: the vm's arrays have another prototype
});

await test('purveyor(): every line in the book reads as a host and a place; typed lines too', () => {
  for (const p of PURVEYORS) {
    const x = D.purveyor(p, T.districts, X.PLACES);
    assert.ok(x.host && x.place, p + ' -> ' + JSON.stringify(x));
    assert.ok(!/^(?:a|an) /i.test(x.place) && !/\b(?:pilot|guide|dealer|player|construct|controller|handler|leader|bookmaker|librarian|president)\b/i.test(x.place), 'a place, not a role: ' + x.place);
  }
  assert.deepEqual(D.purveyor('Vesper, bookmaker at the Vreen Autodrome, Nightmarket', T.districts, X.PLACES), { host: 'Vesper', place: 'the Vreen Autodrome', district: 'Nightmarket', near: '' });
  assert.deepEqual(D.purveyor('Karter, the Sky High casino, above Doskvol', T.districts, X.PLACES), { host: 'Karter', place: 'the Sky High casino', district: '', near: 'above Doskvol' });
  assert.deepEqual(D.purveyor('Jimmy at the Rusty Anchor, Docks', T.districts, X.PLACES), { host: 'Jimmy', place: 'the Rusty Anchor', district: 'the Docks', near: '' });
  assert.deepEqual(D.purveyor("Old Mo, Mo's Bar, crowfoot", T.districts, X.PLACES), { host: 'Old Mo', place: "Mo's Bar", district: 'Crowfoot', near: '' });
  assert.deepEqual(D.purveyor('Aunt Bea', T.districts, X.PLACES), { host: 'Aunt Bea', place: '', district: '', near: '' });
  assert.deepEqual(D.purveyor('', T.districts, X.PLACES), { host: '', place: '', district: '', near: '' });
});

await test('the dice: recover and project carry the sheet\'s ticks (1 / 2 / 3 / 5); before the dice there are none', () => {
  const dt = mk();
  const want = { '13': 1, '45': 2, '6': 3, crit: 5 };
  for (const [res, n] of Object.entries(want)) {
    assert.deepEqual(dt.roll({ act: 'recover', res }, { seed: 1 }).meta.chips, [D.BAND_LABEL[res], 'healing +' + n]);
    assert.deepEqual(dt.roll({ act: 'project', res }, { seed: 1 }).meta.chips, [D.BAND_LABEL[res], '+' + n + ' on the clock']);
    const lead = dt.roll({ act: 'recover', res }, { seed: 1 }).meta.text;
    assert.ok(T.recover.band[res].some((t) => lead.endsWith(t.replace(/^\{Healer\}/, '').slice(-25))), 'the lead comes from the ' + res + ' list');
  }
  assert.deepEqual(dt.roll({ act: 'recover' }, { seed: 1 }).meta.chips, ['before the dice']);
  assert.deepEqual(dt.roll({ act: 'train', attr: 'Prowess' }, { seed: 1 }).meta.chips, ['Prowess', '+1 xp']);
  assert.equal(dt.roll({ act: 'recover', res: '7' }, { seed: 1 }).replay.ui.res, '', 'a result that is not one is dropped');
  assert.equal(dt.roll({ act: 'nope' }, { seed: 1 }).meta.act, 'indulge', 'an unknown activity reads as indulge');
});

await test('friend or rival: the sheet\'s contact by name; the clock a lead suggests becomes an action', () => {
  const dt = mk();
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

await test('no rules text in the tables (no page references), prompts short enough to read at a glance; the module names nothing', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'downtime-tables.js'), 'utf8');
  assert.ok(!/\bp(?:age|p)?\.\s?\d+/i.test(src), 'no page references');
  const mod = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'downtime.js'), 'utf8');
  for (const d of T.districts) assert.ok(!new RegExp('\\b' + d.replace(/^the /, '') + '\\b').test(mod), 'the module names no district: ' + d);
  for (const k of Object.keys(X.PLACES)) assert.ok(!mod.includes(X.PLACES[k][0].replace(/^the /, '')) || /^your family$/.test(X.PLACES[k][0]), 'the module names no purveyor: ' + X.PLACES[k][0]);
  for (const v of Object.values(T.vice)) for (const k of ['lead', 'hook']) for (const t of v[k]) assert.ok(t.length <= 200, 'short enough to read at a glance: ' + t);
  for (const v of Object.values(T.vice)) for (const t of v.lead) assert.match(t, /\*"[^"]+"\*$/, 'every night ends on the line someone says to the PC: ' + t);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
