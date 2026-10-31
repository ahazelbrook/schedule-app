// VV9: what the mission may and may not carry, worked out from the INPUT (the invented Pelican Rooms fixture and the night's state),
// never from the mission under test, so a list cannot agree with a leak by construction. Shared by checks/runtime/gm-nosecrets.test.mjs
// section (o) and checks/api/mission-secrecy.mjs. No campaign text: every string here is read out of pelican-play-v2.json at run time.
//
//   markers(fx)            every "GM-ONLY-..." string of the fixture (the level's GM-only fields)
//   cardPool(fx)           every string the fixture holds ONLY for a phone card: lead lines, way names, windows, steps, intel texts, item labels,
//                          a route's public line. Never in the band. (The zones' labels are band words since A1: hud.rooms.)
//   nowhereWords(fx)       what a watcher looks like and is called, and the target's name: the costume mechanic is GM-side (A1), so neither
//                          the band nor a card holds them
//   hiddenEvents(fx)       the pub of each hidden event: in the band only once the crew as a whole has been told
//   expectation(fx, st, pc, others)
//                          what a PC's own card must hold for this state, and what it must NOT (what only the others heard, were told, or carry)
//   bandForbidden(fx, st)  everything the band must not hold for this state
//   keyPaths(v)            the set of key paths of a value, arrays collapsed to "*"
//   HUD_PATHS, CARD_PATHS  the key paths design 5.5c allows in what the page BUILDS (written out here, not read from the code)
//   SERVER_HUD_PATHS, SERVER_CARD_PATHS  the same plus the retired costume keys cleanMission writes back blank (for stored/served missions)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = path.join(HERE, 'pelican-play-v2.json');
export const loadFixture = () => JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

const MIN = 9;        // shorter strings are vocabulary other, public lines can hold ("The lift" is inside "The lift is guarded")
const keep = (list) => [...new Set(list.filter((s) => typeof s === 'string' && s.length >= MIN))];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* a window's exact range as the card prints it, "23:30–00:15" (only for a window with an end: a lone time is too common to search for) */
export const exactRange = (w) => (w.window && w.window.at && w.window.until ? w.window.at + '–' + w.window.until : '');
export const markers = (fx) => [...new Set(JSON.stringify(fx).match(/GM-ONLY-[A-Z0-9-]+/g) || [])];

export function cardPool(fx) {
  const out = [];
  for (const w of fx.ways || []) out.push(w.lead && w.lead.line, w.pubName, w.window && w.window.pub, ...(w.steps || []));
  for (const x of fx.intel || []) out.push(x.text);
  for (const i of fx.items || []) out.push(i.label);
  for (const r of fx.routes || []) out.push(r.pub);
  for (const w of fx.ways || []) out.push(exactRange(w));
  const vocab = bandVocabulary(fx).map((v) => v.toLowerCase());
  return keep(out).filter((p) => !vocab.some((v) => v.includes(p.toLowerCase()))) ;
}

/* the watchers' names and looks, and the target's name: the costume mechanic is GM-side (A1), so neither the band nor a card holds them */
export function nowhereWords(fx) {
  return keep((fx.people || []).filter((p) => !/^GM-ONLY/.test(p.label || '')).flatMap((p) => [p.label, p.kind === 'target' ? null : p.look]));
}

/* the strings the band legitimately holds (public events, the alarm's lines, the clock's label, the zones' labels and room names of hud.rooms;
   the costumes' labels stay listed though no band carries them since A1): the pool must not overlap them */
export function bandVocabulary(fx) {
  const out = [fx.clock && fx.clock.label, ...(fx.events || []).filter((e) => e.vis === 'public').map((e) => e.pub), ...((fx.alarm && fx.alarm.pub) || []), ...(fx.disguises || []).map((d) => d.label),
    ...(fx.zones || []).flatMap((z) => [z.label, ...(Array.isArray(z.rooms) ? z.rooms : [])])];
  return out.filter((s) => typeof s === 'string' && s);
}

export const hiddenEvents = (fx) => (fx.events || []).filter((e) => e.vis === 'hidden').map((e) => ({ id: e.id, pub: e.pub }));

/* who has been told an event: [pc ids] or 'crew', from the state's told map and the intel that reveals it */
export function toldEvent(fx, st, eventId) {
  const told = isObj(st.told) ? st.told : {}, who = new Set();
  let crew = false;
  for (const x of fx.intel || []) {
    if (!((x.reveals && x.reveals.events) || []).includes(eventId)) continue;
    const t = told[x.id];
    if (t === 'crew') crew = true; else if (Array.isArray(t)) t.forEach((p) => who.add(p));
  }
  return { crew, pcs: [...who] };
}

/* what is PRIVATE to this PC in this state: heard, told to them alone, carried */
export function ownOf(fx, st, pc, forMust) {
  const heard = isObj(st.heard) ? st.heard : {}, told = isObj(st.told) ? st.told : {}, crew = isObj(st.crew) ? st.crew : {};
  const out = [];
  for (const w of fx.ways || []) if (isObj(heard[w.id]) && typeof heard[w.id][pc] === 'number') out.push(w.lead.line, w.pubName, forMust ? null : w.window && w.window.pub);
  for (const x of fx.intel || []) if (Array.isArray(told[x.id]) && told[x.id].includes(pc)) out.push(x.text);
  const mine = isObj(crew[pc]) && Array.isArray(crew[pc].items) ? crew[pc].items : [];
  for (const i of fx.items || []) if (mine.includes(i.id)) out.push(i.label);
  return keep(out);
}

/* the hidden-event pubs this PC may know (told to them, or to the whole crew) */
function knownEventPubs(fx, st, pc) {
  const out = new Set();
  for (const e of hiddenEvents(fx)) { const t = toldEvent(fx, st, e.id); if (t.crew || t.pcs.includes(pc)) out.add(e.pub); }
  return out;
}

/* { must: strings this PC's own card has to hold, mustNot: strings it must never hold } */
export function expectation(fx, st, pc, others) {
  const mine = ownOf(fx, st, pc), theirs = new Set(), must = ownOf(fx, st, pc, true);
  const inMine = (s) => mine.some((m) => m.toLowerCase().includes(s.toLowerCase()));
  for (const o of others) ownOf(fx, st, o).forEach((s) => { if (!inMine(s)) theirs.add(s); });
  const known = knownEventPubs(fx, st, pc);
  hiddenEvents(fx).forEach((e) => { if (!known.has(e.pub)) theirs.add(e.pub); });
  laterSteps(fx, st).forEach((x) => theirs.add(x));
  /* a way's window: its exact range once the event it names has been told to this PC (or the crew), else its public line; a PC that has not heard the way sees neither */
  for (const w of fx.ways || []) {
    const heardIt = isObj(st.heard) && isObj(st.heard[w.id]) && typeof st.heard[w.id][pc] === 'number', rng = exactRange(w), t = w.window && w.window.told ? toldEvent(fx, st, w.window.told) : { crew: false, pcs: [] };
    const knows = heardIt && rng && (t.crew || t.pcs.includes(pc));
    if (rng) { if (knows) must.push(rng); else theirs.add(rng); }
    if (heardIt && !knows && w.window && w.window.pub && w.window.pub.length >= MIN) must.push(w.window.pub);
  }
  return { must: keep(must), mustNot: [...theirs, ...markers(fx), ...nowhereWords(fx)] };
}

/* the band: no card-only string, no GM marker, no hidden event the crew as a whole has not been told */
export function bandForbidden(fx, st) {
  const out = new Set([...cardPool(fx), ...markers(fx), ...nowhereWords(fx)]);
  for (const e of hiddenEvents(fx)) if (!toldEvent(fx, st, e.id).crew) out.add(e.pub);
  laterSteps(fx, st).forEach((x) => out.add(x));
  return [...out];
}

export function keyPaths(v, prefix = '', out = new Set()) {
  if (Array.isArray(v)) { v.forEach((x) => keyPaths(x, prefix + '*.', out)); return out; }
  if (isObj(v)) for (const [k, x] of Object.entries(v)) { out.add(prefix + k); keyPaths(x, prefix + k + '.', out); }
  return out;
}

const P = (list) => new Set(list.split(/\s+/).filter(Boolean));
// design 5.5c, written out
export const HUD_PATHS = P(`time label now now.*.text now.*.where now.*.until next next.*.text next.*.where next.*.at next.*.inMin
  night night.beats night.start night.cur night.marks night.marks.*.i night.marks.*.icon night.marks.*.text
  alarm alarm.name alarm.size alarm.filled alarm.text crew crew.*.name crew.*.room target target.room ways ways.found ways.total
  rooms rooms.*.zone rooms.*.rooms showTime timer timer.endsAt timer.left timer.paused timer.len`);
export const CARD_PATHS = P(`name owner room items
  leads leads.*.name leads.*.line leads.*.heard leads.*.window leads.*.next leads.*.done know next next.*.text next.*.where next.*.at next.*.inMin
  paths paths.*.text paths.*.until busy costumeLine here`);

// What the SERVER keeps: cleanMission still accepts the retired costume fields and writes them back blank, so a stored or served mission carries those keys
// (empty); only the lists above, which check what the page's missionFor/buildMission BUILD, forbid them.
export const SERVER_HUD_PATHS = new Set([...HUD_PATHS, ...P('crew.*.costume crew.*.icon')]);
export const SERVER_CARD_PATHS = new Set([...CARD_PATHS, ...P('costume icon pos warn warn.who warn.look warn.sees zones zones.controlled zones.risky')]);

/* the steps of a way other than the NEXT unticked one (Alex's H7: a card shows the next step only), for every way, from the state's tick list */
export function laterSteps(fx, st) {
  const ticks = isObj(st.steps) ? st.steps : {}, out = [];
  for (const w of fx.ways || []) {
    const t = Array.isArray(ticks[w.id]) ? ticks[w.id] : [], list = w.steps || [];
    let next = 0;
    while (next < list.length && t[next] === true) next++;
    list.forEach((s, i) => { if (i > next && s.length >= MIN) out.push(s); });
  }
  return out;
}

export const has = (hay, needle) => hay.toLowerCase().includes(needle.toLowerCase());
/* the checks on one published mission (the parsed body's mission, or what cleanMission kept), for the state it was built from */
export function checkMission(fx, m, st, label, tally, viaServer = false) {
  const HP = viaServer ? SERVER_HUD_PATHS : HUD_PATHS, CP = viaServer ? SERVER_CARD_PATHS : CARD_PATHS;
  const ids = ['pc_a', 'pc_b'];
  const band = JSON.stringify(m.hud);
  for (const bad of bandForbidden(fx, st)) { tally.negBand++; if (has(band, bad)) throw new Error(label + ': the band holds "' + bad + '"'); }
  for (const p of keyPaths(m.hud)) if (!HP.has(p)) throw new Error(label + ': the band has a key outside design 5.5c: hud.' + p);
  for (const k of Object.keys(m)) if (!['v', 'site', 't', 'seq', 'hud', 'cards'].includes(k)) throw new Error(label + ': a top-level key outside the shape: ' + k);
  if (Object.keys(m.cards).sort().join() !== ids.join()) throw new Error(label + ': the cards are ' + Object.keys(m.cards));
  const blank = (v) => v === '' || v == null || (Array.isArray(v) && !v.length) || (isObj(v) && Object.values(v).every(blank));   // "" / null / [] / {} (or only those inside)
  if (viaServer) for (const c of m.hud.crew || []) for (const k of ['costume', 'icon']) if (!blank(c[k])) throw new Error(label + ': a retired band key is not empty: hud.crew.' + k);
  for (const id of ids) {
    const card = m.cards[id];
    if (viaServer) for (const k of ['costume', 'icon', 'pos', 'warn', 'zones']) if (!blank(card[k])) throw new Error(label + ': ' + id + "'s card holds the retired key " + k + ' with content');
    const text = JSON.stringify(card), e = expectation(fx, st, id, ids.filter((x) => x !== id));
    for (const p of keyPaths(card)) if (!CP.has(p)) throw new Error(label + ': ' + id + '\'s card has a key outside design 5.5c: ' + p);
    for (const bad of e.mustNot) { tally.negCard++; if (has(text, bad)) throw new Error(label + ': ' + id + '\'s card holds "' + bad + '" (heard, told or carried by the other, a later step, a hidden event, or a GM marker)'); }
    for (const good of e.must) { tally.pos++; tally.seen.add(good); if (!has(text, good)) throw new Error(label + ': positive control: ' + id + '\'s own "' + good + '" is missing from their card, so the negatives above proved nothing'); }
  }
}

