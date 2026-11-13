/* B68GmScene (gm/scene-state.js) — MK1: the map kit's new options (people, a crowd, room lights, the stage layout, one room as a stage set), built
 * from the Run view's model and the site's play block. PURE: no DOM, no clock, no network. Load: after gm/ball.js; in Node, require() returns the
 * same object (it needs ball.js beside it).
 *
 * The four settings (app/features.js, GM only, off until chosen): map.fill (the shared screen's map uses layout "stage"), map.people (people and
 * a crowd), map.lights (a room lit by a False dawn event while it runs), map.room (Cut to room: view "room" on the shared screen).
 * OFF MEANS TODAY: with all four off, gm() and forPlayer() hand back the options object they were given, untouched, and an empty key.
 *
 * API
 *   IDS SCREENS ICON_ROLE                                   the setting ids; the shared screen sizes; a disguise's icon -> the role it dresses as
 *   flags(read) -> { fill, people, lights, room }           read(id) -> bool (the page's b09On)        anyOn(f) -> bool
 *   screenOf(v) -> 'ipad' | 'tv'                             the map UI's optional `screen` key; anything else is the iPad
 *   initials(label)                                          as the Run view's pills write them (run-view.js initials)
 *   toneOf(kind) roleOf(kind)                                a person's kind -> the kit's tone; -> the role an anonymous stand-in is drawn as
 *   gmPeople(model, input) -> [person]                       the GM copy: every PC and every person the Run view's board places, in its rooms
 *   playerPeople(input, shown) -> [person]                   the player copy: the crew ONLY, in the rooms in `shown`
 *   crowdOf(play) -> true | { masked: true }                 lightsAt(play, t, known) -> { room: 'bright' } (fx "dawn" events in the beat at t; only `known` ones when given)
 *   knownEvents(play, st, open) -> { id: true }               the events the players may know (B68GmBall.playerView's own rule)
 *   stageOk(K) -> bool                                       the vendored map kit lists layout "stage" (B68Map.options().layouts)
 *   gm(o, f, input) -> key                                   merges the GM copy's keys into o (a run's GM layer); '' and o untouched when off
 *   forPlayer(o, sc, shown, f) -> { opts, key }              THE ONE DOOR for a player copy: a NEW options object, o untouched; { o, '' } when off
 *   roomViewOk(K) -> bool                                    the vendored map kit lists view "room" (B68Map.options().views)
 *
 *   A person is { room, spec } or { room, role, seed } plus { mark, tone, label }: the contract's people (CONTRACT.md section 2).
 *   input (GM) = { model, play, crew, pcs: [{ id, name, spec }], cast(person) -> spec | null, t, kit }
 *   sc (player) = { pcs: [{ id, name, spec }], crew, disguises: [{ id, icon }], crowd, lights, screen, view, room, kit }
 *     It never holds the play's people: the player copy cannot draw a cast member because it is never given one.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ball.js"));
  else root.B68GmScene = factory(root.B68GmBall);
})(typeof self !== "undefined" ? self : this, function (B) {
  "use strict";

  var isObj = function (v) { return !!v && typeof v === "object" && !Array.isArray(v); };
  var str = function (v) { return typeof v === "string" ? v : v == null ? "" : String(v); };
  var list = function (v) { return Array.isArray(v) ? v : []; };
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  /* a figure spec as plain data (a copy: the page's own is never handed on), or null */
  function specOf(v) { if (!isObj(v) || !Object.keys(v).length) return null; try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }

  var IDS = { fill: "map.fill", people: "map.people", lights: "map.lights", room: "map.room" };
  var SCREENS = { ipad: { displayWidth: 1366, displayHeight: 1024 }, tv: { displayWidth: 1920, displayHeight: 1080 } };
  /* MK1 brief: a disguise's icon -> the role the crew member is dressed as ("guest" is a masked guest, by the figure) */
  var ICON_ROLE = { mask: "guest", tray: "waiter", crate: "porter", oar: "boatman", camera: "photographer", cards: "croupier", jacket: "guard", lamp: "technician" };
  var TONES = ["crew", "target", "guard", "staff", "contact", "rival"];
  /* the kit's light states (CONTRACT.md section 2): a dawn event lights its room "bright", the strongest */
  var LIGHT = ["dark", "lit", "bright"];

  function flags(read) {
    var r = typeof read === "function" ? read : function () { return false; }, f = {};
    Object.keys(IDS).forEach(function (k) { var v = false; try { v = r(IDS[k]) === true; } catch (e) { v = false; } f[k] = v; });
    return f;
  }
  function anyOn(f) { return isObj(f) && (f.fill === true || f.people === true || f.lights === true || f.room === true); }
  function screenOf(v) { return v === "tv" ? "tv" : "ipad"; }
  /* a map frame the shared screen reported: two whole numbers of px from 200 to 10000 (what the kit accepts as displayWidth / displayHeight) */
  function frameOk(f) { var ok = function (n) { return typeof n === "number" && n === Math.round(n) && n >= 200 && n <= 10000; }; return isObj(f) && ok(f.w) && ok(f.h); }
  /* MK2: is a newly reported frame a real change (more than `px` either way) from the one in use? */
  function frameMoved(cur, next, px) { if (!frameOk(next)) return false; if (!frameOk(cur)) return true; var d = px >= 0 ? px : 8; return Math.abs(cur.w - next.w) > d || Math.abs(cur.h - next.h) > d; }
  /* MK2 (the review): following the reported frame, so two screens cannot make the map flap. frameTrack(state, next, now) -> { state, resend }:
     a new frame (more than 8 px off) is taken and asks for one re-send, at most FRAME_SENDS times in any FRAME_WINDOW; a change beyond that stops
     following (state.stopped, frame null: the Shared screen select sizes the stage) and sends nothing. A null state starts afresh (the GM chose in
     the select, or the page was reloaded). */
  var FRAME_SENDS = 2, FRAME_WINDOW = 10 * 60 * 1000;
  function frameTrack(st, next, now) {
    var s = isObj(st) ? { frame: frameOk(st.frame) ? { w: st.frame.w, h: st.frame.h } : null, sends: list(st.sends).slice(), stopped: st.stopped === true } : { frame: null, sends: [], stopped: false };
    if (s.stopped || !frameMoved(s.frame, next, 8)) return { state: s, resend: false };
    var t = +now || 0; s.sends = s.sends.filter(function (x) { return t - x < FRAME_WINDOW; });
    if (s.sends.length >= FRAME_SENDS) { s.stopped = true; s.frame = null; return { state: s, resend: false }; }
    s.frame = { w: next.w, h: next.h }; s.sends.push(t);
    return { state: s, resend: true };
  }
  function initials(label) {
    var out = "";
    str(label).trim().split(/\s+/).filter(Boolean).slice(0, 2).forEach(function (w) { out += Array.from(w)[0].toUpperCase(); });
    return out || "?";
  }
  function toneOf(kind) { return TONES.indexOf(kind) >= 0 ? kind : "staff"; }
  function roleOf(kind) { return kind === "guard" ? "guard" : kind === "staff" ? "waiter" : "resident"; }

  /* the figure kit's role ids (CONTRACT.md section 1): the kit's own roles() when it has one, else the contract's fixed list */
  var ROLE_IDS = ["guest-f", "guest-m", "waiter", "croupier", "photographer", "guard", "bluecoat", "mechanic", "docker", "porter", "cook", "technician", "boatman",
    "barkeep", "drinker", "shopkeeper", "resident", "clerk", "usher", "kitchen-hand", "cleaner", "warehouse-hand", "driver", "sailor", "dancer", "punter", "cinema-goer",
    "shopper", "street-kid", "teller", "official", "scholar", "teacher", "pupil", "priest", "acolyte", "officer", "servant", "noble"];
  function rolesOf(kit) {
    var r = null; try { r = kit && typeof kit.roles === "function" ? kit.roles() : null; } catch (e) { r = null; }
    var ids = list(r).map(function (x) { return isObj(x) ? str(x.id) : str(x); }).filter(Boolean);
    return ids.length ? ids : ROLE_IDS;
  }
  /* a person drawn from a spec, or from a role when there is none (the seed keeps the stand-in the same person every time). MK2: a role the play
     gives the person (a known role id) wins over the one from their kind; an unknown one is ignored */
  function body(room, spec, kind, seed, role, kit) {
    var s = specOf(spec);
    if (s) return { room: room, spec: s };
    var r = typeof role === "string" && role && rolesOf(kit).indexOf(role) >= 0 ? role : roleOf(kind);
    return { room: room, role: r, seed: str(seed) };
  }
  /* a crew member in a disguise the play defines: the same person in that role's clothes, when the figure kit can dress (kit 3.0.1 cannot: left as is) */
  function dressed(p, icon, kit) {
    var role = ICON_ROLE[str(icon)];
    if (!role || !p.spec || !kit || typeof kit.dress !== "function") return p;
    var masked = role === "guest", r = masked ? (p.spec.figure === "fem" ? "guest-f" : "guest-m") : role, out;
    try { out = kit.dress(p.spec, r, masked ? { masked: true } : {}); } catch (e) { return p; }
    if (isObj(out)) p.spec = specOf(out) || p.spec;
    return p;
  }
  function iconFor(crew, id, disguises) {
    var cw = isObj(crew) && isObj(crew[id]) ? crew[id] : null, d = cw ? str(cw.disguise) : "";
    if (!d) return "";
    var hit = list(disguises).filter(function (x) { return isObj(x) && x.id === d; })[0];
    return hit ? str(hit.icon) : "";
  }
  function roomOf(crew, id) { var at = isObj(crew) && has(crew, id) ? crew[id] : null; var room = isObj(at) ? at.room : at; return typeof room === "string" ? room : ""; }

  /* ---- the GM copy: what the Run view's pills show (runV2Tokens: every card with a floor, its PCs then its people, in room order) ---- */
  function gmPeople(model, input) {
    var cards = isObj(model) && isObj(model.cards) ? model.cards : {}, inp = isObj(input) ? input : {}, out = [];
    var pcs = {}; list(inp.pcs).forEach(function (c) { if (isObj(c) && str(c.id)) pcs[c.id] = c; });
    var people = {}; list(isObj(inp.play) ? inp.play.people : []).forEach(function (p) { if (isObj(p) && str(p.id)) people[p.id] = p; });
    var disg = list(isObj(inp.play) ? inp.play.disguises : []);
    Object.keys(cards).sort().forEach(function (name) {
      var c = cards[name]; if (!isObj(c) || c.lvl === null) return;
      list(c.pcs).forEach(function (chip) {
        var pc = pcs[chip.id] || {}, p = body(name, pc.spec, "crew", chip.id);
        p.mark = str(chip.ini) || initials(chip.name); p.tone = "crew"; p.label = str(chip.name);
        out.push(dressed(p, iconFor(inp.crew, chip.id, disg), inp.kit));
      });
      list(c.npcs).forEach(function (n) {
        var person = people[n.id] || null, spec = null;
        if (person && typeof inp.cast === "function") { try { spec = inp.cast(person); } catch (e) { spec = null; } }
        var p = body(name, spec, str(n.kind), n.id, person ? person.role : null, inp.kit);
        p.mark = str(n.ini) || initials(n.label); p.tone = toneOf(str(n.kind)); p.label = str(n.label);
        out.push(p);
      });
    });
    return out;
  }

  /* ---- the player copy: the crew, and only the crew, in rooms the players can see ---- */
  function playerPeople(sc, shown) {
    var s = isObj(sc) ? sc : {}, open = {}, out = [];
    list(shown).forEach(function (n) { if (typeof n === "string" && n) open[n] = true; });
    list(s.pcs).forEach(function (c) {
      if (!isObj(c) || !str(c.id)) return;
      var room = roomOf(s.crew, c.id), name = str(c.name).trim();
      if (!room || !open[room] || !name) return;
      var p = body(room, c.spec, "crew", c.id);
      p.mark = initials(name); p.tone = "crew"; p.label = name;
      out.push(dressed(p, iconFor(s.crew, c.id, s.disguises), s.kit));
    });
    return out.sort(function (a, b) { return a.room < b.room ? -1 : a.room > b.room ? 1 : 0; });
  }

  function crowdOf(play) { return isObj(play) && isObj(play.crowd) && play.crowd.masked === true ? { masked: true } : true; }
  /* the rooms lit at minute t: each event with fx "dawn" that falls in the beat holding t (the beat the Run view shows as happening) */
  /* known (optional): { <event id>: true }, the events a light may come from. The GM copy passes nothing (every running event); the player copy
     passes knownEvents (what the players may know), so a hidden event never lights a room on the shared screen */
  function lightsAt(play, t, known) {
    var out = {}; if (!isObj(play) || !isObj(play.clock)) return out;
    var now = B.beatOf(play, +t || 0).i, span = B.minuteOf(play.clock.end, play.clock.start), only = isObj(known) ? known : null;
    list(play.events).forEach(function (e) {
      if (!isObj(e) || e.fx !== "dawn" || typeof e.room !== "string" || !e.room) return;
      if (only && only[e.id] !== true) return;
      var m = B.minuteOf(e.at, play.clock.start); if (isNaN(m) || !(m <= span)) return;      /* after the night's end: never (beatOf would clamp it into the last beat) */
      if (B.beatOf(play, m).i === now) out[e.room] = "bright";
    });
    return out;
  }
  /* the events the players may know, by the players' own view (B68GmBall.playerView, the mission's one reader of the play: public, "seen" with a PC
     in the room, or told through intel); without that view (a v1 play) the public events only. A hidden event that was not told is never in it. */
  function knownEvents(play, st, open) {
    var out = {}, v = null;
    try { v = typeof B.playerView === "function" ? B.playerView(play, isObj(st) ? st : {}, list(open)) : null; } catch (e) { v = null; }
    if (v && Array.isArray(v.events)) v.events.forEach(function (e) { if (isObj(e) && typeof e.id === "string") out[e.id] = true; });
    else list(isObj(play) ? play.events : []).forEach(function (e) { if (isObj(e) && e.vis === "public" && typeof e.id === "string") out[e.id] = true; });
    return out;
  }

  /* a short, stable key for a value (FNV-1a over its JSON): what the cache keys and the live map compare */
  function keyOf(v) {
    var s = JSON.stringify(v) || "", h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8) + "." + s.length;
  }
  function plain(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== "figures") c[k] = o[k]; }); return c; }
  /* the key of a player scene input: everything but the figure kit itself (only whether it is there) */
  function inputKey(sc) {
    var c = {}; if (!isObj(sc)) return "";
    Object.keys(sc).forEach(function (k) { if (k === "images") c[k] = Object.keys(isObj(sc[k]) ? sc[k] : {}).sort(); else if (k !== "kit") c[k] = sc[k]; });      /* a picture by its key, not its bytes */
    return keyOf([c, !!sc.kit]);
  }

  /* the GM copy of a run (the GM layer): people, the crowd and the lights merged into o; the key names what was added ('' when nothing) */
  function gm(o, f, input) {
    if (!isObj(o) || !anyOn(f)) return "";
    var inp = isObj(input) ? input : {}, add = {};
    if (f.people) { add.people = gmPeople(inp.model, inp); add.crowd = crowdOf(inp.play); add.figures = { kit: inp.kit }; }
    if (f.lights) { var l = lightsAt(inp.play, inp.t); if (Object.keys(l).length) add.lights = l; }
    if (!Object.keys(add).length) return "";
    Object.keys(add).forEach(function (k) { o[k] = add[k]; });
    return "scene:" + keyOf([plain(add), !!inp.kit]);
  }

  /* THE ONE DOOR for a player copy (the shared screen). From o (mapOpts' player options) and sc (the page's scene input), a NEW options object
     with what the settings govern, filtered to `shown` (the rooms a marker may stand in: tokenRooms). Only the crew is ever added; a light or the
     room view in a room not shown is dropped. The page's checks (tokenScreen on the labels, the leak scan of the drawn map) run after this. */
  function forPlayer(o, sc, shown, f) {
    if (!isObj(o) || !isObj(sc) || !anyOn(f)) return { opts: o, key: "" };
    var out = Object.assign({}, o), add = {}, open = {};
    list(shown).forEach(function (n) { if (typeof n === "string" && n) open[n] = true; });
    /* the stage layout only where the vendored kit draws it (sc.stage: stageOk(B68Map)); else the layout stays as today */
    /* sized to the map frame the shared screen last reported (sc.frame), else to the Shared screen select (the fallback) */
    if (f.fill && sc.stage === true) {
      var sz = frameOk(sc.frame) ? { displayWidth: sc.frame.w, displayHeight: sc.frame.h } : SCREENS[screenOf(sc.screen)];
      add.layout = "stage"; add.displayWidth = sz.displayWidth; add.displayHeight = sz.displayHeight;
    }
    if (f.people) {
      add.people = playerPeople(sc, shown);
      add.crowd = isObj(sc.crowd) && sc.crowd.masked === true ? { masked: true } : true;
      add.figures = { kit: sc.kit };
    }
    if (f.lights && isObj(sc.lights)) {
      var l = {}; Object.keys(sc.lights).forEach(function (r) { if (open[r] && LIGHT.indexOf(sc.lights[r]) >= 0) l[r] = sc.lights[r]; });
      if (Object.keys(l).length) add.lights = l;
    }
    if (f.room && sc.view === "room" && typeof sc.room === "string" && open[sc.room]) {
      add.view = "room"; add.room = sc.room;
      if (add.people) add.people = roomPeople(add.people, sc.room, sc.images);
    }
    /* MK2 4b: one floor on the shared screen (the GM's iPad floor control; the page offers only the floors the kit's player copy titles) */
    if (Number.isInteger(sc.floor) && add.view !== "room") add.floor = sc.floor;
    Object.keys(add).forEach(function (k) { out[k] = add[k]; });
    return { opts: out, key: Object.keys(add).length ? "scene:" + keyOf([plain(add), !!sc.kit]) : "" };
  }
  /* MK2 step 4: in the room view, the room's people large. A person the page has a picture of (a data:image/ URL the kit accepts, made with the
     figure kit's rasterize) is drawn as that picture; without one, the kit renders the spec, and that is allowed for three people at most (five
     rendered figures are about 500 KiB): the others are left out. */
  var IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  var ROOM_SPECS = 3;
  function imageOk(im) { return isObj(im) && typeof im.href === "string" && IMG_RE.test(im.href) && +im.width > 0 && +im.height > 0; }
  function imageKey(p) { return keyOf(isObj(p) && p.spec ? p.spec : [p && p.role, p && p.seed]); }
  function roomPeople(people, room, images) {
    var imgs = isObj(images) ? images : {}, out = [], specs = 0;
    list(people).forEach(function (p) {
      if (!isObj(p) || p.room !== room) return;
      var im = imgs[imageKey(p)];
      if (imageOk(im)) { out.push(Object.assign({}, p, { image: { href: im.href, width: +im.width, height: +im.height } })); return; }
      if (specs < ROOM_SPECS) { specs++; out.push(p); }
    });
    return out;
  }

  function kitOpts(K) { try { return K && typeof K.options === "function" ? K.options() : null; } catch (e) { return null; } }
  function roomViewOk(K) { var o = kitOpts(K); return !!(o && list(o.views).indexOf("room") >= 0); }
  /* the vendored map kit draws layout "stage" (it lists it among its layouts); kit 1.0.0 does not, and falls back to a sheet */
  function stageOk(K) { var o = kitOpts(K); return !!(o && list(o.layouts).indexOf("stage") >= 0); }

  /* MK2 (the overseer's ruling: name each person once). The kit draws people in these views only; a person it draws as a figure carries the
     flag with their mark and their label, so the older pin (the run's marker with its name strip) is not sent for them as well.
     figured(people, view) -> [{ room, mark, label }]: the people with a figure of their own and a mark, in a view that draws people.
     allDrawn(result, want) -> bool: the kit's result says it drew every one of them (result.people: [{ room, mark }]); otherwise the page
     sends the old pins after all, so nobody is left unnamed (a room with no space for them, a kit that does not report). */
  var PEOPLE_VIEWS = ["iso", "plan", "section"];
  function figured(people, view) {
    if (PEOPLE_VIEWS.indexOf(view) < 0) return [];
    return list(people).filter(function (p) { return isObj(p) && isObj(p.spec) && typeof p.mark === "string" && p.mark; }).map(function (p) { return { room: str(p.room), mark: p.mark, label: str(p.label) }; });
  }
  function allDrawn(result, want) {
    var w = list(want); if (!w.length) return true;
    var got = isObj(result) && Array.isArray(result.people) ? result.people : null; if (!got) return false;
    return w.every(function (x) { return got.some(function (d) { return isObj(d) && d.room === x.room && d.mark === x.mark; }); });
  }

  return { IDS: IDS, SCREENS: SCREENS, ICON_ROLE: ICON_ROLE, flags: flags, anyOn: anyOn, screenOf: screenOf, initials: initials, toneOf: toneOf, roleOf: roleOf,
    gmPeople: gmPeople, playerPeople: playerPeople, crowdOf: crowdOf, lightsAt: lightsAt, knownEvents: knownEvents, gm: gm, forPlayer: forPlayer, roomViewOk: roomViewOk,
    stageOk: stageOk, frameOk: frameOk, frameMoved: frameMoved, frameTrack: frameTrack, FRAME_SENDS: FRAME_SENDS, FRAME_WINDOW: FRAME_WINDOW, rolesOf: rolesOf, ROLE_IDS: ROLE_IDS, keyOf: keyOf, inputKey: inputKey, imageKey: imageKey, imageOk: imageOk, roomPeople: roomPeople, ROOM_SPECS: ROOM_SPECS,
    figured: figured, allDrawn: allDrawn, PEOPLE_VIEWS: PEOPLE_VIEWS };
});
