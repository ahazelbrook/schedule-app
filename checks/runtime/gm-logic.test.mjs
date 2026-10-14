// Unit test for app/gm/console.js (the GM console's nine rollers), in Node with no dependencies.
// Every table here is the invented fixture checks/runtime/fixtures/gm/console-pack.json; the real GM pack is never in
// this repository. If gm-private/b68-gm-pack.json exists on this machine, the same sweeps also run against it
// (counts only are printed), otherwise that section is skipped with a note.
//   node checks/runtime/gm-logic.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, 'app', 'gm', 'console.js'));
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'console-pack.json'), 'utf8'));
const REAL = path.join(ROOT, 'gm-private', 'b68-gm-pack.json');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || 'not equal') + ': got ' + A + ' want ' + B); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
const clone = o => JSON.parse(JSON.stringify(o));

// Every piece of text a card can show, for the leak checks.
function texts(r) {
  const t = [r.meta.title, r.meta.sub, r.meta.text, r.meta.label, ...r.meta.chips, ...r.meta.all, ...r.meta.actions.map(a => a.label)];
  for (const l of r.lines) {
    if (l.kind === 'grid') for (const row of l.rows) t.push(row.k, row.md);
    else { t.push(l.md); if ('small' in l) t.push(l.small); }
  }
  for (const a of r.meta.actions) for (const k of ['text', 'who']) if (k in a.intent) t.push(a.intent[k]);
  return t;
}
const BAD = [/undefined/, /\bNaN\b/, /\[object/, /\{[a-zA-Z]+\}/, /<\/?(small|br|div|span)\b/i];
function checkCard(r, where) {
  ok(r && Array.isArray(r.lines) && r.lines.length, where + ': no lines');
  ok(['want', 'read', 'grid'].includes(r.lines[0].kind), where + ': bad first item');
  for (const l of r.lines) ok(['want', 'read', 'grid'].includes(l.kind), where + ': unknown kind ' + l.kind);
  const nText = r.lines.reduce((n, l) => n + (l.kind === 'grid' ? l.rows.length : 1), 0);
  ok(nText === r.meta.all.length, where + ': all[] out of step with lines');
  ok(typeof r.seed === 'number' && r.seed >>> 0 === r.seed, where + ': seed not uint32');
  for (const s of texts(r)) {
    ok(typeof s === 'string', where + ': non-string text ' + JSON.stringify(s));
    for (const re of BAD) ok(!re.test(s), where + ': ' + re + ' in ' + JSON.stringify(s));
  }
  for (const a of r.meta.actions) ok(a.intent && typeof a.intent.type === 'string', where + ': action without intent');
}

// The sweep: every button x position x result x scene x district x aim, several seeds; threat and NPC rotate.
function sweep(T, campaign, seedsPer) {
  const con = C.create({ T, campaign, seed: 7 });
  const opt = id => con.controls.find(c => c.id === id).options.map(o => o.value);
  const npcs = opt('npc');
  const threats = ['', 'a placeholder hazard'];
  let n = 0, k = 0;
  const mem = {};
  for (const b of con.buttons)
    for (const pos of opt('pos')) for (const result of opt('result')) for (const scene of opt('scene'))
      for (const district of opt('district')) for (const pc of opt('pc'))
        for (let s = 0; s < seedsPer; s++) {
          const ui = { pos, result, scene, district, pc, npc: npcs[k % npcs.length], threat: threats[k % 2] };
          k++;
          const where = `${b.id} ${JSON.stringify(ui)} seed#${s}`;
          const r = con.roll(b.id, ui, { seed: (k * 2654435761) >>> 0, mem });
          checkCard(r, where);
          n++;
        }
  return n;
}

await test('module shape: create, buttons 1..9 in order, controls, defaults, helpers', () => {
  const con = C.create({ T: FIX.parts.console.T, campaign: FIX.parts.campaign });
  eq(con.buttons.map(b => b.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq(con.buttons.map(b => b.id), ['devilsBargain', 'complication', 'consequence', 'payThePrice', 'reaction', 'callback', 'harm', 'contact', 'face']);
  for (const b of con.buttons) ok(b.label && b.hint, 'label/hint ' + b.id);
  eq(con.controls.map(c => c.id), ['pos', 'result', 'scene', 'district', 'pc', 'npc', 'threat']);
  eq(con.defaults(), { pos: 'risky', scene: '', district: '', pc: '', result: '', npc: '', threat: '' });
  const npc = con.controls.find(c => c.id === 'npc').options;
  ok(npc.some(o => o.value === 'friend:Marge Teacup' && /3d$/.test(o.label)), 'friend option');
  ok(npc.some(o => o.value === 'rival:Nigel Sprocket' && /1d$/.test(o.label)), 'rival option');
  ok(npc.some(o => o.value === 'fac:Hat Society' && /\(-2\), 0d$/.test(o.label)), 'faction option');
  eq(con.controls.find(c => c.id === 'pc').options.map(o => o.label), ['anyone', 'Pip', 'Dot', 'Moss']);
  eq(con.controls.find(c => c.id === 'scene').options.map(o => o.value), ['', 'chase', 'fight', 'sneak', 'talk', 'street']);
  let threw = false; try { C.create({}); } catch (e) { threw = true; } ok(threw, 'create without T throws');
  eq(C.resistOdds(2).free.toFixed(4), (11 / 36).toFixed(4), 'two dice: free on a 6, or two 6s');
  eq(C.poolRoll(0, () => 0.99).dice.length, 2, '0d rolls two');
  eq(C.plain('**a** *b*  \n<small>c</small>'), 'a b c');
});

await test('sweep (fixture): every button x position x result x scene x district x aim, 3 seeds: clean cards', () => {
  const n = sweep(FIX.parts.console.T, FIX.parts.campaign, 3);
  console.log('     ' + n + ' fixture cards');
  ok(n > 20000, 'sweep too small: ' + n);
});

await test('sweep (fixture, empty campaign): no PCs, cast, callbacks, NPCs or names', () => {
  const n = sweep(FIX.parts.console.T, {}, 1);
  console.log('     ' + n + ' empty-campaign cards');
  const con = C.create({ T: FIX.parts.console.T, campaign: {} });
  ok(/No friends/.test(con.roll('contact', {}).meta.text), 'contact without friends');
  ok(/No callbacks/.test(con.roll('callback', {}).meta.text), 'callback without callbacks');
  ok(/Nameless Stranger/.test(con.roll('face', {}).meta.text), 'face falls back to the placeholder name');
});

await test('replay: the same {seed, mem, ui} gives the same card; replay triple redraws it', () => {
  const con = C.create({ T: FIX.parts.console.T, campaign: FIX.parts.campaign });
  const mem = {};
  for (let i = 0; i < 300; i++) {
    const b = con.buttons[i % 9];
    const ui = { pos: ['controlled', 'risky', 'desperate'][i % 3], scene: ['', 'chase', 'fight', 'sneak', 'talk', 'street'][i % 6],
                 pc: ['', 'Pip Wobble', 'Dot Crumble', 'Moss'][i % 4], district: i % 5 ? '' : 'Puddleton', result: ['', '45', '13'][i % 3],
                 npc: i % 2 ? 'friend:Marge Teacup' : '', threat: i % 7 ? '' : 'a placeholder hazard' };
    const before = clone(mem);
    const a = con.roll(b.id, ui, { mem });                         // fresh seed, live memory
    eq(a.replay.mem, before, 'replay.mem is the memory before the roll');
    const again = con.roll(a.replay.id, a.replay.ui, { seed: a.replay.seed, mem: clone(a.replay.mem) });
    eq(again.lines, a.lines, b.id + ' lines');
    eq(again.meta, a.meta, b.id + ' meta');
    const m2 = clone(before);
    con.roll(b.id, ui, { seed: a.seed, mem: m2 });
    eq(m2, mem, b.id + ' memory after the roll');
  }
  // by number, and an unknown id rolls the bargain (as the vault did)
  eq(con.roll(2, {}, { seed: 5, mem: {} }).meta.id, 'complication');
  eq(con.roll('nope', {}, { seed: 5, mem: {} }).meta.id, 'devilsBargain');
  // the instance's fresh seeds are a reproducible stream when create() is given one
  const s1 = C.create({ T: FIX.parts.console.T, campaign: FIX.parts.campaign, seed: 42 }).roll('face', {}).seed;
  const s2 = C.create({ T: FIX.parts.console.T, campaign: FIX.parts.campaign, seed: 42 }).roll('face', {}).seed;
  eq(s1, s2);
});

await test('repeat guard: no repeats inside the window while mem is shared', () => {
  const con = C.create({ T: FIX.parts.console.T, campaign: FIX.parts.campaign });
  const mem = {};
  const seen = [];
  for (let i = 0; i < 400; i++) seen.push(con.roll('complication', { scene: 'chase' }, { mem }).meta.text);
  for (let i = 4; i < seen.length; i++) ok(new Set(seen.slice(i - 4, i)).size === 4, 'scene complication repeated within 4 at ' + i);
  ok(mem['comp:chase'].length === 4, 'window is half the list');
  const src = [];
  for (let i = 0; i < 300; i++) src.push(con.roll('complication', {}, { mem }).meta.text.split(':')[0]);
  for (let i = 3; i < src.length; i++) ok(new Set(src.slice(i - 3, i)).size === 3, 'oracle source repeated within 3 at ' + i);
  // a fresh memory each time does repeat sooner or later (the guard is the memory, not luck)
  let rep = false, prev = '';
  for (let i = 0; i < 200 && !rep; i++) { const t = con.roll('complication', { scene: 'chase' }, { mem: {} }).meta.text; rep = t === prev; prev = t; }
  ok(rep, 'expected a repeat without memory');
});

await test('controls bias the cards: position, result, scene, district, aim, NPC, threat, dots', () => {
  const con = C.create({ T: FIX.parts.console.T, campaign: FIX.parts.campaign });
  const roll = (id, ui, seed) => con.roll(id, ui, { seed: seed || 1, mem: {} });
  // position sets severity
  ok(/→ spicy/.test(roll('complication', { pos: 'desperate' }).meta.sub), 'desperate is serious');
  ok(/level 1 \(lesser\)/.test(roll('harm', { pos: 'controlled' }).meta.sub), 'controlled harm is lesser');
  // result filters consequence (never worse position at desperate, never reduced effect on a 1-3)
  for (let s = 0; s < 200; s++) {
    ok(!/^Worse position/.test(roll('consequence', { pos: 'desperate' }, s).meta.text), 'desperate offered worse position');
    ok(!/^Reduced effect/.test(roll('consequence', { pos: 'risky', result: '13' }, s).meta.text), '1-3 offered reduced effect');
  }
  // scene palette
  ok(/^Pram \d/.test(roll('complication', { scene: 'chase' }).meta.text), 'chase palette');
  // district: printed bargain first, and Face weights its NPCs
  const db = roll('devilsBargain', { district: 'Puddleton', scene: 'chase' });
  ok(/Printed for Puddleton/.test(db.meta.text) && db.meta.bargain.kind === 'printed', 'printed district bargain');
  ok(db.lines.some(l => l.kind === 'grid' && l.rows[0].k === 'Or'), 'generic bargain offered as the "Or"');
  ok(/^Want \+1d\? Printed for Crumbhall/.test(roll('devilsBargain', { district: 'Crumbhall', scene: 'talk' }).meta.text), 'second printed');
  ok(!/Printed/.test(roll('devilsBargain', { district: 'Crumbhall', scene: 'chase' }).meta.text), 'printed only in its scenes');
  let lou = 0; for (let s = 0; s < 200; s++) if (roll('face', { district: 'Lower Fluff' }, s).meta.face.npc === 'Lonely Lou') lou++;
  ok(lou > 0, 'district steers Face to a local NPC');
  // aim: the PC's own lines lead the bargain, chips show the aim, harm shows just their dice
  let pcKind = 0; for (let s = 0; s < 100; s++) if (roll('devilsBargain', { pc: 'Pip Wobble' }, s).meta.bargain.kind === 'pc') pcKind++;
  ok(pcKind > 30, 'aimed bargains lean on the sheet: ' + pcKind);
  ok(roll('devilsBargain', { pc: 'Moss' }, 3).meta.chips.includes('Aim: Moss'), 'aim chip');
  const hr = roll('harm', { pc: 'Dot Crumble' }).meta.all.find(t => t.startsWith('Resist'));
  ok(/Dot 0d \(2d keep lowest\)/.test(hr) && !/Pip/.test(hr), 'aimed harm resist row: ' + hr);
  const hd = roll('harm', { pc: 'Dot Crumble', dots: { 'Dot Crumble': { prowess: 3 } } }).meta.all.find(t => t.startsWith('Resist'));
  ok(/Dot 3d/.test(hd), 'ui.dots overrides the pack dots: ' + hd);
  // Veteran in a fight gets the arsenal row; contact calls the aimed PC's friend
  ok(roll('devilsBargain', { scene: 'fight' }).lines.some(l => l.kind === 'grid' && l.rows[0].k === 'Or, for Pip'), 'veteran arsenal');
  for (let s = 0; s < 30; s++) ok(/Auntie Flan/.test(roll('contact', { pc: 'Dot Crumble' }, s).meta.text), 'contact = aimed friend');
  // NPC is: pool from who they are; a friend with a Play block shows it
  const rf = roll('reaction', { npc: 'friend:Marge Teacup' });
  eq(rf.meta.reaction.pool, 3); ok(rf.meta.all.some(t => /^Play: played by a placeholder actor/.test(t)), 'play row');
  eq(roll('reaction', { npc: 'fac:Hat Society' }).meta.reaction.dice.length, 2, '0d rolls 2 keep lowest');
  eq(roll('reaction', { npc: 'rival:Nigel Sprocket' }).meta.reaction.pool, 1);
  // threat on screen leads, and offers a spent button
  const th = roll('consequence', { threat: 'the wobbly ladder' });
  ok(/the wobbly ladder/.test(th.meta.text) && th.lines[0].small, 'threat leads consequence with the type as small');
  ok(th.meta.actions.some(a => a.intent.type === 'threatSpent'), 'threat spent action');
  eq(roll('devilsBargain', { threat: 'the wobbly ladder' }).meta.bargain.kind, 'threat');
  // callback prefers the aimed PC's people
  for (let s = 0; s < 40; s++) ok(/Marge Teacup|Pip/.test(roll('callback', { pc: 'Pip Wobble' }, s).meta.all.join(' ')), 'aimed callback');
  // invalid controls fall back instead of throwing
  checkCard(roll('consequence', { pos: 'sideways', result: '99', scene: 'disco' }), 'invalid controls');
});

await test('intents: accepted bargain is owed, collected on 61-62, callbacks retire, threat clears', () => {
  const T = FIX.parts.console.T, camp = FIX.parts.campaign;
  const con = C.create({ T, campaign: camp });
  const db = con.roll('devilsBargain', { pc: 'Pip Wobble' }, { seed: 11, mem: {} });
  const acc = db.meta.actions.find(a => a.intent.type === 'bargainOwed');
  ok(acc && acc.intent.who === 'Pip' && acc.intent.capture.bucket === 'x', 'accepted intent');
  let st = { live: con.defaults() };
  const st0 = clone(st);
  st = C.applyIntent(st, acc.intent, { date: '14/10/2026' });
  eq(st0, { live: con.defaults() }, 'applyIntent leaves its input alone');
  eq(st.owed[acc.intent.key], { text: acc.intent.text, src: 'Pip, 14/10/2026' });
  eq(C.intentPatch(acc.intent, { date: '14/10/2026' }), { owed: { [acc.intent.key]: { text: acc.intent.text, src: 'Pip, 14/10/2026' } } }, 'patch');
  eq(C.campaignWith(camp, st).owed.length, 3, 'two from the pack plus the accepted one');
  // Pay the price 61-62 collects an owed bargain, with a Collected action that strikes it
  con.setCampaign(camp, st);
  let col = null;
  for (let s = 0; s < 5000 && !col; s++) {
    const r = con.roll('payThePrice', {}, { seed: s, mem: {} });
    if (r.meta.d66 === 61 || r.meta.d66 === 62) { ok(/comes due/.test(r.meta.text), 'due text'); col = r.meta.actions.find(a => a.intent.type === 'bargainCollected'); }
  }
  ok(col, 'a collected action on 61-62');
  st = C.applyIntent(st, col.intent);
  const left = C.campaignWith(camp, st).owed;
  eq(left.length, 2, 'struck off');
  ok(!left.some(x => x.text === col.intent.text), 'the struck one is gone');
  // callbacks retire
  const cb = con.roll('callback', {}, { seed: 3, mem: {} });
  const used = cb.meta.actions.find(a => a.intent.type === 'callbackUsed');
  st = C.applyIntent(st, used.intent);
  con.setCampaign(camp, st);
  const mem = {};
  for (let s = 0; s < 200; s++) ok(con.roll('callback', {}, { seed: s, mem }).meta.text !== used.intent.text, 'retired callback came back');
  eq(C.campaignWith(camp, st).callbacks.length, camp.callbacks.length - 1);
  // threat spent clears the live threat; null in a patch deletes (the server's merge)
  st = C.applyIntent(Object.assign(st, { live: Object.assign({}, st.live, { threat: 'x' }) }), { type: 'threatSpent' });
  eq(st.live.threat, '');
  eq(C.applyIntent({ owed: { a: { text: 't' } } }, { type: 'bargainCollected', key: 'z', text: 't' }).struck, { z: 't' });
  let threw = false; try { C.applyIntent({}, { type: 'mystery' }); } catch (e) { threw = true; } ok(threw, 'unknown intent throws');
  // the string form of owed / callbacks ("text | src") reads the same as objects
  const pc = C.campaignWith({ callbacks: ['a | b'], owed: ['c | d'] }, {});
  eq(pc.callbacks, [{ text: 'a', src: 'b' }]); eq(pc.owed, [{ text: 'c', src: 'd' }]);
});

await test('no DOM, storage or network in the module', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'console.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const w of ['document', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'dv.', 'app.vault', 'Notice', 'innerHTML'])
    ok(!src.includes(w), 'module mentions ' + w);
});

// --- the real pack, only when it is on this machine (never committed) -------------------------------------------
if (fs.existsSync(REAL)) {
  const real = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  await test('real pack: fixture T has the same key structure as the real console.T', () => {
    const shape = v => Array.isArray(v) ? 'array' : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k])])) : typeof v;
    const s = shape(real.parts.console.T), f = shape(FIX.parts.console.T);
    // district bargain keys are district names, say3/crumb keys are the reaction names: compare their count and
    // inner shape, not the names (the fixture invents its own); then check both packs key them consistently
    const strip = x => { const y = clone(x); for (const k of ['dbDistrict', 'say3', 'crumb']) y[k] = Object.values(y[k]); return y; };
    eq(strip(f), strip(s), 'key structure');
    for (const t of [real.parts.console.T, FIX.parts.console.T]) {
      const names = t.reaction.map(r => r[0]).sort();
      eq(Object.keys(t.say3).sort(), names, 'say3 keyed by reaction'); eq(Object.keys(t.crumb).sort(), names, 'crumb keyed by reaction');
      for (const d of Object.keys(t.dbDistrict)) ok(t.district.includes(d), 'dbDistrict key is a district');
    }
  });
  await test('real pack: the same sweeps, clean cards', () => {
    const n = sweep(real.parts.console.T, real.parts.campaign, 2);
    const e = sweep(real.parts.console.T, {}, 1);
    console.log('     ' + n + ' real-pack cards, ' + e + ' with an empty campaign');
  });
  await test('real pack: replay is exact', () => {
    const con = C.create({ T: real.parts.console.T, campaign: real.parts.campaign });
    const mem = {};
    for (let i = 0; i < 500; i++) {
      const a = con.roll(con.buttons[i % 9].id, { scene: ['', 'chase', 'fight', 'sneak', 'talk', 'street'][i % 6], pos: ['controlled', 'risky', 'desperate'][i % 3] }, { mem });
      const b = con.roll(a.replay.id, a.replay.ui, { seed: a.replay.seed, mem: clone(a.replay.mem) });
      eq(JSON.stringify(b.lines) === JSON.stringify(a.lines), true, 'replay ' + i);
    }
  });
} else {
  console.log('SKIP real pack: gm-private/b68-gm-pack.json is not on this machine (run npm run gm:pack to build it)');
}

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all gm-logic tests passed');
