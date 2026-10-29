// VV2: the campaign document's `mission` and the display GET's fourth part (?hseq=N), in plain node on an in-memory D1 and a FAKE LiveHub
// namespace: no server. The venue and every name are invented (the Pelican Rooms fixture, section 5 of the prompts page); every GM-only
// string is a GM-ONLY marker and a card's own lines carry a CARD-ONLY marker, so a payload can be searched for what must not be in it.
//   - cleanMission: every cap exactly, every unknown key dropped at every level, null, bad shapes, ids; it is idempotent
//   - missionHit: whole words, any case, the path of the hit; a two-word name never matches across two strings
//   - PATCH by the GM stores the cleaned mission, REPLACING the stored one (no deep merge), null removes it, the rest of the document is untouched
//   - 422 naming a hidden NPC (name or alias) or a hidden clock; a revealed NPC and a visible clock are fine; nothing is stored on a refusal
//   - a player cannot set, change, replace or remove `mission` (403), nor with a PUT; an unchanged resend alongside another change is harmless
//   - a PUT never changes the stored mission
//   - the display GET's fourth part: seq, unchanged, hud only, no mission, a stale or malformed hseq; in every variant of the call; the cards
//     never appear in any display answer; the part costs the display poll no extra D1 call
//   - a mission write pokes campaign AND display (one poke each, after the write); a refusal pokes nothing
//   node checks/api/mission.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { worker } from '../../worker/app.js';
import { cleanMission, missionHit, missionTexts, MISSION_LIMITS as L } from '../../functions/_lib/campaign.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let passes = 0, failures = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (o) => Object.keys(o).join(',');

const GM = 'gm@example.test', IPAD = 'ipad@example.test', ALEX = 'player.a@example.test', BEA = 'player.b@example.test';
const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
const DB = asD1(exec);

function fakeHub() {
  const hub = { pokes: [] };
  hub.LIVE = { idFromName: (n) => ({ id: n }), get: () => ({ poke(k) { hub.pokes.push(k); return Promise.resolve(1); }, closeAll() { return Promise.resolve(1); } }) };
  return hub;
}
const hub = fakeHub();
async function call(method, p, { user = GM, body } = {}) {
  const pending = [];
  const env = { DEV_USER: GM, GM_EMAILS: GM, DISPLAY_EMAILS: IPAD, DB, CAMPAIGN: 'missioncheck', LIVE: hub.LIVE };
  const init = { method, headers: { 'X-Dev-User': user } };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  hub.pokes.length = 0;
  const res = await worker.fetch(new Request('http://127.0.0.1:8900' + p, init), env, { waitUntil: (pr) => pending.push(pr) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  await Promise.allSettled(pending);
  return { status: res.status, json, text, pending: pending.length, pokes: hub.pokes.slice() };
}
const stored = async () => (await call('GET', '/api/campaign', { user: ALEX })).json.doc;

// ---------- an invented mission, in the shape of design 5.5c ----------
const CARD_ONLY = 'CARD-ONLY';
function missionOf(seq, extra = {}) {
  return {
    v: 1, site: 'The Pelican Rooms', t: 90, seq,
    hud: {
      time: '22:30', label: 'Gala night',
      now: [{ text: 'The speeches', where: 'Showroom', until: '23:00' }],
      next: [{ text: 'The fireworks', where: 'Showroom', at: '00:00', inMin: 90 }],
      night: { beats: 16, start: 2, cur: 6, marks: [{ i: 4, icon: 'mic', text: 'The speeches' }, { i: 12, icon: 'spark', text: 'The fireworks' }] },
      alarm: { name: 'Fuse', size: 6, filled: 2, text: 'Someone is looking' },
      crew: [{ name: 'Kit', costume: 'Cook', icon: 'tray', room: 'Cocktail lounge' }, { name: 'Dot', costume: 'Guest', icon: 'mask' }],
      target: { room: 'Showroom' },
      ways: { found: 1, total: 2 },
    },
    cards: {
      char_kit: {
        name: 'Kit', owner: 'player.a@example.test', costume: 'Cook', icon: 'tray', room: 'Cocktail lounge', pos: 'safe',
        warn: { who: 'The tall guard', look: 'A tall man in a grey coat', sees: 'Sees through the cook' },
        zones: { controlled: ['Back of house'], risky: ['The floor'] }, items: ['A brass key'],
        leads: [{ name: 'The Last Hand', line: CARD_ONLY + ' she never leaves a table while she is winning.', heard: '22:30 · the Cocktail lounge', window: 'Late, at the cards', next: 'A seat at her table' }],
        know: ['The programme: speeches at ten'], next: [{ text: 'The fireworks', where: 'Showroom', at: '00:00', inMin: 90 }],
        paths: [{ text: 'A trapdoor to the showroom', until: '00:00' }], busy: null,
      },
      char_dot: { name: 'Dot', owner: 'player.b@example.test', costume: 'Guest', icon: 'mask', room: 'Showroom', pos: 'risky', warn: null, zones: { controlled: [], risky: [] }, items: [], leads: [], know: [], next: [], paths: [], busy: '22:45' },
    },
    ...extra,
  };
}

// ---------- cleanMission, no server ----------
await step('cleanMission: every cap is exactly the ticket\'s, and a good mission passes through unchanged', () => {
  const good = missionOf(3);
  expect(same(cleanMission(good), good), 'a clean mission is stored as it came: ' + JSON.stringify(cleanMission(good)).slice(0, 200));
  expect(cleanMission(null) === null, 'null stays null');
  expect(L.str === 160 && L.line === 300 && L.now === 3 && L.next === 3 && L.cardNext === 4 && L.marks === 24 && L.crew === 8 && L.cards === 8 &&
    L.leads === 8 && L.zones === 12 && L.items === 10 && L.know === 16 && L.paths === 6, 'the table of caps');
  const long = (n) => 'x'.repeat(n);
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const big = {
    seq: 7, site: long(500), t: 12.4,
    hud: {
      time: long(500), label: long(500),
      now: many(9, (i) => ({ text: 'n' + i + long(300), where: long(300), until: long(300) })),
      next: many(9, (i) => ({ text: 'x' + i, where: 'w', at: '00:00', inMin: i })),
      night: { beats: 16, start: 0, cur: 3, marks: many(60, (i) => ({ i, icon: 'm', text: 't' + i })) },
      alarm: { name: 'Fuse', size: 6, filled: 3, text: long(400) },
      crew: many(20, (i) => ({ name: 'c' + i, costume: 'k', icon: 'i', room: 'r' })),
      target: { room: long(300) }, ways: { found: 1, total: 2 },
    },
    cards: Object.fromEntries(many(15, (i) => ['pc' + i, {
      name: long(300), owner: long(300), costume: 'k', icon: 'i', room: 'r', pos: 'p',
      warn: { who: long(300), look: long(300), sees: long(300) },
      zones: { controlled: many(30, (j) => 'z' + j), risky: many(30, (j) => 'y' + j) },
      items: many(30, (j) => 'item' + j),
      leads: many(20, (j) => ({ name: 'lead' + j, line: long(900), heard: long(300), window: 'w', next: 'step' })),
      know: many(40, (j) => 'know' + j),
      next: many(10, (j) => ({ text: 'nx' + j, where: 'w', at: '00:00', inMin: j })),
      paths: many(12, (j) => ({ text: 'p' + j, until: '00:00' })),
      busy: null,
    }])),
  };
  const c = cleanMission(big), h = c.hud, k = c.cards.pc0;
  expect(c.site.length === L.str && h.time.length === L.str && h.label.length === L.str, 'strings are cut at 160');
  expect(h.now.length === 3 && h.now[0].text.length === L.str && h.now[0].where.length === L.str && h.now[0].until.length === L.str, 'now: 3 entries, 160 each');
  expect(h.next.length === 3 && h.night.marks.length === 24 && h.crew.length === 8, 'next 3, night marks 24, crew 8');
  expect(h.alarm.text.length === L.str && h.target.room.length === L.str, 'alarm and target strings');
  expect(Object.keys(c.cards).length === 8 && same(Object.keys(c.cards), many(8, (i) => 'pc' + i)), 'cards: the first 8, in order');
  expect(k.name.length === L.str && k.owner.length === L.str && k.warn.who.length === L.str && k.warn.look.length === L.str && k.warn.sees.length === L.str, 'card strings at 160');
  expect(k.zones.controlled.length === 12 && k.zones.risky.length === 12, 'zone lists 12');
  expect(k.items.length === 10 && k.know.length === 16 && k.next.length === 4 && k.paths.length === 6 && k.leads.length === 8, 'items 10, know 16, card next 4, paths 6, leads 8');
  expect(k.leads[0].line.length === L.line && k.leads[0].heard.length === L.str, 'a lead\'s line 300, its other strings 160');
  expect(c.t === 12, 'numbers are made whole: ' + c.t);
  expect(same(cleanMission(c), c), 'cleaning is idempotent');
});

await step('cleanMission: unknown keys are dropped at every level, nothing is kept by name that the shape does not have', () => {
  const m = missionOf(2);
  m.extra = 'TOP'; m.hud.extra = 'HUD'; m.hud.now[0].extra = 'NOW'; m.hud.next[0].extra = 'NEXT'; m.hud.night.extra = 'NIGHT'; m.hud.night.marks[0].extra = 'MARK';
  m.hud.alarm.extra = 'ALARM'; m.hud.crew[0].extra = 'CREW'; m.hud.target.extra = 'TARGET'; m.hud.ways.extra = 'WAYS';
  const k = m.cards.char_kit;
  k.extra = 'CARD'; k.warn.extra = 'WARN'; k.zones.extra = 'ZONES'; k.leads[0].extra = 'LEAD'; k.leads[0].steps = ['All', 'the', 'steps']; k.leads[0].name2 = 'x';
  k.next[0].extra = 'CNEXT'; k.paths[0].extra = 'PATH'; k.secret = 'GM-ONLY-SECRET';
  const c = cleanMission(m), text = JSON.stringify(c);
  for (const w of ['TOP', 'HUD', 'NOW', 'NEXT', 'NIGHT', 'MARK', 'ALARM', 'CREW', 'TARGET', 'WAYS', 'CARD"', 'WARN', 'ZONES', 'LEAD', 'All', 'steps', 'CNEXT', 'PATH', 'GM-ONLY-SECRET', 'name2'])
    expect(!text.includes(w), w + ' survived: ' + text.slice(0, 160));
  expect(keys(c) === 'v,site,t,seq,hud,cards', 'top: ' + keys(c));
  expect(keys(c.hud) === 'time,label,now,next,night,alarm,crew,target,ways', 'hud: ' + keys(c.hud));
  expect(keys(c.cards.char_kit) === 'name,owner,costume,icon,room,pos,warn,zones,items,leads,know,next,paths,busy', 'card: ' + keys(c.cards.char_kit));
  expect(keys(c.cards.char_kit.leads[0]) === 'name,line,heard,window,next', 'lead: ' + keys(c.cards.char_kit.leads[0]));
  expect(keys(c.hud.night) === 'beats,start,cur,marks' && keys(c.hud.alarm) === 'name,size,filled,text', 'night, alarm');
});

await step('cleanMission: odd values become safe ones; a bad seq or a non-object is 400; card ids are plain ids; control characters and half pairs go', () => {
  const bad = (v, re) => { let e = null; try { cleanMission(v); } catch (x) { e = x; } expect(e && e.status === 400 && re.test(e.message), JSON.stringify(v).slice(0, 60) + ' -> ' + (e && e.status + ' ' + e.message)); };
  for (const v of ['x', 5, [], true]) bad(v, /object/);
  for (const s of [undefined, 0, -1, 1.5, '3', null, NaN, 2e9]) bad({ seq: s }, /seq/);
  const c = cleanMission({
    seq: 1, t: 'soon', site: 5,
    hud: { time: { a: 1 }, now: 'nope', next: [null, 4, { text: '' }, { text: 'ok', inMin: -5 }, { text: 'big', inMin: 1e12 }], night: { beats: 'x', marks: [null, { i: 1e9, icon: 3, text: 'a' }] },
      alarm: { name: 'F', size: 6, filled: 99 }, crew: [{ name: 'a', room: '' }, 7], target: [], ways: { found: -4, total: 1e9 } },
    cards: JSON.parse('{"":{"name":"no id"},"bad id":{"name":"space"},"__proto__":{"name":"proto"},"a.b":{"name":"dot"},"ok_1":"not an object","ok_2":{"name":"Fine"},"' + 'x'.repeat(81) + '":{"name":"long id"}}'),
  });
  expect(c.t === 0 && c.site === '' && c.hud.time === '' && same(c.hud.now, []), 'junk reads as empty: ' + JSON.stringify(c).slice(0, 200));
  expect(same(c.hud.next, [{ text: 'ok', where: '', at: '', inMin: 0 }, { text: 'big', where: '', at: '', inMin: 100000 }]), 'next entries without text are dropped; inMin is whole and in range: ' + JSON.stringify(c.hud.next));
  expect(c.hud.night.beats === 0 && c.hud.night.marks.length === 1 && c.hud.night.marks[0].i === 200 && c.hud.night.marks[0].icon === '', 'night: ' + JSON.stringify(c.hud.night));
  expect(c.hud.alarm.filled === 6, 'filled is held to the clock\'s size: ' + JSON.stringify(c.hud.alarm));
  expect(same(c.hud.crew, [{ name: 'a', costume: '', icon: '' }]) && c.hud.target === null && c.hud.ways.found === 0 && c.hud.ways.total === 99, 'crew, target, ways: ' + JSON.stringify([c.hud.crew, c.hud.target, c.hud.ways]));
  expect(same(Object.keys(c.cards), ['ok_2']), 'only a card with a plain id and an object body survives: ' + Object.keys(c.cards));
  expect(Object.getPrototypeOf(c.cards) === Object.prototype, '__proto__ did not become the prototype');
  const t = cleanMission({ seq: 1, site: '  a\u0000b\nc\t d ' + '😀'.repeat(100) }).site;
  expect(t.startsWith('a b c  d') && t.length <= L.str && !/[\u0000-\u001f]/.test(t), 'control characters: ' + JSON.stringify(t.slice(0, 20)));
  expect(!/[\ud800-\udbff]$/.test(t) && !/(^|[^\ud800-\udbff])[\udc00-\udfff]/.test(t), 'no half of a surrogate pair at the cut');
  const lead = cleanMission({ seq: 1, cards: { a: { leads: [{ name: '', line: '' }, { line: 'only a line' }, { name: 'n', done: 'yes' }, { name: 'm', done: true }] } } }).cards.a.leads;
  expect(lead.length === 3 && lead[2].done === true && !('done' in lead[1]) && !('done' in lead[0]), 'leads: ' + JSON.stringify(lead));
});

await step('missionHit: whole words in any case, with the path; a name never matches across two strings; card ids are scanned too', () => {
  const m = cleanMission(missionOf(1));
  expect(missionHit(m, []) === null && missionHit(m, ['Mirabel Dray']) === null && missionHit(null, ['x']) === null, 'no hit, no names, no mission');
  m.hud.now[0].text = 'Ask mirabel dray about it';
  let h = missionHit(m, ['Quentin Pike', 'Mirabel Dray']);
  expect(h && h.name === 'Mirabel Dray' && h.path === 'mission.hud.now.0.text', 'a hit: ' + JSON.stringify(h));
  m.hud.now[0].text = 'Mirabelle Draymond';
  expect(missionHit(m, ['Mirabel Dray']) === null, 'a longer word is not a hit');
  m.hud.now[0].text = 'Mirabel'; m.hud.next[0].text = 'Dray';
  expect(missionHit(m, ['Mirabel Dray']) === null, 'two words in two strings are not the name');
  m.hud.next[0].text = 'The fireworks'; m.hud.now[0].text = 'The speeches';
  m.cards.mirabel = m.cards.char_dot; delete m.cards.char_dot;
  h = missionHit(m, ['Mirabel']);
  expect(h && h.path === 'mission.cards.mirabel', 'a card id is scanned: ' + JSON.stringify(h));
  const texts = missionTexts(cleanMission(missionOf(1))).map((t) => t[1]);
  expect(texts.includes('The speeches') && texts.includes('char_kit') && texts.includes(CARD_ONLY + ' she never leaves a table while she is winning.'), 'missionTexts lists the strings and the ids');
});

// ---------- the Worker ----------
let hidden;   // the hidden NPC
await step('setup: a hidden NPC with an alias, a revealed NPC, a hidden clock and a visible one (GM writes)', async () => {
  let r = await call('POST', '/api/npcs', { body: { name: 'Mirabel Dray', alias: 'The Quiet One', revealed: false } });
  expect(r.status === 201 || r.status === 200, 'npc ' + r.status + r.text);
  hidden = r.json.id;
  r = await call('POST', '/api/npcs', { body: { name: 'Quentin Pike', revealed: true } });
  expect(r.status === 201 || r.status === 200, 'npc ' + r.status + r.text);
  r = await call('PATCH', '/api/campaign', { body: { crew: { name: 'Invented Crew' }, clocks: [{ id: 'burn', name: 'Quiet Burn', size: 6, filled: 1, kind: 'danger', hidden: true }, { id: 'plan', name: 'The Plan', size: 4, filled: 0, kind: 'project', hidden: false }] } });
  expect(r.status === 200 && r.json.doc.clocks.length === 2, 'clocks ' + r.status + r.text.slice(0, 200));
});

await step('PATCH by the GM stores the cleaned mission, pokes campaign AND display once each after the write, and leaves the rest of the document alone', async () => {
  const m = missionOf(1); m.junk = 'DROP-ME'; m.hud.now[0].junk = 'DROP-ME';
  const r = await call('PATCH', '/api/campaign', { body: { mission: m } });
  expect(r.status === 200, r.status + ' ' + r.text.slice(0, 200));
  expect(!r.text.includes('DROP-ME') && same(r.json.doc.mission, missionOf(1)), 'the answer carries the cleaned mission: ' + r.text.slice(0, 200));
  expect(same(r.pokes.slice().sort(), ['campaign', 'display']) && r.pending === 1, 'pokes ' + JSON.stringify(r.pokes) + ' in ' + r.pending + ' waitUntil');
  const doc = await stored();
  expect(same(doc.mission, missionOf(1)) && doc.crew.name === 'Invented Crew' && doc.clocks.length === 2, 'stored: ' + JSON.stringify(doc).slice(0, 200));
});

await step('a PATCH by the GM REPLACES the mission: a card the page dropped is gone, a key it left out is gone, a patch without `mission` leaves it', async () => {
  const m2 = missionOf(2);
  delete m2.cards.char_dot; delete m2.hud.alarm; delete m2.hud.target;
  let r = await call('PATCH', '/api/campaign', { body: { mission: m2 } });
  expect(r.status === 200, 'status ' + r.status);
  let doc = await stored();
  expect(same(Object.keys(doc.mission.cards), ['char_kit']), 'cards: ' + Object.keys(doc.mission.cards));
  expect(doc.mission.hud.alarm === null && doc.mission.hud.target === null && doc.mission.seq === 2, 'hud replaced, not merged: ' + JSON.stringify(doc.mission.hud).slice(0, 160));
  r = await call('PATCH', '/api/campaign', { body: { crew: { heat: 3 } } });
  expect(same(r.pokes, ['campaign']) && r.pending === 1, 'a patch without mission pokes campaign only: ' + JSON.stringify(r.pokes));
  doc = await stored();
  expect(doc.mission.seq === 2 && doc.crew.heat === 3, 'the mission stays through another write');
  r = await call('PATCH', '/api/campaign', { body: { mission: {} } });
  expect(r.status === 400 && /seq/.test(r.json.error), 'an empty mission has no seq: ' + r.status + r.text);
  r = await call('PATCH', '/api/campaign', { body: { mission: 'x' } });
  expect(r.status === 400 && r.pokes.length === 0, 'a string is 400, no poke');
  expect((await stored()).mission.seq === 2, 'a refused write changes nothing');
});

await step('422 names the hit: a hidden NPC by name or by alias, a hidden clock; nothing stored, nothing poked; a revealed NPC and a visible clock pass', async () => {
  const tries = [
    ['hidden NPC in the band', (m) => { m.hud.now[0].text = 'Mirabel Dray arrives'; }, 'Mirabel Dray', 'mission.hud.now.0.text'],
    ['hidden NPC\'s alias in a card, any case', (m) => { m.cards.char_kit.know = ['they say the quiet one is here']; }, 'The Quiet One', 'mission.cards.char_kit.know.0'],
    ['hidden clock in a lead line', (m) => { m.cards.char_kit.leads[0].line = 'Watch the quiet burn'; }, 'Quiet Burn', 'mission.cards.char_kit.leads.0.line'],
    ['hidden name past the cut is not read (cut first)', (m) => { m.hud.label = 'a'.repeat(160) + ' Mirabel Dray'; }, null, null],
  ];
  for (const [label, edit, name, where] of tries) {
    const m = missionOf(5); edit(m);
    const r = await call('PATCH', '/api/campaign', { body: { mission: m } });
    if (name === null) { expect(r.status === 200, label + ': ' + r.status + r.text.slice(0, 120)); continue; }
    expect(r.status === 422 && r.json.error.includes('"' + name + '"') && r.json.error.includes(where), label + ': ' + r.status + ' ' + r.text);
    expect(r.pokes.length === 0 && r.pending === 0, label + ': poked ' + JSON.stringify(r.pokes));
  }
  const ok = missionOf(6);
  ok.hud.now[0].text = 'Quentin Pike gives the toast and The Plan goes on'; ok.hud.label = 'Gala night';
  const r = await call('PATCH', '/api/campaign', { body: { mission: ok } });
  expect(r.status === 200, 'a revealed NPC and a visible clock are fine: ' + r.status + r.text.slice(0, 160));
  expect((await stored()).mission.seq === 6, 'stored');
  // reveal the hidden NPC: the same words now pass (the page\'s "Reveal and send")
  const rv = await call('PATCH', '/api/npcs/' + hidden, { body: { revealed: true } });
  expect(rv.status === 200, 'reveal ' + rv.status + rv.text.slice(0, 120));
  const m = missionOf(7); m.hud.now[0].text = 'Mirabel Dray arrives';
  expect((await call('PATCH', '/api/campaign', { body: { mission: m } })).status === 200, 'after the reveal it passes');
  await call('PATCH', '/api/npcs/' + hidden, { body: { revealed: false } });
});

await step('a PATCH with a refused mission stores nothing of the body, not even its other keys (422 before the write)', async () => {
  const before = JSON.stringify((await stored()).crew);
  const m = missionOf(9); m.cards.char_kit.know = ['Mirabel Dray'];
  const r = await call('PATCH', '/api/campaign', { body: { crew: { heat: 5 }, mission: m } });
  expect(r.status === 422, 'status ' + r.status);
  expect(JSON.stringify((await stored()).crew) === before, 'crew unchanged');
});

await step('null removes the mission and pokes campaign and display; removing it again is harmless', async () => {
  let r = await call('PATCH', '/api/campaign', { body: { mission: null } });
  expect(r.status === 200 && !('mission' in r.json.doc) && same(r.pokes.slice().sort(), ['campaign', 'display']), r.status + ' ' + JSON.stringify(r.pokes));
  expect(!('mission' in (await stored())), 'gone');
  r = await call('PATCH', '/api/campaign', { body: { mission: null } });
  expect(r.status === 200 && !('mission' in r.json.doc), 'twice');
});

// ---------- players ----------
await step('a player cannot set, replace, change or remove `mission` (403), by PATCH or PUT, and the stored mission is untouched', async () => {
  const set = async (user, method, body, label) => {
    const r = await call(method, '/api/campaign', { user, body });
    expect(r.status === 403 && r.pokes.length === 0, label + ': ' + r.status + ' ' + r.text.slice(0, 120));
    return r;
  };
  // none stored
  await set(ALEX, 'PATCH', { mission: missionOf(1) }, 'set when none is stored');
  await set(ALEX, 'PATCH', { mission: {} }, 'an empty object');
  await set(ALEX, 'PATCH', { mission: 'x' }, 'a string');
  await set(ALEX, 'PATCH', { mission: { hud: { time: 'x' } } }, 'a sub-key');
  expect(!('mission' in (await stored())), 'nothing was stored');
  expect((await call('PATCH', '/api/campaign', { body: { mission: missionOf(10) } })).status === 200, 'the GM sets one');
  const was = JSON.stringify((await stored()).mission);
  await set(BEA, 'PATCH', { mission: missionOf(11) }, 'replace');
  await set(BEA, 'PATCH', { mission: null }, 'remove');
  await set(BEA, 'PATCH', { mission: { hud: { time: '23:59' } } }, 'change one field');
  await set(BEA, 'PATCH', { mission: { cards: { char_kit: { name: 'Mine' } } } }, 'change a card');
  await set(BEA, 'PUT', { mission: missionOf(12), crew: {} }, 'PUT');
  await set(ALEX, 'PATCH', { crew: { a: 1 }, mission: { seq: 10, v: 1, extra: 'x' } }, 'a change smuggled beside an allowed one');
  expect(JSON.stringify((await stored()).mission) === was, 'the mission is exactly as the GM wrote it');
  // what a player may still do keeps working, and never touches the mission
  let r = await call('PATCH', '/api/campaign', { user: ALEX, body: { schedule: { rsvp: { [ALEX]: 'yes' } }, crew: { notes: 'mine' } } });
  expect(r.status === 200 && same(r.pokes, ['campaign']), 'an ordinary player write: ' + r.status + JSON.stringify(r.pokes));
  r = await call('PATCH', '/api/campaign', { user: ALEX, body: { mission: { v: 1, seq: 10, site: 'The Pelican Rooms' }, crew: { notes: 'again' } } });
  expect(r.status === 200 && JSON.stringify((await stored()).mission) === was && same(r.pokes, ['campaign']), 'an unchanged piece of the mission resent beside another change is harmless: ' + r.status);
});

await step('a PUT by the GM never changes the stored mission: the body\'s mission is ignored, and a body without one keeps it', async () => {
  const was = JSON.stringify((await stored()).mission);
  const copy = (await stored());
  let r = await call('PUT', '/api/campaign', { body: { ...copy, mission: missionOf(40) } });
  expect(r.status === 200 && JSON.stringify(r.json.doc.mission) === was && same(r.pokes, ['campaign']), 'ignored: ' + r.status + ' ' + JSON.stringify(r.pokes));
  const { mission: _m, ...without } = copy;
  r = await call('PUT', '/api/campaign', { body: without });
  expect(r.status === 200 && JSON.stringify(r.json.doc.mission) === was && JSON.stringify((await stored()).mission) === was, 'kept: ' + r.status);
});

// ---------- the display's fourth part ----------
async function display(qs, user = IPAD) { return call('GET', '/api/gm/display' + (qs ? '?' + qs : ''), { user }); }

await step('the fourth part: no hseq means no `mission`; hseq=0 with no mission is { hseq: 0, hud: null }, in every form of the call', async () => {
  await call('PATCH', '/api/campaign', { body: { mission: null } });
  const forms = ['seq=0', 'seq=0&aseq=0', 'seq=0&aseq=0&sseq=0', ''];
  for (const f of forms) {
    const a = await display(f);
    expect(a.status === 200 && !('mission' in a.json), 'without hseq (' + f + '): ' + a.text.slice(0, 120));
    const b = await display((f ? f + '&' : '') + 'hseq=0');
    expect(b.status === 200 && same(b.json.mission, { hseq: 0, hud: null }), 'hseq=0 (' + f + '): ' + b.text.slice(0, 160));
    const c = await display((f ? f + '&' : '') + 'hseq=5');
    expect(same(c.json.mission, { hseq: 0, hud: null }), 'a page at 5 learns the mission is gone (' + f + ')');
  }
});

await step('the fourth part: seq, unchanged and hud-only; a stale or malformed hseq gets the hud; the GM reads it too', async () => {
  const set = await call('PATCH', '/api/campaign', { body: { mission: missionOf(3) } });
  expect(set.status === 200, 'set ' + set.status);
  const hud = missionOf(3).hud;
  const forms = ['seq=0', 'seq=0&aseq=0', 'seq=0&aseq=0&sseq=0', ''];
  for (const f of forms) {
    const q = (h) => (f ? f + '&' : '') + 'hseq=' + h;
    let a = await display(q(0));
    expect(same(a.json.mission, { hseq: 3, hud }), 'a first poll gets the hud (' + f + '): ' + a.text.slice(0, 200));
    a = await display(q(3));
    expect(same(a.json.mission, { hseq: 3, unchanged: true }), 'same seq is unchanged (' + f + '): ' + JSON.stringify(a.json.mission));
    for (const stale of ['2', '4', '30', '-1', 'abc', '', '3.0', '03x', '9'.repeat(30), '%00']) {
      a = await display(q(stale));
      expect(same(a.json.mission, { hseq: 3, hud }), 'hseq=' + stale + ' counts as stale (' + f + '): ' + JSON.stringify(a.json.mission).slice(0, 80));
    }
  }
  const g = await display('seq=0&aseq=0&sseq=0&hseq=1', GM);
  expect(same(g.json.mission, { hseq: 3, hud }), 'the GM page reads the same part');
  // a new publish with a higher seq reaches a page that held the old one, with the new hud only
  const next = missionOf(4); next.hud.time = '22:45';
  await call('PATCH', '/api/campaign', { body: { mission: next } });
  const a = await display('seq=0&aseq=0&sseq=0&hseq=3');
  expect(a.json.mission.hseq === 4 && a.json.mission.hud.time === '22:45', 'the new hud: ' + JSON.stringify(a.json.mission).slice(0, 100));
  // a lower seq than the page holds is also a change (a restarted GM page)
  const low = missionOf(2); low.hud.time = '21:00';
  await call('PATCH', '/api/campaign', { body: { mission: low } });
  const b = await display('seq=0&aseq=0&sseq=0&hseq=4');
  expect(b.json.mission.hseq === 2 && b.json.mission.hud.time === '21:00', 'a lower seq still arrives: ' + JSON.stringify(b.json.mission).slice(0, 100));
});

await step('hud only: a card\'s own text appears in NO display answer, in any form of the call, for the iPad or the GM page; the iPad cannot read the campaign route', async () => {
  const cards = JSON.stringify((await stored()).mission.cards);
  expect(cards.includes(CARD_ONLY) && cards.includes('A brass key') && cards.includes('A tall man in a grey coat'), 'the cards are stored with their words');
  const cardOnly = ['A brass key', 'A tall man in a grey coat', 'Sees through the cook', 'A seat at her table', 'she never leaves a table', 'The programme: speeches at ten', 'A trapdoor to the showroom', CARD_ONLY, 'char_kit', 'char_dot', '22:45', 'player.a@example.test'];
  const forms = ['', 'seq=0', 'seq=1', 'seq=0&aseq=0', 'seq=0&aseq=0&sseq=0', 'hseq=0', 'seq=0&hseq=0', 'seq=0&aseq=0&hseq=0', 'seq=0&aseq=0&sseq=0&hseq=0', 'seq=0&aseq=0&sseq=0&hseq=999', 'hseq=2', 'seq=0&aseq=0&sseq=0&hseq=2'];
  let sawHud = 0;
  for (const user of [IPAD, GM]) for (const f of forms) {
    const r = await display(f, user);
    expect(r.status === 200, f + ': ' + r.status);
    for (const w of cardOnly) expect(!r.text.includes(w), user + ' ' + f + ': "' + w + '" is in the display answer: ' + r.text.slice(0, 160));
    expect(!/"cards"/.test(r.text), f + ': a cards key');
    if (r.json.mission && r.json.mission.hud) { sawHud++; expect(keys(r.json.mission.hud) === 'time,label,now,next,night,alarm,crew,target,ways', 'hud keys'); }
  }
  expect(sawHud >= 6, 'the hud WAS served in the forms that ask (' + sawHud + '), so the absence above is not a pass by default');
  const sql = exec.log.filter((s) => /\$\.mission/.test(s));
  expect(sql.length > 0 && sql.every((s) => !/\$\.mission\.cards|json_extract\(doc, '\$\.mission'\)/.test(s)), 'no statement selects the cards or the whole mission: ' + sql[0]);
  for (const [p, user] of [['/api/campaign', IPAD], ['/api/export', IPAD], ['/api/gm/state', IPAD], ['/api/characters', IPAD]]) {
    const r = await call('GET', p, { user });
    expect(r.status === 403 && !r.text.includes(CARD_ONLY), 'the display sign-in is refused on ' + p + ': ' + r.status);
  }
  for (const user of [ALEX, BEA]) {
    const r = await call('GET', '/api/gm/display?hseq=0', { user });
    expect(r.status === 403 && !r.text.includes('hud'), 'a player is refused the display route: ' + r.status);
  }
});

await step('no extra D1 call: a poll that sends hseq makes the same number of D1 calls as one that does not, in every form, changed or not', async () => {
  const count = async (qs) => { const n = exec.calls; await display(qs); return exec.calls - n; };
  for (const f of ['seq=0&aseq=0&sseq=0', 'seq=0&aseq=0', 'seq=0', 'seq=99999&aseq=99999&sseq=99999']) {
    const base = await count(f);
    const withHseq = await count(f + '&hseq=2'), unchanged = await count(f + '&hseq=2'), stale = await count(f + '&hseq=1');
    const delta = f === 'seq=0' || f === 'seq=0&aseq=0' ? 1 : 0;   // the two older forms read no live switch, so the part is its own read there
    expect(withHseq === base + delta && unchanged === base + delta && stale === base + delta, f + ': ' + base + ' without, ' + [withHseq, unchanged, stale] + ' with');
  }
  // the unchanged answer reads no hud: the statement for it selects the hud only under a CASE on the seq
  const sql = exec.log.filter((s) => /mission\.hud/.test(s)).pop();
  expect(/CASE WHEN json_valid\(doc\) AND COALESCE\(json_extract\(doc, '\$\.mission\.seq'\), 0\) != /.test(sql), 'the hud sits under the seq test: ' + sql);
});

await step('a mission write pokes display: the iPad is told at once; GET and a refused write poke nothing', async () => {
  let r = await call('PATCH', '/api/campaign', { body: { mission: missionOf(20) } });
  expect(r.pokes.includes('display') && r.pokes.includes('campaign') && r.pokes.length === 2 && r.pending === 1, JSON.stringify(r.pokes));
  r = await call('GET', '/api/campaign', { user: ALEX });
  expect(r.pokes.length === 0 && r.pending === 0, 'GET pokes nothing');
  r = await display('seq=0&aseq=0&sseq=0&hseq=1');
  expect(r.pokes.length === 0, 'the display GET pokes nothing');
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
