/* B68GmRunView — the GM's Run view for a v2 play block (design 5.2): the header, the board of room cards, a room tapped, and
 * the moves of the crew. Load: <script src="gm/run-view.js"> after gm/ball.js exposes window.B68GmRunView; in Node, require()
 * returns the same object (it needs ball.js beside it).
 *
 * PURE (tested in node, no DOM):
 *   model(play, st, o) -> the board at time o.t. st is the GM state's `ball`; o = { t, pcs: [{ id, name }],
 *     floors: { list: [{ lvl, name }], floorOf: { room: level } }, isOpen(room) -> bool }.
 *     { t, label, beat: { n, of, i }, beatLen, started, start, track: [{ i, t, label, icon, text, before, cur }],
 *       alarm: { name, size } | null, rows: [{ lvl, name, cards: [card] }], cards: { room: card }, tray: [pcChip] }
 *     card = { name, lvl, zone, zoneLabel, open, pcs: [pcChip], npcs: [npcChip], routes: [{ to, mark, timed, until }] }
 *     pcChip = { id, name, ini, icon, costume, pos, why, mark: "warn" | "eye" | "", looker, moved }
 *     npcChip = { id, ini, label, kind, moving }
 *   moveCrew(st, pcId, room, beatIndex) -> the new ball.crew (the PC placed in the room, noticed cleared when the room changed).
 *   stepTime(play, st, dir) -> the new ball.t for a beat back or forward (never before ball.start), or null.
 *   jumpTime(play, st) -> the minute of the next thing that happens after ball.t, or null.
 *   resetChange(st) -> the ball change that un-starts the night: every key but site, floor and open set to null (VV12).
 *   startMinutes(play) -> [{ key, label, at, t }] the engagement results play.clock.starts offers, in minutes from clock.start.
 *   roomsShown(model, sel) -> [room]: the room tapped, then every room a PC is in, top floor down.   personNames(person) -> [npc, label] (the names a card is filed under)
 *   peopleIn(play, st, t, room) -> [{ id, label, kind, npc, moving }] everyone placed there.   eventsIn(play, st, t, room) -> the beat's events in the room
 *   reachIn(play, st, t, pcIds) -> [{ way, line, who, name, pcs: [{ id, heard, unheard, at }] }] the leads in reach of those PCs, heard or not
 *   heardChange(st, way, pc, t) -> { heard, unheard }: hear, or take it back (ball.unheard keeps the auto-hear off that pair)
 *   foldMoves(st, pcs, o) -> null | { crew, notes: [{ pc, name, room, moved }] }: the phones' move requests (moveReq.seq > crew.mseq) folded in once
 *
 * THE VIEW (needs a DOM): create(host) -> { render(box), peek(t), unpeek(), ... }. host is the page's side of the contract:
 *   site() -> { name, play } | null           state() -> ball           set(change) -> ballSet (a replace patch)
 *   pcs() -> [{ id, name }]                   floors() -> { list, floorOf }
 *   isOpen(room) -> bool                      openRoom(room, on)   (the page's roomOpen: it asks first)
 *   mapSvg() -> svg text | ""                 clockNamed(name) -> { filled, size } | null
 *   dawn()             VV5: the False dawn button (the page's runDawn, which asks first)        setPosition(pos)  VV5: the console's Position
 *   publish(t, why)    THE CALL SITE VV6 FILLS: why is "start" | "beat" | "jump"; the page's body is empty today.
 *   confirm(msg) -> bool  VV12: the page's confirm        resetMission() -> Promise: VV12: the players' mission cleared (mission-publish resetNight)
 *   toast(msg, bad)
 *   OPTIONAL (check typeof; the tests build a bare host): hasNpcCard(names) -> bool (cheap)    npcCard(names) -> html | "" (the NPC card, rendered)
 *   decorate(el)  the Prep decorator on a node (SAY callouts become read-aloud cards)       roomNote(room) -> html | null (null: the prep note has no section for it)
 *
 * SEAMS for the tickets that build on this view (module-level, shared by every instance):
 *   setPlayersChip(text, ok)  the "Players: HH:MM" chip in the header (VV6)
 *   setWarnings(text)         the warnings line under the header ("" removes it)
 *   menuItems                 [{ id, label, run(ctx) }]  (label may be a function (ctx) -> text)  Run's menu button lists them (VV6: "End the night")
 *   views                     [{ id, label, render(box, ctx) }]  Board and Map are first; VV6 adds "Players"
 *   sections                  [{ id, order, render(box, ctx) }]  the right column, by order (Rooms -10; VV5: This beat 0, the job 200, intel 300; the crew is in the page drawer: crewInto)
 *   hooks                     { heard(way, pc, ctx) }  the Heard by buttons (VV5 fills it: ball.heard.<way>.<pc> = the published time)
 *   ctx = { play, st, model, t, shownT, peeking, host, sel, set(change), select(room), rerender(), toast(msg, bad), esc(text) }
 * Text from the play reaches the page through esc() only.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ball.js"));
  else root.B68GmRunView = factory(root.B68GmBall);
})(typeof self !== "undefined" ? self : this, function (B) {
  "use strict";

  var isObj = function (v) { return !!v && typeof v === "object" && !Array.isArray(v); };
  var str = function (v) { return typeof v === "string" ? v : v == null ? "" : String(v); };
  var esc = function (s) { return str(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var list = function (v) { return Array.isArray(v) ? v : []; };
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  var ICONS = { mask: "🎭", tray: "🍽", jacket: "🧥", key: "🔑", hat: "🎩", badge: "🛡", apron: "🧺" };
  var ARROW = { both: "↕", up: "↑", down: "↓" };

  function initials(label) {
    var out = "";
    str(label).trim().split(/\s+/).filter(Boolean).slice(0, 2).forEach(function (w) { out += Array.from(w)[0].toUpperCase(); });
    return out || "?";
  }
  function iconOf(name) { var n = str(name); return ICONS[n] || (n ? Array.from(n)[0].toUpperCase() : "•"); }
  function beatLen(play) { var b = isObj(play) && isObj(play.clock) ? play.clock.beat : 0; return Number.isInteger(b) && b >= 5 && b <= 60 ? b : 15; }
  /* ticket R: the parts of a room note that belong to the beat shown. Returns [[start, end], ...] character ranges: the whole " · "-separated
     segment around every clock time that falls in [w0, w1) (minutes since the night's start; toMin turns "HH:MM" into that, NaN when it cannot). */
  var SEG_SEP = " \u00b7 ", CLOCK_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
  function nowSegments(text, w0, w1, toMin) {
    var s = str(text), out = [], re = new RegExp(CLOCK_RE.source, "g"), m, a, b, last = -1;
    if (typeof toMin !== "function") return out;
    while ((m = re.exec(s))) {
      var t = toMin(m[0]);
      if (typeof t !== "number" || isNaN(t) || !(t >= w0 && t < w1)) continue;
      a = s.lastIndexOf(SEG_SEP, m.index); a = a < 0 ? 0 : a + SEG_SEP.length;
      b = s.indexOf(SEG_SEP, m.index + m[0].length); if (b < 0) b = s.length;
      if (a === last) continue;      /* a second time in the same segment */
      last = a; out.push([a, b]);
    }
    return out;
  }
  function lightNow(box, ctx) {
    var play = ctx.play, bl = beatLen(play), w0 = Math.floor(ctx.shownT / bl) * bl, w1 = w0 + bl, start = isObj(play.clock) ? play.clock.start : "", n = 0;
    var toMin = function (tok) { return B.minuteOf(tok, start); };
    Array.prototype.forEach.call(box.querySelectorAll(".rv-rmnote"), function (note) {
      var doc = note.ownerDocument, walker = doc.createTreeWalker(note, 4 /* SHOW_TEXT */, null), nodes = [], nd;
      while ((nd = walker.nextNode())) nodes.push(nd);
      nodes.forEach(function (tn) {
        for (var p = tn.parentNode; p && p !== note; p = p.parentNode) if (/^(CODE|PRE)$/i.test(p.nodeName)) return;
        var segs = nowSegments(tn.nodeValue, w0, w1, toMin);
        if (!segs.length) return;
        var txt = tn.nodeValue, frag = doc.createDocumentFragment(), at = 0;
        segs.forEach(function (r) {
          if (r[0] > at) frag.appendChild(doc.createTextNode(txt.slice(at, r[0])));
          var mk = doc.createElement("mark"); mk.className = "rv-now"; mk.textContent = txt.slice(r[0], r[1]); frag.appendChild(mk); at = r[1]; n++;
        });
        if (at < txt.length) frag.appendChild(doc.createTextNode(txt.slice(at)));
        tn.parentNode.replaceChild(frag, tn);
      });
    });
    if (n) {
      var key = '<p class="rv-dim rv-nowkey">Lit: this beat, ' + esc(B.timeLabel(play, w0)) + "–" + esc(B.timeLabel(play, w1)) + "</p>", hd = box.querySelector(".rv-sh");
      if (hd) hd.insertAdjacentHTML("afterend", key); else box.insertAdjacentHTML("afterbegin", key);
    }
  }

  function spanOf(play) { var n = B.minuteOf(play.clock.end, play.clock.start); return n > 0 ? n : 1440; }
  function isStarted(st) { return isObj(st) && typeof st.start === "number" && isFinite(st.start); }
  function timeOf(st) { return isObj(st) && typeof st.t === "number" && isFinite(st.t) ? Math.max(0, Math.round(st.t)) : 0; }
  function lastBeatT(play) { return (B.beatOf(play, 0).of - 1) * beatLen(play); }

  /* the engagement results the play offers: crit, 6, 4/5, 1-3 */
  function startMinutes(play) {
    var s = isObj(play) && isObj(play.clock) && isObj(play.clock.starts) ? play.clock.starts : {}, out = [];
    [["crit", "Crit"], ["6", "6"], ["4/5", "4/5"], ["1-3", "1-3"]].forEach(function (k) {
      var at = s[k[0]], t = typeof at === "string" ? B.minuteOf(at, play.clock.start) : NaN;
      if (!isNaN(t) && t >= 0) out.push({ key: k[0], label: k[1], at: at, t: t });
    });
    return out;
  }

  /* a beat back or forward: never before the start, never past the last beat */
  function stepTime(play, st, dir) {
    if (!isStarted(st)) return null;
    var cur = timeOf(st), want = cur + (dir < 0 ? -1 : 1) * beatLen(play), lo = st.start, hi = Math.max(lo, lastBeatT(play));
    want = Math.max(lo, Math.min(hi, want));
    return want === cur ? null : want;
  }

  /* the minutes at which something happens: events, anyone's stops, a route's windows, a way's window */
  function happenings(play) {
    var start = play.clock.start, out = [], add = function (hhmm) { var m = typeof hhmm === "string" ? B.minuteOf(hhmm, start) : NaN; if (!isNaN(m)) out.push(m); };
    list(play.events).forEach(function (e) { if (isObj(e)) add(e.at); });
    list(play.people).forEach(function (p) { if (isObj(p)) list(p.stops).forEach(function (s) { if (isObj(s)) add(s.at); }); });
    list(play.routes).forEach(function (r) { if (isObj(r)) list(r.open).forEach(function (w) { if (isObj(w)) { add(w.from); add(w.to); } }); });
    list(play.ways).forEach(function (w) { if (isObj(w) && isObj(w.window)) add(w.window.at); });
    return out;
  }
  function jumpTime(play, st) {
    if (!isStarted(st)) return null;
    var t = timeOf(st), span = spanOf(play), best = null;
    happenings(play).forEach(function (m) { if (m > t && m < span && (best === null || m < best)) best = m; });
    return best;
  }

  /* VV12 Reset the night: the map's fog (site, floor, open) belongs to the Location, not the night; every other key goes */
  var KEEP = ["site", "floor", "open"];
  var RESET_ASK = "Reset the night? The clock goes back to Start the night, and every PC’s room, costume, leads heard, intel told, steps and the target’s delays are cleared. " +
    "The iPad band and every phone’s card go. The map’s open rooms and the table clocks stay as they are.";
  function resetChange(st, pcs) {
    var ch = {}, seen = {};
    Object.keys(isObj(st) ? st : {}).forEach(function (k) { if (KEEP.indexOf(k) < 0) ch[k] = null; });
    /* every phone request still pending is consumed: the PC gets an empty crew entry carrying its mseq, so a request from before the reset never replays */
    list(pcs).forEach(function (pc) { var mr = isObj(pc) ? pc.moveReq : null; if (str(isObj(pc) ? pc.id : "") && isObj(mr) && typeof mr.seq === "number" && isFinite(mr.seq)) seen[pc.id] = { mseq: mr.seq }; });
    if (Object.keys(seen).length) ch.crew = seen;
    return ch;
  }

  function moveCrew(st, pcId, room, beatIndex) {
    var crew = isObj(st) && isObj(st.crew) ? clone(st.crew) : {}, old = isObj(crew[pcId]) ? crew[pcId] : {}, n = Object.assign({}, old);
    if (old.room !== room) n.noticed = false;
    n.room = room;
    n.moved = beatIndex;
    crew[pcId] = n;
    return crew;
  }

  /* ---- the board --------------------------------------------------------------------------------------------- */
  function model(play, st, o) {
    st = isObj(st) ? st : {};
    var t = Math.max(0, Math.round(+o.t || 0)), beat = beatLen(play), bo = B.beatOf(play, t), start = isStarted(st) ? st.start : null;
    var fl = isObj(o.floors) ? o.floors : { list: [], floorOf: {} }, floorOf = isObj(fl.floorOf) ? fl.floorOf : {};
    var isOpen = typeof o.isOpen === "function" ? o.isOpen : function () { return false; };
    var zones = list(play.zones).filter(isObj), zoneIx = {}, i;
    zones.forEach(function (z, zi) { list(z.rooms).forEach(function (r) { if (zoneIx[r] === undefined) zoneIx[r] = zi; }); });

    /* cards: every room of the roll, plus any room the play or the crew names that the roll lacks (they sit under "Elsewhere") */
    var cards = Object.create(null), order = [];
    var card = function (name) {
      if (typeof name !== "string" || !name) return null;
      if (!cards[name]) {
        var lvl = Object.prototype.hasOwnProperty.call(floorOf, name) && !isNaN(Number(floorOf[name])) ? Number(floorOf[name]) : null, zi = zoneIx[name];
        cards[name] = { name: name, lvl: lvl, zone: zi === undefined ? -1 : zi, zoneLabel: zi === undefined ? "" : str(zones[zi].label), open: !!isOpen(name), pcs: [], npcs: [], routes: [] };
        order.push(name);
      }
      return cards[name];
    };
    Object.keys(floorOf).forEach(card);

    var disguises = list(play.disguises).filter(isObj), lookerIds = {};
    disguises.forEach(function (d) { list(d.sees).forEach(function (id) { lookerIds[id] = true; }); });
    var disById = {}; disguises.forEach(function (d) { disById[d.id] = d; });

    /* the people who matter on the board: the target, the rival, contacts, and anyone a costume is seen through by */
    var places = B.placesAt(play, st, t);
    list(play.people).filter(isObj).forEach(function (p) {
      var w = places[p.id];
      if (!w || !w.room) return;
      if (!(p.kind === "target" || p.kind === "rival" || p.kind === "contact" || lookerIds[p.id])) return;
      var c = card(w.room); if (!c) return;
      c.npcs.push({ id: p.id, ini: initials(p.label), label: str(p.label), kind: str(p.kind), moving: w.moving ? { to: str(w.moving.to), inMin: w.moving.inMin } : null });
    });

    var crew = isObj(st.crew) ? st.crew : {}, tray = [], nowI = B.beatOf(play, timeOf(st)).i;
    list(o.pcs).forEach(function (pc) {
      var cw = isObj(crew[pc.id]) ? crew[pc.id] : {}, room = typeof cw.room === "string" ? cw.room : "";
      var d = disById[cw.disguise];
      var chip = { id: pc.id, name: str(pc.name), ini: initials(pc.name), icon: d ? iconOf(d.icon) : "", costume: d ? str(d.label) : "", pos: "", why: "", mark: "", looker: "", moved: cw.moved === nowI && room !== "" };
      if (!room) { tray.push(chip); return; }
      var p = B.positionOf(play, st, pc.id);
      chip.pos = p.pos; chip.why = p.why;
      var lk = B.lookers(play, st, pc.id, t);
      if (lk.here.length) { chip.mark = p.pos === "controlled" ? "eye" : "warn"; chip.looker = lk.here.map(function (x) { return x.label; }).join(", "); }
      var c = card(room); if (c) c.pcs.push(chip);
    });

    B.routesAt(play, t).forEach(function (r) {
      var a = card(r.from), b = card(r.to), timed = list(r.open).length > 0, until = "";
      if (timed) list(r.open).forEach(function (w) { var f = B.minuteOf(w.from, play.clock.start), e = B.minuteOf(w.to, play.clock.start); if (f <= t && t < e) until = B.timeLabel(play, e); });
      if (a) a.routes.push({ to: r.to, mark: ARROW[r.dir] || ARROW.both, timed: timed, until: until, out: true });
      if (b) b.routes.push({ to: r.from, mark: r.dir === "both" || !r.dir ? ARROW.both : "←", timed: timed, until: until, out: false });
    });

    var rows = [], seen = {};
    fl.list.slice().sort(function (a, b) { return b.lvl - a.lvl; }).forEach(function (f) {
      var cs = order.filter(function (n) { return cards[n].lvl === f.lvl; }).map(function (n) { return cards[n]; });
      if (cs.length) { rows.push({ lvl: f.lvl, name: str(f.name), cards: cs }); cs.forEach(function (c) { seen[c.name] = true; }); }
    });
    var rest = order.filter(function (n) { return !seen[n]; }).map(function (n) { return cards[n]; });
    if (rest.length) rows.push({ lvl: null, name: "Elsewhere", cards: rest });

    /* the track: a square a beat, the loudest event's icon on it (a skull for the rival, a star for public, a diamond otherwise) */
    var track = [], N = bo.of, rank = { skull: 3, star: 2, diamond: 1 };
    for (i = 0; i < N; i++) track.push({ i: i, t: i * beat, label: B.timeLabel(play, i * beat), icon: "", text: "", before: start !== null && (i + 1) * beat <= start, cur: started(st) && i === B.beatOf(play, timeOf(st)).i });
    list(play.events).filter(isObj).forEach(function (e) {
      var m = B.minuteOf(e.at, play.clock.start); if (isNaN(m)) return;
      var q = track[Math.min(N - 1, Math.max(0, Math.floor(m / beat)))], icon = e.rival ? "skull" : e.vis === "public" ? "star" : "diamond";
      if (!q.icon || rank[icon] > rank[q.icon]) q.icon = icon;
      q.text += (q.text ? " · " : "") + e.at + " " + str(e.label || e.pub);
    });
    function started(s) { return isStarted(s); }

    var alarm = isObj(play.alarm) && str(play.alarm.clock) ? { name: str(play.alarm.clock), size: list(play.alarm.beats).length } : null;
    return { t: t, label: B.timeLabel(play, t), beat: bo, beatLen: beat, started: isStarted(st), start: start, track: track, alarm: alarm, rows: rows, cards: cards, tray: tray };
  }

  /* ---- seams (shared) ---------------------------------------------------------------------------------------- */
  var players = { text: "Players: —", ok: false };
  var live = [];                       /* instances with a box on screen, so setPlayersChip reaches the chip without a redraw */
  function paintChip(box) {
    var c = box && box.querySelector ? box.querySelector(".rv-players") : null; if (!c) return;
    c.textContent = players.text; c.setAttribute("data-ok", players.ok ? "1" : "0");
  }
  function setPlayersChip(text, ok) { players = { text: str(text), ok: !!ok }; live.forEach(function (v) { paintChip(v.box()); }); }
  var menuItems = [], views = [], sections = [], hooks = { heard: null };
  /* the warnings line under the header (what a publish dropped from the players' cards); setWarnings reaches a live view without a redraw */
  var warnText = "";
  function paintWarn(box) {
    var w = box && box.querySelector ? box.querySelector(".rv-warn") : null, hd = box && box.querySelector ? box.querySelector(".rv-head") : null;
    if (!warnText) { if (w && w.parentNode) w.parentNode.removeChild(w); return; }
    if (!w && hd && hd.parentNode) { w = box.ownerDocument.createElement("p"); w.className = "rv-warn rv-dim"; w.setAttribute("role", "status"); hd.parentNode.insertBefore(w, hd.nextSibling); }
    if (w) w.textContent = warnText;
  }
  function setWarnings(text) { warnText = str(text).trim(); live.forEach(function (v) { paintWarn(v.box()); }); }
  /* a label may be a function of ctx (read when the menu is drawn) */
  menuItems.push({ id: "show-time", label: function (ctx) { return ctx.st.showTime === true ? "Hide the time from the players" : "Show the time to the players"; },
    run: function (ctx) { ctx.set({ showTime: ctx.st.showTime === true ? null : true }); ctx.rerender(); } });

  /* ---- the rooms, NPC names, heard (pure helpers; the sections use them) ---------------------------------------- */
  function sayBox(txt, who) { return '<div class="rv-say"><span class="rv-saylab">SAY</span> “' + esc(txt) + "”" + (who ? ' <small class="rv-dim">' + esc(who) + "</small>" : "") + "</div>"; }
  /* the names an NPC card may be filed under: the cast name first, then the play's label */
  function personNames(person) { return isObj(person) ? [person.npc, person.label].filter(function (v) { return typeof v === "string" && v.trim() !== ""; }) : []; }
  function personById(play, id) { return id == null ? null : list(isObj(play) ? play.people : []).filter(function (p) { return isObj(p) && p.id === id; })[0] || null; }
  function hasCard(ctx, person) { var h = isObj(ctx) ? ctx.host : null; return isObj(person) && !!h && typeof h.hasNpcCard === "function" && !!h.hasNpcCard(personNames(person)); }
  /* an NPC's name: a button that opens the card when the cast has one, else the plain text */
  function npcName(ctx, person, text) { return hasCard(ctx, person) ? '<button type="button" class="rv-npcname" data-rv="npc" data-id="' + esc(person.id) + '">' + esc(text) + "</button>" : esc(text); }
  /* the rooms the Rooms section shows: the room tapped, then every room a PC is in, top floor down */
  function roomsShown(model, sel) {
    var cards = isObj(model) && isObj(model.cards) ? model.cards : {}, out = [], has = function (n) { return typeof n === "string" && n !== "" && Object.prototype.hasOwnProperty.call(cards, n); };
    if (has(sel)) out.push(sel);
    list(isObj(model) ? model.rows : []).forEach(function (row) { list(isObj(row) ? row.cards : []).forEach(function (c) { if (isObj(c) && list(c.pcs).length && has(c.name) && out.indexOf(c.name) < 0) out.push(c.name); }); });
    return out;
  }
  /* everyone the play places in the room at t (any kind, not only the ones the board shows) */
  function peopleIn(play, st, t, room) {
    var places = B.placesAt(play, isObj(st) ? st : {}, t), out = [];
    list(play.people).filter(isObj).forEach(function (p) {
      var w = places[p.id]; if (!w || w.room !== room) return;
      out.push({ id: p.id, label: str(p.label), kind: str(p.kind), npc: str(p.npc), moving: w.moving ? { to: str(w.moving.to), inMin: w.moving.inMin } : null });
    });
    return out;
  }
  function eventsIn(play, st, t, room) { return list(B.beatCard(play, isObj(st) ? st : {}, t, t).items).filter(function (it) { return isObj(it) && it.type === "event" && it.room === room; }); }
  /* the leads in reach of these PCs, heard or not (so the GM can take one back), by way in play order */
  function reachIn(play, st, t, pcIds) {
    st = isObj(st) ? st : {};
    var ids = list(pcIds), hd = isObj(st.heard) ? st.heard : {}, un = isObj(st.unheard) ? st.unheard : {}, by = Object.create(null), order = [], wi = Object.create(null);
    list(play.ways).forEach(function (w, i) { if (isObj(w) && wi[w.id] === undefined) wi[w.id] = i; });
    B.leadsInReach(play, Object.assign({}, st, { heard: {} }), t).forEach(function (l) {
      if (ids.indexOf(l.pc) < 0) return;
      var g = by[l.way];
      if (!g) { g = by[l.way] = { way: l.way, line: l.line, who: l.who, name: l.name, pcs: [] }; order.push(l.way); }
      if (g.pcs.some(function (q) { return q.id === l.pc; })) return;
      var hw = isObj(hd[l.way]) ? hd[l.way] : {}, uw = isObj(un[l.way]) ? un[l.way] : {}, on = typeof hw[l.pc] === "number";
      g.pcs.push({ id: l.pc, heard: on, unheard: !!uw[l.pc], at: on ? hw[l.pc] : null });
    });
    var rank = function (w) { return wi[w] === undefined ? 1e9 : wi[w]; };
    return order.map(function (w, i) { return { w: w, i: i }; }).sort(function (a, b) { return rank(a.w) - rank(b.w) || a.i - b.i; }).map(function (x) { return by[x.w]; });
  }
  /* hear (heard = t, the take-back mark gone) or take it back (heard gone, unheard = true): one write; empty maps are null */
  function heardChange(st, way, pc, t) {
    st = isObj(st) ? st : {};
    var h = clone(isObj(st.heard) ? st.heard : {}), u = clone(isObj(st.unheard) ? st.unheard : {}), hw = isObj(h[way]) ? h[way] : null;
    if (hw && typeof hw[pc] === "number") {
      delete hw[pc]; if (!Object.keys(hw).length) delete h[way];
      (u[way] = isObj(u[way]) ? u[way] : {})[pc] = true;
    } else {
      (h[way] = isObj(h[way]) ? h[way] : {})[pc] = t;
      if (isObj(u[way])) { delete u[way][pc]; if (!Object.keys(u[way]).length) delete u[way]; }
    }
    return { heard: Object.keys(h).length ? h : null, unheard: Object.keys(u).length ? u : null };
  }
  /* a room name as the room notes and the cue fold it (gm/room-notes.js normRoom): NFKC, lower case, a leading "the " dropped, punctuation dropped */
  function normRoomName(s) {
    var n = str(s).normalize("NFKC").toLowerCase().replace(/^\s*the\s+/, "");
    try { n = n.replace(new RegExp("[\\p{P}\\p{S}]+", "gu"), " "); } catch (e) { n = n.replace(/[!-\/:-@\[-`{-~]+/g, " "); }
    return n.replace(/\s+/g, " ").trim();
  }
  /* the phones' move requests: one newer than the PC's mseq is folded in once, whether or not the PC has a crew entry yet (a PC in the tray, or after a
   * Reset, is an empty entry). The room is matched to the site's rooms by normRoomName and the canonical name used; an open room moves the PC (as a drag
   * does), any other is only marked seen (mseq stamped), so a later GM drag never replays it */
  function foldMoves(st, pcs, o) {
    st = isObj(st) ? st : {}; o = isObj(o) ? o : {};
    var crew = isObj(st.crew) ? st.crew : {}, notes = [], changed = false, rooms = list(o.rooms), isOpen = typeof o.isOpen === "function" ? o.isOpen : function () { return false; };
    list(pcs).forEach(function (pc) {
      var id = isObj(pc) ? str(pc.id) : "", mr = isObj(pc) ? pc.moveReq : null;
      if (!id || !isObj(mr) || typeof mr.room !== "string" || !mr.room || typeof mr.seq !== "number" || !isFinite(mr.seq)) return;
      var cur = isObj(crew[id]) ? crew[id] : {};
      if (!(mr.seq > (+cur.mseq || 0))) return;
      var want = normRoomName(mr.room), canon = rooms.filter(function (r) { return typeof r === "string" && normRoomName(r) === want; })[0] || "", go = !!canon && !!isOpen(canon);
      crew = go ? moveCrew({ crew: crew }, id, canon, o.beat) : clone(crew);
      crew[id] = Object.assign({}, crew[id] || {}, { mseq: mr.seq });
      changed = true;
      notes.push({ pc: id, name: str(pc.name), room: canon || mr.room, moved: go });
    });
    return changed ? { crew: crew, notes: notes } : null;
  }

  /* ---- the view ---------------------------------------------------------------------------------------------- */
  function create(host) {
    var boxEl = null, peekT = null, sel = "", arm = "", drag = null, noClick = false, alarmOpen = false, mq = null, npcOpen = null;
    var self = { box: function () { return boxEl; } };
    var mapViewState = {}, mapZoom = null;    /* the Map view's zoom { s, cx, cy, key }, kept across redraws */

    function site() { return host.site(); }
    function ctxFor(rs, st, m, shownT) {
      var ctx = { play: rs.play, st: st, model: m, t: timeOf(st), shownT: shownT, peeking: peekT !== null, host: host, sel: sel, esc: esc,
        set: function (c) { return host.set(c); }, select: function (r) { sel = r; self.rerender(); }, rerender: function () { self.rerender(); }, toast: function (a, b) { host.toast(a, b); } };
      return ctx;
    }
    function build() {
      var rs = site(); if (!rs) return null;
      var st = host.state(), shownT = peekT !== null ? peekT : timeOf(st);
      var m = model(rs.play, st, { t: shownT, pcs: host.pcs(), floors: host.floors(), isOpen: host.isOpen });
      /* VV5: ctx is filled here (it was null, so a click that read build().ctx got nothing) */
      return { rs: rs, st: st, m: m, shownT: shownT, ctx: ctxFor(rs, st, m, shownT) };
    }

    /* the header */
    /* the beat's countdown (ball.timer, worked out by ball.js): a night started before it has none, so the default shows paused until the first Start */
    var nowMs = function () { return typeof host.now === "function" ? host.now() : Date.now(); };
    function timerShown(p, st) { return isObj(st) && isObj(st.timer) ? st.timer : B.timerNext(p, null, "reset", nowMs()); }
    function timerLook(tm, now) {
      var l = B.timerLeft(tm, now), paused = !(tm.paused !== true && typeof tm.endsAt === "number");
      return { l: l, paused: paused, cls: "rv-tleft" + (l <= 0 ? " zero" : l < 60 ? " warn" : "") + (paused ? " paused" : "") };
    }
    function timerHtml(p, st) {
      var tm = timerShown(p, st), v = timerLook(tm, nowMs());
      return '<span class="rv-timer" role="group" aria-label="The beat timer"><output class="' + v.cls + '" data-rvtimer aria-label="Time left in this beat">' + B.timerText(v.l) + '</output>' +
        '<button type="button" class="rv-btn sm" data-rv="tgo">' + (v.paused ? "Start" : "Pause") + '</button>' +
        '<button type="button" class="rv-btn sm" data-rv="tadd1">+1 min</button><button type="button" class="rv-btn sm" data-rv="tadd5">+5 min</button>' +
        '<button type="button" class="rv-btn sm" data-rv="treset" title="Back to the full length, paused">Reset</button>' +
        '<input class="rv-tlen" type="number" min="1" max="120" data-rv="tlen" value="' + Math.round(tm.len / 60) + '" aria-label="Timer length in minutes" title="Timer length in minutes. Default is the play\'s clock.real, else 6."></span>';
    }
    function headHtml(x) {
      var m = x.m, p = x.rs.play, st = x.st, nowT = timeOf(st), nowBeat = B.beatOf(p, nowT), h = '<div class="rv-head">';
      if (!m.started) {
        var opts = startMinutes(p);
        h += '<div class="rv-start" role="group" aria-label="Start the night"><b>Start the night</b> <span class="rv-dim">the engagement result sets the clock</span><span class="rv-startbtns">';
        if (opts.length) opts.forEach(function (o) { h += '<button type="button" class="rv-btn" data-rv="start" data-key="' + esc(o.key) + '" data-t="' + o.t + '">' + esc(o.label) + ' <small>' + esc(o.at) + '</small></button>'; });
        else h += '<button type="button" class="rv-btn" data-rv="start" data-key="open" data-t="0">Start at ' + esc(p.clock.start) + '</button>';
        h += '</span></div>';
      } else {
        h += '<button type="button" class="rv-btn rv-step" data-rv="back" aria-label="Back a beat" title="Back a beat (Left)"' + (stepTime(p, st, -1) === null ? " disabled" : "") + '>◀</button>' +
          '<output class="rv-time" id="rv-time" aria-label="Published time">' + esc(B.timeLabel(p, nowT)) + '</output>' +
          '<button type="button" class="rv-btn rv-step" data-rv="next" aria-label="Next beat" title="Next beat (Right)"' + (stepTime(p, st, 1) === null ? " disabled" : "") + '>▶</button>' +
          '<span class="rv-beat">beat ' + nowBeat.n + ' of ' + nowBeat.of + '</span>' + timerHtml(p, st);
      }
      h += '<div class="rv-track" role="group" aria-label="The night, a square a beat">' + m.track.map(function (q) {
        var cls = "rv-sq" + (q.before ? " before" : "") + (q.cur ? " cur" : "") + (peekT !== null && q.t === peekT ? " peek" : "") + (q.i * m.beatLen < nowT && !q.cur && m.started && !q.before ? " done" : "");
        var glyph = q.icon === "skull" ? "☠" : q.icon === "star" ? "★" : q.icon === "diamond" ? "◆" : "";
        return '<button type="button" class="' + cls + '" data-rv="peek" data-i="' + q.i + '"' + (q.before || !m.started ? " disabled" : "") + ' title="' + esc(q.label + (q.text ? " · " + q.text : "")) + '" aria-label="Look at ' + esc(q.label) + (q.text ? ", " + esc(q.text) : "") + '">' +
          '<span class="rv-ic" data-icon="' + esc(q.icon) + '">' + glyph + '</span></button>';
      }).join("") + "</div>";
      if (m.alarm) {
        var ck = host.clockNamed(m.alarm.name), filled = ck ? Math.max(0, +ck.filled || 0) : 0, size = ck && +ck.size > 0 ? +ck.size : m.alarm.size;
        h += '<button type="button" class="rv-alarm" data-rv="alarm" aria-expanded="' + alarmOpen + '" title="' + esc(ck ? "Tap for what this beat of the alarm does" : "No table clock is named " + m.alarm.name) + '">' +
          '<span class="rv-pie" style="--f:' + (size ? Math.round(filled / size * 100) : 0) + '%"></span> ' + esc(m.alarm.name) + ' <b>' + filled + "/" + size + "</b></button>";
      }
      h += '<span class="rv-chip rv-players" data-ok="' + (players.ok ? 1 : 0) + '">' + esc(players.text) + "</span>";
      if (m.started) h += '<button type="button" class="rv-btn sm rv-reset" data-rv="reset" title="Back to Start the night; asks first">Reset the night</button>';
      if (menuItems.length) h += '<button type="button" class="rv-btn" data-rv="menu" aria-haspopup="true" aria-label="Run menu">⋯</button>';
      h += "</div>";
      if (m.alarm && alarmOpen) {
        var f2 = host.clockNamed(m.alarm.name), n2 = f2 ? Math.max(0, +f2.filled || 0) : 0, bt = n2 > 0 ? str(list(x.rs.play.alarm.beats)[n2 - 1]) : "";
        h += '<p class="rv-alarmtext" role="status">' + (n2 > 0 ? "<b>" + esc(m.alarm.name) + " " + n2 + ":</b> " + esc(bt || "(nothing written for this beat)") : esc(m.alarm.name) + " has not started.") + "</p>";
      }
      return h;
    }

    /* the board view */
    function chipHtml(c, inTray) {
      var cls = "rv-pc" + (arm === c.id ? " armed" : "") + (c.moved ? " moved" : "");
      return '<button type="button" class="' + cls + '" data-rv="pc" data-id="' + esc(c.id) + '" aria-pressed="' + (arm === c.id) + '" title="' + esc(c.name) + '">' +
        '<span class="rv-ini">' + esc(c.ini) + "</span>" +
        (inTray ? '<span class="rv-nm">' + esc(c.name) + "</span>" : "") + "</button>";
    }
    function boardView(box, ctx) {
      var m = ctx.model, h = "", byId = {};
      list(ctx.play.people).forEach(function (p) { if (isObj(p)) byId[p.id] = p; });
      if (m.tray.length) h += '<div class="rv-tray" data-room="" role="group" aria-label="Crew not on the board"><span class="rv-lab">Not placed</span>' + m.tray.map(function (c) { return chipHtml(c, true); }).join("") + "</div>";
      if (arm) h += '<p class="rv-arm" role="status">Tap a room to move ' + esc(nameOfPc(arm, ctx)) + ' there. <button type="button" class="rv-btn sm" data-rv="disarm">Cancel</button></p>';
      m.rows.forEach(function (row) {
        h += '<div class="rv-row"><div class="rv-floor">' + esc(row.name) + '</div><div class="rv-cards">' + row.cards.map(function (c) {
          var cls = "rv-card z" + (c.zone < 0 ? "x" : c.zone % 6) + (c.open ? " open" : " fog") + (sel === c.name ? " sel" : "");
          return '<div class="' + cls + '" data-rv="room" data-room="' + esc(c.name) + '" role="button" tabindex="0" aria-label="' + esc(c.name + (c.open ? "" : ", not open to the players")) + '">' +
            '<div class="rv-cn">' + esc(c.name) + (c.zoneLabel ? ' <small>' + esc(c.zoneLabel) + "</small>" : "") + "</div>" +
            '<div class="rv-chips">' + c.pcs.map(function (p) { return chipHtml(p, false); }).join("") +
            c.npcs.map(function (n) { var tag = hasCard(ctx, byId[n.id]) ? "button" : "span"; return "<" + tag + (tag === "button" ? ' type="button" data-rv="npc" data-id="' + esc(n.id) + '"' : "") + ' class="rv-npc k-' + esc(n.kind) + '" title="' + esc(n.label + " (" + n.kind + ")" + (n.moving ? " → " + n.moving.to + " in " + n.moving.inMin + " min" : "")) + '"><span class="rv-ini">' + esc(n.ini) + "</span>" + (n.kind === "target" ? "★" : n.kind === "rival" ? "☠" : "") + "</" + tag + ">"; }).join("") + "</div>" +
            (c.routes.length ? '<div class="rv-routes">' + c.routes.map(function (r) { return '<span class="rv-route' + (r.timed ? " timed" : "") + '" title="' + esc(r.timed ? "A passage" + (r.until ? ", open until " + r.until : "") : "A route") + '">' + (r.timed ? "⏱ " : "") + esc(r.mark) + " " + esc(r.to) + (r.until ? " <small>to " + esc(r.until) + "</small>" : "") + "</span>"; }).join("") + "</div>" : "") +
            "</div>";
        }).join("") + "</div></div>";
      });
      box.innerHTML = h || '<p class="rv-empty">The roll has no rooms to show.</p>';
    }
    function nameOfPc(id, ctx) { var n = ""; list(host.pcs()).forEach(function (p) { if (p.id === id) n = p.name; }); return n || id; }
    function mapView(box) {
      var svg = host.mapSvg();
      if (mapZoom) { mapZoom.destroy(); mapZoom = null; }
      box.innerHTML = svg ? '<div class="rv-map" id="rv-map">' + svg + "</div>" : '<p class="rv-empty">The map could not be drawn.</p>';
      /* zoom and pan (mapzoom.js); the view lives in mapViewState so the redraw on each time step keeps it */
      var MZ = typeof window !== "undefined" ? window.B68MapZoom : null, fr = box.querySelector("#rv-map"), el = fr && fr.querySelector("svg");
      if (MZ && el) { try { mapZoom = MZ.attach(fr, el, { store: mapViewState }); } catch (e) { mapZoom = null; /* the map still reads, unzoomed */ } }
    }

    /* the rooms (the top of the right column): the room tapped, then every room a PC is in; who is there, what happens, the leads in reach, the prep note */
    function roomsSection(box, ctx) {
      var m = ctx.model, shown = roomsShown(m, ctx.sel), byId = {};
      if (!shown.length) { box.innerHTML = '<h3 class="rv-sh">Rooms</h3><p class="rv-dim">Nobody is placed yet. Tap a room to see it.</p>'; return; }
      list(ctx.play.people).forEach(function (p) { if (isObj(p)) byId[p.id] = p; });
      var h = "";
      shown.forEach(function (name) {
        var c = m.cards[name], tapped = name === ctx.sel, ppl = peopleIn(ctx.play, ctx.st, ctx.shownT, name), evs = eventsIn(ctx.play, ctx.st, ctx.shownT, name);
        var reach = reachIn(ctx.play, ctx.st, ctx.shownT, c.pcs.map(function (p) { return p.id; }));
        h += '<div class="rv-rm' + (tapped ? " sel" : "") + '" data-room="' + esc(name) + '"><h3 class="rv-sh">' + esc(c.name) + (c.zoneLabel ? ' <small>' + esc(c.zoneLabel) + "</small>" : "") + "</h3>" +
          '<p class="rv-open ' + (c.open ? "yes" : "no") + '">' + (c.open ? "Open to the players" : "Not open to the players") + "</p>" +
          '<p class="rv-rmpcs"><span class="rv-lab">PCs</span> ' + (c.pcs.length ? c.pcs.map(function (p) { return "<b>" + esc(p.name) + "</b>"; }).join(", ") : '<span class="rv-dim">none</span>') + "</p>";
        h += '<h4 class="rv-lab">Who&#39;s here</h4><ul class="rv-who">' + (ppl.length ? ppl.map(function (p) {
          return '<li class="npc">' + npcName(ctx, byId[p.id], p.label || p.npc || p.id) + " <small>" + esc(p.kind) + "</small>" + (p.moving ? " → " + esc(p.moving.to) + " in " + p.moving.inMin + " min" : "") + "</li>";
        }).join("") : '<li class="rv-dim">Nobody.</li>') + "</ul>";
        if (evs.length) h += '<h4 class="rv-lab">Happening</h4>' + evs.map(function (e) { return '<div class="rv-hap"><b>' + esc(e.at) + "</b> " + esc(e.label || e.pub) + (e.say ? sayBox(e.say) : "") + "</div>"; }).join("");
        if (reach.length) {
          h += '<h4 class="rv-lab">In reach</h4>';
          reach.forEach(function (l) {
            h += sayBox(l.line, l.who) + '<div class="rv-heard">' + l.pcs.map(function (q) {
              return '<button type="button" class="rv-btn sm rv-tog" data-rv="unhear" data-way="' + esc(l.way) + '" data-pc="' + esc(q.id) + '" aria-pressed="' + q.heard + '" title="' + (q.heard ? "Tap to un-hear" : "Tap to hear") + '">' +
                esc(nameOfPc(q.id, ctx)) + (q.heard ? " heard ✓ " + esc(B.timeLabel(ctx.play, q.at)) : " not heard") + "</button>";
            }).join(" ") + "</div>";
          });
        }
        if (typeof host.roomNote === "function") {
          var note = null; try { note = host.roomNote(name); } catch (e) { note = null; }
          h += typeof note === "string" ? '<div class="rv-rmnote pp-doc pp-cardbody">' + note + "</div>"       /* the page's renderer made it from the prep note */
            : '<p class="rv-dim rv-nonote">No notes for ' + esc(name) + ': add <code>### ' + esc(name) + "</code> under <code>## Rooms</code> in the prep note.</p>";
        }
        if (tapped) {
          var bo = list(ctx.st.open);
          h += '<div class="rv-acts">';
          if (!c.open) h += '<button type="button" class="rv-btn" data-rv="open" data-room="' + esc(c.name) + '">Open for the players</button>';
          else if (bo.indexOf(c.name) >= 0) h += '<button type="button" class="rv-btn" data-rv="close" data-room="' + esc(c.name) + '">Close for the players</button>';
          list(host.pcs()).forEach(function (p) { if (!c.pcs.some(function (q) { return q.id === p.id; })) h += '<button type="button" class="rv-btn" data-rv="move" data-id="' + esc(p.id) + '" data-room="' + esc(c.name) + '">Move ' + esc(p.name) + " here</button>"; });
          h += "</div>";
        }
        h += "</div>";
      });
      box.innerHTML = h;
      if (typeof host.decorate === "function") Array.prototype.forEach.call(box.querySelectorAll(".rv-rmnote"), function (el) { try { host.decorate(el); } catch (e) { /* the note still reads */ } });
      try { lightNow(box, ctx); } catch (e) { /* the note still reads, unlit */ }
    }

    /* the pane */
    self.rerender = function () { if (boxEl) self.render(boxEl); if (crewEl && crewEl.isConnected && crewEl.offsetParent !== null) { var fa = crewEl.ownerDocument && crewEl.ownerDocument.activeElement; if (!(fa && fa.tagName === "SELECT" && crewEl.contains(fa))) self.crewInto(crewEl); } };
    self.render = function (box) {
      boxEl = box;
      if (live.indexOf(self) < 0) live.push(self);
      var x = build();
      if (!x) { box.innerHTML = ""; return; }
      var ctx = x.ctx = ctxFor(x.rs, x.st, x.m, x.shownT), vid = str(x.st.view) || "board", vs = [{ id: "board", label: "Board", render: boardView }, { id: "map", label: "Map", render: mapView }].concat(views);
      var v = vs.filter(function (q) { return q.id === vid; })[0] || vs[0];
      var secs = [{ id: "room", order: -10, render: roomsSection }].concat(sections).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var peekBar = peekT !== null ? '<div class="rv-peekbar" role="status">Looking at <b>' + esc(B.timeLabel(x.rs.play, peekT)) + '</b> <button type="button" class="rv-btn sm" data-rv="unpeek">Back to now</button> <span class="rv-dim">The players are not told.</span></div>' : "";
      box.innerHTML = headHtml(x) + (warnText ? '<p class="rv-warn rv-dim" role="status">' + esc(warnText) + "</p>" : "") +
        '<div class="rv-body' + (v.id === "map" ? " mapview" : "") + '"><div class="rv-main' + (peekT !== null ? " peeking" : "") + '">' +
        '<div class="rv-views" role="group" aria-label="View">' + vs.map(function (q) { return '<button type="button" class="chip sm" data-rv="view" data-v="' + esc(q.id) + '" aria-pressed="' + (q.id === v.id) + '">' + esc(q.label) + "</button>"; }).join("") + "</div>" + peekBar +
        '<div class="rv-view" id="rv-view" data-view="' + esc(v.id) + '"></div></div>' +
        '<aside class="rv-side" aria-label="The room and the beat">' + secs.map(function (s) { return '<section class="rv-sec" data-sec="' + esc(s.id) + '"></section>'; }).join("") + "</aside></div>" +
        '<ul class="rv-menu" id="rv-menu" hidden>' + menuItems.map(function (it, i) { return '<li><button type="button" class="rv-btn" data-rv="menuitem" data-i="' + i + '">' + esc(typeof it.label === "function" ? it.label(ctx) : it.label) + "</button></li>"; }).join("") + "</ul>" + npcPop();
      if (v.id !== "map" && mapZoom) { mapZoom.destroy(); mapZoom = null; }
      try { v.render(box.querySelector("#rv-view"), ctx); } catch (e) { box.querySelector("#rv-view").textContent = "This view could not be drawn: " + (e && e.message || e); }
      secs.forEach(function (s) {
        var el = box.querySelector('.rv-sec[data-sec="' + s.id + '"]');
        try { s.render(el, ctx); } catch (e) { el.textContent = "This section could not be drawn: " + (e && e.message || e); }
      });
      paintChip(box);
      var pop = box.querySelector(".rv-npcpop");
      if (pop) {
        if (typeof host.decorate === "function") { try { host.decorate(pop.querySelector(".rv-npcbody")); } catch (e) { /* the card still reads */ } }
        /* beside the right column; a phone gets the CSS bottom sheet */
        try { var side = box.querySelector("aside.rv-side"); if (side && typeof window !== "undefined" && window.innerWidth > 760) pop.style.right = Math.max(8, window.innerWidth - side.getBoundingClientRect().left + 8) + "px"; } catch (e2) { /* the CSS places it */ }
      }
    };

    /* actions */
    function atTime(t, why, extra) { if (host.set(Object.assign({ t: t }, extra || {}))) host.publish(t, why); self.rerender(); }
    /* the timer is written paused with the start: it never runs before Start the night */
    function startNight(t) { var rs = site(); if (host.set({ v: 2, start: t, t: t, timer: B.timerNext(rs ? rs.play : null, null, "reset", nowMs()) })) host.publish(t, "start"); peekT = null; self.rerender(); }
    /* a manual step restarts the countdown for the new beat, running or paused as it was; a night with no ball.timer writes none */
    function restartFor(play, st) { return isObj(st) && isObj(st.timer) ? { timer: B.timerNext(play, st, "restart", nowMs()) } : null; }
    function timerDo(op, arg) { var rs = site(); if (!rs) return; var st = host.state(); if (!isStarted(st)) return; if (host.set({ timer: B.timerNext(rs.play, st, op, nowMs(), arg) }) && typeof host.publish === "function") host.publish(timeOf(host.state()), "timer"); self.rerender(); }   /* ballSet already queues the mission publish; this keeps the call site explicit */
    function onTimerLen(ev) {
      var el = ev.target; if (!el || !el.matches || !el.matches('[data-rv="tlen"]') || !boxEl || !boxEl.contains(el)) return;
      var v = +el.value; if (!(v >= 1)) { self.rerender(); return; }
      timerDo("len", Math.min(120, Math.round(v)) * 60);
    }
    /* every second: the [data-rvtimer] text without a rerender, then a step when due (never while peeking: the first tick after the peek steps) */
    var timerId = null;
    function timerTick() {
      var rs = boxEl ? site() : null; if (!rs) return;
      var now = nowMs(), look = timerLook(timerShown(rs.play, host.state()), now), els = boxEl.querySelectorAll ? boxEl.querySelectorAll("[data-rvtimer]") : [];
      for (var i = 0; i < els.length; i++) { els[i].textContent = B.timerText(look.l); els[i].className = look.cls; }
      if (peekT !== null) return;
      var st = host.state(); if (!B.timerDue(st, now)) return;      /* read again: a second tick or another device that stepped does nothing */
      var t = stepTime(rs.play, st, 1);
      if (t === null) { if (host.set({ timer: B.timerNext(rs.play, st, "stop", now) })) host.toast("Last beat: the timer stopped."); self.rerender(); return; }
      atTime(t, "beat", { timer: B.timerNext(rs.play, st, "restart", now) });
    }
    function placeAt(pc, room) {
      var rs = site(); if (!rs) return;
      var st = host.state(), bi = B.beatOf(rs.play, timeOf(st)).i;
      if (host.set({ crew: moveCrew(st, pc, room, bi) })) { arm = ""; sel = room; }
      self.rerender();
    }
    self.step = function (dir) { var rs = site(); if (!rs) return false; var st = host.state(), t = stepTime(rs.play, st, dir); if (t === null) return false; peekT = null; atTime(t, "beat", restartFor(rs.play, st)); return true; };
    self.jump = function () { var rs = site(); if (!rs) return false; var st = host.state(), t = jumpTime(rs.play, st); if (t === null) { host.toast("Nothing more happens tonight."); return false; } peekT = null; atTime(t, "jump", restartFor(rs.play, st)); return true; };
    self.peek = function (t) { var rs = site(); if (!rs) return; var st = host.state(); peekT = isStarted(st) && t !== timeOf(st) ? t : null; self.rerender(); };
    self.tick = timerTick;                                /* the 1 s tick, for the tests */
    self.unpeek = function () { if (peekT === null) return false; peekT = null; self.rerender(); return true; };
    self.peeking = function () { return peekT !== null; };
    /* VV12: ask, clear the players' mission, then un-start the ball (site, floor and open stay); a failed mission write is said and the ball still resets */
    self.resetNight = function () {
      var rs = site(); if (!rs || !isStarted(host.state())) return Promise.resolve(false);
      if (typeof host.confirm !== "function" || !host.confirm(RESET_ASK)) return Promise.resolve(false);
      var old = host.state(), key = str(old.site || rs.name) + "|" + old.start;
      return Promise.resolve(typeof host.resetMission === "function" ? host.resetMission() : null).then(null, function () { return null; }).then(function () {
        var ok = host.set(resetChange(host.state(), host.pcs()));
        if (!ok) { host.toast("Could not reset the night: the state was not saved, so the night is still running. The players' screens were cleared until the next beat.", true); self.rerender(); return false; }
        try { if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("b68-rv-pace|" + key); } catch (e) { /* page-local anyway */ }
        pace = null; ui5.prev = null; ui5.ways = {}; ui5.more = {};
        self.reset(); self.rerender(); return true;
      });
    };
    self.reset = function () { peekT = null; sel = ""; arm = ""; drag = null; npcOpen = null; };
    /* the NPC card beside the right column: a name tapped, or a #pp: link in a room note (the page) */
    self.showNpc = function (names, title) { var ns = list(names).map(str).filter(Boolean); if (!ns.length) return false; npcOpen = { names: ns, title: str(title) || ns[0] }; self.rerender(); return true; };
    self.closeNpc = function () { if (!npcOpen) return false; npcOpen = null; self.rerender(); return true; };
    function npcPop() {
      if (!npcOpen) return "";
      var html = ""; try { html = typeof host.npcCard === "function" ? str(host.npcCard(npcOpen.names)) : ""; } catch (e) { html = ""; }
      if (!html) { npcOpen = null; return ""; }           /* no card after all: no popover */
      return '<div class="rv-npcpop" role="dialog" aria-label="NPC card"><header><b>' + esc(npcOpen.title) + '</b><button type="button" class="rv-btn sm" data-rv="npcx" aria-label="Close">×</button></header><div class="pp-doc pp-cardbody rv-npcbody">' + html + "</div></div>";
    }

    function onClick(ev) {
      if (noClick) { noClick = false; ev.preventDefault(); return; }
      var el = ev.target.closest ? ev.target.closest("[data-rv]") : null;
      if (!el || !boxEl.contains(el)) return;
      var a = el.getAttribute("data-rv"), rs = site(); if (!rs) return;
      switch (a) {
        case "start": startNight(+el.getAttribute("data-t") || 0); break;
        case "back": self.step(-1); break;
        case "next": self.step(1); break;
        case "peek": { var i = +el.getAttribute("data-i"); self.peek(i * beatLen(rs.play)); break; }
        case "unpeek": self.unpeek(); break;
        case "reset": self.resetNight(); break;
        case "alarm": alarmOpen = !alarmOpen; self.rerender(); break;
        case "tgo": { var tst = host.state(), trun = isObj(tst) && isObj(tst.timer) && tst.timer.paused !== true && typeof tst.timer.endsAt === "number"; timerDo(trun ? "pause" : "start"); break; }
        case "tadd1": timerDo("add", 60); break;
        case "tadd5": timerDo("add", 300); break;
        case "treset": timerDo("reset"); break;
        case "tlen": break;                                  /* the length box: its change listener does the work */
        case "view": host.set({ view: el.getAttribute("data-v") === "board" ? null : el.getAttribute("data-v") }, true); self.rerender(); break;
        case "pc": {
          var id = el.getAttribute("data-id"), card = el.closest(".rv-card");
          if (arm && arm !== id && card) { placeAt(arm, card.getAttribute("data-room")); break; }      /* a chip tapped while another is armed is the room it sits in */
          arm = arm === id ? "" : id; self.rerender(); break;
        }
        case "disarm": arm = ""; self.rerender(); break;
        case "room": {
          var room = el.getAttribute("data-room");
          if (arm) placeAt(arm, room); else { sel = room; self.rerender(); }
          break;
        }
        case "move": placeAt(el.getAttribute("data-id"), el.getAttribute("data-room")); break;
        case "open": host.openRoom(el.getAttribute("data-room"), true); self.rerender(); break;
        case "close": host.openRoom(el.getAttribute("data-room"), false); self.rerender(); break;
        case "heard": case "unhear": {
          var way = el.getAttribute("data-way"), pc = el.getAttribute("data-pc");
          if (typeof hooks.heard === "function") hooks.heard(way, pc, build().ctx); else host.toast("Heard by is wired in the next ticket.");
          break;
        }
        case "npc": {
          var pid = el.getAttribute("data-id"), who = list(rs.play.people).filter(function (q) { return isObj(q) && str(q.id) === pid; })[0];
          if (who) { npcOpen = { names: personNames(who), title: str(who.label || who.npc) }; self.rerender(); }
          break;
        }
        case "npcx": npcOpen = null; self.rerender(); break;
        case "menu": { var mu = boxEl.querySelector("#rv-menu"); if (mu) mu.hidden = !mu.hidden; break; }
        case "menuitem": { var it = menuItems[+el.getAttribute("data-i")]; var mu2 = boxEl.querySelector("#rv-menu"); if (mu2) mu2.hidden = true; if (it && typeof it.run === "function") it.run(build().ctx); break; }
      }
    }
    function onKeyCard(ev) {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches && ev.target.matches(".rv-card")) { ev.preventDefault(); ev.target.click(); }
    }

    /* drag and drop with pointer events: a chip over a room card */
    function dropRoom(x, y) {
      var e = boxEl.ownerDocument.elementFromPoint(x, y), c = e && e.closest ? e.closest(".rv-card[data-room]") : null;
      return c ? c.getAttribute("data-room") : "";
    }
    function onDown(ev) {
      if (ev.button > 0 || !ev.target.closest) return;
      var chip = ev.target.closest(".rv-pc[data-id]"); if (!chip || !boxEl.contains(chip)) return;
      drag = { id: chip.getAttribute("data-id"), x: ev.clientX, y: ev.clientY, ghost: null, moved: false, pid: ev.pointerId, label: chip.textContent };
      var d = boxEl.ownerDocument;
      d.addEventListener("pointermove", onMove); d.addEventListener("pointerup", onUp); d.addEventListener("pointercancel", onCancel);
    }
    function onMove(ev) {
      if (!drag || ev.pointerId !== drag.pid) return;
      var d = boxEl.ownerDocument;
      if (!drag.moved) {
        if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) < 8) return;
        drag.moved = true;
        drag.ghost = d.createElement("div"); drag.ghost.className = "rv-ghost"; drag.ghost.textContent = initials(nameOfPc(drag.id)); d.body.appendChild(drag.ghost);
      }
      drag.ghost.style.left = ev.clientX + "px"; drag.ghost.style.top = ev.clientY + "px";
      boxEl.querySelectorAll(".rv-card.target").forEach(function (c) { c.classList.remove("target"); });
      var r = dropRoom(ev.clientX, ev.clientY), el = r ? boxEl.querySelector('.rv-card[data-room="' + r.replace(/"/g, "") + '"]') : null;
      if (el) el.classList.add("target");
    }
    function endDrag() {
      var d = boxEl.ownerDocument;
      d.removeEventListener("pointermove", onMove); d.removeEventListener("pointerup", onUp); d.removeEventListener("pointercancel", onCancel);
      if (drag && drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      var was = drag; drag = null; return was;
    }
    function onUp(ev) {
      if (!drag || ev.pointerId !== drag.pid) return;
      var was = endDrag();
      if (!was.moved) return;
      noClick = true; setTimeout(function () { noClick = false; }, 0);          /* the click that ends a drag is not a tap */
      var room = dropRoom(ev.clientX, ev.clientY);
      if (room) placeAt(was.id, room); else self.rerender();
    }
    function onCancel() { if (drag) { endDrag(); self.rerender(); } }

    /* the crew lines into a box of the page's drawer: the same section the right column used to carry. A change redraws the box (and the pane, when it is on screen). */
    var crewEl = null;
    self.crewInto = function (box) {
      crewEl = box; var x = build(); if (!x) { box.innerHTML = ""; return false; }
      var ctx = ctxFor(x.rs, x.st, x.m, x.shownT); ctx.rerender = function () { self.rerender(); };
      try { crewSection(box, ctx); } catch (e) { box.textContent = "The crew could not be drawn: " + (e && e.message || e); }
      return true;
    };
    self.attach = function (box) {
      boxEl = box;
      box.addEventListener("click", onClick); box.addEventListener("change", onTimerLen); box.addEventListener("keydown", onKeyCard); box.addEventListener("pointerdown", onDown);
      /* the beat timer's tick; visibilitychange catches up after a sleep (the tests build a fake box, so both are guarded) */
      if (typeof setInterval === "function" && timerId === null) { timerId = setInterval(timerTick, 1000); if (timerId && timerId.unref) timerId.unref(); }
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", timerTick);
    };
    self.dragging = function () { return !!(drag && drag.moved); };
    self.detach = function () {
      if (mapZoom) { mapZoom.destroy(); mapZoom = null; }
      var i = live.indexOf(self); if (i >= 0) live.splice(i, 1);
      if (timerId !== null) { clearInterval(timerId); timerId = null; }
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", timerTick);
    };
    return self;
  }

  /* ==== VV5 BEGIN: This beat, the crew, the job, intel (design 5.2). Registered through `sections` and `hooks.heard`; the view above does not know them. ==== */
  var pace = null;                       /* { key, at } page-local: the wall clock when this page first saw the night started (never written to the state) */
  var ui5 = { ways: {}, intel: false, more: {}, prev: null };    /* ways opened, the intel fold, "More" opened, the last published time seen */

  /* a person's stops as stopsV2 indexes them (the sorted list that has a usable time): [{ j, t, at, room, with, gone }] */
  function sortedStops(person, start) {
    var arr = list(isObj(person) ? person.stops : []).filter(isObj).map(function (s, i) { return { s: s, i: i, t: B.minuteOf(s.at, start) }; }).filter(function (x) { return !isNaN(x.t); });
    arr.sort(function (a, b) { return a.t - b.t || a.i - b.i; });
    return arr.map(function (x, j) { return { j: j, t: x.t, at: str(x.s.at), priv: x.s.private === true, room: typeof x.s.room === "string" ? x.s.room : "", "with": typeof x.s["with"] === "string" ? x.s["with"] : "", gone: x.s.gone === true }; });
  }
  /* the first change of room after t for each id, scanning minute by minute with the overrides applied: { <id>: { at, room|null } | null }
   * (room null is "gone"). Scans two beats past the end of the night so the last stops still show. */
  function scanChanges(play, st, ids, t) {
    var out = {}, cur = {}, p0 = B.placesAt(play, st, t), span = B.minuteOf(play.clock.end, play.clock.start), end = (isNaN(span) ? 1440 : span) + beatLen(play) * 2, left = ids.length;
    ids.forEach(function (id) { out[id] = null; cur[id] = p0[id] ? p0[id].room : null; });
    for (var m = t + 1; m <= end && left > 0; m++) {
      var pl = B.placesAt(play, st, m);
      ids.forEach(function (id) {
        if (out[id]) return;
        var r = pl[id] ? pl[id].room : null;
        if (r !== cur[id]) { out[id] = { at: m, room: r }; left--; }
      });
    }
    return out;
  }
  /* is the stop one the players could know of: a public event, or one that a told intel item reveals, at that minute (and room) */
  function stopKnown(view, at, room) {
    return !!view && list(view.events).some(function (e) { return e.at === at && (e.room === room || e.room === undefined) && (e.vis === "public" || (isObj(e.aud) && (e.aud.crew || list(e.aud.pcs).length > 0))); });
  }
  function targetOf(play) { return list(play.people).filter(function (p) { return isObj(p) && p.kind === "target"; })[0] || null; }
  function rivalOf(play) { return list(play.people).filter(function (p) { return isObj(p) && p.kind === "rival"; })[0] || null; }
  function pcName5(id, ctx) { var n = ""; list(ctx.host.pcs()).forEach(function (p) { if (p.id === id) n = p.name; }); return n || id; }

  /* the crew by danger: desperate with a looker first, then desperate, risky with, risky, controlled with, controlled, then the unplaced */
  function crewOrder(play, st, pcs, t) {
    var rank = { desperate: 0, risky: 2, controlled: 4 };
    return list(pcs).map(function (pc, i) {
      var c = isObj(st.crew) && isObj(st.crew[pc.id]) ? st.crew[pc.id] : {}, placed = typeof c.room === "string" && c.room !== "";
      var p = placed ? B.positionOf(play, st, pc.id) : { pos: "", why: "" }, lk = placed ? B.lookers(play, st, pc.id, t) : { here: [], soon: [] };
      return { id: pc.id, name: pc.name, i: i, pos: p.pos, why: p.why, here: lk.here, soon: lk.soon, rank: placed ? (rank[p.pos] === undefined ? 4 : rank[p.pos]) + (lk.here.length ? 0 : 1) : 9 };
    }).sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
  }
  /* the target's stop to skip at the alarm's threshold: its next future stop flagged private: true (never a public one) */
  function skipTarget(play, st, t, isOpen) {
    var tg = targetOf(play); if (!tg) return null;
    var skipped = isObj(st.over) && isObj(st.over[tg.id]) && Array.isArray(st.over[tg.id].skip) ? st.over[tg.id].skip : [];
    var fut = sortedStops(tg, play.clock.start).filter(function (s) { return s.t > t && skipped.indexOf(s.j) < 0 && s.priv && s.room; });
    var pick = fut[0];
    return pick ? { person: tg.id, stop: pick } : null;
  }

  /* write one ball key: fn edits a copy; an empty map removes the key; fn may return false for "nothing to write" */
  function setKey(ctx, key, fn) {
    var st = ctx.host.state(), cur = clone(isObj(st[key]) ? st[key] : {});
    if (fn(cur) === false) return;
    var ch = {}; ch[key] = Object.keys(cur).length ? cur : null;
    ctx.set(ch); ctx.rerender();
  }
  function setCrewKey(ctx, pc, fn) { setKey(ctx, "crew", function (crew) { var c = isObj(crew[pc]) ? crew[pc] : (crew[pc] = {}); fn(c); }); }
  function setOver(ctx, person, fn) {
    setKey(ctx, "over", function (over) {
      var o = isObj(over[person]) ? over[person] : (over[person] = {});
      fn(o); if (!Object.keys(o).length) delete over[person];
    });
  }
  function toggleIn(arr, v) { var i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); return arr; }

  /* "Heard by": ball.heard.<way>.<pc> = the published time; the same button again takes it back and marks ball.unheard, so the auto-hear leaves the pair alone (one write) */
  function heard5(way, pc, ctx) { ctx.set(heardChange(ctx.host.state(), way, pc, ctx.t)); ctx.rerender(); }

  /* the wall-clock pacing line: page-local (sessionStorage at most), never written to the shared state */
  function paceNote(play, st) {
    if (!isStarted(st)) return null;
    var key = str(st.site) + "|" + st.start;
    if (!pace || pace.key !== key) {
      var at = 0;
      try { at = +(typeof sessionStorage !== "undefined" && sessionStorage.getItem("b68-rv-pace|" + key)) || 0; } catch (e) { at = 0; }
      if (!at) { at = Date.now(); try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem("b68-rv-pace|" + key, String(at)); } catch (e2) { /* page-local anyway */ } }
      pace = { key: key, at: at };
    }
    return { n: B.beatOf(play, timeOf(st)).n, min: Math.max(0, Math.floor((Date.now() - pace.at) / 60000)) };
  }
  function paceText(p) { return "beat " + p.n + " · " + p.min + " min in"; }

  /* ---- This beat ----------------------------------------------------------------------------------------------- */
  function beatSection(box, ctx) {
    var play = ctx.play, st = ctx.st, t = ctx.shownT;
    if (!isStarted(st)) { box.innerHTML = '<h3 class="rv-sh">This beat</h3><p class="rv-dim">The night has not started. Pick the engagement result above.</p>'; box.onclick = null; return; }
    /* what changed since the last published time (a step, a jump or a beat back); a peek reads as the beat that ends there */
    var now = timeOf(st), key = str(st.site);
    if (!ui5.prev || ui5.prev.key !== key) ui5.prev = { key: key, cur: now, prev: now };
    else if (ui5.prev.cur !== now) ui5.prev = { key: key, cur: now, prev: ui5.prev.cur };
    var card = B.beatCard(play, st, ctx.peeking ? t : ui5.prev.prev, t);
    var tg = targetOf(play), over = tg && isObj(st.over) && isObj(st.over[tg.id]) ? st.over[tg.id] : {};
    var sc = scanChanges(play, st, tg ? [tg.id] : [], t), label = function (m) { return B.timeLabel(play, m); };
    var h = '<h3 class="rv-sh">' + (ctx.peeking ? "Looking at " : "This beat · ") + esc(label(t)) + "</h3>";
    var pc = paceNote(play, st);
    if (pc && !ctx.peeking) h += '<p class="rv-pace rv-dim" data-pace="1">' + esc(paceText(pc)) + "</p>";
    var say = sayBox;
    var rows = card.items.map(function (it) {
      var ic, body = "";
      switch (it.type) {
        case "event":
          ic = it.rival ? "☠" : it.vis === "public" ? "★" : "◆";
          body = "<b>" + esc(it.at) + "</b> " + esc(it.label || it.pub) + (it.room ? ' <span class="rv-dim">· ' + esc(it.room) + "</span>" : "") +
            (it.fx === "dawn" ? ' <button type="button" class="rv-btn sm" data-vv="dawn">False dawn</button>' : "") + (it.say ? say(it.say) : "");
          break;
        case "move": {
          ic = "◆";
          var nx = sc[it.id];
          body = npcName(ctx, personById(play, it.id), it.label) + " → <b>" + esc(it.to) + "</b>" + (nx ? ' <span class="rv-dim">until ' + esc(label(nx.at)) + "</span>" : "") + (it.note ? ' <span class="rv-dim">' + esc(it.note) + "</span>" : "");
          break;
        }
        case "route": ic = "⇅"; body = "Passage " + esc(it.change) + " " + esc(it.at) + ' <span class="rv-dim">· ' + esc(it.from) + " ↔ " + esc(it.to) + "</span>"; break;
        case "gone": ic = "✗"; body = npcName(ctx, personById(play, it.id), it.label) + " gone " + esc(it.at) + ' <span class="rv-dim">· from ' + esc(it.from) + "</span>"; break;
        case "lead":
          ic = "✦";
          body = "In reach: <b>" + esc(it.way) + "</b> " + (it.anywhere ? '<span class="rv-dim">(said anywhere)</span>' : "(" + esc(pcName5(it.pc, ctx)) + ")") + (it.name ? ' <span class="rv-dim">' + esc(it.name) + "</span>" : "") + say(it.line, it.who);
          break;
        case "next":
          ic = "⌛";
          body = "<b>" + esc(it.at) + "</b> " + (it.what === "move" ? npcName(ctx, personById(play, it.id), it.label || it.pub || it.what) : esc(it.label || it.pub || it.what)) + (it.what === "move" ? " → " + esc(it.to) : "") + (it.what === "route" ? " (" + esc(it.change) + ")" : "") + ' <span class="rv-dim">in ' + it.inMin + " min</span>";
          break;
        default: return "";
      }
      return '<li class="rv-bi t-' + esc(it.type) + '"><span class="rv-bic" aria-hidden="true">' + ic + '</span><div class="rv-bb">' + body + "</div></li>";
    }).join("");
    h += '<ul class="rv-beat5">' + (rows || '<li class="rv-dim">Nothing lands this beat.</li>') + "</ul>";

    /* the buttons something needs you for: the alarm's thresholds (only at their fill), the target down */
    var btns = "";
    if (isObj(play.alarm) && isObj(play.alarm.at) && str(play.alarm.clock)) {
      var ck = ctx.host.clockNamed(str(play.alarm.clock)), filled = ck ? Math.max(0, Math.floor(+ck.filled || 0)) : 0, nm = str(play.alarm.label) || str(play.alarm.clock);
      Object.keys(play.alarm.at).forEach(function (k) {
        if (filled < +k) return;                                   /* from its fill on, until taken (ball.acted) or the clock is cleared */
        if (play.alarm.at[k] === "skip-private") {
          if (isObj(st.acted) && st.acted[k] === true) return;
          var sk = skipTarget(play, st, ctx.t, ctx.host.isOpen);
          btns += '<button type="button" class="rv-btn" data-vv="skip" data-k="' + esc(k) + '"' + (sk ? "" : " disabled") + ">" + esc(nm) + " " + k + ": skip the next private stop" + (sk ? " <small>" + esc(sk.stop.room + " " + label(sk.stop.t)) + "</small>" : " <small>no private stop left</small>") + "</button>";
        } else if (play.alarm.at[k] === "lockdown") {
          btns += typeof over.at === "string" && over.at ? '<button type="button" class="rv-btn" data-vv="release">' + esc(nm) + " " + k + ": locked down in " + esc(over.at) + " · release</button>"
            : '<button type="button" class="rv-btn" data-vv="lockdown">' + esc(nm) + " " + k + ": lockdown</button>";
        }
      });
    }
    if (tg) btns += over.gone === true ? '<button type="button" class="rv-btn" data-vv="up">' + esc(str(tg.label)) + " is back up</button>" : '<button type="button" class="rv-btn" data-vv="down">' + esc(str(tg.label)) + " is down</button>";
    if (btns) h += '<div class="rv-acts">' + btns + "</div>";
    if (over.gone === true) {
      var ex = list(play.exits).filter(isObj);
      h += '<h4 class="rv-lab">The way out</h4>' + (ex.length ? '<ul class="rv-exits">' + ex.map(function (x) { return "<li><b>" + esc(x.label) + "</b>" + (x.from ? ' <span class="rv-dim">from ' + esc(x.from) + "</span>" : "") + (x.note ? " · " + esc(x.note) : "") + "</li>"; }).join("") + "</ul>" : '<p class="rv-dim">The play lists no exits.</p>');
    }
    box.innerHTML = h;
    box.onclick = function (ev) {
      var el = ev.target.closest ? ev.target.closest("[data-vv]") : null; if (!el || !box.contains(el)) return;
      var a = el.getAttribute("data-vv"), host = ctx.host, tgId = tg ? tg.id : "";
      if (a === "dawn") { if (typeof host.dawn === "function") host.dawn(); else ctx.toast("The false dawn is not wired on this page.", true); }
      else if (a === "skip") { var sk2 = skipTarget(ctx.play, host.state(), ctx.t, host.isOpen); if (sk2) { setOver(ctx, sk2.person, function (o) { o.skip = list(o.skip).concat([sk2.stop.j]); }); setKey(ctx, "acted", function (m) { m[el.getAttribute("data-k")] = true; }); } }
      else if (a === "lockdown") { var w = B.placesAt(ctx.play, host.state(), ctx.t)[tgId]; var ld = isObj(ctx.play.alarm) && isObj(ctx.play.alarm.lockdown) ? ctx.play.alarm.lockdown.room : ""; if (ld || (w && w.room)) setOver(ctx, tgId, function (o) { o.at = ld || w.room; }); else ctx.toast("The target is not anywhere to hold.", true); }
      else if (a === "release") setOver(ctx, tgId, function (o) { delete o.at; });
      else if (a === "down") setOver(ctx, tgId, function (o) { o.gone = true; });
      else if (a === "up") setOver(ctx, tgId, function (o) { delete o.gone; });
    };
  }

  /* ---- The crew ------------------------------------------------------------------------------------------------ */
  function crewSection(box, ctx) {
    var play = ctx.play, st = ctx.st, t = ctx.t, beat = beatLen(play), nowI = B.beatOf(play, t).i;
    var rooms = Object.keys(ctx.model.cards), order = list(ctx.host.pcs()), items = list(play.items).filter(isObj);
    var h = '<h3 class="rv-sh">The crew</h3>';
    if (!order.length) h += '<p class="rv-dim">The table has no characters yet.</p>';
    order.forEach(function (o) {
      var c = isObj(st.crew) && isObj(st.crew[o.id]) ? st.crew[o.id] : {}, room = typeof c.room === "string" ? c.room : "";
      var busy = typeof c.busy === "number" && c.busy > t ? c.busy : null;
      h += '<div class="rv-crew" data-pc="' + esc(o.id) + '">' +
        '<div class="rv-cr1"><b class="rv-crn">' + esc(o.name) + "</b>" +
        '<select class="rv-sel" data-vv="room" aria-label="' + esc(o.name) + ' room"><option value="">no room</option>' + rooms.map(function (r) { return '<option value="' + esc(r) + '"' + (r === room ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("") + "</select>" +
        (room ? '<button type="button" class="rv-btn sm rv-tog" data-vv="moved" aria-pressed="' + (c.moved === nowI) + '" title="Moved this beat">' + (c.moved === nowI ? "✓ moved" : "moved") + "</button>" : "") + "</div>";
      h += '<div class="rv-cr2">' +
        '<span class="rv-busy">' + (busy !== null ? "busy until " + esc(B.timeLabel(play, busy)) : "free") + "</span>" +
        '<button type="button" class="rv-btn sm" data-vv="busy" data-n="1">+1 beat</button><button type="button" class="rv-btn sm" data-vv="busy" data-n="2">+2 beats</button>' +
        '<button type="button" class="rv-btn sm" data-vv="busy" data-n="0"' + (busy === null ? " disabled" : "") + ">clear</button></div>";
      if (items.length) h += '<div class="rv-cr3"><span class="rv-lab">Items</span>' + items.map(function (it) { return '<button type="button" class="rv-btn sm rv-tog" data-vv="item" data-id="' + esc(it.id) + '" aria-pressed="' + (list(c.items).indexOf(it.id) >= 0) + '">' + esc(it.label || it.id) + "</button>"; }).join("") + "</div>";
      h += "</div>";
    });
    box.innerHTML = h;
    box.onclick = function (ev) {
      var el = ev.target.closest ? ev.target.closest("[data-vv]") : null; if (!el || !box.contains(el) || el.tagName === "SELECT") return;
      var row = el.closest("[data-pc]"), pc = row ? row.getAttribute("data-pc") : "", a = el.getAttribute("data-vv");
      if (a === "moved") setCrewKey(ctx, pc, function (c) { if (c.moved === nowI) delete c.moved; else c.moved = nowI; });
      else if (a === "busy") { var n = +el.getAttribute("data-n"); setCrewKey(ctx, pc, function (c) { if (n === 0) delete c.busy; else c.busy = Math.max(typeof c.busy === "number" ? c.busy : 0, t) + n * beat; }); }
      else if (a === "item") { var iid = el.getAttribute("data-id"); setCrewKey(ctx, pc, function (c) { var l = toggleIn(list(c.items).slice(), iid); if (l.length) c.items = l; else delete c.items; }); }
    };
    box.onchange = function (ev) {
      var el = ev.target; if (!el || !el.getAttribute) return;
      var row = el.closest("[data-pc]"), pc = row ? row.getAttribute("data-pc") : "", a = el.getAttribute("data-vv");
      if (a === "room") {
        if (el.value) { ctx.set({ crew: moveCrew(ctx.host.state(), pc, el.value, nowI) }); ctx.rerender(); }           /* and with the room: moveCrew clears it */
        else setCrewKey(ctx, pc, function (c) { delete c.room; c.noticed = false; });
      }
    };
  }

  /* ---- The job ------------------------------------------------------------------------------------------------- */
  function waySummary(play, st, w, t) {
    var ticks = isObj(st.steps) && Array.isArray(st.steps[w.id]) ? st.steps[w.id] : [], total = list(w.steps).length, n = ticks.filter(Boolean).length;
    var hm = isObj(st.heard) && isObj(st.heard[w.id]) ? st.heard[w.id] : {}, hd = Object.keys(hm).filter(function (k) { return typeof hm[k] === "number"; });
    var mark = isObj(st.ways) ? st.ways[w.id] : "", until = isObj(w.window) && typeof w.window.until === "string" ? B.minuteOf(w.window.until, play.clock.start) : NaN;
    var gone = mark === "gone" || (!isNaN(until) && t >= until);
    return { state: mark === "done" ? "done" : gone ? "gone" : n > 0 ? "steps" : hd.length ? "heard" : "unheard", n: n, total: total, heard: hd, ticks: ticks };
  }
  function jobSection(box, ctx) {
    var play = ctx.play, st = ctx.st, t = ctx.shownT, label = function (m) { return B.timeLabel(play, m); }, ways = list(play.ways).filter(isObj), pcs = list(ctx.host.pcs());
    var h = '<h3 class="rv-sh">The job</h3>', tg = targetOf(play), rv = rivalOf(play), ids = [tg, rv].filter(Boolean).map(function (p) { return p.id; });
    var places = B.placesAt(play, st, t), sc = scanChanges(play, st, ids, t), view = B.playerView(play, st, list(st.open));
    var over = tg && isObj(st.over) && isObj(st.over[tg.id]) ? st.over[tg.id] : {};
    if (tg) {
      var tw = places[tg.id], tn = sc[tg.id];
      h += '<div class="rv-target" data-who="target"><span class="rv-lab">' + npcName(ctx, tg, str(tg.label)) + "</span> " +
        (over.gone === true ? "<b>down</b>" : tw ? "<b>" + esc(tw.room) + "</b>" : '<span class="rv-dim">nowhere yet</span>') +
        (over.gone !== true && tn ? ' <span class="rv-dim">until ' + esc(label(tn.at)) + "</span> → " + (tn.room ? esc(tn.room) : "gone") + (tn.room && !stopKnown(view, tn.at, tn.room) ? ' <em class="rv-hid">(hidden)</em>' : "") : "") +
        (typeof over.at === "string" && over.at ? ' <span class="rv-hid">held in ' + esc(over.at) + "</span>" : "") + (typeof over.delay === "number" && over.delay ? ' <span class="rv-hid">' + over.delay + " min late</span>" : "") +
        '<div class="rv-acts"><span class="rv-lab">Running late</span>' + [15, 30].map(function (n) { return '<button type="button" class="rv-btn sm" data-vv="late" data-n="' + n + '">+' + n + "</button>"; }).join("") + '<button type="button" class="rv-btn sm" data-vv="late" data-n="0"' + (over.delay ? "" : " disabled") + ">clear</button></div></div>";
    }
    if (rv) {
      var rw = places[rv.id], rn = sc[rv.id];
      h += '<div class="rv-target" data-who="rival"><span class="rv-lab">' + npcName(ctx, rv, str(rv.label)) + "</span> " + (rw ? esc(rw.room) : '<span class="rv-dim">nowhere</span>') +
        (rn ? ' <span class="rv-dim">next ' + esc(label(rn.at)) + "</span> → " + (rn.room ? esc(rn.room) : "gone") : ' <span class="rv-dim">nothing more</span>') + "</div>";
    }
    if (!ways.length) h += '<p class="rv-dim">The play has no ways.</p>';
    ways.forEach(function (w) {
      var s = waySummary(play, st, w, t), open = !!ui5.ways[w.id];
      var sum = s.state === "done" ? "done" : s.state === "gone" ? "window gone" : s.state === "steps" ? "steps " + s.n + " of " + s.total : s.state === "heard" ? "heard by " + s.heard.map(function (id) { return pcName5(id, ctx); }).join(", ") : "unheard";
      h += '<div class="rv-way st-' + s.state + '" data-way="' + esc(w.id) + '"><button type="button" class="rv-wayhd" data-vv="way" aria-expanded="' + open + '"><b>' + esc(w.id) + "</b> " + esc(str(w.name)) + ' <span class="rv-wst">' + esc(sum) + "</span></button>";
      if (open) {
        var ld = isObj(w.lead) ? w.lead : null, wd = isObj(w.window) ? w.window : null;
        if (ld && ld.line) h += '<div class="rv-say"><span class="rv-saylab">SAY</span> “' + esc(ld.line) + "”" + (ld.who ? ' <small class="rv-dim">' + esc(ld.who) + "</small>" : "") + "</div>";
        if (ld) h += '<p class="rv-wl">Said ' + (ld.room ? "in <b>" + esc(ld.room) + "</b>" : "anywhere") + " " + esc(str(ld.from)) + "–" + esc(str(ld.to)) + "</p>";
        if (wd) h += '<p class="rv-wl">Window ' + esc(str(wd.at)) + (wd.until ? "–" + esc(wd.until) : "") + (wd.room ? " · <b>" + esc(wd.room) + "</b>" : "") + "</p>";
        var stp = list(w.steps);
        if (stp.length) h += '<ul class="rv-steps">' + stp.map(function (x, i) { return '<li><label><input type="checkbox" data-vv="step" data-i="' + i + '"' + (s.ticks[i] ? " checked" : "") + "> " + esc(x) + "</label></li>"; }).join("") + "</ul>";
        if (w.cost) h += '<p class="rv-wl"><span class="rv-lab">Cost</span> ' + esc(w.cost) + "</p>";
        if (w.note) h += '<p class="rv-wl"><span class="rv-lab">Note</span> ' + esc(w.note) + "</p>";
        var hdm = isObj(st.heard) && isObj(st.heard[w.id]) ? st.heard[w.id] : {};
        var inRoom = function (p) { var cr = isObj(st.crew) && isObj(st.crew[p.id]) ? st.crew[p.id] : {}; return !!cr.room && (!ld || !ld.room || cr.room === ld.room); };
        var near = pcs.filter(inRoom), far = pcs.filter(function (p) { return !inRoom(p); });
        var hb = function (p) { var on = typeof hdm[p.id] === "number"; return '<button type="button" class="rv-btn sm rv-tog" data-vv="heard" data-pc="' + esc(p.id) + '" aria-pressed="' + on + '">' + esc(p.name) + (on ? " ✓ " + esc(label(hdm[p.id])) : "") + "</button>"; };
        h += '<div class="rv-heard"><span class="rv-lab">Heard by</span> ' + (near.length ? near.map(hb).join(" ") : '<span class="rv-dim">nobody is in the room</span>') + "</div>";
        if (far.length) h += '<details class="rv-more" data-more="' + esc(w.id) + '"' + (ui5.more[w.id] ? " open" : "") + '><summary>More</summary><div class="rv-heard">' + far.map(hb).join(" ") + "</div></details>";
        h += '<div class="rv-acts"><button type="button" class="rv-btn sm rv-tog" data-vv="done" aria-pressed="' + (s.state === "done") + '">Done</button></div>';
      }
      h += "</div>";
    });
    box.innerHTML = h;
    box.onclick = function (ev) {
      var el = ev.target.closest ? ev.target.closest("[data-vv]") : null; if (!el || !box.contains(el)) return;
      var a = el.getAttribute("data-vv"), wrap = el.closest("[data-way]"), wid = wrap ? wrap.getAttribute("data-way") : "", tgId = tg ? tg.id : "";
      if (a === "way") { ui5.ways[wid] = !ui5.ways[wid]; ctx.rerender(); }
      else if (a === "heard") heard5(wid, el.getAttribute("data-pc"), ctx);
      else if (a === "done") setKey(ctx, "ways", function (m) { if (m[wid] === "done") delete m[wid]; else m[wid] = "done"; });
      else if (a === "late") { var n = +el.getAttribute("data-n"), from = ctx.t; setOver(ctx, tgId, function (o) { if (n === 0) { delete o.delay; delete o.from; } else { o.delay = n; o.from = from; } }); }
    };
    box.onchange = function (ev) {
      var el = ev.target; if (!el || !el.getAttribute || el.getAttribute("data-vv") !== "step") return;
      var wrap = el.closest("[data-way]"), wid = wrap ? wrap.getAttribute("data-way") : "", i = +el.getAttribute("data-i"), on = !!el.checked;
      var w = ways.filter(function (x) { return x.id === wid; })[0], total = w ? list(w.steps).length : 0;
      setKey(ctx, "steps", function (m) {
        var arr = Array.isArray(m[wid]) ? m[wid].slice() : []; while (arr.length < total) arr.push(false);
        arr[i] = on; if (arr.some(Boolean)) m[wid] = arr; else delete m[wid];
      });
    };
    box.ontoggle = null;
    if (!box.__rv5toggle) { box.__rv5toggle = true; box.addEventListener("toggle", function (ev) { var d = ev.target; if (d && d.getAttribute && d.getAttribute("data-more")) ui5.more[d.getAttribute("data-more")] = !!d.open; }, true); }
  }

  /* ---- Intel (a fold) ------------------------------------------------------------------------------------------ */
  function intelSection(box, ctx) {
    var play = ctx.play, st = ctx.st, intel = list(play.intel).filter(isObj), pcs = list(ctx.host.pcs()), told = isObj(st.told) ? st.told : {};
    var h = '<details class="rv-intel"' + (ui5.intel ? " open" : "") + '><summary class="rv-sh">Intel <small>' + intel.filter(function (x) { return told[x.id] !== undefined; }).length + " of " + intel.length + " told</small></summary>";
    if (!intel.length) h += '<p class="rv-dim">The play has no intel.</p>';
    intel.forEach(function (x) {
      var v = told[x.id], crew = v === "crew", ids = Array.isArray(v) ? v : [];
      h += '<div class="rv-intel1" data-intel="' + esc(x.id) + '"><div><b>' + esc(x.id) + "</b> " + esc(x.text) + (x.from ? ' <span class="rv-dim">· ' + esc(x.from) + "</span>" : "") + '</div><div class="rv-acts">' +
        pcs.map(function (p) { return '<button type="button" class="rv-btn sm rv-tog" data-vv="tell" data-pc="' + esc(p.id) + '" aria-pressed="' + (crew || ids.indexOf(p.id) >= 0) + '"' + (crew ? " disabled" : "") + ">Tell " + esc(p.name) + "</button>"; }).join("") +
        '<button type="button" class="rv-btn sm rv-tog" data-vv="tellcrew" aria-pressed="' + crew + '">Tell the crew</button></div></div>';
    });
    box.innerHTML = h + "</details>";
    box.onclick = function (ev) {
      var el = ev.target.closest ? ev.target.closest("[data-vv]") : null; if (!el || !box.contains(el)) return;
      var wrap = el.closest("[data-intel]"), id = wrap ? wrap.getAttribute("data-intel") : "", a = el.getAttribute("data-vv");
      if (a === "tellcrew") setKey(ctx, "told", function (m) { if (m[id] === "crew") delete m[id]; else m[id] = "crew"; });
      else if (a === "tell") { var pc = el.getAttribute("data-pc"); setKey(ctx, "told", function (m) { if (m[id] === "crew") return false; var l = toggleIn(Array.isArray(m[id]) ? m[id].slice() : [], pc); if (l.length) m[id] = l; else delete m[id]; }); }
    };
    if (!box.__rv5toggle) { box.__rv5toggle = true; box.addEventListener("toggle", function (ev) { if (ev.target && ev.target.classList && ev.target.classList.contains("rv-intel")) ui5.intel = !!ev.target.open; }, true); }
  }

  /* the wall-clock line keeps counting without a redraw (page-local; it stops when the line leaves the page) */
  var paceTimer = null;
  function paceTick() {
    var els = typeof document !== "undefined" ? document.querySelectorAll("[data-pace]") : [];
    if (!els.length || !pace) { clearInterval(paceTimer); paceTimer = null; return; }
    for (var i = 0; i < els.length; i++) els[i].textContent = paceText({ n: +((/beat (\d+)/.exec(els[i].textContent) || [0, 0])[1]), min: Math.max(0, Math.floor((Date.now() - pace.at) / 60000)) });
  }
  sections.push({ id: "beat", order: 0, render: function (box, ctx) { beatSection(box, ctx); if (!paceTimer && typeof setInterval === "function" && typeof document !== "undefined") paceTimer = setInterval(paceTick, 20000); } });
  /* the crew lines live in the GM page's drawer (crewInto), no longer in this right column */
  sections.push({ id: "job", order: 200, render: jobSection });
  sections.push({ id: "intel", order: 300, render: intelSection });
  hooks.heard = heard5;
  /* ==== VV5 END ==== */

  return { create: create, model: model, moveCrew: moveCrew, resetChange: resetChange, resetAsk: RESET_ASK, stepTime: stepTime, jumpTime: jumpTime, startMinutes: startMinutes, initials: initials, normRoomName: normRoomName,
    setPlayersChip: setPlayersChip, menuItems: menuItems, views: views, sections: sections, hooks: hooks,
    sortedStops: sortedStops, scanChanges: scanChanges, crewOrder: crewOrder, skipTarget: skipTarget, waySummary: waySummary,
    nowSegments: nowSegments, setWarnings: setWarnings, sayBox: sayBox, roomsShown: roomsShown, peopleIn: peopleIn, eventsIn: eventsIn, reachIn: reachIn, personNames: personNames, npcName: npcName, heardChange: heardChange, foldMoves: foldMoves };
});
