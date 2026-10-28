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
  var LIMITS = { people: 60, stops: 40, routes: 40, disguises: 24, events: 40, clocks: 24, floors: 12, rooms: 40, text: 400 };
  var TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

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
   *     moving. CHOICE TO CONFIRM: a person with both own stops and `with` follows `with` before their first own stop,
   *     then obeys their own stops from the first one on, and does NOT go back to following after their last own stop.
   *  3. Moving: 1 to 5 minutes before the next own stop, in a different room from the current one, the person is shown
   *     in their current room, moving { to: next room, inMin: minutes until it }. */
  function whereAt(person, minute, byId, start, depth) {
    if (!isObj(person) || typeof minute !== "number" || isNaN(minute)) return null;
    var stops = stopsOf(person, start), cur = null, next = null;
    for (var i = 0; i < stops.length; i++) { if (stops[i].t <= minute) cur = stops[i]; else { next = stops[i]; break; } }
    if (cur) {
      var mv = null;
      if (next && next.t - minute <= MOVING_WITHIN && next.room !== cur.room) mv = { to: next.room, inMin: next.t - minute };
      return { room: cur.room, note: cur.note, moving: mv };
    }
    if (typeof person.with === "string" && isObj(byId) && isObj(byId[person.with]) && (depth || 0) < 20) {
      var lead = whereAt(byId[person.with], minute, byId, start, (depth || 0) + 1);
      if (lead) return lead;
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
   * "" match no one. "port" does not match "Reporter" or "Porter". */
  function norm(s) {
    var t = String(s == null ? "" : s).toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return t.replace(/[^a-z0-9]+/g, " ").trim().replace(/^the( |$)/, "").trim();
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
      if (isObj(e)) cand.push({ m: minuteOf(e.at, start), rank: 0, key: nameOf(e.id), out: { at: e.at, label: nameOf(e.label), room: e.room || null } });
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

  return { checkPlay: checkPlay, countPlay: countPlay, minuteOf: minuteOf, whereAt: whereAt, lensRating: lensRating, seesMatches: seesMatches, ballView: ballView, KINDS: KINDS, DIRS: DIRS, LIMITS: LIMITS };
});
