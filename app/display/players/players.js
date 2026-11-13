/* display/players/players.js: the players' screen, map first (IP2, behind the display setting stage.players). In the display bundle (app/routes.js):
   it only defines B68PlayersScreen when it loads; the display page calls it only while the setting is on, so off nothing here runs.
   ES5, window.B68PlayersScreen in the browser, module.exports under Node.

   WHAT IT DRAWS: the table clocks the GM made visible, as small dials in the top-right corner of the shared screen, over the map and over an ambient
   scene. The display GET serves them as a top-level `clocks` ([{ id, name, size, filled }], hidden clocks already left out by the server) only while
   the setting is stored on. At most four dials, the most recently changed first (nearest the corner); a fifth is dropped, the site's alarm clock
   always kept. A filled clock stays, drawn full in the alarm colour.
   THE TICK: when a dial's fill rises (or a new clock arrives) it swells to about three times its size toward the middle of the screen for 1.6 s, its
   new segments in the alarm colour, then settles back into the corner. Reduced motion or "Hold scenes still" (fx.off): no swell, the new segments
   flash once. Nothing moves when nothing changed: a poll that brings the same clocks touches nothing.
   NOT OVER: lights out (Blank), the hard start, a brief beat (a title, a stamp, an introduction: anything the GM sent as a moment), the opening
   credits scene, IP3's introduction card, or any stage but the map, an NPC and the ambient (a handout, a rule, a text: what the GM sent has the screen).
   Every string goes in as text: no markup sink, no request.

   API: attach(container, host) -> { clocks(list | null), sync(), destroy(), el }
          host = { doc, before (the node the dials go in front of), watch: [nodes whose children change what is up], kind() -> the display kind up,
                   dark() -> bool, mode() -> the hard start's scene mode, beat() -> bool (a brief beat is up), ambient() -> the scene playing or null,
                   alarm() -> the band's alarm { name, size, filled } or null, still() -> bool (no swell) }
        Pure = { clean(list), alarmId(clocks, alarm), paper(fill), stale(heard, now), pick(clocks, order, alarmId), rises(prev, next), wedges(size), visible(state), MAX } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else if (root) root.B68PlayersScreen = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var MAX = 4, SWELL_MS = 1600, FLASH_MS = 700, NAME_MAX = 60;
  var SVGNS = 'http://www.w3.org/2000/svg';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function txt(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max || 200) : ''; }
  function int(v, d) { var n = Number(v); return isFinite(n) ? Math.floor(n) : d; }

  var Pure = { MAX: MAX };
  /* the served list, checked again: [{ id, name, size 1..12, filled 0..size }] in the served order; anything malformed is left out */
  Pure.clean = function (list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).slice(0, 24).forEach(function (c) {
      if (!isObj(c)) return;
      var id = txt(c.id, 40), name = txt(c.name, NAME_MAX), size = int(c.size, 0);
      if (!id || seen[id] || !name || size < 1 || size > 12) return;
      seen[id] = 1;
      out.push({ id: id, name: name, size: size, filled: Math.max(0, Math.min(size, int(c.filled, 0))) });
    });
    return out;
  };
  /* which clocks rose (or are new) between two cleaned lists: { id: [the new segment indexes] }. A first look (prev null) is no rise */
  Pure.rises = function (prev, next) {
    var out = {};
    if (!Array.isArray(prev)) return out;
    var was = {};
    prev.forEach(function (c) { was[c.id] = c; });
    next.forEach(function (c) {
      var p = was[c.id], from = p && p.size === c.size ? p.filled : p ? -1 : 0;
      if (from < 0) return;                                   /* a resized clock is redrawn, not swelled */
      if (!p || c.filled > from) { var segs = []; for (var i = from; i < c.filled; i++) segs.push(i); out[c.id] = { segs: segs, fresh: !p }; }
    });
    return out;
  };
  /* the dials to draw: at most MAX, the most recently changed first (order: id -> a number, larger is more recent; a clock never seen changing ranks
     by its place in the list, the later the more recent), the alarm clock always among them */
  /* which clock is the site's alarm: the band's alarm ({ name, size, filled }) never names the table clock (ball.js: the play's label, else "Alarm"),
     so a clock of that name, else the ONE visible clock of the alarm's size and fill; '' when it cannot be told */
  Pure.alarmId = function (clocks, alarm) {
    if (!isObj(alarm)) return '';
    if (typeof alarm.id === 'string' && alarm.id) { for (var j = 0; j < clocks.length; j++) if (clocks[j].id === alarm.id) return clocks[j].id; return ''; }      /* R4: the band names its clock: only that one */
    var nm = txt(alarm.name, NAME_MAX).toLowerCase(), i;
    for (i = 0; i < clocks.length; i++) if (nm && clocks[i].name.toLowerCase() === nm) return clocks[i].id;
    var size = int(alarm.size, 0), filled = int(alarm.filled, -1), hits = clocks.filter(function (c) { return c.size === size && c.filled === filled; });
    return hits.length === 1 ? hits[0].id : '';
  };
  Pure.pick = function (clocks, order, alarmId) {
    order = order || {};
    var n = clocks.length, ranked = clocks.map(function (c, i) { return { c: c, r: typeof order[c.id] === 'number' ? order[c.id] : -(n - i) }; });
    ranked.sort(function (a, b) { return b.r - a.r; });
    var out = ranked.map(function (x) { return x.c; });
    if (alarmId && out.length > MAX) {
      var k = -1;
      for (var i = 0; i < out.length; i++) if (out[i].id === alarmId) { k = i; break; }
      if (k >= MAX) { var a = out.splice(k, 1)[0]; out.splice(MAX - 1, 0, a); }
    }
    return out.slice(0, MAX);
  };
  /* the wedges of a clock in a 32 x 32 box, radius 14 (the kit's meter's own geometry, so both look alike) */
  function fix(n) { return String(Math.round(n * 100) / 100); }
  Pure.wedges = function (size) {
    var out = [];
    if (size === 1) return ['circle'];
    for (var j = 0; j < size; j++) {
      var a0 = (j / size) * 2 * Math.PI - Math.PI / 2, a1 = ((j + 1) / size) * 2 * Math.PI - Math.PI / 2;
      out.push('M16 16L' + fix(16 + 14 * Math.cos(a0)) + ' ' + fix(16 + 14 * Math.sin(a0)) + 'A14 14 0 0 1 ' + fix(16 + 14 * Math.cos(a1)) + ' ' + fix(16 + 14 * Math.sin(a1)) + 'Z');
    }
    return out;
  };
  /* whether the dials may be seen now: { kind, dark, mode, beat, ambient } -> bool */
  Pure.visible = function (st) {
    st = st || {};
    if (st.dark || st.mode === 'start' || st.beat || st.intro) return false;
    var k = st.kind || 'blank';
    if (k === 'blank') return st.ambient !== 'credits';
    return k === 'svg' || k === 'npc';      /* the overseer's ruling (14/11): an NPC scene can last ten minutes, a clock ticked in it must be seen */
  };

  /* the map sheet's own paper: the colour of the drawing's first rect, if it is a plain colour; else the display's paper token */
  Pure.paper = function (fill) {
    var f = typeof fill === 'string' ? fill.trim() : '';
    return /^#[0-9a-fA-F]{3,8}$/.test(f) || /^rgba?\(\s*[\d.\s,%]+\)$/.test(f) ? f : 'var(--b68-paper, #f2ede1)';
  };
  /* IP2b: the view box that shows the drawing b (user units) as large as a W x H px frame allows, a margin m (a fraction of the drawing) round it,
     clear of the dials' corner (cw x ch px at the top right; 0 when there are none). Three ways, the largest wins: the whole frame (when the drawing,
     centred, misses the corner), the frame below the corner's band, the frame left of the corner's column. The box has the frame's own shape, so the
     page's own fit keeps it as it is. -> { x, y, w, h } */
  Pure.fitView = function (b, W, H, cw, ch, m) {
    if (!b || !(b.w > 0) || !(b.h > 0) || !(W > 0) || !(H > 0)) return null;
    m = m >= 0 ? m : 0.03; cw = Math.max(0, Math.min(W * 0.6, cw || 0)); ch = Math.max(0, Math.min(H * 0.5, ch || 0));
    var bw = b.w * (1 + 2 * m), bh = b.h * (1 + 2 * m);
    function place(k, x0, y0, aw, ah) { var dw = bw * k, dh = bh * k, l = x0 + (aw - dw) / 2, t = y0 + (ah - dh) / 2; return { k: k, l: l, t: t, r: l + dw, btm: t + dh }; }
    var full = place(Math.min(W / bw, H / bh), 0, 0, W, H);
    var hits = cw > 0 && ch > 0 && full.r > W - cw && full.t < ch;
    var best = full;
    if (hits) {
      var below = place(Math.min(W / bw, (H - ch) / bh), 0, ch, W, H - ch), left = place(Math.min((W - cw) / bw, H / bh), 0, 0, W - cw, H);
      best = below.k >= left.k ? below : left;
    }
    var k = best.k, mx = b.w * m * k, my = b.h * m * k;      /* the drawing's own box sits inside the margin */
    return { x: b.x - (best.l + mx) / k, y: b.y - (best.t + my) / k, w: W / k, h: H / k };
  };
  /* the connection is worth a dot only after STALE_MS without an answer */
  Pure.STALE_MS = 20000;
  Pure.stale = function (heard, now) { return typeof heard === 'number' && typeof now === 'number' && now - heard > Pure.STALE_MS; };

  function attach(container, host) {
    host = host || {};
    var doc = host.doc || (container && container.ownerDocument) || (W && W.document);
    if (!doc || !container) return null;
    var el = doc.createElement('div');
    el.className = 'p2-dials'; el.setAttribute('aria-label', 'Clocks'); el.setAttribute('role', 'list'); el.hidden = true;
    if (host.before && host.before.parentNode === container) container.insertBefore(el, host.before); else container.appendChild(el);
    if (container.classList) container.classList.add('p2-screen');      /* the AUTO chip stands down: the autopilot sends nothing while this is on */
    var dead = false, last = null, order = {}, tick = 0, sig = '', timers = [], mo = null, alarmKeep = '', heard = Date.now();
    /* R2: the connection, as one small amber dot bottom left, only after 20 s without an answer (the status line's words and time stand down) */
    var conn = doc.createElement('span'); conn.className = 'p2-conn'; conn.hidden = true; conn.setAttribute('role', 'img'); conn.setAttribute('aria-label', 'No connection');
    container.appendChild(conn);
    var connTick = setInterval(function () { if (!dead) { var st = Pure.stale(heard, Date.now()); if (conn.hidden === st) conn.hidden = !st; } }, 2000);
    /* R1: a map stands on its own sheet's paper, edge to edge (the stage's ground is the drawing's paper, not black); undone on destroy */
    function sheets() {
      var maps = container.querySelectorAll ? container.querySelectorAll('.dp-stage.dp-map') : [];
      for (var i = 0; i < maps.length; i++) {
        var m = maps[i]; if (m.hasAttribute('data-p2-sheet')) continue;
        var r = m.querySelector('.dp-map-frame svg > rect');
        m.style.background = Pure.paper(r ? r.getAttribute('fill') : '');
        m.setAttribute('data-p2-sheet', '');
      }
    }
    function call(fn, d) { try { return typeof fn === 'function' ? fn() : d; } catch (e) { return d; } }
    function later(fn, ms) { var id = setTimeout(function () { var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); if (!dead) fn(); }, ms); timers.push(id); }

    /* one painter with the kit on and off: the kit meter's own geometry (32 box, radius 14), drawn here so the kit's unlayered meter colours never
       take the alarm colour off a new segment (layer rule 3) */
    function face(c, fresh) {
      var svg, box = doc.createElement('span'); box.className = 'p2-face'; box.setAttribute('role', 'img'); box.setAttribute('aria-label', c.name + ': ' + c.filled + ' of ' + c.size);
      svg = doc.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'p2-clock');
      Pure.wedges(c.size).forEach(function (d, j) {
        var p = d === 'circle' ? doc.createElementNS(SVGNS, 'circle') : doc.createElementNS(SVGNS, 'path');
        if (d === 'circle') { p.setAttribute('cx', '16'); p.setAttribute('cy', '16'); p.setAttribute('r', '14'); } else p.setAttribute('d', d);
        p.setAttribute('class', 'p2-seg' + (j < c.filled ? ' p2-on' : '') + (fresh.indexOf(j) >= 0 ? ' p2-new' : ''));
        svg.appendChild(p);
      });
      var rim = doc.createElementNS(SVGNS, 'circle'); rim.setAttribute('cx', '16'); rim.setAttribute('cy', '16'); rim.setAttribute('r', '14'); rim.setAttribute('class', 'p2-rim');
      svg.appendChild(rim); box.appendChild(svg);
      return box;
    }
    function dial(c, rise) {
      var d = doc.createElement('div');
      d.className = 'p2-dial' + (c.filled >= c.size ? ' p2-full' : '');
      d.setAttribute('role', 'listitem'); d.setAttribute('data-p2-id', c.id); d.setAttribute('data-p2-filled', String(c.filled)); d.setAttribute('data-p2-size', String(c.size));
      d.appendChild(face(c, rise ? rise.segs : []));
      var n = doc.createElement('p'); n.className = 'p2-name'; n.textContent = c.name; d.appendChild(n);
      return d;
    }
    /* the swell: the dial travels toward the middle of the screen and grows, then comes back (CSS reads --p2-dx / --p2-dy) */
    function swell(d, done) {
      var fin = function () { if (typeof done === 'function') done(); };
      var still = call(host.still, false);
      if (still) { d.setAttribute('data-p2-tick', 'flash'); later(function () { d.removeAttribute('data-p2-tick'); clearNew(d); fin(); }, FLASH_MS); return; }
      try {
        var r = d.getBoundingClientRect(), win = doc.defaultView, cx = (win ? win.innerWidth : 0) / 2, cy = (win ? win.innerHeight : 0) / 2;
        var dx = Math.round(cx - (r.left + r.width / 2)), dy = Math.round(cy - (r.top + r.height / 2));
        d.style.setProperty('--p2-dx', Math.round(dx * 0.55) + 'px'); d.style.setProperty('--p2-dy', Math.round(dy * 0.55) + 'px');
      } catch (e) { /* it swells where it stands */ }
      d.setAttribute('data-p2-tick', 'swell');
      later(function () { d.removeAttribute('data-p2-tick'); d.style.removeProperty('--p2-dx'); d.style.removeProperty('--p2-dy'); clearNew(d); fin(); }, SWELL_MS);
    }
    /* IP2b: one swell at a time: a dial waits its turn and goes when the one before has settled (the newest of a poll last, in the order they rose).
       A repaint in between is no matter: the turn finds the dial by its id and marks its new segments again */
    var pending = [], swelling = false;
    function runSwell() {
      if (swelling || dead) return;
      var w = pending.shift(); if (!w) return;
      var d = el.querySelector('.p2-dial[data-p2-id="' + w.id.replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      if (!d || el.hidden) { runSwell(); return; }
      var segs = d.querySelectorAll('.p2-seg');
      w.segs.forEach(function (i) { if (segs[i]) segs[i].setAttribute('class', segs[i].getAttribute('class') + ' p2-new'); });
      swelling = true;
      swell(d, function () { swelling = false; runSwell(); });
    }
    function clearNew(d) {
      var n = d.querySelectorAll('.p2-new');
      for (var i = 0; i < n.length; i++) n[i].setAttribute('class', n[i].getAttribute('class').replace(/\s*p2-new\b/, ''));
    }
    function paint(rises) {
      var band = call(host.alarm, null), cl = last || [];
      /* the alarm told once stays told while the band still has an alarm and the clock is up (a tick reaches the clocks a poll before the band) */
      var al = Pure.alarmId(cl, band) || (isObj(band) && alarmKeep && cl.some(function (c) { return c.id === alarmKeep; }) ? alarmKeep : '');
      alarmKeep = al;
      var list = Pure.pick(cl, order, al);
      var s = JSON.stringify(list) + '|' + al;
      if (s === sig && !Object.keys(rises).length) return;
      sig = s;
      el.textContent = '';
      var swells = [];
      list.forEach(function (c) {
        var rise = rises[c.id] || null, d = dial(c, rise);
        if (al && c.id === al) d.setAttribute('data-p2-alarm', '');
        el.appendChild(d);
        if (rise) swells.push({ id: c.id, segs: rise.segs });
      });
      if (!el.hidden) swells.forEach(function (w) { pending.push(w); });
      [].forEach.call(el.querySelectorAll('.p2-dial'), clearNew);      /* the new segments go red only for their own swell */
      runSwell();
    }
    /* what is up decides whether the dials are seen; hidden is a cut */
    function sync() {
      if (dead) return;
      sheets();
      var kind = call(host.kind, 'blank');
      if (el.classList && el.classList.contains('p2-col') !== (kind === 'npc')) el.classList.toggle('p2-col', kind === 'npc');      /* over an NPC: one column down the right edge, clear of the head and the nameplate */
      var onBoard = kind === 'blank' && call(host.ambient, null) === 'board'; if (el.classList && el.classList.contains('p2-board') !== onBoard) el.classList.toggle('p2-board', onBoard);      /* IP6: over the planning board the corners hold the pinned cards: the dials go to the foot of the sheet */
      var vis = !!(last && last.length) && Pure.visible({ kind: kind, dark: call(host.dark, false), mode: call(host.mode, null), beat: call(host.beat, false), ambient: call(host.ambient, null), intro: !!(container.classList && container.classList.contains('pi-on')) });      /* IP3's title card (pi-on on the root) */
      if (el.hidden === vis) el.hidden = !vis;
    }
    if (W && typeof W.MutationObserver === 'function') {
      mo = new W.MutationObserver(function () { sync(); });
      try { mo.observe(container, { attributes: true, attributeFilter: ['class', 'data-scene-mode'] }); } catch (e) { /* the polls still sync */ }
      (host.watch || []).forEach(function (n) { try { if (n) mo.observe(n, { childList: true }); } catch (e) { /* ditto */ } });
    }
    /* an element's box in the root svg's own units (its group may carry a transform): its screen box, through the root's screen matrix */
    function userBox(svg, g) {
      if (!g || typeof svg.getScreenCTM !== 'function') return null;
      var m = svg.getScreenCTM(), r = g.getBoundingClientRect(); if (!m || !r || !r.width) return null;
      var inv = m.inverse(), p = svg.createSVGPoint(), q1, q2;
      p.x = r.left; p.y = r.top; q1 = p.matrixTransform(inv); p.x = r.right; p.y = r.bottom; q2 = p.matrixTransform(inv);
      return { x: Math.min(q1.x, q2.x), y: Math.min(q1.y, q2.y), width: Math.abs(q2.x - q1.x), height: Math.abs(q2.y - q1.y) };
    }
    return {
      el: el,
      /* IP2b: a stage-layout map (a .map-drawing, no .map-key: drawn for some frame, perhaps not this one) is fitted by its DRAWING, not its page,
         so it fills the sheet whatever size the GM page drew it for; the dials' band at the top is kept clear. Anything else: the page as it was */
      fit: function (svg, vb, frame) {
        try {
          if (!svg || !svg.querySelector('.map-drawing') || svg.querySelector('.map-key')) return vb;
          var b = userBox(svg, svg.querySelector('.map-drawing')), r = frame && frame.getBoundingClientRect ? frame.getBoundingClientRect() : null;
          if (!b || !b.width || !b.height || !r || !r.width || !r.height) return vb;
          var win = doc.defaultView, vh = win ? win.innerHeight / 100 : 8, cw = 0, ch = 0;
          if (last && last.length) { var e = el.hidden ? null : el.getBoundingClientRect(); cw = e && e.width ? r.right - e.left + vh : Math.min(4, last.length) * 18 * vh; ch = e && e.height ? e.bottom - r.top + vh : 20 * vh; }
          return Pure.fitView({ x: b.x, y: b.y, w: b.width, h: b.height }, r.width, r.height, cw, ch, 0.02) || vb;
        } catch (e) { return vb; }
      },
      clocks: function (list) {
        if (dead) return;
        heard = Date.now(); if (!conn.hidden) conn.hidden = true;
        var next = Pure.clean(list), rises = Pure.rises(last, next);
        Object.keys(rises).forEach(function (id) { order[id] = ++tick; });
        last = next;
        sync();
        paint(rises);
      },
      sync: function () { sync(); if (last && !dead) paint({}); },      /* the band moved: the alarm's name may have come with it (a redraw only when what is drawn moved) */
      destroy: function () {
        if (dead) return; dead = true;
        if (mo) mo.disconnect();
        timers.splice(0).forEach(function (id) { clearTimeout(id); });
        if (el.parentNode) el.parentNode.removeChild(el);
        clearInterval(connTick); if (conn.parentNode) conn.parentNode.removeChild(conn);
        var maps = container.querySelectorAll ? container.querySelectorAll('[data-p2-sheet]') : [];
        for (var i = 0; i < maps.length; i++) { maps[i].style.background = ''; maps[i].removeAttribute('data-p2-sheet'); }
        if (container.classList) container.classList.remove('p2-screen');
      }
    };
  }

  return { VERSION: 1, Pure: Pure, attach: attach };
});
