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
   The device asking for reduced motion: the frozen frame, still, for 3 s, then a cut to the stage. Hold scenes still (fx.off) holds the ambient
   scenes only: an introduction is a sent event and plays in full (the overseer's ruling, 13/11).

   ONE CLOCK. The card's zero is the display's `updatedAt` (the server's time of the push, in every full display answer) plus LEAD_MS, read on the
   server's clock (the page's skew from the GET's `now`), so every screen is at the same second. A page that first sees the push too late into
   the card (a reload, a screen joining late) shows the stage only; one that reloads inside it resumes at the right second.

   SECRECY. The card is drawn only from display.npc, which the server joins for a REVEALED NPC alone (functions/_lib/npcs.js joinDisplayNpc);
   never from the title. Every string goes in with textContent. No request, no markup sink.

   API (window.B68PlayersIntro; module.exports under Node for the Pure part)
     attach(container, env) -> { next(display, seq), cut(), state() -> { seq, at } | null, destroy() }
       env: { document, figure(spec, uid) -> svg node | null (already through the page's cleaner), K? (the figure kit), on() -> bool (the setting),
              still() -> bool (the device asks for reduced motion), skew() -> ms, at() -> the display's updatedAt, later(fn, ms), clearLater(id) }
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
  Pure.STILL_MS = 3000;      /* reduced motion: the frozen frame for this long, then a cut */
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
    if (!isObj(spec) || !Object.keys(spec).length) return null;      /* no figure spec (a cast row saved without one is {}): the monogram */
    var lk = FL && typeof FL.clean === 'function' ? FL.clean(look) : null, s = spec;
    if (lk && lk.expr && typeof FL.specWith === 'function') s = FL.specWith(s, { expr: lk.expr });
    if (lk && lk.pose && typeof FL.poseSpec === 'function') s = FL.poseSpec(s, lk.pose);
    return s;
  };
  /* the stage's pose starts 100 ms before the hand-over (or the still card's cut), so the figure the card settles onto is already in the Signature pose with the
     Tell face, and holds it for the rest of POSE_MS (3.2 s) after; ms from the card's mount at position pos; never under 0 */
  Pure.POSE_LEAD = 100;
  Pure.SETTLE_AFTER = 200;      /* the figure starts to settle when the type's 200 ms wipe-out (intro.css) has ended: no letter over the moving figure */
  Pure.poseAt = function (pos, still) { return Math.max(0, Math.round((still ? Pure.STILL_MS : Pure.T.out) - Pure.POSE_LEAD - (Number(pos) || 0))); };
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
  var posing = null;      /* { seq, at (epoch ms) }: the card up now, for poseAt() (one display page, one card) */
  function el(doc, tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function faceLook() { return W && W.B68FaceLook ? W.B68FaceLook : null; }

  function tagOf(n) { return String(n && n.tagName || '').toLowerCase(); }
  /* the figure's own body in a kit drawing: g.b68-figure holds the defs, the ground and cast shadows (a path and a use) and the body (its last
     g); the shadows reach far to the right of the feet, so they are left out of every box here. Anything else: the svg itself. */
  function bodyOf(svg) {
    if (!svg || !svg.children) return null;
    var fig = typeof svg.querySelector === 'function' ? svg.querySelector('.b68-figure') : null, kids = fig ? fig.children : [], body = null;
    for (var i = 0; i < kids.length; i++) if (tagOf(kids[i]) === 'g') body = kids[i];
    return body || svg;
  }
  function screenRect(n) {
    if (!n || typeof n.getBoundingClientRect !== 'function') return null;
    var q = n.getBoundingClientRect();
    return q && q.width > 0 && q.height > 0 ? { left: q.left, top: q.top, width: q.width, height: q.height } : null;
  }
  /* crop an svg's viewBox to the body, so every figure fills the card's figure box the same way, hat and hair included */
  function cropTo(svg) {
    try {
      var body = bodyOf(svg), q = screenRect(body), m = svg && typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
      if (!q || !m || typeof svg.createSVGPoint !== 'function') return null;
      var inv = m.inverse(), p = svg.createSVGPoint();
      p.x = q.left; p.y = q.top; var a = p.matrixTransform(inv);
      p.x = q.left + q.width; p.y = q.top + q.height; var b = p.matrixTransform(inv);
      var bb = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
      if (!(bb.width > 0) || !(bb.height > 0)) return null;
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
      if (posing && posing.seq === c.seq) posing = null;
    }

    function figureNode(spec, uid) {
      if (!spec || typeof env.figure !== 'function') return null;
      try { return env.figure(spec, uid); } catch (e) { return null; }
    }

    function build(display, seq, pos, still) {
      var npc = display.npc, FL = faceLook(), pal = Pure.palette(npc.faction, FL), name = txt(npc.name, 200);
      var uid = 'pi-' + String(seq).replace(/[^A-Za-z0-9_-]/g, '');
      var card = el(doc, 'div', 'pi-card pi-measure' + (still ? ' pi-still' : ''));      /* pi-measure: the figure unmoved while it is measured (next() lifts it) */
      card.setAttribute('data-pi-seq', String(seq));
      card.setAttribute('data-pi-at', String(pos));            /* where the card was when it mounted (the checks read it to know the second) */
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
      out.appendChild(enter);
      var clip = el(doc, 'div', 'pi-figclip');      /* in portrait it stops just above the type block, so the type is never over the figure */
      clip.appendChild(out); card.appendChild(clip);

      var type = el(doc, 'div', 'pi-type'), role = txt(npc.role, 120), fac = txt(npc.faction, 120), alias = txt(npc.alias, 120);
      /* the kicker: the role on one tape, the faction on the next (a line never breaks inside either) */
      if (role || fac) {
        var k1 = el(doc, 'p', 'pi-kick');
        k1.setAttribute('aria-label', Pure.kicker(role, fac));
        if (role) k1.appendChild(el(doc, 'span', 'pi-kick-t', role));
        if (fac) k1.appendChild(el(doc, 'span', 'pi-kick-t pi-kick-f', fac));
        type.appendChild(k1);
      }
      var h = el(doc, 'h1', 'pi-name');
      h.appendChild(el(doc, 'span', 'pi-name-back', name)).setAttribute('aria-hidden', 'true');
      var front = h.appendChild(el(doc, 'span', 'pi-name-front', name));
      type.appendChild(h);
      if (alias) type.appendChild(el(doc, 'p', 'pi-alias', '“' + alias + '”'));
      card.appendChild(type);
      card.appendChild(el(doc, 'div', 'pi-lb pi-lb-t'));
      card.appendChild(el(doc, 'div', 'pi-lb pi-lb-b'));
      card.appendChild(el(doc, 'div', 'pi-flash'));
      return { el: card, name: h, front: front, type: type, out: out, clip: clip, col: col, sil: sil };
    }

    /* the type never runs over the figure. Landscape: the type block is as wide as the free room left of the figure's box (at least 30% of the
       width), and the name shrinks to fit it. Portrait: the type runs across the foot and the figure is cut off just above it. */
    function layout(c) {
      var Wd = (W && W.innerWidth) || 1024, Hd = (W && W.innerHeight) || 768, portrait = Hd > Wd;
      c.type.style.width = ''; c.clip.style.bottom = '';
      if (!portrait) {
        var fr = c.out.getBoundingClientRect(), tr = c.type.getBoundingClientRect();
        if (fr.width > 0 && fr.left > tr.left) c.type.style.width = Math.round(Math.max(Wd * 0.3, fr.left - tr.left - Wd * 0.025)) + 'px';
      }
      fitName(c);
      if (portrait && !c.free) c.clip.style.bottom = Math.max(0, Math.round(Hd - c.type.getBoundingClientRect().top + Hd * 0.015)) + 'px';
    }

    /* the name as large as fits: one line at up to 14vh, else two */
    function fitName(c) {
      var h = c.name, f = c.front, H = (W && W.innerHeight) || 768;
      if (!h || !f || typeof f.getBoundingClientRect !== 'function') return;
      /* the front copy is a block as wide as the type box: it overflows (scrollWidth) exactly when the name does not fit */
      var res = Pure.fit(function (vh, wrap) {
        h.style.fontSize = vh + 'vh';
        h.setAttribute('data-pi-wrap', wrap ? '1' : '0');
        var r = f.getBoundingClientRect(), lh = vh / 100 * H * 0.9, lines = Math.max(1, Math.round(r.height / lh));
        return { fits: f.scrollWidth <= f.clientWidth + 1 && (wrap ? lines <= 2 : lines === 1), lines: lines };
      }, { max: 14, min: 6 });
      h.style.fontSize = res.size + 'vh';
      h.setAttribute('data-pi-wrap', res.lines > 1 ? '1' : '0');
      h.setAttribute('data-pi-lines', String(res.lines));
    }

    /* the hand-over: the card's figure settles onto the stage's own figure (under the card) while the ground wipes away; when it has landed
       (its transitionend, or the fallback at --pi-fade on a page too busy to say so), the stage's figure is shown under it and the card's
       figure fades out over it, then the card goes. No figure to settle onto (a monogram, no figure on the stage): the fade at --pi-fade. */
    function settle(c, me) {
      var landed = false;
      function land() {
        if (landed || cur !== me) return; landed = true;
        if (container.classList) container.classList.remove('pi-on');
        c.out.classList.add('pi-fading');
        me.timers.push(later(function () { if (cur === me) cut(); }, 200));
      }
      me.timers.push(later(land, Math.max(0, Pure.T.fade - Pure.T.out + 120)));
      me.timers.push(later(function () { c.free = true; c.clip.style.bottom = ''; }, 260));      /* portrait: the whole figure again once the type has wiped away */
      try {
        var stages = container.querySelectorAll('.dp-stage.dp-npc'), st = stages.length ? stages[stages.length - 1] : null;
        var tgt = screenRect(bodyOf(st && st.querySelector('.dp-npc-fig svg'))), mine = screenRect(bodyOf(c.col));
        if (!tgt || !mine || !(mine.height > 0)) { me.timers.push(later(land, Math.max(0, Pure.T.fade - Pure.T.out))); return; }
        var wr = c.out.getBoundingClientRect(), k = tgt.height / mine.height;
        var dx = tgt.left - wr.left - k * (mine.left - wr.left), dy = tgt.top - wr.top - k * (mine.top - wr.top);
        var onEnd = function (ev) { if (ev && ev.target === c.out && ev.propertyName === 'transform') land(); };
        c.out.addEventListener('transitionend', onEnd);
        me.offs.push(function () { c.out.removeEventListener('transitionend', onEnd); });
        c.out.style.transformOrigin = '0 0';
        c.out.style.transform = 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px) scale(' + Math.round(k * 1000) / 1000 + ')';
        c.out.classList.add('pi-settling');
      } catch (e) { /* the card simply wipes; the fallback lands it */ }
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
      posing = { seq: seq, at: Date.now() + Pure.poseAt(pos, still) };      /* the stage built under this card takes the Signature pose just before it is shown */
      container.appendChild(c.el);
      container.classList.add('pi-on');
      if (c.col) {
        var vb = cropTo(c.col);
        if (vb && c.sil) { c.sil.setAttribute('viewBox', c.col.getAttribute('viewBox')); c.sil.setAttribute('preserveAspectRatio', 'xMidYMin meet'); c.sil.removeAttribute('width'); c.sil.removeAttribute('height'); }
        if (vb) c.out.style.width = 'calc(var(--pi-figh) * ' + (Math.round(vb[2] / vb[3] * 10000) / 10000) + ')';      /* the box is the figure's own shape */
      }
      layout(c);
      c.el.classList.remove('pi-measure');
      var me = cur, refit = function () { if (cur === me) layout(c); };
      if (W && typeof W.addEventListener === 'function') { W.addEventListener('resize', refit); me.offs.push(function () { W.removeEventListener('resize', refit); }); }
      if (doc.fonts && doc.fonts.status !== 'loaded' && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') doc.fonts.ready.then(refit, function () {});
      if (still) { me.timers.push(later(function () { if (cur === me) cut(); }, Math.max(0, Pure.STILL_MS - pos))); return; }
      me.timers.push(later(function () { if (cur === me) settle(c, me); }, Math.max(0, Pure.T.out + Pure.SETTLE_AFTER - pos)));      /* IP3c: once the type has wiped away */
      me.timers.push(later(function () { if (cur === me) cut(); }, Math.max(0, Pure.T.end + 500 - pos)));      /* a safety: settle() ends the card itself */
    }

    return {
      next: next,
      cut: cut,
      state: function () { return cur ? { seq: cur.seq, at: cur.at } : null; },
      destroy: function () { cut(); dead = true; }
    };
  }

  /* IP3b item 5: when the npc stage built for this seq (display-page.js npcStage, B68FaceRender.applyStage opts.poseAt) should start its Signature pose, in ms
     from now; 0 when no card is up for that seq (the stage then plays it at once, as for Show on iPad) */
  function poseAt(seq) { return posing && posing.seq === seq ? Math.max(0, posing.at - Date.now()) : 0; }

  return { attach: attach, poseAt: poseAt, Pure: Pure };
});
