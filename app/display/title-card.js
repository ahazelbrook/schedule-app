/* The score title card on the table display (suite ticket 2.10, switch map.title): the show kind `scoretitle` for the B05 registry (app/display/shows.js).
   On GO the site's floor plan flies in, becomes the building, and the score's name lands on its grid, in the flat cut-paper manner of a 1960s title sequence. It is six
   seconds or less and it is generated from the site: the GM page (gm/title-card.js) reads the building's floors off the roll; nobody draws or writes anything for it.
   The payload: text (the score's name, at most 80), sub? (at most 120), floors? 1 to 6 strings "x,y,w,d": the footprint of each storey from the ground up, whole numbers on a
   0 to 100 grid (x + w and y + d at most 100, w and d at least 1). It carries a building's outside and nothing else: no room, no name, no basement, no figure.
   Every string reaches the page by textContent; the shapes are made with createElementNS from numbers this file computes. Looks: app/display/title-card.css and tokens.css.
   Under reduced motion the card is its last frame, still.

   API (also on module.exports for Node)
     parseFloor(s) -> { x, y, w, d } | null        cleanFloors(list) -> [string] | undefined (a list that does not pass is no list; the card then draws a plain block)
     clean(payload) -> the checked payload | null  layout(floors) -> { tops, lefts, rights, mats, plan }   the iso polygons per storey, and the matrix that lays each flat
     TOTAL_MS (6000) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68TitleCard = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var TOTAL_MS = 6000, MAX_FLOORS = 6, VW = 160, VH = 90, FLOOR_H = 7;
  var FLOOR_RE = /^\d{1,3},\d{1,3},\d{1,3},\d{1,3}$/;
  var FALLBACK = ['0,0,100,70'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function parseFloor(s) {
    if (typeof s !== 'string' || !FLOOR_RE.test(s)) return null;
    var n = s.split(',').map(Number), f = { x: n[0], y: n[1], w: n[2], d: n[3] };
    return f.w >= 1 && f.d >= 1 && f.x + f.w <= 100 && f.y + f.d <= 100 ? f : null;
  }
  function cleanFloors(list) {
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_FLOORS) return undefined;
    var out = [];
    for (var i = 0; i < list.length; i++) { if (!parseFloor(list[i])) return undefined; out.push(list[i]); }
    return out;
  }
  function text(v, max) { if (typeof v !== 'string') return undefined; var t = v.replace(/\s+/g, ' ').trim(); return t && t.length <= max ? t : undefined; }
  function clean(p) {
    var t = text(p.text, 80); if (!t) return null;
    var o = { text: t }, sub = text(p.sub, 120);
    if (p.sub !== undefined && p.sub !== null && !sub) return null;
    if (sub) o.sub = sub;
    if (p.floors !== undefined && p.floors !== null) { var f = cleanFloors(p.floors); if (!f) return null; o.floors = f; }
    return o;
  }

  /* iso: a plan point (x, y) at height z is at (X, Y) = (x - y, (x + y) / 2 - z) times k; the plan's own place on the stage is a flat copy at scale s.
     The matrix of a storey's top is the affine map that takes the stacked (iso) polygon back to its flat plan, so a CSS transition from it to none IS the plan becoming the building. */
  function r2(v) { return Math.round(v * 100) / 100; }
  function layout(list) {
    var fl = (cleanFloors(list) || FALLBACK).map(parseFloor);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    fl.forEach(function (f) { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.d); });
    var zt = fl.length * FLOOR_H;
    var ex = (x1 - y0) - (x0 - y1), ey = ((x1 + y1) / 2) - ((x0 + y0) / 2) + zt;      /* the stack's iso extent at k = 1 */
    var k = Math.min(78 / ex, 52 / ey);
    var cx = 104 - ((x1 - y0) + (x0 - y1)) / 2 * k, cy = 38 + (zt * k) / 2 - ((x1 + y1) / 2 + (x0 + y0) / 2) / 2 * k;   /* the stack's centre at (104, 38) */
    function P(x, y, z) { return [r2(cx + (x - y) * k), r2(cy + ((x + y) / 2 - z) * k)]; }
    var ps = Math.min(70 / (x1 - x0), 44 / (y1 - y0)), fx = 12 - x0 * ps, fy = 14 - y0 * ps;      /* the flat plan: scaled, top left of the stage */
    var out = { tops: [], lefts: [], rights: [], mats: [], plan: [], k: k };
    fl.forEach(function (f, i) {
      var z0 = i * FLOOR_H, z1 = (i + 1) * FLOOR_H, X = f.x, Y = f.y, W = f.w, D = f.d;
      out.tops.push([P(X, Y, z1), P(X + W, Y, z1), P(X + W, Y + D, z1), P(X, Y + D, z1)]);
      out.lefts.push([P(X, Y + D, z0), P(X + W, Y + D, z0), P(X + W, Y + D, z1), P(X, Y + D, z1)]);
      out.rights.push([P(X + W, Y + D, z0), P(X + W, Y, z0), P(X + W, Y, z1), P(X + W, Y + D, z1)]);
      /* flat = F(plan) with F(p) = ps * p + (fx, fy); iso top = A p + t, A = k [[1, -1], [.5, .5]], t = (cx, cy - z1 k). flat as a map of the iso point: p = A^-1 (q - t) */
      var a = k, b = -k, c = k / 2, d = k / 2, det = a * d - b * c, ia = d / det, ib = -b / det, ic = -c / det, id = a / det;     /* A^-1 = [[ia, ib], [ic, id]] */
      var tx = cx, ty = cy - z1 * k;
      /* flat = ps * A^-1 q - ps * A^-1 t + (fx, fy) */
      var m11 = ps * ia, m12 = ps * ib, m21 = ps * ic, m22 = ps * id;
      var e = -(m11 * tx + m12 * ty) + fx, f2 = -(m21 * tx + m22 * ty) + fy;
      out.mats.push([r2(m11 * 1e3) / 1e3, r2(m21 * 1e3) / 1e3, r2(m12 * 1e3) / 1e3, r2(m22 * 1e3) / 1e3, r2(e), r2(f2)]);      /* CSS matrix(a, b, c, d, e, f): a = m11, b = m21, c = m12, d = m22 */
      out.plan.push([[fx + X * ps, fy + Y * ps], [fx + (X + W) * ps, fy + Y * ps], [fx + (X + W) * ps, fy + (Y + D) * ps], [fx + X * ps, fy + (Y + D) * ps]].map(function (q) { return [r2(q[0]), r2(q[1])]; }));
    });
    return out;
  }
  function pts(poly) { return poly.map(function (q) { return q[0] + ',' + q[1]; }).join(' '); }

  var FILL = ['a', 'b', 'c', 'd', 'e', 'f'];      /* the storeys' cut-paper colours by class: tc-c0 .. tc-c5 (title-card.css) */
  function el(doc, tag, cls, txt) { var e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null && txt !== '') e.textContent = txt; return e; }
  function sv(doc, tag, attrs) { var e = doc.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); }); return e; }

  function render(p, env) {
    var doc = (env && env.document) || root.document, L = layout(p.floors);
    var n = el(doc, 'div', 'dp-show dp-show-scoretitle');
    n.setAttribute('data-show', 'scoretitle');
    if (env && env.reduced) n.setAttribute('data-reduced', '1');
    var stage = el(doc, 'div', 'dp-tc-stage');      /* a 16:9 stage the grid, the building and the title all sit on, so they stay on one grid at any screen shape */
    var svg = sv(doc, 'svg', { viewBox: '0 0 ' + VW + ' ' + VH, class: 'dp-tc-svg', 'aria-hidden': 'true' });
    var grid = sv(doc, 'g', { class: 'dp-tc-grid' }), i;
    for (i = 0; i <= 16; i++) grid.appendChild(sv(doc, 'line', { x1: i * 10, y1: 0, x2: i * 10, y2: VH, class: 'dp-tc-gl', style: '--i:' + i }));
    for (i = 0; i <= 9; i++) grid.appendChild(sv(doc, 'line', { x1: 0, y1: i * 10, x2: VW, y2: i * 10, class: 'dp-tc-gl', style: '--i:' + (i + 4) }));
    svg.appendChild(grid);
    var bld = sv(doc, 'g', { class: 'dp-tc-bld' });
    L.tops.forEach(function (top, j) {
      var g = sv(doc, 'g', { class: 'dp-tc-floor dp-tc-c' + (j % FILL.length), style: '--i:' + j + ';--m0:matrix(' + L.mats[j].join(',') + ')' });
      g.appendChild(sv(doc, 'polygon', { class: 'dp-tc-left', points: pts(L.lefts[j]) }));
      g.appendChild(sv(doc, 'polygon', { class: 'dp-tc-right', points: pts(L.rights[j]) }));
      g.appendChild(sv(doc, 'polygon', { class: 'dp-tc-top', points: pts(top) }));
      bld.appendChild(g);
    });
    svg.appendChild(bld);
    stage.appendChild(svg);
    stage.appendChild(el(doc, 'div', 'dp-tc-slab'));
    var title = el(doc, 'p', 'dp-tc-title', p.text);
    title.style.setProperty('--n', String(Math.max(8, p.text.length)));
    stage.appendChild(title);
    if (p.sub) stage.appendChild(el(doc, 'p', 'dp-tc-sub', p.sub));
    n.appendChild(stage);
    return n;
  }

  var FIXTURE = { text: 'The Pelican Job', sub: 'Nowhere Ward', floors: ['0,0,100,72', '0,0,100,72', '0,0,100,72', '24,16,52,40'] };
  if (root && root.B68Shows && typeof root.B68Shows.register === 'function') {
    root.B68Shows.register('scoretitle', {
      label: 'Score title card', ms: TOTAL_MS,
      fixture: FIXTURE,
      fixtures: [{ label: 'Score title card: a stepped building', fixture: FIXTURE }, { label: 'Score title card: no floors, a long name', fixture: { text: 'A long score name that wraps over two lines of the grid', sub: 'Nowhere Ward' } }],
      clean: clean, render: render
    });
  }
  return { TOTAL_MS: TOTAL_MS, MAX_FLOORS: MAX_FLOORS, parseFloor: parseFloor, cleanFloors: cleanFloors, clean: clean, layout: layout, render: render, FIXTURE: FIXTURE };
});
