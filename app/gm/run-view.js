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
 *   startMinutes(play) -> [{ key, label, at, t }] the engagement results play.clock.starts offers, in minutes from clock.start.
 *
 * THE VIEW (needs a DOM): create(host) -> { render(box), peek(t), unpeek(), ... }. host is the page's side of the contract:
 *   site() -> { name, play } | null           state() -> ball           set(change) -> ballSet (a replace patch)
 *   pcs() -> [{ id, name }]                   floors() -> { list, floorOf }
 *   isOpen(room) -> bool                      openRoom(room, on)   (the page's roomOpen: it asks first)
 *   mapSvg() -> svg text | ""                 clockNamed(name) -> { filled, size } | null
 *   publish(t, why)    THE CALL SITE VV6 FILLS: why is "start" | "beat" | "jump"; the page's body is empty today.
 *   toast(msg, bad)
 *
 * SEAMS for the tickets that build on this view (module-level, shared by every instance):
 *   setPlayersChip(text, ok)  the "Players: HH:MM" chip in the header (VV6)
 *   menuItems                 [{ id, label, run(ctx) }]  Run's menu button lists them (VV6: "End the night")
 *   views                     [{ id, label, render(box, ctx) }]  Board and Map are first; VV6 adds "Players"
 *   sections                  [{ id, order, render(box, ctx) }]  the right column, by order (VV5: This beat 0, the crew 100, the job 200, intel 300)
 *   hooks                     { heard(way, pc, ctx) }  the Heard by buttons (VV5)
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
  var POS_LETTER = { controlled: "C", risky: "R", desperate: "D" };

  function initials(label) {
    var out = "";
    str(label).trim().split(/\s+/).filter(Boolean).slice(0, 2).forEach(function (w) { out += Array.from(w)[0].toUpperCase(); });
    return out || "?";
  }
  function iconOf(name) { var n = str(name); return ICONS[n] || (n ? Array.from(n)[0].toUpperCase() : "•"); }
  function beatLen(play) { var b = isObj(play) && isObj(play.clock) ? play.clock.beat : 0; return Number.isInteger(b) && b >= 5 && b <= 60 ? b : 15; }
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

  /* ---- the view ---------------------------------------------------------------------------------------------- */
  function create(host) {
    var boxEl = null, peekT = null, sel = "", arm = "", drag = null, noClick = false, alarmOpen = false, mq = null;
    var self = { box: function () { return boxEl; } };

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
      return { rs: rs, st: st, m: m, shownT: shownT, ctx: null };
    }

    /* the header */
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
          '<span class="rv-beat">beat ' + nowBeat.n + ' of ' + nowBeat.of + '</span>';
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
      var cls = "rv-pc" + (c.pos ? " pos-" + c.pos : "") + (arm === c.id ? " armed" : "") + (c.moved ? " moved" : "");
      return '<button type="button" class="' + cls + '" data-rv="pc" data-id="' + esc(c.id) + '" aria-pressed="' + (arm === c.id) + '" title="' + esc(c.name + (c.costume ? " · " + c.costume : "") + (c.pos ? " · " + c.pos + (c.why ? " (" + c.why + ")" : "") : "") + (c.looker ? " · seen through by " + c.looker : "")) + '">' +
        '<span class="rv-ini">' + esc(c.ini) + "</span>" + (c.icon ? '<span class="rv-cic">' + esc(c.icon) + "</span>" : "") +
        (c.mark === "warn" ? '<span class="rv-mk warn" aria-label="Out of place, and seen through">⚠</span>' : c.mark === "eye" ? '<span class="rv-mk eye" aria-label="Seen through, but belongs here">◎</span>' : "") +
        (inTray ? '<span class="rv-nm">' + esc(c.name) + "</span>" : "") + "</button>";
    }
    function boardView(box, ctx) {
      var m = ctx.model, h = "";
      if (m.tray.length) h += '<div class="rv-tray" data-room="" role="group" aria-label="Crew not on the board"><span class="rv-lab">Not placed</span>' + m.tray.map(function (c) { return chipHtml(c, true); }).join("") + "</div>";
      if (arm) h += '<p class="rv-arm" role="status">Tap a room to move ' + esc(nameOfPc(arm, ctx)) + ' there. <button type="button" class="rv-btn sm" data-rv="disarm">Cancel</button></p>';
      m.rows.forEach(function (row) {
        h += '<div class="rv-row"><div class="rv-floor">' + esc(row.name) + '</div><div class="rv-cards">' + row.cards.map(function (c) {
          var cls = "rv-card z" + (c.zone < 0 ? "x" : c.zone % 6) + (c.open ? " open" : " fog") + (sel === c.name ? " sel" : "");
          return '<div class="' + cls + '" data-rv="room" data-room="' + esc(c.name) + '" role="button" tabindex="0" aria-label="' + esc(c.name + (c.open ? "" : ", not open to the players")) + '">' +
            '<div class="rv-cn">' + esc(c.name) + (c.zoneLabel ? ' <small>' + esc(c.zoneLabel) + "</small>" : "") + "</div>" +
            '<div class="rv-chips">' + c.pcs.map(function (p) { return chipHtml(p, false); }).join("") +
            c.npcs.map(function (n) { return '<span class="rv-npc k-' + esc(n.kind) + '" title="' + esc(n.label + " (" + n.kind + ")" + (n.moving ? " → " + n.moving.to + " in " + n.moving.inMin + " min" : "")) + '"><span class="rv-ini">' + esc(n.ini) + "</span>" + (n.kind === "target" ? "★" : n.kind === "rival" ? "☠" : "") + "</span>"; }).join("") + "</div>" +
            (c.routes.length ? '<div class="rv-routes">' + c.routes.map(function (r) { return '<span class="rv-route' + (r.timed ? " timed" : "") + '" title="' + esc(r.timed ? "A passage" + (r.until ? ", open until " + r.until : "") : "A route") + '">' + (r.timed ? "⏱ " : "") + esc(r.mark) + " " + esc(r.to) + (r.until ? " <small>to " + esc(r.until) + "</small>" : "") + "</span>"; }).join("") + "</div>" : "") +
            "</div>";
        }).join("") + "</div></div>";
      });
      box.innerHTML = h || '<p class="rv-empty">The roll has no rooms to show.</p>';
    }
    function nameOfPc(id, ctx) { var n = ""; list(host.pcs()).forEach(function (p) { if (p.id === id) n = p.name; }); return n || id; }
    function mapView(box) {
      var svg = host.mapSvg();
      box.innerHTML = svg ? '<div class="rv-map" id="rv-map">' + svg + "</div>" : '<p class="rv-empty">The map could not be drawn.</p>';
    }

    /* the room tapped (a section of the right column) */
    function roomSection(box, ctx) {
      var name = ctx.sel, c = name ? ctx.model.cards[name] : null;
      if (!c) { box.innerHTML = '<h3 class="rv-sh">A room</h3><p class="rv-dim">Tap a room to see who is there, the leads in reach, and to open it for the players.</p>'; return; }
      var h = '<h3 class="rv-sh">' + esc(c.name) + (c.zoneLabel ? ' <small>' + esc(c.zoneLabel) + "</small>" : "") + "</h3>";
      h += '<p class="rv-open ' + (c.open ? "yes" : "no") + '">' + (c.open ? "Open to the players" : "Not open to the players") + "</p>";
      var who = c.pcs.map(function (p) { return "<li><b>" + esc(p.name) + "</b>" + (p.costume ? " · " + esc(p.costume) : "") + (p.pos ? " · " + esc(POS_LETTER[p.pos] || p.pos) : "") + (p.mark === "warn" ? " ⚠ " + esc(p.looker) : p.mark === "eye" ? " ◎ " + esc(p.looker) : "") + "</li>"; });
      var places = B.placesAt(ctx.play, ctx.st, ctx.shownT);
      list(ctx.play.people).filter(isObj).forEach(function (p) { var w = places[p.id]; if (w && w.room === c.name) who.push('<li class="npc">' + esc(p.label) + " <small>" + esc(p.kind) + "</small>" + (w.moving ? " → " + esc(w.moving.to) + " in " + w.moving.inMin + " min" : "") + "</li>"); });
      h += '<h4 class="rv-lab">Here</h4><ul class="rv-who">' + (who.length ? who.join("") : '<li class="rv-dim">Nobody.</li>') + "</ul>";
      var leads = {};
      B.leadsInReach(ctx.play, ctx.st, ctx.shownT).forEach(function (l) { if (c.pcs.some(function (p) { return p.id === l.pc; })) (leads[l.way] = leads[l.way] || { line: l.line, who: l.who, name: l.name, pcs: [] }).pcs.push(l.pc); });
      var ids = Object.keys(leads);
      if (ids.length) {
        h += '<h4 class="rv-lab">Leads in reach</h4>';
        ids.forEach(function (w) {
          var l = leads[w];
          h += '<div class="rv-say"><span class="rv-saylab">SAY</span> “' + esc(l.line) + "”" + (l.who ? ' <small class="rv-dim">' + esc(l.who) + "</small>" : "") + '<div class="rv-heard">Heard by ' +
            l.pcs.map(function (pc) { return '<button type="button" class="rv-btn sm" data-rv="heard" data-way="' + esc(w) + '" data-pc="' + esc(pc) + '">' + esc(nameOfPc(pc, ctx)) + "</button>"; }).join(" ") + "</div></div>";
        });
      }
      h += '<div class="rv-acts">';
      var bo = list(ctx.st.open);
      if (!c.open) h += '<button type="button" class="rv-btn" data-rv="open" data-room="' + esc(c.name) + '">Open for the players</button>';
      else if (bo.indexOf(c.name) >= 0) h += '<button type="button" class="rv-btn" data-rv="close" data-room="' + esc(c.name) + '">Close for the players</button>';
      list(host.pcs()).forEach(function (p) { if (!c.pcs.some(function (q) { return q.id === p.id; })) h += '<button type="button" class="rv-btn" data-rv="move" data-id="' + esc(p.id) + '" data-room="' + esc(c.name) + '">Move ' + esc(p.name) + " here</button>"; });
      h += "</div>";
      box.innerHTML = h;
    }

    /* the pane */
    self.rerender = function () { if (boxEl) self.render(boxEl); };
    self.render = function (box) {
      boxEl = box;
      if (live.indexOf(self) < 0) live.push(self);
      var x = build();
      if (!x) { box.innerHTML = ""; return; }
      var ctx = x.ctx = ctxFor(x.rs, x.st, x.m, x.shownT), vid = str(x.st.view) || "board", vs = [{ id: "board", label: "Board", render: boardView }, { id: "map", label: "Map", render: mapView }].concat(views);
      var v = vs.filter(function (q) { return q.id === vid; })[0] || vs[0];
      var secs = [{ id: "room", order: 50, render: roomSection }].concat(sections).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var peekBar = peekT !== null ? '<div class="rv-peekbar" role="status">Looking at <b>' + esc(B.timeLabel(x.rs.play, peekT)) + '</b> <button type="button" class="rv-btn sm" data-rv="unpeek">Back to now</button> <span class="rv-dim">The players are not told.</span></div>' : "";
      box.innerHTML = headHtml(x) +
        '<div class="rv-body"><div class="rv-main' + (peekT !== null ? " peeking" : "") + '">' +
        '<div class="rv-views" role="group" aria-label="View">' + vs.map(function (q) { return '<button type="button" class="chip sm" data-rv="view" data-v="' + esc(q.id) + '" aria-pressed="' + (q.id === v.id) + '">' + esc(q.label) + "</button>"; }).join("") + "</div>" + peekBar +
        '<div class="rv-view" id="rv-view" data-view="' + esc(v.id) + '"></div></div>' +
        '<aside class="rv-side" aria-label="The room and the beat">' + secs.map(function (s) { return '<section class="rv-sec" data-sec="' + esc(s.id) + '"></section>'; }).join("") + "</aside></div>" +
        '<ul class="rv-menu" id="rv-menu" hidden>' + menuItems.map(function (it, i) { return '<li><button type="button" class="rv-btn" data-rv="menuitem" data-i="' + i + '">' + esc(it.label) + "</button></li>"; }).join("") + "</ul>";
      try { v.render(box.querySelector("#rv-view"), ctx); } catch (e) { box.querySelector("#rv-view").textContent = "This view could not be drawn: " + (e && e.message || e); }
      secs.forEach(function (s) {
        var el = box.querySelector('.rv-sec[data-sec="' + s.id + '"]');
        try { s.render(el, ctx); } catch (e) { el.textContent = "This section could not be drawn: " + (e && e.message || e); }
      });
      paintChip(box);
    };

    /* actions */
    function atTime(t, why) { if (host.set({ t: t })) host.publish(t, why); self.rerender(); }
    function startNight(t) { if (host.set({ v: 2, start: t, t: t })) host.publish(t, "start"); peekT = null; self.rerender(); }
    function placeAt(pc, room) {
      var rs = site(); if (!rs) return;
      var st = host.state(), bi = B.beatOf(rs.play, timeOf(st)).i;
      if (host.set({ crew: moveCrew(st, pc, room, bi) })) { arm = ""; sel = room; }
      self.rerender();
    }
    self.step = function (dir) { var rs = site(); if (!rs) return false; var st = host.state(), t = stepTime(rs.play, st, dir); if (t === null) return false; peekT = null; atTime(t, "beat"); return true; };
    self.jump = function () { var rs = site(); if (!rs) return false; var st = host.state(), t = jumpTime(rs.play, st); if (t === null) { host.toast("Nothing more happens tonight."); return false; } peekT = null; atTime(t, "jump"); return true; };
    self.peek = function (t) { var rs = site(); if (!rs) return; var st = host.state(); peekT = isStarted(st) && t !== timeOf(st) ? t : null; self.rerender(); };
    self.unpeek = function () { if (peekT === null) return false; peekT = null; self.rerender(); return true; };
    self.peeking = function () { return peekT !== null; };
    self.reset = function () { peekT = null; sel = ""; arm = ""; drag = null; };

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
        case "alarm": alarmOpen = !alarmOpen; self.rerender(); break;
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
        case "heard": {
          var way = el.getAttribute("data-way"), pc = el.getAttribute("data-pc");
          if (typeof hooks.heard === "function") hooks.heard(way, pc, build().ctx); else host.toast("Heard by is wired in the next ticket.");
          break;
        }
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

    self.attach = function (box) {
      boxEl = box;
      box.addEventListener("click", onClick); box.addEventListener("keydown", onKeyCard); box.addEventListener("pointerdown", onDown);
    };
    self.dragging = function () { return !!(drag && drag.moved); };
    self.detach = function () { var i = live.indexOf(self); if (i >= 0) live.splice(i, 1); };
    return self;
  }

  return { create: create, model: model, moveCrew: moveCrew, stepTime: stepTime, jumpTime: jumpTime, startMinutes: startMinutes, initials: initials,
    setPlayersChip: setPlayersChip, menuItems: menuItems, views: views, sections: sections, hooks: hooks };
});
