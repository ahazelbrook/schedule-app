/* gm/scenes.js — the district street-scene roller, as pure logic (no DOM, no storage, no network).
   A port of the vault page Tools/blades-68-district-scenes.md (generate(), ratings(), readAloud(), rows()). The tables
   are NOT in this file: they arrive from the GM pack (part `scenes`, field `T`). Plain script, UMD: window.B68GmScenes
   in the browser, module.exports under Node.

   generate() is ported statement for statement. The vault draws from one stream (Math.random, shadowed by a seeded
   mulberry32 while a roll replays), so here every draw comes from ONE seeded stream in the vault's order: the same
   { seed, mem, ui } over the same tables gives the same scene.

   The repeat-guard for a district's notables is keyed by the notable's name. The vault page keyed it by the notable
   ARRAY until 17/10/2026, which stops working the moment the memory is JSON-cloned (every sticky replay does that), so
   the guard never fired there; the page now keys it by name too. scripts/gm-parity.mjs --scenes patches an older copy
   of the page to match and compares everything else as is.

   ---------------------------------------------------------------------------------------------------------------
   API
   ---------------------------------------------------------------------------------------------------------------
   const sc = B68GmScenes.create({ T, mem })
       T     pack.parts.scenes.T (required): district[] (n, p, r[4], streets, named[], buildings, scene[], landmarks[],
             notables[[name, text, traits]], factions, special), weather{ <time of day>: [..] } (two keys: the first is
             the 1-in-2 draw, the second the other), streetType, streetSound, streetSmell, streetObstacle, buildingCommon,
             buildingRare, rumour (with %F%), faction, and ratingLabels[4].
       mem   optional repeat-guard memory ({ key: [recent values] }), kept by the instance between rolls
   sc.districts      the district names, in the vault's order
   sc.controls       [{ id:'sel', label:'District', type:'select', options:[{ label, value }] }]  ("anywhere" first)
   sc.defaults()     { sel: '' }
   sc.roll(ui, { seed, mem }) -> { scene, lines, meta, seed, replay }
       ui     { sel }  a district name, or '' for anywhere
       seed   uint32; omit for a fresh one
       mem    the repeat-guard memory to use and MUTATE (default: the instance's)
       replay { id:'scenes', seed, mem, ui }  mem is a deep copy BEFORE this roll. sc.replay(replay) redraws it.
       scene  the vault's own object: { d, timeOfDay, weather, street, streetType, sound, smell, obstacle, neighbour,
              beats[], landmark, who[name, text, traits], rumour }
       lines  [{ kind:'read', id:'look'|'build'|'beats', md }, { kind:'chips', id:'chips', chips }, { kind:'grid',
              id:'scene', title:'Around here', rows:[{ k, md }] }]   md is markdown, never HTML
       meta   { id:'scenes', title (district), sub (time of day · street · page), chips (ratings), text, all, label }
   sc.replay(replay)  redraw a stored roll (clones replay.mem for you)
   sc.mem()           the instance's live repeat-guard memory
   Helpers: B68GmScenes.seedRng(a) · plain(md)
   B68GmScenes.check(T) -> [string]   the table keys a pack is missing or has empty ('rumour', 'weather.<time of day>',
       'district.<name>.notables', …), for the page to show when a pack is loaded. Empty = the pack is complete.
       A district's `special` is optional.
   --------------------------------------------------------------------------------------------------------------- */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmScenes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function seedRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var clone = function (o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); };
  var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var lower = function (s) { return s.charAt(0).toLowerCase() + s.slice(1); };
  var cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
  function plain(s) {
    return String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
  }

  // ---- check(): the keys generate() and the card read, reported when missing or empty -----------------------------
  function check(T) {
    if (!isObj(T)) return ['T'];
    var miss = [], need = function (k, ok) { if (!ok) miss.push(k); };
    var list = function (a) { return Array.isArray(a) && a.length > 0 && a.every(function (x) { return x != null && x !== ''; }); };
    need('district', list(T.district));
    (Array.isArray(T.district) ? T.district : []).forEach(function (d, i) {
      if (!isObj(d) || !d.n) { miss.push('district.' + i); return; }
      var at = 'district.' + d.n + '.';
      need(at + 'p', !!d.p);
      need(at + 'r', Array.isArray(d.r) && d.r.length >= 4);
      ['streets', 'buildings', 'factions'].forEach(function (k) { need(at + k, !!d[k]); });
      ['named', 'scene', 'landmarks'].forEach(function (k) { need(at + k, list(d[k])); });
      need(at + 'notables', list(d.notables) && d.notables.every(function (x) { return Array.isArray(x) && x.length >= 3; }));
    });
    // two times of day: the first is the 1-in-2 draw, the second the other
    var times = isObj(T.weather) ? Object.keys(T.weather) : [];
    need('weather', times.length >= 2);
    times.slice(0, 2).forEach(function (t) { need('weather.' + t, list(T.weather[t])); });
    ['streetType', 'streetSound', 'streetSmell', 'streetObstacle', 'buildingCommon', 'buildingRare', 'rumour', 'faction']
      .forEach(function (k) { need(k, list(T[k])); });
    need('ratingLabels', Array.isArray(T.ratingLabels) && T.ratingLabels.length >= 4);
    return miss;
  }

  // ---- the generator: generate() from the vault, on one seeded stream -------------------------------------------
  function makeGenerate(T, rnd, MEM) {
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var oneIn = function (n) { return Math.floor(rnd() * n) === 0; };
    function fresh(key, list, keyFn) {
      keyFn = keyFn || function (x) { return x; };
      var used = (MEM[key] = MEM[key] || []);
      var pool = list.filter(function (x) { return used.indexOf(keyFn(x)) < 0; });
      var from = pool.length ? pool : list;
      var choice = from[Math.floor(rnd() * from.length)];
      var winSize = Math.max(1, Math.min(20, Math.floor(list.length / 2)));
      used.push(keyFn(choice));
      if (used.length > winSize) used.shift();
      return choice;
    }
    function pickN(a, n) {
      var c = a.slice(), out = [];
      n = Math.min(n, c.length);
      while (out.length < n) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
      return out;
    }
    var times = Object.keys(T.weather);
    return function generate(forced) {
      var d = forced || pick(T.district);
      var o = { d: d };
      o.timeOfDay = oneIn(2) ? times[0] : times[1];
      o.weather = fresh('weather-' + o.timeOfDay, T.weather[o.timeOfDay]);
      o.street = fresh('street-' + d.n, d.named);
      o.streetType = fresh('streetType', T.streetType);
      o.sound = fresh('sound', T.streetSound);
      o.smell = fresh('smell', T.streetSmell);
      o.obstacle = fresh('obstacle', T.streetObstacle);
      o.neighbour = oneIn(3) ? fresh('bldgRare', T.buildingRare) : fresh('bldgCommon', T.buildingCommon);
      o.beats = pickN(d.scene, Math.min(2, d.scene.length));
      o.landmark = fresh('landmark-' + d.n, d.landmarks);
      o.who = fresh('notable-' + d.n, d.notables, function (x) { return x[0]; });
      o.rumour = fresh('rumour', T.rumour).replace('%F%', fresh('faction', T.faction));
      return o;
    };
  }

  // ---- rendering ------------------------------------------------------------------------------------------------
  function ratings(o, T) {
    var r = o.d.r;
    return T.ratingLabels.map(function (l, i) { return l + ' ' + r[i]; });
  }
  function readAloud(o) {
    var one = o.timeOfDay + ', ' + o.weather + '. ' + o.d.streets + ' ' +
      'You\'re just off ' + o.street + ', in ' + lower(o.streetType) + '.';
    var two = o.d.buildings + ' Next door, ' + o.neighbour + '.';
    var three = o.beats.join(' ') + ' ' + cap(o.sound) + ', ' + o.smell + '.';
    return [one, two, three];
  }
  function rows(o) {
    var r = [
      ['Landmark', '**' + o.landmark + '** — *' + o.d.p + '*'],
      ['Who\'s out', '**' + o.who[0] + '** *(' + o.who[2] + ')* — ' + o.who[1]],
      ['In the way', o.obstacle],
      ['Word out', o.rumour],
      ['Factions', o.d.factions]
    ];
    if (o.d.special) r.push(['Rule here', o.d.special]);
    return r;
  }
  function cardOf(o, T) {
    var ra = readAloud(o), ch = ratings(o, T), rw = rows(o);
    var lines = [
      { kind: 'read', id: 'look', md: ra[0] },
      { kind: 'read', id: 'build', md: ra[1] },
      { kind: 'read', id: 'beats', md: ra[2] },
      { kind: 'chips', id: 'chips', chips: ch },
      { kind: 'grid', id: 'scene', title: 'Around here', rows: rw.map(function (x) { return { k: x[0], md: x[1] }; }) }
    ];
    var sub = o.timeOfDay + ' · ' + o.street + ' · ' + o.d.p;
    var all = [o.d.n, sub].concat(ra, ch, rw.map(function (x) { return x[0] + ': ' + x[1]; })).map(plain);
    var meta = { id: 'scenes', title: o.d.n, sub: sub, chips: ch, text: plain(ra[0]), all: all, label: o.d.n + ' · ' + o.street };
    return { lines: lines, meta: meta };
  }

  // ---- create() -------------------------------------------------------------------------------------------------
  function create(cfg) {
    cfg = cfg || {};
    var T = cfg.T;
    if (!T || !Array.isArray(T.district) || !T.weather || !Array.isArray(T.ratingLabels)) throw new Error('B68GmScenes.create: cfg.T (the pack\'s scenes.T) is required');
    var MEM = isObj(cfg.mem) ? cfg.mem : {};
    var districts = T.district.map(function (d) { return d.n; });
    var controls = [{
      id: 'sel', label: 'District', type: 'select',
      options: [{ label: 'anywhere', value: '' }].concat(districts.map(function (n) { return { label: n, value: n }; }))
    }];
    var defaults = function () { return { sel: '' }; };

    function roll(ui, run) {
      run = run || {};
      ui = Object.assign(defaults(), ui || {});
      var seed = run.seed != null ? run.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
      var mem = isObj(run.mem) ? run.mem : MEM;
      var before = clone(mem);
      var forced = ui.sel ? T.district.filter(function (x) { return x.n === ui.sel; })[0] || null : null;
      var scene = makeGenerate(T, seedRng(seed), mem)(forced);
      var card = cardOf(scene, T);
      return { scene: scene, lines: card.lines, meta: card.meta, seed: seed, replay: { id: 'scenes', seed: seed, mem: before, ui: { sel: ui.sel } } };
    }
    return {
      districts: districts,
      controls: controls,
      defaults: defaults,
      roll: roll,
      replay: function (r) { return roll(r.ui, { seed: r.seed, mem: clone(r.mem) }); },
      mem: function () { return MEM; }
    };
  }

  return { create: create, check: check, seedRng: seedRng, plain: plain, ID: 'scenes' };
});
