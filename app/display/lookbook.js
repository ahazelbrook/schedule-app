/* The look book's script (app/lookbook.html, suite F6). GM only; app/lookbook-boot.js checks /api/me before it loads this.
   run(root) draws one card per registered show kind (B68Shows.entries(): label, fixture) at iPad size, plus one for the lasting layers.
   Each card is a frame at 1024 x 768 CSS px: an iframe of this same page in frame mode (lookbook.html?frame=<kind>), so the viewport units the
   beats are set in resolve against the iPad's size, not the window's; the card scales the frame down to fit a laptop or a phone.
   A later bundle adds its kinds by registering them with B68Shows and listing its renderer file in the `lookbook` bundle (app/routes.js);
   its entry then appears here with its own fixture and nothing else to change. */
(function (root) {
  'use strict';
  var W = 1024, H = 768;
  var LAYERS_DEMO = {
    band: { phase: 'plan', security: 2, faces: [{ name: 'Mabel Quist', role: 'Fixer' }, { name: 'Dov Kessler', role: 'Desk sergeant' }, { pcId: 'pc-nell', name: 'Nell Arbuthnot', stress: 4, harm: [1, 2], locks: 1 }], onair: true },
    scene: { filter: 'flashback' }
  };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* frame mode: ?frame=<kind> | layers. One beat at the viewport's own size (the card's iframe is 1024 x 768). */
  function frame(kind, host) {
    document.body.className = 'lb-frame';
    host.textContent = '';
    var stage = el('div', 'lb-stage'), layer = el('div', 'lb-layer dp-overlay');
    host.appendChild(stage);
    if (kind === 'layers') {
      var box = el('div', 'dp-root'); box.style.position = 'absolute'; box.style.inset = '0'; box.style.background = 'transparent';
      var amb = el('div', 'dp-ambient'); amb.style.background = 'transparent'; box.appendChild(amb);
      amb.appendChild(el('div', 'lb-stage'));
      host.appendChild(box);
      if (root.B68Layers) root.B68Layers.attach(box, { skew: function () { return 0; } }).apply(LAYERS_DEMO);
      return;
    }
    host.appendChild(layer);
    var e = root.B68Shows.entry(kind);
    if (!e) return;
    var at = +new URLSearchParams(location.search).get('i'), fx = e.fixtures && e.fixtures[at] ? e.fixtures[at].fixture : e.fixture;   /* a kind with several looks (the Aftermath's steps) has `fixtures` */
    root.B68Shows.mount({ kind: kind, payload: fx }, { document: document, reduced: false, features: { 'face.rolodex': true } }).then(function (node) {
      if (!node) return;
      layer.appendChild(node);
      setTimeout(function () { node.classList.add('dp-ov-in'); }, 30);
    });
  }

  function card(kind, label, fixture, at) {
    var fig = el('figure', 'lb-card'), cap = el('figcaption', '', label);
    cap.appendChild(document.createTextNode(' ')); cap.appendChild(el('code', '', kind));
    var box = el('div', 'lb-box'), f = document.createElement('iframe');
    f.src = 'lookbook.html?frame=' + encodeURIComponent(kind) + (at === undefined ? '' : '&i=' + at); f.title = label;
    box.appendChild(f); fig.appendChild(cap); fig.appendChild(box);
    if (fixture !== undefined) fig.appendChild(el('pre', 'lb-fixture', JSON.stringify(fixture, null, 1)));
    function fit() {
      var s = Math.min(1, (Math.min(window.innerWidth, 1100) - 48) / W);
      box.style.width = Math.round(W * s) + 'px'; box.style.height = Math.round(H * s) + 'px'; f.style.transform = 'scale(' + s + ')';
    }
    fit(); window.addEventListener('resize', fit);
    return fig;
  }

  function run(host) {
    var q = new URLSearchParams(location.search).get('frame');
    if (q) { frame(q, host); return; }
    host.textContent = '';
    var head = el('div', 'lb-head'); head.appendChild(el('h1', '', 'Look book'));
    head.appendChild(el('p', '', 'Every show kind the iPad can draw, with its fixture, at iPad size (1024 x 768, scaled to fit). Invented cast only. Rules text is never here.'));
    host.appendChild(head);
    var grid = el('div', 'lb-grid');
    root.B68Shows.entries().forEach(function (e) {
      if (e.fixtures) e.fixtures.forEach(function (x, i) { grid.appendChild(card(e.kind, x.label, x.fixture, i)); });
      else grid.appendChild(card(e.kind, e.label, e.fixture));
    });
    grid.appendChild(card('layers', 'Lasting layers', LAYERS_DEMO));
    host.appendChild(grid);
  }
  root.B68Lookbook = { run: run, size: { w: W, h: H }, LAYERS_DEMO: LAYERS_DEMO };
})(typeof window !== 'undefined' ? window : globalThis);
