/* B68GmBall — a site's "play" block: its timeline, routes and disguises.
 *
 * Pure logic. No DOM, no storage, no network. The block is authored in the vault inside a site's `b68-site` JSON
 * (key `play`), carried in the location part's `authored.sites[name].play` (scripts/lib/authored-export.mjs), and
 * read by the GM page only. It never reaches the iPad.
 *
 * Load: <script src="gm/ball.js"> exposes window.B68GmBall; in Node, require() returns the same object.
 *
 * checkPlay(play, roomNames) -> { play, warnings }
 *   play        the raw block, or anything else
 *   roomNames   the site's room names (an array, or an object whose keys are room names)
 *   Returns the block with everything that fails dropped, and one warning per drop. `play` is null when the block as a
 *   whole is unusable (not an object, `v` is not 1, or no valid `clock`). The input is never mutated. Keys this module
 *   does not know are carried through untouched (top level and per item), and are not warned about.
 *
 *   clock      { start: "HH:MM", end: "HH:MM", step?: whole minutes (15), label?: string }
 *   floors     { "<level number>": "<name>" }  names only: the map kit decides which floor a room sits on
 *   routes     [{ id, from, to, via?, dir?: both|up|down (both), who?, needs?, watched? }]   from/to must be rooms
 *   people     [{ id, label, kind: target|guard|staff|rival|ally|contact, npc?, note?, stops?, with? }]
 *                stops [{ at: "HH:MM", room, note? }]  sorted by minutes from clock.start, so 00:15 follows 23:30
 *                with   the id of another person whose stops this one follows. A person with both keeps both.
 *   disguises  [{ id, label, floors: [level numbers], rooms?: [room], never?: [room], sees?: string }]
 *                `sees` is free text in the vault today (a role or a name), carried as written.
 *   events     [{ at: "HH:MM", id, label, room?, fx? }]
 *   clocks     [{ name, room? }]
 *
 * minuteOf(hhmm, start) -> whole minutes after `start`, wrapping past midnight (a time before `start` is the next
 *   morning); NaN when either is not HH:MM.
 *
 * play v2 (design 5.5, 5.6): checkPlay accepts v === 2 and validates every v2 key; the v2 engine (whereAt with { over },
 * positionOf, lookers, routesAt, leadsInReach, beatCard, playerView, missionFor and the helpers beatOf, timeLabel, inMin) is
 * documented above `checkPlayV2`'s sibling block, "play v2". Times there are minutes after clock.start (ball.t's unit).
 *
 * The live view (pure, read by the GM page only): whereAt(person, minute, byId, start), lensRating(room, disguise, floorOf),
 * seesMatches(sees, person) and ballView(play, state, floorOf). Each is documented where it is defined.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.B68GmBall = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KINDS = ["target", "guard", "staff", "rival", "ally", "contact"];
  var DIRS = ["both", "up", "down"];
  var LIMITS = { people: 60, stops: 40, routes: 40, disguises: 24, events: 40, clocks: 24, floors: 12, rooms: 40, text: 400,
    /* v2 only */ zones: 16, items: 24, ways: 12, intel: 40, steps: 6, entries: 24, exits: 24, secret: 40, windows: 8, alarm: 12 };
  var TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

  /* id-keyed maps: a null-prototype dict for sets we build, own() to read a map we were handed, put() to write an output
   * key that may be "__proto__". An id of "constructor", "toString" or "__proto__" is then just an id. */
  var dict = function () { return Object.create(null); };
  var own = function (o, k) { return o !== null && typeof o === "object" && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; };
  var put = function (o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); return v; };
  var isObj = function (v) { return !!v && typeof v === "object" && !Array.isArray(v); };
  var isStr = function (v) { return typeof v === "string" && v.trim() !== ""; };
  var copy = function (o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; };
  var clipText = function (s) { return String(s).slice(0, LIMITS.text); };

  function mins(hhmm) {
    var m = TIME_RE.exec(typeof hhmm === "string" ? hhmm.trim() : "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }
  function minuteOf(hhmm, start) {
    var t = mins(hhmm), s = mins(start);
    if (isNaN(t) || isNaN(s)) return NaN;
    return t >= s ? t - s : t + 1440 - s;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(s) { var m = mins(s); return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }

  function checkPlay(play, roomNames) {
    var warnings = [];
    var warn = function (m) { warnings.push(m); };
    var rooms = {};
    (Array.isArray(roomNames) ? roomNames : isObj(roomNames) ? Object.keys(roomNames) : []).forEach(function (n) { rooms[String(n)] = 1; });
    var hasRoom = function (n) { return typeof n === "string" && rooms[n] === 1; };

    if (!isObj(play)) { warn("play: not an object; dropped"); return { play: null, warnings: warnings }; }
    if (play.v === 2) return checkPlayV2(play, roomNames);
    if (play.v !== 1) { warn("play: v is " + JSON.stringify(play.v) + ", not 1; the whole block is dropped"); return { play: null, warnings: warnings }; }
    var c = play.clock;
    if (!isObj(c) || isNaN(mins(c.start)) || isNaN(mins(c.end))) {
      warn("play: clock needs start and end as HH:MM; the whole block is dropped");
      return { play: null, warnings: warnings };
    }
    var out = copy(play);
    var clock = copy(c);
    clock.start = hhmm(c.start); clock.end = hhmm(c.end);
    if (c.step === undefined) clock.step = 15;
    else if (!Number.isInteger(c.step) || c.step < 1 || c.step > 240) { warn("play: clock.step " + JSON.stringify(c.step) + " is not a whole number of minutes (1 to 240); using 15"); clock.step = 15; }
    if (c.label !== undefined && typeof c.label !== "string") { warn("play: clock.label is not text; dropped"); delete clock.label; }
    out.clock = clock;
    var start = clock.start;
    var span = minuteOf(clock.end, start);
    var inWindow = function (t) { return minuteOf(t, start) <= span; };

    /* a list-valued key: absent is empty; present but not an array is dropped with a warning */
    function list(key, max) {
      var v = play[key];
      if (v === undefined) return [];
      if (!Array.isArray(v)) { warn("play." + key + ": not a list; dropped"); return []; }
      if (v.length > max) { warn("play." + key + ": " + v.length + " entries, keeping the first " + max); return v.slice(0, max); }
      return v;
    }
    function ids(label, arr) {
      var seen = {};
      return arr.filter(function (x, i) {
        var where = "play." + label + "[" + i + "]";
        if (!isObj(x)) { warn(where + ": not an object; dropped"); return false; }
        if (!isStr(x.id)) { warn(where + ": no id; dropped"); return false; }
        if (seen[x.id]) { warn(where + ": id " + x.id + " is used twice; the later one is dropped"); return false; }
        seen[x.id] = 1; return true;
      });
    }
    function roomList(where, v) {
      if (v === undefined) return undefined;
      if (!Array.isArray(v)) { warn(where + ": not a list; dropped"); return undefined; }
      return v.filter(function (n) {
        if (hasRoom(n)) return true;
        warn(where + ": room " + JSON.stringify(n) + " is not in the site; dropped"); return false;
      });
    }

    /* floors */
    if (play.floors !== undefined) {
      if (!isObj(play.floors)) { warn("play.floors: not an object; dropped"); delete out.floors; }
      else {
        var fl = {}, fk = Object.keys(play.floors);
        if (fk.length > LIMITS.floors) warn("play.floors: " + fk.length + " levels, keeping the first " + LIMITS.floors);
        fk.slice(0, LIMITS.floors).forEach(function (k) {
          if (!/^-?\d{1,2}$/.test(k) || !isStr(play.floors[k])) warn("play.floors[" + JSON.stringify(k) + "]: needs a level number and a name; dropped");
          else fl[k] = clipText(play.floors[k]);
        });
        out.floors = fl;
      }
    }

    /* routes */
    out.routes = ids("routes", list("routes", LIMITS.routes)).filter(function (r) {
      var where = "play.routes[" + r.id + "]";
      if (!hasRoom(r.from) || !hasRoom(r.to)) { warn(where + ": " + (!hasRoom(r.from) ? "from " : "to ") + JSON.stringify(!hasRoom(r.from) ? r.from : r.to) + " is not a room in the site; dropped"); return false; }
      if (r.dir !== undefined && DIRS.indexOf(r.dir) < 0) { warn(where + ": dir " + JSON.stringify(r.dir) + " is not both, up or down; dropped"); return false; }
      return true;
    }).map(function (r) { var o = copy(r); if (o.dir === undefined) o.dir = "both"; return o; });

    /* people */
    var rawPeople = ids("people", list("people", LIMITS.people));
    var people = rawPeople.filter(function (p) {
      var where = "play.people[" + p.id + "]";
      if (!isStr(p.label)) { warn(where + ": no label; dropped"); return false; }
      if (KINDS.indexOf(p.kind) < 0) { warn(where + ": kind " + JSON.stringify(p.kind) + " is not " + KINDS.join(", ") + "; dropped"); return false; }
      return true;
    }).map(function (p) {
      var where = "play.people[" + p.id + "]", o = copy(p);
      if (p.stops !== undefined) {
        if (!Array.isArray(p.stops)) { warn(where + ".stops: not a list; dropped"); o.stops = []; }
        else {
          if (p.stops.length > LIMITS.stops) warn(where + ".stops: " + p.stops.length + " stops, keeping the first " + LIMITS.stops);
          var stops = [];
          p.stops.slice(0, LIMITS.stops).forEach(function (s, i) {
            var at = where + ".stops[" + i + "]";
            if (!isObj(s)) { warn(at + ": not an object; dropped"); return; }
            if (isNaN(mins(s.at))) { warn(at + ": time " + JSON.stringify(s.at) + " is not HH:MM; dropped"); return; }
            if (!hasRoom(s.room)) { warn(at + ": room " + JSON.stringify(s.room) + " is not in the site; dropped"); return; }
            var r = copy(s); r.at = hhmm(s.at);
            if (!inWindow(r.at)) warn(at + ": " + r.at + " is outside the clock (" + start + " to " + clock.end + "), so it reads as the next morning; kept");
            stops.push(r);
          });
          stops.sort(function (a, b) { return minuteOf(a.at, start) - minuteOf(b.at, start); });
          o.stops = stops;
        }
      }
      return o;
    });
    /* with: the id of another surviving person; no self, no unknown id, no loop */
    var byId = {};
    people.forEach(function (p) { byId[p.id] = p; });
    var changed = true;
    while (changed) {
      changed = false;
      people = people.filter(function (p) {
        var where = "play.people[" + p.id + "]";
        if (p.with !== undefined) {
          if (!isStr(p.with)) { warn(where + ": with is not an id; person dropped"); delete byId[p.id]; changed = true; return false; }
          if (p.with === p.id) { warn(where + ": follows itself; person dropped"); delete byId[p.id]; changed = true; return false; }
          if (!byId[p.with]) { warn(where + ": with " + JSON.stringify(p.with) + " is not a person in the play; person dropped"); delete byId[p.id]; changed = true; return false; }
          var seen = {}, q = p;
          while (q && q.with !== undefined && !seen[q.id]) { seen[q.id] = 1; q = byId[q.with]; }
          if (q && seen[q.id]) { warn(where + ": with " + JSON.stringify(p.with) + " leads back to itself; person dropped"); delete byId[p.id]; changed = true; return false; }
        } else if (!p.stops || !p.stops.length) {
          warn(where + ": no stops and no with, so nowhere to be; person dropped"); delete byId[p.id]; changed = true; return false;
        }
        return true;
      });
    }
    out.people = people;

    /* disguises */
    out.disguises = ids("disguises", list("disguises", LIMITS.disguises)).filter(function (d) {
      var where = "play.disguises[" + d.id + "]";
      if (!isStr(d.label)) { warn(where + ": no label; dropped"); return false; }
      if (!Array.isArray(d.floors) || !d.floors.length || !d.floors.every(Number.isInteger)) { warn(where + ": floors must be a list of level numbers; dropped"); return false; }
      if (d.sees !== undefined && typeof d.sees !== "string") { warn(where + ": sees is not text; dropped"); return false; }
      return true;
    }).map(function (d) {
      var where = "play.disguises[" + d.id + "]", o = copy(d);
      ["rooms", "never"].forEach(function (k) {
        var l = roomList(where + "." + k, d[k]);
        if (l === undefined) delete o[k]; else o[k] = l;
      });
      return o;
    });

    /* events */
    out.events = ids("events", list("events", LIMITS.events)).filter(function (e) {
      var where = "play.events[" + e.id + "]";
      if (isNaN(mins(e.at))) { warn(where + ": time " + JSON.stringify(e.at) + " is not HH:MM; dropped"); return false; }
      if (!isStr(e.label)) { warn(where + ": no label; dropped"); return false; }
      if (e.room !== undefined && !hasRoom(e.room)) { warn(where + ": room " + JSON.stringify(e.room) + " is not in the site; dropped"); return false; }
      return true;
    }).map(function (e) {
      var o = copy(e); o.at = hhmm(e.at);
      if (!inWindow(o.at)) warn("play.events[" + e.id + "]: " + o.at + " is outside the clock (" + start + " to " + clock.end + "), so it reads as the next morning; kept");
      return o;
    });
    out.events.sort(function (a, b) { return minuteOf(a.at, start) - minuteOf(b.at, start); });

    /* clocks (the table clocks pinned to a room) */
    out.clocks = list("clocks", LIMITS.clocks).filter(function (k, i) {
      var where = "play.clocks[" + i + "]";
      if (!isObj(k) || !isStr(k.name)) { warn(where + ": no name; dropped"); return false; }
      if (k.room !== undefined && !hasRoom(k.room)) { warn(where + " (" + k.name + "): room " + JSON.stringify(k.room) + " is not in the site; dropped"); return false; }
      return true;
    }).map(copy);

    return { play: out, warnings: warnings };
  }

  /* counts for the pack's summary line: people, stops (each person's own), routes, disguises, events, clocks */
  function countPlay(play) {
    var p = isObj(play) ? play : {}, n = function (k) { return Array.isArray(p[k]) ? p[k].length : 0; };
    var stops = (Array.isArray(p.people) ? p.people : []).reduce(function (a, x) { return a + (isObj(x) && Array.isArray(x.stops) ? x.stops.length : 0); }, 0);
    return { people: n("people"), stops: stops, routes: n("routes"), disguises: n("disguises"), events: n("events"), clocks: n("clocks") };
  }

  /* ---- live view: the pure helpers behind "Run the site" ---------------------------------------------------- */

  var MOVING_WITHIN = 5;   /* minutes before a stop that a person shows as moving towards it */

  /* A person's stops as [{ t, room, note }] with t in minutes from `start`, sorted. */
  function stopsOf(person, start) {
    var out = [];
    (isObj(person) && Array.isArray(person.stops) ? person.stops : []).forEach(function (s) {
      var t = isObj(s) ? minuteOf(s.at, start) : NaN;
      if (!isNaN(t) && typeof s.room === "string") out.push({ t: t, room: s.room, note: typeof s.note === "string" ? s.note : "" });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  /* whereAt(person, minute, byId, start) -> { room, note, moving: { to, inMin } | null }, or null when the person is
   * nowhere yet. `minute` is minutes from `start` (clock.start, "HH:MM"). `start` is a fourth argument because a stop's
   * `at` is a clock time and cannot become a minute without it. byId maps person id -> person (for `with`).
   *
   * Rules, in order:
   *  1. Own stops: the latest stop at or before `minute` is active, and the person stays there until the next one (the
   *     last stop holds to the end of the night). A stop exactly at `minute` is active, not "moving".
   *  2. Otherwise (no own stops, or none has begun yet) the person follows `with`, taking the leader's room, note and
   *     moving, but with the person's own `note` (never the leader's), and moving towards the person's own coming stop
   *     when that is the nearer news. CHOICE TO CONFIRM: a person with both own stops and `with` follows `with` before their first own stop,
   *     then obeys their own stops from the first one on, and does NOT go back to following after their last own stop.
   *  3. Moving: 1 to 5 minutes before the next own stop, in a different room from the current one, the person is shown
   *     in their current room, moving { to: next room, inMin: minutes until it }. */
  function whereAt(person, minute, byId, start, depth) {
    if (isObj(depth)) return whereAtV2(person, minute, byId, start, depth.over, 0);   /* v2: the fifth argument is { over } */
    if (!isObj(person) || typeof minute !== "number" || isNaN(minute)) return null;
    var stops = stopsOf(person, start), cur = null, next = null;
    for (var i = 0; i < stops.length; i++) { if (stops[i].t <= minute) cur = stops[i]; else { next = stops[i]; break; } }
    if (cur) {
      var mv = null;
      if (next && next.t - minute <= MOVING_WITHIN && next.room !== cur.room) mv = { to: next.room, inMin: next.t - minute };
      return { room: cur.room, note: cur.note || nameOf(person.note), moving: mv };
    }
    if (typeof person.with === "string" && isObj(byId) && isObj(byId[person.with]) && (depth || 0) < 20) {
      var lead = whereAt(byId[person.with], minute, byId, start, (depth || 0) + 1);
      if (lead) {
        /* the follower's own note, never the leader's; their own coming stop beats the leader's moving */
        var own = next || (stops.length ? stops[0] : null), fm = lead.moving;
        if (own && own.t > minute && own.t - minute <= MOVING_WITHIN && own.room !== lead.room) fm = { to: own.room, inMin: own.t - minute };
        return { room: lead.room, note: nameOf(person.note), moving: fm };
      }
    }
    return null;
  }

  /* lensRating(room, disguise, floorOf) -> "controlled" | "risky" | "desperate" | "unknown"
   * The Hitman rule: a room on one of the disguise's home floors is controlled, one floor off is risky, further is
   * desperate. `never` (desperate) and `rooms` (controlled) override the floors by name, `never` first. A room with no
   * entry in floorOf, and no override, is "unknown": never a guess. Levels are compared as numbers. */
  function lensRating(room, disguise, floorOf) {
    if (!isObj(disguise)) return "unknown";
    if (Array.isArray(disguise.never) && disguise.never.indexOf(room) >= 0) return "desperate";
    if (Array.isArray(disguise.rooms) && disguise.rooms.indexOf(room) >= 0) return "controlled";
    var lvl = isObj(floorOf) && Object.prototype.hasOwnProperty.call(floorOf, room) ? Number(floorOf[room]) : NaN;
    var homes = (Array.isArray(disguise.floors) ? disguise.floors : []).map(Number).filter(function (n) { return !isNaN(n); });
    if (isNaN(lvl) || !homes.length) return "unknown";
    var d = Math.min.apply(null, homes.map(function (h) { return Math.abs(h - lvl); }));
    return d === 0 ? "controlled" : d === 1 ? "risky" : "desperate";
  }

  /* seesMatches(sees, person) -> bool. A disguise's `sees` is free text ("a role or a name"). It matches a person when,
   * after lower-casing, stripping accents and punctuation, collapsing spaces and dropping a leading "the ", it equals the
   * person's id or their label, or the person's label contains it as a whole word (or run of whole words). "nobody" and
   * "" match no one. "orter" does not match "Reporters". Letters that do not decompose (o with a stroke) stay letters. */
  function norm(s) {
    var t = String(s == null ? "" : s).toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return t.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^the( |$)/, "").trim();
  }
  function seesMatches(sees, person) {
    var s = norm(sees);
    if (!s || s === "nobody" || !isObj(person)) return false;
    var id = norm(person.id), label = norm(person.label);
    if (s === id || s === label) return true;
    return label !== "" && (" " + label + " ").indexOf(" " + s + " ") >= 0;
  }

  function nameOf(o) { return typeof o === "string" ? o : ""; }

  /* ballView(play, state, floorOf) -> the view model (design 4.5), or null when there is no usable play.
   *   play     a checked block (checkPlay's .play)
   *   state    the `ball` object of the GM state doc; any part may be missing: { t, lens, crew, open, pins }
   *   floorOf  room name -> level number, from B68Map.floors(roll)
   * rooms has an entry for every room in floorOf plus every room the play, crew, open and pins name; lvl is null for
   * one with no floor. `pinned` lists the keys of state.pins only (the page owns clock ids). `lens` is null when no
   * disguise is chosen (or the id is unknown). `next` is the next three things after t, events and the target's stops
   * (its "windows"), across midnight; at the same minute an event comes before a window, then by id. Pure: nothing in
   * the arguments is changed. */
  function ballView(play, state, floorOf) {
    if (!isObj(play) || !isObj(play.clock)) return null;
    var st = isObj(state) ? state : {}, fl = isObj(floorOf) ? floorOf : {}, start = play.clock.start;
    var t = typeof st.t === "number" && isFinite(st.t) ? Math.max(0, Math.round(st.t)) : 0;
    var all = (Array.isArray(play.people) ? play.people : []).filter(isObj), byId = {};
    all.forEach(function (p) { byId[p.id] = p; });
    var s0 = mins(start);
    var clockLabel = function (m) { var x = (s0 + m) % 1440; return pad(Math.floor(x / 60)) + ":" + pad(x % 60); };
    var disguise = null;
    (Array.isArray(play.disguises) ? play.disguises : []).forEach(function (d) { if (isObj(d) && d.id === st.lens) disguise = d; });

    var rooms = {};
    function room(n) {
      if (typeof n !== "string" || n === "") return null;
      if (!rooms[n]) rooms[n] = { lvl: Object.prototype.hasOwnProperty.call(fl, n) && !isNaN(Number(fl[n])) ? Number(fl[n]) : null, people: [], crew: [], pinned: [], lens: null, open: false };
      return rooms[n];
    }
    Object.keys(fl).forEach(room);
    var views = all.map(function (p) {
      var w = whereAt(p, t, byId, start), r = w ? room(w.room) : null;
      if (r) r.people.push(p.id);
      return { id: p.id, label: nameOf(p.label), kind: p.kind, room: w ? w.room : null, note: w ? w.note : "", moving: w ? w.moving : null };
    });
    var crew = isObj(st.crew) ? st.crew : {};
    Object.keys(crew).forEach(function (id) { var r = room(crew[id]); if (r) r.crew.push(id); });
    (Array.isArray(st.open) ? st.open : []).forEach(function (n) { var r = room(n); if (r) r.open = true; });
    var pins = isObj(st.pins) ? st.pins : {};
    Object.keys(pins).forEach(function (id) { var r = room(pins[id]); if (r) r.pinned.push(id); });
    (Array.isArray(play.routes) ? play.routes : []).forEach(function (r) { if (isObj(r)) { room(r.from); room(r.to); } });
    (Array.isArray(play.events) ? play.events : []).forEach(function (e) { if (isObj(e)) room(e.room); });
    if (disguise) {
      Object.keys(rooms).forEach(function (n) {
        var here = views.filter(function (v) { return v.room === n; });
        rooms[n].lens = {
          pos: lensRating(n, disguise, fl),
          danger: here.some(function (v) { return seesMatches(disguise.sees, byId[v.id]); })
        };
      });
    }

    var cand = [];
    (Array.isArray(play.events) ? play.events : []).forEach(function (e) {
      if (isObj(e)) cand.push({ m: minuteOf(e.at, start), rank: 0, key: nameOf(e.id), out: e.fx ? { at: e.at, label: nameOf(e.label), room: e.room || null, fx: e.fx } : { at: e.at, label: nameOf(e.label), room: e.room || null } });
    });
    all.forEach(function (p) {
      if (p.kind !== "target") return;
      stopsOf(p, start).forEach(function (s, i) {
        cand.push({ m: s.t, rank: 1, key: nameOf(p.id) + ":" + (i < 10 ? "0" : "") + i, out: { at: clockLabel(s.t), label: s.note || nameOf(p.label), room: s.room } });
      });
    });
    var next = cand.filter(function (c) { return !isNaN(c.m) && c.m > t; })
      .sort(function (a, b) { return a.m - b.m || a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); })
      .slice(0, 3).map(function (c) { return c.out; });

    var routes = (Array.isArray(play.routes) ? play.routes : []).filter(isObj).map(function (r) {
      var o = { id: r.id, from: r.from, to: r.to, via: r.via, dir: r.dir || "both" };
      if (r.watched !== undefined) o.watched = r.watched;
      if (r.needs !== undefined) o.needs = r.needs;
      return o;
    });
    return { minute: t, label: clockLabel(t), people: views, rooms: rooms, next: next, routes: routes };
  }

  /* ==== play v2 (design 5.5 and 5.6) =================================================================================
   * Every time below is "minutes from clock.start" (a whole number), the unit of ball.t. A time string is HH:MM.
   * Nothing here touches the DOM, storage or the network, and no argument is mutated.
   *
   * checkPlay(play, roomNames) with play.v === 2 validates every key (see checkPlayV2). v1 is untouched.
   * whereAt(person, minute, byId, start, { over }) is whereAt for v2: stops are { at, room, note? } | { at, with } |
   *   { at, gone: true }; `over` is ball.over (person id -> { delay, from, skip, at, gone, ... }).
   * placesAt(play, state, t) -> { <person id>: whereAt result or null }
   * positionOf(play, state, pcId) -> { pos: "controlled"|"risky"|"desperate", why: "reason; reason" }
   * lookers(play, state, pcId, t) -> { here: [looker], soon: [looker + { at, inMin }] }; looker = { id, label, look, wary }
   * routesAt(play, t) -> [route]
   * leadsInReach(play, state, t) -> [{ way, pc, line, who, room, name }]
   * beatCard(play, state, t0, t1) -> { t0, t1, back, items: [{ type, ... }] }
   * playerView(play, state, openRooms) -> the filtered copy; missionFor(view, state, t, pcs) -> the mission
   * beatOf(src, t) -> { n, of, i };  timeLabel(src, t) -> "HH:MM";  inMin(now, at) -> minutes until, at least 0
   * (src is a play, a view, a clock, or the clock.start string.)
   */
  var VIS = ["public", "seen", "hidden"], WAY_KINDS = ["loud", "quiet", "either"], LIFT_TO = ["risky", "controlled"];
  var STARTS = ["crit", "6", "4/5", "1-3"], ALARM_VERBS = ["skip-private", "lockdown"];
  var POS = ["desperate", "risky", "controlled"];

  function checkPlayV2(play, roomNames) {
    var warnings = [];
    var warn = function (m) { warnings.push(m); };
    var rooms = dict();
    (Array.isArray(roomNames) ? roomNames : isObj(roomNames) ? Object.keys(roomNames) : []).forEach(function (n) { rooms[String(n)] = 1; });
    var hasRoom = function (n) { return typeof n === "string" && rooms[n] === 1; };

    var c = play.clock;
    if (!isObj(c) || isNaN(mins(c.start)) || isNaN(mins(c.end))) {
      warn("play: clock needs start and end as HH:MM; the whole block is dropped");
      return { play: null, warnings: warnings };
    }
    var out = copy(play), clock = copy(c);
    clock.start = hhmm(c.start); clock.end = hhmm(c.end);
    if (c.beat === undefined) clock.beat = 15;
    else if (!Number.isInteger(c.beat) || c.beat < 5 || c.beat > 60) { warn("play: clock.beat " + JSON.stringify(c.beat) + " is not a whole number of minutes (5 to 60); using 15"); clock.beat = 15; }
    if (c.label !== undefined && typeof c.label !== "string") { warn("play: clock.label is not text; dropped"); delete clock.label; }
    var start = clock.start, span = minuteOf(clock.end, start);
    var inWindow = function (t) { return minuteOf(t, start) <= span; };
    if (c.starts !== undefined) {
      if (!isObj(c.starts)) { warn("play.clock.starts: not an object; dropped"); delete clock.starts; }
      else {
        var starts = {};
        Object.keys(c.starts).forEach(function (k) {
          var where = "play.clock.starts[" + JSON.stringify(k) + "]";
          if (STARTS.indexOf(k) < 0) { warn(where + ": not one of " + STARTS.join(", ") + "; dropped"); return; }
          if (isNaN(mins(c.starts[k]))) { warn(where + ": " + JSON.stringify(c.starts[k]) + " is not HH:MM; dropped"); return; }
          var h = hhmm(c.starts[k]);
          if (!inWindow(h)) { warn(where + ": " + h + " is outside the clock (" + start + " to " + clock.end + "); dropped"); return; }
          starts[k] = h;
        });
        clock.starts = starts;
      }
    }
    out.clock = clock;

    function list(key, max) {
      var v = play[key];
      if (v === undefined) return [];
      if (!Array.isArray(v)) { warn("play." + key + ": not a list; dropped"); return []; }
      if (v.length > max) { warn("play." + key + ": " + v.length + " entries, keeping the first " + max); return v.slice(0, max); }
      return v;
    }
    function ids(label, arr) {
      var seen = dict();
      return arr.filter(function (x, i) {
        var where = "play." + label + "[" + i + "]";
        if (!isObj(x)) { warn(where + ": not an object; dropped"); return false; }
        if (!isStr(x.id)) { warn(where + ": no id; dropped"); return false; }
        if (seen[x.id]) { warn(where + ": id " + x.id + " is used twice; the later one is dropped"); return false; }
        seen[x.id] = 1; return true;
      });
    }
    /* a list of strings that must each be in `set`; undefined when absent or not a list */
    function setList(where, v, set, noun) {
      if (v === undefined) return undefined;
      if (!Array.isArray(v)) { warn(where + ": not a list; dropped"); return undefined; }
      return v.filter(function (x) {
        if (typeof x === "string" && set[x] === 1) return true;
        warn(where + ": " + JSON.stringify(x) + " is not " + noun + "; dropped"); return false;
      });
    }
    function textKey(o, src, key, where) {
      if (src[key] !== undefined && typeof src[key] !== "string") { warn(where + "." + key + ": not text; dropped"); delete o[key]; }
    }
    var roomSet = rooms;

    /* floors, as v1 */
    if (play.floors !== undefined) {
      if (!isObj(play.floors)) { warn("play.floors: not an object; dropped"); delete out.floors; }
      else {
        var fl = {}, fk = Object.keys(play.floors);
        if (fk.length > LIMITS.floors) warn("play.floors: " + fk.length + " levels, keeping the first " + LIMITS.floors);
        fk.slice(0, LIMITS.floors).forEach(function (k) {
          if (!/^-?\d{1,2}$/.test(k) || !isStr(play.floors[k])) warn("play.floors[" + JSON.stringify(k) + "]: needs a level number and a name; dropped");
          else fl[k] = clipText(play.floors[k]);
        });
        out.floors = fl;
      }
    }

    /* zones: a room in two zones stays in the first */
    var claimed = dict();
    out.zones = ids("zones", list("zones", LIMITS.zones)).filter(function (z) {
      if (!isStr(z.label)) { warn("play.zones[" + z.id + "]: no label; dropped"); return false; }
      return true;
    }).map(function (z) {
      var where = "play.zones[" + z.id + "]", o = copy(z);
      var rl = setList(where + ".rooms", z.rooms, roomSet, "a room in the site") || [];
      o.rooms = rl.filter(function (n) {
        if (claimed[n]) { warn(where + ".rooms: " + JSON.stringify(n) + " is already in zone " + claimed[n] + "; dropped from this one"); return false; }
        claimed[n] = z.id; return true;
      });
      textKey(o, z, "pub", where);
      return o;
    }).filter(function (z) {
      if (!z.rooms.length) { warn("play.zones[" + z.id + "]: no rooms; dropped"); return false; }
      return true;
    });
    var zoneSet = dict();
    out.zones.forEach(function (z) { zoneSet[z.id] = 1; });

    /* routes: v1, plus open windows and pub. A bad open list drops the route (it would otherwise be open all night) */
    out.routes = ids("routes", list("routes", LIMITS.routes)).filter(function (r) {
      var where = "play.routes[" + r.id + "]";
      if (!hasRoom(r.from) || !hasRoom(r.to)) { warn(where + ": " + (!hasRoom(r.from) ? "from " : "to ") + JSON.stringify(!hasRoom(r.from) ? r.from : r.to) + " is not a room in the site; dropped"); return false; }
      if (r.dir !== undefined && DIRS.indexOf(r.dir) < 0) { warn(where + ": dir " + JSON.stringify(r.dir) + " is not both, up or down; dropped"); return false; }
      return true;
    }).map(function (r) {
      var where = "play.routes[" + r.id + "]", o = copy(r);
      if (o.dir === undefined) o.dir = "both";
      textKey(o, r, "pub", where);
      if (r.open !== undefined) {
        if (!Array.isArray(r.open)) { warn(where + ".open: not a list; the route is dropped"); return null; }
        var wins = [];
        r.open.slice(0, LIMITS.windows).forEach(function (w, i) {
          var at = where + ".open[" + i + "]";
          if (!isObj(w) || isNaN(mins(w.from)) || isNaN(mins(w.to))) { warn(at + ": needs from and to as HH:MM; dropped"); return; }
          var a = hhmm(w.from), b = hhmm(w.to);
          if (!inWindow(a) || !inWindow(b)) { warn(at + ": " + a + " to " + b + " is outside the clock; dropped"); return; }
          if (minuteOf(b, start) <= minuteOf(a, start)) { warn(at + ": " + b + " is not after " + a + "; dropped"); return; }
          var ow = copy(w); ow.from = a; ow.to = b; wins.push(ow);
        });
        if (r.open.length > LIMITS.windows) warn(where + ".open: " + r.open.length + " windows, keeping the first " + LIMITS.windows);
        if (!wins.length) { warn(where + ".open: no usable window; the route is dropped"); return null; }
        o.open = wins;
      }
      return o;
    }).filter(Boolean);

    /* people: a stop is { at, room, note? } | { at, with } | { at, gone: true } */
    var people = ids("people", list("people", LIMITS.people)).filter(function (p) {
      var where = "play.people[" + p.id + "]";
      if (!isStr(p.label)) { warn(where + ": no label; dropped"); return false; }
      if (KINDS.indexOf(p.kind) < 0) { warn(where + ": kind " + JSON.stringify(p.kind) + " is not " + KINDS.join(", ") + "; dropped"); return false; }
      return true;
    }).map(function (p) {
      var where = "play.people[" + p.id + "]", o = copy(p);
      ["look", "wary", "note"].forEach(function (k) { textKey(o, p, k, where); });
      if (p.with !== undefined) { warn(where + ".with: a v2 person follows through a stop { at, with }; the key is dropped"); delete o.with; }
      var stops = [];
      if (p.stops !== undefined && !Array.isArray(p.stops)) warn(where + ".stops: not a list; dropped");
      else {
        var raw = p.stops || [];
        if (raw.length > LIMITS.stops) warn(where + ".stops: " + raw.length + " stops, keeping the first " + LIMITS.stops);
        raw.slice(0, LIMITS.stops).forEach(function (s, i) {
          var at = where + ".stops[" + i + "]";
          if (!isObj(s)) { warn(at + ": not an object; dropped"); return; }
          if (isNaN(mins(s.at))) { warn(at + ": time " + JSON.stringify(s.at) + " is not HH:MM; dropped"); return; }
          var r = copy(s); r.at = hhmm(s.at);
          if (s.gone !== undefined) {
            if (s.gone !== true) { warn(at + ": gone must be true; dropped"); return; }
            delete r.room; delete r.with;
          } else if (s.with !== undefined) {
            if (!isStr(s.with)) { warn(at + ": with is not a person id; dropped"); return; }
            delete r.room;
          } else if (!hasRoom(s.room)) { warn(at + ": room " + JSON.stringify(s.room) + " is not in the site; dropped"); return; }
          textKey(r, s, "note", at);
          if (s.private !== undefined && typeof s.private !== "boolean") { warn(at + ".private: not true or false; dropped"); delete r.private; }
          if (!inWindow(r.at)) warn(at + ": " + r.at + " is outside the clock (" + start + " to " + clock.end + "), so it reads as the next morning; kept");
          stops.push(r);
        });
      }
      stops.sort(function (a, b) { return minuteOf(a.at, start) - minuteOf(b.at, start); });
      o.stops = stops;
      return o;
    });
    /* with: a surviving person other than itself, and no loop (the stop that would close a loop is the one dropped) */
    var changed = true;
    while (changed) {
      changed = false;
      var alive = dict();
      people.forEach(function (p) { alive[p.id] = 1; });
      people.forEach(function (p) {
        p.stops = p.stops.filter(function (s, i) {
          if (s.with === undefined) return true;
          var at = "play.people[" + p.id + "] stop at " + s.at;
          if (s.with === p.id) { warn(at + ": follows itself; dropped"); changed = true; return false; }
          if (alive[s.with] !== 1) { warn(at + ": with " + JSON.stringify(s.with) + " is not a person in the play; dropped"); changed = true; return false; }
          return true;
        });
      });
      var edges = dict();
      var reaches = function (from, target, seen) {
        if (from === target) return true;
        if (seen[from]) return false;
        seen[from] = 1;
        return (edges[from] || []).some(function (n) { return reaches(n, target, seen); });
      };
      people.forEach(function (p) {
        p.stops = p.stops.filter(function (s, i) {
          if (s.with === undefined) return true;
          if (reaches(s.with, p.id, {})) { warn("play.people[" + p.id + "] stop at " + s.at + ": with " + JSON.stringify(s.with) + " would lead back to " + p.id + "; dropped"); changed = true; return false; }
          (edges[p.id] = edges[p.id] || []).push(s.with);
          return true;
        });
      });
      people = people.filter(function (p) {
        if (p.stops.length) return true;
        warn("play.people[" + p.id + "]: no usable stop, so nowhere to be; person dropped"); changed = true; return false;
      });
    }
    out.people = people;
    var personSet = dict();
    people.forEach(function (p) { personSet[p.id] = 1; });

    /* disguises */
    out.disguises = ids("disguises", list("disguises", LIMITS.disguises)).filter(function (d) {
      if (!isStr(d.label)) { warn("play.disguises[" + d.id + "]: no label; dropped"); return false; }
      return true;
    }).map(function (d) {
      var where = "play.disguises[" + d.id + "]", o = copy(d);
      ["icon", "get"].forEach(function (k) { textKey(o, d, k, where); });
      [["home", zoneSet, "a zone in the play"], ["risky", zoneSet, "a zone in the play"], ["homeRooms", roomSet, "a room in the site"], ["riskyRooms", roomSet, "a room in the site"], ["never", roomSet, "a room in the site"], ["sees", personSet, "a person in the play"]].forEach(function (k) {
        var l = setList(where + "." + k[0], d[k[0]], k[1], k[2]);
        if (l === undefined) delete o[k[0]]; else o[k[0]] = l;
      });
      return o;
    });
    var disguiseSet = dict();
    out.disguises.forEach(function (d) { disguiseSet[d.id] = 1; });

    /* items */
    out.items = ids("items", list("items", LIMITS.items)).filter(function (it) {
      if (!isStr(it.label)) { warn("play.items[" + it.id + "]: no label; dropped"); return false; }
      return true;
    }).map(function (it) {
      var where = "play.items[" + it.id + "]", o = copy(it);
      textKey(o, it, "pub", where);
      if (it.lift !== undefined) {
        if (!Array.isArray(it.lift)) { warn(where + ".lift: not a list; dropped"); delete o.lift; }
        else o.lift = it.lift.filter(function (l, i) {
          var at = where + ".lift[" + i + "]";
          if (!isObj(l) || zoneSet[l.zone] !== 1) { warn(at + ": zone " + JSON.stringify(isObj(l) ? l.zone : l) + " is not a zone in the play; dropped"); return false; }
          if (LIFT_TO.indexOf(l.to) < 0) { warn(at + ": to " + JSON.stringify(l.to) + " is not risky or controlled; dropped"); return false; }
          return true;
        }).map(copy);
      }
      return o;
    });
    var itemSet = dict();
    out.items.forEach(function (it) { itemSet[it.id] = 1; });

    /* events: v1, plus vis (default hidden: fail closed), pub, say, rival */
    out.events = ids("events", list("events", LIMITS.events)).filter(function (e) {
      var where = "play.events[" + e.id + "]";
      if (isNaN(mins(e.at))) { warn(where + ": time " + JSON.stringify(e.at) + " is not HH:MM; dropped"); return false; }
      if (!isStr(e.label)) { warn(where + ": no label; dropped"); return false; }
      if (e.room !== undefined && !hasRoom(e.room)) { warn(where + ": room " + JSON.stringify(e.room) + " is not in the site; dropped"); return false; }
      return true;
    }).map(function (e) {
      var where = "play.events[" + e.id + "]", o = copy(e);
      o.at = hhmm(e.at);
      if (!inWindow(o.at)) warn(where + ": " + o.at + " is outside the clock (" + start + " to " + clock.end + "), so it reads as the next morning; kept");
      if (e.vis === undefined) o.vis = "hidden";
      else if (VIS.indexOf(e.vis) < 0) { warn(where + ": vis " + JSON.stringify(e.vis) + " is not public, seen or hidden; using hidden"); o.vis = "hidden"; }
      ["pub", "say"].forEach(function (k) { textKey(o, e, k, where); });
      if (e.rival !== undefined && typeof e.rival !== "boolean") { warn(where + ".rival: not true or false; dropped"); delete o.rival; }
      if (e.until !== undefined && isNaN(mins(e.until))) { warn(where + ".until: " + JSON.stringify(e.until) + " is not HH:MM; dropped"); delete o.until; }
      else if (e.until !== undefined) o.until = hhmm(e.until);
      return o;
    });
    out.events.sort(function (a, b) { return minuteOf(a.at, start) - minuteOf(b.at, start); });
    var eventSet = dict();
    out.events.forEach(function (e) { eventSet[e.id] = 1; });

    /* clocks, as v1 */
    out.clocks = list("clocks", LIMITS.clocks).filter(function (k, i) {
      var where = "play.clocks[" + i + "]";
      if (!isObj(k) || !isStr(k.name)) { warn(where + ": no name; dropped"); return false; }
      if (k.room !== undefined && !hasRoom(k.room)) { warn(where + " (" + k.name + "): room " + JSON.stringify(k.room) + " is not in the site; dropped"); return false; }
      return true;
    }).map(copy);

    /* ways */
    out.ways = ids("ways", list("ways", LIMITS.ways)).filter(function (w) {
      if (!isStr(w.name)) { warn("play.ways[" + w.id + "]: no name; dropped"); return false; }
      return true;
    }).map(function (w) {
      var where = "play.ways[" + w.id + "]", o = copy(w);
      ["pubName", "cost", "note"].forEach(function (k) { textKey(o, w, k, where); });
      if (w.kind === undefined) o.kind = "either";
      else if (WAY_KINDS.indexOf(w.kind) < 0) { warn(where + ": kind " + JSON.stringify(w.kind) + " is not loud, quiet or either; using either"); o.kind = "either"; }
      if (w.window !== undefined) {
        if (!isObj(w.window)) { warn(where + ".window: not an object; dropped"); delete o.window; }
        else if (isNaN(mins(w.window.at))) { warn(where + ".window: needs at as HH:MM; dropped"); delete o.window; }
        else {
          var win = copy(w.window), wat = where + ".window";
          win.at = hhmm(w.window.at);
          if (win.until !== undefined) {
            if (isNaN(mins(win.until)) || minuteOf(win.until, start) <= minuteOf(win.at, start)) { warn(wat + ".until: " + JSON.stringify(win.until) + " is not an HH:MM after at; dropped"); delete win.until; }
            else win.until = hhmm(win.until);
          }
          if (win.room !== undefined && !hasRoom(win.room)) { warn(wat + ".room: " + JSON.stringify(win.room) + " is not in the site; dropped"); delete win.room; }
          textKey(win, w.window, "pub", wat);
          if (win.told !== undefined && !isStr(win.told)) { warn(wat + ".told: not an id; dropped"); delete win.told; }
          o.window = win;
        }
      }
      if (w.lead !== undefined) {
        var ld = w.lead, lat = where + ".lead";
        if (!isObj(ld)) { warn(lat + ": not an object; dropped"); delete o.lead; }
        else if (!isStr(ld.line)) { warn(lat + ": no line; dropped"); delete o.lead; }
        else if (isNaN(mins(ld.from)) || isNaN(mins(ld.to)) || minuteOf(ld.to, start) <= minuteOf(ld.from, start)) { warn(lat + ": needs from and to as HH:MM, to after from; dropped"); delete o.lead; }
        else if (ld.room !== undefined && !hasRoom(ld.room)) { warn(lat + ".room: " + JSON.stringify(ld.room) + " is not in the site; the lead is dropped"); delete o.lead; }
        else { var nl = copy(ld); nl.from = hhmm(ld.from); nl.to = hhmm(ld.to); textKey(nl, ld, "who", lat); o.lead = nl; }
      }
      if (w.steps === undefined) o.steps = [];
      else if (!Array.isArray(w.steps)) { warn(where + ".steps: not a list; dropped"); o.steps = []; }
      else {
        var steps = w.steps.filter(function (s, i) { if (isStr(s)) return true; warn(where + ".steps[" + i + "]: not text; dropped"); return false; });
        if (steps.length > LIMITS.steps) { warn(where + ".steps: " + steps.length + " steps, keeping the first " + LIMITS.steps); steps = steps.slice(0, LIMITS.steps); }
        o.steps = steps;
      }
      var nd = setList(where + ".needs", w.needs, itemSet, "an item in the play");
      if (nd === undefined) delete o.needs; else o.needs = nd;
      return o;
    });
    var wayById = dict();
    out.ways.forEach(function (w) { wayById[w.id] = 1; });

    /* intel: reveals only names what exists */
    out.intel = ids("intel", list("intel", LIMITS.intel)).filter(function (x) {
      if (!isStr(x.text)) { warn("play.intel[" + x.id + "]: no text; dropped"); return false; }
      return true;
    }).map(function (x) {
      var where = "play.intel[" + x.id + "]", o = copy(x);
      textKey(o, x, "from", where);
      if (x.reveals !== undefined) {
        if (!isObj(x.reveals)) { warn(where + ".reveals: not an object; dropped"); delete o.reveals; }
        else {
          var rv = copy(x.reveals);
          [["events", eventSet, "an event in the play"], ["ways", wayById, "a way in the play"], ["routes", (function () { var s = dict(); out.routes.forEach(function (r) { s[r.id] = 1; }); return s; })(), "a route in the play"]].forEach(function (k) {
            var l = setList(where + ".reveals." + k[0], x.reveals[k[0]], k[1], k[2]);
            if (l === undefined) delete rv[k[0]]; else rv[k[0]] = l;
          });
          o.reveals = rv;
        }
      }
      return o;
    });
    var intelSet = dict();
    out.intel.forEach(function (x) { intelSet[x.id] = 1; });
    /* a window's `told` names an intel item or an event: anything else would leave the exact window unreachable, so say so */
    out.ways.forEach(function (w) {
      if (w.window && w.window.told !== undefined && intelSet[w.window.told] !== 1 && eventSet[w.window.told] !== 1) {
        warn("play.ways[" + w.id + "].window.told: " + JSON.stringify(w.window.told) + " is not an intel item or an event in the play; dropped");
        delete w.window.told;
      }
    });

    /* alarm */
    if (play.alarm !== undefined) {
      var al = play.alarm;
      if (!isObj(al) || !isStr(al.clock)) { warn("play.alarm: needs clock (the table clock's name); dropped"); delete out.alarm; }
      else {
        var ao = copy(al);
        textKey(ao, al, "label", "play.alarm");
        ["beats", "pub"].forEach(function (k) {
          if (al[k] === undefined) { ao[k] = []; return; }
          if (!Array.isArray(al[k])) { warn("play.alarm." + k + ": not a list; dropped"); ao[k] = []; return; }
          if (al[k].length > LIMITS.alarm) warn("play.alarm." + k + ": " + al[k].length + " entries, keeping the first " + LIMITS.alarm);
          ao[k] = al[k].slice(0, LIMITS.alarm).map(function (s, i) { if (typeof s === "string") return s; warn("play.alarm." + k + "[" + i + "]: not text; blanked"); return ""; });
        });
        var size = Math.max(ao.beats.length, ao.pub.length);
        if (al.ticks !== undefined) {
          if (!Array.isArray(al.ticks)) { warn("play.alarm.ticks: not a list; dropped"); ao.ticks = []; }
          else ao.ticks = al.ticks.filter(function (t, i) {
            if (isObj(t) && Number.isInteger(t.by) && t.by >= 1) return true;
            warn("play.alarm.ticks[" + i + "]: needs by as a whole number from 1; dropped"); return false;
          }).map(function (t) { var o2 = copy(t); textKey(o2, t, "why", "play.alarm.ticks"); return o2; });
        }
        if (al.at !== undefined) {
          if (!isObj(al.at)) { warn("play.alarm.at: not an object; dropped"); delete ao.at; }
          else {
            var atm = {};
            Object.keys(al.at).forEach(function (k) {
              var n = Number(k);
              if (!/^[1-9]\d?$/.test(k) || (size > 0 && n > size)) { warn("play.alarm.at[" + JSON.stringify(k) + "]: not a segment of the alarm (1 to " + size + "); dropped"); return; }
              if (ALARM_VERBS.indexOf(al.at[k]) < 0) { warn("play.alarm.at[" + JSON.stringify(k) + "]: " + JSON.stringify(al.at[k]) + " is not skip-private or lockdown; dropped"); return; }
              atm[k] = al.at[k];
            });
            ao.at = atm;
          }
        }
        if (al.lockdown !== undefined) {
          if (!isObj(al.lockdown) || !hasRoom(al.lockdown.room)) { warn("play.alarm.lockdown: needs { room } naming a room in the site; dropped"); delete ao.lockdown; }
          else ao.lockdown = { room: al.lockdown.room };
        }
        out.alarm = ao;
      }
    }

    /* entries and exits: GM-only; rooms must exist; a disguise must exist */
    ["entries", "exits"].forEach(function (key) {
      out[key] = ids(key, list(key, LIMITS[key])).filter(function (x) {
        if (!isStr(x.label)) { warn("play." + key + "[" + x.id + "]: no label; dropped"); return false; }
        return true;
      }).map(function (x) {
        var where = "play." + key + "[" + x.id + "]", o = copy(x);
        ["room", "from"].forEach(function (k) {
          if (x[k] !== undefined && !hasRoom(x[k])) { warn(where + "." + k + ": " + JSON.stringify(x[k]) + " is not in the site; dropped"); delete o[k]; }
        });
        if (x.disguise !== undefined && disguiseSet[x.disguise] !== 1) { warn(where + ".disguise: " + JSON.stringify(x.disguise) + " is not a disguise in the play; dropped"); delete o.disguise; }
        return o;
      });
    });

    /* secret: words that must never reach a player */
    if (play.secret === undefined) out.secret = [];
    else if (!Array.isArray(play.secret)) { warn("play.secret: not a list; dropped"); out.secret = []; }
    else {
      if (play.secret.length > LIMITS.secret) warn("play.secret: " + play.secret.length + " entries, keeping the first " + LIMITS.secret);
      out.secret = play.secret.slice(0, LIMITS.secret).filter(function (s, i) { if (isStr(s)) return true; warn("play.secret[" + i + "]: not text; dropped"); return false; });
    }
    return { play: out, warnings: warnings };
  }

  /* ---- v2: where people are ---------------------------------------------------------------------------------- */

  /* A person's effective stops [{ t, room?, with?, gone?, note }] in minutes from start, with the overrides applied:
   * skip (indexes into the sorted stops), delay (minutes added to every stop after the first, or only to those at or after over.from). */
  function stopsV2(person, start, ov) {
    var skip = ov && Array.isArray(ov.skip) ? ov.skip : [];
    var delay = ov && typeof ov.delay === "number" && isFinite(ov.delay) ? ov.delay : 0;
    /* over.from (minutes after clock.start): a delay moves only the stops at or after it, so a delay set mid-night
     * never drags a person back to a room they have left. No from: every stop after the first, as before. */
    var from = ov && typeof ov.from === "number" && isFinite(ov.from) ? ov.from : null;
    var arr = (isObj(person) && Array.isArray(person.stops) ? person.stops : []).map(function (s, i) {
      return { s: s, i: i, t: isObj(s) ? minuteOf(s.at, start) : NaN };
    }).filter(function (x) { return !isNaN(x.t); });
    arr.sort(function (a, b) { return a.t - b.t || a.i - b.i; });
    var out = [];
    arr.forEach(function (x, j) {
      if (skip.indexOf(j) >= 0) return;
      var t = x.t + (j >= 1 && (from === null || x.t >= from) ? delay : 0), s = x.s, note = typeof s.note === "string" ? s.note : "";
      if (s.gone === true) out.push({ t: t, gone: true, note: note });
      else if (typeof s.with === "string") out.push({ t: t, with: s.with, note: note });
      else if (typeof s.room === "string") out.push({ t: t, room: s.room, note: note });
    });
    return out;
  }

  /* whereAtV2(person, minute, byId, start, over, depth) -> { room, note, moving: { to, inMin } | null } | null
   * null is "nowhere": not yet arrived, gone, or following someone who is nowhere. over.<id>.at pins a room until cleared. */
  function whereAtV2(person, minute, byId, start, over, depth) {
    if (!isObj(person) || typeof minute !== "number" || isNaN(minute) || depth > 20) return null;
    var ov = isObj(own(over, person.id)) ? over[person.id] : null;
    if (ov && ov.gone === true) return null;
    if (ov && typeof ov.at === "string" && ov.at) return { room: ov.at, note: nameOf(person.note), moving: null };
    var stops = stopsV2(person, start, ov), cur = null, next = null;
    for (var i = 0; i < stops.length; i++) { if (stops[i].t <= minute) cur = stops[i]; else { next = stops[i]; break; } }
    if (!cur || cur.gone) return null;
    var nextRoom = null;
    if (next && !next.gone) {
      if (next.room) nextRoom = next.room;
      else if (isObj(own(byId, next.with))) { var nl = whereAtV2(byId[next.with], next.t, byId, start, over, depth + 1); nextRoom = nl ? nl.room : null; }
    }
    var ownMove = function (room) { return nextRoom && nextRoom !== room && next.t - minute <= MOVING_WITHIN ? { to: nextRoom, inMin: next.t - minute } : null; };
    var note = cur.note || nameOf(person.note);
    if (cur.room) return { room: cur.room, note: note, moving: ownMove(cur.room) };
    var leader = own(byId, cur.with) || null;
    var l = leader ? whereAtV2(leader, minute, byId, start, over, depth + 1) : null;
    if (!l) return null;
    return { room: l.room, note: note, moving: ownMove(l.room) || l.moving };
  }

  function peopleById(play) {
    var by = dict();
    (isObj(play) && Array.isArray(play.people) ? play.people : []).forEach(function (p) { if (isObj(p)) by[p.id] = p; });
    return by;
  }
  function overOf(state) { return isObj(state) && isObj(state.over) ? state.over : {}; }
  function startOf(src) {
    if (typeof src === "string") return src;
    if (isObj(src)) return isObj(src.clock) ? src.clock.start : src.start;
    return "";
  }
  function beatLen(src) {
    var c = isObj(src) ? (isObj(src.clock) ? src.clock : src) : {};
    return Number.isInteger(c.beat) && c.beat >= 5 && c.beat <= 60 ? c.beat : 15;
  }

  /* placesAt(play, state, t) -> { <person id>: whereAt result | null } with the overrides in state.over applied */
  function placesAt(play, state, t) {
    var by = peopleById(play), over = overOf(state), start = startOf(play), out = {};
    Object.keys(by).forEach(function (id) { put(out, id, whereAtV2(by[id], t, by, start, over, 0)); });
    return out;
  }

  /* ---- v2: helpers ------------------------------------------------------------------------------------------- */

  /* timeLabel(src, t) -> "HH:MM" for t minutes after the clock's start (wraps past midnight); "" when it cannot say */
  function timeLabel(src, t) {
    var s = mins(startOf(src));
    if (isNaN(s) || typeof t !== "number" || !isFinite(t)) return "";
    var x = (((s + Math.round(t)) % 1440) + 1440) % 1440;
    return pad(Math.floor(x / 60)) + ":" + pad(x % 60);
  }
  /* beatOf(src, t) -> { n, of, i }: the 1-based beat n of `of`, counted from clock.start (i is n - 1). `of` is the
   * whole beats between start and end (at least 1); a t past the end reads as the last beat. */
  function beatOf(src, t) {
    var c = isObj(src) ? (isObj(src.clock) ? src.clock : src) : {}, beat = beatLen(c);
    var span = minuteOf(c.end, c.start), of = Math.max(1, isNaN(span) ? 1 : Math.floor(span / beat));
    var i = typeof t === "number" && isFinite(t) ? Math.min(of - 1, Math.max(0, Math.floor(t / beat))) : 0;
    return { n: i + 1, of: of, i: i };
  }
  /* inMin(now, at) -> whole minutes from `now` until `at` (both minutes after clock.start), never below 0 */
  function inMin(now, at) { return Math.max(0, Math.round(at - now)); }

  function crewOf(state, pc) {
    var c = isObj(state) ? own(state.crew, pc) : null;
    return isObj(c) ? c : {};
  }
  function findBy(arr, id) {
    var r = null;
    (Array.isArray(arr) ? arr : []).forEach(function (x) { if (isObj(x) && x.id === id) r = x; });
    return r;
  }
  function inList(arr, v) { return Array.isArray(arr) && arr.indexOf(v) >= 0; }
  function zoneOf(play, room) {
    var z = null;
    (Array.isArray(play.zones) ? play.zones : []).forEach(function (x) { if (!z && isObj(x) && inList(x.rooms, room)) z = x; });
    return z;
  }

  /* positionOf(play, state, pcId) -> { pos, why }. In order: no costume or room, desperate; else never (desperate),
   * homeRooms (controlled), riskyRooms (risky), then the room's zone in home (controlled) or risky (risky), else desperate.
   * Room lists beat zones, so a riskyRooms entry inside a home zone is not a no-op. Then each carried item's lift for
   * the room's zone: the best lift raises the position, never lowers it. Then noticed: one step worse. Then a costume in
   * the PC's blown list: desperate. `why` is GM-facing text. */
  function positionOf(play, state, pcId) {
    var c = crewOf(state, pcId), d = findBy(play && play.disguises, c.disguise), room = typeof c.room === "string" ? c.room : "";
    var zone = room ? zoneOf(play, room) : null, why = [], pos = 0;
    if (!d) why.push("no costume");
    else if (!room) why.push("no room");
    else if (inList(d.never, room)) why.push("never in " + room);
    else if (inList(d.homeRooms, room)) { pos = 2; why.push("home room"); }
    else if (inList(d.riskyRooms, room)) { pos = 1; why.push("risky room"); }
    else if (zone && inList(d.home, zone.id)) { pos = 2; why.push("home zone " + zone.label); }
    else if (zone && inList(d.risky, zone.id)) { pos = 1; why.push("risky zone " + zone.label); }
    else why.push(zone ? "not a zone this costume works in (" + zone.label + ")" : "no zone");
    if (zone && Array.isArray(c.items)) {
      var best = -1, by = "";
      (Array.isArray(play.items) ? play.items : []).forEach(function (it) {
        if (!isObj(it) || c.items.indexOf(it.id) < 0 || !Array.isArray(it.lift)) return;
        it.lift.forEach(function (l) {
          var r = isObj(l) && l.zone === zone.id ? POS.indexOf(l.to) : -1;
          if (r > best) { best = r; by = nameOf(it.label) || it.id; }
        });
      });
      if (best > pos) { pos = best; why.push("lifted by " + by); }
    }
    if (c.noticed === true) { pos = Math.max(0, pos - 1); why.push("noticed"); }
    if (d && inList(c.blown, d.id)) { pos = 0; why.push("blown"); }
    return { pos: POS[pos], why: why.join("; ") };
  }

  /* lookers(play, state, pcId, t) -> { here, soon }. here: people the PC's costume sees through who are in the PC's room at t.
   * soon: those who are not, but are by t + beat (each with at, the first minute they are there, and inMin). */
  function lookers(play, state, pcId, t) {
    var c = crewOf(state, pcId), d = findBy(play && play.disguises, c.disguise), room = typeof c.room === "string" ? c.room : "";
    var res = { here: [], soon: [] };
    if (!d || !room || !Array.isArray(d.sees)) return res;
    var by = peopleById(play), over = overOf(state), start = startOf(play), beat = beatLen(play);
    d.sees.forEach(function (id) {
      var p = by[id];
      if (!p) return;
      var item = function () { return { id: p.id, label: nameOf(p.label), look: nameOf(p.look), wary: nameOf(p.wary) }; };
      var w = whereAtV2(p, t, by, start, over, 0);
      if (w && w.room === room) { res.here.push(item()); return; }
      for (var m = t + 1; m <= t + beat; m++) {
        var wm = whereAtV2(p, m, by, start, over, 0);
        if (wm && wm.room === room) { var s = item(); s.at = m; s.inMin = m - t; res.soon.push(s); break; }
      }
    });
    return res;
  }

  /* routesAt(play, t) -> the routes with no open window, plus those whose window covers t (from <= t < to) */
  function routesAt(play, t) {
    var start = startOf(play);
    return (isObj(play) && Array.isArray(play.routes) ? play.routes : []).filter(function (r) {
      if (!isObj(r)) return false;
      if (!Array.isArray(r.open) || !r.open.length) return true;
      return r.open.some(function (w) { return isObj(w) && minuteOf(w.from, start) <= t && t < minuteOf(w.to, start); });
    });
  }

  /* leadsInReach(play, state, t) -> [{ way, pc, line, who, room, name }]: for each PC in state.crew, the ways whose lead is
   * said in the PC's room (a lead with no room is in reach anywhere) with lead.from <= t < lead.to, not yet heard by that PC. */
  function leadsInReach(play, state, t) {
    var out = [], start = startOf(play), crew = isObj(state) && isObj(state.crew) ? state.crew : {}, heard = isObj(state) && isObj(state.heard) ? state.heard : {};
    Object.keys(crew).forEach(function (pc) {
      var room = isObj(crew[pc]) ? crew[pc].room : "";
      (isObj(play) && Array.isArray(play.ways) ? play.ways : []).forEach(function (w) {
        var ld = isObj(w) ? w.lead : null;
        if (!isObj(ld)) return;
        if (ld.room !== undefined && ld.room !== room) return;
        if (!(minuteOf(ld.from, start) <= t && t < minuteOf(ld.to, start))) return;
        if (own(own(heard, w.id), pc) !== undefined) return;
        out.push({ way: w.id, pc: pc, line: ld.line, who: nameOf(ld.who), room: nameOf(ld.room), name: nameOf(w.name) });
      });
    });
    return out;
  }

  /* beatCard(play, state, t0, t1) -> { t0, t1, back, items }. Covers what lands in (t0, t1] when t1 > t0. When t1 <= t0 it is
   * the card for the beat that ends at t1, (t1 - beat, t1], and back is true only when t1 < t0. GM-facing: it has labels and SAY.
   * items, in speaking order, each { type, ... }:
   *   event   { at, id, label, room, vis, pub, say, fx, rival }   in time order
   *   move    { at, id, label, from, to, note }                   the target's room changes
   *   looker  { when: "here"|"soon", pc, id, label, look, wary, pos, at, arrived?, inMin? }   people who see through a PC's costume
   *   route   { at, id, change: "opened"|"closed", from, to }
   *   gone    { at, id, label, from }                             a person who was somewhere and is now nowhere
   *   lead    { way, pc, line, who, room, name }                  in reach at t1
   *   next    { what: "event"|"move"|"route", at, inMin, id, ... }  the first thing after t1 (at most one) */
  function beatCard(play, state, t0, t1) {
    var start = startOf(play), beat = beatLen(play), back = t1 < t0, lo = t1 <= t0 ? t1 - beat : t0;
    var by = peopleById(play), over = overOf(state), items = [];
    var span = minuteOf(play.clock.end, start), horizon = (isNaN(span) ? 0 : span) + beat;
    var label = function (m) { return timeLabel(start, m); };
    var pick = function (o, src, keys) { keys.forEach(function (k) { if (src[k] !== undefined) o[k] = src[k]; }); return o; };

    (Array.isArray(play.events) ? play.events : []).forEach(function (e) {
      if (!isObj(e)) return;
      var m = minuteOf(e.at, start);
      if (m > lo && m <= t1) items.push(pick({ type: "event", at: e.at, _m: m }, e, ["id", "label", "room", "vis", "pub", "say", "fx", "rival"]));
    });
    items.sort(function (a, b) { return a._m - b._m; });
    items.forEach(function (i) { delete i._m; });

    var moves = [], gones = [];
    Object.keys(by).forEach(function (id) {
      var p = by[id], prev = whereAtV2(p, lo, by, start, over, 0);
      for (var m = lo + 1; m <= t1; m++) {
        var cur = whereAtV2(p, m, by, start, over, 0), a = prev ? prev.room : null, b = cur ? cur.room : null;
        if (a !== b) {
          if (!cur) gones.push({ type: "gone", at: label(m), id: id, label: nameOf(p.label), from: a, _m: m });
          else if (p.kind === "target") moves.push({ type: "move", at: label(m), id: id, label: nameOf(p.label), from: a, to: b, note: cur.note, _m: m });
        }
        prev = cur;
      }
    });
    var byTime = function (a, b) { return a._m - b._m; };
    moves.sort(byTime); gones.sort(byTime);
    var strip = function (l) { return l.map(function (i) { delete i._m; return i; }); };
    items = items.concat(strip(moves));

    var crew = isObj(state) && isObj(state.crew) ? state.crew : {};
    Object.keys(crew).forEach(function (pc) {
      var room = isObj(crew[pc]) ? crew[pc].room : "", pos = positionOf(play, state, pc).pos, lk = lookers(play, state, pc, t1);
      lk.here.forEach(function (l) {
        var w0 = whereAtV2(by[l.id], lo, by, start, over, 0);
        items.push({ type: "looker", when: "here", pc: pc, id: l.id, label: l.label, look: l.look, wary: l.wary, pos: pos, at: label(t1), arrived: !(w0 && w0.room === room) });
      });
      lk.soon.forEach(function (l) {
        items.push({ type: "looker", when: "soon", pc: pc, id: l.id, label: l.label, look: l.look, wary: l.wary, pos: pos, at: label(l.at), inMin: l.inMin });
      });
    });

    var rt = [];
    (Array.isArray(play.routes) ? play.routes : []).forEach(function (r) {
      if (!isObj(r) || !Array.isArray(r.open)) return;
      r.open.forEach(function (w) {
        var a = minuteOf(w.from, start), b = minuteOf(w.to, start);
        if (a > lo && a <= t1) rt.push({ type: "route", at: w.from, id: r.id, change: "opened", from: r.from, to: r.to, _m: a });
        if (b > lo && b <= t1) rt.push({ type: "route", at: w.to, id: r.id, change: "closed", from: r.from, to: r.to, _m: b });
      });
    });
    rt.sort(byTime);
    items = items.concat(strip(rt), strip(gones));
    leadsInReach(play, state, t1).forEach(function (l) {
      var w = findBy(play.ways, l.way), ld = w && isObj(w.lead) ? w.lead : null;
      if (ld && ld.room === undefined) return;           /* a lead with no room is not in reach for every PC: it is added once, below */
      var o = { type: "lead" }; Object.keys(l).forEach(function (k) { o[k] = l[k]; }); items.push(o);
    });
    /* a lead with no room: once, if it has a line, its window covers t1, and some PC (or nobody yet) has still to hear it */
    var crewIds = Object.keys(crew), heardMap = isObj(state) && isObj(state.heard) ? state.heard : {};
    (Array.isArray(play.ways) ? play.ways : []).forEach(function (w) {
      var ld = isObj(w) ? w.lead : null;
      if (!isObj(ld) || ld.room !== undefined || !isStr(ld.line)) return;
      if (!(minuteOf(ld.from, start) <= t1 && t1 < minuteOf(ld.to, start))) return;
      if (crewIds.length && crewIds.every(function (pc) { return own(own(heardMap, w.id), pc) !== undefined; })) return;
      items.push({ type: "lead", way: w.id, pc: "", line: ld.line, who: nameOf(ld.who), room: "", name: nameOf(w.name), anywhere: true });
    });

    /* the first thing after t1: an event, a target's move or a route opening or closing; at a tie, in that order */
    var best = null, take = function (m, rank, o) { if (!best || m < best.m || (m === best.m && rank < best.rank)) best = { m: m, rank: rank, o: o }; };
    (Array.isArray(play.events) ? play.events : []).forEach(function (e) {
      if (isObj(e) && minuteOf(e.at, start) > t1) take(minuteOf(e.at, start), 0, pick({ type: "next", what: "event" }, e, ["id", "label", "room", "vis", "pub"]));
    });
    Object.keys(by).forEach(function (id) {
      var p = by[id];
      if (p.kind !== "target") return;
      var here = whereAtV2(p, t1, by, start, over, 0), a = here ? here.room : null;
      for (var m = t1 + 1; m <= horizon; m++) {
        var w = whereAtV2(p, m, by, start, over, 0), b = w ? w.room : null;
        if (b && b !== a) { take(m, 1, { type: "next", what: "move", id: id, label: nameOf(p.label), to: b }); break; }
        if (!b && a) { take(m, 1, { type: "next", what: "gone", id: id, label: nameOf(p.label) }); break; }
        a = b;
      }
    });
    (Array.isArray(play.routes) ? play.routes : []).forEach(function (r) {
      if (!isObj(r) || !Array.isArray(r.open)) return;
      r.open.forEach(function (w) {
        var a = minuteOf(w.from, start), b = minuteOf(w.to, start);
        if (a > t1) take(a, 2, { type: "next", what: "route", id: r.id, change: "opened" });
        if (b > t1) take(b, 2, { type: "next", what: "route", id: r.id, change: "closed" });
      });
    });
    if (best) { best.o.at = label(best.m); best.o.inMin = inMin(t1, best.m); items.push(best.o); }
    return { t0: lo, t1: t1, back: back, items: items };
  }

  /* ---- v2: what the players get ------------------------------------------------------------------------------ */

  /* An audience: { crew: bool, pcs: [pc id] }. told[x] is "crew" or a list of PC ids. */
  var noAud = function () { return { crew: false, pcs: [] }; };
  function audOfTold(v) {
    if (v === "crew") return { crew: true, pcs: [] };
    if (Array.isArray(v)) return { crew: false, pcs: v.filter(function (x) { return typeof x === "string"; }) };
    return noAud();
  }
  function audJoin(a, b) {
    var pcs = a.pcs.slice();
    b.pcs.forEach(function (p) { if (pcs.indexOf(p) < 0) pcs.push(p); });
    return { crew: a.crew || b.crew, pcs: pcs };
  }
  function audKnows(a, pc) { return !!a && (a.crew || a.pcs.indexOf(pc) >= 0); }
  function audAny(a) { return a.crew || a.pcs.length > 0; }

  /* playerView(play, state, openRooms) -> a NEW object with only what a player may read, and only what has been told,
   * heard, carried, seen or opened. It is built field by field (nothing is copied from the block), so a field that is not
   * named here cannot reach it. Returns null when play is not a usable v2 block.
   *   { v: 1, site, clock: { start, end, beat, n, startMin, label? }, open: [room],
   *     zones:  [{ id, label, pub? }]                      only zones with an open room
   *     crew:   { <pc>: { room, costume: { label, icon } | null, pos, zones: { controlled: [zone id], risky: [zone id] },
   *                       items: [label], busy: t | null, sees: [person id] } }
   *     people: [{ id, target, label, look?, segs: [{ from, to, room | null }] }]   the target, and whoever a worn costume
   *                       sees through; segs are where they are, minute by minute, with state.over already applied
   *     events: [{ id, at, room?, vis, pub, aud }]         public ones, seen ones a PC is in the room of, and revealed ones
   *     routes: [{ id, pub, open: [{ from, to }], aud }]   only once an intel item that reveals it is told
   *     intel:  [{ id, text, aud }]                        only what is told
   *     ways:   [{ id, pubName, line, room?, window: { pub?, exact?, aud? }, next?, done }]   only ways some PC has heard;
   *                       next is the first unticked step, never the list
   *     waysFound, waysTotal, alarm: { name, pub: [text], size, filled } | null }   (name is play.alarm.label, else "Alarm"; never alarm.clock)
   *   events: a "seen" one is in the view when a PC is in its room now or it is revealed; missionFor shows it NOW only in its own
   *   beat while a PC is in the room (or once the crew is told), and never as a mark or a next from presence alone. */
  function playerView(play, state, openRooms) {
    if (!isObj(play) || play.v !== 2 || !isObj(play.clock)) return null;
    var st = isObj(state) ? state : {}, cl = play.clock, start = cl.start, beat = beatLen(play);
    var span = minuteOf(cl.end, start), n = beatOf(play, 0).of;
    var open = (Array.isArray(openRooms) ? openRooms : Array.isArray(st.open) ? st.open : []).filter(function (r) { return typeof r === "string"; });
    var openSet = dict();
    open.forEach(function (r) { openSet[r] = 1; });
    var crewIn = isObj(st.crew) ? st.crew : {}, told = isObj(st.told) ? st.told : {}, heard = isObj(st.heard) ? st.heard : {};
    var view = { v: 1, site: typeof st.site === "string" ? st.site : "", clock: { start: start, end: cl.end, beat: beat, n: n, startMin: typeof st.start === "number" && isFinite(st.start) ? st.start : 0 }, open: open.slice() };
    if (typeof cl.label === "string") view.clock.label = cl.label;

    var zones = Array.isArray(play.zones) ? play.zones.filter(isObj) : [];
    view.zones = zones.filter(function (z) { return Array.isArray(z.rooms) && z.rooms.some(function (r) { return openSet[r] === 1; }); })
      .map(function (z) { var o = { id: z.id, label: nameOf(z.label) }; if (typeof z.pub === "string") o.pub = z.pub; return o; });

    /* who knows what, by intel */
    var intel = Array.isArray(play.intel) ? play.intel.filter(isObj) : [], intelAud = dict();
    intel.forEach(function (x) { var a = audOfTold(own(told, x.id)); if (audAny(a)) intelAud[x.id] = a; });
    var revealed = function (kind, id) {
      var a = noAud();
      intel.forEach(function (x) { if (intelAud[x.id] && isObj(x.reveals) && inList(x.reveals[kind], id)) a = audJoin(a, intelAud[x.id]); });
      return a;
    };

    /* the crew */
    var by = peopleById(play), seers = dict(), over = overOf(st);
    view.crew = {};
    Object.keys(crewIn).forEach(function (pc) {
      var c = crewIn[pc];
      if (!isObj(c)) return;
      var d = findBy(play.disguises, c.disguise), cls = dict();
      zones.forEach(function (z) { cls[z.id] = d ? (inList(d.home, z.id) ? 2 : inList(d.risky, z.id) ? 1 : 0) : 0; });
      var items = [];
      (Array.isArray(play.items) ? play.items : []).forEach(function (it) {
        if (!isObj(it) || !Array.isArray(c.items) || c.items.indexOf(it.id) < 0) return;
        if (typeof it.label === "string") items.push(it.label);
        (Array.isArray(it.lift) ? it.lift : []).forEach(function (l) { if (isObj(l) && cls[l.zone] !== undefined) cls[l.zone] = Math.max(cls[l.zone], POS.indexOf(l.to)); });
      });
      var sees = d && Array.isArray(d.sees) ? d.sees.filter(function (id) { return !!by[id]; }) : [];
      sees.forEach(function (id) { seers[id] = 1; });
      put(view.crew, pc, {
        room: typeof c.room === "string" ? c.room : "",
        costume: d ? { label: nameOf(d.label), icon: nameOf(d.icon) } : null,
        pos: positionOf(play, st, pc).pos,
        zones: { controlled: zones.filter(function (z) { return cls[z.id] === 2; }).map(function (z) { return z.id; }), risky: zones.filter(function (z) { return cls[z.id] === 1; }).map(function (z) { return z.id; }) },
        items: items,
        busy: typeof c.busy === "number" && isFinite(c.busy) ? c.busy : null,
        sees: sees
      });
    });
    var pcRooms = dict();
    Object.keys(view.crew).forEach(function (pc) { if (view.crew[pc].room) pcRooms[view.crew[pc].room] = 1; });

    /* people: the target, and whoever a worn costume sees through. Label only for those. */
    view.people = [];
    Object.keys(by).forEach(function (id) {
      var p = by[id], target = p.kind === "target";
      if (!target && !seers[id]) return;
      var segs = [], horizon = (isNaN(span) ? 0 : span) + 2 * beat;
      for (var m = 0; m <= horizon; m++) {
        var w = whereAtV2(p, m, by, start, over, 0), room = w ? w.room : null, last = segs[segs.length - 1];
        if (last && last.room === room) last.to = m + 1; else segs.push({ from: m, to: m + 1, room: room });
      }
      var o = { id: id, target: target, label: nameOf(p.label), segs: segs };
      if (typeof p.look === "string") o.look = p.look;
      view.people.push(o);
    });

    /* events: public, seen (with a PC in the room), or revealed */
    view.events = [];
    (Array.isArray(play.events) ? play.events : []).forEach(function (e) {
      if (!isObj(e) || typeof e.pub !== "string") return;
      var aud = revealed("events", e.id);
      var shown = e.vis === "public" || (e.vis === "seen" && typeof e.room === "string" && pcRooms[e.room] === 1) || audAny(aud);
      if (!shown) return;
      var o = { id: e.id, at: minuteOf(e.at, start), vis: e.vis === "public" || e.vis === "seen" ? e.vis : "hidden", pub: e.pub, aud: aud };
      if (typeof e.until === "string" && !isNaN(minuteOf(e.until, start)) && minuteOf(e.until, start) > o.at) o.end = minuteOf(e.until, start);
      if (typeof e.room === "string") o.room = e.room;
      view.events.push(o);
    });

    view.routes = [];
    (Array.isArray(play.routes) ? play.routes : []).forEach(function (r) {
      if (!isObj(r) || typeof r.pub !== "string") return;
      var aud = revealed("routes", r.id);
      if (!audAny(aud)) return;
      view.routes.push({ id: r.id, pub: r.pub, open: (Array.isArray(r.open) ? r.open : []).map(function (w) { return { from: minuteOf(w.from, start), to: minuteOf(w.to, start) }; }), aud: aud });
    });

    view.intel = [];
    intel.forEach(function (x) { if (intelAud[x.id] && typeof x.text === "string") view.intel.push({ id: x.id, text: x.text, aud: intelAud[x.id] }); });

    /* ways: only those some PC has heard */
    var steps = isObj(st.steps) ? st.steps : {}, wstate = isObj(st.ways) ? st.ways : {};
    var ways = Array.isArray(play.ways) ? play.ways.filter(isObj) : [];
    view.ways = [];
    view.waysFound = 0;
    ways.forEach(function (w) {
      var h = own(heard, w.id);
      if (!isObj(h) || !Object.keys(h).some(function (k) { return typeof h[k] === "number"; })) return;
      view.waysFound++;
      if (typeof w.pubName !== "string" || !isObj(w.lead) || typeof w.lead.line !== "string") return;
      var o = { id: w.id, pubName: w.pubName, line: w.lead.line, window: {}, done: own(wstate, w.id) === "done" };
      if (typeof w.lead.room === "string" && openSet[w.lead.room] === 1) o.room = w.lead.room;
      if (isObj(w.window)) {
        if (typeof w.window.pub === "string") o.window.pub = w.window.pub;
        var ref = w.window.told, aud = intelAud[ref] || (eventSetHas(play, ref) ? revealed("events", ref) : null);
        if (aud && audAny(aud) && typeof w.window.at === "string") {
          o.window.exact = w.window.at + (w.window.until ? "–" + w.window.until : "") + (typeof w.window.room === "string" ? " · " + w.window.room : "");
          o.window.aud = aud;
        }
      }
      var ticks = Array.isArray(own(steps, w.id)) ? steps[w.id] : [], list = Array.isArray(w.steps) ? w.steps : [];
      for (var i = 0; i < list.length; i++) if (!ticks[i]) { o.next = String(list[i]); break; }
      view.ways.push(o);
    });
    view.waysTotal = ways.length;

    view.alarm = null;
    if (isObj(play.alarm) && typeof play.alarm.clock === "string") {
      var ap = Array.isArray(play.alarm.pub) ? play.alarm.pub.filter(function (s) { return typeof s === "string"; }) : [];
      var as = isObj(st.alarm) && typeof st.alarm.filled === "number" && st.alarm.filled >= 0 && st.alarm.visible !== false ? st.alarm.filled : null;
      var size = Math.max(ap.length, Array.isArray(play.alarm.beats) ? play.alarm.beats.length : 0);
      if (as !== null && size > 0) view.alarm = { name: typeof play.alarm.label === "string" && play.alarm.label.trim() ? play.alarm.label : "Alarm", pub: ap, size: size, filled: Math.min(size, Math.floor(as)) };
    }
    return view;
  }
  function eventSetHas(play, id) {
    return (Array.isArray(play.events) ? play.events : []).some(function (e) { return isObj(e) && e.id === id; });
  }

  /* missionFor(view, state, t, pcs) -> the mission players read: { v: 1, site, t, hud, cards }. The page adds seq.
   * Blind: it reads the view, never the play block. state is read for state.heard (who heard a way, and when) only.
   *   hud:   { time, label, now: [{ text, where?, until }], next: [{ text, where?, at, inMin }],
   *            night: { beats, start, cur, marks: [{ i, icon, text }] }, alarm: { name, size, filled, text } | null,
   *            crew: [{ name, costume, icon, room? }], target: { room } | null, ways: { found, total } }
   *   cards: { <pc id>: { name, owner, costume, icon, room, pos, warn: { who, look, sees } | null,
   *            zones: { controlled: [label], risky: [label] }, items: [label],
   *            leads: [{ name, line, heard, window, next?, done? }], know: [text],
   *            next: [{ text, where?, at, inMin }], paths: [{ text, until }], busy: "HH:MM" | null } }
   * pcs is [{ id, name, owner }]; every one gets a card. At most 3 now, 3 next (4 on a card), 24 marks, 6 paths. */
  function missionFor(view, state, t, pcs) {
    if (!isObj(view) || !isObj(view.clock) || typeof t !== "number" || !isFinite(t)) return null;
    var st = isObj(state) ? state : {}, cl = view.clock, beat = cl.beat, label = function (m) { return timeLabel(cl.start, m); };
    var openSet = dict();
    (Array.isArray(view.open) ? view.open : []).forEach(function (r) { openSet[r] = 1; });
    var where = function (room) { return typeof room === "string" && openSet[room] === 1 ? room : undefined; };
    var events = (Array.isArray(view.events) ? view.events : []).slice().sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
    /* an event with its own end reads "until" the sooner of that and the target's next stop after t; any other, the beat's end */
    var targetNext = function () {
      var tg = (Array.isArray(view.people) ? view.people : []).filter(function (p) { return p.target; })[0], best = null;
      if (tg) (tg.segs || []).forEach(function (s, i) { if (i > 0 && s.from > t && (best === null || s.from < best)) best = s.from; });
      return best;
    };
    var untilOf = function (e) {
      if (typeof e.end !== "number" || e.end <= t) return e.at + beat;
      var nx = targetNext();
      return nx !== null && nx < e.end ? nx : e.end;
    };
    var line = function (e, withAt) {
      var o = { text: e.pub };
      var w = where(e.room);
      if (w !== undefined) o.where = w;
      if (withAt) { o.at = label(e.at); o.inMin = inMin(t, e.at); } else o.until = label(untilOf(e));
      return o;
    };
    var happening = function (e) { return e.at <= t && t < (typeof e.end === "number" ? e.end : e.at + beat); };
    var upcoming = function (e) { return e.at > t; };

    /* NOW: public events; a seen event only while a PC is in its room; any event once the crew has been told of it */
    var pcIn = function (room) { return typeof room === "string" && isObj(view.crew) && Object.keys(view.crew).some(function (pc) { return view.crew[pc].room === room; }); };
    var now = events.filter(function (e) { return happening(e) && (e.vis === "public" || e.aud.crew || (e.vis === "seen" && pcIn(e.room))); }).slice(0, 3).map(function (e) { return line(e, false); });
    var crewNext = events.filter(function (e) { return upcoming(e) && e.aud.crew; });
    var marks = events.filter(function (e) { return e.aud.crew || (e.vis === "public" && e.at <= t); })
      .map(function (e) { return { i: Math.min(cl.n - 1, Math.max(0, Math.floor(e.at / beat))), icon: e.vis === "hidden" ? "diamond" : "star", text: e.pub }; }).slice(0, 24);

    var crewList = Array.isArray(pcs) ? pcs.filter(function (p) { return isObj(p) && typeof p.id === "string"; }) : [];
    var vc = isObj(view.crew) ? view.crew : {};
    var hudCrew = crewList.map(function (p) {
      var c = own(vc, p.id), o = { name: nameOf(p.name), costume: c && c.costume ? c.costume.label : "", icon: c && c.costume ? c.costume.icon : "" };
      var w = c ? where(c.room) : undefined;
      if (w !== undefined) o.room = w;
      return o;
    });

    var placeAt = function (person, m) {
      var r = null;
      (person.segs || []).forEach(function (s) { if (s.from <= m && m < s.to) r = s.room; });
      return r;
    };
    var inView = null, who = (Array.isArray(view.people) ? view.people : []).filter(function (p) { return p.target; })[0];
    if (who) {
      var room = placeAt(who, t);
      if (room && openSet[room] === 1) {
        var atEvent = events.some(function (e) { return e.vis === "public" && happening(e) && e.room === room; });
        var withPc = Object.keys(vc).some(function (pc) { return vc[pc].room === room; });
        if (atEvent || withPc) inView = { room: room };
      }
    }

    var hud = {
      time: label(t), label: typeof cl.label === "string" ? cl.label : "",
      now: now,
      next: crewNext.slice(0, 3).map(function (e) { return line(e, true); }),
      night: { beats: cl.n, start: Math.min(cl.n - 1, Math.max(0, Math.floor(cl.startMin / beat))), cur: Math.min(cl.n - 1, Math.max(0, Math.floor(t / beat))), marks: marks },
      alarm: null, crew: hudCrew, target: inView,
      ways: { found: typeof view.waysFound === "number" ? view.waysFound : 0, total: typeof view.waysTotal === "number" ? view.waysTotal : 0 }
    };
    if (isObj(view.alarm)) hud.alarm = { name: view.alarm.name, size: view.alarm.size, filled: view.alarm.filled, text: view.alarm.filled >= 1 ? nameOf(view.alarm.pub[view.alarm.filled - 1]) : "" };

    var heard = isObj(st.heard) ? st.heard : {};
    var zoneLabel = dict();
    (Array.isArray(view.zones) ? view.zones : []).forEach(function (z) { zoneLabel[z.id] = z.label; });
    var labelsOf = function (idsIn) { return idsIn.filter(function (id) { return zoneLabel[id] !== undefined; }).map(function (id) { return zoneLabel[id]; }); };

    var cards = {};
    crewList.forEach(function (p) {
      var c = own(vc, p.id), card = { name: nameOf(p.name), owner: typeof p.owner === "string" ? p.owner : "", costume: "", icon: "", room: "", pos: null, warn: null,
        zones: { controlled: [], risky: [] }, items: [], leads: [], know: [], next: [], paths: [], busy: null };
      put(cards, p.id, card);
      if (!c) return;
      if (c.costume) { card.costume = c.costume.label; card.icon = c.costume.icon; }
      card.room = c.room; card.pos = c.pos;
      card.zones = { controlled: labelsOf(c.zones.controlled), risky: labelsOf(c.zones.risky) };
      card.items = c.items.slice();
      if (c.costume && c.room) {
        (Array.isArray(view.people) ? view.people : []).some(function (person) {
          if (c.sees.indexOf(person.id) < 0 || placeAt(person, t) !== c.room) return false;
          card.warn = { who: person.label, look: nameOf(person.look), sees: c.costume.label };
          return true;
        });
      }
      var leads = [];
      (Array.isArray(view.ways) ? view.ways : []).forEach(function (w) {
        var h = own(own(heard, w.id), p.id);
        if (typeof h !== "number") return;
        var lead = { name: w.pubName, line: w.line, heard: label(h) + (w.room ? " · " + w.room : ""), window: w.window.exact && audKnows(w.window.aud, p.id) ? w.window.exact : nameOf(w.window.pub) };
        if (w.next !== undefined) lead.next = w.next;
        if (w.done) lead.done = true;
        leads.push(lead);
      });
      card.leads = leads.filter(function (l) { return !l.done; }).concat(leads.filter(function (l) { return l.done; }));
      card.know = (Array.isArray(view.intel) ? view.intel : []).filter(function (x) { return audKnows(x.aud, p.id); }).map(function (x) { return x.text; });
      card.next = events.filter(function (e) { return upcoming(e) && audKnows(e.aud, p.id); }).slice(0, 4).map(function (e) { return line(e, true); });
      (Array.isArray(view.routes) ? view.routes : []).forEach(function (r) {
        if (!audKnows(r.aud, p.id)) return;
        r.open.forEach(function (w) { if (w.from <= t && t < w.to && card.paths.length < 6) card.paths.push({ text: r.pub, until: label(w.to) }); });
      });
      card.busy = c.busy !== null && c.busy > t ? label(c.busy) : null;
    });

    var m = { v: 1, t: t, hud: hud, cards: cards };
    if (typeof view.site === "string" && view.site) m.site = view.site;
    return m;
  }

  return { checkPlay: checkPlay, positionOf: positionOf, lookers: lookers, routesAt: routesAt, leadsInReach: leadsInReach, beatCard: beatCard, playerView: playerView, missionFor: missionFor, placesAt: placesAt, beatOf: beatOf, timeLabel: timeLabel, inMin: inMin, countPlay: countPlay, minuteOf: minuteOf, whereAt: whereAt, lensRating: lensRating, seesMatches: seesMatches, ballView: ballView, KINDS: KINDS, DIRS: DIRS, LIMITS: LIMITS };
});
