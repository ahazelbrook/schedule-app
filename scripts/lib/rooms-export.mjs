// scripts/lib/rooms-export.mjs: the room tables in the vault into the pack's `rooms` part (room.tables). RK12 of the room key build.
//
//   exportRooms(dir) -> { part, errors, warnings, bytes }
//     dir       a folder of Markdown pages. Each page's frontmatter says what it is (`b68:`):
//                 rooms         one `## <room>` section per room, in the shape Tools/Room tables/b68-room-tables.md gives (the theme is the page's own `theme:`)
//                 room-roles    one `## <role>` section per role: Lines, Looks, Pose, Face
//                 anything else (rooms-format, no `b68:` at all) is skipped
//     part      { v: 1, T: { rooms, roles, aliases } }: the shape of checks/runtime/fixtures/gm/rooms-pack.json (under T so the CHECKED loop in gm-page.js can call check(body.T))
//                 rooms    { <normRoom>: { name, themes[], band, say[3], people[{ role, w }], things[10] } }, a thing being { name, line, look, roll, danger, states[], tags[] }
//                          (what B68GmRoomThings.clean() gives, without its slug)
//                 roles    { <role>: { lines[3], looks[2], pose, face } }
//                 aliases  { <normRoom>: <normRoom> }  "A vault" is also "vault" (a leading a / an / some dropped, unless that is a room of its own); a room may add
//                          names of its own with a line `- **Aliases:** Coat check · Cloak room`
//     errors    strings, `<page> > <room>: <what>`; check mode exits 1 on any, and gm-pack leaves the part out
//     warnings  strings
//     bytes     the part's size as gm-pack measures it (Buffer.byteLength of its JSON)
//
// The rules live once, in app/gm/room-tables.js (validate), so the page and this exporter agree: a room with other than 10 things or 3 says, a field over its limit (limits
// from app/gm/room-things.js), an unknown role or tag, fewer than 5 tags, more than 2 weapons, fewer than 2 clues, no escape or cover, a duplicate thing name. What only the
// pages can show is checked here: the heading and its band, the numbering, the People line, a thing's first line (at most 80 characters with its name), a closer look and Tags
// on every thing, the roles page's pose and face words. A room the map kit (M.ROOMS) does not know is a warning.
// This reads only the folder it is given, and copies nothing into the repo.
//
// Check mode: node scripts/lib/rooms-export.mjs --check <folder>      (npm run gm:rooms-check <folder>)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Rooms = require('../../app/gm/room-notes.js');
const Things = require('../../app/gm/room-things.js');
const Tables = require('../../app/gm/room-tables.js');
const Scene = require('../../app/gm/scene-state.js');

export const PART_SOFT = 600 * 1024;       // the plan's budget for the part: a warning past it
export const PART_CAP = 900 * 1024;        // the server's per-part cap (functions/_lib/gm.js LIMITS.partBytes): an error past it
export const FIRST_LINE = 80;              // a thing's first line, its name included (the format page)
export const POSES = ['pocket', 'hip', 'cross', 'smoke', 'hold', 'behind', 'carry', 'raise', 'lapel'];
export const FACES = ['stern', 'smirk', 'tired', 'wary', 'surprised', 'sneer', 'sad', 'cool', 'determined', 'amused', 'grin', 'laugh', 'shout', 'neutral', 'pleased', 'hostile', 'afraid'];
const ROLE_IDS = Scene.ROLE_IDS.slice();

export function emptyPart() {
  return { v: 1, T: { rooms: {}, roles: {}, aliases: {} } };
}

// a key that is named like a prototype property ("__proto__") is just a key
function put(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); return v; }
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// the map kit's room catalogue (its public `rooms`, M.ROOMS), read when first needed (a big file): a room name it does not know is a warning.
// A catalogue key is "Name" or "Theme:Name"; names match without regard to case, as the kit's own roomInfoAny does.
let catalogue;
function knownToKit(name) {
  if (catalogue === undefined) {
    try { const K = require('../../app/maps/map-kit.js'); catalogue = K && K.rooms && typeof K.rooms === 'object' ? Object.keys(K.rooms).map((k) => k.toLowerCase()) : null; } catch (e) { catalogue = null; }
  }
  const low = String(name).toLowerCase();
  return !catalogue || catalogue.some((k) => k === low || k.endsWith(':' + low));
}

function readPage(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const fm = {};
  if (m) for (const l of m[1].split('\n')) { const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(l); if (k) fm[k[1]] = k[2].trim().replace(/^["']|["']$/g, ''); }
  // a page's fenced examples are never read
  const body = (m ? text.slice(m[0].length) : text).replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, '');
  return { fm, body };
}

// the "## name" sections of a page: [{ name, lines }]
function sections(body) {
  const out = [];
  let cur = null;
  for (const l of body.split('\n')) {
    const h = /^##\s+(\S.*?)\s*$/.exec(l);
    if (h) { cur = { name: h[1], lines: [] }; out.push(cur); }
    else if (cur) cur.lines.push(l);
  }
  return out;
}

const BLOCKS = /^-\s+\*\*(Band|Say|People|Things|Aliases|Lines|Looks|Pose|Face):\*\*[ \t]*(.*)$/;
// a section's "- **Word:**" blocks: { Word: { rest, items: [{ n, text, subs: [text] }] } }
function blocksOf(lines, where, err, warn) {
  const out = {};
  let cur = null, item = null, itemInd = -1;
  for (const l of lines) {
    if (!/\S/.test(l)) continue;
    const ind = /^[ \t]*/.exec(l)[0].replace(/\t/g, '    ').length;
    const b = ind === 0 ? BLOCKS.exec(l) : null;
    if (b) {
      if (own(out, b[1])) err(where, 'the ' + b[1] + ' block is written twice');
      cur = put(out, b[1], { rest: b[2].trim(), items: [] }); item = null; itemInd = -1;
      continue;
    }
    if (ind === 0) { cur = null; item = null; warn(where, 'a line outside any block is ignored: "' + l.trim().slice(0, 40) + '"'); continue; }
    if (!cur) continue;
    const num = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(l), bul = /^\s*[-*+]\s+(.*)$/.exec(l);
    if (num && (itemInd < 0 || ind <= itemInd + 1)) { if (itemInd < 0) itemInd = ind; item = { n: +num[1], text: num[2].trim(), subs: [] }; cur.items.push(item); }
    else if (bul && item && ind > itemInd) item.subs.push(bul[1].trim());
    else if (bul && !item) { itemInd = ind; item = { n: 0, text: bul[1].trim(), subs: [] }; cur.items.push(item); }
    else if (item) { if (item.subs.length) item.subs[item.subs.length - 1] += ' ' + l.trim(); else item.text += ' ' + l.trim(); }
  }
  return out;
}

const plain = (s) => Rooms.plain(String(s == null ? '' : s));
const SUBS = [
  ['look', /^(?:\ud83d[\udd0d\udd0e]️?|look\s*:)\s*([\s\S]*)$/i],
  ['roll', /^(?:🎲️?|roll\s*:)\s*([\s\S]*)$/i],
  ['danger', /^(?:!|⚠️?)\s+([\s\S]*)$|^danger\s*:\s*([\s\S]*)$/i],
  ['states', /^states?\s*:\s*([\s\S]*)$/i],
  ['tags', /^tags?\s*:\s*([\s\S]*)$/i]];

// one numbered item of a Things block -> a thing (null when it has no name); err(msg) for a page-level problem
function thingOf(it, i, err, warn) {
  const w = 'thing ' + (i + 1);
  if (it.n !== i + 1) err(w + ': numbered ' + it.n + ' (expected ' + (i + 1) + ')');
  const b = /^(?:\*\*|__)(.+?)(?:\*\*|__)([\s\S]*)$/.exec(it.text);
  if (!b) { err(w + ': the first line must start with **Name**'); return null; }
  const name = plain(b[1]), line = plain(b[2]).replace(/^[\s,;:.–—-]+/, '');
  const who = w + ' (' + name + ')';
  const first = name.length + (line ? 1 : 0) + line.length;
  if (first > FIRST_LINE) err(who + ': the first line is ' + first + ' characters with its name (at most ' + FIRST_LINE + ')');
  const f = { look: '', roll: '', danger: '', states: '', tags: '' }, seen = {};
  for (const s of it.subs) {
    const p = plain(s);
    const hit = SUBS.find(([, re]) => re.test(p));
    if (!hit) { err(who + ': an unexpected line: "' + s.slice(0, 40) + '"'); continue; }
    const m = hit[1].exec(p);
    if (seen[hit[0]]) err(who + ': ' + hit[0] + ' is written twice'); else { seen[hit[0]] = true; f[hit[0]] = (m[1] || m[2] || '').trim(); }
  }
  if (!seen.look) err(who + ': no closer look (the magnifying-glass line)');
  if (!seen.tags) err(who + ': no Tags line');
  if (f.roll && !/\b4\/5\b.*\b6\s*:/.test(f.roll)) warn(who + ': the roll line should read "4/5: ... 6: ..."');
  // every field is kept at its true length, so the shared validator can fail one over its limit; the part never holds markdown
  const thing = {
    name, line, look: f.look, roll: f.roll, danger: f.danger,
    states: f.states.split('·').map((s) => s.trim().toLowerCase()).filter(Boolean),
    tags: f.tags.split(/[\s,·;|•]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
  // what B68GmRoomThings.clean() would make of it must be the same, field for field (the page may not leave markdown or an odd separator in a field)
  const c = Things.clean(thing);
  if (!c) return null;
  const L = Things.LIMITS;
  for (const k of ['name', 'line', 'look', 'roll', 'danger']) if (thing[k].length <= L[k] && c[k] !== thing[k]) err(who + ': ' + k + ' is changed by cleaning');
  if (thing.states.length <= L.states && thing.states.every((s) => s.length <= L.state) && c.states.join('\u0001') !== thing.states.join('\u0001')) err(who + ': a state is changed by cleaning');
  return thing;
}

function unquote(s) {
  const t = String(s).trim();
  const m = /^(?:"([\s\S]*)"|“([\s\S]*)”)$/.exec(t);
  return m ? (m[1] !== undefined ? m[1] : m[2]).trim() : t;
}

function roomOf(sec, theme, err, warn) {
  const where = sec.name;
  const B = blocksOf(sec.lines, where, err, warn);
  const room = { name: sec.name, themes: theme ? [theme] : [], band: B.Band ? B.Band.rest.split(/\s+/)[0] || '' : '', say: [], people: [], things: [] };
  if (!B.Band) err(where, 'no Band line');
  if (!B.Say) err(where, 'no Say block'); else room.say = B.Say.items.map((it) => plain(it.text));
  if (!B.People) err(where, 'no People line');
  else for (const p of B.People.rest.split('·').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z][a-z0-9-]*)\s+(\d+)$/.exec(p);
    if (!m) err(where, 'the People entry "' + p.slice(0, 30) + '" is not "role weight"'); else room.people.push({ role: m[1], w: +m[2] });
  }
  if (!B.Things) err(where, 'no Things block');
  else B.Things.items.forEach((it, i) => {
    const t = thingOf(it, i, (m) => err(where, m), (m) => warn(where, m));
    if (t) room.things.push(t);
  });
  const aliases = B.Aliases ? B.Aliases.rest.split(/[·;|]/).map((s) => s.trim()).filter(Boolean) : [];
  return { room, aliases };
}

function roleOf(sec, err) {
  const where = 'role ' + sec.name;
  const B = blocksOf(sec.lines, where, err, () => {});
  const list = (k) => (B[k] ? B[k].items.map((it) => unquote(plain(it.text))) : []);
  const word = (k) => (B[k] ? B[k].rest.split(/\s+/)[0] || '' : '');
  if (!B.Lines) err(where, 'no Lines block');
  if (!B.Looks) err(where, 'no Looks block');
  const pose = word('Pose'), face = word('Face');
  if (!POSES.includes(pose)) err(where, 'Pose "' + pose + '" is not one of ' + POSES.join('/'));
  if (!FACES.includes(face)) err(where, 'Face "' + face + '" is not one of ' + FACES.join('/'));
  return { lines: list('Lines'), looks: list('Looks'), pose, face };
}

export function exportRooms(dir) {
  const part = emptyPart(), T = part.T, errors = [], warnings = [];
  const pageOf = {};                    // room key -> its page
  let file = '';
  const say = (list) => (where, msg) => list.push((file ? file + ' > ' : '') + (where ? where + ': ' : '') + msg);
  const E = say(errors), W = say(warnings);
  const explicit = [];                  // [alias text, room key, room name, page]

  for (const f of fs.readdirSync(dir).filter((n) => /\.md$/i.test(n)).sort()) {
    file = f;
    const { fm, body } = readPage(path.join(dir, f));
    if (fm.b68 === 'rooms') {
      if (!fm.theme) E('', 'the frontmatter has no theme:');
      for (const sec of sections(body)) {
        const { room, aliases } = roomOf(sec, fm.theme, E, W);
        const key = Rooms.normRoom(sec.name);
        if (!key) { E(sec.name, 'a room name with no letters'); continue; }
        if (own(T.rooms, key)) { E(sec.name, 'already written in ' + pageOf[key]); continue; }
        pageOf[key] = f;
        put(T.rooms, key, room);
        for (const a of aliases) explicit.push([a, key, sec.name, f]);
      }
    } else if (fm.b68 === 'room-roles') {
      for (const sec of sections(body)) {
        if (!ROLE_IDS.includes(sec.name)) E('role ' + sec.name, 'not a role the figure kit knows');
        else if (own(T.roles, sec.name)) E('role ' + sec.name, 'written twice');
        else put(T.roles, sec.name, roleOf(sec, E));
      }
    }
  }

  // aliases: a room's own first, then a leading a / an / some dropped
  for (const [text, key, name, f] of explicit) {
    file = f;
    const a = Rooms.normRoom(text);
    if (!a) E(name, 'an alias with no letters');
    else if (own(T.rooms, a)) E(name, 'the alias "' + text + '" is a room of its own');
    else if (own(T.aliases, a) && T.aliases[a] !== key) E(name, 'the alias "' + text + '" already means ' + T.aliases[a]);
    else put(T.aliases, a, key);
  }
  file = '';
  for (const key of Object.keys(T.rooms)) {
    const a = key.replace(/^(?:a|an|some)\s+/, '');
    if (!a || a === key || own(T.rooms, a)) continue;
    if (!own(T.aliases, a)) put(T.aliases, a, key);
    else if (T.aliases[a] !== key) W(T.rooms[key].name, 'the alias "' + a + '" is already ' + T.aliases[a] + '\'s');
  }

  // a role a room names must have its entry (the shared validator checks that, and that it is a role the figure kit knows)
  const byName = {};
  for (const k of Object.keys(T.rooms)) byName[T.rooms[k].name] = k;
  for (const p of Tables.validate(T, { roles: ROLE_IDS, knownRoom: knownToKit }).problems) {
    file = own(byName, p.room) ? pageOf[byName[p.room]] : '';
    (p.level === 'error' ? E : W)(p.room, p.msg);
  }
  file = '';

  const bytes = Buffer.byteLength(JSON.stringify(part));
  if (bytes > PART_CAP) E('', 'the part is ' + (bytes / 1024).toFixed(0) + ' KiB, over the server\'s ' + (PART_CAP / 1024) + ' KiB cap');
  else if (bytes > PART_SOFT) W('', 'the part is ' + (bytes / 1024).toFixed(0) + ' KiB, past the ' + (PART_SOFT / 1024) + ' KiB budget (the cap is ' + (PART_CAP / 1024) + ' KiB)');
  return { part, errors, warnings, bytes };
}

function main(argv) {
  const i = argv.indexOf('--check');
  const dir = i >= 0 ? argv[i + 1] : argv.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('usage: node scripts/lib/rooms-export.mjs --check <folder of room table pages>'); return 2; }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('not a folder: ' + dir); return 2; }
  const r = exportRooms(dir);
  r.warnings.forEach((w) => console.log('warning: ' + w));
  r.errors.forEach((e) => console.log('ERROR: ' + e));
  console.log('rooms: ' + Object.keys(r.part.T.rooms).length + ' room(s), ' + Object.keys(r.part.T.roles).length + ' role(s), ' + Object.keys(r.part.T.aliases).length + ' alias(es), ' +
    (r.bytes / 1024).toFixed(1) + ' KiB, ' + r.errors.length + ' error(s), ' + r.warnings.length + ' warning(s)');
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
