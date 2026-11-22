/* gm/room-state.js: the room-state contract (RK08.4 of the room key build, Gate 0 ruling 2; settings room.key and room.tables, bundle room-key).

   THE ROOM-STATE CONTRACT
   One new optional top-level GM-state key, `roomstate`. This file is the ONLY code that reads or writes it: RK11, RK13, RK15, RK16 and RK19
   call the API below and never touch the key. Old code (Deploy 41, 1ad1ba3) loads and saves a GM state holding it and leaves it alone.

   The shape:
     roomstate = { v: 1, at, keys: { <rollKey>: { part, at, rooms: { <roomKey>: {
       say?, rr?, extra?: { <slug>: <at> }, swaps?: { <slug>: <slug> }, marks?: { <slug>: <state> },
       blade?: { at, say?, things?: [thing], people?: [{ line, role? }] }, kept?: { <npcId>: { slot, at } } } } } } } }
     v        1. A roomstate whose v is not 1 is read as empty and never written (a later build owns it).
     at       ISO time of the last write: at the top for any roll; on a roll, its last write (the oldest roll is the one with the oldest at).
     rollKey  the page's rollKey(roll) (gm-page.js P.rollKey, ~:829): the seed, or 'a:' + the authored site's name; so saved, unsaved and
              hand-written sites all have one. Never `sites."<key>"` (gm:pull refuses a seedless site, saveSite nulls overrides). <= 80 chars.
     part     the rooms part's version when the roll was first written ('' with no rooms part). Sent with every write (the roll's own value,
              or the current one for a new roll), so a roll another device re-creates is never left without one. prune() moves it.
     roomKey  normRoom(name) + '#' + n, n counting same-named rooms in the roll from 1: roomKeys(names). Names repeat within a site.
     slug     a thing's key, slug(name) in room-things.js: a-z0-9 words joined by '-', <= 40. Never a table index. A slug ignores case,
              punctuation, accents and a leading a/an/the/some: "A lamp", "The lamp" and "the LAMP!" are one thing, so a caller merging
              things from two sources (a note and a table: RK13's top-up) dedupes by slug.
     say      which of the table's read-aloud lines, 0 to 9.
     rr       how many times "Reroll the room" was pressed (a whole number, 1 to 999; absent is 0). The room's draw forks its rng with it, so
              a reroll is a fresh draw, not the same one again.
     extra    the slugs Roll another added, each with the ISO time it was added (<= 10).
     swaps    { <slug drawn>: <slug now in its place> } (<= 10). Chains collapse: swapping a for b and then b for c stores { a: c }, and
              swapping c back to a removes the entry.
     marks    { <slug>: <state> }, a state being 1 to 24 characters, lower case (<= 20).
     blade    the Blade tap's answer, the ONE place text is stored: say <= 300, things <= 2 (the thing shape of room-things.js, cut to its
              limits, stored without slug), people <= 3 of { line <= 120, role? (a-z0-9-, <= 24) }; at is when it was set.
     kept     the NPCs Keep filed (<= 12): { <npcId>: { slot, at } }, slot being the room's quick-draw person slot it came from
              (a-z0-9-, <= 24, e.g. 'p1'), so a card shows "Kept" after a reload and one slot is kept once. Ids /^[A-Za-z0-9_-]{1,64}$/.
     Maps, never lists: two GM devices writing the same room at once merge key by key on save (a list would replace whole). Taking an entry
     away writes null for its key, which the page's applyPatch and the server's deepMerge both read as "delete" (the saver's mergePatch
     keeps the null). Only say, rr and the Blade entry replace whole, and the last writer wins those.
     Fields this file does not know (a later build's) are kept: never dropped on a write, and a room or roll holding one is never removed
     as empty. read() hands them back under `other`. So adding a field needs no new v.
   Never rolled text: the draw replays from the seed, rr and the tables; only overrides are stored.
   Caps: 24 rolls (a 25th drops the oldest roll); 40 rooms a roll (a 41st is refused: rooms carry no at); 12 Blade entries a roll (a 13th
   drops the roll's oldest by blade.at); roomstate itself <= 48 KiB (past it the oldest Blade entries anywhere go first, then the oldest
   whole rolls other than the one being written, and only then is the write refused). A room left with nothing in it is removed, and so
   is a roll left with no rooms.

   The API:  RS = B68GmRoomState.create(host)
     host = { on() -> room.key or room.tables is on, doc() -> the GM state, patch(p) -> bool (the page's patch: its local apply and its
              saver), busy() -> the page's saver has something pending or in flight, now() -> ms, part() -> the rooms part's version or '',
              toast?(text, bad) }
     Reads (no write; they work with the settings off too):
       RS.read(rollKey, roomKey) -> { say: n|null, rr: n, extra: [slug], swaps: {}, marks: {}, blade: { at, say, things: [thing+slug],
                                    people: [{ line, role? }] } | null, kept: [{ id, slot }], other: {} }
                                    always that object (empty when nothing is stored), a copy, malformed values left out; extra and kept
                                    read as lists in the order they were added (by their at, then by key)
       RS.roll(rollKey)          -> { part, at, rooms: { <roomKey>: read } } (rooms with something in them) | null
       RS.stale(rollKey)         -> true when the roll is stored and its part is not host.part() (call prune)
     Writes: each is ONE host.patch that touches one rollKey (plus the nulls of anything a cap drops). Each returns true when the stored
     state now holds what was asked (a no-op sends nothing), and false, sending nothing, with the settings off, a bad argument, a cap,
     an unknown v or a refused patch.
       RS.setSay(rollKey, roomKey, n | null)
       RS.setSwap(rollKey, roomKey, slug, toSlug | null)       slug is what shows now; null puts the original back
       RS.setMark(rollKey, roomKey, slug, state | null)        null takes the mark away
       RS.addExtra(rollKey, roomKey, slug)  RS.setExtra(rollKey, roomKey, [slug])   setExtra writes the whole list, each slug
                                                                                    at now plus its place in ms, so it reads in list order
       RS.setBlade(rollKey, roomKey, { say?, things?, people?: [{ line, role? } | line] } | null)
       RS.addKept(rollKey, roomKey, npcId, slot)                false when that slot is already kept (by another id)
       RS.reroll(rollKey, roomKey)                              rr + 1, and say, extra, swaps, marks and the Blade entry go; kept stays
       RS.clear(rollKey, roomKey)                               the room back to its first draw: every field this file knows goes
       RS.clearRoll(rollKey)                                    forget a site's rooms (what the "room notes are full" toast points to)
       RS.prune(partVersion, known, rollKey?) -> { rolls, dropped, note }
           Every stored roll (or just rollKey) whose part is not partVersion: known(rollKey, roomKey) -> [slug] is what that room's things
           are now (its table's and its note's; the room's own Blade things always count); overrides on other slugs are dropped and part
           becomes partVersion, one patch a roll. A roll where known gives anything but an array for a stored room is left as it is. When
           anything was dropped, note is 'tables changed' and host.toast says so (the caller does not toast again).
     Pure: B68GmRoomState.roomKeys(names) -> [roomKey | ''], roomKey(name, n), isSlug(s), clean(rawRoom) (what read gives), CAPS, NOTE, V.
   Two quick writes never lose one: each write reads host.doc() afresh (the page applies a patch at once). While the saver is busy, a room
   or roll removed and then written again carries the nulls of what it held (the saver's merge would otherwise turn "remove R, then set
   R.x" into "set R.x" and bring the old R.y back on the server). That record is emptied whenever the saver is idle, so it never deletes
   what another device wrote after the removal reached the server. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomState = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var V = 1, NOTE = 'tables changed';
  var CAPS = { rolls: 24, rooms: 40, blades: 12, extra: 10, swaps: 10, marks: 20, kept: 12, rr: 999, bytes: 48 * 1024, tomb: 4000 };
  var LIM = { key: 80, part: 64, state: 24, say: 9, bladeSay: 300, bladeThings: 2, bladePeople: 3, person: 120 };
  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, NPC = /^[A-Za-z0-9_-]{1,64}$/, ROOMKEY = /^[^#]*[^#\s][^#]*#[1-9][0-9]?$/, TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;
  var AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
  var ROOM_KNOWN = ['say', 'rr', 'extra', 'swaps', 'marks', 'blade', 'kept'], ROLL_KNOWN = ['part', 'at', 'rooms'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function cut(s, max) {
    s = str(s);
    if (s.length > max) { s = s.slice(0, max); var c = s.charCodeAt(max - 1); if (c >= 0xd800 && c <= 0xdbff) s = s.slice(0, -1); }
    return s.trim();
  }
  function bytes(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return unescape(encodeURIComponent(s)).length; } }
  /* the other two files of the bundle's neighbourhood, read when called, never at load */
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  /* the server's merge (functions/_lib/http.js deepMerge) and the page's merge of two pending patches (gm-page.js mergePatch) */
  function merge(t, p) {
    var out = isObj(t) ? Object.assign({}, t) : {};
    Object.keys(p || {}).forEach(function (k) {
      if (k === '__proto__') return;
      var v = p[k];
      if (v === null || v === undefined) delete out[k]; else if (isObj(v)) out[k] = merge(out[k], v); else out[k] = clone(v);
    });
    return out;
  }
  function combine(a, b) {
    var out = isObj(a) ? clone(a) : {};
    Object.keys(b || {}).forEach(function (k) { var v = b[k]; if (isObj(v) && isObj(out[k])) out[k] = combine(out[k], v); else out[k] = v === undefined ? null : clone(v); });
    return out;
  }
  function nullsOf(o) { var out = {}; Object.keys(o).forEach(function (k) { out[k] = isObj(o[k]) ? nullsOf(o[k]) : null; }); return out; }
  function leaves(o) { var n = 0; Object.keys(o || {}).forEach(function (k) { n += isObj(o[k]) ? leaves(o[k]) : 1; }); return n; }
  function others(o, known) { var out = {}; Object.keys(isObj(o) ? o : {}).forEach(function (k) { if (known.indexOf(k) < 0 && k !== '__proto__') out[k] = clone(o[k]); }); return out; }

  /* ---------- keys and values ---------- */
  function keyOf(k) { if (typeof k === 'number' && isFinite(k)) return String(k); var s = typeof k === 'string' ? k.trim() : ''; return s && s.length <= LIM.key ? s : ''; }
  function isRoomKey(k) { return typeof k === 'string' && k.length <= LIM.key && ROOMKEY.test(k); }
  function isSlug(s) { return typeof s === 'string' && s.length <= 40 && SLUG.test(s); }
  function isNpc(id) { return typeof id === 'string' && NPC.test(id); }
  function isTag(s) { return typeof s === 'string' && TAG.test(s); }
  function stateOf(s) { if (typeof s !== 'string') return null; var t = cut(s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').toLowerCase(), LIM.state); return t || null; }
  function sayOf(n) { return typeof n === 'number' && n % 1 === 0 && n >= 0 && n <= LIM.say ? n : null; }
  function rrOf(n) { return typeof n === 'number' && n % 1 === 0 && n >= 1 && n <= CAPS.rr ? n : 0; }
  function normName(name) { var R = mod('B68GmRooms', './room-notes.js'); return R ? R.normRoom(name) : str(name).toLowerCase().trim(); }
  function roomKey(name, n) { var k = normName(name), i = n == null ? 1 : n; return k && typeof i === 'number' && i % 1 === 0 && i >= 1 && i <= 99 && isRoomKey(k + '#' + i) ? k + '#' + i : ''; }
  function roomKeys(names) {
    var seen = {};
    return (Array.isArray(names) ? names : []).map(function (nm) {
      var k = typeof nm === 'string' ? normName(nm) : ''; if (!k) return '';
      seen[k] = (has(seen, k) ? seen[k] : 0) + 1;
      return roomKey(nm, seen[k]);
    });
  }

  function slugList(v, max) { var out = []; (Array.isArray(v) ? v : []).forEach(function (s) { if (isSlug(s) && out.indexOf(s) < 0 && out.length < max) out.push(s); }); return out; }
  function slugMap(v, max, val) {
    var out = {}, n = 0;
    Object.keys(isObj(v) ? v : {}).forEach(function (k) { var x = val(v[k]); if (k !== '__proto__' && isSlug(k) && x !== null && n < max) { out[k] = x; n++; } });
    return out;
  }
  /* a person of the Blade entry: { line, role? } (a bare string is its line) */
  function personOf(p) {
    var o = typeof p === 'string' ? { line: p } : isObj(p) ? p : null; if (!o) return null;
    var line = cut(str(o.line).replace(/\s+/g, ' '), LIM.person); if (!line) return null;
    var out = { line: line }; if (isTag(o.role)) out.role = o.role;
    return out;
  }
  function people(v) { var out = []; (Array.isArray(v) ? v : []).forEach(function (p) { var x = personOf(p); if (x && out.length < LIM.bladePeople) out.push(x); }); return out; }
  function bladeThings(v) {
    var RT = mod('B68GmRoomThings', './room-things.js'), out = [];
    (Array.isArray(v) ? v : []).forEach(function (t) { var c = RT ? RT.clean(t) : null; if (c && out.length < LIM.bladeThings) out.push(c); });
    return out;
  }
  /* the Blade entry as read: null when it says nothing */
  function bladeOf(b) {
    if (!isObj(b)) return null;
    var say = cut(str(b.say).replace(/\s+/g, ' '), LIM.bladeSay), th = bladeThings(b.things), pp = people(b.people);
    return say || th.length || pp.length ? { at: cut(b.at, 40), say: say, things: th, people: pp } : null;
  }
  /* the Blade entry as stored: every field there, null where empty, so a merge onto any older entry gives exactly this one */
  function bladeStored(b) {
    return b ? { at: b.at || null, say: b.say || null, people: b.people.length ? clone(b.people) : null,
      things: b.things.length ? b.things.map(function (t) { var o = {}; ['name', 'line', 'look', 'roll', 'danger', 'states', 'tags'].forEach(function (k) { o[k] = clone(t[k]); }); return o; }) : null } : null;
  }
  /* { <key>: <ISO at> } (or, with atOf, { <key>: { ..., at } }) in the order added; good keys and times only, at most max (the first added) */
  function byAt(m, atOf) { var a = function (k) { return atOf ? atOf(m[k]) : m[k]; }; return Object.keys(m).sort(function (x, y) { return a(x) < a(y) ? -1 : a(x) > a(y) ? 1 : x < y ? -1 : x > y ? 1 : 0; }); }
  function timeMap(v, max, keyOk) {
    var src = {}, out = {};
    Object.keys(isObj(v) ? v : {}).forEach(function (k) { if (k !== '__proto__' && keyOk(k) && typeof v[k] === 'string' && AT.test(v[k])) src[k] = v[k]; });
    byAt(src).slice(0, max).forEach(function (k) { out[k] = src[k]; });
    return out;
  }
  function keptAt(x) { return x.at; }
  function keptMap(v) {
    var src = {}, out = {}, slots = {};
    Object.keys(isObj(v) ? v : {}).forEach(function (k) { var x = v[k]; if (k !== '__proto__' && isNpc(k) && isObj(x) && isTag(x.slot) && typeof x.at === 'string' && AT.test(x.at)) src[k] = { slot: x.slot, at: x.at }; });
    byAt(src, keptAt).forEach(function (k) { if (!has(slots, src[k].slot) && Object.keys(out).length < CAPS.kept) { slots[src[k].slot] = true; out[k] = src[k]; } });
    return out;
  }
  /* a stored room as this file works on it: maps for extra and kept, and `other` for the fields it does not know */
  function normRoomState(r) {
    r = isObj(r) ? r : {};
    return { say: sayOf(r.say), rr: rrOf(r.rr), extra: timeMap(r.extra, CAPS.extra, isSlug), swaps: slugMap(r.swaps, CAPS.swaps, function (x) { return isSlug(x) ? x : null; }),
      marks: slugMap(r.marks, CAPS.marks, stateOf), blade: bladeOf(r.blade), kept: keptMap(r.kept), other: others(r, ROOM_KNOWN) };
  }
  /* what a caller reads: extra and kept as lists in the order they were added */
  function view(n) {
    return { say: n.say, rr: n.rr, extra: byAt(n.extra), swaps: clone(n.swaps), marks: clone(n.marks), blade: clone(n.blade),
      kept: byAt(n.kept, keptAt).map(function (id) { return { id: id, slot: n.kept[id].slot }; }), other: clone(n.other) };
  }
  function clean(r) { return view(normRoomState(r)); }
  function isEmpty(c) {
    return c.say === null && !c.rr && !Object.keys(c.extra).length && !Object.keys(c.swaps).length && !Object.keys(c.marks).length && !c.blade &&
      !Object.keys(c.kept).length && !Object.keys(c.other).length;
  }
  /* the room patch that takes cur to next (worked rooms): the fields this file knows only, maps key by key, the Blade entry whole */
  function diff(cur, next) {
    var p = {}, n = 0;
    ['say', 'rr'].forEach(function (f) { if (cur[f] !== next[f]) { p[f] = f === 'rr' && !next.rr ? null : next[f]; n++; } });
    ['extra', 'swaps', 'marks', 'kept'].forEach(function (f) {
      var d = {}, m = 0;
      Object.keys(cur[f]).forEach(function (k) { if (!has(next[f], k)) { d[k] = null; m++; } });
      Object.keys(next[f]).forEach(function (k) { if (!same(cur[f][k], next[f][k])) { d[k] = clone(next[f][k]); m++; } });
      if (m) { p[f] = Object.keys(next[f]).length ? d : null; n++; }      /* a map left empty goes whole */
    });
    if (!same(bladeStored(cur.blade), bladeStored(next.blade))) { p.blade = bladeStored(next.blade); n++; }
    return n ? p : null;
  }
  function oldest(list) { return list.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }); }

  function create(host) {
    host = isObj(host) ? host : {};
    var tomb = {}, tombN = 0;
    function on() { try { return !!(host.on && host.on()); } catch (e) { return false; } }
    /* the saver idle: what this page removed has reached the server, so the record of it goes (a host with no busy() keeps it) */
    function settle() { var b = true; try { b = host.busy ? !!host.busy() : true; } catch (e) { b = true; } if (!b) { tomb = {}; tombN = 0; } }
    function stateNow() {
      var d = null; try { d = host.doc ? host.doc() : null; } catch (e) { d = null; }
      var rs = isObj(d) ? d.roomstate : null;
      if (!isObj(rs)) return { ok: true, rs: null, keys: {} };
      return rs.v === V ? { ok: true, rs: rs, keys: isObj(rs.keys) ? rs.keys : {} } : { ok: false, rs: rs, keys: {} };
    }
    function partNow() { try { return cut(host.part ? host.part() : '', LIM.part); } catch (e) { return ''; } }
    function nowIso() { var t = NaN; try { t = host.now ? +host.now() : Date.now(); } catch (e) { /* the clock */ } return new Date(isFinite(t) ? t : Date.now()).toISOString(); }
    function say(text) { try { if (host.toast) host.toast(text, true); } catch (e) { /* no toast */ } }
    function rollIn(keys, rk) { return isObj(keys[rk]) ? keys[rk] : null; }
    function roomsIn(roll) { return roll && isObj(roll.rooms) ? roll.rooms : {}; }
    /* a roll may go once no room in it holds anything and it holds no field this file does not know */
    function rollGoes(roll, rooms, except) {
      return !Object.keys(others(roll, ROLL_KNOWN)).length && Object.keys(rooms).every(function (k) { return except.indexOf(k) >= 0 || isEmpty(normRoomState(rooms[k])); });
    }

    /* while the saver is busy, a removed container written again carries the nulls of what this page removed under it (see the header):
       revive(t, v) is v plus a null for each key t knows that v does not set (a whole container nulled at once, so no empty shell) */
    function revive(t, v) {
      var out = {};
      Object.keys(t).forEach(function (k) { if (!has(v, k)) out[k] = null; });
      Object.keys(v).forEach(function (k) { out[k] = isObj(v[k]) && isObj(t[k]) ? revive(t[k], v[k]) : v[k]; });
      return out;
    }
    function guard(p, before, t) {
      var out = {};
      Object.keys(p).forEach(function (k) {
        var v = p[k];
        if (isObj(v) && isObj(t[k])) out[k] = isObj(before && before[k]) ? guard(v, before[k], t[k]) : revive(t[k], v);
        else out[k] = v;
      });
      return out;
    }
    function record(p, before, t) {
      Object.keys(p).forEach(function (k) {
        var v = p[k], b = isObj(before) ? before[k] : undefined;
        if (v === null) { var add = isObj(b) ? nullsOf(b) : null; tombN += isObj(add) ? leaves(add) : 1; t[k] = isObj(add) ? combine(isObj(t[k]) ? t[k] : {}, add) : (isObj(t[k]) ? t[k] : null); }
        else if (isObj(v)) { if (!isObj(t[k])) t[k] = {}; record(v, isObj(b) ? b : {}, t[k]); }
      });
    }
    /* the one patch: kp is the patch of roomstate.keys; keep is the roll (and room) being written, never dropped to make space */
    function send(st, kp, at, keep) {
      var p = { roomstate: { v: V, at: at, keys: kp } }, after = merge(st.rs, p.roomstate), size = function () { return bytes(JSON.stringify(after)); };
      if (size() > CAPS.bytes) {
        var list = [], rolls = [];
        Object.keys(isObj(after.keys) ? after.keys : {}).forEach(function (rk) {
          var roll = rollIn(after.keys, rk), rooms = roomsIn(roll);
          if (roll && !(keep && keep.rk === rk)) rolls.push({ id: rk, at: str(roll.at) });
          Object.keys(rooms).forEach(function (rm) { var b = bladeOf(isObj(rooms[rm]) ? rooms[rm].blade : null); if (b && !(keep && keep.rk === rk && keep.rm === rm)) list.push({ id: rk + '\u0001' + rm, rk: rk, rm: rm, at: b.at }); });
        });
        oldest(list).forEach(function (e) {
          if (size() <= CAPS.bytes) return;
          var rp = isObj(kp[e.rk]) ? kp[e.rk] : (kp[e.rk] = {}), raw = roomsIn(rollIn(after.keys, e.rk))[e.rm], c = normRoomState(raw);
          c.blade = null;
          if (!isObj(rp.rooms)) rp.rooms = {};
          rp.rooms[e.rm] = isEmpty(c) ? null : combine(isObj(rp.rooms[e.rm]) ? rp.rooms[e.rm] : {}, { blade: null });
          after = merge(st.rs, p.roomstate);
        });
        oldest(rolls).forEach(function (e) { if (size() <= CAPS.bytes) return; kp[e.id] = null; after = merge(st.rs, p.roomstate); });
        if (size() > CAPS.bytes) { say('The room notes are full (' + Math.round(CAPS.bytes / 1024) + ' KiB): clear a room or an old site’s rooms first.'); return false; }
      }
      p.roomstate.keys = guard(kp, st.keys, tomb);
      var ok = false;
      try { ok = !!(host.patch && host.patch(p) !== false); } catch (e) { ok = false; }
      if (ok && tombN < CAPS.tomb) record(p.roomstate.keys, st.keys, tomb);
      return ok;
    }

    /* the write behind every setter: fn(room, at) changes a worked copy of the room, or returns false to refuse */
    function write(rollKey, rmKey, fn) {
      if (!on()) return false;
      var rk = keyOf(rollKey); if (!rk || !isRoomKey(rmKey)) return false;
      var st = stateNow(); if (!st.ok) return false;
      settle();
      var at = nowIso(), roll = rollIn(st.keys, rk), rooms = roomsIn(roll), cur = normRoomState(rooms[rmKey]), next = normRoomState(rooms[rmKey]);
      if (fn(next, at) === false) return false;
      next = normRoomState(Object.assign({}, cur.other, { say: next.say, rr: next.rr, extra: next.extra, swaps: next.swaps, marks: next.marks, blade: next.blade ? bladeStored(next.blade) : null, kept: next.kept }));
      var rp = diff(cur, next); if (!rp) return true;
      var empty = isEmpty(next), live = Object.keys(rooms).filter(function (k) { return k !== rmKey && !isEmpty(normRoomState(rooms[k])); });
      if (!roll && empty) return true;
      if (isEmpty(cur) && !empty && live.length >= CAPS.rooms) { say('A site keeps at most ' + CAPS.rooms + ' rooms of changes.'); return false; }
      var rollP = { part: roll ? str(roll.part) : partNow(), at: at, rooms: {} }, kp = {}, gone = [];
      rollP.rooms[rmKey] = empty ? null : rp;
      if (next.blade && !cur.blade) {
        var bl = oldest(live.filter(function (k) { return !!bladeOf(rooms[k].blade); }).map(function (k) { return { id: k, at: bladeOf(rooms[k].blade).at }; }));
        while (bl.length >= CAPS.blades) { var e = bl.shift(), c = normRoomState(rooms[e.id]); c.blade = null; rollP.rooms[e.id] = isEmpty(c) ? null : { blade: null }; if (isEmpty(c)) gone.push(e.id); }
      }
      kp[rk] = empty && roll && rollGoes(roll, rooms, [rmKey].concat(gone)) ? null : rollP;
      if (!roll) {
        var rolls = oldest(Object.keys(st.keys).filter(function (k) { return k !== rk && isObj(st.keys[k]); }).map(function (k) { return { id: k, at: str(st.keys[k].at) }; }));
        while (rolls.length >= CAPS.rolls) kp[rolls.shift().id] = null;
      }
      return send(st, kp, at, { rk: rk, rm: rmKey });
    }

    function read(rollKey, rmKey) {
      var rk = keyOf(rollKey), st = stateNow(), roll = rk && st.ok ? rollIn(st.keys, rk) : null;
      return clean(roll && typeof rmKey === 'string' && has(roomsIn(roll), rmKey) ? roomsIn(roll)[rmKey] : null);
    }
    function rollOf(rollKey) {
      var rk = keyOf(rollKey), st = stateNow(), roll = rk && st.ok ? rollIn(st.keys, rk) : null; if (!roll) return null;
      var out = { part: str(roll.part), at: str(roll.at), rooms: {} }, rooms = roomsIn(roll);
      Object.keys(rooms).forEach(function (k) { var c = normRoomState(rooms[k]); if (isRoomKey(k) && !isEmpty(c)) out.rooms[k] = view(c); });
      return out;
    }
    function stale(rollKey) { var r = rollOf(rollKey); return !!r && r.part !== partNow(); }
    function clearRoll(rollKey) {
      if (!on()) return false;
      var rk = keyOf(rollKey); if (!rk) return false;
      var st = stateNow(); if (!st.ok) return false;
      settle();
      if (!rollIn(st.keys, rk)) return true;
      var kp = {}; kp[rk] = null;
      return send(st, kp, nowIso(), null);
    }

    function prune(partVersion, known, only) {
      var res = { rolls: 0, dropped: 0, note: '' }, pv = cut(partVersion, LIM.part), ok1 = only == null ? '' : keyOf(only);
      if (!on() || typeof known !== 'function' || (only != null && !ok1)) return res;
      var st0 = stateNow(); if (!st0.ok) return res;
      settle();
      Object.keys(st0.keys).forEach(function (rk) {
        if (ok1 && rk !== ok1) return;
        var st = stateNow(), roll = rollIn(st.keys, rk); if (!roll || str(roll.part) === pv) return;
        var rooms = roomsIn(roll), rp = {}, dropped = 0, left = 0, fine = true;
        Object.keys(rooms).forEach(function (rm) {
          if (!fine) return;
          var live = null; try { live = known(rk, rm); } catch (e) { live = null; }
          if (!Array.isArray(live)) { fine = false; return; }
          var cur = normRoomState(rooms[rm]), next = normRoomState(rooms[rm]);
          var own = cur.blade ? cur.blade.things.map(function (t) { return t.slug; }) : [], inn = function (s) { return live.indexOf(s) >= 0 || own.indexOf(s) >= 0; };
          Object.keys(cur.extra).forEach(function (k) { if (!inn(k)) delete next.extra[k]; });
          Object.keys(cur.swaps).forEach(function (k) { if (!inn(k) || !inn(cur.swaps[k])) delete next.swaps[k]; });
          Object.keys(cur.marks).forEach(function (k) { if (!inn(k)) delete next.marks[k]; });
          dropped += Object.keys(cur.extra).length - Object.keys(next.extra).length + Object.keys(cur.swaps).length - Object.keys(next.swaps).length + Object.keys(cur.marks).length - Object.keys(next.marks).length;
          var d = diff(cur, next);
          if (!isEmpty(next)) left++;
          if (d) rp[rm] = isEmpty(next) ? null : d;
        });
        if (!fine) return;
        var kp = {}; kp[rk] = left || Object.keys(others(roll, ROLL_KNOWN)).length ? { part: pv, rooms: rp } : null;
        if (send(st, kp, nowIso(), null)) { res.rolls++; res.dropped += dropped; }
      });
      if (res.dropped) { res.note = NOTE; say('Room tables changed: ' + res.dropped + ' room change' + (res.dropped === 1 ? '' : 's') + ' for things no longer in them ' + (res.dropped === 1 ? 'was' : 'were') + ' dropped.'); }
      return res;
    }

    function wipe(r, rerolled) { r.say = null; r.extra = {}; r.swaps = {}; r.marks = {}; r.blade = null; if (!rerolled) { r.kept = {}; r.rr = 0; } }
    return {
      on: on, read: read, roll: rollOf, stale: stale, prune: prune, clearRoll: clearRoll,
      setSay: function (rk, rm, n) { if (n !== null && sayOf(n) === null) return false; return write(rk, rm, function (r) { r.say = n; }); },
      setSwap: function (rk, rm, from, to) {
        if (!isSlug(from) || (to !== null && (!isSlug(to) || to === from))) return false;
        return write(rk, rm, function (r) {
          var orig = from; Object.keys(r.swaps).forEach(function (k) { if (r.swaps[k] === from) orig = k; });      /* from shows in place of orig: one entry, never a chain */
          if (to === null || to === orig) { delete r.swaps[orig]; return; }
          if (!has(r.swaps, orig) && Object.keys(r.swaps).length >= CAPS.swaps) return false;
          r.swaps[orig] = to;
        });
      },
      setMark: function (rk, rm, slug, state) {
        var s = state === null ? null : stateOf(state); if (!isSlug(slug) || (state !== null && !s)) return false;
        return write(rk, rm, function (r) { if (s === null) { delete r.marks[slug]; return; } if (!has(r.marks, slug) && Object.keys(r.marks).length >= CAPS.marks) return false; r.marks[slug] = s; });
      },
      addExtra: function (rk, rm, slug) {
        if (!isSlug(slug)) return false;
        return write(rk, rm, function (r, at) { if (has(r.extra, slug)) return; if (Object.keys(r.extra).length >= CAPS.extra) return false; r.extra[slug] = at; });
      },
      setExtra: function (rk, rm, list) {
        if (!Array.isArray(list) || !list.every(isSlug)) return false;
        var l = slugList(list, 99); if (l.length > CAPS.extra) return false;
        return write(rk, rm, function (r, at) { var t = Date.parse(at), m = {}; l.forEach(function (x, i) { m[x] = l.length > 1 || !has(r.extra, x) ? new Date(t + i).toISOString() : r.extra[x]; }); r.extra = m; });
      },
      setBlade: function (rk, rm, entry) {
        if (entry !== null && !isObj(entry)) return false;
        return write(rk, rm, function (r, at) { if (entry === null) { r.blade = null; return; } var b = bladeOf(Object.assign({}, entry, { at: at })); if (!b) return false; r.blade = b; });
      },
      addKept: function (rk, rm, id, slot) {
        if (!isNpc(id) || !isTag(slot)) return false;
        return write(rk, rm, function (r, at) {
          if (has(r.kept, id)) return r.kept[id].slot === slot ? undefined : false;
          if (Object.keys(r.kept).some(function (k) { return r.kept[k].slot === slot; }) || Object.keys(r.kept).length >= CAPS.kept) return false;
          r.kept[id] = { slot: slot, at: at };
        });
      },
      reroll: function (rk, rm) { return write(rk, rm, function (r) { var n = r.rr + 1; if (n > CAPS.rr) return false; wipe(r, true); r.rr = n; }); },
      clear: function (rk, rm) { return write(rk, rm, function (r) { wipe(r, false); }); }
    };
  }

  return { V: V, NOTE: NOTE, CAPS: CAPS, create: create, roomKey: roomKey, roomKeys: roomKeys, isSlug: isSlug, clean: clean };
});
