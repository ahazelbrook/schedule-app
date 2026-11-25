/* gm/room-intro.js: the GM half of the room opening (RK29 of the room key build, behind the setting room.intro). B68GmRoomIntro.

   WHAT IT DOES. While the map is live on the iPad (Show on iPad, then live reveal), a push from liveReveal that newly shows rooms carries
   `arrive`: [{ id, n, name, band, floor }], at most 8, in the roll's order. The iPad plays a title card for them (display/room-intro.js).
     - A room is newly shown when it is opened on its own (room:<name>), when its band is ticked, or when a blueprint room (map.knowledge's `know`:
       a name and an outline only) is now seen in full. The diff is taken against what the iPad has LANDED (S.mapOn when the push is sent), so a
       marker push queued behind a room push never names the room again.
     - id and n are the PLAYER copy's: the kit renumbers it, so they come from the model of the very render that was sent (playerDisplay keeps it
       as d.rooms while the setting is on). Only a room drawn in the svg sent counts (a room on a floor the iPad is not showing is left out).
     - The map kit's iso floor polygons carry data-band but not data-room (a kit bug: map-kit.js toSVG writes data-room on groups only). So the
       new rooms' floor polygons are tagged here, in the svg string, by matching their points to the model's room shapes (the preview's tagFloors).
       Ids only, never a name, so the hidden-name scan (leaks) is unaffected. A tagged copy over the iPad's cap goes untagged.
     - The first Show on iPad never carries arrive (the map appearing is not a room opening), nor does a change of view, theme, time, weather or
       markers: nothing newly shown, nothing sent.
   SECRECY. arrive names only rooms the sent svg shows, from the same reveal the scan passed; never a hidden room, a thing, a line or a person.
   THE TRAY. "Opening <room> on the iPad" while the card plays (this page's clock: the push answer plus the card's length), then the ordinary line.

   API (window.B68GmRoomIntro; module.exports under Node)
     rooms(render) -> d.rooms: the sent render's model rooms { id, n, name, band, lvl, floor, pts? } (playerDisplay, setting on)
     prep(d, ctx) -> { d, cands, wrap(opts) } | null
         d: playerDisplay's answer; ctx: { roll, was: { reveal, know } (what the iPad showed), know (the blueprint rooms now), landed() -> S.mapOn | null,
         later? }. d comes back with its svg tagged; wrap(opts) wraps the push's prepare (adds arrive, diffed at send time) and done (the tray)
     live(shown, nowMs) -> the tray's words ('' when no card plays)      CARD_MS
     Pure: MAX, BANDS, LEVEL_TITLES, fullNames(roll, reveal, know), fresh(roll, was, now), tagFloors(svg, rooms, ids), drawn(svg, room),
           entries(names, rooms, svg), arrive(roll, landed, cands) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomIntro = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }

  var Pure = {};
  Pure.MAX = 8;
  Pure.BANDS = ['public', 'working', 'controlled', 'secure'];
  Pure.LEVEL_TITLES = ['basement', 'ground floor', 'upper floor', 'top floor'];      /* the kit's own floor titles (gm-page.js P.LEVEL_TITLES) */
  Pure.CAP = 600 * 1024;                                                               /* the server's cap on a display svg (P.SVG_CAP) */
  /* the card's length on the iPad: the lead (display/room-intro.js LEAD_MS) and the card to its end (6.6 s) */
  var CARD_MS = 800 + 6600;

  function bandsOf(reveal) { return list(reveal).filter(function (e) { return typeof e === 'string' && e.indexOf('room:') !== 0; }); }
  /* the rooms shown IN FULL by a reveal list: shown (its band, or its own room: entry; gm-page.js roomShown), less a room known as a blueprint only
     (in `know` with its band shut: a name and an outline, nothing of what is in it; gm-page.js tokenRooms). Names, each once, in the roll's order */
  Pure.fullNames = function (roll, reveal, know) {
    var rv = list(reveal), bp = list(know), bands = bandsOf(rv), out = [];
    list(roll && roll.rooms).forEach(function (r) {
      if (!isObj(r) || typeof r.name !== 'string' || !r.name || out.indexOf(r.name) >= 0) return;
      var shown = rv.indexOf(r.band) >= 0 || rv.indexOf('room:' + r.name) >= 0;
      if (shown && !(bp.indexOf(r.name) >= 0 && bands.indexOf(r.band) < 0)) out.push(r.name);
    });
    return out;
  };
  /* the names shown in full now and not before (was, now: { reveal, know }), in the roll's order */
  Pure.fresh = function (roll, was, now) {
    var before = isObj(was) ? Pure.fullNames(roll, was.reveal, was.know) : [];
    return Pure.fullNames(roll, isObj(now) ? now.reveal : [], isObj(now) ? now.know : []).filter(function (n) { return before.indexOf(n) < 0; });
  };

  /* the numbers of a points attribute, as [x, y] pairs (a slimmed svg may drop the separators) */
  function pairs(s) {
    var n = (str(s).match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number), out = [];
    for (var i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
    return out;
  }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  /* tag the floor polygons of these rooms (ids) with data-room, matching each polygon's points to the room's shape at the kit's two decimals
     (a slimmed copy rounds to one, so within 0.06). A polygon that already has data-room, or that matches no room, is left as it is.
     Each floor is drawn in its own coordinates, so two rooms on different floors can share a shape and a band: such a polygon is told apart by
     its floor, learnt from the groups it is drawn in (the transforms around it), which the polygons that match one room alone name. Still two:
     left as it is. rooms: d.rooms ({ id, band, lvl, pts }), all of them (they teach the floors); only the ids given are tagged.
     The secure band's tone is a second polygon on the same shape: it is tagged too, as the preview found */
  Pure.tagFloors = function (svg, rooms, ids) {
    var all = list(rooms).filter(function (r) { return isObj(r) && Array.isArray(r.pts) && r.pts.length >= 3 && /^r\d{1,3}$/.test(str(r.id)); }), tagged = 0;
    if (typeof svg !== 'string' || !all.some(function (r) { return !ids || ids.indexOf(r.id) >= 0; })) return { svg: svg, tagged: 0 };
    var stack = [], polys = [], floorOf = {};
    svg.replace(/<g\b[^>]*>|<\/g\s*>|<polygon\b[^>]*>/g, function (tag) {
      if (tag.charAt(1) === '/') stack.pop();
      else if (tag.charAt(1) === 'g') { if (!/\/>$/.test(tag)) stack.push(attr(tag, 'transform') || ''); }
      else {
        var band = attr(tag, 'data-band'), p = band && attr(tag, 'data-room') === null ? pairs(attr(tag, 'points')) : null, key = stack.join('|');
        var hit = p ? all.filter(function (r) { return r.band === band && r.pts.length === p.length && r.pts.every(function (q, i) { return Math.abs(q[0] - p[i][0]) < 0.06 && Math.abs(q[1] - p[i][1]) < 0.06; }); }) : [];
        if (hit.length === 1) floorOf[key] = key in floorOf && floorOf[key] !== hit[0].lvl ? null : hit[0].lvl;
        polys.push({ hit: hit, key: key });
      }
      return tag;
    });
    var i = 0;
    var out = svg.replace(/<polygon\b[^>]*>/g, function (tag) {
      var pl = polys[i++], hit = pl ? pl.hit : [];
      if (hit.length > 1 && floorOf[pl.key] != null) hit = hit.filter(function (r) { return r.lvl === floorOf[pl.key]; });
      if (hit.length !== 1 || (ids && ids.indexOf(hit[0].id) < 0)) return tag;
      tagged++;
      return tag.replace(/\s*(\/?)>$/, ' data-room="' + hit[0].id + '"$1>');
    });
    return { svg: out, tagged: tagged };
  };
  /* is this room drawn in the svg? Its id on any element (a tagged floor, a piece of furniture), or its number badge */
  Pure.drawn = function (svg, room) {
    if (typeof svg !== 'string' || !isObj(room)) return false;
    if (/^r\d{1,3}$/.test(str(room.id)) && svg.indexOf('data-room="' + room.id + '"') >= 0) return true;
    var n = Number(room.n);
    return n >= 1 && Math.floor(n) === n && new RegExp('class="room-label[^"]*"[^>]*>(?:<rect[^>]*>(?:</rect>)?)*<text[^>]*>' + n + '</text>').test(svg);
  };
  /* the arrive entries for these names: every room of the sent model with one of them (names repeat within a site: each is its own room), drawn in
     the svg, in the roll's order (names) then the model's, at most MAX */
  Pure.entries = function (names, rooms, svg) {
    var out = [];
    list(names).forEach(function (n) {
      list(rooms).forEach(function (r) {
        if (out.length >= Pure.MAX || !isObj(r) || r.name !== n || !/^r\d{1,3}$/.test(str(r.id)) || Pure.BANDS.indexOf(r.band) < 0 || !Pure.drawn(svg, r)) return;
        var e = { id: r.id };
        if (typeof r.n === 'number' && r.n >= 1 && r.n <= 999 && Math.floor(r.n) === r.n) e.n = r.n;
        e.name = str(r.name).slice(0, 80); e.band = r.band;
        if (Pure.LEVEL_TITLES.indexOf(str(r.floor).toLowerCase()) >= 0) e.floor = r.floor;
        out.push(e);
      });
    });
    return out;
  };
  /* the arrive list at send time: the candidates (made when the copy was drawn) less any room the iPad already shows in full (landed) */
  Pure.arrive = function (roll, landed, cands) {
    if (!isObj(landed)) return [];
    var have = Pure.fullNames(roll, landed.reveal, landed.know);
    return list(cands).filter(function (e) { return have.indexOf(e.name) < 0; });
  };

  /* playerDisplay's d.rooms: the model of the render that was sent, with each floor's title (the kit's layout.levels) */
  function rooms(r) {
    var m = isObj(r) && isObj(r.model) ? r.model : null, titles = {};
    if (!m) return [];
    list(isObj(r.layout) ? r.layout.levels : null).forEach(function (l) { if (isObj(l) && typeof l.title === 'string') titles[l.lvl] = l.title; });
    return list(m.rooms).filter(isObj).map(function (x) {
      var o = { id: str(x.id), n: x.n, name: str(x.name), band: str(x.band), lvl: x.lvl, floor: titles[x.lvl] || '' };
      if (isObj(x.shape) && x.shape.kind === 'poly' && Array.isArray(x.shape.pts)) o.pts = x.shape.pts.map(function (q) { return [Math.round(Number(q[0]) * 100) / 100, Math.round(Number(q[1]) * 100) / 100]; });
      return o;
    });
  }

  var last = null;      /* { label, title, until }: the card this page last sent */
  function bytes(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } }
  function tray() { var T = W && W.B68GmIpadTray; if (T && typeof T.refresh === 'function') { try { T.refresh(); } catch (e) { /* the tray repaints on its own */ } } }

  function prep(d, ctx) {
    ctx = ctx || {};
    if (!isObj(d) || typeof d.svg !== 'string' || !Array.isArray(d.rooms) || !ctx.roll) return null;
    var names = Pure.fresh(ctx.roll, ctx.was, { reveal: d.reveal, know: ctx.know });
    if (!names.length) return null;
    var ids = [];
    d.rooms.forEach(function (r) { if (isObj(r) && names.indexOf(r.name) >= 0) ids.push(r.id); });
    var t = Pure.tagFloors(d.svg, d.rooms, ids), svg = t.tagged && bytes(t.svg) <= Pure.CAP ? t.svg : d.svg;
    var cands = Pure.entries(names, d.rooms, svg);
    if (!cands.length) return null;
    var nd = Object.assign({}, d, { svg: svg });
    return {
      d: nd, cands: cands,
      wrap: function (o) {
        o = o || {};
        var arrive = [];
        return Object.assign({}, o, {
          prepare: function (body) {
            var b = typeof o.prepare === 'function' ? o.prepare(body) : body;
            if (!isObj(b)) return b;
            arrive = Pure.arrive(ctx.roll, typeof ctx.landed === 'function' ? ctx.landed() : null, cands);
            return arrive.length ? Object.assign({}, b, { arrive: arrive }) : b;
          },
          done: function (r) {
            if (typeof o.done === 'function') o.done(r);
            if (!arrive.length) return;
            last = { label: arrive.length === 1 ? arrive[0].name : arrive.length + ' rooms', title: str(nd.title), until: Date.now() + CARD_MS };
            tray();
            var later = typeof ctx.later === 'function' ? ctx.later : function (f, ms) { return setTimeout(f, ms); };
            later(tray, CARD_MS + 50);
          }
        });
      }
    };
  }
  /* the tray's words while the card plays: what this page last opened, while the iPad still shows that map */
  function live(shown, now) {
    if (!last || !isObj(shown) || shown.kind !== 'svg' || !(now < last.until) || str(shown.title) !== last.title) return '';
    return last.label;
  }

  return { rooms: rooms, prep: prep, live: live, CARD_MS: CARD_MS, Pure: Pure, _reset: function () { last = null; } };
});
