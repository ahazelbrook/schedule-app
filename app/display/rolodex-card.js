/* display/rolodex-card.js — the Rolodex as a lower third (suite ticket 3.5, switch face.rolodex).

   Window.B68RolodexCard, and module.exports under Node. With the switch on, the `rolodex` brief beat (app/display/show-beats.js) is drawn as a card that
   flips up from the bottom of the screen instead of a row of full-screen cards: a face, the name, the alias in quotes, then role and faction. The beat's
   payload is the SERVED one, already joined to revealed NPCs only (functions/_lib/show.js), so a hidden NPC never reaches this file. Every string is set
   with textContent; the face is the figure kit's head-and-shoulders passed through the page's SVG cleaner (env.portrait), or a monogram when there is none.

   on(env) -> bool          the switch is on (env.features is the look book's way to say so; otherwise B68Flags, as the iPad reads it)
   build(payload, env, parts) -> node      parts: { doc, n } from show-beats (the beat's root node, already classed)
   At most three cards stand at once; a longer list shows its first three. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68RolodexCard = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var MAX = 3;
  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function on(env) {
    if (env && env.features && env.features['face.rolodex'] === true) return true;
    return !!(root.B68Flags && typeof root.B68Flags.on === 'function' && root.B68Flags.on('face.rolodex'));
  }
  function build(p, env, parts) {
    var doc = parts.doc, n = parts.n, list = p && Array.isArray(p.npcs) ? p.npcs.slice(0, MAX) : [];
    n.className += ' dp-rc';
    list.forEach(function (c, i) {
      var card = el(doc, 'div', 'dp-rc-card'); card.style.setProperty('--i', String(i));
      var face = el(doc, 'div', 'dp-rc-face'), drawn = null;
      if (c.spec && env && typeof env.portrait === 'function') { try { drawn = env.portrait(c.spec, c.npcId); } catch (e) { drawn = null; } }
      if (drawn) face.appendChild(drawn); else face.appendChild(el(doc, 'span', 'dp-rc-mono', c.name.charAt(0)));
      card.appendChild(face);
      var txt = el(doc, 'div', 'dp-rc-txt');
      txt.appendChild(el(doc, 'p', 'dp-rc-name', c.name));
      if (c.alias) txt.appendChild(el(doc, 'p', 'dp-rc-alias', '“' + c.alias + '”'));
      var sub = [c.role, c.faction].filter(Boolean).join(' · ');
      if (sub) txt.appendChild(el(doc, 'p', 'dp-rc-sub', sub));
      card.appendChild(txt);
      n.appendChild(card);
    });
    return n;
  }
  return { MAX: MAX, on: on, build: build };
});
