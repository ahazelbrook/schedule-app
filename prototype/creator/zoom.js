/* zoom.js — stage zoom and pan for the figure / mugshot SVG in #art. Owned by the zoom module.
   Sets window.B68Zoom = { zoomIn, zoomOut, reset, toFace, state: {scale, cx, cy} }.
   How it works: the kit's viewBox is the "fit" state (scale 1). Once zoomed, the SVG is stretched over the whole
   frame (position:absolute, 100% x 100%) and its viewBox is rewritten with the FRAME's aspect ratio, so wheel and
   drag work anywhere over the frame and not just over the narrow figure column. cx, cy are the user-space point at
   the centre of the frame; scale is relative to the fit pixel scale. A MutationObserver on #art re-applies the view
   after every B68.draw() (which replaces the SVG), with no layout reads on that path once the geometry is cached. */
(function () {
  'use strict';
  var MAX = 6, STEP = 1.5, DBL = 2.5, EPS = 0.0001;
  var state = { scale: 1, cx: 0, cy: 0 };
  var cur = { svg: null, vb0: null, style0: null, V: null, styled: false, locked: false, mug: null, h: null, geo: null };
  var frame = null, art = null, seg = null, readout = null, btn = {};
  var raf = 0, rectCache = null;

  function byId(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmt(n) { return String(Math.round(n * 100) / 100); }
  function B() { return window.B68 || null; }

  /* ---------- the current SVG ---------- */
  function adopt() {
    if (!art) return null;
    var svg = art.querySelector('svg');
    if (!svg) { cur.svg = null; return null; }
    if (svg !== cur.svg) {
      var p = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
      if (p.length !== 4 || p.some(function (n) { return isNaN(n); }) || !(p[2] > 0) || !(p[3] > 0)) { cur.svg = null; return null; }
      cur.svg = svg; cur.vb0 = svg.getAttribute('viewBox'); cur.style0 = svg.getAttribute('style'); cur.styled = false;
      cur.V = { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
    return svg;
  }

  function unstyle() {
    if (cur.svg && cur.styled) {
      cur.svg.setAttribute('viewBox', cur.vb0);
      if (cur.style0 === null) cur.svg.removeAttribute('style'); else cur.svg.setAttribute('style', cur.style0);
      cur.styled = false;
    }
    if (cur.locked) { frame.style.height = ''; frame.classList.remove('b68z'); cur.locked = false; }
  }

  /* Measure the natural (fit) layout once: frame size, fit pixel scale p, and the user-space point at the frame centre. */
  function ensureGeo() {
    var svg = adopt();
    if (!svg || !frame) return null;
    var key = cur.vb0 + '|' + (cur.mug ? 1 : 0) + '|' + window.innerWidth + 'x' + window.innerHeight;
    if (cur.geo && cur.geo.key === key) return cur.geo;
    unstyle();
    var fr = frame.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    var F = { w: frame.clientWidth, h: frame.clientHeight };
    if (F.w < 2 || F.h < 2 || sr.width < 2 || sr.height < 2) return null;
    var V = cur.V, p = Math.min(sr.width / V.w, sr.height / V.h);
    var cl = sr.left - fr.left - frame.clientLeft + (sr.width - V.w * p) / 2;
    var ct = sr.top - fr.top - frame.clientTop + (sr.height - V.h * p) / 2;
    cur.geo = { key: key, F: F, outerH: fr.height, p: p, fcx: V.x + (F.w / 2 - cl) / p, fcy: V.y + (F.h / 2 - ct) / p };
    return cur.geo;
  }

  /* ---------- state -> DOM ---------- */
  function updateUi() {
    if (readout) readout.textContent = state.scale.toFixed(1) + '×';
    if (btn.out) btn.out.setAttribute('aria-disabled', state.scale <= 1 + EPS ? 'true' : 'false');
    if (btn.fit) btn.fit.setAttribute('aria-disabled', state.scale <= 1 + EPS ? 'true' : 'false');
    if (btn['in']) btn['in'].setAttribute('aria-disabled', state.scale >= MAX - EPS ? 'true' : 'false');
    if (frame) frame.classList.toggle('b68z-on', state.scale > 1 + EPS);
  }

  function clampView() {
    var g = cur.geo, V = cur.V;
    if (!g || !V) return;
    var k = g.p * state.scale, hw = g.F.w / k / 2, hh = g.F.h / k / 2;
    /* viewport inside the drawing when it is smaller, drawing inside the viewport when it is larger: never out of view */
    var a = V.x + hw, b = V.x + V.w - hw, c = V.y + hh, d = V.y + V.h - hh;
    state.cx = clamp(state.cx, Math.min(a, b), Math.max(a, b));
    state.cy = clamp(state.cy, Math.min(c, d), Math.max(c, d));
  }

  function apply() {
    raf = 0;
    var svg = adopt(), g = cur.geo;
    updateUi();
    if (!svg) return;
    if (state.scale <= 1 + EPS) { unstyle(); return; }
    g = g || ensureGeo();
    if (!g) return;
    if (!cur.locked) { frame.style.height = g.outerH + 'px'; frame.classList.add('b68z'); cur.locked = true; }
    if (!cur.styled) {
      svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;max-height:none;' + (cur.style0 || '');
      cur.styled = true;
    }
    var k = g.p * state.scale, w = g.F.w / k, h = g.F.h / k;
    svg.setAttribute('viewBox', fmt(state.cx - w / 2) + ' ' + fmt(state.cy - h / 2) + ' ' + fmt(w) + ' ' + fmt(h));
  }
  function schedule() { updateUi(); if (!raf) raf = (window.requestAnimationFrame || window.setTimeout)(apply, 16); }

  /* ---------- operations ---------- */
  function frameXY(cx, cy) {
    if (!rectCache) { var r = frame.getBoundingClientRect(); rectCache = { l: r.left + frame.clientLeft, t: r.top + frame.clientTop }; }
    return { x: cx - rectCache.l, y: cy - rectCache.t };
  }

  /* zoom to ns keeping the user-space point under frame pixel (px, py) fixed (default: the frame centre) */
  function zoomAt(ns, px, py) {
    var g = ensureGeo();
    if (!g) return;
    if (state.scale <= 1 + EPS) { state.cx = g.fcx; state.cy = g.fcy; }
    if (px === undefined) { px = g.F.w / 2; py = g.F.h / 2; }
    var k0 = g.p * state.scale, ux = state.cx + (px - g.F.w / 2) / k0, uy = state.cy + (py - g.F.h / 2) / k0;
    var s = clamp(ns, 1, MAX);
    if (s < 1.04) s = 1;
    state.scale = s;
    if (s === 1) { state.cx = g.fcx; state.cy = g.fcy; schedule(); return; }
    var k1 = g.p * s;
    state.cx = ux - (px - g.F.w / 2) / k1; state.cy = uy - (py - g.F.h / 2) / k1;
    clampView(); schedule();
  }
  function panBy(dx, dy) {
    var g = cur.geo;
    if (!g || state.scale <= 1 + EPS) return;
    var k = g.p * state.scale;
    state.cx -= dx / k; state.cy -= dy / k;
    clampView(); schedule();
  }
  function zoomIn() { zoomAt(state.scale * STEP); }
  function zoomOut() { zoomAt(state.scale / STEP); }
  function reset() {
    state.scale = 1;
    if (cur.geo) { state.cx = cur.geo.fcx; state.cy = cur.geo.fcy; }
    schedule();
  }

  /* Head rectangle in the SVG's current user space. The kit tags the head group data-part="head"; fall back to the
     figure's stated height (floor y = 0, 25 units per inch) if it is ever missing. */
  function headBox() {
    var svg = cur.svg, V = cur.V;
    try {
      var head = svg.querySelector('[data-part="head"]'), m = svg.getScreenCTM();
      if (head && m) {
        var r = head.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) {
          var inv = m.inverse(), pt = svg.createSVGPoint(), xs = [], ys = [];
          [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].forEach(function (c) {
            pt.x = c[0]; pt.y = c[1]; var q = pt.matrixTransform(inv); xs.push(q.x); ys.push(q.y);
          });
          var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
          return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
      }
    } catch (e) { /* fall through */ }
    var b = B(), inches = (b && b.S && b.S.spec && b.S.spec.heightIn) || 70, hh = inches * 25 / 7.4;
    return { x: V.x + V.w / 2 - hh * 0.4, y: -inches * 25, w: hh * 0.8, h: hh };
  }

  function toFace() {
    if (!frame) return;
    if (frame.classList.contains('mug')) { reset(); return; }
    var g = ensureGeo();
    if (!g) return;
    var hb = headBox();
    if (!hb || !(hb.h > 0)) return;
    /* head plus a little breathing room above and the shoulders below: a window about 2.9 heads tall */
    var s = Math.min(g.F.h / (g.p * hb.h * 2.9), g.F.w / (g.p * hb.w * 2.1));
    state.scale = clamp(s, 1.5, MAX);
    state.cx = hb.x + hb.w / 2; state.cy = hb.y + hb.h * 1.02;
    clampView(); schedule();
  }

  /* ---------- redraw hook ---------- */
  function onArt() {
    var svg = adopt(), b = B(), S = b && b.S;
    var mug = !!(frame && frame.classList.contains('mug')), h = S && S.spec ? S.spec.heightIn : null;
    if (cur.mug !== null && (mug !== cur.mug || h !== cur.h)) { state.scale = 1; }
    cur.mug = mug; cur.h = h;
    if (!svg) { updateUi(); return; }
    if (state.scale > 1 + EPS) {
      if (!ensureGeo()) { state.scale = 1; updateUi(); return; }
      apply();
    } else {
      unstyle();
      if (cur.geo) { state.cx = cur.geo.fcx; state.cy = cur.geo.fcy; }
      updateUi();
    }
  }
  function invalidate() {
    cur.geo = null; rectCache = null;
    if (state.scale > 1 + EPS && !raf) raf = (window.requestAnimationFrame || window.setTimeout)(function () {
      raf = 0;
      if (ensureGeo()) { clampView(); apply(); }
    }, 16);
  }

  /* ---------- input ---------- */
  var ptrs = {}, ids = [], tap = null, lastTap = null;
  function mid() {
    if (ids.length === 1) return { x: ptrs[ids[0]].x, y: ptrs[ids[0]].y, d: 0 };
    var a = ptrs[ids[0]], c = ptrs[ids[1]];
    return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, d: Math.sqrt((a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y)) };
  }
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!adopt() || !ensureGeo() || ids.length >= 2) return;
    if (state.scale <= 1 + EPS) { state.cx = cur.geo.fcx; state.cy = cur.geo.fcy; }
    try { frame.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    ids.push(e.pointerId);
    if (ids.length === 1) tap = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, multi: false };
    else if (tap) tap.multi = true;
  }
  function onMove(e) {
    var p = ptrs[e.pointerId];
    if (!p) return;
    var before = mid();
    p.x = e.clientX; p.y = e.clientY;
    var now = mid();
    if (tap && !tap.moved && (Math.abs(e.clientX - tap.x) > 5 || Math.abs(e.clientY - tap.y) > 5)) tap.moved = true;
    if (ids.length === 2 && before.d > 0 && now.d > 0) {
      var a = frameXY(now.x, now.y), pa = frameXY(before.x, before.y), g = cur.geo;
      if (!g) return;
      if (state.scale <= 1 + EPS) { state.cx = g.fcx; state.cy = g.fcy; }
      var k0 = g.p * state.scale, ux = state.cx + (pa.x - g.F.w / 2) / k0, uy = state.cy + (pa.y - g.F.h / 2) / k0;
      var s = clamp(state.scale * now.d / before.d, 1, MAX);
      if (s < 1.04 && now.d < before.d) s = 1;
      state.scale = s;
      if (s === 1) { state.cx = g.fcx; state.cy = g.fcy; schedule(); }
      else { var k1 = g.p * s; state.cx = ux - (a.x - g.F.w / 2) / k1; state.cy = uy - (a.y - g.F.h / 2) / k1; clampView(); schedule(); }
    } else if (ids.length === 1 && state.scale > 1 + EPS && tap && tap.moved) {
      frame.classList.add('b68z-grab');
      panBy(now.x - before.x, now.y - before.y);
    }
    if (e.cancelable && state.scale > 1 + EPS) e.preventDefault();
  }
  function onUp(e) {
    var i = ids.indexOf(e.pointerId);
    if (i < 0) return;
    ids.splice(i, 1); delete ptrs[e.pointerId];
    try { frame.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    if (ids.length === 0) {
      frame.classList.remove('b68z-grab');
      var t = tap; tap = null;
      if (e.type === 'pointerup' && t && !t.moved && !t.multi && Date.now() - t.t < 450) {
        if (lastTap && t.t - lastTap.t < 380 && Math.abs(t.x - lastTap.x) < 30 && Math.abs(t.y - lastTap.y) < 30) {
          lastTap = null;
          if (state.scale > 1.05) reset(); else { var q = frameXY(t.x, t.y); zoomAt(DBL, q.x, q.y); }
        } else lastTap = { t: t.t, x: t.x, y: t.y };
      }
    } else if (tap) tap.multi = true;
  }
  function onWheel(e) {
    if (!adopt()) return;
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 100 : 1));
    if (!dy) return;
    if (state.scale <= 1 + EPS && dy > 0) return; /* nothing to zoom out of: let the page scroll */
    if (!ensureGeo()) return;
    e.preventDefault();
    var q = frameXY(e.clientX, e.clientY);
    zoomAt(state.scale * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), q.x, q.y);
  }

  /* ---------- markup ---------- */
  function css() {
    var st = document.createElement('style');
    st.id = 'zoomCss';
    st.textContent =
      '#frame { touch-action: none; -webkit-user-select: none; user-select: none; }' +
      '#frame.b68z-on { cursor: grab; }' +
      '#frame.b68z-grab { cursor: grabbing; }' +
      '#zoomSeg { align-items: stretch; }' +
      '#zoomSeg .chip { min-width: 34px; text-align: center; }' +
      '#zoomSeg .chip[aria-disabled="true"] { opacity: .4; cursor: default; }' +
      '#zoomSeg .chip[aria-disabled="true"]:hover { background: var(--card); color: var(--ink); border-color: var(--rule); }' +
      '#zoomSeg .zread { display: inline-flex; align-items: center; justify-content: center; min-width: 46px; padding: 0 8px; font: 700 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink); background: var(--paper); border-left: 2px solid var(--rule); }' +
      '@media (max-width: 760px) { #zoomSeg .chip { padding: 7px 8px; min-width: 30px; } #zoomSeg .zread { min-width: 38px; padding: 0 6px; } }';
    document.head.appendChild(st);
  }
  function mkBtn(key, text, label, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = text; b.setAttribute('aria-label', label); b.title = label;
    b.addEventListener('click', function () { fn(); });
    btn[key] = b; return b;
  }
  function build() {
    var tabs = document.querySelector('.stage-tabs');
    if (!tabs || byId('zoomSeg')) return;
    seg = document.createElement('div');
    seg.className = 'seg'; seg.id = 'zoomSeg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Zoom');
    seg.appendChild(mkBtn('out', '−', 'Zoom out', zoomOut));
    seg.appendChild(mkBtn('in', '+', 'Zoom in', zoomIn));
    seg.appendChild(mkBtn('fit', 'Fit', 'Fit to frame', reset));
    seg.appendChild(mkBtn('face', 'Face', 'Zoom to the face', toFace));
    readout = document.createElement('span');
    readout.className = 'zread mono'; readout.textContent = '1.0×'; readout.setAttribute('aria-hidden', 'true');
    seg.appendChild(readout);
    var note = byId('lodNote');
    if (note && note.parentNode === tabs) tabs.insertBefore(seg, note); else tabs.appendChild(seg);
  }

  function init() {
    frame = byId('frame'); art = byId('art');
    if (!frame || !art) return;
    css(); build();
    frame.addEventListener('wheel', onWheel, { passive: false });
    frame.addEventListener('pointerdown', onDown);
    frame.addEventListener('pointermove', onMove);
    frame.addEventListener('pointerup', onUp);
    frame.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', invalidate);
    window.addEventListener('scroll', function () { rectCache = null; }, { passive: true, capture: true });
    if (window.ResizeObserver) {
      var last = '';
      new window.ResizeObserver(function () {
        var k = frame.clientWidth + 'x' + frame.clientHeight;
        if (k !== last) { last = k; invalidate(); }
      }).observe(frame);
    }
    if (window.MutationObserver) new window.MutationObserver(onArt).observe(art, { childList: true });
    onArt(); updateUi();
  }

  window.B68Zoom = { zoomIn: zoomIn, zoomOut: zoomOut, reset: reset, toFace: toFace, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
