/* display/montage.js — the montage on the table display (suite 2.8, switch map.montage).

   Window.B68DisplayMontage, and module.exports under Node. The data.montage layer (functions/_lib/show-montage.js) reaches the page through B68Layers.clean as
   `montage` (two to four panels, [] when unset); B68Layers calls paint() on every apply. paint() draws one panel per player character over the scene: a figure (the
   character's initial in a coloured disc), the place, and one line; a resolved panel carries a RESOLVED stamp. Unset or fewer than two panels removes it.
   Nothing here reads an NPC: the panels are player characters only. Every string reaches the page by textContent. Looks are in app/display/montage.css.
   THE PICTURE (the tech run, 06/11: each panel was a blank paper card with a small initial). The server joins each panel to its character's figure
   (functions/_lib/show.js, panel.spec) and the page hands paint() a drawer (opts.figure(spec, id) -> a cleaned svg node, display-page.js drawFigure): the
   panel's top is the PC standing on its own colour. A panel with no figure (no spec, or the kit would not draw it) keeps the initial, on that colour.

   paint(container, panels, doc?, opts?) -> the node or null       look book: FIXTURE (an invented cast, the Pelican Rooms) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68DisplayMontage = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var TONES = ['blue', 'mustard', 'alarm', 'green'];
  var FIXTURE = [
    { pcId: 'pc-nell', name: 'Nell Ashby', room: 'The Pelican Rooms bar', line: 'Charming the doorman with a borrowed name.' },
    { pcId: 'pc-ivo', name: 'Ivo Marsh', room: 'The cellar stairs', line: 'Counting the crates that should not be there.', done: true },
    { pcId: 'pc-tam', name: 'Tam Reyes', room: 'The roof', line: 'Watching the street for the second car.' }
  ];

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function initial(p) { var n = (p.name || p.pcId || '?').trim(); return n.charAt(0).toUpperCase() || '?'; }

  function picture(doc, p, opts) {
    var pic = el(doc, 'div', 'dp-mt-pic'), fig = null;
    pic.setAttribute('aria-hidden', 'true');
    if (p.spec && opts && typeof opts.figure === 'function') { try { fig = opts.figure(p.spec, p.pcId); } catch (e) { fig = null; } }
    if (fig) { pic.className += ' dp-mt-pic-fig'; pic.appendChild(fig); } else pic.appendChild(el(doc, 'div', 'dp-mt-fig', initial(p)));
    return pic;
  }
  function build(doc, panels, opts) {
    var n = el(doc, 'div', 'dp-montage dp-montage-' + panels.length);
    n.setAttribute('data-montage', String(panels.length));
    panels.forEach(function (p, i) {
      var card = el(doc, 'section', 'dp-mt-panel dp-mt-' + TONES[i % TONES.length] + (p.done ? ' dp-mt-done' : ''));
      if (card.style && card.style.setProperty) card.style.setProperty('--i', String(i));
      card.appendChild(picture(doc, p, opts));
      var txt = el(doc, 'div', 'dp-mt-txt');      /* the words take the same share of every panel, so the pictures line up */
      txt.appendChild(el(doc, 'h2', 'dp-mt-name', p.name || ''));
      if (p.room) txt.appendChild(el(doc, 'p', 'dp-mt-room', p.room));
      if (p.line) txt.appendChild(el(doc, 'p', 'dp-mt-line', p.line));
      card.appendChild(txt);
      if (p.done) card.appendChild(el(doc, 'p', 'dp-mt-stamp', 'RESOLVED'));
      n.appendChild(card);
    });
    return n;
  }
  function key(panels) { try { return JSON.stringify(panels); } catch (e) { return ''; } }

  function paint(container, panels, doc, opts) {
    if (!container) return null;
    var d = doc || container.ownerDocument || root.document, list = Array.isArray(panels) ? panels : [];
    var old = null, kids = container.children || container.childNodes || [];
    for (var i = 0; i < kids.length; i++) if (kids[i] && kids[i].className && (' ' + kids[i].className + ' ').indexOf(' dp-montage ') >= 0) { old = kids[i]; break; }
    if (list.length < 2 || list.length > 4) {
      if (old && old.parentNode) old.parentNode.removeChild(old);
      return null;
    }
    var k = key(list);
    if (old && old.getAttribute('data-key') === k) return old;      /* unchanged: leave it, so a poll never restarts its entrance */
    var n = build(d, list, opts);
    n.setAttribute('data-key', k);
    if (old && old.parentNode) { n.className += ' dp-montage-still'; old.parentNode.replaceChild(n, old); } else container.appendChild(n);
    return n;
  }
  return { paint: paint, build: build, FIXTURE: FIXTURE };
});
