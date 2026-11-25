/* display/room-intro.js: the room opening (RK29 of the room key build, behind the setting room.intro). B68RoomIntro.

   WHAT THE PLAYERS SEE. The GM opens a room or ticks a band on the live map; that push is an ordinary display of kind svg that carries `arrive`
   ([{ id, n, name, band, floor }], the rooms just opened, ids of the player copy that was sent; gm/room-intro.js). On every display page at once,
   the NPC introduction's grammar (display/players/intro.js), with the room cut from the map in the figure's place:
     0 s            THE CUT. A flat field in the site's own colour (the scheme's first colour: the "unsurveyed" cover that has just lifted), a coarse
                    halftone, thin black letterbox bars.
     0 to 0.7 s     THE ENTRANCE. The plate (the room, cut from the map on screen) comes in from the right as a black silhouette.
     0.7 s          THE FREEZE. A white flash; the plate in colour, its silhouette left as an offset print shadow.
     0.9 to 1.4 s   THE NAME. Kicker tapes (the band, then the floor; for several rooms the band and "4 rooms", with the floor when they share one),
                    then the name with its offset copy (up to 3 names, then "and N more").
     4 to 6.6 s     THE HAND-OVER. The type and the ground wipe away, the bars leave; the plate's pieces settle onto their rooms on the map beneath
                    (4.2 to 4.76 s) and fade into them (by 4.94 s); a ring pulses on each room's floor (4.9 to 6.4 s, drawn inside the map's own svg);
                    the card is gone at 6.6 s.
   Under the card, from the first frame, is the ordinary map stage (display-page.js paints it as for any svg), which already holds the new rooms.
   The device asking for reduced motion: the frozen frame, still, for 3 s, then a cut, with no ring. Hold scenes still (fx.off) does not stop it:
   a sent event plays in full (the overseer's ruling of 13/11, as for the NPC card).

   ONE CLOCK, the NPC card's: zero is the display's updatedAt (the server's time of the push) plus LEAD_MS, on the server's clock (the page's skew),
   so every screen is at the same frame. A page that first sees the push once the hand-over has begun (LATE_MS) shows the map only. The next
   push (another seq) cuts the card at once.

   THE PLATE is cut from the svg on screen: each new room's [data-room] elements (its floor, which the GM half tags, its furniture and the shade
   pass's copies) and its .room-label badge, cloned in place (each in a group carrying its parent's transform relative to the root) into a new svg
   cropped to their box; url(#...) resolves against the map's own defs in the same document. One piece per room: a band's rooms are stacked at
   their true scale and left-right place, the empty floors between them closed up, and each piece lands on its own room. No plate found: the
   type plays alone on the field.

   SECRECY. Drawn only from display.arrive (rooms the sent svg shows) and the svg on screen. Every string goes in with textContent. No request,
   no markup sink.

   API (window.B68RoomIntro; module.exports under Node for the Pure part)
     attach(container, env) -> { next(display, seq), cut(), state() -> { seq, at } | null, destroy() }
       env: { document, on() -> bool (the setting), still() -> bool (reduced motion), skew() -> ms, at() -> the display's updatedAt,
              svg() -> the map svg on screen | null, later(fn, ms), clearLater(id) }
       next() is called by the page's show() for EVERY display it paints: another seq cuts a card that is up, at once; arrive starts one.
     Pure: T, LEAD_MS, STILL_MS, LATE_MS, SIGNAL, position(at, now, skew), clean(arrive), wants(display, on), startable(pos, still), kicker(rooms),
           names(rooms), colour(v), lum(hex), palette(field), fit(measure, o), sizes(n, portrait), SCALES, pick(trials), stack(boxes) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68RoomIntro = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function txt(v, n) { var s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; return n && s.length > n ? s.slice(0, n) : s; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  /* ---------- Pure ---------- */
  var Pure = {};
  /* the timeline, ms from the card's zero (intro.js's, with the hand-over at 4 s and the ring after it; end: the card is removed) */
  Pure.T = { enter: 0, freeze: 700, kicker: 900, name: 1000, name2: 1060, more: 1250, out: 4000, settle: 4200, fade: 4760, ring: 4900, end: 6600 };
  Pure.LEAD_MS = 800;              /* as the NPC card: the screens' polls (poked by live sync) land before the plate enters */
  Pure.STILL_MS = 3000;            /* reduced motion: the frozen frame for this long, then a cut */
  Pure.LATE_MS = Pure.T.out;       /* the late window ends when the hand-over begins: after it, the map only */
  Pure.SIGNAL = '#e0691e';
  Pure.PAPER = '#fbf8f1';
  Pure.INK = '#14110e';
  Pure.BANDS = ['public', 'working', 'controlled', 'secure'];
  Pure.BAND_WORD = { public: 'Public', working: 'Working', controlled: 'Controlled', secure: 'Secure' };
  Pure.FLOORS = ['basement', 'ground floor', 'upper floor', 'top floor'];
  Pure.MAX = 8;
  Pure.position = function (at, nowMs, skewMs) {
    var z = typeof at === 'string' ? Date.parse(at) : typeof at === 'number' ? at : NaN;
    if (!isFinite(z) || !isFinite(nowMs)) return null;
    return Math.round(nowMs + num(skewMs) - (z + Pure.LEAD_MS));
  };
  /* the server's rule again (functions/_lib/gm.js cleanArrive): a bad entry is dropped, at most 8 */
  Pure.clean = function (arrive) {
    var out = [];
    (Array.isArray(arrive) ? arrive.slice(0, 64) : []).forEach(function (e) {
      if (out.length >= Pure.MAX || !isObj(e) || typeof e.id !== 'string' || !/^r\d{1,3}$/.test(e.id)) return;
      var name = txt(e.name, 80);
      if (!name || Pure.BANDS.indexOf(e.band) < 0) return;
      if (e.n !== undefined && !(typeof e.n === 'number' && e.n >= 1 && e.n <= 999 && Math.floor(e.n) === e.n)) return;
      var fl = typeof e.floor === 'string' && Pure.FLOORS.indexOf(e.floor.toLowerCase()) >= 0 ? e.floor : '';
      out.push({ id: e.id, n: typeof e.n === 'number' ? e.n : null, name: name, band: e.band, floor: fl });
    });
    return out;
  };
  /* a card is played for this display: the setting on, an svg display (a map) that carries at least one good arrive entry */
  Pure.wants = function (display, on) {
    return !!on && isObj(display) && display.kind === 'svg' && typeof display.svg === 'string' && Pure.clean(display.arrive).length > 0;
  };
  Pure.startable = function (pos, still) {
    if (typeof pos !== 'number' || !isFinite(pos)) return false;
    return pos < (still ? Pure.STILL_MS : Pure.LATE_MS);
  };
  /* the tapes: one room: its band, then its floor; several: their band(s), then "4 rooms", with " · <floor>" when they all share one */
  Pure.kicker = function (rooms) {
    var r = Array.isArray(rooms) ? rooms : [], bands = [], floors = [];
    r.forEach(function (x) { if (bands.indexOf(x.band) < 0) bands.push(x.band); if (x.floor && floors.indexOf(x.floor) < 0) floors.push(x.floor); });
    var bw = bands.map(function (b) { return Pure.BAND_WORD[b] || b; }).join(' · ');
    if (r.length <= 1) return [bw, r.length && r[0].floor ? r[0].floor : ''].filter(Boolean);
    return [bw, r.length + ' rooms' + (floors.length === 1 && r.every(function (x) { return x.floor === floors[0]; }) ? ' · ' + floors[0] : '')];
  };
  /* the name block: up to 3 names, then "and N more" */
  Pure.names = function (rooms) {
    var r = Array.isArray(rooms) ? rooms : [];
    return { lines: r.slice(0, 3).map(function (x) { return x.name; }), more: Math.max(0, r.length - 3) };
  };
  /* a colour as #rrggbb, or null */
  Pure.colour = function (v) {
    var s = txt(v).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
    return null;
  };
  function rgb(hex) { var h = hex.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); }
  Pure.lum = function (hex) {
    var c = rgb(Pure.colour(hex) || Pure.SIGNAL).map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return '#' + x.map(function (v, i) { var n = Math.round((v + (y[i] - v) * t) * 255); return (n < 16 ? '0' : '') + n.toString(16); }).join(''); }
  /* the colours on this field: ink (the name, read by luminance as the preview does), back (the offset copy: paper on a mid field, ink on a dark one,
     a deeper shade of the field on a pale one, where paper would vanish), the halftone's dot, and the ring (always the signal orange over ink) */
  Pure.palette = function (field) {
    var f = Pure.colour(field) || Pure.SIGNAL, L = Pure.lum(f), dark = L > 0.17;
    return { field: f, ink: dark ? Pure.INK : Pure.PAPER, back: dark ? (L > 0.45 ? mix(f, Pure.INK, 0.45) : Pure.PAPER) : Pure.INK,
      dot: dark ? 'rgb(20 17 14 / .34)' : 'rgb(20 17 14 / .42)', ring: Pure.SIGNAL };
  };
  /* the name's size steps (in vh): one name may wrap to two lines from 14 down to 6; a list is one name a line, all one size. Portrait (an iPad held
     upright) is smaller, as the type runs across the foot under the plate */
  Pure.sizes = function (n, portrait) {
    if (n > 1) return { max: Math.min(portrait ? 7 : 11, (portrait ? 21 : 33) / n), min: 3.5, wrap: false };
    return { max: portrait ? 9 : 14, min: portrait ? 4.5 : 6, wrap: true };
  };
  /* the plate's scales tried, and the choice: the largest name size weighed against the plate's (size × √scale); a tie keeps the larger plate */
  Pure.SCALES = [1, 0.85, 0.7, 0.55];
  Pure.pick = function (trials) {
    var best = null;
    (Array.isArray(trials) ? trials : []).forEach(function (t) { var sc = num(t.size) * Math.sqrt(num(t.s)); if (!best || sc > best.sc + 1e-9) best = { s: t.s, size: t.size, sc: sc }; });
    return best ? { s: best.s, size: best.size } : { s: 1, size: 0 };
  };
  /* the largest size from o.max down to o.min (step 0.94) at which measure(size, false) fits, else (o.wrap) measure(size, true); never under o.min */
  Pure.fit = function (measure, o) {
    o = o || {};
    var max = o.max || 14, min = o.min || 6, size = max, guard = 0;
    while (size >= min - 1e-9 && guard++ < 60) {
      if ((measure(size, false) || {}).fits) return { size: size, wrap: false };
      if (o.wrap && (measure(size, true) || {}).fits) return { size: size, wrap: true };
      size = Math.round(size * 0.94 * 100) / 100;
    }
    return { size: min, wrap: !!o.wrap };
  };
  /* the plate's layout from each piece's box (in the map's user units, { x, y, w, h }): rows top to bottom (pieces that overlap by more than a
     quarter of their height share a row), the empty floors between rows closed up to a tenth of the tallest piece; each piece's place as fractions
     of the plate (l, t, fw, fh). -> { w, h, at: [{ l, t, fw, fh }] in the order given } */
  Pure.stack = function (boxes) {
    var ps = (Array.isArray(boxes) ? boxes : []).map(function (b, i) { return { b: b, i: i }; });
    if (!ps.length) return null;
    ps.sort(function (a, c) { return a.b.y - c.b.y; });
    var rows = [], maxH = 0;
    ps.forEach(function (p) {
      maxH = Math.max(maxH, p.b.h);
      var row = rows[rows.length - 1];
      if (row && p.b.y < row.y1 - 0.25 * p.b.h) { row.items.push(p); row.y1 = Math.max(row.y1, p.b.y + p.b.h); }
      else rows.push({ y0: p.b.y, y1: p.b.y + p.b.h, items: [p] });
    });
    var gap = maxH * 0.1, cy = 0, x0 = Infinity, x1 = -Infinity;
    rows.forEach(function (row) { row.items.forEach(function (p) { p.cy = cy + (p.b.y - row.y0); x0 = Math.min(x0, p.b.x); x1 = Math.max(x1, p.b.x + p.b.w); }); cy += row.y1 - row.y0 + gap; });
    var Wd = x1 - x0, H = cy - gap, at = [];
    if (!(Wd > 0) || !(H > 0)) return null;
    ps.forEach(function (p) { at[p.i] = { l: (p.b.x - x0) / Wd, t: p.cy / H, fw: p.b.w / Wd, fh: p.b.h / H }; });
    return { w: Wd, h: H, at: at };
  };

  /* ---------- the card ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function el(doc, tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function safeId(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, ''); }
  function mtx(m) { return [m.a, m.b, m.c, m.d, m.e, m.f].map(function (v) { return Math.round(v * 10000) / 10000; }).join(' '); }

  /* the site's own colour: the map's "unsurveyed" cover (the kit paints it in the scheme's first colour); none drawn (every band open): null */
  function coverOf(svg) {
    try {
      var c = svg && typeof svg.querySelector === 'function' ? svg.querySelector('.map-cover path, .map-cover polygon, .map-cover rect') : null;
      return c ? Pure.colour(c.getAttribute('fill')) : null;
    } catch (e) { return null; }
  }

  /* one room's piece: its elements on the map, kept in place by their parent's transform relative to the root svg, and their box (user units) */
  function cutOne(doc, svg, r) {
    var els = Array.prototype.slice.call(svg.querySelectorAll('[data-room="' + safeId(r.id) + '"]'));
    if (r.n != null) Array.prototype.forEach.call(svg.querySelectorAll('.room-label'), function (g) { var t = g.querySelector('text'); if (t && txt(t.textContent) === String(r.n)) els.push(g); });
    els = els.filter(function (e) { return !els.some(function (o) { return o !== e && o.contains(e); }); });
    els.sort(function (a, b) { return a.compareDocumentPosition(b) & 4 ? -1 : 1; });
    var root = svg.getScreenCTM(); if (!root) return null;
    var inv = root.inverse(), Lf = Infinity, Tp = Infinity, Rt = -Infinity, Bt = -Infinity, pt = svg.createSVGPoint(), parts = [];
    els.forEach(function (e) {
      var rc = e.getBoundingClientRect(); if (!(rc.width > 0) || !(rc.height > 0)) return;
      [[rc.left, rc.top], [rc.right, rc.bottom]].forEach(function (c) { pt.x = c[0]; pt.y = c[1]; var p = pt.matrixTransform(inv); Lf = Math.min(Lf, p.x); Tp = Math.min(Tp, p.y); Rt = Math.max(Rt, p.x); Bt = Math.max(Bt, p.y); });
      var pm = e.parentNode && typeof e.parentNode.getScreenCTM === 'function' ? e.parentNode.getScreenCTM() : null;
      if (pm) parts.push({ node: e, m: mtx(inv.multiply(pm)) });
    });
    if (!parts.length || !(Rt > Lf) || !(Bt > Tp)) return null;
    var pad = Math.max(Rt - Lf, Bt - Tp) * 0.04, box = { x: Lf - pad, y: Tp - pad, w: Rt - Lf + 2 * pad, h: Bt - Tp + 2 * pad };
    function make() {
      var s2 = doc.createElementNS(NS, 'svg');
      s2.setAttribute('viewBox', [box.x, box.y, box.w, box.h].map(function (v) { return Math.round(v * 100) / 100; }).join(' '));
      s2.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      ['font-family', 'font-weight', 'font-style'].forEach(function (a) { if (svg.getAttribute(a)) s2.setAttribute(a, svg.getAttribute(a)); });
      s2.setAttribute('aria-hidden', 'true'); s2.setAttribute('focusable', 'false');
      parts.forEach(function (p) { var g = doc.createElementNS(NS, 'g'); g.setAttribute('transform', 'matrix(' + p.m + ')'); g.appendChild(p.node.cloneNode(true)); s2.appendChild(g); });
      return s2;
    }
    return { room: r, box: box, make: make };
  }
  function cutPlate(doc, svg, rooms) {
    var ps = [];
    rooms.forEach(function (r) { var p = null; try { p = cutOne(doc, svg, r); } catch (e) { p = null; } if (p) ps.push(p); });
    var st = Pure.stack(ps.map(function (p) { return p.box; }));
    if (!st) return null;
    ps.forEach(function (p, i) { p.l = st.at[i].l; p.t = st.at[i].t; p.fw = st.at[i].fw; p.fh = st.at[i].fh; });
    return { w: st.w, h: st.h, pieces: ps };
  }
  /* the ring: each new room's floor, outlined, inside the map's own svg (so it sits on the room at any size and zoom) */
  function addRings(doc, svg, rooms, pal) {
    var root = svg.getScreenCTM(); if (!root) return null;
    var inv = root.inverse(), g = doc.createElementNS(NS, 'g'), n = 0;
    g.setAttribute('class', 'ro-rings'); g.setAttribute('aria-hidden', 'true');
    g.style.setProperty('--ro-ringc', pal.ring);
    rooms.forEach(function (r) {
      Array.prototype.forEach.call(svg.querySelectorAll('polygon[data-room="' + safeId(r.id) + '"]'), function (poly) {
        if (/^url\(/.test(poly.getAttribute('fill') || '')) return;      /* the secure band's halftone tone: the same outline, once is enough */
        var pm = poly.parentNode && typeof poly.parentNode.getScreenCTM === 'function' ? poly.parentNode.getScreenCTM() : null; if (!pm) return;
        var w = doc.createElementNS(NS, 'g');
        w.setAttribute('transform', 'matrix(' + mtx(inv.multiply(pm)) + ')');
        ['ro-ring-a', 'ro-ring-b'].forEach(function (c) { var q = doc.createElementNS(NS, 'polygon'); q.setAttribute('points', poly.getAttribute('points')); q.setAttribute('class', c); w.appendChild(q); });
        g.appendChild(w); n++;
      });
    });
    if (!n) return null;
    svg.appendChild(g);
    return g;
  }

  function attach(container, env) {
    env = env || {};
    var doc = env.document || (container && container.ownerDocument) || (W && W.document);
    var later = typeof env.later === 'function' ? env.later : function (f, ms) { return setTimeout(f, ms); };
    var clearLater = typeof env.clearLater === 'function' ? env.clearLater : function (id) { clearTimeout(id); };
    var cur = null, pend = null, dead = false, site = { title: null, colour: null };

    function cut() {
      if (pend) { try { clearLater(pend.timer); } catch (e) { /* gone */ } pend = null; }
      if (!cur) return;
      var c = cur; cur = null;
      c.timers.forEach(function (id) { try { clearLater(id); } catch (e) { /* gone */ } });
      c.offs.forEach(function (f) { try { f(); } catch (e) { /* gone */ } });
      if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
      if (c.rings && c.rings.parentNode) c.rings.parentNode.removeChild(c.rings);
    }
    function svgNow() { try { return typeof env.svg === 'function' ? env.svg() : null; } catch (e) { return null; } }
    function view() { var r = container && container.getBoundingClientRect ? container.getBoundingClientRect() : null; return { w: r && r.width || (W && W.innerWidth) || 1024, h: r && r.height || (W && W.innerHeight) || 768 }; }

    function build(rooms, plate, pos, still, pal, seq) {
      var card = el(doc, 'div', 'ro-card ro-measure' + (still ? ' ro-still' : '') + (plate ? '' : ' ro-noplate'));
      var nm = Pure.names(rooms);
      card.setAttribute('data-ro-seq', String(seq));
      card.setAttribute('data-ro-at', String(pos));
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', 'Opening ' + (rooms.length === 1 ? rooms[0].name : rooms.length + ' rooms: ' + rooms.map(function (r) { return r.name; }).join(', ')));
      card.style.setProperty('--ro-field', pal.field); card.style.setProperty('--ro-ink', pal.ink); card.style.setProperty('--ro-back', pal.back); card.style.setProperty('--ro-dot', pal.dot);
      Object.keys(Pure.T).forEach(function (k) { card.style.setProperty('--ro-t-' + k, (Pure.T[k] - pos) + 'ms'); });
      card.appendChild(el(doc, 'div', 'ro-ground'));
      var out = null;
      if (plate) {
        card.style.setProperty('--ro-ar', String(Math.round(plate.w / plate.h * 10000) / 10000));
        out = el(doc, 'div', 'ro-out'); out.setAttribute('aria-hidden', 'true');
        var enter = el(doc, 'div', 'ro-enter');
        plate.pieces.forEach(function (p) {
          var pc = el(doc, 'div', 'ro-piece'), sil = el(doc, 'div', 'ro-sil'), col = el(doc, 'div', 'ro-col');
          pc.setAttribute('data-ro-room', safeId(p.room.id));
          pc.style.left = (p.l * 100) + '%'; pc.style.top = (p.t * 100) + '%'; pc.style.width = (p.fw * 100) + '%'; pc.style.height = (p.fh * 100) + '%';
          sil.appendChild(p.make()); col.appendChild(p.make()); pc.appendChild(sil); pc.appendChild(col); enter.appendChild(pc); p.el = pc;
        });
        out.appendChild(enter); card.appendChild(out);
      }
      var type = el(doc, 'div', 'ro-type'), kk = Pure.kicker(rooms);
      if (kk.length) {
        var k = el(doc, 'p', 'ro-kick'); k.setAttribute('aria-label', kk.join(' · '));
        kk.forEach(function (t) { k.appendChild(el(doc, 'span', 'ro-kick-t', t)); });
        type.appendChild(k);
      }
      var h = el(doc, 'h1', 'ro-name'), fronts = [];
      nm.lines.forEach(function (n) {
        var line = el(doc, 'span', 'ro-line'), b = el(doc, 'span', 'ro-back', n); b.setAttribute('aria-hidden', 'true');
        line.appendChild(b); fronts.push(line.appendChild(el(doc, 'span', 'ro-front', n))); h.appendChild(line);
      });
      type.appendChild(h);
      if (nm.more) type.appendChild(el(doc, 'p', 'ro-more', 'and ' + nm.more + ' more'));
      card.appendChild(type);
      card.appendChild(el(doc, 'div', 'ro-lb ro-lb-t')); card.appendChild(el(doc, 'div', 'ro-lb ro-lb-b')); card.appendChild(el(doc, 'div', 'ro-flash'));
      return { el: card, out: out, type: type, name: h, fronts: fronts, multi: fronts.length > 1 };
    }

    /* the name(s) as large as fit (Pure.fit; the steps are Pure.sizes); -> the size taken, in vh */
    function fitName(c) {
      var v = view(), portrait = v.h > v.w, o = Pure.sizes(c.fronts.length, portrait);
      var res = Pure.fit(function (size, wrap) {
        c.name.style.fontSize = size + 'vh';
        c.name.setAttribute('data-ro-wrap', wrap ? '1' : '0');
        return { fits: c.fronts.every(function (f) {
          var lines = Math.max(1, Math.round(f.getBoundingClientRect().height / (size / 100 * v.h * 0.9)));
          return f.scrollWidth <= f.clientWidth + 1 && (wrap ? lines <= 2 : lines === 1);
        }) };
      }, o);
      c.name.style.fontSize = res.size + 'vh';
      c.name.setAttribute('data-ro-wrap', res.wrap ? '1' : '0');
      return res.size;
    }
    /* the plate at scale s of its natural box (right-anchored; centred when the screen is upright), and the type: full width when it sits wholly
       below the plate, else the room left of it. -> the names' size */
    function place(c, nat, s, v) {
      var w = Math.round(nat.width * s), h = Math.round(nat.height * s);
      c.out.style.width = w + 'px'; c.out.style.height = h + 'px';
      if (v.h > v.w) c.out.style.right = Math.round((v.w - w) / 2) + 'px';
      c.type.style.width = '';
      var size = fitName(c), tr = c.type.getBoundingClientRect(), pr = c.out.getBoundingClientRect();
      if (tr.top < pr.bottom + v.h * 0.02 && pr.left > tr.left) { c.type.style.width = Math.round(Math.max(v.w * 0.3, pr.left - tr.left - v.w * 0.03)) + 'px'; size = fitName(c); }
      return size;
    }
    /* the type never runs over the plate. A wide plate beside a list of names would leave them tiny, so the plate may be drawn smaller (it flies to
       the map anyway): each scale in Pure.SCALES is tried and the best balance of name size and plate size kept (Pure.pick) */
    function layout(c) {
      var v = view();
      if (!c.out) { c.type.style.width = ''; fitName(c); return; }
      c.out.style.width = ''; c.out.style.height = ''; c.out.style.right = '';
      var nat = c.out.getBoundingClientRect();
      if (!(nat.width > 0) || !(nat.height > 0)) { c.type.style.width = ''; fitName(c); return; }
      var trials = Pure.SCALES.map(function (s) { return { s: s, size: place(c, nat, s, v) }; });
      place(c, nat, Pure.pick(trials).s, v);
    }
    /* where each piece lands: its box on the map, on screen (the map svg's own CTM). .ro-out itself is never transformed, so its box is exact */
    function aim(c, svg, plate) {
      if (!c.out || !svg) return;
      var m = svg.getScreenCTM(), p = svg.createSVGPoint(), wr = c.out.getBoundingClientRect();
      if (!m || !(wr.height > 0)) return;
      plate.pieces.forEach(function (q) {
        var b = q.box; p.x = b.x; p.y = b.y; var a = p.matrixTransform(m); p.x = b.x + b.w; p.y = b.y + b.h; var z = p.matrixTransform(m);
        var left = wr.left + q.l * wr.width, top = wr.top + q.t * wr.height, hh = q.fh * wr.height;
        var k = (z.y - a.y) / hh, dx = a.x - left, dy = a.y - top;
        q.el.style.setProperty('--ro-settle', 'translate(' + Math.round(dx * 10) / 10 + 'px, ' + Math.round(dy * 10) / 10 + 'px) scale(' + Math.round(k * 10000) / 10000 + ')');      });
    }

    function start(display, seq) {
      var on = typeof env.on === 'function' ? !!env.on() : false;
      var svg = svgNow(), title = txt(display && display.title, 200), cv = coverOf(svg);
      if (cv) site = { title: title, colour: cv };
      if (!Pure.wants(display, on) || !container || !doc) return;
      var still = typeof env.still === 'function' ? !!env.still() : false;
      var pos = Pure.position(typeof env.at === 'function' ? env.at() : null, Date.now(), typeof env.skew === 'function' ? env.skew() : 0);
      if (!Pure.startable(pos, still)) return;
      var rooms = Pure.clean(display.arrive), plate = null;
      try { plate = svg ? cutPlate(doc, svg, rooms) : null; } catch (e) { plate = null; }
      var pal = Pure.palette(cv || (site.title === title ? site.colour : null) || Pure.SIGNAL);
      var c;
      try { c = build(rooms, plate, pos, still, pal, seq); } catch (e) { return; }
      cur = { seq: seq, at: pos, el: c.el, rings: null, timers: [], offs: [] };
      container.appendChild(c.el);
      layout(c);
      if (plate) aim(c, svg, plate);
      c.el.classList.remove('ro-measure');
      var me = cur, refit = function () { if (cur === me) { layout(c); if (plate) aim(c, svg, plate); } };
      if (W && typeof W.addEventListener === 'function') { W.addEventListener('resize', refit); me.offs.push(function () { W.removeEventListener('resize', refit); }); }
      if (doc.fonts && doc.fonts.status !== 'loaded' && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') doc.fonts.ready.then(refit, function () {});
      if (still) { me.timers.push(later(function () { if (cur === me) cut(); }, Math.max(0, Pure.STILL_MS - pos))); return; }
      if (plate && svg) {
        try { me.rings = addRings(doc, svg, rooms, pal); } catch (e) { me.rings = null; }
        if (me.rings) Object.keys(Pure.T).forEach(function (k) { me.rings.style.setProperty('--ro-t-' + k, (Pure.T[k] - pos) + 'ms'); });
        me.timers.push(later(function () { if (cur === me) aim(c, svg, plate); }, Math.max(0, Pure.T.out - 40 - pos)));      /* aimed again just before the settle (the map is at rest by then) */
      }
      me.timers.push(later(function () { if (cur === me) cut(); }, Math.max(0, Pure.T.end - pos)));
    }

    function next(display, seq) {
      if (dead) return;
      if ((cur && cur.seq === seq) || (pend && pend.seq === seq)) return;      /* the same push drawn again (a kit setting redraw): the card runs on */
      cut();
      if (!isObj(display) || display.kind !== 'svg') return;
      /* the map stage is painted after this call (display-page.js show) and laid out on the next tick (its zoom): look at it then */
      pend = { seq: seq, timer: later(function () { pend = null; if (!dead) start(display, seq); }, 60) };
    }

    return {
      next: next,
      cut: cut,
      state: function () { return cur ? { seq: cur.seq, at: cur.at } : null; },
      destroy: function () { cut(); dead = true; }
    };
  }

  return { attach: attach, Pure: Pure };
});
