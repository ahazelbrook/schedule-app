// VV9: the mission's secrecy at the Worker, in plain node on an in-memory D1 and a FAKE LiveHub namespace: no server. It adds to checks/api/mission.mjs
// (VV2) only where that file leaves a gap, and it builds its missions the way the GM page does (the real ball.js and mission-publish.js on the invented
// Pelican Rooms fixture), so the strings are the ones a night really produces. The lists of what must not be somewhere come from the fixture and the
// night's state (checks/runtime/fixtures/gm/mission-secrecy-lib.mjs), never from the answer being checked.
//   - the display GET, in every form of the call (no hseq, current, stale, malformed, repeated) for the iPad and for the GM page: no answer holds a card's
//     own string, a card id, an owner, a GM marker, a key outside the band's, or a `cards` key anywhere; the band IS served in the forms that ask
//   - the stored mission and the answers to the campaign route: no GM marker and no key outside design 5.5c; both cards stored whole (the H5 call)
//   - refusals: a player or the display sign-in setting, replacing or removing the mission (PATCH and PUT), a hidden NPC's name or alias or a hidden
//     clock's name in EVERY string of the band and of a card (422 naming that path, nothing stored, nothing poked), a 9th card, a bad seq
//   node checks/api/mission-secrecy.mjs

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { worker } from '../../worker/app.js';
import { MISSION_LIMITS as L } from '../../functions/_lib/campaign.js';
import * as SEC from '../runtime/fixtures/gm/mission-secrecy-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
const BALL = req(path.join(ROOT, 'app', 'gm', 'ball.js')), PUB = req(path.join(ROOT, 'app', 'gm', 'mission-publish.js'));
let passes = 0, failures = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const GM = 'gm@example.test', IPAD = 'ipad@example.test', ALEX = 'player.a@example.test', BEA = 'player.b@example.test';
const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
const DB = asD1(exec);
const hub = { pokes: [] };
hub.LIVE = { idFromName: (n) => ({ id: n }), get: () => ({ poke(k) { hub.pokes.push(k); return Promise.resolve(1); }, closeAll() { return Promise.resolve(1); } }) };
async function call(method, p, { user = GM, body } = {}) {
  const pending = [];
  const env = { DEV_USER: GM, GM_EMAILS: GM, DISPLAY_EMAILS: IPAD, DB, CAMPAIGN: 'secrecycheck', LIVE: hub.LIVE };
  const init = { method, headers: { 'X-Dev-User': user } };
  if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  hub.pokes.length = 0;
  const res = await worker.fetch(new Request('http://127.0.0.1:8900' + p, init), env, { waitUntil: (pr) => pending.push(pr) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  await Promise.allSettled(pending);
  return { status: res.status, json, text, pokes: hub.pokes.slice() };
}
const storedDoc = async () => (await call('GET', '/api/campaign', { user: ALEX })).json.doc;
const storedMission = async () => (await storedDoc()).mission;
const display = (qs, user = IPAD) => call('GET', '/api/gm/display' + (qs ? '?' + qs : ''), { user });

// ---------- missions built the way the GM page builds them ----------
const FX = SEC.loadFixture(), ROOMS = FX.zones.flatMap((z) => z.rooms);
const mkPlay = () => BALL.checkPlay(JSON.parse(JSON.stringify(FX)), ROOMS).play;
const PCS = [{ id: 'pc_a', name: 'Ana Quill', owner: ALEX }, { id: 'pc_b', name: 'Bo Tarn', owner: BEA }];
// at 23:15 (t=135): pc_a heard way A and carries the key, pc_b heard way B; I1 and I2 (which tells the card-table event) are for pc_a alone, I3 for pc_b alone
const ST = { v: 2, site: 'The Pelican Rooms', start: 45, t: 135, crew: { pc_a: { room: 'Cocktail lounge', disguise: 'guest', items: ['key'] }, pc_b: { room: 'Cocktail lounge', disguise: 'cook' } },
  told: { I1: ['pc_a'], I2: ['pc_a'], I3: ['pc_b'] }, heard: { A: { pc_a: 90 }, B: { pc_b: 95 } }, steps: {}, ways: {}, over: {} };
const CLOCKS = [{ name: 'Fuse', filled: 2, hidden: false }];
const NOTES = Object.fromEntries(ROOMS.map((r) => [r, { costume: 'A grey uniform', say: ['Monitors flicker'] }]));   // a room note for every room: the card's costume line and here lines
const build = (st, seq, pcs = PCS) => PUB.buildMission(BALL, { play: mkPlay(), state: st, clocks: CLOCKS, pcs, open: ROOMS, rooms: NOTES }, seq);
const clone = (x) => JSON.parse(JSON.stringify(x));

// string leaves of a mission, as paths (arrays), the card ids included as { id }
function leavesOf(m) {
  const out = [];
  const walk = (v, p) => {
    if (typeof v === 'string') { if (v) out.push({ p }); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, p.concat(i)));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (p.length === 1 && p[0] === 'cards') out.push({ p: p.concat(k), id: true }); walk(v[k], p.concat(k)); }
  };
  walk(m, []);
  return out;
}
const setAt = (m, p, val) => { let o = m; for (let i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = val; };
const deepKeys = (v, out = []) => { if (Array.isArray(v)) v.forEach((x) => deepKeys(x, out)); else if (v && typeof v === 'object') for (const k of Object.keys(v)) { out.push(k); deepKeys(v[k], out); } return out; };

let hiddenId;
await step('setup: a hidden NPC with an alias, a hidden NPC with a one-word name, a hidden clock and a visible one', async () => {
  let r = await call('POST', '/api/npcs', { body: { name: 'Mirabel Dray', alias: 'The Quiet One', revealed: false } });
  expect(r.status === 201 || r.status === 200, 'npc ' + r.status + r.text);
  hiddenId = r.json.id;
  r = await call('POST', '/api/npcs', { body: { name: 'Zorbo', revealed: false } });
  expect(r.status === 201 || r.status === 200, 'npc ' + r.status + r.text);
  r = await call('PATCH', '/api/campaign', { body: { crew: { name: 'Invented Crew' }, clocks: [{ id: 'burn', name: 'Quiet Burn', size: 6, filled: 1, kind: 'danger', hidden: true }, { id: 'plan', name: 'The Plan', size: 4, filled: 0, kind: 'project', hidden: false }] } });
  expect(r.status === 200, 'clocks ' + r.status + r.text.slice(0, 200));
});

let M1;      // the mission the GM publishes, seq 7
await step('the fixture mission is accepted as the page builds it, and what the Worker stores holds no GM marker, no key outside design 5.5c and each PC\'s own strings in their own card', async () => {
  M1 = build(ST, 7);
  expect(M1 && M1.hud && Object.keys(M1.cards).length === 2, 'control: the fixture night builds a mission with two cards');
  expect(PUB.screenMission(M1, { names: ['Mirabel Dray', 'The Quiet One', 'Quiet Burn', 'Zorbo'], secrets: FX.secret }, (t, n) => t.toLowerCase().includes(n[0].toLowerCase())) === null, 'control: the page\'s own screen passes it');
  const r = await call('PATCH', '/api/campaign', { body: { mission: M1 } });
  expect(r.status === 200, 'PATCH ' + r.status + ' ' + r.text.slice(0, 200));
  const tally = { negBand: 0, negCard: 0, pos: 0, seen: new Set() };
  SEC.checkMission(FX, await storedMission(), ST, 'stored', tally, true);
  SEC.checkMission(FX, r.json.doc.mission, ST, 'the PATCH answer', tally, true);
  expect(tally.negBand > 20 && tally.negCard > 20 && tally.pos >= 8, 'the rules ran: ' + JSON.stringify({ n: tally.negBand, c: tally.negCard, p: tally.pos }));
  // the campaign route serves the whole document to every player (call H5: the phone shows only its own card, the data is not locked per player)
  for (const user of [ALEX, BEA]) {
    const g = await call('GET', '/api/campaign', { user });
    SEC.markers(FX).forEach((mk) => expect(!g.text.includes(mk), user + ': a GM marker is in GET /api/campaign: ' + mk));
    expect(g.json.doc.mission.cards.pc_a && g.json.doc.mission.cards.pc_b, 'H5 pin: both cards are in the document a player fetches (if this fails, the cards were locked per player: update this pin and the design call)');
  }
});

// ---------- (1) the display GET never carries a card ----------
await step('the display GET, in every form: no answer holds a card\'s own string, a card id, an owner, a GM marker or any `cards` key; its keys are the band\'s; the band is served in the forms that ask', async () => {
  const stored = await storedMission();
  const own = [...SEC.expectation(FX, ST, 'pc_a', ['pc_b']).must, ...SEC.expectation(FX, ST, 'pc_b', ['pc_a']).must];
  // each card's own strings, from the state: the key, the lines only that PC heard, the lead of the way only it heard, the intel only it was told
  expect(own.length >= 6, 'control: the state gives the cards ' + own.length + ' own strings');
  const never = [...own, ...SEC.cardPool(FX), ...SEC.markers(FX), 'pc_a', 'pc_b', ALEX, BEA];
  const hseqs = [null, '0', '7', '6', '8', '1', '99999', '-1', 'abc', '', '7.0', '07x', '9'.repeat(30), '%00', '0x7', '7%20', '7&hseq=8'];
  const bases = ['', 'seq=0', 'seq=99999', 'seq=0&aseq=0', 'seq=0&aseq=0&sseq=0', 'seq=99999&aseq=99999&sseq=99999'];
  const KNOWN = new Set(['seq', 'display', 'updatedAt', 'ambient', 'stt', 'overlay', 'live', 'unchanged', 'mission']);
  let served = 0, unchanged = 0, absent = 0, asked = 0, answers = 0;
  for (const user of [IPAD, GM]) for (const b of bases) for (const h of hseqs) {
    const qs = [b, h === null ? '' : 'hseq=' + h].filter(Boolean).join('&');
    const r = await display(qs, user);
    expect(r.status === 200, qs + ': ' + r.status);
    answers++;
    for (const w of never) expect(!r.text.toLowerCase().includes(w.toLowerCase()), user + ' ' + qs + ': "' + w + '" is in the display answer: ' + r.text.slice(0, 200));
    expect(!deepKeys(r.json).includes('cards'), qs + ': a cards key');
    for (const k of Object.keys(r.json)) expect(KNOWN.has(k), qs + ': an unexpected top-level key ' + k);
    if (h === null) { expect(!('mission' in r.json), qs + ': a mission without hseq'); absent++; continue; }
    asked++;
    const part = r.json.mission;
    expect(part && Object.keys(part).every((k) => ['hseq', 'hud', 'unchanged'].includes(k)), qs + ': the part\'s keys: ' + JSON.stringify(Object.keys(part || {})));
    expect(part.hseq === 7, qs + ': hseq ' + part.hseq);
    if (part.unchanged) { expect(!('hud' in part), qs + ': unchanged with a hud'); unchanged++; }
    else {
      for (const p of SEC.keyPaths(part.hud)) expect(SEC.SERVER_HUD_PATHS.has(p), qs + ': a key outside the band\'s: hud.' + p);
      expect(same(part.hud, stored.hud), qs + ': the hud served is the hud stored');
      served++;
    }
  }
  expect(answers >= 200 && served >= 100 && unchanged >= 10 && absent >= 12 && asked >= 190, 'the sweep ran: ' + JSON.stringify({ answers, served, unchanged, absent, asked }));
  // a player is refused the route in every form, before anything is read
  let refused = 0;
  for (const user of [ALEX, BEA]) for (const b of bases) for (const h of [null, '0', '7', 'abc']) {
    const r = await display([b, h === null ? '' : 'hseq=' + h].filter(Boolean).join('&'), user);
    expect(r.status === 403 && !r.text.includes('hud') && !r.text.includes('The speeches'), user + ' ' + b + ' hseq=' + h + ': ' + r.status + ' ' + r.text.slice(0, 80));
    refused++;
  }
  expect(refused >= 40, 'only ' + refused + ' refusals');
  const sql = exec.log.filter((s) => /\$\.mission/.test(s));
  expect(sql.length > 0 && sql.every((s) => !/\$\.mission\.cards|json_extract\(doc, '\$\.mission'\)/.test(s)), 'no statement selects the cards or the whole mission: ' + sql[0]);
  // the display sign-in and the players cannot read what carries the cards
  for (const [p, user] of [['/api/campaign', IPAD], ['/api/export', IPAD], ['/api/export', ALEX]]) {
    const r = await call('GET', p, { user });
    expect(r.status === 403 && !r.text.includes('Ana Quill'), user + ' ' + p + ': ' + r.status);
  }
});

await step('extra keys never survive: beside the band, beside a card or at any depth, they are dropped from what is stored and from what the display route serves', async () => {
  const m = build(ST, 8);
  const mark = 'GM-ONLY-SECRET-1', extra = (o) => { o.extra = mark; o.gmNote = mark; return o; };
  m.hud.cards = clone(m.cards); m.hud.secret = mark; m.hud.night.cards = clone(m.cards); m.hud.crew[0].owner = ALEX; m.hud.crew[0].cards = clone(m.cards);
  extra(m); extra(m.hud); (m.hud.now[0] || m.hud.night).extra = mark; extra(m.hud.night); extra(m.hud.alarm); extra(m.hud.ways); (m.hud.rooms || []).forEach(extra); if (m.hud.timer) extra(m.hud.timer);
  for (const id of Object.keys(m.cards)) {
    const c = extra(m.cards[id]);
    if (c.warn) extra(c.warn); if (c.zones) extra(c.zones); c.leads.forEach(extra); c.next.forEach(extra); c.paths.forEach(extra);
    c.steps = ['Make her lose']; c.leads.forEach((l) => { l.steps = ['Make her lose']; l.who = mark; });
  }
  const r = await call('PATCH', '/api/campaign', { body: { mission: m } });
  expect(r.status === 200, 'status ' + r.status);
  const doc = await storedDoc();
  expect(!JSON.stringify(doc).includes(mark) && !JSON.stringify(doc).includes('Make her lose'), 'an extra key survived into the stored document');
  for (const p of SEC.keyPaths(doc.mission.hud)) expect(SEC.SERVER_HUD_PATHS.has(p), 'stored: a key outside the band: hud.' + p);
  for (const c of Object.values(doc.mission.cards)) for (const p of SEC.keyPaths(c)) expect(SEC.SERVER_CARD_PATHS.has(p), 'stored: a key outside a card: ' + p);
  expect(same(Object.keys(doc.mission), ['v', 'site', 't', 'seq', 'hud', 'cards']), 'stored top-level keys: ' + Object.keys(doc.mission));
  const d = await display('seq=0&aseq=0&sseq=0&hseq=0');
  expect(d.json.mission.hseq === 8, 'the new hud is served');
  for (const p of SEC.keyPaths(d.json.mission.hud)) expect(SEC.SERVER_HUD_PATHS.has(p), 'served: a key outside the band: hud.' + p);
  expect(!d.text.includes('GM-ONLY') && !d.text.includes('A brass key') && !d.text.includes(ALEX) && !deepKeys(d.json).includes('cards'), 'the extra keys did not survive: ' + d.text.slice(0, 200));
  await call('PATCH', '/api/campaign', { body: { mission: M1 } });
});

// ---------- (3) refusals ----------
await step('a player or the display sign-in setting, replacing or removing the mission, by PATCH or PUT, is 403: nothing stored, nothing poked, with and without a mission stored', async () => {
  const was = JSON.stringify(await storedMission());
  const tries = [];
  for (const user of [ALEX, BEA, IPAD]) {
    tries.push([user, 'PATCH', { mission: build(ST, 50) }], [user, 'PATCH', { mission: null }], [user, 'PATCH', { mission: { hud: { time: '23:59' } } }], [user, 'PATCH', { mission: { cards: { pc_a: { know: ['x'] } } } }],
      [user, 'PATCH', { crew: { notes: 'a' }, mission: build(ST, 51) }], [user, 'PUT', { mission: build(ST, 52), crew: {} }], [user, 'PUT', { ...(await storedDoc()), mission: build(ST, 53) }]);
  }
  for (const [user, method, body] of tries) {
    const r = await call(method, '/api/campaign', { user, body });
    expect(r.status === 403 && r.pokes.length === 0, user + ' ' + method + ' ' + JSON.stringify(body).slice(0, 50) + ' -> ' + r.status + ' ' + r.text.slice(0, 80));
    expect(JSON.stringify(await storedMission()) === was, user + ' ' + method + ': the mission changed');
  }
  // and with none stored
  await call('PATCH', '/api/campaign', { body: { mission: null } });
  for (const user of [ALEX, BEA, IPAD]) {
    const r = await call('PATCH', '/api/campaign', { user, body: { mission: build(ST, 60) } });
    expect(r.status === 403 && r.pokes.length === 0, user + ': set when none is stored -> ' + r.status);
  }
  expect(!('mission' in (await storedDoc())), 'nothing was stored');
  expect(tries.length >= 21, 'only ' + tries.length + ' tries');
  await call('PATCH', '/api/campaign', { body: { mission: M1 } });
});

await step('a hidden name in EVERY string of the band and of a card is 422 at that path: the NPC\'s name, its alias, a hidden clock; nothing stored, nothing poked; the card ids too', async () => {
  const base = clone(M1), was = JSON.stringify(await storedMission());
  const leaves = leavesOf(base).filter((l) => !l.id);
  const ids = leavesOf(base).filter((l) => l.id);
  expect(leaves.length >= 45 && ids.length === 2, 'control: ' + leaves.length + ' string leaves, ' + ids.length + ' card ids');
  // the fixture night fills most fields; a second night fills the rest (a public event on, a guard watching, a route open, a PC busy)
  const st2 = clone(ST); st2.t = 65; st2.crew.pc_a = { room: 'Security control room', disguise: 'guard', items: ['key'], busy: 120 }; st2.told = { I1: 'crew', I3: ['pc_b'] };
  const st3 = clone(ST); st3.crew.pc_a = { room: 'Security control room', disguise: 'guard', items: ['key'], busy: 150 }; st3.steps = { A: [true, false] };
  const covered = new Set();
  let tried = 0;
  const jobs = [];
  const refusal = async (m, name, where) => {
    const r = await call('PATCH', '/api/campaign', { body: { crew: { heat: 9 }, mission: m } });
    expect(r.status === 422 && r.json.error.includes('"' + name + '"') && r.json.error.includes(where + ','), name + ' at ' + where + ': ' + r.status + ' ' + r.text.slice(0, 160));
    expect(r.pokes.length === 0, name + ' at ' + where + ': poked ' + JSON.stringify(r.pokes));
    tried++;
  };
  // the first night: the NPC's name in EVERY string, its alias in every 2nd and the clock's name in every 3rd; the others: the NPC's name in the first string of each field
  for (const [i, src] of [base, build(st2, 70), build(st3, 71)].entries()) {
    leavesOf(src).filter((x) => !x.id).forEach((l, n) => {
      const shape = l.p.filter((x) => typeof x !== 'number').join('.').replace(/^cards.[^.]+./, 'card.');
      const first = !covered.has(shape);
      covered.add(shape);
      const names = [];
      if (i === 0) { names.push('Mirabel Dray'); if (n % 2 === 0) names.push('The Quiet One'); if (n % 3 === 0) names.push('Quiet Burn'); } else if (first) names.push('Mirabel Dray');
      for (const name of names) jobs.push([src, l, name]);
    });
  }
  for (const [src, l, name] of jobs) {
    const m = clone(src);
    setAt(m, l.p, 'They said ' + name.toLowerCase() + ' was here');
    await refusal(m, name, 'mission.' + l.p.join('.'));
  }
  for (const w of ['hud.time', 'hud.label', 'hud.now.text', 'hud.now.where', 'hud.now.until', 'hud.next.text', 'hud.next.at', 'hud.night.marks.icon', 'hud.night.marks.text', 'hud.alarm.name', 'hud.alarm.text', 'hud.crew.name', 'hud.crew.room', 'hud.target.room', 'hud.rooms.zone', 'hud.rooms.rooms',
    'card.name', 'card.owner', 'card.room', 'card.costumeLine', 'card.here', 'card.items', 'card.leads.name', 'card.leads.line', 'card.leads.heard', 'card.leads.window', 'card.leads.next',
    'card.know', 'card.next.text', 'card.next.at', 'card.paths.text', 'card.paths.until', 'card.busy', 'site'])
    if (w !== 'hud.target.room' && w !== 'hud.now.where' && !covered.has(w)) expect(false, 'control: no night fills ' + w + ' (' + [...covered].join(' ') + ')');
  expect(tried >= 100, 'only ' + tried + ' refusals tried');
  // a one-word hidden name as a card id
  const m = clone(M1); m.cards.Zorbo = m.cards.pc_b; delete m.cards.pc_b;
  const r = await call('PATCH', '/api/campaign', { body: { mission: m } });
  expect(r.status === 422 && r.json.error.includes('"Zorbo"') && r.json.error.includes('mission.cards.Zorbo'), 'a card id: ' + r.status + ' ' + r.text.slice(0, 120));
  expect(JSON.stringify(await storedMission()) === was, 'nothing was stored by any refusal');
  expect((await storedDoc()).crew.heat !== 9, 'no refusal stored its other keys');
  // controls: the same words one letter longer, and the revealed NPC, are fine
  const ok = clone(M1); ok.hud.label = 'Mirabel Drays and Quentin Pike'; ok.cards.pc_a.know = ['The Quiet Ones', 'Zorbos'];
  expect((await call('PATCH', '/api/campaign', { body: { mission: ok } })).status === 200, 'control: a longer word is not the name');
  await call('PATCH', '/api/campaign', { body: { mission: M1 } });
});

await step('a 9th card is dropped, never stored and never read: nothing of it reaches the document or the iPad, and a name in it neither refuses the write nor survives', async () => {
  const m = clone(M1);
  m.cards = {};
  for (let i = 1; i <= 9; i++) m.cards['pc_' + i] = { ...clone(M1.cards.pc_a), name: 'Player ' + i, know: i === 9 ? ['NINTH-ONLY line', 'Mirabel Dray'] : ['line ' + i] };
  expect(Object.keys(m.cards).length === 9 && L.cards === 8, 'control: nine cards go in, the cap is eight');
  const r = await call('PATCH', '/api/campaign', { body: { mission: m } });
  expect(r.status === 200, 'status ' + r.status + ' ' + r.text.slice(0, 160));
  const s = await storedMission();
  expect(same(Object.keys(s.cards), ['pc_1', 'pc_2', 'pc_3', 'pc_4', 'pc_5', 'pc_6', 'pc_7', 'pc_8']), 'the first eight, in order: ' + Object.keys(s.cards));
  expect(!JSON.stringify(await storedDoc()).includes('NINTH-ONLY') && !JSON.stringify(await storedDoc()).includes('Player 9'), 'nothing of the ninth is stored');
  const d = await display('seq=0&aseq=0&sseq=0&hseq=0');
  expect(!d.text.includes('NINTH-ONLY') && !d.text.includes('pc_9') && !d.text.includes('Player'), 'nothing of it on the display route');
  await call('PATCH', '/api/campaign', { body: { mission: M1 } });
});

await step('a seq that is not a whole number of 1 to 1e9 is 400 naming seq: nothing stored, nothing poked; the edges 1 and 1e9 are fine', async () => {
  const was = JSON.stringify(await storedMission());
  const bad = [1.5, 3.0000001, '3', '1', 0, -1, -0.5, 1e9 + 1, 2e9, 1e21, true, false, null, [3], { a: 1 }, '', 'abc', undefined];
  for (const seq of bad) {
    const m = clone(M1);
    if (seq === undefined) delete m.seq; else m.seq = seq;
    const r = await call('PATCH', '/api/campaign', { body: { mission: m } });
    expect(r.status === 400 && /seq/.test(r.json.error) && r.pokes.length === 0, JSON.stringify(seq) + ' -> ' + r.status + ' ' + r.text.slice(0, 100));
  }
  // not-a-number and infinity cannot be written in JSON; a body spelled that way is not valid JSON at all
  for (const raw of ['{"mission":{"seq":NaN}}', '{"mission":{"seq":Infinity}}', '{"mission":{"seq":1e999}}']) {
    const r = await call('PATCH', '/api/campaign', { body: raw });
    expect(r.status === 400 && r.pokes.length === 0, raw + ' -> ' + r.status);
  }
  expect(JSON.stringify(await storedMission()) === was, 'the stored mission is untouched by all of them');
  for (const seq of [1, 1e9]) {
    const m = clone(M1); m.seq = seq;
    const r = await call('PATCH', '/api/campaign', { body: { mission: m } });
    expect(r.status === 200 && (await storedMission()).seq === seq, 'seq ' + seq + ' -> ' + r.status);
  }
  await call('PATCH', '/api/campaign', { body: { mission: M1 } });
});

await step('a PUT by the GM or a stale whole-document save can never put a card, or an old band, back (the stored mission survives a PUT of a document without one)', async () => {
  const was = JSON.stringify(await storedMission());
  const { mission: _drop, ...without } = await storedDoc();
  const r = await call('PUT', '/api/campaign', { body: { ...without, mission: { v: 1, seq: 1, hud: { time: 'OLD-BAND' }, cards: { pc_a: { know: ['OLD-CARD'] } } } } });
  expect(r.status === 200 && JSON.stringify(await storedMission()) === was, 'PUT: ' + r.status);
  const d = await display('seq=0&aseq=0&sseq=0&hseq=0');
  expect(!d.text.includes('OLD-BAND') && !d.text.includes('OLD-CARD'), 'the old band did not reach the iPad');
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
