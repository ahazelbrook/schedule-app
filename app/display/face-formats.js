/* display/face-formats.js — the portrait formats (suite 3.3, switch face.formats).

   Window.B68FaceFormats, and module.exports under Node. The same drawn face as a driver's licence, a security badge, a mugshot with a placard, a society-page halftone or a passport, in a
   duotone of the faction's colour. face-render.js calls wrap() once for a held NPC card whose `look` names a format (the GM page works the name out from the person's Relation: line).
   Built with createElement/createElementNS and textContent only; the portrait it frames is the one the page already drew and cleaned.

   wrap(doc, e, holder, parts) -> frame node     the holder (the card's portrait box) moves into the frame, and the frame takes its place in the card e
       parts: { name, role, faction, id, num ('' unless the badge switch is on), slot (the faction's colour slot, 0 for none), uid, glyph (a node or null) }
   frame(doc, fmt, parts) -> node      duotone(doc, slot, uid) -> { svg, id }      FMTS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68FaceFormats = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var FL = root.B68FaceLook || (typeof require === 'function' ? tryRequire('./face-look.js') : null);
  function tryRequire(p) { try { return require(p); } catch (e) { return null; } }
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function svgEl(doc, tag, attrs) {
    var e = doc.createElementNS ? doc.createElementNS(SVGNS, tag) : doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }
  function safe(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, ''); }
  function rgb(hex) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128]; }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }

  /* the duotone filter for a faction colour: the picture's light goes to a pale tint of the colour, its dark to a deep one */
  function duotone(doc, slot, uid) {
    var c = FL.colours(slot), f = rgb(c[0]), dark = mix(f, [20, 17, 14], 0.6), light = mix(f, [251, 248, 241], 0.7), id = 'dp-fl-duo-' + safe(uid);
    var svg = svgEl(doc, 'svg', { width: 0, height: 0, class: 'dp-fl-defs', 'aria-hidden': 'true', focusable: 'false' });
    var flt = svgEl(doc, 'filter', { id: id, 'color-interpolation-filters': 'sRGB' });
    flt.appendChild(svgEl(doc, 'feColorMatrix', { type: 'matrix', values: '0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 1 0' }));
    var tr = svgEl(doc, 'feComponentTransfer', {});
    ['R', 'G', 'B'].forEach(function (ch, i) { tr.appendChild(svgEl(doc, 'feFunc' + ch, { type: 'table', tableValues: (dark[i] / 255).toFixed(3) + ' ' + (light[i] / 255).toFixed(3) })); });
    flt.appendChild(tr); svg.appendChild(flt);
    return { svg: svg, id: id };
  }
  /* a barcode-like row of bars, stable for the person (the badge format's strip) */
  function bars(doc, seed) {
    var s = svgEl(doc, 'svg', { viewBox: '0 0 60 8', class: 'dp-fl-bars', 'aria-hidden': 'true' }), h = FL.hash('bars:' + seed), x = 1;
    for (var i = 0; i < 20 && x < 58; i++) { var w = 1 + ((h >>> (i % 28)) & 1) + (i % 3 === 0 ? 1 : 0); s.appendChild(svgEl(doc, 'rect', { x: x, y: 0, width: w, height: 8 })); x += w + 1 + ((h >>> ((i + 5) % 28)) & 1); }
    return s;
  }
  function mrz(name, id) {
    var up = String(name || '').toUpperCase().replace(/[^A-Z ]/g, '').trim().split(/\s+/).join('<'), n = FL.numberOf(id).replace(/\D/g, '');
    var line = function (s) { return (s + '<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<').slice(0, 30); };
    return [line('P<' + up), line(n + '<<' + FL.hash('mrz:' + id) % 10000)];
  }

  function frame(doc, fmt, parts) {
    var f = el(doc, 'div', 'dp-fl dp-fl-' + fmt + (parts.slot ? ' dp-fl-c' + parts.slot : '')), photo = el(doc, 'div', 'dp-fl-photo');
    photo.appendChild(parts.holder);
    var txt = el(doc, 'div', 'dp-fl-txt'), who = parts.name;
    if (fmt === 'licence') {
      f.appendChild(el(doc, 'p', 'dp-fl-head', 'Licence'));
      f.appendChild(photo);
      txt.appendChild(el(doc, 'p', 'dp-fl-field', who)); if (parts.role) txt.appendChild(el(doc, 'p', 'dp-fl-sub', parts.role));
      if (parts.num) txt.appendChild(el(doc, 'p', 'dp-fl-num', parts.num));
    } else if (fmt === 'badge') {
      f.appendChild(el(doc, 'span', 'dp-fl-hole'));
      f.appendChild(el(doc, 'p', 'dp-fl-head', parts.faction || 'Security'));
      f.appendChild(photo);
      txt.appendChild(el(doc, 'p', 'dp-fl-field', who)); if (parts.role) txt.appendChild(el(doc, 'p', 'dp-fl-sub', parts.role));
      txt.appendChild(bars(doc, parts.id)); if (parts.num) txt.appendChild(el(doc, 'p', 'dp-fl-num', parts.num));
    } else if (fmt === 'mugshot') {
      f.appendChild(photo);
      var pl = el(doc, 'div', 'dp-fl-placard');
      pl.appendChild(el(doc, 'p', 'dp-fl-num', parts.num || parts.faction || 'File'));
      pl.appendChild(el(doc, 'p', 'dp-fl-sub', who));
      f.appendChild(pl);
    } else if (fmt === 'society') {
      f.appendChild(photo);
      txt.appendChild(el(doc, 'p', 'dp-fl-field', who)); if (parts.role) txt.appendChild(el(doc, 'p', 'dp-fl-sub', parts.role));
    } else {
      f.appendChild(el(doc, 'p', 'dp-fl-head', 'Passport'));
      f.appendChild(photo);
      txt.appendChild(el(doc, 'p', 'dp-fl-field', who));
      mrz(who, parts.id).forEach(function (l) { txt.appendChild(el(doc, 'p', 'dp-fl-mrz', l)); });
      f.appendChild(el(doc, 'span', 'dp-fl-stamp', parts.faction ? parts.faction.slice(0, 14) : 'Entered'));
    }
    if (txt.children && txt.children.length) f.appendChild(txt);
    return f;
  }

  function wrap(doc, e, holder, fmt, parts) {
    var sib = e.children ? Array.prototype.slice.call(e.children) : [], ref = sib[sib.indexOf(holder) + 1] || null;
    if (holder.parentNode) holder.parentNode.removeChild(holder);
    var d = duotone(doc, parts.slot, parts.uid), fr = frame(doc, fmt, Object.assign({ holder: holder }, parts));
    if (holder.style) holder.style.filter = 'url(#' + d.id + ')';
    fr.appendChild(d.svg);
    if (parts.glyph) fr.appendChild(parts.glyph);
    if (ref) e.insertBefore(fr, ref); else e.appendChild(fr);       /* the frame goes where the holder was (the holder now sits inside it) */
    e.className += ' dp-fl-framed';
    return fr;
  }

  return { FMTS: ['licence', 'badge', 'mugshot', 'society', 'passport'], frame: frame, duotone: duotone, wrap: wrap };
});
