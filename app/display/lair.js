/* display/lair.js — the lair that grows (suite ticket 5.4, switch between.lair): the crew's base as a cut-away section, a layer for each base upgrade, cohort and
   piece of flair. The pure half, shared by the GM page (which reads the crew sheet and builds the payload) and the iPad (which draws it from the payload alone).

   Window.B68Lair, and module.exports under Node. Deterministic: the same layers always make the same base. No model, no network. The drawing is map kit 1.0's
   section (display/lair-draw.js, which loads with the kit only when a lair is on the iPad); this file only decides WHAT is drawn.

   WHERE THE LAYERS COME FROM. The crew sheet (crewsheet.js) holds upgrades { name: boxes ticked } and cohorts [{ name, type, ... }]. Flair is not a field of the sheet:
   a crew.flair list is read when one exists, and the GM types the rest in the lair panel (gm/lair.js keeps them in the docs store). No rules text is here, only the
   sheet's own upgrade names.

   A layer is one short string on the wire (the show kind `lair`, functions/_lib/show-castphoto.js):  up:<upgrade>   co:<cohort name>   fl:<flair>
   What each adds to the section:
     base upgrades   Lounge and quarters (a ground-floor room), Van (a garage with a loading door), Workshop (first floor), Vault (basement), Secure (basement),
                     Hidden (attic), Boat (the canal front: water door, steps, boats)
     cohorts         a room each on the first floor (the first four; more are named in the caption)
     flair           a room each in the attic (the first two; more are named in the caption)
     other upgrades  (crew, training, kit) are named in the caption; they have no room of their own
   The Common room is always there: it is the base before anything is added.

   Pure API
     parse(layers) -> { upgrades, cohorts, flair }            layersOf(crew, extras) -> [layer strings] (at most 24)
     payloadOf(crew, st) -> { name, front, layers } | null    st: { name?, front?, flair: [text], hide: [layer] }
     rollOf(payload) -> a location roll for the map kit        placed(payload) -> { rooms: [name], notes: [text], held: [text] }
     captionOf(payload) -> [text]                              BASE_UPGRADES */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Lair = M;
  if (root && root.B68Shows && typeof M.register === 'function') M.register(root.B68Shows);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var MAX_LAYERS = 24, COMMON = 'Common room';
  var BASE_UPGRADES = ['Lounge and quarters', 'Workshop', 'Vault', 'Secure', 'Hidden', 'Van', 'Boat'];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clip(s, n) { var t = str(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).trim() : t; }

  /* ---- the crew sheet to layers ---- */
  function held(crew) { var u = isObj(crew) && isObj(crew.upgrades) ? crew.upgrades : {}; return Object.keys(u).filter(function (k) { return +u[k] > 0; }); }
  function flairOf(crew) {
    var f = isObj(crew) ? crew.flair : null, out = [];
    (Array.isArray(f) ? f : []).forEach(function (x) { var t = clip(isObj(x) ? x.name : x, 56); if (t) out.push(t); });
    return out;
  }
  function cohortName(c) { return clip(isObj(c) ? (c.name || (c.type ? c.type + ' cohort' : '')) : '', 56); }
  function layersOf(crew, extras) {
    var ex = isObj(extras) ? extras : {}, out = [], seen = {};
    function add(s) { if (s.length > 3 && !seen[s]) { seen[s] = 1; out.push(s); } }
    var names = held(crew), hide = Array.isArray(ex.hide) ? ex.hide.map(str) : [];
    BASE_UPGRADES.forEach(function (n) { if (names.indexOf(n) >= 0) add('up:' + n); });
    (isObj(crew) && Array.isArray(crew.cohorts) ? crew.cohorts : []).forEach(function (c) { var n = cohortName(c); if (n) add('co:' + n); });
    flairOf(crew).concat((Array.isArray(ex.flair) ? ex.flair : []).map(function (x) { return clip(x, 56); })).forEach(function (t) { if (t) add('fl:' + t); });
    /* the sheet's other upgrades: a "cohort" upgrade is the cohort it buys, already a room; the rest are named in the caption */
    names.forEach(function (n) { if (BASE_UPGRADES.indexOf(n) < 0 && !/\bcohort$/i.test(n)) add('up:' + clip(n, 56)); });
    return out.filter(function (l) { return hide.indexOf(l) < 0; }).slice(0, MAX_LAYERS);
  }
  function payloadOf(crew, st) {
    var s = isObj(st) ? st : {}, layers = layersOf(crew, s), c = isObj(crew) ? crew : {};
    var name = clip(s.name || c.name || c.base || 'The base', 60) || 'The base';
    var front = s.front === 'canal' || s.front === 'street' ? s.front : (layers.indexOf('up:Boat') >= 0 ? 'canal' : 'street');
    return { name: name, front: front, layers: layers.length ? layers : ['bare:base'] };   /* the wire wants a layer: a bare base says so, and draws the Common room alone */
  }
  function parse(layers) {
    var o = { upgrades: [], cohorts: [], flair: [] };
    (Array.isArray(layers) ? layers : []).forEach(function (l) {
      var s = str(l), k = s.slice(0, 3), v = s.slice(3);
      if (!v) return;
      if (k === 'up:') o.upgrades.push(v); else if (k === 'co:') o.cohorts.push(v); else if (k === 'fl:') o.flair.push(v);
    });
    return o;
  }

  /* ---- what is drawn ---- */
  var FLOORS = {
    '-1': { x: 0, y: 0, w: 48, d: 56, h: 11 }, '0': { x: 0, y: 0, w: 72, d: 56, h: 18 }, '1': { x: 0, y: 0, w: 72, d: 56, h: 14 }, '2': { x: 0, y: 24, w: 48, d: 32, h: 12 }
  };
  var COHORT_AT = [[24, 0, 24, 28], [48, 0, 24, 28], [24, 28, 24, 28], [48, 28, 24, 28]];
  var FLAIR_AT = [[24, 24, 12, 32], [36, 24, 12, 32]];
  function uniq(used, name) { var n = name, i = 2; while (used[n.toLowerCase()]) n = name + ' ' + i++; used[n.toLowerCase()] = 1; return n; }

  /* the rooms, their floors and the held-but-roomless lines, from a payload */
  function plan(payload) {
    var L = parse(payload && payload.layers), up = L.upgrades, used = {}, rooms = [], notes = [], heldLines = [];
    used[COMMON.toLowerCase()] = 1;
    function has(n) { return up.indexOf(n) >= 0; }
    rooms.push({ name: COMMON, band: 'public', detail: 'Where the crew meets.', lvl: 0, at: has('Van') ? [24, 0, 36, 56] : [24, 0, 48, 56], scale: 'grand', arch: 'lounge' });
    function add(name, lvl, at, scale, detail, arch) { var n = uniq(used, name); rooms.push({ name: n, band: 'public', detail: detail || '', lvl: lvl, at: at.slice(), scale: scale || 'service', arch: arch }); return n; }
    if (has('Lounge and quarters')) add('Lounge and quarters', 0, [0, 0, 24, 40], 'grand', '', 'bedroom');
    if (has('Van')) add('Garage', 0, [60, 0, 12, 56], 'service', '', 'garage');
    if (has('Workshop')) add('Workshop', 1, [0, 0, 24, 40], 'service', '', 'workshop');
    if (has('Vault')) add('Vault', -1, [0, 0, 48, 40], 'service', '', 'vault');
    if (has('Secure')) add('Secure rooms', -1, [24, 40, 24, 16], 'service', '', 'panic');
    if (has('Hidden')) add('Hidden room', 2, [0, 24, 24, 16], 'service', '', 'attic');
    L.cohorts.forEach(function (c, i) { if (i < COHORT_AT.length) add(c, 1, COHORT_AT[i], 'service', '', 'den'); else notes.push(c + ' (cohort)'); });
    L.flair.forEach(function (f, i) { if (i < FLAIR_AT.length) add(f.length > 22 ? f.slice(0, 22).trim() : f, 2, FLAIR_AT[i], 'service', f, 'gallery'); else notes.push(f + ' (flair)'); });
    up.forEach(function (n) { if (BASE_UPGRADES.indexOf(n) < 0) heldLines.push(n); });
    if (has('Boat')) heldLines.push('Boat');
    return { rooms: rooms, notes: notes, held: heldLines, up: up };
  }
  function placed(payload) { var p = plan(payload); return { rooms: p.rooms.map(function (r) { return r.name; }), notes: p.notes, held: p.held }; }
  function captionOf(payload) {
    var p = plan(payload), out = [];
    if (p.held.length) out.push('Fitted out: ' + p.held.join(', '));
    if (p.notes.length) out.push('Also: ' + p.notes.join(', '));
    return out;
  }

  /* a location roll for the map kit (kit 1.0, built by hand: floors, a core, a stair and the faces) */
  function rollOf(payload) {
    var p = plan(payload), rooms = p.rooms, name = clip(payload && payload.name, 60) || 'The base';
    var lv = {}; rooms.forEach(function (r) { lv[r.lvl] = 1; });
    var floors = {}; Object.keys(lv).forEach(function (k) { floors[k] = Object.assign({}, FLOORS[k]); });
    var canal = payload && payload.front === 'canal';
    var faces = [];
    if (p.up.indexOf('Van') >= 0) faces.push({ kind: 'loading-door', room: 'Garage' });
    if (canal) { faces.push({ kind: 'water-door', room: COMMON }, { kind: 'water-steps', room: COMMON }); if (p.up.indexOf('Boat') >= 0) faces.push({ kind: 'boats', room: COMMON }); }
    var build = { style: 'palazzo', front: canal ? 'canal' : 'street', core: [0, 40, 24, 16], floors: floors };
    if (lv[1]) build.stair = { room: COMMON, to: 1 };
    if (faces.length) build.faces = faces;
    return {
      name: name, district: 'The crew’s ward', kit: 1, build: build, rooms: rooms, areas: rooms.map(function (r) { return r.name; }), skips: [], auth: name, seed: 1,
      vectors: [{ n: 'The front', how: 'The way in.', know: 'free', room: COMMON, level: 'street', means: 'door' }]
    };
  }

  /* ---- the show kind: registered with a bundle, so the kit loads only when a lair is shown ---- */
  function cleanPayload(C, p) {
    var name = C.text(p.name, 60); if (!name) return null;
    var layers = Array.isArray(p.layers) ? p.layers.map(function (x) { return C.text(x, 60); }).filter(Boolean).slice(0, MAX_LAYERS) : [];
    if (!layers.length) return null;
    var out = { name: name, layers: layers }, f = C.oneOf(p.front, ['canal', 'street']); if (f) out.front = f;
    return out;
  }
  var FIXTURE = { name: 'The Pelican Rooms', front: 'canal', layers: ['up:Lounge and quarters', 'up:Workshop', 'up:Vault', 'up:Boat', 'up:Hidden', 'co:The Floor Crew', 'co:Night Porters', 'fl:A brass-rail bar', 'up:Documents', 'up:Gear'] };
  var spec = null;
  function register(S) {
    spec = { label: 'The lair', ms: 180000, bundle: 'lair', fixture: FIXTURE, clean: function (p) { return cleanPayload(S.C, p); } };
    S.register('lair', spec);
  }
  function setRender(fn) { if (spec) spec.render = fn; }

  return { MAX_LAYERS: MAX_LAYERS, COMMON: COMMON, BASE_UPGRADES: BASE_UPGRADES, parse: parse, layersOf: layersOf, payloadOf: payloadOf, plan: plan, placed: placed, captionOf: captionOf, rollOf: rollOf,
    cleanPayload: cleanPayload, register: register, setRender: setRender, FIXTURE: FIXTURE };
});
