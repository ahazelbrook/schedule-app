/* display/players/intro.js: the NPC introduction (IP3 of the players' screen build, behind the setting stage.players). B68PlayersIntro.

   WHAT THE PLAYERS SEE. The GM's Introduce (one NPC, the setting on) is an ordinary display push of kind `npc` that carries `intro: true` (and the
   `look`: the Tell expression and the Signature pose, names only). On every display page at once:
     0 s          THE CUT. Whatever was up is covered in one frame by a flat colour field (the NPC's faction colour, else the signal orange) with a
                  coarse halftone, and thin black letterbox bars top and bottom.
     0 to 0.7 s   THE ENTRANCE. The figure comes in from the right as a solid black silhouette, large (head to knee about 85% of the height).
     0.7 s        THE FREEZE. A one-frame white flash; the figure is in full colour (Tell face, Signature pose), its silhouette left behind it as
                  an offset print shadow. Nothing moves again.
     0.9 to 1.4 s THE NAME. A small-caps kicker (role · faction), the name in the heaviest face as large as fits on two lines (aim 14vh), with an
                  offset copy in the second colour, then the alias in quotes: each a hard wipe.
     5.5 to 6.2 s THE HAND-OVER. The ground, the bars and the type wipe away; the figure settles onto the stage's own figure; the card is gone.
   Under the card, from the first frame, is the ordinary NPC stage (display-page.js builds it as for Show on iPad), so what is left is exactly
   what Show on iPad paints, and it stays until the next push.
   Reduced motion, or Hold scenes still (fx.off): the frozen frame, still, for 3 s, then a cut to the stage.

   ONE CLOCK. The card's zero is the display's `updatedAt` (the server's time of the push, in every full display answer) plus LEAD_MS, read on the
   server's clock (the page's skew from the GET's `now`), so every screen is at the same second. A page that first sees the push too late into
   the card (a reload, a screen joining late) shows the stage only; one that reloads inside it resumes at the right second.

   SECRECY. The card is drawn only from display.npc, which the server joins for a REVEALED NPC alone (functions/_lib/npcs.js joinDisplayNpc);
   never from the title. Every string goes in with textContent. No request, no markup sink.

   API (window.B68PlayersIntro; module.exports under Node for the Pure part)
     attach(container, env) -> { next(display, seq), cut(), state() -> { seq, at } | null, destroy() }
       env: { document, figure(spec, uid) -> svg node | null (already through the page's cleaner), K? (the figure kit), on() -> bool (the setting),
              still() -> bool (reduced motion or fx.off), skew() -> ms, at() -> the display's updatedAt, later(fn, ms), clearLater(id) }
       next() is called by the page's show() for EVERY display it paints: another seq cuts a card that is up, at once; an intro starts one.
     Pure: LEAD_MS, T, STILL_MS, LATE_MS, position(at, now, skew), wants(display, on), startable(pos, still), palette(faction, FL), kicker(role,
           faction), specFor(spec, look, FL), fit(measure, o), initial(name) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68PlayersIntro = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function txt(v, n) { var s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; return n && s.length > n ? s.slice(0, n) : s; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  /* ---------- Pure ---------- */
  var Pure = {};
  /* the timeline, ms from the card's zero */
  Pure.T = { enter: 0, freeze: 700, kicker: 900, name: 1000, name2: 1060, alias: 1250, out: 5500, fade: 6000, end: 6200 };
  Pure.LEAD_MS = 800;        /* the card's zero is this long after the push, so the screens' polls (poked by live sync) land before the figure enters */
  Pure.STILL_MS = 3000;      /* reduced motion or held still: the frozen frame for this long, then a cut */
  Pure.LATE_MS = 5000;       /* a page that first sees the push later than this into the card shows the stage only */
  Pure.SIGNAL = ['#e0691e', '#14110e'];
  Pure.PAPER = '#fbf8f1';
  Pure.INK = '#14110e';
  /* where this page is in the card: ms since its zero on the server's clock (negative during the lead); null without a usable time */
  Pure.position = function (at, nowMs, skewMs) {
    var z = typeof at === 'string' ? Date.parse(at) : typeof at === 'number' ? at : NaN;
    if (!isFinite(z) || !isFinite(nowMs)) return null;
    return Math.round(nowMs + num(skewMs) - (z + Pure.LEAD_MS));
  };
  /* a card is played for this display: the setting on, an npc display marked intro, and the server's join of a revealed NPC with a name */
  Pure.wants = function (display, on) {
    return !!on && isObj(display) && display.kind === 'npc' && display.intro === true && isObj(display.npc) && !!txt(display.npc.name);
  };
  /* is there still a card to show at this position? (a reload inside the card resumes; past the window, the stage only) */
  Pure.startable = function (pos, still) {
    if (typeof pos !== 'number' || !isFinite(pos)) return false;
    return pos < (still ? Pure.STILL_MS : Pure.LATE_MS);
  };
  /* the colours: the faction's own slot (the six the face looks and the stage's stripe use), else the signal orange.
     ink: the colour that reads on the field (the name, the kicker strip); back: the offset copy behind the name, the other of paper and ink */
  Pure.palette = function (faction, FL) {
    var f = txt(faction, 200), slot = f && FL && typeof FL.slotOf === 'function' ? FL.slotOf(f) : 0;
    var c = slot >= 1 && slot <= 6 && FL && typeof FL.colours === 'function' ? FL.colours(slot) : Pure.SIGNAL;
    var ink = typeof c[1] === 'string' ? c[1] : Pure.INK, dark = ink.toLowerCase() === Pure.INK;
    return { field: c[0], ink: dark ? Pure.INK : Pure.PAPER, back: dark ? Pure.PAPER : Pure.INK, slot: slot };
  };
  Pure.kicker = function (role, faction) { return [txt(role, 120), txt(faction, 120)].filter(Boolean).join(' · '); };
  /* the card's drawing: the Tell expression and the Signature pose (names from the fixed lists only), else the spec as served */
  Pure.specFor = function (spec, look, FL) {
    if (!isObj(spec)) return null;
    var lk = FL && typeof FL.clean === 'function' ? FL.clean(look) : null, s = spec;
    if (lk && lk.expr && typeof FL.specWith === 'function') s = FL.specWith(s, { expr: lk.expr });
    if (lk && lk.pose && typeof FL.poseSpec === 'function') s = FL.poseSpec(s, lk.pose);
    return s;
  };
  Pure.initial = function (name) { var s = txt(name).replace(/^[\s"'“”‘’(\[.,_-]+/, ''); return s ? s.charAt(0).toUpperCase() : '?'; };
  /* the name's size: the largest step from o.max down to o.min (in vh) at which it fits on one line, else on two lines; measure(vh, wrap) ->
     { fits, lines }. One line wins at a size where both fit. Never smaller than o.min (the last step is taken as it is). */
  Pure.fit = function (measure, o) {
    o = o || {};
    var max = o.max || 14, min = o.min || 6, step = o.step || 0.94, size = max, guard = 0;
    while (size >= min - 1e-9 && guard++ < 60) {
      var one = measure(size, false);
      if (one && one.fits) return { size: size, lines: 1 };
      var two = measure(size, true);
      if (two && two.fits && two.lines <= 2) return { size: size, lines: two.lines || 2 };
      size = Math.round(size * step * 100) / 100;
    }
    return { size: min, lines: 2 };
  };

  /* ---------- the card ---------- */
  function el(doc, tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function faceLook() { return W && W.B68FaceLook ? W.B68FaceLook : null; }

  /* the drawn box of an svg's content on screen (the union of its children's boxes: what the figure covers, not its viewBox) */
  function contentRect(svg) {
    if (!svg || !svg.children) return null;
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (var i = 0; i < svg.children.length; i++) {
      var k = svg.children[i], tag = String(k.tagName || '').toLowerCase();
      if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'style' || typeof k.getBoundingClientRect !== 'function') continue;
      var q = k.getBoundingClientRect(); if (!q || !(q.width > 0 || q.height > 0)) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    return isFinite(l) && r > l && b > t ? { left: l, top: t, width: r - l, height: b - t } : null;
  }
  /* crop an svg's viewBox to its drawn content, so every figure fills the card's figure box the same way, hat and hair included */
  function cropTo(svg) {
    try {
      if (!svg || typeof svg.getBBox !== 'function') return null;
      var bb = svg.getBBox(); if (!bb || !(bb.width > 0) || !(bb.height > 0)) return null;
      var pad = bb.height * 0.012, vb = [bb.x - pad, bb.y - pad, bb.width + 2 * pad, bb.height + 2 * pad];
      svg.setAttribute('viewBox', vb.map(function (n) { return Math.round(n * 100) / 100; }).join(' '));
      svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
      svg.removeAttribute('width'); svg.removeAttribute('height');
      return vb;
    } catch (e) { return null; }
  }

  function attach(container, env) {
    env = env || {};
    var doc = env.document || (container && container.ownerDocument) || (W && W.document);
    var later = typeof env.later === 'function' ? env.later : function (f, ms) { return setTimeout(f, ms); };
    var clearLater = typeof env.clearLater === 'function' ? env.clearLater : function (id) { clearTimeout(id); };
    var cur = null, dead = false;

    function cut() {
      if (!cur) return;
      var c = cur; cur = null;
      c.timers.forEach(function (id) { try { clearLater(id); } catch (e) { /* gone */ } });
      c.offs.forEach(function (f) { try { f(); } catch (e) { /* gone */ } });
      if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
      if (container && container.classList) container.classList.remove('pi-on');
    }

    function figureNode(spec, uid) {
      if (!spec || typeof env.figure !== 'function') return null;
      try { return env.figure(spec, uid); } catch (e) { return null; }
    }

    function build(display, seq, pos, still) {
      var npc = display.npc, FL = faceLook(), pal = Pure.palette(npc.faction, FL), name = txt(npc.name, 200);
      var uid = 'pi-' + String(seq).replace(/[^A-Za-z0-9_-]/g, '');
      var card = el(doc, 'div', 'pi-card' + (still ? ' pi-still' : ''));
      card.setAttribute('data-pi-seq', String(seq));
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', 'Introducing ' + name);
      card.style.setProperty('--pi-field', pal.field);
      card.style.setProperty('--pi-ink', pal.ink);
      card.style.setProperty('--pi-back', pal.back);
      card.setAttribute('data-pi-ink', pal.ink === Pure.INK ? 'dark' : 'light');
      /* every beat's start relative to now (negative: already past), one custom property each, read by intro.css */
      var T = Pure.T;
      Object.keys(T).forEach(function (k) { card.style.setProperty('--pi-' + k, (T[k] - pos) + 'ms'); });

      card.appendChild(el(doc, 'div', 'pi-ground'));
      var out = el(doc, 'div', 'pi-figout'), enter = el(doc, 'div', 'pi-enter');
      out.setAttribute('aria-hidden', 'true');
      var spec = Pure.specFor(npc.spec, display.look, FL);
      var lk = FL && typeof FL.clean === 'function' ? FL.clean(display.look) : null;
      if (lk && lk.expr === 'afraid' && W && W.B68FaceRender && env.K) { try { W.B68FaceRender.ensureAfraid(env.K); } catch (e) { /* drawn without it */ } }
      var col = figureNode(spec, uid + '-c'), sil = col ? figureNode(spec, uid + '-s') : null;
      if (col && sil) {
        var s1 = el(doc, 'div', 'pi-sil'), c1 = el(doc, 'div', 'pi-col');
        s1.appendChild(sil); c1.appendChild(col);
        enter.appendChild(s1); enter.appendChild(c1);
        out.classList.add('pi-hasfig');
      } else {
        /* no figure: a deliberate monogram, a big disc with the initial knocked out of it */
        var ms = el(doc, 'div', 'pi-sil pi-mono'), mc = el(doc, 'div', 'pi-col pi-mono');
        mc.appendChild(el(doc, 'span', 'pi-mono-l', Pure.initial(name)));
        enter.appendChild(ms); enter.appendChild(mc);
        out.classList.add('pi-hasmono');
      }
      out.appendChild(enter); card.appendChild(out);

      var type = el(doc, 'div', 'pi-type'), kick = Pure.kicker(npc.role, npc.faction), alias = txt(npc.alias, 120);
      if (kick) { var k1 = el(doc, 'p', 'pi-kick'); k1.appendChild(el(doc, 'span', 'pi-kick-t', kick)); type.appendChild(k1); }
      var h = el(doc, 'h1', 'pi-name');
      h.appendChild(el(doc, 'span', 'pi-name-back', name)).setAttribute('aria-hidden', 'true');
      h.appendChild(el(doc, 'span', 'pi-name-front', name));
      type.appendChild(h);
      if (alias) type.appendChild(el(doc, 'p', 'pi-alias', '“' + alias + '”'));
      card.appendChild(type);
      card.appendChild(el(doc, 'div', 'pi-lb pi-lb-t'));
      card.appendChild(el(doc, 'div', 'pi-lb pi-lb-b'));
      card.appendChild(el(doc, 'div', 'pi-flash'));
      return { el: card, name: h, type: type, out: out, col: col, sil: sil };
    }

    /* the name as large as fits: one line at up to 14vh, else two */
    function fitName(c) {
      var h = c.name, box = c.type, H = (W && W.innerHeight) || 768;
      if (!h || !box || typeof h.getBoundingClientRect !== 'function') return;
      var maxW = box.clientWidth || ((W && W.innerWidth) || 1024) * 0.6;
      var res = Pure.fit(function (vh, wrap) {
        h.style.fontSize = vh + 'vh';
        h.setAttribute('data-pi-wrap', wrap ? '1' : '0');
        var r = h.getBoundingClientRect(), lh = vh / 100 * H * 0.9, lines = Math.max(1, Math.round(r.height / lh));
        return { fits: h.scrollWidth <= maxW + 1 && (wrap ? lines <= 2 : lines === 1), lines: lines };
      }, { max: 14, min: 6 });
      h.style.fontSize = res.size + 'vh';
      h.setAttribute('data-pi-wrap', res.lines > 1 ? '1' : '0');
      h.setAttribute('data-pi-lines', String(res.lines));
    }

    /* the hand-over: the card's figure settles onto the stage's own figure (under the card) while the ground wipes away */
    function settle(c) {
      try {
        var stages = container.querySelectorAll('.dp-stage.dp-npc'), st = stages.length ? stages[stages.length - 1] : null;
        var tgt = contentRect(st && st.querySelector('.dp-npc-fig svg')), mine = contentRect(c.col);
        if (!tgt || !mine || !(mine.height > 0)) return;
        var wr = c.out.getBoundingClientRect(), k = tgt.height / mine.height;
        var dx = tgt.left - wr.left - k * (mine.left - wr.left), dy = tgt.top - wr.top - k * (mine.top - wr.top);
        c.out.style.transformOrigin = '0 0';
        c.out.style.transform = 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px) scale(' + Math.round(k * 1000) / 1000 + ')';
        c.out.classList.add('pi-settling');
      } catch (e) { /* the card simply wipes */ }
    }

    function next(display, seq) {
      if (dead) return;
      if (cur && cur.seq === seq) return;            /* the same push drawn again (a kit setting redraw): the card runs on */
      cut();
      var on = typeof env.on === 'function' ? !!env.on() : false;
      if (!Pure.wants(display, on) || !container || !doc) return;
      var still = typeof env.still === 'function' ? !!env.still() : false;
      var pos = Pure.position(typeof env.at === 'function' ? env.at() : null, Date.now(), typeof env.skew === 'function' ? env.skew() : 0);
      if (!Pure.startable(pos, still)) return;
      var c;
      try { c = build(display, seq, pos, still); } catch (e) { return; }
      cur = { seq: seq, at: pos, el: c.el, timers: [], offs: [] };
      container.appendChild(c.el);
      container.classList.add('pi-on');
      if (c.col) {
        var vb = cropTo(c.col);
        if (vb && c.sil) { c.sil.setAttribute('viewBox', c.col.getAttribute('viewBox')); c.sil.setAttribute('preserveAspectRatio', 'xMidYMin meet'); c.sil.removeAttribute('width'); c.sil.removeAttribute('height'); }
        if (vb) c.out.style.width = 'calc(var(--pi-figh) * ' + (Math.round(vb[2] / vb[3] * 10000) / 10000) + ')';      /* the box is the figure's own shape */
      }
      fitName(c);
      var me = cur, refit = function () { if (cur === me) fitName(c); };
      if (W && typeof W.addEventListener === 'function') { W.addEventListener('resize', refit); me.offs.push(function () { W.removeEventListener('resize', refit); }); }
      if (doc.fonts && doc.fonts.status !== 'loaded' && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') doc.fonts.ready.then(refit, function () {});
      if (still) { me.timers.push(later(function () { if (cur === me) cut(); }, Math.max(0, Pure.STILL_MS - pos))); return; }
      me.timers.push(later(function () { if (cur === me) settle(c); }, Math.max(0, Pure.T.out - pos)));
      me.timers.push(later(function () { if (cur === me) cut(); }, Math.max(0, Pure.T.end - pos)));
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
