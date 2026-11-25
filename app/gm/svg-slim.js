/* gm/svg-slim.js: a smaller svg for the iPad (map.fit, RK28.4 of the room key build).
   slim(svg) -> a string that draws the same picture in fewer bytes. Pure, no DOM, no network. It runs inside the page's clean() right after the render
   (through B68GmMapFit.wrap), so the hidden-name scan reads exactly the bytes that are sent.
   What it does, and only this:
     - drops whitespace-only runs between tags (never inside <text>, <tspan>, <title>, <desc>, <style> or <foreignObject>);
     - rewrites the numbers of a path's d, a polygon's or polyline's points, and the plain numeric attributes (x, y, cx, cy, r, width, height, the line ends,
       the opacities, stroke-width) without a trailing zero or a leading zero, drops the separators a path doesn't need (M1 2L3-4), and cuts float noise
       (1.6199999999999999) to four decimals;
     - rounds those path and points numbers, and translate(), to one decimal where that cannot show: a plain drawing space (the cumulative scale of the groups
       above is at most 1.5), and never inside defs, clipPath, mask, pattern, symbol, marker, filter or a gradient, nor in a nested <svg>.
   What it never touches: a text node, scale(), rotate() or matrix(), an id, a class, any data-* attribute, a url() or href, the root <svg> tag, a comment,
   style attributes. RK29 (room openings) finds rooms by data-room, so those stay exactly as drawn.
   Plain script, UMD: window.B68GmSvgSlim in the browser, module.exports under Node. ES5, as the files beside it. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSvgSlim = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PLACES = 1;           /* geometry in a plain drawing space: one decimal */
  var NOISE = 4;            /* anywhere else: only float noise goes (more than four decimals) */
  var SCALE_MAX = 1.5;      /* above this a group magnifies its children, so a rounded number would show */
  var NUM_ATTRS = { x: 1, y: 1, cx: 1, cy: 1, r: 1, rx: 1, ry: 1, width: 1, height: 1, x1: 1, y1: 1, x2: 1, y2: 1, opacity: 1, 'fill-opacity': 1, 'stroke-opacity': 1, 'stroke-width': 1 };
  var KEEP_SPACE = { text: 1, tspan: 1, textpath: 1, title: 1, desc: 1, style: 1, foreignobject: 1 };
  var NO_ROUND = { defs: 1, clippath: 1, mask: 1, pattern: 1, symbol: 1, marker: 1, filter: 1, lineargradient: 1, radialgradient: 1, svg: 1 };
  var NUM = /^-?(?:\d+\.?\d*|\.\d+)$/;

  /* one number as text: no trailing zero, no leading zero, no "-0"; `places` (a whole number, or null) is where it may be rounded */
  function num(t, places) {
    if (!NUM.test(t)) return t;
    var neg = t.charAt(0) === '-', body = neg ? t.slice(1) : t, dot = body.indexOf('.');
    var frac = dot < 0 ? '' : body.slice(dot + 1), cut = places !== null && places !== undefined ? places : NOISE;
    if (frac.length > cut) {
      var v = Math.round(Math.abs(Number(t)) * Math.pow(10, cut)) / Math.pow(10, cut);
      body = v.toFixed(cut); dot = body.indexOf('.'); frac = dot < 0 ? '' : body.slice(dot + 1);
    }
    var ip = dot < 0 ? body : body.slice(0, dot);
    frac = frac.replace(/0+$/, '');
    if (ip === '' || /^0+$/.test(ip)) ip = frac ? '' : '0'; else ip = ip.replace(/^0+(?=\d)/, '');
    var out = ip + (frac ? '.' + frac : '');
    return neg && out !== '0' ? '-' + out : out;
  }
  var PATH_TOK = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|[\s,]+/g;
  /* a path's d, or null when it holds anything this does not know (then it is left exactly as it is) */
  function path(d, places) {
    var out = '', prevNum = false, m, last = 0;
    PATH_TOK.lastIndex = 0;
    while ((m = PATH_TOK.exec(d))) {
      if (m.index !== last || m[0] === '') return null;
      last = PATH_TOK.lastIndex;
      if (m[1]) { out += m[1]; prevNum = false; }
      else if (m[2] !== undefined) {
        var n = /[eE]/.test(m[2]) ? m[2] : num(m[2], places);
        out += prevNum && n.charAt(0) !== '-' ? ' ' + n : n; prevNum = true;
      }
    }
    return last === d.length ? out : null;
  }
  function points(p, places) {
    var parts = p.trim().split(/[\s,]+/), out = [];
    for (var i = 0; i < parts.length; i++) { if (!NUM.test(parts[i])) return null; out.push(num(parts[i], places)); }
    return out.join(' ');
  }
  /* the scale a transform gives its children: scale(s) or scale(sx sy) (the larger), matrix(a b c d e f) (the root of its determinant) */
  function scaleOf(tf) {
    var s = 1, m, re = /(scale|matrix)\(([^)]*)\)/g;
    while ((m = re.exec(tf))) {
      var v = m[2].trim().split(/[\s,]+/).map(Number);
      if (v.some(function (x) { return !isFinite(x); })) return Infinity;
      if (m[1] === 'scale') s *= Math.max(Math.abs(v[0]), Math.abs(v.length > 1 ? v[1] : v[0]));
      else if (v.length === 6) s *= Math.sqrt(Math.abs(v[0] * v[3] - v[1] * v[2]));
      else return Infinity;
    }
    return s;
  }
  /* translate(x y), and the e f of matrix(a b c d e f); a to d only lose their zeros (a rounded one would turn the drawing) */
  function translates(tf, places) {
    tf = tf.replace(/matrix\(([^)]*)\)/g, function (all, list) {
      var v = list.trim().split(/[\s,]+/);
      if (v.length !== 6 || !v.every(function (x) { return NUM.test(x); })) return all;
      return 'matrix(' + v.map(function (x, i) { return num(x, i < 4 ? Infinity : places); }).join(' ') + ')';
    });
    return tf.replace(/translate\(\s*([^\s,)]+)(?:[\s,]+([^\s,)]+))?\s*\)/g, function (all, a, b) {
      if (!NUM.test(a) || (b !== undefined && !NUM.test(b))) return all;
      return 'translate(' + num(a, places) + (b !== undefined ? ' ' + num(b, places) : '') + ')';
    });
  }
  var TAG = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
  var ATTR = /([\w:.-]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/g;

  function slim(svg) {
    if (typeof svg !== 'string' || svg.indexOf('<') < 0) return svg;
    var out = '', last = 0, m, stack = [{ scale: 1, noRound: false, keep: false }], first = true, keepDepth = 0;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(svg))) {
      var gap = svg.slice(last, m.index);
      if (gap) out += (!keepDepth && /^\s+$/.test(gap)) ? '' : gap;
      last = TAG.lastIndex;
      if (m[0].charAt(1) === '!') { out += m[0]; continue; }
      var closing = m[1] === '/', name = m[2], low = name.toLowerCase(), selfClose = m[4] === '/';
      if (closing) {
        if (stack.length > 1) { var top = stack.pop(); if (top.keep) keepDepth--; }
        out += m[0]; continue;
      }
      var parent = stack[stack.length - 1], isRoot = first, attrs = m[3], own = 1, tf = '';
      first = false;
      attrs.replace(ATTR, function (all, k, eq, v1, v2) { if (k === 'transform') tf = v1 !== undefined ? v1 : v2; return all; });
      if (tf) own = scaleOf(tf);
      var cum = parent.scale * own, noRound = parent.noRound || (!isRoot && !!NO_ROUND[low]);
      if (!isRoot) {
        var rePlaces = !noRound && cum <= SCALE_MAX ? PLACES : null, trPlaces = !parent.noRound && parent.scale <= SCALE_MAX ? PLACES : null;
        attrs = attrs.replace(ATTR, function (all, k, eq, v1, v2) {
          var v = v1 !== undefined ? v1 : v2, quote = v1 !== undefined ? '"' : "'", r = null;
          if (k === 'd' && low === 'path') r = path(v, rePlaces);
          else if (k === 'points' && (low === 'polygon' || low === 'polyline')) r = points(v, rePlaces);
          else if (k === 'transform') r = translates(v, trPlaces);
          else if (NUM_ATTRS[k] === 1 && NUM.test(v)) r = num(v, null);
          return r === null ? all : k + eq + quote + r + quote;
        });
      }
      out += '<' + name + attrs + (selfClose ? '/' : '') + '>';
      if (!selfClose) { var keep = !!KEEP_SPACE[low]; stack.push({ scale: cum, noRound: noRound, keep: keep }); if (keep) keepDepth++; }
    }
    var tail = svg.slice(last);
    return out + (tail && !keepDepth && /^\s+$/.test(tail) ? '' : tail);
  }
  return { slim: slim, num: num, path: path, points: points, scaleOf: scaleOf, PLACES: PLACES, SCALE_MAX: SCALE_MAX };
});
