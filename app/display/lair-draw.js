/* display/lair-draw.js — draws the lair (suite ticket 5.4, switch between.lair) with map kit 1.0's section.

   Loads with the kit in the `lair` bundle (app/routes.js), after display/lair.js has registered the show kind with `bundle: 'lair'`: the iPad fetches the
   11,000-line map kit only when a lair is first put on it. The GM page (whose bundle already holds the kit) uses draw() for its own preview and its print.

   Window.B68LairDraw, and module.exports under Node (tests hand it the kit). draw(payload, kit?) -> { svg, warnings, caption: [text] } | null.
   The look is the map kit's rulebook theme at the iPad's layout, GM layer (the lair is the crew's own base: nothing in it is hidden from them), no legend.
   Every string in the node is set by textContent; the SVG is the kit's own, scrubbed again before it is put in the page. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68LairDraw = M;
  if (root && root.B68Lair && typeof root.B68Lair.setRender === 'function') root.B68Lair.setRender(function (p, env) { return M.render(p, env || {}); });
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function lib(name, path) { if (root && root[name]) return root[name]; try { return require(path); } catch (e) { return null; } }
  function scrub(s) { var P = lib('B68CastPhoto', './castphoto.js'); return P ? P.scrub(s) : ''; }

  function draw(payload, kit) {
    var L = lib('B68Lair', './lair.js'), K = kit || (root && root.B68Map);
    if (!L || !K || typeof K.render !== 'function' || !payload) return null;
    var roll = L.rollOf(payload), r;
    try { r = K.render(roll, { view: 'section', theme: 'rulebook', layer: 'gm', layout: 'ipad', legend: false, kit1: true }); } catch (e) { return null; }
    return { svg: r.svg, width: r.width, height: r.height, warnings: r.warnings || [], caption: L.captionOf(payload) };
  }
  function el(doc, tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null && text !== '') e.textContent = text; return e; }

  function render(p, env) {
    var doc = (env && env.document) || (root && root.document), d = draw(p);
    if (!d) return null;
    var n = el(doc, 'div', 'dp-show dp-show-lair');
    n.setAttribute('data-show', 'lair');
    if (env && env.reduced) n.setAttribute('data-reduced', '1');
    n.appendChild(el(doc, 'p', 'dp-show-kicker', 'The base'));
    n.appendChild(el(doc, 'p', 'dp-show-head', p.name));
    var holder = el(doc, 'div', 'dp-lair-section');
    holder.innerHTML = scrub(d.svg);
    n.appendChild(holder);
    d.caption.forEach(function (c) { n.appendChild(el(doc, 'p', 'dp-show-line dp-lair-cap', c)); });
    return n;
  }

  return { draw: draw, render: render };
});
