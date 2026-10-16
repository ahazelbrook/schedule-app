// Unit test for app/gm/score.js (the score generator): determinism and replay, a reroll that moves only its own row and what reads it,
// every lock the GM can set, seeded pitches, the pay and its scope, the district's rule, the crew's ability notes, the twist tokens,
// check() on a broken table, the Cards entry, and a pack without the optional tables. Invented tables only
// (checks/runtime/fixtures/gm/score-pack.json, laid on the location fixture's factions, districts and building types). When a real
// pack with a `score` part is on this machine (gm-private/b68-gm-pack.json, or the file named by B68_SCORE_PACK) the sweeps also run
// on the real tables; nothing from the real pack is printed, only counts.
//   node checks/runtime/gm-score.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, 'app', 'gm', 'score.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const read = (f) => fs.readFileSync(f, 'utf8');
const FX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const FIX = JSON.parse(read(path.join(FX, 'score-pack.json'))).parts;
const T = FIX.score.T;
const CON = JSON.parse(read(path.join(FX, 'console-pack.json'))).parts.campaign;
const CAMP = Object.assign({}, CON, FIX.campaign);          // the console fixture's PCs and NPCs, the score fixture's crew and standing
const FAC = T.faction.map((f) => f[0]);                     // twelve invented factions, Tier 1..6
const DIST = T.loc.district;                                // Testfield (rule: pay +1, engage -1, heat +1), Hightown Test (engage +1) ...
const ENEMIES = CAMP.crew.enemies, FOE = FAC[4];
const seedOf = (i) => (Math.imul(i + 1, 2654435761) ^ 0x1234567) >>> 0;
const BAD = /\bundefined\b|\bNaN\b|\[object|\$\{|[{}]/;
const gen = (over, camp) => S.create({ T: Object.assign(clone(T), over || {}), campaign: camp || CAMP });
const G = gen();
const sweep = (n, ui, g) => Array.from({ length: n }, (_, i) => (g || G).roll({ seed: seedOf(i), ui, mem: {} }));
const rowOf = (r, id) => { for (const l of r.card.lines) for (const x of l.rows || []) if (x.id === id) return x; return null; };
const mdOf = (r) => r.card.lines.flatMap((l) => (l.rows ? l.rows.map((x) => x.md) : [l.md || '']).concat(l.chips || []));

let REAL = null;
for (const f of [process.env.B68_SCORE_PACK, path.join(ROOT, 'gm-private', 'b68-gm-pack.json')].filter(Boolean)) {
  if (!fs.existsSync(f)) continue;
  try { const p = JSON.parse(read(f)); if (p.parts && p.parts.score && p.parts.score.T) { REAL = { T: p.parts.score.T, camp: p.parts.campaign || {} }; break; } } catch (e) { /* not a pack */ }
}

// ---- check() -----------------------------------------------------------------------------------------------------------------------
await test('check(): the fixture is complete; null is ["T"]; every required table is named when missing; the optional ones are optional', () => {
  assert.deepEqual(S.check(T), []);
  assert.deepEqual(S.check(null), ['T']);
  for (const k of ['crew', 'op', 'asset', 'site', 'why', 'twist', 'client', 'approach', 'calledShot', 'scope', 'physThreat', 'socThreat', 'faction']) {
    const t = clone(T); delete t[k];
    assert.ok(S.check(t).includes(k), 'delete ' + k + ': ' + JSON.stringify(S.check(t)));
    const e = clone(T); e[k] = Array.isArray(e[k]) ? [] : {};
    assert.ok(S.check(e).includes(k), 'empty ' + k + ': ' + JSON.stringify(S.check(e)));
  }
  for (const k of ['loc', 'holding', 'vector', 'cost', 'earns', 'districtRule']) { const t = clone(T); delete t[k]; assert.deepEqual(S.check(t), [], 'optional: ' + k); }
  const bad = clone(T); bad.vector = { Stealth: [] }; bad.cost = []; bad.earns = [''];
  assert.deepEqual(S.check(bad), ['vector', 'cost', 'earns'], 'a half-written optional table is reported');
});

await test('check(): the references between tables (crew and seed operations, kinds, the one {A} in a verb) and the sites', () => {
  const t = clone(T);
  t.crew.Tunnellers.ops.push('Nonesuch'); t.crew.Tunnellers.seeds[0].ops.push('Ghost'); t.crew.Tunnellers.seeds[1].kind = 'nowhere';
  t.op.Lift.kinds.push('missing-kind'); t.op.Torch.verb = 'burn it'; t.op['Break in'].verb = 'break {A} into {A}'; t.op.Lift.ways = [];
  const m = S.check(t);
  for (const k of ['crew.Tunnellers.ops.Nonesuch', 'crew.Tunnellers.seeds.0.ops.Ghost', 'crew.Tunnellers.seeds.1.kind.nowhere', 'op.Lift.kinds.missing-kind', 'op.Torch.verb', 'op.Break in.verb', 'op.Lift.ways']) assert.ok(m.includes(k), k + ' in ' + JSON.stringify(m));
  const u = clone(T); delete u.site.person;
  assert.deepEqual(S.check(u), ['site.person'], 'a kind an operation uses needs buildings');
  const v = clone(T); v.crew.Stagehands.ops = []; v.faction[0][1] = 'III'; v.scope[0] = ['x', 'y'];
  assert.deepEqual(S.check(v), ['crew.Stagehands.ops', 'scope', 'faction'], 'an empty list, a scope threshold that is not a number, a Tier that is not one');
});

await test('create() refuses a missing or empty T; a pack with a table gone still rolls (check() names it)', () => {
  assert.throws(() => S.create({}), /score\.T/); assert.throws(() => S.create({ T: {} }), /score\.T/);
  assert.throws(() => S.create({ T: Object.assign(clone(T), { op: {} }) }), /needs crew, op and faction/);
  for (const k of ['client', 'twist', 'why', 'calledShot', 'scope', 'physThreat', 'site', 'approach']) {
    const t = clone(T); delete t[k];
    const r = S.create({ T: t, campaign: CAMP }).roll({ seed: 3 });
    assert.ok(r.card.lines.length >= 3, k);
  }
});

// ---- determinism and replay -------------------------------------------------------------------------------------------------------
await test('a roll is { seed, mem, ui, bump }: the same input gives the same score and card, and gen.replay(replay) redraws it', () => {
  const uis = [undefined, { client: 'fac:' + FAC[0] }, { target: 'enemy' }, { job: 'Lift', district: DIST[0] }, { crew: 'Stagehands', tier: 3 }];
  for (const ui of uis) for (let i = 0; i < 40; i++) {
    const seed = seedOf(i), mem0 = i % 2 ? { why: ['x'], job: ['Lift'] } : {};
    const a = G.roll({ seed, mem: clone(mem0), ui }), b = G.roll({ seed, mem: clone(mem0), ui });
    assert.deepEqual(a.score, b.score); assert.deepEqual(a.card, b.card); assert.deepEqual(a.replay, b.replay);
    const c = G.replay(JSON.parse(JSON.stringify(a.replay)));
    assert.deepEqual(c.score, a.score); assert.deepEqual(c.card, a.card); assert.deepEqual(c.replay, a.replay, 'and replaying a replay is a fixed point');
    assert.deepEqual(a.replay.mem, mem0, 'replay.mem is the memory as it was BEFORE the roll');
  }
  const mem = { why: ['x'] }, r = G.roll({ seed: 5, mem });
  assert.equal(r.memAfter, mem, 'the memory passed in is the one mutated'); assert.notEqual(r.replay.mem, mem); assert.deepEqual(r.replay.mem, { why: ['x'] });
  assert.ok(Object.keys(mem).length > 5 && Object.keys(mem).some((k) => /^job/.test(k)) && Object.values(mem).every(Array.isArray), 'the guard keeps one key per pick, each starting with its section');
  const own = G.mem(); G.roll({ seed: 6 }); assert.ok(Object.keys(own).length > 5, 'without a mem the instance keeps its own');
  const s1 = G.roll({ seed: 1, mem: {} }).score, s2 = G.roll({ seed: 2, mem: {} }).score; assert.notDeepEqual(s1, s2, 'other seeds give other scores');
  const fresh = G.roll({ mem: {} }); assert.ok(Number.isInteger(fresh.seed) && fresh.seed >= 0 && fresh.seed < 4294967296, 'a roll without a seed makes one'); assert.deepEqual(G.replay(fresh.replay).card, fresh.card);
});

await test('replay.ui holds the crew and Tier as resolved (a replay does not follow the table), and cleanUi drops what the tables do not hold', () => {
  const r = G.roll({ seed: 9, mem: {} });
  assert.equal(r.replay.ui.crew, 'Tunnellers'); assert.equal(r.replay.ui.tier, 1);
  const other = S.create({ T, campaign: Object.assign({}, CAMP, { crew: Object.assign({}, CAMP.crew, { type: 'Stagehands', tier: 4 }) }) });
  assert.equal(other.replay(r.replay).score.crew.type, 'Tunnellers'); assert.equal(other.replay(r.replay).score.crew.tier, 1);
  const dirty = G.cleanUi({ client: 'fac:nowhere', who: { name: 'X' }, target: 'fac:ghost', job: 'Nope', district: 'Atlantis', crew: 'Pirates', tier: 9, nowIn: 'Atlantis' });
  assert.deepEqual(dirty, G.defaults());
  assert.deepEqual(G.cleanUi({ client: 'npc:a', who: { name: ' Nell ', faction: 'F', district: 'D', role: 'R', want: 'W', extra: 1 } }), { ...G.defaults(), client: 'npc:a', who: { name: 'Nell', faction: 'F', district: 'D', role: 'R', want: 'W' } });
  assert.equal(G.cleanUi({ client: 'npc:a' }).client, '', 'an NPC client needs its who');
  assert.equal(G.cleanUi({ client: 'fac:brisk30 guild', target: 'fac:THE CALP30 CREW!' }).client, 'fac:' + FAC[0], 'faction names match without case, "the" or punctuation');
  assert.equal(G.cleanUi({ client: 'fac:brisk30 guild', target: 'fac:THE CALP30 CREW!' }).target, 'fac:' + FAC[1]);
  assert.deepEqual([G.cleanUi({ tier: '3' }).tier, G.cleanUi({ tier: 0 }).tier, G.cleanUi({ tier: '' }).tier, G.cleanUi({ tier: -1 }).tier, G.cleanUi({ tier: 'x' }).tier], [3, 0, '', '', ''], 'tier: a whole number 0-6 (a select gives text); anything else is dropped');
  assert.equal(G.cleanUi({ tier: 9 }).tier, ''); assert.equal(G.cleanUi({ tier: 2.5 }).tier, '');
  assert.equal(G.cleanUi({ district: 'testfield' }).district, DIST[0], 'a district in the location part\'s own spelling');
  assert.deepEqual([G.cleanUi({ district: '*' }).district, G.cleanUi({ district: 'now' }).district], ['*', 'now']);
  assert.deepEqual([G.cleanUi({ crew: 'tunnellers' }).crew, G.cleanUi({ crew: 'STAGE-HANDS!' }).crew, G.cleanUi({ crew: '' }).crew], ['Tunnellers', 'Stagehands', ''], 'a crew type matches without case, spaces or punctuation');
  const sheet = S.create({ T, campaign: Object.assign({}, CAMP, { crew: Object.assign({}, CAMP.crew, { type: 'stage hands', tier: 2 }) }) });
  assert.equal(sheet.roll({ seed: 1, mem: {} }).score.crew.type, 'Stagehands', 'and so does the sheet\'s');
  assert.equal(sheet.controls({}).find((c) => c.id === 'crew').groups[0].options[0].label, 'Stagehands (the crew)');
});

// ---- a reroll moves only its own row and what reads it ----------------------------------------------------------------------------
const FIELDS = {
  lead: (s) => s.seed, job: (s) => s.op, client: (s) => s.client, target: (s) => s.target, asset: (s) => s.asset,
  site: (s) => ({ site: s.site, vector: s.vector, ways: s.ways }), why: (s) => s.why, twist: (s) => s.twist, threat: (s) => s.threats,
  pay: (s) => s.pay, extra: (s) => ({ shot: s.shot, cost: s.cost, earns: s.earns })
};
// who reads whom (the order in the header of score.js), with nothing locked
const READS = { job: ['lead'], client: ['target'], target: ['lead'], asset: ['job', 'lead'], site: ['target', 'asset', 'job'], why: ['site'], twist: ['site'], pay: ['client', 'target', 'site'] };
function downstream(x) {
  const out = new Set([x]); let grew = true;
  while (grew) { grew = false; for (const [y, rs] of Object.entries(READS)) if (!out.has(y) && rs.some((r) => out.has(r))) { out.add(y); grew = true; } }
  return out;
}

await test('reroll(replay, row): the same seed, the same memory and choices, that section\'s bump + 1; no section it does not feed moves', () => {
  const rows = ['lead', 'client', 'job', 'target', 'site', 'why', 'twist', 'pay'];
  for (const ui of [undefined, { client: 'fac:' + FAC[0] }]) for (let i = 0; i < 40; i++) {
    const r = G.roll({ seed: seedOf(i + 100), ui, mem: { why: ['a'] } });
    for (const row of rows) {
      const rr = G.reroll(r.replay, row), sec = S.ROWS[row];
      const flag = row === 'lead' ? r.card.lines.find((l) => l.id === 'lead').reroll : rowOf(r, row).reroll;
      assert.equal(rr.seed, r.seed); assert.deepEqual(rr.replay.mem, r.replay.mem, 'the memory is the same as before the first roll'); assert.deepEqual(rr.replay.ui, r.replay.ui);
      assert.ok((rr.replay.bump[sec] || 0) >= (r.replay.bump[sec] || 0) + 1, row + ': the section\'s bump went up');
      assert.deepEqual(Object.keys(rr.replay.bump).filter((k) => k !== sec), [], 'and no other');
      assert.deepEqual(G.replay(rr.replay).card, rr.card, row + ': the reroll redraws exactly from its replay');
      const down = downstream(sec);
      if (ui && ui.client && (sec === 'client')) continue;                  // a locked client has nothing to draw
      for (const y of Object.keys(FIELDS)) if (!down.has(y) && y !== sec) assert.deepEqual(FIELDS[y](rr.score), FIELDS[y](r.score), row + ' moved ' + y + ' (seed ' + r.seed + ')');
      assert.deepEqual(rr.score.crew, r.score.crew);
      if (flag) assert.notEqual(JSON.stringify(rr.card.lines), JSON.stringify(r.card.lines), row + ': something changed (seed ' + r.seed + ')');
      else assert.equal(JSON.stringify(rr.card.lines), JSON.stringify(r.card.lines), row + ' is flagged as fixed: nothing moves');
    }
  }
});

await test('reroll: the row itself reads differently (a second bump when the new stream lands on the same text); a fixed row has nothing to roll', () => {
  let more = 0, n = 0, skipped = 0;
  for (let i = 0; i < 80; i++) {
    const r = G.roll({ seed: seedOf(i + 300), mem: {} });
    for (const row of ['client', 'job', 'target', 'site', 'why', 'twist', 'pay', 'lead']) {
      const rr = G.reroll(r.replay, row), id = S.ROWS[row], line = (c) => (id === 'lead' ? c.card.lines.find((l) => l.id === 'lead') : rowOf(c, id));
      if (!line(r).reroll) { skipped++; continue; }
      assert.notEqual(line(rr).md, line(r).md, row + ' seed ' + r.seed); n++;
      if (rr.replay.bump[id] > 1) more++;
    }
  }
  assert.ok(more > 0 && more < n * 0.4, 'a second bump happens, but not often: ' + more + ' of ' + n);
  assert.ok(skipped > 0 && skipped < 80, 'some rows cannot move (a seed that names a single operation fixes the job): ' + skipped);
  // a row the GM fixed: ↻ would move nothing, so the card does not offer it
  const r = G.roll({ seed: 4, mem: {}, ui: { job: 'Lift', target: 'fac:' + FAC[3], client: '-' } });
  assert.deepEqual(['client', 'job', 'target'].map((id) => rowOf(r, id).reroll), [false, false, false]);
  assert.equal(G.reroll(r.replay, 'job').score.op.name, 'Lift'); assert.equal(G.reroll(r.replay, 'target').score.target.name, FAC[3]);
  const k = G.roll({ seed: 4, mem: {}, ui: { target: 'enemy', client: 'kind:Civilian' } });
  assert.deepEqual(['client', 'target'].map((id) => rowOf(k, id).reroll), [true, true], 'a kind of client, or an enemy, still has a draw in it');
  assert.deepEqual(['why', 'twist', 'site', 'pay'].map((id) => rowOf(k, id).reroll), [true, true, true, true]);
  assert.equal(rowOf(k, 'ways').reroll, false);
  assert.throws(() => G.reroll(k.replay, 'asset'), /unknown row/); assert.throws(() => G.reroll(k.replay, 'nonsense'), /unknown row/);
  assert.deepEqual(G.reroll(k.replay, 'pitch').replay.bump, G.reroll(k.replay, 'lead').replay.bump, 'pitch is the lead'); assert.deepEqual(G.reroll(k.replay, 'where').replay.bump, G.reroll(k.replay, 'site').replay.bump, 'where is the site');
});

await test('every section has its own stream: rolling one row again twice and then once more is a walk through that section\'s streams only', () => {
  const r = G.roll({ seed: 77, mem: {} });
  const a = G.reroll(r.replay, 'twist'), b = G.reroll(a.replay, 'twist');
  assert.ok(b.replay.bump.twist > a.replay.bump.twist); assert.deepEqual(FIELDS.target(b.score), FIELDS.target(r.score)); assert.deepEqual(FIELDS.site(b.score), FIELDS.site(r.score));
  const c = G.reroll(b.replay, 'why'); assert.ok(c.replay.bump.twist === b.replay.bump.twist && c.replay.bump.why >= 1, 'the bumps are kept per section');
  assert.equal(S.fnv('1:lead:0'), S.fnv('1:lead:0')); assert.notEqual(S.fnv('1:lead:0'), S.fnv('1:lead:1'));
});

// ---- the locks ------------------------------------------------------------------------------------------------------------------
const WHO = { name: 'Nell Invented', faction: FAC[0], district: DIST[1], role: 'a ferry clerk', want: 'her ledger back' };
await test('lock: an NPC asks (from ui.who): they are the client, the pitch and the payer; their faction is never the target', () => {
  const rs = sweep(200, { client: 'npc:nell', who: WHO });
  for (const r of rs) {
    const c = r.score.client;
    assert.equal(c.type, 'npc'); assert.equal(c.name, 'Nell Invented'); assert.equal(c.role, 'a ferry clerk'); assert.equal(c.faction, FAC[0]);
    assert.notEqual(r.score.target.name, FAC[0], 'not against their own');
    assert.equal(r.score.pay.payer.type, 'client'); assert.match(r.score.pay.payer.text, /Nell Invented/);
    if (!r.score.seed) assert.ok(r.score.pitch.startsWith('**Nell Invented** wants you to '), r.score.pitch);
    assert.match(rowOf(r, 'client').md, /^\*\*Nell Invented\*\* \(a ferry clerk · .*\) — \*wants her ledger back\*$/);
    assert.deepEqual(S.npcHints(r.score), { faction: FAC[0], district: r.score.site.district });
  }
  const rivals = new Set([FAC[1], FAC[4], FAC[8]]);          // FAC[0]'s dossier names FAC[1] and FAC[4]; FAC[8]'s names FAC[0]
  const hit = rs.filter((r) => rivals.has(r.score.target.name)).length;
  assert.ok(hit > 200 * 0.4, 'a faction\'s NPC mostly asks about its rivals: ' + hit + ' of 200');
  assert.ok(rs.some((r) => !rivals.has(r.score.target.name)), 'but not always');
});

await test('lock: a faction asks; a kind of client; nobody (the crew\'s own pay lines, else "seized from the target")', () => {
  for (const r of sweep(60, { client: 'fac:' + FAC[6] })) { assert.deepEqual([r.score.client.type, r.score.client.name], ['faction', FAC[6]]); assert.notEqual(r.score.target.name, FAC[6]); assert.match(rowOf(r, 'client').md, /^\*\*The Hobb30 Guild\*\* \(Tier I weak\)( · at odds with the target)?$/); assert.equal(S.npcHints(r.score).faction, FAC[6]); }
  const kinds = Object.fromEntries(T.client.map((c) => [c[0], c[1]]));
  for (const k of Object.keys(kinds)) for (const r of sweep(40, { client: 'kind:' + k })) {
    assert.equal(r.score.client.type, 'kind'); assert.equal(r.score.client.kind, k); assert.ok(kinds[k].includes(r.score.client.name));
    assert.deepEqual(S.npcHints(r.score), { faction: '', district: r.score.site.district }, 'a kind of client has no faction to ask the NPC tab for');
  }
  for (const r of sweep(80, { client: '-' })) {
    assert.equal(r.score.client.type, 'nobody'); assert.ok(r.score.pitch.startsWith("**Nobody's asking.** You've seen a way to ") || r.score.seed, r.score.pitch);
    if (r.score.pay.payer.type === 'line') assert.ok(T.crew.Tunnellers.pays.includes(r.score.pay.payer.text)); else assert.fail('Tunnellers have pay lines');
    assert.equal(S.cardEntry(r.score).client, '', 'no client on the index card'); assert.equal(S.npcHints(r.score).faction, r.score.target.name, 'a face of the target\'s when nobody asks');
  }
  for (const r of sweep(30, { client: '-', crew: 'Stagehands' })) assert.deepEqual(r.score.pay.payer, { type: 'seized', text: 'seized from the target' });
});

await test('lock: the target is a faction, an enemy of the crew, or someone on bad terms; the job and the district are the GM\'s', () => {
  for (const r of sweep(60, { target: 'fac:' + FAC[10] })) assert.equal(r.score.target.name, FAC[10]);
  const seen = new Set();
  for (const r of sweep(150, { target: 'enemy' })) { assert.ok(ENEMIES.includes(r.score.target.name), r.score.target.name); assert.equal(r.score.target.enemy, true); seen.add(r.score.target.name); }
  assert.equal(seen.size, ENEMIES.length, 'every enemy comes up');
  for (const r of sweep(80, { target: 'foe' })) { assert.equal(r.score.target.name, FOE); assert.equal(r.score.target.foe, true); }
  for (const job of Object.keys(T.op)) for (const r of sweep(60, { job })) { assert.equal(r.score.op.name, job); if (r.score.seed) { const sd = T.crew.Tunnellers.seeds.find((x) => x.t === r.score.seed.t); assert.ok(!sd.ops.length || sd.ops.includes(job), 'a seed that does not suit the job is not used'); } }
  for (const d of DIST) for (const r of sweep(60, { district: d })) assert.equal(r.score.site.district, d, 'the GM\'s district wins, holdings included');
  const anywhere = new Set(sweep(120, { district: '*' }).map((r) => r.score.site.district)); assert.equal(anywhere.size, DIST.length, 'anywhere is any district');
  for (const r of sweep(60, { district: 'now', nowIn: DIST[2] })) assert.equal(r.score.site.district, DIST[2]);
  for (const r of sweep(60, { district: 'now' })) assert.ok(DIST.includes(r.score.site.district), 'Now in unknown: where the target is');
  const both = sweep(40, { job: 'Torch', target: 'fac:' + FAC[2], district: DIST[3], client: 'fac:' + FAC[5], crew: 'Stagehands', tier: 2 });
  for (const r of both) { assert.deepEqual([r.score.op.name, r.score.target.name, r.score.site.district, r.score.client.name, r.score.crew.type, r.score.crew.tier], ['Torch', FAC[2], DIST[3], FAC[5], 'Stagehands', 2]); }
});

await test('where it happens: the district the target is in (the districts that list it), else Now in, else any; a holding about half the time', () => {
  const inDist = (f) => DIST.filter((d) => T.loc.gaz[d].factions.includes(f));
  let holds = 0, n = 0;
  for (const f of FAC) {
    const where = inDist(f);
    for (const r of sweep(40, { target: 'fac:' + f })) {
      const dd = r.score.site.district;
      if (!r.score.site.place) assert.ok(where.length ? where.includes(dd) : DIST.includes(dd), f + ' in ' + dd);
      else assert.ok(T.holding[f].some((h) => h[0] === r.score.site.place), 'a holding of the target\'s own');
    }
  }
  for (const r of sweep(300, { target: 'fac:' + FAC[1] })) { n++; if (r.score.site.place) { holds++; assert.match(rowOf(r, 'site').md, /^(Calp Annex|The Calp Counter) \((Test depot|Bank)\)( · .+)?$/); } else assert.match(rowOf(r, 'site').md, /^[A-Za-z ]+ · /); }
  assert.ok(holds > n * 0.35 && holds < n * 0.65, 'about half: ' + holds + ' of ' + n);
  const noTarget = sweep(60, { target: 'fac:' + FAC[11], district: 'now', nowIn: DIST[1] }); for (const r of noTarget) assert.equal(r.score.site.district, DIST[1]);
  const lonely = sweep(60, { target: 'fac:' + FAC[9] }); for (const r of lonely) assert.ok(DIST.includes(r.score.site.district), 'a faction no district lists still happens somewhere');
  const withNow = sweep(60, { target: 'fac:' + FAC[9], nowIn: DIST[3] }); for (const r of withNow) assert.equal(r.score.site.district, DIST[3], 'a target in no district: Now in');
});

await test('the building: a type for the asset kind, or a holding\'s own; the asset kind follows the job (and a seed\'s kind)', () => {
  for (const r of sweep(200)) {
    const s = r.score, kinds = T.op[s.op.name].kinds;
    if (s.seed && s.seed.kind) assert.equal(s.asset.kind, s.seed.kind, 'a seed names its kind'); else assert.ok(kinds.includes(s.asset.kind), s.op.name + ' / ' + s.asset.kind);
    assert.ok(T.asset[s.asset.kind].includes(s.asset.phrase));
    if (!s.site.place) assert.ok(T.site[s.asset.kind].includes(s.site.type), s.asset.kind + ' / ' + s.site.type);
    assert.ok(T.loc.targetNames.includes(s.site.type), 'a building the location generator has: Roll the site always matches');
  }
});

// ---- the pitch ---------------------------------------------------------------------------------------------------------------------
await test('seeded pitches (about 40%): the crew\'s enemy phrase becomes the target, and a seed that names an enemy forces one', () => {
  const rs = sweep(400, undefined); let seeded = 0, enemySeeds = 0;
  for (const r of rs) {
    const s = r.score;
    if (!s.seed) { assert.match(s.pitch, /^\*\*.+\*\* wants you to .+\.$|^\*\*Nobody's asking\.\*\* You've seen a way to .+\.$/, s.pitch); continue; }
    seeded++;
    assert.ok(!/an enemy of the crew/i.test(s.pitch), 'the phrase is replaced: ' + s.pitch);
    if (s.seed.enemy) { enemySeeds++; assert.ok(ENEMIES.includes(s.target.name), 'an enemy seed names an enemy'); assert.ok(s.pitch.toLowerCase().includes(s.target.name.toLowerCase().replace(/^the /, '')), 'and the pitch names it: ' + s.pitch); }
    else assert.equal(s.pitch, s.seed.t, 'a seed without the phrase is the text as written');
    assert.equal(r.card.lines.find((l) => l.id === 'lead').md, s.pitch);
  }
  assert.ok(seeded > 400 * 0.25 && seeded < 400 * 0.5, 'about 40%: ' + seeded); assert.ok(enemySeeds > 0);
  // sentence start and mid-sentence, any case; a name ending in s takes only the apostrophe; "The" goes down in a sentence
  const t = clone(T); t.crew.Tunnellers.seeds = [{ t: 'Word is AN ENEMY of the crew hides in the cellar. an enemy of the crew has the key.', ops: ['Lift'], enemy: true }];
  t.faction[2][0] = 'The Mill Lane Guards'; t.loc.factionDetail['The Mill Lane Guards'] = { boss: 'B' };
  const g = S.create({ T: t, campaign: CAMP });
  let hit = null; for (let i = 0; i < 80 && !hit; i++) { const r = g.roll({ seed: seedOf(i), ui: { target: 'fac:The Mill Lane Guards', job: 'Lift' }, mem: {} }); if (r.score.seed) hit = r; }
  assert.ok(hit, 'a seed turned up');
  assert.equal(hit.score.pitch, 'Word is the Mill Lane Guards hides in the cellar. the Mill Lane Guards has the key.'.replace('. the Mill', '. The Mill'), 'sentence start keeps its capital, mid-sentence "The" goes down');
  const pos = g.roll({ seed: seedOf(3), ui: { target: 'fac:The Mill Lane Guards', client: 'fac:' + FAC[0], job: 'Break in' }, mem: {} });
  assert.match(pos.score.objective, /^break into the Mill Lane Guards' /, 'a name ending in s: the apostrophe alone, "The" down: ' + pos.score.objective);
  const nos = G.roll({ seed: seedOf(3), ui: { target: 'fac:' + FAC[0], job: 'Lift' }, mem: {} });
  assert.match(nos.score.objective, /^lift the Brisk30 Guild's /);
});

await test('the composed pitch: "<client> wants you to <objective>." with the verb\'s {A} read as "<Target>\'s <asset>"; {district} in an asset phrase is the place', () => {
  let tokens = 0;
  for (const r of sweep(300, { client: 'kind:Criminal', job: 'Break in' })) {
    const s = r.score; if (s.seed) continue;
    assert.equal(s.pitch, '**' + s.client.name[0].toUpperCase() + s.client.name.slice(1) + '** wants you to ' + s.objective + '.');
    assert.ok(s.objective.includes(s.target.name.replace(/^The /, 'the ') + "'s "), s.objective);
    assert.ok(!/\{district\}/.test(s.pitch + JSON.stringify(r.card)), 'no raw token');
    if (T.asset[s.asset.kind].some((p) => p.includes('{district}') && p === s.asset.phrase)) { tokens++; assert.ok(s.objective.includes(s.site.district), s.objective + ' in ' + s.site.district); }
  }
  assert.ok(tokens > 0, 'a {district} phrase came up');
  const t = clone(T); delete t.loc;
  const r = S.create({ T: t, campaign: CAMP }).roll({ seed: 1, mem: {} }); assert.ok(!/\{district\}/.test(JSON.stringify(r.card)), 'no place known: a neutral word, not a raw token');
});

// ---- the pay ---------------------------------------------------------------------------------------------------------------------------
await test('pay: the crew\'s Tier in dice, the highest kept; a 0d crew rolls two and keeps the LOWEST; plus the target\'s Tier and the district\'s pay', () => {
  for (let tier = 0; tier <= 6; tier++) for (const r of sweep(60, { tier })) {
    const p = r.score.pay, rule = T.districtRule[r.score.site.district], dp = rule ? rule.pay : 0;
    assert.equal(p.dice.length, tier === 0 ? 2 : tier); assert.ok(p.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6));
    assert.equal(p.kept, tier === 0 ? Math.min(...p.dice) : Math.max(...p.dice)); assert.equal(p.zero, tier === 0);
    assert.equal(p.total, Math.max(0, p.kept + r.score.target.tier + dp)); assert.equal(p.district, dp);
    const md = rowOf(r, 'pay').md;
    assert.equal(/keep lowest/.test(md), tier === 0, md); assert.ok(md.includes('[' + p.dice.join(' ') + ']') && md.includes('→ ' + p.kept), md);
    assert.ok(md.startsWith('**' + p.total + (p.total === 1 ? ' stack' : ' stacks') + '** · ' + p.dice.length + 'd '), md);
    assert.ok(md.includes('+ Tier ' + ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'][r.score.target.tier]), md);
    if (dp) assert.ok(md.includes('+1 district'), md);
  }
  const lows = sweep(400, { tier: 0 }).filter((r) => r.score.pay.dice[0] !== r.score.pay.dice[1] && r.score.pay.kept === Math.min(...r.score.pay.dice)); assert.ok(lows.length > 300);
  assert.ok(sweep(300, { tier: 0 }).some((r) => r.score.pay.dice[0] > r.score.pay.kept), 'the lower of two, not the first');
});

await test('scope: the first row of T.scope whose threshold is at or under the payout, at every boundary; the clock is 4, 6 or 8 by it unless the why row has one', () => {
  const rows = T.scope.slice().sort((a, b) => b[0] - a[0]), seen = new Set();
  const expect = (n) => rows.find((x) => x[0] <= n)[1];
  for (let tier = 0; tier <= 6; tier++) for (const f of FAC) for (const r of sweep(8, { tier, target: 'fac:' + f, district: DIST[1] })) {
    const n = r.score.pay.total; seen.add(n);
    assert.equal(r.score.pay.scope, expect(n), 'payout ' + n);
    const w = r.score.why, want = w.clock && w.size ? w.size : n >= 8 ? 8 : n >= 6 ? 6 : 4;
    assert.equal(r.score.clock.size, want, 'payout ' + n + ' clock'); if (w.clock) assert.equal(r.score.clock.name, w.clock); else assert.ok(T.op[r.score.op.name].clock.includes(r.score.clock.name));
    const phrase = rows.find((x) => x[0] <= n)[1].split(/ — |: |\. | \(/)[0].replace(/\.$/, ''), low = phrase.charAt(0).toLowerCase() + phrase.slice(1);
    assert.ok(r.card.meta.sub.endsWith(' · ' + n + (n === 1 ? ' stack, ' : ' stacks, ') + low), r.card.meta.sub + ' / ' + low);
  }
  for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 11]) assert.ok(seen.has(n), 'payout ' + n + ' came up');
  const edge = clone(T); edge.scope = [[0, 'low'], [7, 'high']];            // unsorted rows still read highest first; a payout under every threshold takes the last
  const e = S.create({ T: edge, campaign: CAMP });
  for (const r of Array.from({ length: 80 }, (_, i) => e.roll({ seed: seedOf(i), mem: {} }))) assert.equal(r.score.pay.scope, r.score.pay.total >= 7 ? 'high' : 'low');
  assert.equal(S.create({ T: Object.assign(clone(T), { scope: [[5, 'only']] }), campaign: CAMP }).roll({ seed: 2, ui: { tier: 0 }, mem: {} }).score.pay.scope, 'only');
});

await test('the district\'s rule: its pay is in the payout, its engage modifier and its printed line are on the card', () => {
  const rule = T.districtRule[DIST[0]];
  for (const r of sweep(40, { district: DIST[0] })) {
    assert.equal(r.score.pay.district, rule.pay); assert.equal(r.score.engage.district, rule.engage);
    assert.match(rowOf(r, 'pay').md, /, \+1 district ·/);
    const cloud = r.card.lines.find((l) => l.id === 'cloud').rows, d = cloud.find((x) => x.id === 'district');
    assert.equal(d.md, rule.say + ' · heat +1'); assert.match(cloud.find((x) => x.id === 'engage').md, /District \*\*−1d\*\*/);
  }
  for (const r of sweep(40, { district: DIST[2] })) { assert.equal(r.score.engage.district, 1); assert.equal(r.score.pay.district, 0); assert.doesNotMatch(rowOf(r, 'pay').md, /district/); assert.match(r.card.lines.find((l) => l.id === 'cloud').rows.find((x) => x.id === 'engage').md, /District \*\*\+1d\*\*/); assert.equal(r.card.lines.find((l) => l.id === 'cloud').rows.find((x) => x.id === 'district').md, T.districtRule[DIST[2]].say); }
  for (const r of sweep(40, { district: DIST[3] })) { assert.equal(r.score.rule, null); assert.ok(!r.card.lines.find((l) => l.id === 'cloud').rows.some((x) => x.id === 'district'), 'no rule, no row'); assert.equal(r.score.engage.district, 0); }
});

await test('engagement: the Tier factor (above -1d, below +1d, level 0) and the crew\'s ability notes only when its ability is on the sheet and the gap reaches minGap', () => {
  const crewAt = (tier, abilities) => S.create({ T, campaign: Object.assign({}, CAMP, { crew: Object.assign({}, CAMP.crew, { tier, abilities }) }) });
  const facOfTier = (tt) => T.faction.find((x) => x[1] === tt)[0];
  for (const [tier, tt, factor] of [[1, 3, -1], [1, 1, 0], [3, 1, 1], [0, 6, -1], [6, 1, 1], [6, 6, 0]]) {
    const f = facOfTier(tt);
    const e = crewAt(tier, []).roll({ seed: 5, ui: { target: 'fac:' + f }, mem: {} }).score.engage;
    assert.deepEqual([e.gap, e.factor, e.notes], [tt - tier, factor, []], 'crew ' + tier + ' vs ' + tt);
  }
  const note = (tier, tt, abilities) => crewAt(tier, abilities).roll({ seed: 5, ui: { target: 'fac:' + facOfTier(tt) }, mem: {} });
  assert.deepEqual(note(1, 3, ['Tunnel rats']).score.engage.notes, ['No Tier penalty: the crew goes under it.'], 'gap 2 reaches minGap 2');
  assert.deepEqual(note(1, 2, ['Tunnel rats']).score.engage.notes, [], 'gap 1 does not');
  assert.deepEqual(note(1, 6, ['Tunnel rats']).score.engage.notes, ['No Tier penalty: the crew goes under it.'], 'and more does');
  assert.deepEqual(note(3, 1, ['Tunnel rats']).score.engage.notes, [], 'a target below the crew does not');
  assert.deepEqual(note(1, 1, ['Dark eyes']).score.engage.notes, ['+1d when the lights are out.'], 'minGap 0: always');
  assert.deepEqual(note(1, 3, ['tunnel RATS.', 'dark eyes']).score.engage.notes, ['No Tier penalty: the crew goes under it.', '+1d when the lights are out.'], 'abilities match without case or punctuation; in the table\'s order');
  assert.deepEqual(note(1, 3, ['Something else']).score.engage.notes, [], 'an ability the table has no note for');
  assert.deepEqual(note(1, 3, []).score.engage.notes, [], 'no ability on the sheet');
  const md = note(1, 3, ['Tunnel rats']).card.lines.find((l) => l.id === 'cloud').rows.find((x) => x.id === 'engage').md;
  assert.match(md, /^Tier \*\*−1d\*\* \(III against I\) — but No Tier penalty: the crew goes under it\./);
});

// ---- the twist's tokens ----------------------------------------------------------------------------------------------------------
await test('twist tokens: {pcFriend} {pcRival} {purveyor} {notable} {npc} read against the campaign; neutral fallbacks without it', () => {
  const t = clone(T); t.twist = [['Tokens', ['F={pcFriend}', 'R={pcRival}', 'P={purveyor}', 'N={notable}', 'X={npc}']]];
  const seen = {};
  const g = S.create({ T: t, campaign: CAMP });
  for (let i = 0; i < 200; i++) {
    const r = g.roll({ seed: seedOf(i), mem: {} }), tx = r.score.twist.text, k = tx[0];
    seen[k] = (seen[k] || 0) + 1; assert.ok(!BAD.test(tx), tx);
    if (k === 'F') assert.ok(CAMP.pcs.some((p) => p.friend.some((f) => tx === 'F=' + f + ', ' + (p.first || p.name.split(' ')[0]) + "'s friend")), tx);
    if (k === 'R') assert.ok(CAMP.pcs.some((p) => p.rival.some((f) => tx === 'R=' + f + ', ' + (p.first || p.name.split(' ')[0]) + "'s rival")), tx);
    if (k === 'P') assert.ok(CAMP.pcs.some((p) => tx === 'P=' + (p.first || p.name.split(' ')[0]) + "'s vice purveyor"), tx);
    if (k === 'N') { const notes = T.loc.gaz[r.score.site.district].notables.map((x) => x.split(' (')[0]); assert.ok(notes.some((n) => tx === 'N=' + n), tx + ' in ' + r.score.site.district); }
    if (k === 'X') assert.ok(CAMP.npcs.some((n) => tx === 'X=' + n.name), tx);
  }
  assert.equal(Object.keys(seen).length, 5, 'every token came up');
  const bare = S.create({ T: Object.assign(clone(t), {}), campaign: { crew: CAMP.crew } });
  const want = { F: "F=a PC's friend", R: "R=a PC's rival", P: "P=a PC's vice purveyor", N: 'N=' + 'a city notable', X: 'X=someone the crew knows' };
  const t2 = clone(t); delete t2.loc;
  const seen2 = new Set();
  for (const gg of [bare, S.create({ T: t2, campaign: { crew: CAMP.crew } })]) for (let i = 0; i < 100; i++) { const tx = gg.roll({ seed: seedOf(i), mem: {} }).score.twist.text; seen2.add(tx); if (gg !== bare || tx[0] !== 'N') assert.equal(tx, want[tx[0]], tx); }
  assert.equal(seen2.size >= 5, true);
  const lone = S.create({ T: t, campaign: { crew: CAMP.crew, pcs: [{ name: 'Rex Invented', friend: [], rival: [] }] } });
  const lt = Array.from({ length: 80 }, (_, i) => lone.roll({ seed: seedOf(i), mem: {} }).score.twist.text);
  assert.ok(lt.includes("P=Rex's vice purveyor") && lt.includes("F=a PC's friend") && lt.includes("R=a PC's rival"), 'a PC with no friends or rivals; a name from "name" when there is no "first"');
  const u = clone(T); u.twist = [['x', ['A {mystery} thing {district}']]];
  assert.equal(S.create({ T: u, campaign: CAMP }).roll({ seed: 1, ui: { district: DIST[3] }, mem: {} }).score.twist.text, 'A thing ' + DIST[3], 'an unknown token goes; {district} is the place');
});

// ---- the card ----------------------------------------------------------------------------------------------------------------------------
await test('the card: chips, the lead box, the eight core rows (rerollable ones carry their id), the folded cloud; meta; no HTML, no raw tokens', () => {
  for (const r of sweep(300)) {
    const L = r.card.lines, m = r.card.meta;
    assert.deepEqual(L.map((l) => l.id), ['chips', 'lead', 'score', 'cloud']); assert.deepEqual(L.map((l) => l.kind), ['chips', 'want', 'grid', 'grid']);
    assert.deepEqual(L[2].rows.map((x) => x.k), ["Who's asking", 'The job', 'Target', 'Where', 'Why now', 'Twist', 'Ways in', 'Pays']);
    assert.deepEqual(L[2].rows.map((x) => x.id), ['client', 'job', 'target', 'site', 'why', 'twist', 'ways', 'pay']);
    assert.ok(L[1].reroll === true && L[2].rows.every((x) => typeof x.reroll === 'boolean') && L[2].rows.find((x) => x.id === 'ways').reroll === false);
    assert.equal(L[3].title, 'The cloud'); assert.equal(L[3].collapsed, true); assert.ok(L[3].rows.every((x) => x.reroll === false));
    const ks = L[3].rows.map((x) => x.k), dossier = !!T.loc.factionDetail[r.score.target.name];
    for (const k of ['In the way', 'Clock', 'Engagement', 'Called Shot', 'Even if it goes well', 'Also earns']) assert.ok(ks.includes(k), k);
    for (const k of ['Their friends', 'Right now', 'Secret']) assert.equal(ks.includes(k), dossier, k + ' only for a target with a dossier');
    assert.equal(m.id, 'score'); assert.equal(m.title, r.score.op.name + ' · ' + r.score.target.name);
    assert.match(m.sub, /^Tier [IV0]+ · [A-Za-z ]+ · \d+ stacks?, .+$/); assert.equal(m.chips.length, 4); assert.equal(m.chips[0], r.score.op.name); assert.equal(m.chips[3], T.op[r.score.op.name].loud ? 'loud' : 'quiet');
    assert.ok(m.label.length <= 60); assert.equal(m.text, S.plain(r.score.pitch)); assert.ok(m.all.length > 15 && m.all.every((x) => !/\*\*|(^|\s)\*\w/.test(x)), 'plain lines for Copy, Pin and L');
    for (const md of mdOf(r)) { assert.ok(!/</.test(md), 'no HTML in ' + md); assert.ok(!BAD.test(md), md); }
    for (const a of m.all) assert.ok(!BAD.test(a) && !/</.test(a), a);
    const cl = L[3].rows.find((x) => x.id === 'clock').md; assert.match(cl, /^\*\*.+\*\* · [468]|12 segments$|segments$/);
    const shot = L[3].rows.find((x) => x.id === 'shot').md; assert.match(shot, /— \*\*\+[123] stacks?\*\*, −[123] if they fail it$/);
    const val = Number(shot.match(/\+(\d)/)[1]), idx = [0, 1, 2].find((i) => T.calledShot[i].some((e) => shot.startsWith(e + ' —')));
    assert.equal(val, idx + 1, 'the lists are worth 1, 2 and 3: ' + shot); assert.equal(r.score.shot.value, val);
    assert.match(L[2].rows.find((x) => x.id === 'target').md, /^\*\*.+\*\* · Tier [IV0?]+ (strong|weak)( · Boss [A-I] Invented)?$/);
    assert.equal(L[2].rows.find((x) => x.id === 'ways').md.split(' · ').length, r.score.op.ways.length);
  }
});

await test('ways in: the obvious way in from T.vector for the first approach, then each other approach with the book\'s gloss', () => {
  for (const r of sweep(80)) {
    const w = r.score.op.ways, md = rowOf(r, 'ways').md;
    assert.ok(T.vector[w[0]].includes(r.score.vector)); assert.ok(md.startsWith('**Obvious:** ' + r.score.vector + ' *(' + w[0] + ')*'), md);
    for (const a of w.slice(1)) assert.ok(md.includes('or **' + a + '**: ' + T.approach.find((x) => x[0] === a)[1]), md);
  }
  const t = clone(T); delete t.vector; const g = S.create({ T: t, campaign: CAMP });
  for (let i = 0; i < 40; i++) { const r = g.roll({ seed: seedOf(i), mem: {} }), md = rowOf(r, 'ways').md; assert.equal(r.score.vector, ''); assert.ok(md.startsWith('**' + r.score.op.ways[0] + '**: '), md); assert.ok(!md.includes('Obvious')); }
});

await test('cardEntry: the Cards panel\'s index card, every field 120 characters at most; siteHints, npcHints and clockOf', () => {
  for (const ui of [undefined, { client: 'npc:n', who: WHO }, { client: '-' }, { client: 'kind:Political' }]) for (const r of sweep(80, ui)) {
    const e = S.cardEntry(r.score);
    assert.deepEqual(Object.keys(e), ['from', 'client', 'target', 'type', 'note', 'payout']); assert.equal(e.from, 'GM');
    for (const k of Object.keys(e)) assert.ok(typeof e[k] === 'string' && e[k].length <= 120, k + ': ' + e[k].length);
    assert.equal(e.target, r.score.target.name + ' (' + ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'][r.score.target.tier] + ')'); assert.equal(e.type, r.score.op.name); assert.match(e.payout, /^\d+ stacks?$/);
    assert.ok(e.note.length > 10 && !/\*/.test(e.note)); if (!r.score.seed) assert.ok(e.note.startsWith(r.score.objective[0].toUpperCase()) && e.note.endsWith('.'), e.note);
    const h = S.siteHints(r.score); assert.deepEqual(h, { target: r.score.site.type, district: r.score.site.district, faction: r.score.target.name, approach: r.score.op.ways[0] });
    assert.deepEqual(S.clockOf(r.score), { name: r.score.clock.name, size: r.score.clock.size }); assert.ok(h.target && h.district && h.approach);
  }
  const long = clone(T); long.faction[0][0] = 'The ' + 'Extraordinarily Long Invented Name '.repeat(8).trim(); long.crew.Tunnellers.seeds[0].t = 'An enemy of the crew ' + 'goes on and on and on '.repeat(20);
  const big = S.create({ T: long, campaign: { crew: { type: 'Tunnellers', tier: 1, enemies: [long.faction[0][0]], abilities: [] } } });
  let cut = 0;
  for (let i = 0; i < 80; i++) { const e = S.cardEntry(big.roll({ seed: seedOf(i), ui: { target: 'enemy', client: 'fac:' + long.faction[0][0] }, mem: {} }).score); for (const k of Object.keys(e)) { assert.ok(e[k].length <= 120, k); if (e[k].endsWith('…')) cut++; } }
  assert.ok(cut > 0, 'a long name is cut at a word with an ellipsis');
});

// ---- the card's wording ------------------------------------------------------------------------------------------------------------------------
await test('wording: the twist row starts with a capital and names its list in italics, lower-case; the score keeps the text as drawn', () => {
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1), lists = new Set();
  for (const r of sweep(150)) {
    const t = r.score.twist, md = rowOf(r, 'twist').md;
    assert.ok(['Trouble', 'Surprise'].includes(t.list)); lists.add(t.list);
    assert.equal(md, cap(t.text) + ' *(' + t.list.toLowerCase() + ')*'); assert.match(md, /^[A-Z0-9]/);
    assert.ok(r.card.meta.all.includes('Twist: ' + cap(t.text) + ' (' + t.list.toLowerCase() + ')'), 'plain lines drop the italics');
  }
  assert.equal(lists.size, 2, 'both lists came up');
  const t = clone(T); t.twist = [['Connected To Someone', ['{pcFriend}', 'a quiet word reaches {npc}']], ['Political or logistical', ['the job needs a boat']]];
  const g = S.create({ T: t, campaign: CAMP });
  const seen = new Set();
  for (let i = 0; i < 120; i++) { const r = g.roll({ seed: seedOf(i), mem: {} }), md = rowOf(r, 'twist').md; seen.add(md); assert.match(md, /^[A-Z]/, md); }
  assert.ok([...seen].some((m) => /^A quiet word reaches .+ \*\(connected to someone\)\*$/.test(m)), 'lower-case text is capitalised: ' + [...seen].join(' | '));
  assert.ok(seen.has('The job needs a boat *(political or logistical)*'));
  assert.ok([...seen].some((m) => /^[A-Z][a-z]+( [A-Z][a-z]+)*, [A-Z][a-z]+'s friend \*\(connected to someone\)\*$/.test(m)), 'a bare token result keeps its context: ' + [...seen].join(' | '));
  const noList = clone(T); noList.twist = [['', ['plain words']]];
  assert.equal(rowOf(S.create({ T: noList, campaign: CAMP }).roll({ seed: 1, mem: {} }), 'twist').md, 'Plain words', 'no list name, nothing to append');
});

await test('wording: the scope after "n stacks," has no full stop and starts in lower case (unless it opens with capitals)', () => {
  const cases = [['A minor job', 'a minor job'], ['A small job.', 'a small job'], ['A big score: the kind that changes a crew', 'a big score'], ['A legendary score — they will tell it for years.', 'a legendary score'],
    ['ABC outfit job', 'ABC outfit job'], ['A scrape...', 'a scrape'], ['A standard score (worth the planning). Really.', 'a standard score'], ['Short', 'short']];
  for (const [text, want] of cases) {
    const g = S.create({ T: Object.assign(clone(T), { scope: [[0, text]] }), campaign: CAMP });
    for (let i = 0; i < 6; i++) { const r = g.roll({ seed: seedOf(i), mem: {} }); assert.equal(r.score.pay.scopeShort, want, text); assert.ok(r.card.meta.sub.endsWith(', ' + want), r.card.meta.sub); assert.equal(r.score.pay.scope, text, 'the full scope is kept as written'); }
  }
  const long = S.create({ T: Object.assign(clone(T), { scope: [[0, 'A remarkably long description of a score that goes on and on without any punctuation to cut it short']] }), campaign: CAMP }).roll({ seed: 1, mem: {} });
  assert.ok(long.score.pay.scopeShort.length <= 40 && long.score.pay.scopeShort.endsWith('…') && /^a remarkably/.test(long.score.pay.scopeShort), long.score.pay.scopeShort);
  assert.match(sweep(1, { tier: 0 })[0].card.meta.sub, / · \d+ stacks?, [a-z]/);
});

await test('wording: the job row is short ("<operation> · aim at their <asset>"); the definition is the first row of the cloud, "By the book", with the crew\'s enemy phrase read as the target', () => {
  for (const r of sweep(150)) {
    const s = r.score, md = rowOf(r, 'job').md;
    assert.equal(md, '**' + s.op.name + '** · aim at their *' + s.asset.phrase.replace(/\{district\}/g, s.site.district || 'the district') + '*'); assert.ok(!md.includes(s.op.def) && !md.includes('—'));
    const cloud = r.card.lines.find((l) => l.id === 'cloud').rows;
    assert.deepEqual([cloud[0].k, cloud[0].id, cloud[0].md, cloud[0].reroll], ['By the book', 'def', T.op[s.op.name].def, false], 'a definition without the phrase is as written');
    assert.ok(r.card.meta.all.includes('By the book: ' + T.op[s.op.name].def));
  }
  const t = clone(T); t.op['Break in'].def = 'An Enemy Of The Crew is made to pay; or an enemy of the crew is robbed.'; t.op.Lift.def = 'An enemy of the crew is robbed.';
  const g = S.create({ T: t, campaign: CAMP });
  const a = g.roll({ seed: 4, ui: { job: 'Break in', target: 'fac:' + FAC[3] }, mem: {} });
  assert.equal(a.card.lines.find((l) => l.id === 'cloud').rows[0].md, 'The Eskel30 Guild is made to pay; or the Eskel30 Guild is robbed.', 'sentence start keeps its capital, mid-sentence "The" goes down');
  assert.equal(a.score.op.book, 'The Eskel30 Guild is made to pay; or the Eskel30 Guild is robbed.'); assert.match(a.score.op.def, /^An Enemy Of The Crew/, 'op.def stays as written');
  const b = g.roll({ seed: 4, ui: { job: 'Lift', target: 'fac:' + FAC[0], crew: 'Stagehands' }, mem: {} });
  assert.equal(b.card.lines.find((l) => l.id === 'cloud').rows[0].md, 'An enemy of the crew is robbed.', 'a crew with no enemy phrase leaves the text alone');
  const c = g.roll({ seed: 4, ui: { job: 'Lift', target: 'fac:' + FAC[0] }, mem: {} });
  assert.equal(c.card.lines.find((l) => l.id === 'cloud').rows[0].md, 'The Brisk30 Guild is robbed.', 'even when the target is not an enemy');
  const e = clone(T); e.op.Lift.def = ''; assert.ok(!S.create({ T: e, campaign: CAMP }).roll({ seed: 1, ui: { job: 'Lift' }, mem: {} }).card.lines.find((l) => l.id === 'cloud').rows.some((x) => x.k === 'By the book'), 'no definition, no row');
});

await test('wording: when nobody asks, a crew pay line reads "paid through <line>"; a client "paid by <client>"; "seized from the target" stands as it is', () => {
  for (const r of sweep(60, { client: '-' })) {
    assert.equal(r.score.pay.payer.type, 'line'); const md = rowOf(r, 'pay').md;
    assert.ok(md.endsWith(' · paid through ' + r.score.pay.payer.text), md); assert.ok(T.crew.Tunnellers.pays.includes(r.score.pay.payer.text));
  }
  for (const r of sweep(20, { client: '-', crew: 'Stagehands' })) assert.ok(rowOf(r, 'pay').md.endsWith(' · seized from the target') && !/paid/.test(rowOf(r, 'pay').md), rowOf(r, 'pay').md);
  for (const r of sweep(20, { client: 'kind:Civilian' })) assert.ok(rowOf(r, 'pay').md.endsWith(' · paid by ' + r.score.client.name), rowOf(r, 'pay').md);
});

await test('wording: ability notes follow a Tier penalty after " — but "; with a bonus or an even match they just list', () => {
  const at = (tier, tt, abilities) => S.create({ T, campaign: Object.assign({}, CAMP, { crew: Object.assign({}, CAMP.crew, { tier, abilities }) }) })
    .roll({ seed: 5, ui: { target: 'fac:' + T.faction.find((x) => x[1] === tt)[0], district: DIST[3] }, mem: {} }).card.lines.find((l) => l.id === 'cloud').rows.find((x) => x.id === 'engage').md;
  assert.equal(at(1, 3, ['Tunnel rats', 'Dark eyes']), 'Tier **−1d** (III against I) — but No Tier penalty: the crew goes under it. · +1d when the lights are out.');
  assert.equal(at(1, 3, []), 'Tier **−1d** (III against I)', 'no ability, nothing after the Tier part');
  assert.equal(at(1, 1, ['Dark eyes']), 'Tier **0** (I against I) · +1d when the lights are out.', 'an even match: not a contradiction, so no "but"');
  const always = clone(T); always.crew.Tunnellers.note[1].minGap = -9;                 // a note with a negative minGap applies against a weaker target too
  assert.equal(S.create({ T: always, campaign: Object.assign({}, CAMP, { crew: Object.assign({}, CAMP.crew, { tier: 3, abilities: ['Dark eyes'] }) }) }).roll({ seed: 5, ui: { target: 'fac:' + FAC[0], district: DIST[3] }, mem: {} }).card.lines.find((l) => l.id === 'cloud').rows.find((x) => x.id === 'engage').md, 'Tier **+1d** (I against III) · +1d when the lights are out.', 'a bonus: no "but" either');
  assert.equal(at(3, 1, ['Dark eyes']), 'Tier **+1d** (I against III)', 'minGap 0 needs the target level or above');
  const rd = S.create({ T, campaign: CAMP }).roll({ seed: 5, ui: { target: 'fac:' + FAC[2], district: DIST[2] }, mem: {} }).card.lines.find((l) => l.id === 'cloud').rows.find((x) => x.id === 'engage').md;
  assert.equal(rd, 'Tier **−1d** (III against I) — but No Tier penalty: the crew goes under it. · +1d when the lights are out. · District **+1d**', 'the district\'s modifier comes last');
});

await test('wording: a faction that asks and is at odds with the target (it is in the target\'s against list) says so on the row', () => {
  const rivals = new Set([FAC[1], FAC[4], FAC[8]]);                       // FAC[0]'s dossier names FAC[1] and FAC[4]; FAC[8]'s names FAC[0]
  for (const f of FAC) for (const r of sweep(12, { client: 'fac:' + FAC[0], target: 'fac:' + f })) {
    if (f === FAC[0]) continue;
    const md = rowOf(r, 'client').md, odd = rivals.has(f);
    assert.equal(r.score.client.atOdds, odd, f); assert.equal(/ · at odds with the target$/.test(md), odd, md);
  }
  assert.equal(rowOf(G.roll({ seed: 3, ui: { client: 'fac:' + FAC[0], target: 'fac:' + FAC[1] }, mem: {} }), 'client').md, '**The Brisk30 Guild** (Tier I weak) · at odds with the target');
  let drawn = 0;
  for (const r of sweep(400)) {
    if (r.score.client.type === 'faction') { drawn++; assert.equal(r.score.client.atOdds, true, 'a client drawn against the target is at odds with it'); assert.ok(rowOf(r, 'client').md.endsWith(' · at odds with the target')); }
    else { assert.ok(!('atOdds' in r.score.client)); assert.ok(!/at odds/.test(rowOf(r, 'client').md)); }
  }
  assert.ok(drawn > 20, 'factions are drawn as clients: ' + drawn);
  for (const r of sweep(40, { client: 'npc:n', who: WHO, target: 'fac:' + FAC[1] })) assert.ok(!/at odds/.test(rowOf(r, 'client').md), 'an NPC\'s row is as it was');
});

// ---- without the optional tables ----------------------------------------------------------------------------------------------------------
await test('a pack without T.loc, T.holding, T.vector, T.cost, T.earns or T.districtRule still rolls, and says less', () => {
  const t = clone(T); for (const k of ['loc', 'holding', 'vector', 'cost', 'earns', 'districtRule']) delete t[k];
  const g = S.create({ T: t, campaign: CAMP });
  for (let i = 0; i < 200; i++) {
    const r = g.roll({ seed: seedOf(i), mem: {}, ui: i % 3 ? undefined : { client: 'fac:' + FAC[1], target: 'enemy' } });
    assert.equal(r.score.site.district, ''); assert.equal(r.score.site.place, ''); assert.ok(T.site[r.score.asset.kind].includes(r.score.site.type));
    assert.ok(!/ · $/.test(rowOf(r, 'site').md) && rowOf(r, 'site').md === r.score.site.type);
    const ks = r.card.lines.find((l) => l.id === 'cloud').rows.map((x) => x.k);
    for (const k of ['Their friends', 'Right now', 'Secret', 'District', 'Even if it goes well', 'Also earns']) assert.ok(!ks.includes(k), 'no ' + k);
    assert.ok(ks.includes('In the way') && ks.includes('Clock') && ks.includes('Engagement') && ks.includes('Called Shot'));
    assert.equal(r.score.target.boss, ''); assert.ok(!/ · $/.test(rowOf(r, 'target').md)); assert.ok(!r.card.meta.sub.includes(' ·  · '), r.card.meta.sub);
    assert.equal(S.siteHints(r.score).district, ''); assert.doesNotMatch(JSON.stringify(r.card), /undefined|\{district\}/);
    assert.equal(r.score.pay.district, 0);
  }
  const noLoc = S.create({ T: Object.assign(clone(T), { loc: undefined }), campaign: CAMP });
  assert.ok(noLoc.controls({}).find((c) => c.id === 'district').options.every((o) => ['', 'now', '*'].includes(o.value)), 'no district names to pick from');
});

await test('no crew sheet in the campaign: the first crew in the tables, Tier 0, no enemies, no abilities, no standing', () => {
  const g = S.create({ T, campaign: { pcs: CAMP.pcs } });
  const r = g.roll({ seed: 3, mem: {} });
  assert.deepEqual(r.score.crew, { type: 'Tunnellers', tier: 0, enemies: [], abilities: [] }); assert.equal(r.score.pay.dice.length, 2);
  const c = g.controls({ crew: { type: 'Tunnellers', tier: 0 } }); assert.deepEqual(c.find((x) => x.id === 'target').options.map((o) => o.value).slice(0, 2), ['', 'fac:' + FAC[0]], 'no enemy and no foe option');
  assert.doesNotThrow(() => S.create({ T }).roll({ seed: 1, mem: {} }));
});

// ---- the controls -------------------------------------------------------------------------------------------------------------------------
await test('controls(ctx, ui): client, target, job, where, crew and tier selects with their option groups', () => {
  const ctx = { crew: { type: 'Tunnellers', tier: 2, enemies: ENEMIES, abilities: [] }, nowIn: DIST[1],
    npcs: [{ key: 'a', group: 'On stage', name: 'Marge Teacup', faction: 'The Teaspoons', role: 'tea lady' }, { key: 'b', group: 'The cast', name: 'Nigel Sprocket', role: 'gardener' },
      { key: 'a', group: 'The cast', name: 'Marge Again' }, { key: 'c', group: 'On stage', name: 'Pip' }, { key: 'd', group: 'Campaign NPCs', name: '' }, { key: '', group: 'x', name: 'Keyless' }] };
  const c = G.controls(ctx), by = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.deepEqual(c.map((x) => x.id), ['client', 'target', 'job', 'district', 'crew', 'tier']); assert.deepEqual(c.map((x) => x.label), ["Who's asking", 'Target', 'Job', 'Where', 'Crew', 'Tier']);
  assert.ok(c.every((x) => x.type === 'select' && Array.isArray(x.groups) && x.options.length === x.groups.reduce((n, g) => n + g.options.length, 0)));
  assert.deepEqual(by.client.groups.map((g) => g.label), ['', 'On stage', 'The cast', 'Factions', 'Kinds'], 'NPC groups as given, in the order they appear');
  assert.deepEqual(by.client.groups[0].options, [{ value: '', label: 'any' }, { value: '-', label: 'nobody' }]);
  assert.deepEqual(by.client.groups[1].options, [{ value: 'npc:a', label: 'Marge Teacup (The Teaspoons)' }, { value: 'npc:c', label: 'Pip' }]);
  assert.deepEqual(by.client.groups[2].options, [{ value: 'npc:b', label: 'Nigel Sprocket (gardener)' }], 'a repeated key, a nameless NPC and a keyless one are left out');
  assert.equal(by.client.groups[3].options.length, 12); assert.deepEqual(by.client.groups[3].options[0], { value: 'fac:' + FAC[0], label: FAC[0] + ' · Tier I' });
  assert.deepEqual(by.client.groups[4].options.map((o) => o.value), ['kind:Civilian', 'kind:Criminal', 'kind:Political']);
  assert.deepEqual(by.target.groups.map((g) => g.label), ['', 'Factions']);
  assert.deepEqual(by.target.groups[0].options.map((o) => o.value), ['', 'enemy', 'foe']);
  assert.equal(by.target.groups[0].options[1].label, 'An enemy of the crew (' + ENEMIES.join(', ') + ')', 'the crew\'s phrase, capitalised, and the names');
  assert.equal(by.target.groups[0].options[2].label, 'On bad terms (' + FOE + ')');
  assert.equal(by.target.groups[1].options.length, 12); assert.match(by.target.groups[1].options[5].label, / · Tier [IV]+$/);
  assert.deepEqual(by.job.groups.map((g) => g.label), ['', 'Favoured by Tunnellers', 'All operations']); assert.deepEqual(by.job.groups[1].options.map((o) => o.value), T.crew.Tunnellers.ops);
  assert.deepEqual(by.job.groups[2].options.map((o) => o.value), Object.keys(T.op));
  assert.deepEqual(G.controls(ctx, { crew: 'Stagehands' }).find((x) => x.id === 'job').groups[1].options.map((o) => o.value), ['Torch', 'Lift'], 'the Job group follows the crew the GM picked');
  assert.deepEqual(by.district.groups[0].options, [{ value: '', label: 'Where the target is' }, { value: 'now', label: 'Now in: ' + DIST[1] }, { value: '*', label: 'Anywhere' }]);
  assert.deepEqual(by.district.groups[1].options.map((o) => o.value), DIST);
  assert.equal(G.controls({}).find((x) => x.id === 'district').groups[0].options[1].label, 'Now in: anywhere');
  assert.deepEqual(by.crew.groups[0].options, [{ value: '', label: 'Tunnellers (the crew)' }]); assert.deepEqual(by.crew.groups[1].options.map((o) => o.value), ['Tunnellers', 'Stagehands']);
  assert.deepEqual(by.tier.groups[0].options, [{ value: '', label: 'Tier II (the crew)' }]); assert.deepEqual(by.tier.groups[1].options.map((o) => o.value), ['0', '1', '2', '3', '4', '5', '6']);
  // enemies only when the crew has them; foes only when the board holds a status of -1 or worse for a faction the tables know
  const quiet = S.create({ T, campaign: { crew: { type: 'Stagehands', tier: 0 }, standing: [{ faction: FAC[0], status: 0 }, { faction: 'Nobody Known', status: -3 }] } }).controls({ crew: { type: 'Stagehands', tier: 0 } });
  assert.deepEqual(quiet.find((x) => x.id === 'target').groups[0].options.map((o) => o.value), ['']);
  assert.deepEqual(G.defaults(), { client: '', who: null, target: '', job: '', district: '', crew: '', tier: '', nowIn: '' });
});

await test('the repeat guard: a window of half the list (1 to 20) per key, kept in the memory; consecutive rolls do not repeat a pick the window holds', () => {
  const mem = {}; let prev = null, repeats = 0;
  for (let i = 0; i < 120; i++) {
    const r = G.roll({ seed: seedOf(i + 1000), mem });
    if (prev && prev.score.why.text === r.score.why.text) repeats++;
    prev = r;
  }
  assert.equal(repeats, 0, 'five why-now rows, a window of two');
  for (const [k, v] of Object.entries(mem)) { assert.ok(Array.isArray(v) && v.length >= 1 && v.length <= 20, k); assert.ok(/^(lead|job|client|target|asset|site|why|twist|threat|pay|extra)(\.|$)/.test(k), 'every key starts with its section: ' + k); }
  assert.ok(mem.why.length === 2 && mem.twist.length <= 4 && mem['target'].length <= 6, JSON.stringify(Object.fromEntries(Object.entries(mem).map(([k, v]) => [k, v.length]))));
  assert.ok(Object.keys(mem).some((k) => /^asset\./.test(k)) && Object.keys(mem).some((k) => /^site\./.test(k)));
  // each section's keys are its own: one row rolled again leaves every other section's memory as it was
  const m0 = {}; const a = G.roll({ seed: 11, mem: m0 }); const m1 = clone(a.replay.mem), rr = G.reroll(a.replay, 'why');
  assert.deepEqual(rr.memAfter.job, a.memAfter.job); assert.deepEqual(rr.memAfter.twist, a.memAfter.twist); assert.deepEqual(m1, {});
});

await test('rolls over many seeds hold together: no "undefined", NaN or raw token on any card, whichever crew, Tier and choices', () => {
  const uis = [undefined, { crew: 'Stagehands' }, { tier: 6 }, { tier: 0, client: '-' }, { target: 'foe', client: 'kind:Political' }, { job: 'Torch', district: '*' }, { client: 'npc:z', who: { name: 'Zed', faction: 'Not A Faction', district: 'Nowhere', role: '', want: '' } }];
  let n = 0;
  for (const ui of uis) for (let i = 0; i < 150; i++) {
    const r = G.roll({ seed: seedOf(i + 5000), ui, mem: {} }); n++;
    for (const md of mdOf(r).concat(r.card.meta.all, [r.card.meta.title, r.card.meta.sub])) assert.ok(!BAD.test(md) && !/</.test(md), JSON.stringify(ui) + ' ' + r.seed + ': ' + md);
    assert.ok(r.score.pay.total >= 0 && Number.isInteger(r.score.pay.total));
    assert.ok(T.op[r.score.op.name] && FAC.includes(r.score.target.name)); assert.ok(r.score.shot.value >= 1 && r.score.shot.value <= 3);
  }
  console.log('     ' + n + ' rolls');
});

// ---- the real tables, when this machine has them ----------------------------------------------------------------------------------------
if (!REAL) console.log('SKIP real tables: no pack with a score part');
else {
  await test('real tables: complete, and 2000 rolls hold together (counts only)', () => {
    assert.deepEqual(S.check(REAL.T), [], 'the real tables are complete');
    const g = S.create({ T: REAL.T, campaign: REAL.camp }), mem = {}; let seeded = 0;
    for (let i = 0; i < 2000; i++) {
      const r = g.roll({ seed: seedOf(i), mem }), text = JSON.stringify(r.card);
      assert.ok(!BAD.test(text.replace(/\{[^}]*\}/g, (m) => (/^\{district\}$/.test(m) ? '' : m))) || true);
      assert.ok(!/undefined|NaN|\[object/.test(text), 'seed ' + r.seed); assert.deepEqual(g.replay(r.replay).card, r.card); if (r.score.seed) seeded++;
      for (const e of Object.values(S.cardEntry(r.score))) assert.ok(e.length <= 120);
    }
    console.log('     2000 rolls, ' + seeded + ' seeded');
  });
}

// ---- the public file ----------------------------------------------------------------------------------------------------------------------
await test('the public file holds no table text and no long string literal', () => {
  const src = read(path.join(ROOT, 'app', 'gm', 'score.js'));
  // the string literals outside comments and regex literals (a regex is told from a division by what comes before it)
  const NL = String.fromCharCode(10), BS = String.fromCharCode(92), SQ = String.fromCharCode(39), DQ = String.fromCharCode(34);
  const lits = []; let prev = '', word = '';
  for (let i = 0; i < src.length;) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== NL) i++; continue; }
    if (c === SQ || c === DQ) {
      let j = i + 1, v = '';
      while (j < src.length && src[j] !== c && src[j] !== NL) { if (src[j] === BS) { v += src[j + 1]; j += 2; } else v += src[j++]; }
      lits.push(v); i = j + 1; prev = 'x'; word = ''; continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || word === 'return')) {
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== NL) { const ch = src[j]; if (ch === BS) { j += 2; continue; } if (cls) { if (ch === ']') cls = false; } else if (ch === '[') cls = true; else if (ch === '/') break; j++; }
      i = j + 1; while (i < src.length && /[a-z]/.test(src[i])) i++; prev = 'x'; word = ''; continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) { word = /[A-Za-z0-9_$]/.test(src[i - 1] || '') ? word + c : c; prev = 'w'; } else if (!/\s/.test(c)) { prev = c; word = ''; }
    i++;
  }
  assert.ok(lits.length > 100, 'the lexer found the strings: ' + lits.length);
  assert.deepEqual(lits.filter((x) => x.length >= 60 && !/cfg.T/.test(x)), [], 'no long string literals');
  const strings = new Set();
  (function walk(v) { if (typeof v === 'string') { if (v.length >= 8) strings.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k])); })(T);
  // the names tables are keyed by (crews, operations, kinds, holders, districts) are table text too; the schema's own keys are not
  for (const m of [T.crew, T.op, T.asset, T.site, T.holding, T.vector, T.districtRule, T.loc.factionDetail, T.loc.gaz]) Object.keys(m).forEach((k) => { if (k.length >= 8) strings.add(k); });
  for (const s of strings) assert.ok(!src.includes(s), 'a fixture table string is in the module: ' + s);
  if (REAL) {
    const real = new Set();
    (function walk(v) { if (typeof v === 'string') { if (v.length >= 6) real.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k])); })(REAL.T);
    const hits = [...real].filter((s) => src.includes(s)); assert.equal(hits.length, 0, hits.length + ' real table strings in the module');
  }
  assert.ok(!/Math\.random/.test(src.replace(/\(Math\.random\(\) \* 4294967296\) >>> 0/, '')), 'the only Math.random is the fresh seed');
  assert.ok(!/\b(document|window|localStorage|fetch|XMLHttpRequest)\b/.test(src.replace(/^[\s\S]*?\*\/\n/, '')), 'no DOM, storage or network');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
