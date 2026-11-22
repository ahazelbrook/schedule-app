/* gm/map-fit.js: the fallback steps for a map over the iPad’s cap (map.fit, RK28 of the room key build).
   Registered as a stub by RK01; filled by RK28. It is in the map-fit bundle (app/routes.js), fetched only while its setting is on.
   The GM page (playerDisplay in gm-page.js) keeps the one door: every step is drawn through the page's own clean(), which runs the unchanged leaks()
   scan, and its markers go through the unchanged tokenScreen with the same tokens. This file only decides WHICH options to try next, and keeps the record.
     wrap(render, hooks)  the renderer playerDisplay draws with: svg-slim's slim() is applied right after the kit, so the scan reads exactly what is sent,
                          and each render's size is noted (hooks = { bytes(svg), slim(svg) }). Wrapping twice wraps the inner renderer once.
     fit(ctx)             a map over the cap -> { r, cut, steps }, or throws the refusal. ctx = { first, o, o0, cap, flat, bytes, draw, render }:
                          first the full render, o the scene's options, o0 the options without the scene, draw(opts) the page's clean(), render the wrapped one.
     steps                [{ rung, bytes, leaked }], the full render first. A step that named a hidden room has leaked: true, and the size it drew at.
   The ladder, each rung tried only while the map is still over the cap:
     shade (flat furniture) > halfcrowd > crowd (none) > figures (a room cut keeps one full figure) > nofigures (the room alone) > scene (no people) > rings (the plain map as rings).
   A room cut with more than one figure goes straight to figures (RK28b): the shade, crowd rungs save about 3% there and cost a render each.
   Plain script, UMD: window.B68GmMapFit in the browser, module.exports under Node. ES5, as the files beside it. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmMapFit = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RUNGS = ['shade', 'halfcrowd', 'crowd', 'figures', 'nofigures', 'scene', 'rings'];
  var LABEL = { full: 'whole', shade: 'flat furniture', halfcrowd: 'half the crowd', crowd: 'no crowd', figures: 'one figure', nofigures: 'the room alone', scene: 'no people', rings: 'rings' };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function copy(o) { return Object.assign({}, o); }
  function kib(n) { return Math.round(n / 1024); }

  /* the crowd at half density (the kit's floor is 0.5), or null when it is drawn at that already */
  function halfCrowd(c) {
    var d = isObj(c) && c.density != null ? +c.density : 1;
    if (d <= 0.5) return null;
    return Object.assign({}, isObj(c) ? c : {}, { density: 0.5 });
  }
  /* a room cut's people with one full figure: every picture stays (it costs little), the first person drawn from a spec stays, the other specs go;
     null when there is nothing to drop */
  function oneFigure(people) {
    if (!Array.isArray(people)) return null;
    var specs = 0, out = [];
    people.forEach(function (p) {
      if (isObj(p) && isObj(p.spec) && !p.image) { specs++; if (specs > 1) return; }
      out.push(p);
    });
    return specs > 1 ? out : null;
  }

  /* [[rung, options, flatOptions]] in the order they are tried, for a map over the cap. o is the scene's options (people, crowd, a room cut), o0 the same map
     without them. Furniture goes flat on its own first (a flat copy that fits is the cut). The rungs after it keep the depth, so a toast never claims less than
     was done, but for the last two: the map without its people goes flat (flatOptions) when the flat copy came out smaller than the shaded one. */
  function plan(o, o0, flat) {
    var out = [], cur, room = isObj(o) && o !== o0 && o.view === 'room', one = room ? oneFigure(o.people) : null;
    if (one) {      /* a room cut with several figures: the figures are the weight, so they go first */
      cur = copy(o); delete cur.crowd; cur.people = one; out.push(['figures', cur]);
    } else {
      if (isObj(o) && o.shade === true) out.push(['shade', flat(o)]);
      if (o !== o0 && o.crowd) {
        var half = halfCrowd(o.crowd);
        if (half) { cur = copy(o); cur.crowd = half; out.push(['halfcrowd', cur]); }
        cur = copy(o); delete cur.crowd; out.push(['crowd', cur]);
      }
    }
    if (room && Array.isArray(o.people) && o.people.length) { cur = copy(o); delete cur.crowd; cur.people = []; out.push(['nofigures', cur]); }      /* the room alone: better than losing the room */
    if (o !== o0) out.push(['scene', o0, flat(o0)]);
    if (o0.view !== 'rings') { cur = copy(o0); cur.view = 'rings'; var fl = flat(cur); out.push(['rings', cur, fl]); }
    return out;
  }

  function wrap(render, hooks) {
    if (typeof render !== 'function') return render;
    var inner = typeof render.fitInner === 'function' ? render.fitInner : render, h = hooks || {}, seen = [];
    var w = function (roll, opts) {
      var r = inner(roll, opts);
      if (r && typeof r.svg === 'string') {
        if (typeof h.slim === 'function') { try { var s = h.slim(r.svg); if (typeof s === 'string' && s) r = Object.assign({}, r, { svg: s }); } catch (e) { /* the kit's own svg goes as it is */ } }
        seen.push(typeof h.bytes === 'function' ? h.bytes(r.svg) : r.svg.length);
      }
      return r;
    };
    w.fitInner = inner; w.fitSeen = seen;
    return w;
  }

  /* the page's refusal: the smallest size any step drew at, and the steps that named a hidden room */
  function refusal(steps, cap) {
    var sizes = steps.filter(function (s) { return typeof s.bytes === 'number'; }), min = sizes.length ? Math.min.apply(null, sizes.map(function (s) { return s.bytes; })) : 0;
    var tried = steps.map(function (s) { return LABEL[s.rung] + ' ' + (typeof s.bytes === 'number' ? kib(s.bytes) : '?') + (s.leaked ? ' (named a hidden room)' : ''); });
    var e = new Error('This map is too large for the iPad (smallest tried ' + kib(min) + ' KiB, at most ' + kib(cap) + '). Tried, in KiB: ' + tried.join(', ') + '. Show fewer bands or another view.');
    e.big = true; e.fit = true; e.min = min;
    e.steps = steps.map(function (s) { return { rung: s.rung, bytes: s.bytes, leaked: s.leaked }; });
    e.leakedRungs = steps.filter(function (s) { return s.leaked; }).map(function (s) { return s.rung; });
    return e;
  }

  function fit(ctx) {
    var bytes = ctx.bytes, seen = ctx.render && ctx.render.fitSeen ? ctx.render.fitSeen : null;
    var steps = [{ rung: 'full', bytes: bytes(ctx.first.svg), leaked: false }], rungs = plan(ctx.o, ctx.o0, ctx.flat), flatWins = false;
    for (var i = 0; i < rungs.length; i++) {
      if (seen) seen.length = 0;
      var t = ctx.draw(flatWins && rungs[i][2] ? rungs[i][2] : rungs[i][1]), b = t ? bytes(t.svg) : (seen && seen.length ? seen[0] : null);
      steps.push({ rung: rungs[i][0], bytes: b, leaked: !t });
      if (t && b <= ctx.cap) return { r: t, cut: rungs[i][0], steps: steps };
      if (rungs[i][0] === 'shade' && t && b < steps[0].bytes) flatWins = true;
    }
    throw refusal(steps, ctx.cap);
  }

  return { RUNGS: RUNGS, LABEL: LABEL, plan: plan, wrap: wrap, fit: fit, halfCrowd: halfCrowd, oneFigure: oneFigure, refusal: refusal };
});
