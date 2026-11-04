/* display/face-badge.js — a badge, a style and a motif for a held NPC card (suite 3.4, switch face.badge).

   Window.B68FaceBadge, and module.exports under Node. Everything is worked out on the iPad from the NPC id and the faction already served, so it adds no field and no read.
     THE BADGE  a stable number (No. 417, from the id) and a faction glyph (one of eight, from the faction's name), drawn in the faction's colour.
     THE STYLE  the faction's colour on the card's edge, and its type and texture from the F6 tokens (app/tokens.css): STYLES gives each of the six colour slots one face and one texture
                (display/face-cards.css draws them). A faction takes its slot by name (face-look.js slotOf); a person with no faction has a number and no style.
     THE MOTIF  three to six seconds of notes made in the browser from the id and the faction's instrument (display/face-motif.js), played once when the spotlight first appears.
   Built with createElement/createElementNS and textContent only.

   info(faction, id) -> { slot, num, classes }       decorate(e, info)       glyph(doc, faction, slot) -> svg node       strip(doc, info, faction) -> node
   motif(env, id, slot, look) -> bool      plays the plan once unless the look says this is a renewed hold (look.re); false where the audio is not running
   STYLES  GLYPHS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68FaceBadge = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var FL = root.B68FaceLook || (typeof require === 'function' ? tryRequire('./face-look.js') : null);
  function tryRequire(p) { try { return require(p); } catch (e) { return null; } }
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* the faction slot's type and texture (the F6 tokens give the faces and the six colours; which face and which texture a faction wears is this table) */
  var STYLES = [null,
    { slot: 1, face: 'poster', texture: 'halftone' }, { slot: 2, face: 'cond', texture: 'stripes' }, { slot: 3, face: 'text', texture: 'grid' },
    { slot: 4, face: 'poster', texture: 'hatch' }, { slot: 5, face: 'cond', texture: 'dots' }, { slot: 6, face: 'text', texture: 'plain' }];
  /* eight small glyphs on a 24 by 24 grid: [tag, attributes] */
  var GLYPHS = [
    ['circle', { cx: 12, cy: 12, r: 8 }], ['path', { d: 'M12 3 L22 20 L2 20 Z' }], ['rect', { x: 4, y: 4, width: 16, height: 16 }], ['path', { d: 'M12 2 L22 12 L12 22 L2 12 Z' }],
    ['path', { d: 'M9 2 H15 V9 H22 V15 H15 V22 H9 V15 H2 V9 H9 Z' }], ['path', { d: 'M2 6 L12 14 L22 6 V12 L12 20 L2 12 Z' }],
    ['circle', { cx: 12, cy: 12, r: 8, 'stroke-width': 4, fill: 'none' }], ['path', { d: 'M3 4 H7 V20 H3 Z M10 4 H14 V20 H10 Z M17 4 H21 V20 H17 Z' }]];

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

  function info(faction, id) {
    var slot = FL.slotOf(faction), classes = '';
    if (slot) classes = ' dp-fl-styled dp-fl-st-' + slot + ' dp-fl-tx-' + STYLES[slot].texture + ' dp-fl-ty-' + STYLES[slot].face;
    return { slot: slot, num: FL.numberOf(id), classes: classes };
  }
  function decorate(e, i) { if (i.classes) e.className += i.classes; }
  function glyph(doc, faction, slot) {
    var g = GLYPHS[FL.glyphOf(faction)], c = FL.colours(slot);
    var s = svgEl(doc, 'svg', { viewBox: '0 0 24 24', class: 'dp-fl-glyph', 'aria-hidden': 'true' });
    var a = Object.assign({ fill: c[0], stroke: c[1], 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, g[1]);
    if (g[1].fill === 'none') a.stroke = c[0];
    s.appendChild(svgEl(doc, g[0], a));
    return s;
  }
  function strip(doc, i, faction) {
    var s = el(doc, 'div', 'dp-fl-tag');
    if (i.slot) s.appendChild(glyph(doc, faction, i.slot));
    s.appendChild(el(doc, 'span', 'dp-fl-tag-no', i.num));
    return s;
  }
  function motif(env, id, slot, look) {
    if (look && look.re) return false;
    var M = (env && env.motif) || root.B68FaceMotif;
    if (!M || typeof M.plan !== 'function' || typeof M.play !== 'function') return false;
    try { return !!M.play(M.plan(FL.hash('motif:' + id), slot), { ducked: env && env.ducked }); } catch (e) { return false; }
  }
  function unlock() { var M = root.B68FaceMotif; return !!(M && M.unlock && M.unlock()); }

  return { STYLES: STYLES, GLYPHS: GLYPHS, info: info, decorate: decorate, glyph: glyph, strip: strip, motif: motif, unlock: unlock };
});
