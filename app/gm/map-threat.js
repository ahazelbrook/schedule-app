/* gm/map-threat.js — the threat on the map (suite 2.5, switch map.threat).

   Plain script, UMD: window.B68GmMapThreat in the browser, module.exports under Node. GM side only.

   When the stamp (1.3, gm/stamp.js, switch spine.stamp) goes up, before the dice, its one-line threatened consequence drops a GLYPH on the room the crew are in on the
   Run map: a guard turning, a door locking, an alarm, harm. It clears with the stamp (the result marked, Esc, a new stamp replaces it). The glyph is chosen from the
   words of the line by a short list of stems (glyphFor); a line that matches none of them gets a plain warning mark rather than a guess, and an empty line gets nothing.
   GM map only: the glyph is drawn into the GM's own Run map, nothing about it reaches the iPad or a phone (a glyph for the iPad would be a show-kind key on the server,
   the client and the look-book; this ticket does not add one).

   API
     SWITCH  KINDS
     glyphFor(text) -> 'guard' | 'door' | 'alarm' | 'harm' | 'warn' | ''
     glyphSvg(doc, svg, box, kind) -> the <g> (every attribute set, no page text)       clearGlyph(svg)
     create(host) -> controller { drop(stamp), clear(), view(), paint(frame, svg, zoom) }
       host: { feature(id), doc(), room() -> the crew's room name, roomBox(svg, name) -> box | null, log(text) } */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmMapThreat = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'map.threat';
  var NS = 'http://www.w3.org/2000/svg';
  var KINDS = ['guard', 'door', 'alarm', 'harm', 'warn'];
  /* stems, most specific first: "the alarm trips a lock" is an alarm; "the guard hurts you" is a guard turning, then harm if no guard is mentioned */
  var STEMS = [
    ['alarm', /\b(alarm|siren|bell|whistle|klaxon|alert(?:s|ed)?|raises? the|sounds?)\b/],
    ['guard', /\b(guards?|patrol(?:s|ling)?|watch(?:man|men|er|ers)?|sentry|sentries|turns?|turning|notices?|spots?|sees?|catch(?:es)? sight|cop|cops|police)\b/],
    ['door', /\b(doors?|locks?|locked|locking|bolt(?:s|ed)?|seals?|sealed|shut|gate|gates|jams?|jammed|barred?)\b/],
    ['harm', /\b(harm|hurt|hurts|wound(?:s|ed)?|injur(?:y|ed|es)|shot|shoots?|stab(?:s|bed)?|bleed(?:s|ing)?|blood|cut|broken|bruis(?:e|ed)|knocked|beaten|hit)\b/]
  ];

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function glyphFor(text) {
    var t = str(text).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return '';
    for (var i = 0; i < STEMS.length; i++) if (STEMS[i][1].test(t)) return STEMS[i][0];
    return 'warn';
  }

  function mk(doc, tag, attrs) {
    var e = doc.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }
  function clearGlyph(svg) {
    if (!svg || !svg.querySelectorAll) return;
    var old = svg.querySelectorAll('.b19-threat');
    for (var i = 0; i < old.length; i++) if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
  }
  /* a red badge in the top right corner of the room, with a plain white mark inside it (the badge is r, the marks are drawn on a 2r square) */
  function glyphSvg(doc, svg, box, kind) {
    clearGlyph(svg);
    if (KINDS.indexOf(kind) < 0) return null;
    var r = Math.max(Math.min(box.w, box.h) * 0.2, 2.4), cx = box.x + box.w - r * 1.15, cy = box.y + r * 1.15, sw = r * 0.16;
    var g = mk(doc, 'g', { 'class': 'b19-threat', 'data-glyph': kind, 'pointer-events': 'none', 'aria-hidden': 'true' });
    g.appendChild(mk(doc, 'circle', { cx: cx, cy: cy, r: r, fill: '#b3261e', stroke: '#14110e', 'stroke-width': sw }));
    var ink = { fill: 'none', stroke: '#fff6e8', 'stroke-width': sw * 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, p = function (d, extra) { g.appendChild(mk(doc, 'path', Object.assign({ d: d }, ink, extra || {}))); };
    var X = function (k) { return (cx + k * r).toFixed(2); }, Y = function (k) { return (cy + k * r).toFixed(2); };
    if (kind === 'guard') {                       /* a head and shoulders with a turning arrow */
      g.appendChild(mk(doc, 'circle', { cx: X(-0.1), cy: Y(-0.3), r: r * 0.2, fill: '#fff6e8' }));
      p('M' + X(-0.5) + ' ' + Y(0.55) + ' q' + (0.4 * r).toFixed(2) + ' ' + (-0.6 * r).toFixed(2) + ' ' + (0.8 * r).toFixed(2) + ' 0');
      p('M' + X(0.3) + ' ' + Y(-0.55) + ' q' + (0.35 * r).toFixed(2) + ' ' + (0.05 * r).toFixed(2) + ' ' + (0.3 * r).toFixed(2) + ' ' + (0.4 * r).toFixed(2) + ' m' + (-0.12 * r).toFixed(2) + ' ' + (-0.02 * r).toFixed(2) + ' l' + (0.12 * r).toFixed(2) + ' ' + (0.02 * r).toFixed(2) + ' l' + (0.04 * r).toFixed(2) + ' ' + (-0.14 * r).toFixed(2));
    } else if (kind === 'door') {                 /* a padlock */
      g.appendChild(mk(doc, 'rect', { x: X(-0.45), y: Y(-0.05), width: (0.9 * r).toFixed(2), height: (0.65 * r).toFixed(2), fill: '#fff6e8', rx: r * 0.08 }));
      p('M' + X(-0.28) + ' ' + Y(-0.05) + ' v' + (-0.2 * r).toFixed(2) + ' a' + (0.28 * r).toFixed(2) + ' ' + (0.28 * r).toFixed(2) + ' 0 0 1 ' + (0.56 * r).toFixed(2) + ' 0 v' + (0.2 * r).toFixed(2));
    } else if (kind === 'alarm') {                /* a bell */
      p('M' + X(-0.5) + ' ' + Y(0.35) + ' q' + (0.1 * r).toFixed(2) + ' ' + (-0.2 * r).toFixed(2) + ' ' + (0.1 * r).toFixed(2) + ' ' + (-0.5 * r).toFixed(2) + ' a' + (0.3 * r).toFixed(2) + ' ' + (0.3 * r).toFixed(2) + ' 0 0 1 ' + (0.6 * r).toFixed(2) + ' 0 q0 ' + (0.3 * r).toFixed(2) + ' ' + (0.1 * r).toFixed(2) + ' ' + (0.5 * r).toFixed(2) + ' z', { fill: '#fff6e8' });
      p('M' + X(-0.12) + ' ' + Y(0.55) + ' h' + (0.24 * r).toFixed(2));
    } else if (kind === 'harm') {                 /* a cross */
      p('M' + X(0) + ' ' + Y(-0.55) + ' v' + (1.1 * r).toFixed(2) + ' M' + X(-0.55) + ' ' + Y(0) + ' h' + (1.1 * r).toFixed(2), { 'stroke-width': sw * 2.2 });
    } else {                                      /* warn: an exclamation mark */
      p('M' + X(0) + ' ' + Y(-0.55) + ' v' + (0.65 * r).toFixed(2), { 'stroke-width': sw * 2.2 });
      g.appendChild(mk(doc, 'circle', { cx: X(0), cy: Y(0.5), r: r * 0.12, fill: '#fff6e8' }));
    }
    svg.appendChild(g);
    return g;
  }

  function create(host) {
    host = host || {};
    var cur = null, frameRef = null, svgRef = null, zoomRef = null;       /* cur: { room, kind } while a stamp's glyph is down */
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function repaint() { if (frameRef && svgRef) paint(frameRef, svgRef, zoomRef); }

    /* the stamp went up: { position, effect, text } */
    function drop(st) {
      if (!on()) return null;
      var kind = glyphFor(st && st.text), room = typeof host.room === 'function' ? str(host.room()) : '';
      if (!kind || !room) { cur = null; repaint(); return null; }
      cur = { room: room, kind: kind };
      if (typeof host.log === 'function') host.log('Threat on the map: ' + kind + ' in ' + room);
      repaint();
      return { room: room, kind: kind };
    }
    function clear() { var had = !!cur; cur = null; repaint(); return had; }
    function view() { return cur ? { room: cur.room, kind: cur.kind } : null; }
    function paint(frame, svg, zoom) {
      frameRef = frame; svgRef = svg; zoomRef = zoom || null;
      if (!svg) return;
      var box = on() && cur && typeof host.roomBox === 'function' ? host.roomBox(svg, cur.room) : null;
      if (box && typeof host.doc === 'function') glyphSvg(host.doc(), svg, box, cur.kind); else clearGlyph(svg);
    }
    return { drop: drop, clear: clear, view: view, paint: paint };
  }

  return { SWITCH: SWITCH, KINDS: KINDS, glyphFor: glyphFor, glyphSvg: glyphSvg, clearGlyph: clearGlyph, create: create };
});
