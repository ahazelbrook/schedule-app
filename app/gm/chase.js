/* gm/chase.js — the Chase panel's logic (C on #gm, GM.md "Chase"), as pure functions: no DOM, no storage, no network, no table
   text. Plain script, UMD: window.B68GmChase in the browser, module.exports under Node.

   A chase is the map kit's chase object (schema "b68-chase/1", map kit 0.6: B68Map.chaseNew / chaseTick / chase). The kit draws
   it; this module builds what the kit is given, reads the clocks back out of it, and works out what the players may see. Drawn in
   play, never ahead: a panel exists only once its segments tick, and one roll that fills k segments is one panel k slots wide.

   The GM state keeps `chase: { current, past: { <id>: chase }, ui: { level, time } }` (GM.md "State"): `current` is the chase
   being played, `past` the ended ones (the last PAST_MAX, and PAST_BYTES at most), `ui` the level and time the next tick takes.

   API
     GROUNDS, SIZES, LEVELS, TIMES, TOKENS, PAST_MAX, PAST_BYTES, SVG_MAX
     source(kind, x, district)   kind 'location' (a location roll), 'scene' (a street-scene roll's `scene`) or 'ground' (a GROUNDS
                                 value) -> { street, district, time, weather, from }. Only the street's public fields: never a room,
                                 the target, a threat, the watcher, a notable or a rumour.
     startArgs(form, src, seed)  the B68Map.chaseNew argument: { name, district, time, weather, street, cast, clocks, seed }
     clocks(chase)               [{ id, name, size, side, strip, hidden, filled, full }]: a strip clock's fill is its panels' ticks
     leg(chase)                  the crew strip clock being played (the first not full), or null
     tickArgs(chase, ui)         the B68Map.chaseTick argument for +n, or { error }: { clock, ticks (clamped to what is left), caption,
                                 roll?, level, time, between? }, plus `clamped` (the ticks asked for) when it cut them
     undo(chase), oppose(chase, d), addLeg(chase, name, size)   NEW chase objects (never mutate)
     endPlan(past, chase, at)    -> { patch (for chase.past), dropped: [names] }
     title(chase), caption(chase), findEntries(chase)
     playerCopy(chase)           what the player copy is drawn from: no roll lines, no `gm` notes, no hidden clock that is not a
                                 strip, a hidden strip clock without its name
     secrets(chase)              the strings the player svg must never hold: roll lines, gm notes, hidden clocks' names (each only
                                 when no player-visible text holds it too) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmChase = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function one(v, n) { return str(v).replace(/\s+/g, ' ').trim().slice(0, n || 200); }
  function arr(v) { return Array.isArray(v) ? v : []; }

  /* the kit's ground kinds (streetparts.js GROUND, plus a bridge: a deck over water), in plain words for the picker */
  var GROUNDS = [
    { value: 'corridor', label: 'A wide road' }, { value: 'lane', label: 'A narrow lane or alley' },
    { value: 'deck', label: 'A raised walkway or flyover' }, { value: 'open', label: 'An open plaza' },
    { value: 'hub', label: 'A roundabout' }, { value: 'covered', label: 'A covered arcade' },
    { value: 'deadend', label: 'A dead end' }, { value: 'waterside', label: 'A canal path' },
    { value: 'bridge', label: 'A bridge over water' }
  ];
  var SIZES = [4, 6, 8];
  var LEVELS = ['above', 'street', 'below'];
  var TIMES = ['Bluetime', 'Night'];
  /* the vehicles and the walker (map kit tokens); B68Map.chaseOptions().tokens wins when the kit has it */
  var TOKENS = ['autopod', 'autocycle', 'suv', 'garbage-truck', 'ambulance', 'watch-car', 'barge', 'canoe', 'walker'];
  var PAST_MAX = 10, PAST_BYTES = 64 * 1024, SVG_MAX = 600 * 1024;

  function timeOf(t) { return /night/i.test(str(t)) ? 'Night' : 'Bluetime'; }
  function groundOk(g) { return GROUNDS.some(function (x) { return x.value === g; }); }

  /* the street a chase runs down, from what the GM has on screen */
  function source(kind, x, district) {
    var o = isObj(x) ? x : {}, street;
    if (kind === 'location') {
      street = { named: one(o.namedStreet, 120), type: one(o.streetType, 120), desc: one(o.streetDesc, 200), props: arr(o.props).map(function (p) { return one(p, 80); }).filter(Boolean).slice(0, 6),
        nearby: arr(o.neighbours).map(function (p) { return one(p, 80); }).filter(Boolean).slice(0, 2), obstacle: one(o.streetObstacle, 120), landmark: one(o.landmark, 120) };
      return { street: tidy(street), district: one(o.district, 80), time: timeOf(o.timeOfDay), weather: one(o.weather, 120), from: 'location' };
    }
    if (kind === 'scene') {
      street = { named: one(o.street, 120), type: one(o.streetType, 120), props: [], nearby: o.neighbour ? [one(o.neighbour, 80)] : [], obstacle: one(o.obstacle, 120), landmark: one(o.landmark, 120) };
      return { street: tidy(street), district: one(district || (isObj(o.d) ? o.d.n : ''), 80), time: timeOf(o.timeOfDay), weather: one(o.weather, 120), from: 'scene' };
    }
    var g = groundOk(x) ? x : 'corridor';
    return { street: { named: '', ground: g, type: '', props: [], nearby: [] }, district: one(district, 80), time: 'Bluetime', weather: '', from: 'ground' };
  }
  /* empty optional fields out (props and nearby stay, as lists) */
  function tidy(s) { var o = {}; Object.keys(s).forEach(function (k) { if (Array.isArray(s[k]) || s[k]) o[k] = s[k]; }); if (!o.props) o.props = []; if (!o.nearby) o.nearby = []; return o; }

  function sizeOf(n) { n = Math.floor(+n); return SIZES.indexOf(n) >= 0 ? n : 6; }
  /* form: { name, clockName, size, opp: 'none'|'shown'|'hidden', oppName, oppSize, crewToken, crewLabel, themToken, themLabel, time? } */
  function startArgs(form, src, seed) {
    var f = isObj(form) ? form : {}, s = isObj(src) ? src : source('ground', 'corridor');
    var clocks = [{ id: 'crew1', name: one(f.clockName, 60) || 'Get away', size: sizeOf(f.size), side: 'crew', strip: true }];
    if (f.opp === 'shown' || f.opp === 'hidden') {
      var oc = { id: 'opp', name: one(f.oppName, 60) || 'They close in', size: sizeOf(f.oppSize), side: 'against', strip: false, filled: 0 };
      if (f.opp === 'hidden') oc.hidden = true;
      clocks.push(oc);
    }
    var cast = [{ id: 'crew', token: f.crewToken ? one(f.crewToken, 40) : 'autopod', label: one(f.crewLabel, 40) || 'The crew', side: 'crew' }];
    if (f.themToken) cast.push({ id: 'them', token: one(f.themToken, 40), label: one(f.themLabel, 40) || 'Pursuit', side: 'against' });
    var out = { name: one(f.name, 80) || 'The chase', district: s.district, time: TIMES.indexOf(f.time) >= 0 ? f.time : s.time, street: clone(s.street), cast: cast, clocks: clocks, seed: (Math.floor(+seed) >>> 0) };
    if (s.weather) out.weather = s.weather;
    return out;
  }

  /* the clocks as they stand: a strip clock is filled by its panels (one panel per roll, k slots wide), any other keeps `filled` */
  function clocks(chase) {
    var c = isObj(chase) ? chase : {}, ps = arr(c.panels);
    return arr(c.clocks).filter(isObj).map(function (k) {
      var size = Math.max(1, Math.min(12, Math.floor(+k.size) || 4)), filled;
      if (k.strip) filled = ps.reduce(function (n, p) { return n + (isObj(p) && p.clock === k.id ? Math.max(0, Math.floor(+p.ticks) || 0) : 0); }, 0);
      else filled = Math.floor(+k.filled) || 0;
      filled = Math.max(0, Math.min(size, filled));
      return { id: str(k.id), name: str(k.name), size: size, side: k.side === 'against' ? 'against' : 'crew', strip: !!k.strip, hidden: !!k.hidden, filled: filled, full: filled >= size };
    });
  }
  function leg(chase) { return clocks(chase).filter(function (k) { return k.strip && k.side === 'crew' && !k.full; })[0] || null; }

  /* ui: { ticks 1-3, caption, roll, level, time, between (lines, one per line) } */
  function tickArgs(chase, ui) {
    var u = isObj(ui) ? ui : {}, l = leg(chase);
    if (!l) return { error: 'Every leg of the chase clock is full. Add a leg, or end the chase.' };
    var want = Math.max(1, Math.min(3, Math.floor(+u.ticks) || 1)), left = l.size - l.filled, n = Math.min(want, left);
    var out = { clock: l.id, ticks: n, caption: one(u.caption, 160), level: LEVELS.indexOf(u.level) >= 0 ? u.level : 'street', time: TIMES.indexOf(u.time) >= 0 ? u.time : timeOf(chase && chase.time) };
    var roll = one(u.roll, 160); if (roll) out.roll = roll;
    var between = str(u.between).split(/\n+/).map(function (x) { return one(x, 160); }).filter(Boolean).slice(0, 6); if (between.length) out.between = between;
    if (n < want) out.clamped = want;
    return out;
  }
  function undo(chase) { var c = clone(chase); if (c && Array.isArray(c.panels) && c.panels.length) c.panels.pop(); return c; }
  /* the opposing clock (the first against clock that is not a strip) one up or down */
  function oppose(chase, d) {
    var c = clone(chase); if (!c) return c;
    var k = arr(c.clocks).filter(function (x) { return isObj(x) && x.side === 'against' && !x.strip; })[0]; if (!k) return c;
    var size = Math.max(1, Math.floor(+k.size) || 4);
    k.filled = Math.max(0, Math.min(size, (Math.floor(+k.filled) || 0) + (d < 0 ? -1 : 1)));
    return c;
  }
  function opposing(chase) { return clocks(chase).filter(function (k) { return k.side === 'against' && !k.strip; })[0] || null; }
  /* a second (third...) leg of the crew's clock: "Land the barge 4" */
  function addLeg(chase, name, size) {
    var c = clone(chase); if (!c) return c;
    c.clocks = arr(c.clocks);
    var n = 1; while (c.clocks.some(function (k) { return isObj(k) && k.id === 'crew' + n; })) n++;
    c.clocks.push({ id: 'crew' + n, name: one(name, 60) || 'Leg ' + n, size: sizeOf(size), side: 'crew', strip: true });
    return c;
  }

  function bytesOf(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return unescape(encodeURIComponent(s)).length; } }
  /* the ended chase goes into `past` (stamped `endedAt`); past PAST_MAX, or PAST_BYTES as JSON, the oldest go */
  function endPlan(past, chase, at) {
    var p = isObj(past) ? past : {}, id = str(chase && chase.id) || 'chase', entry = Object.assign(clone(chase) || {}, { endedAt: str(at) });
    var all = Object.keys(p).filter(function (k) { return isObj(p[k]) && k !== id; }).map(function (k) { return { k: k, at: str(p[k].endedAt), v: p[k] }; });
    all.push({ k: id, at: entry.endedAt, v: entry });
    all.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : a.k < b.k ? 1 : -1; });   /* newest first */
    var keep = [], dropped = [], total = 0;
    all.forEach(function (e) {
      var b = bytesOf(JSON.stringify(e.v)) + e.k.length + 6;
      if (e.k === id || (keep.length < PAST_MAX && total + b <= PAST_BYTES)) { keep.push(e.k); total += b; }
      else dropped.push(e);
    });
    var patch = {}; patch[id] = entry;
    dropped.forEach(function (e) { patch[e.k] = null; });
    return { patch: patch, dropped: dropped.map(function (e) { return str(e.v.name) || e.k; }) };
  }

  function title(chase) { return one(chase && chase.name, 120) || 'The chase'; }
  /* the caption under the iPad's picture: the district and the visible legs as they stand (never a hidden clock) */
  function caption(chase) {
    var legs = clocks(chase).filter(function (k) { return k.strip && !k.hidden; }).map(function (k) { return k.name + ' ' + k.filled + '/' + k.size; });
    return [one(chase && chase.district, 80), legs.join(' · ')].filter(Boolean).join(' · ');
  }
  /* Find: the current chase's panels, by caption */
  function findEntries(chase) {
    var names = {}; clocks(chase).forEach(function (k) { names[k.id] = k.name; });
    return arr(chase && chase.panels).map(function (p, i) {
      return isObj(p) && str(p.caption).trim() ? { kind: 'Chase', title: str(p.caption), sub: 'Panel ' + (i + 1) + ' · ' + (names[p.clock] || '') + ' +' + (Math.floor(+p.ticks) || 0), text: arr(p.between).join(' ') } : null;
    }).filter(Boolean);
  }

  /* what the player copy is drawn from: the table saw the captions, the between lines and the legs; never a roll line, a gm note or a
     hidden opposing clock. A hidden strip clock keeps its panels (the kit draws them with no empty slots and no count) but no name. */
  function playerCopy(chase) {
    var c = clone(chase); if (!isObj(c)) return c;
    delete c.gm;
    c.clocks = arr(c.clocks).filter(function (k) { return isObj(k) && !(k.hidden && !k.strip); }).map(function (k) { if (k.hidden) { k.name = ''; delete k.history; } return k; });
    c.panels = arr(c.panels).map(function (p) { if (isObj(p)) { delete p.roll; delete p.gm; } return p; });
    return c;
  }
  /* the strings the player svg must never hold, lower case, whitespace collapsed (each only when nothing the players may see holds it) */
  function norm(s) { return str(s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function secrets(chase) {
    var c = isObj(chase) ? chase : {}, open = [], out = [];
    open.push(c.name, c.district, c.weather, c.time);
    if (isObj(c.street)) Object.keys(c.street).forEach(function (k) { open = open.concat(c.street[k]); });
    arr(c.prelude).forEach(function (x) { open.push(x); });
    arr(c.cast).forEach(function (x) { if (isObj(x)) open.push(x.label); });
    arr(c.clocks).forEach(function (k) { if (isObj(k) && !k.hidden) open.push(k.name); });
    arr(c.panels).forEach(function (p) { if (isObj(p)) { open.push(p.caption); arr(p.between).forEach(function (b) { open.push(b); }); } });
    var visible = ' ' + open.map(norm).join(' | ') + ' ';
    function add(s) { s = norm(s); if (s.length >= 4 && visible.indexOf(s) < 0 && out.indexOf(s) < 0) out.push(s); }
    arr(c.clocks).forEach(function (k) { if (isObj(k) && k.hidden) add(k.name); });
    arr(c.panels).forEach(function (p) { if (isObj(p)) { add(p.roll); add(p.gm); } });
    add(c.gm);
    return out;
  }

  return {
    GROUNDS: GROUNDS, SIZES: SIZES, LEVELS: LEVELS, TIMES: TIMES, TOKENS: TOKENS, PAST_MAX: PAST_MAX, PAST_BYTES: PAST_BYTES, SVG_MAX: SVG_MAX,
    source: source, startArgs: startArgs, clocks: clocks, leg: leg, opposing: opposing, tickArgs: tickArgs, undo: undo, oppose: oppose, addLeg: addLeg,
    endPlan: endPlan, title: title, caption: caption, findEntries: findEntries, playerCopy: playerCopy, secrets: secrets, bytesOf: bytesOf
  };
});
