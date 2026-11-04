/* display/lookbook-faces.js — the look book's cards for the face looks (suite 3.2, 3.3, 3.4). GM only: it is listed in the `lookbook` bundle and nowhere else.

   Window.B68LookbookFaces. Two cards of fixture data, drawn by the same renderer the iPad uses (display/face-render.js) on invented figures from the figure kit:
     faces-expressions   the five expressions (neutral, pleased, hostile, afraid, a tell) on one person
     faces-formats       the five portrait formats, each with a badge, in the faction's duotone
   cards() -> [{ kind, label, fixture }]      frame(kind, host) draws one card's frame (the look book's iframe)
   The people are invented (the Pelican Rooms cast). Nothing here is fetched. */
(function (root) {
  'use strict';
  var SPECS = {
    mabel: { id: 'lb-mabel', seed: 11, figure: 'fem', age: 'adult', face: { brows: 'arched' } },
    dov: { id: 'lb-dov', seed: 42, figure: 'masc', build: 'average', age: 'adult', hair: { style: 'short', color: '#3a2a1c' } },
    ada: { id: 'lb-ada', seed: 77, figure: 'masc', age: 'old', face: {} }
  };
  var PEOPLE = [
    { id: 'n-mabel', name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', spec: SPECS.mabel },
    { id: 'n-dov', name: 'Dov Kessler', alias: '', role: 'Desk sergeant', faction: 'The Tidewater Watch', spec: SPECS.dov },
    { id: 'n-ada', name: 'Ada Vell', alias: '', role: 'Croupier', faction: 'The Kestrel Club', spec: SPECS.ada }
  ];
  var EXPR = ['neutral', 'pleased', 'hostile', 'afraid', 'smirk'];
  var FMT = ['licence', 'badge', 'mugshot', 'society', 'passport'];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svgNode(svg) {
    var d = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    d.removeAttribute('width'); d.removeAttribute('height');
    return document.importNode(d, true);
  }
  function cards() {
    return [
      { kind: 'faces-expressions', label: 'Faces: five expressions (face.expressions)', fixture: { person: 'Mabel Quist', looks: EXPR.map(function (e) { return { expr: e }; }), note: 'afraid is registered from the kit’s own parts; the last is a tell (Tell: smirk in the person’s notes)' } },
      { kind: 'faces-formats', label: 'Faces: five portrait formats with a badge (face.formats, face.badge)', fixture: { person: 'Ada Vell', looks: FMT.map(function (f) { return { fmt: f }; }), note: 'chosen by a Relation: line in the notes; the duotone is the faction colour' } }
    ];
  }
  function one(p, look, i, flags) {
    var K = root.B68Figure, R = root.B68FaceRender, FL = root.B68FaceLook;
    var e = el('div', 'dp-ov-card dp-ov-npc dp-ov-in');
    e.style.position = 'static'; e.style.transform = 'none'; e.style.opacity = '1'; e.style.width = 'auto'; e.style.flex = 'none'; e.style.maxHeight = 'none';
    var holder = el('div', 'dp-ov-portrait'), r = K.portrait(Object.assign({}, p.spec, { id: 'lb-plain-' + i }), { lod: 'mid' });
    holder.appendChild(svgNode(r.svg)); e.appendChild(holder);
    e.appendChild(el('p', 'dp-kicker', [p.role, p.faction].join(' · '))); e.appendChild(el('p', 'dp-ov-name', p.name));
    var env = { document: document, K: K, features: flags, reduced: true, later: function () { return 0; }, ducked: function () { return false; }, motif: { plan: function () { return null; }, play: function () { return false; } },
      portrait: function (spec, id) { var s = JSON.parse(JSON.stringify(spec)); s.id = id; return svgNode(K.portrait(s, { lod: 'mid' }).svg); },
      figure: function (spec, id) { var s = JSON.parse(JSON.stringify(spec)); s.id = id; return svgNode(K.render(s, { height: 900 }).svg); } };
    R.apply(e, { kind: 'npc', name: p.name, alias: p.alias, sub: '', spec: p.spec }, { id: 'lb-' + i, npcId: p.id, npc: { faction: p.faction, role: p.role }, look: FL.clean(look) }, env);
    return e;
  }
  function frame(kind, host) {
    if (!root.B68Figure || !root.B68FaceRender || !root.B68FaceLook) { host.appendChild(el('p', 'lb-denied', 'The figure kit is not loaded.')); return; }
    var row = el('div', 'lb-faces'); row.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;gap:6px;justify-content:center;align-items:flex-start;zoom:.54';
    var fmt = kind === 'faces-formats', list = fmt ? FMT : EXPR, flags = fmt ? { 'face.formats': true, 'face.badge': true } : { 'face.expressions': true };
    list.forEach(function (x, i) {
      var w = el('div', 'lb-face'); w.style.cssText = 'width:300px';
      w.appendChild(one(fmt ? PEOPLE[2] : PEOPLE[0], fmt ? { fmt: x } : { expr: x }, i, flags));
      row.appendChild(w);
    });
    host.appendChild(row);
  }
  root.B68LookbookFaces = { cards: cards, frame: frame, PEOPLE: PEOPLE };
})(typeof window !== 'undefined' ? window : globalThis);
