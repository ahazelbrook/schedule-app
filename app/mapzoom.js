/* mapzoom.js: zoom and pan for an inline SVG map, by rewriting its viewBox (vector, so a zoomed map stays sharp).
   The maths is the display page's (Pure.clampView / viewWindow / pinchView), lifted so the GM Run view shares it; display-page.js keeps its own copy.
   V = the SVG's own viewBox {x,y,w,h}; size = the frame in pixels {w,h}; st = { s, cx, cy }: s the zoom (1 = fit), (cx,cy) the user-space point at the frame's centre.
   attach(frame, svg, { store, onChange }) wires wheel (at the cursor), drag, two-finger pinch, double click and + / - / Fit buttons; `store` is the caller's { s, cx, cy, key }
   and is written in place, so a redraw that attaches again lands on the same view. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B68MapZoom = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var Pure = {}, MAXZOOM = 8, STEP = 1.5;
  Pure.MAXZOOM = MAXZOOM;
  Pure.fitK = function (V, size) { return Math.min(size.w / V.w, size.h / V.h); };
  Pure.parseViewBox = function (s) {
    var p = String(s || '').split(/[\s,]+/).filter(Boolean).map(Number);
    return p.length === 4 && p.every(isFinite) && p[2] > 0 && p[3] > 0 ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null;
  };
  Pure.fit = function (V) { return { s: 1, cx: V.x + V.w / 2, cy: V.y + V.h / 2 }; };
  Pure.clampView = function (V, size, st) {
    var s = Math.min(MAXZOOM, Math.max(1, isFinite(st.s) ? st.s : 1)), k = Pure.fitK(V, size) * s;
    var hw = size.w / (2 * k), hh = size.h / (2 * k);
    var cx = isFinite(st.cx) ? st.cx : V.x + V.w / 2, cy = isFinite(st.cy) ? st.cy : V.y + V.h / 2;
    return {
      s: s,
      cx: V.w <= 2 * hw ? V.x + V.w / 2 : Math.min(V.x + V.w - hw, Math.max(V.x + hw, cx)),
      cy: V.h <= 2 * hh ? V.y + V.h / 2 : Math.min(V.y + V.h - hh, Math.max(V.y + hh, cy))
    };
  };
  Pure.viewWindow = function (V, size, st) {
    var c = Pure.clampView(V, size, st), k = Pure.fitK(V, size) * c.s, w = size.w / k, h = size.h / k;
    return { x: c.cx - w / 2, y: c.cy - h / 2, w: w, h: h };
  };
  /* start = { s, cx, cy, d, px, py } when the fingers went down (d the finger distance, 1 for one finger; px, py the midpoint in pixels from the frame centre);
     now = { d, px, py }. The map point that was under the start midpoint stays under the current one: a pinch zooms, a drag pans. */
  Pure.pinchView = function (V, size, start, now) {
    var k0 = Pure.fitK(V, size), ks = k0 * start.s;
    var ux = start.cx + start.px / ks, uy = start.cy + start.py / ks;
    var s = Math.min(MAXZOOM, Math.max(1, start.s * (start.d > 0 ? now.d / start.d : 1)));
    var k = k0 * s;
    return Pure.clampView(V, size, { s: s, cx: ux - now.px / k, cy: uy - now.py / k });
  };
  /* zoom by `f` keeping the point (px, py) (pixels from the frame centre) still; the buttons use (0, 0) */
  Pure.zoomAt = function (V, size, st, f, px, py) {
    return Pure.pinchView(V, size, { s: st.s, cx: st.cx, cy: st.cy, d: 1, px: px || 0, py: py || 0 }, { d: f, px: px || 0, py: py || 0 });
  };
  Pure.keyOf = function (V) { return [V.x, V.y, V.w, V.h].join(' '); };

  /* the view is also kept in sessionStorage by map, so leaving the tab and coming back (or a reload) lands on the same view; storage may be absent or blocked */
  var SKEY = 'b68.mapzoom.';
  function remember(key, c) { try { sessionStorage.setItem(SKEY + key, JSON.stringify({ s: c.s, cx: c.cx, cy: c.cy })); } catch (e) { /* no storage: the view lives in the store only */ } }
  function recall(key) {
    try { var o = JSON.parse(sessionStorage.getItem(SKEY + key)); return o && isFinite(o.s) && isFinite(o.cx) && isFinite(o.cy) ? { s: o.s, cx: o.cx, cy: o.cy } : null; } catch (e) { return null; }
  }
  Pure.remember = remember; Pure.recall = recall;

  function attach(frame, svg, opts) {
    opts = opts || {};
    var V = Pure.parseViewBox(svg && svg.getAttribute('viewBox'));
    if (!V || !frame) return null;
    var store = opts.store || {}, key = Pure.keyOf(V);
    /* a different map (another floor, a new size) starts fitted; the same map keeps its view */
    if (store.key !== key || !isFinite(store.s)) {
      var f0 = Pure.fit(V), kept = recall(key); if (kept) f0 = kept;
      store.s = f0.s; store.cx = f0.cx; store.cy = f0.cy; store.key = key;
    }
    var size = { w: 1, h: 1 }, pts = {}, gesture = null, offs = [], doc = frame.ownerDocument;
    function measure() { var r = frame.getBoundingClientRect(); size = { w: Math.max(1, r.width), h: Math.max(1, r.height) }; return r; }
    function apply() {
      var c = Pure.clampView(V, size, store); store.s = c.s; store.cx = c.cx; store.cy = c.cy;
      var w = Pure.viewWindow(V, size, c);
      svg.setAttribute('viewBox', [w.x, w.y, w.w, w.h].map(function (n) { return Math.round(n * 1000) / 1000; }).join(' '));
      frame.classList.toggle('mz-zoomed', c.s > 1.001);
      remember(key, c);
      if (opts.onChange) opts.onChange(c);
    }
    function set(st) { store.s = st.s; store.cx = st.cx; store.cy = st.cy; apply(); }
    function zoomBy(f) { measure(); set(Pure.zoomAt(V, size, store, f, 0, 0)); }
    function fitView() { set(Pure.fit(V)); }
    function ids() { return Object.keys(pts); }
    function centre(r) {
      var a = ids().map(function (k) { return pts[k]; }), x = 0, y = 0;
      a.forEach(function (p) { x += p.x; y += p.y; });
      return { px: x / a.length - r.left - r.width / 2, py: y / a.length - r.top - r.height / 2 };
    }
    function spread() { var a = ids().map(function (k) { return pts[k]; }); return a.length < 2 ? 1 : Math.max(1, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)); }
    function begin() {
      if (!ids().length) { gesture = null; return; }
      var r = measure(), c = centre(r);
      gesture = { s: store.s, cx: store.cx, cy: store.cy, d: spread(), px: c.px, py: c.py };
    }
    function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); offs.push(function () { el.removeEventListener(ev, fn, o); }); }
    var ctl = doc.createElement('div'); ctl.className = 'mz-ctl'; ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Map zoom');
    [['in', '+', 'Zoom in'], ['out', '−', 'Zoom out'], ['fit', 'Fit', 'Fit the whole map']].forEach(function (b) {
      var el = doc.createElement('button'); el.type = 'button'; el.className = 'mz-btn'; el.setAttribute('data-mz', b[0]); el.setAttribute('aria-label', b[2]); el.title = b[2]; el.textContent = b[1];
      ctl.appendChild(el);
    });
    frame.appendChild(ctl);
    on(ctl, 'pointerdown', function (ev) { ev.stopPropagation(); });
    on(ctl, 'dblclick', function (ev) { ev.stopPropagation(); });
    on(ctl, 'click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-mz]') : null; if (!b) return;
      var a = b.getAttribute('data-mz');
      if (a === 'in') zoomBy(STEP); else if (a === 'out') zoomBy(1 / STEP); else fitView();
    });
    /* A press is not a pan: nothing is captured and nothing is stopped until the pointer has moved PAN_SLOP px (or a second finger lands), so a tap or a click goes through
       untouched. A press that starts on a control, a link, a chip or anything the Run view handles itself (data-rv / data-vv / role=button) never pans. */
    var PAN_SLOP = 4, INTERACTIVE = 'button, a, input, select, textarea, summary, [role="button"], [data-rv], [data-vv], [data-mz], .rv-pc, .chip', started = false, justPanned = false;
    function capture() { ids().forEach(function (k) { try { frame.setPointerCapture(+k); } catch (e) { /* the drag still works inside the frame */ } }); }
    on(frame, 'pointerdown', function (ev) {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      var t = ev.target; if (t && t.closest && t.closest(INTERACTIVE)) return;
      pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY };
      if (ids().length > 1) { begin(); started = true; capture(); }       /* a second finger is a pinch at once */
    });
    on(frame, 'pointermove', function (ev) {
      var p = pts[ev.pointerId]; if (!p) return;
      p.x = ev.clientX; p.y = ev.clientY;
      if (!started) {
        if (Math.hypot(p.x - p.x0, p.y - p.y0) <= PAN_SLOP) return;
        started = true; justPanned = true; begin(); capture(); frame.classList.add('mz-drag'); return;
      }
      if (!gesture) return;
      var c = centre(frame.getBoundingClientRect());
      set(Pure.pinchView(V, size, gesture, { d: spread(), px: c.px, py: c.py }));
      justPanned = true; frame.classList.add('mz-drag');
    });
    function up(ev) {
      if (!pts[ev.pointerId]) return;
      delete pts[ev.pointerId];
      try { frame.releasePointerCapture(ev.pointerId); } catch (e) { /* already released */ }
      if (ids().length) { if (started) begin(); } else { gesture = null; started = false; frame.classList.remove('mz-drag'); }
    }
    on(frame, 'pointerup', up); on(frame, 'pointercancel', up);
    /* the click that ends a pan is not a tap on whatever the pointer finished over */
    on(frame, 'click', function (ev) { if (justPanned) { justPanned = false; ev.stopPropagation(); ev.preventDefault(); } }, true);
    on(frame, 'pointerdown', function () { justPanned = false; }, true);
    on(frame, 'wheel', function (ev) {
      ev.preventDefault();
      var r = measure(), px = ev.clientX - r.left - r.width / 2, py = ev.clientY - r.top - r.height / 2;
      set(Pure.zoomAt(V, size, store, Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0018)), px, py));
    }, { passive: false });
    on(frame, 'dblclick', function (ev) { ev.preventDefault(); fitView(); });
    var ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(function () { measure(); apply(); }); ro.observe(frame); }
    measure(); apply();
    return {
      zoomBy: zoomBy, fit: fitView, refit: function () { measure(); apply(); },
      destroy: function () { offs.forEach(function (f) { f(); }); offs = []; if (ro) ro.disconnect(); if (ctl.parentNode) ctl.parentNode.removeChild(ctl); }
    };
  }
  return { Pure: Pure, attach: attach };
}));
