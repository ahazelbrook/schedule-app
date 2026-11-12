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
  /* THE BAND (the GM night rebuild, the design's iPad part): every slot at once, with the most marks a PC can carry and a long name, the lamp off the
     record, the AUTO chip and a beat under it; and the hard start, whose own plates show the faces while the band keeps only the lamp */
  var BAND_ALL = {
    band: { phase: 'after', security: 4, onair: true, faces: [
      { pcId: 'pc-nell', name: 'Nell Arbuthnot', stress: 9, harm: [1, 1, 2, 3], locks: 2 },
      { pcId: 'pc-ray', name: 'Ray Okonjo', stress: 2, harm: [2], acting: true },      /* KS14.2: the acting mark (the strip ignores it) */
      { pcId: 'pc-tam', name: 'Tamsin-Petronella Vandermeerholt', stress: 6, locks: 1 }] }
  };
  var BAND_START_FACES = [{ name: 'Mabel Quist', role: 'Fixer' }, { name: 'Dov Kessler', role: 'Desk sergeant' }, { name: 'Ada Vell', role: 'Croupier' }];
  /* a hard start past its fuse and credits: the "Previously on" plates, two of three revealed */
  function bandStart(now) {
    return { band: { faces: BAND_START_FACES.slice(0, 2) }, scene: { mode: 'start' },
      data: { countdown: { to: now - 60000, label: 'Station clock' }, previously: BAND_START_FACES } };
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  /* a display root as the iPad page builds one: the ambient floor, the stages and the beats' layer, with the band to come over them */
  function displayRoot(host) {
    var box = el('div', 'dp-root'); box.style.position = 'absolute'; box.style.inset = '0';
    var amb = el('div', 'dp-ambient'); amb.appendChild(el('div', 'lb-stage')); box.appendChild(amb);
    box.appendChild(el('div', 'dp-stages')); box.appendChild(el('div', 'dp-overlay'));
    host.appendChild(box);
    return box;
  }

  /* ---- the new stage's frame (KS13, kit.stage): the plate, the map caption, the idle stage and the three transitions, from app/display/kit/stage.js
     (the kit-lookbook bundle). Kinds stage-<what>-<paper|night>; each card is drawn at the iPad's three sizes. The idle stage's slots are filled
     here with kit parts, standing in for what KS14 (clock, crew), KS15 (the last roll) and KS16 (docked clocks) put there. Invented words only. */
  var STAGE_SIZES = [[1024, 768], [1180, 820], [768, 1024]];
  var STAGE_SCENE = 'ambient/duskwall-after-dark';
  var STAGE_WIRE = { kicker: 'Wire', title: 'The Pelican Rooms shuts its doors at midnight: the last tram leaves at ten to.', timer: 14000 };
  var STAGE_SVG = [['rect', { x: 20, y: 20, width: 560, height: 360, fill: '#1d2a44', stroke: '#e8c33c', 'stroke-width': 4 }],
    ['rect', { x: 60, y: 60, width: 220, height: 140, fill: '#2f4f7a' }], ['rect', { x: 320, y: 200, width: 220, height: 140, fill: '#7a4f2f' }]];
  /* KS14: the top band's fixture: the night's clock and NEXT, three heads (one a made-up 22-character name), Ray acting (the faces layer's acting mark) */
  var STAGE_BAND = { time: '21:14', next: [{ text: 'The band takes five', at: '21:30' }], crew: [{ name: 'Nell Arbuthnot' }, { name: 'Ray Okonjo' }, { name: 'Octavia Fennimore-Clay' }] };
  var STAGE_FACES = { faces: [{ pcId: 'pc-nell', name: 'Nell Arbuthnot', stress: 4 }, { pcId: 'pc-ray', name: 'Ray Okonjo', stress: 2, acting: true }, { pcId: 'pc-oct', name: 'Octavia Fennimore-Clay', stress: 7 }] };
  function stageCards() {
    var out = [];
    [['plate', 'Stage plate: the scene caption (the wire), timed'], ['map', 'Stage plate: the map caption'], ['idle', 'Idle stage: the slots filled']].forEach(function (k) {
      ['night', 'paper'].forEach(function (t) {
        STAGE_SIZES.forEach(function (sz) { out.push({ kind: 'stage-' + k[0] + '-' + t, label: k[1] + ' · ' + t + ' · ' + sz[0] + ' x ' + sz[1], w: sz[0], h: sz[1] }); });
      });
    });
    root.B68Stage.TRANSITIONS.filter(function (n) { return n !== 'cut'; }).forEach(function (n) {
      out.push({ kind: 'stage-tx' + n + '-night', label: 'Stage transition: ' + n + ' (it runs again every 3 seconds)', w: 1024, h: 768 });
    });
    return out;
  }
  function stageFrame(kind, host) {
    var m = /^stage-([a-z]+)-(paper|night)$/.exec(kind), St = root.B68Stage, U = root.B68Ui;
    if (!m || !St || !U) return;
    document.documentElement.setAttribute('data-theme', m[2] === 'paper' ? 'light' : 'dark');
    var dr = displayRoot(host), amb = dr.querySelector('.dp-ambient'), stages = dr.querySelector('.dp-stages');
    var art = document.createElement('iframe'); art.className = 'dp-amb-frame dp-amb-in'; art.src = STAGE_SCENE; art.title = 'The scene';
    amb.appendChild(art);
    var blank = el('div', 'dp-stage dp-blank dp-in'); stages.appendChild(blank);
    var wire = el('p', 'dp-wire'); amb.appendChild(wire);
    var F = St.attach(dr, { later: function (fn, ms) { return setTimeout(fn, ms); }, clearLater: clearTimeout, reduced: function () { return false; }, wireMs: function () { return STAGE_WIRE.timer; } });
    if (!F) return;
    var what = m[1];
    if (what === 'plate') F.lower(STAGE_WIRE);
    if (what === 'map') {
      var st = el('div', 'dp-stage dp-map dp-in'), fr = el('div', 'dp-map-frame'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 600 400');
      STAGE_SVG.forEach(function (r) { var n = document.createElementNS('http://www.w3.org/2000/svg', r[0]); Object.keys(r[1]).forEach(function (a) { n.setAttribute(a, r[1][a]); }); svg.appendChild(n); });
      fr.appendChild(svg); st.appendChild(fr);
      var dock = St.mapCaption({ title: 'The Pelican Rooms', caption: 'Ground floor: the cloakroom, the floor and the quiet side of the hall' }, document);
      st.appendChild(dock); stages.appendChild(st);
      F.next({ kind: 'svg', title: 'The Pelican Rooms' });
      F.swap(null, { el: st }, function () {});
      setTimeout(function () { fr.style.bottom = Math.ceil(dock.getBoundingClientRect().height) + 'px'; }, 0);
    }
    if (what === 'idle') {
      var put = function (slot, node) { if (node) F.slot(slot).appendChild(node); };
      if (root.B68StageBand) root.B68StageBand.attach(F, { band: function () { return STAGE_BAND; }, layers: function () { return STAGE_FACES; }, doc: document });      /* KS14: the clock and the heads */
      else { put('clock', U.node('chip', { label: '21:14 · Next 21:30' })); put('crew', U.node('chip', { label: 'Nell Arbuthnot · 4' })); }
      put('roll', U.node('chip', { label: 'Last roll · Nell · clean', tone: 'ok', dot: true }));
      put('clocks', U.node('meter', { kind: 'clock', label: 'Alarm', value: 2, max: 6, show: true, tone: 'alarm' }));
      put('clocks', U.node('meter', { kind: 'clock', label: 'Last tram', value: 3, max: 8, show: true }));
    }
    var tx = /^tx(push|wipe|alarm)$/.exec(what);
    if (tx) {
      var n = 0, old = { el: blank };
      var title = function (i) { return el('p', 'dp-kicker', i % 2 ? 'The second slide' : 'The first slide'); };
      var run = function () {
        n++;
        if (tx[1] === 'alarm') { F.mission({ alarm: { name: 'Alarm', size: 6, filled: 5 } }); F.mission({ alarm: { name: 'Alarm', size: 6, filled: 6 } }); return; }
        var ns = el('div', 'dp-stage dp-text'); ns.appendChild(title(n)); stages.appendChild(ns);
        F.next({ kind: tx[1] === 'wipe' ? 'svg' : 'text', title: tx[1] === 'wipe' ? 'The Pelican Rooms' : 'Slide ' + n });
        var gone = old; old = { el: ns };
        F.swap(gone, old, function (s) { if (s.el.parentNode) s.el.parentNode.removeChild(s.el); });
      };
      F.next({ kind: tx[1] === 'wipe' ? 'svg' : 'blank', title: tx[1] === 'wipe' ? 'The Pelican Rooms' : '' }); F.swap(null, old, function () {});
      F.mission(null);
      setInterval(run, 3000); setTimeout(run, 600);
    }
  }

  /* frame mode: ?frame=<kind> | layers. One beat at the viewport's own size (the card's iframe is 1024 x 768). */
  function frame(kind, host) {
    document.body.className = 'lb-frame';
    host.textContent = '';
    if (kind.indexOf('stage-') === 0) { stageFrame(kind, host); return; }      /* KS13: the new stage's frame */
    var stage = el('div', 'lb-stage'), layer = el('div', 'lb-layer dp-overlay');
    host.appendChild(stage);
    if (kind === 'layers') {
      var box = el('div', 'dp-root'); box.style.position = 'absolute'; box.style.inset = '0'; box.style.background = 'transparent';
      var amb = el('div', 'dp-ambient'); amb.style.background = 'transparent'; box.appendChild(amb);
      amb.appendChild(el('div', 'lb-stage'));
      host.appendChild(box);
      if (root.B68Flags) root.B68Flags.apply({ features: { 'map.flashback': true } });     /* suite 2.9: the flashback look (grain and the Earlier caption) in the look book */
      if (root.B68Layers) root.B68Layers.attach(box, { skew: function () { return 0; } }).apply(LAYERS_DEMO);
      return;
    }
    if (kind === 'band-all' || kind === 'band-start') {
      var dr = displayRoot(host), L = root.B68Layers ? root.B68Layers.attach(dr, { skew: function () { return 0; } }) : null;
      if (!L) return;
      if (kind === 'band-all') {
        L.apply(BAND_ALL);
        var off = root.B68OnAir ? root.B68OnAir.make({}) : null;
        if (off) { off.pause(4 * 60000 + 32000); off.paint(dr, true); }
        var chip = el('div', 'dp-auto', 'AUTO'); chip.setAttribute('aria-hidden', 'true'); dr.appendChild(chip);
        var rep = root.B68Shows.entry('report');
        if (rep) root.B68Shows.mount({ kind: 'report', payload: rep.fixture }, { document: document, reduced: true }).then(function (node) {
          if (!node) return; dr.querySelector('.dp-overlay').appendChild(node); node.classList.add('dp-ov-in');
        });
      } else {
        L.apply(bandStart(Date.now()));
        if (root.B68OnAir) root.B68OnAir.make({}).paint(dr, true);
        if (root.B68HardStart) root.B68HardStart.attach(dr, { layers: L });
      }
      return;
    }
    if (kind === 'montage') {      /* suite 2.8: the montage layer, drawn from the module's own fixture (invented cast) */
      var mb = el('div', 'dp-root'); mb.style.position = 'absolute'; mb.style.inset = '0'; host.appendChild(mb);
      if (root.B68DisplayMontage) root.B68DisplayMontage.paint(mb, root.B68DisplayMontage.FIXTURE, document);
      return;
    }
    if (kind.indexOf('faces-') === 0 && root.B68LookbookFaces) { root.B68LookbookFaces.frame(kind, host); return; }     /* suite 3.2-3.4: the face looks, drawn by the iPad's own renderer */
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

  /* fw x fh: the frame's own size (the new stage's cards come at the iPad's three sizes); 1024 x 768 when not given */
  function card(kind, label, fixture, at, fw, fh) {
    var fig = el('figure', 'lb-card'), cap = el('figcaption', '', label);
    cap.appendChild(document.createTextNode(' ')); cap.appendChild(el('code', '', kind));
    var box = el('div', 'lb-box'), f = document.createElement('iframe'), w = fw || W, h = fh || H;
    f.src = 'lookbook.html?frame=' + encodeURIComponent(kind) + (at === undefined ? '' : '&i=' + at); f.title = label;
    if (fw) { f.style.width = w + 'px'; f.style.height = h + 'px'; f.loading = 'lazy'; }      /* the stage's cards load as they scroll into view */
    box.appendChild(f); fig.appendChild(cap); fig.appendChild(box);
    if (fixture !== undefined) fig.appendChild(el('pre', 'lb-fixture', JSON.stringify(fixture, null, 1)));
    function fit() {
      var s = Math.min(1, (Math.min(window.innerWidth, 1100) - 48) / w);
      box.style.width = Math.round(w * s) + 'px'; box.style.height = Math.round(h * s) + 'px'; f.style.transform = 'scale(' + s + ')';
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
    grid.appendChild(card('band-all', 'Band: everything on', BAND_ALL));
    grid.appendChild(card('band-start', 'Band: hard start faces', bandStart(0)));
    if (root.B68LookbookFaces) root.B68LookbookFaces.cards().forEach(function (c) { grid.appendChild(card(c.kind, c.label, c.fixture)); });
    if (root.B68DisplayMontage) grid.appendChild(card('montage', 'Montage panels (layer data.montage)', { panels: root.B68DisplayMontage.FIXTURE }));
    if (root.B68Stage && root.B68Ui) stageCards().forEach(function (c) { grid.appendChild(card(c.kind, c.label, undefined, undefined, c.w, c.h)); });     /* KS13 */
    host.appendChild(grid);
  }
  root.B68Lookbook = { run: run, size: { w: W, h: H }, LAYERS_DEMO: LAYERS_DEMO, BAND_ALL: BAND_ALL, bandStart: bandStart };
})(typeof window !== 'undefined' ? window : globalThis);
