/* gm/engagement.js — the engagement roll, as pure logic (no DOM, no storage, no network).
   A port of the vault page Tools/blades-68-engagement-roll.md: approach, opening gambit, loadout, five factor pairs, the
   pool (1d base, +/-1d per major factor), the roll (a 0d pool rolls two and keeps the LOWEST) and the position it reads
   as. The printed text arrives from the GM pack (part `engagement`, field `T`); this file holds the arithmetic only.
   Plain script, UMD: window.B68GmEngagement in the browser, module.exports under Node.

   The vault rolls with Math.random; here the dice come from one seeded mulberry32 stream, so { seed, ui } replays a roll.

   ---------------------------------------------------------------------------------------------------------------
   API
   ---------------------------------------------------------------------------------------------------------------
   const en = B68GmEngagement.create({ T })
       T   pack.parts.engagement.T (required): approach [[name, gambit]], factor [{ id, plus, minus }],
           loadout [{ value, label, load }], outcome { crit, six, risky, desperate: { pos, how } }, cut, cite
   en.controls   [{ id:'approach', type:'select', options }, { id:'load', type:'select', options },
                  { id:'<factor id>', type:'tri', plus, minus } ...]   a tri control is -1 / 0 / +1
   en.defaults() { approach: <first>, load: <first>, mods: { <factor id>: 0, ... } }
   en.pool(ui)   1 + the sum of the mods (may be 0 or below)
   en.card(ui)   the card BEFORE rolling: { lines, meta, pool } ("Set the factors, then roll.")
   en.roll(ui, { seed })  -> { lines, meta, seed, replay, pool, zero, dice, crit, best, position }
       seed   uint32; omit for a fresh one
       replay { id:'engagement', seed, mem:{}, ui }   en.replay(replay) redraws the same dice
       lines  [{ kind:'read', id:'mods', md }, { kind:'want', id:'result', md }, { kind:'grid', id:'roll',
              rows:[{ k:'Roll', md }] }, { kind:'read', id:'cut', md }]   md is markdown, never HTML
       meta   { id:'engagement', title ("<approach> — 2d"; at or below zero "<approach> — 0d (2d, keep lowest)", never a
              negative pool: `pool` keeps the arithmetic), sub, chips, text, all, label, result }
   Helpers: B68GmEngagement.seedRng(a) · poolOf(T, mods) · rollPool(n, rng) · outcomeOf(T, r) · titlePool(n) · plain(md)
   B68GmEngagement.check(T) -> [string]   the table keys a pack is missing or has empty ('approach', 'outcome.six', 'cut',
       …), for the page to show when a pack is loaded. Empty = the pack is complete.
   --------------------------------------------------------------------------------------------------------------- */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmEngagement = api;
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
  function plain(s) {
    return String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
  }

  // The keys a roll reads (what check() reports when missing or empty): create() needs the approach, factor and loadout
  // lists and the outcome table; a card reads every outcome row, the cut line and the cite.
  function check(T) {
    if (!isObj(T)) return ['T'];
    var miss = [], need = function (k, ok) { if (!ok) miss.push(k); };
    var rows = function (a, ok) { return Array.isArray(a) && a.length > 0 && a.every(ok); };
    need('approach', rows(T.approach, function (a) { return Array.isArray(a) && !!a[0] && !!a[1]; }));
    need('factor', rows(T.factor, function (f) { return isObj(f) && !!f.id && !!f.plus && !!f.minus; }));
    need('loadout', rows(T.loadout, function (l) { return isObj(l) && !!l.value && !!l.label && l.load != null; }));
    need('outcome', isObj(T.outcome));
    ['crit', 'six', 'risky', 'desperate'].forEach(function (k) {
      var o = isObj(T.outcome) ? T.outcome[k] : null;
      need('outcome.' + k, isObj(o) && !!o.pos && !!o.how);
    });
    need('cut', !!T.cut); need('cite', !!T.cite);
    return miss;
  }

  // Blades pool: n d6, read the highest. Zero dice = roll 2, keep the LOWEST.
  function rollPool(n, rnd) {
    var d6 = function () { return 1 + Math.floor(rnd() * 6); };
    var zero = n <= 0, dice = [];
    for (var i = 0; i < (zero ? 2 : n); i++) dice.push(d6());
    var sixes = dice.filter(function (x) { return x === 6; }).length;
    return {
      dice: dice, zero: zero, pool: n,
      crit: !zero && sixes >= 2,
      best: zero ? Math.min.apply(null, dice) : Math.max.apply(null, dice)
    };
  }
  function outcomeOf(T, r) {
    var o = T.outcome;
    if (r.crit) return o.crit;
    if (r.best === 6) return o.six;
    if (r.best >= 4) return o.risky;
    return o.desperate;
  }
  function modOf(mods, id) { return Number(mods && mods[id]) || 0; }
  // the pool as a card title shows it: "2d", or "0d (2d, keep lowest)" for any pool at or below zero
  function titlePool(n) { return n > 0 ? n + 'd' : '0d (2d, keep lowest)'; }
  function poolOf(T, mods) {
    return 1 + T.factor.reduce(function (s, f) { return s + modOf(mods, f.id); }, 0);
  }

  function create(cfg) {
    cfg = cfg || {};
    var T = cfg.T;
    if (!T || !Array.isArray(T.approach) || !Array.isArray(T.factor) || !Array.isArray(T.loadout) || !T.outcome) throw new Error('B68GmEngagement.create: cfg.T (the pack\'s engagement.T) is required');
    var controls = [
      { id: 'approach', label: 'Approach', type: 'select', options: T.approach.map(function (a) { return { label: a[0], value: a[0] }; }) },
      { id: 'load', label: 'Loadout', type: 'select', options: T.loadout.map(function (l) { return { label: l.label, value: l.value }; }) }
    ].concat(T.factor.map(function (f) { return { id: f.id, label: f.plus + '  /  ' + f.minus, type: 'tri', plus: f.plus, minus: f.minus }; }));
    function defaults() {
      var mods = {};
      T.factor.forEach(function (f) { mods[f.id] = 0; });
      return { approach: T.approach[0][0], load: T.loadout[0].value, mods: mods };
    }
    // the ui merged over the defaults, every control resolved to something real
    function norm(ui) {
      var d = defaults();
      ui = ui || {};
      var app = T.approach.filter(function (a) { return a[0] === ui.approach; })[0] || T.approach[0];
      var ld = T.loadout.filter(function (l) { return l.value === ui.load; })[0] || T.loadout[0];
      var mods = {};
      T.factor.forEach(function (f) { var m = modOf(ui.mods, f.id); mods[f.id] = m > 0 ? 1 : m < 0 ? -1 : 0; });
      return { app: app, ld: ld, mods: mods, ui: { approach: app[0], load: ld.value, mods: mods }, d: d };
    }

    function head(n) {
      var pool = poolOf(T, n.mods);
      var sub = 'opening gambit is ' + n.app[1] + ' · ' + n.ld.value + ' loadout, load ' + n.ld.load + ' · ' + T.cite;
      var active = T.factor
        .filter(function (f) { return n.mods[f.id] !== 0; })
        .map(function (f) { var m = n.mods[f.id]; return (m > 0 ? '**+1d**' : '**−1d**') + ' ' + (m > 0 ? f.plus.toLowerCase() : f.minus.toLowerCase()); });
      var mods = '1d base' + (active.length ? ' · ' + active.join(' · ') : ' · no modifiers');
      // a pool at or below zero rolls two dice and keeps the lowest: the title says so, never "-1d"
      return { pool: pool, title: n.app[0] + ' — ' + titlePool(pool), sub: sub, mods: mods };
    }
    function meta(h, extra, lines) {
      var all = [h.title, h.sub].concat(lines.map(function (l) { return l.kind === 'grid' ? l.rows.map(function (r) { return r.k + ': ' + r.md; }).join(' ') : l.md; })).map(plain);
      return Object.assign({ id: 'engagement', title: h.title, sub: h.sub, chips: [], text: all[2], all: all, label: h.title }, extra || {});
    }
    function card(ui) {
      var n = norm(ui), h = head(n);
      var lines = [{ kind: 'read', id: 'mods', md: h.mods }, { kind: 'read', id: 'set', md: 'Set the factors, then roll.' }];
      return { lines: lines, meta: meta(h, null, lines), pool: h.pool };
    }
    function roll(ui, run) {
      run = run || {};
      var n = norm(ui), h = head(n);
      var seed = run.seed != null ? run.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
      var r = rollPool(h.pool, seedRng(seed));
      var oc = outcomeOf(T, r);
      var lines = [
        { kind: 'read', id: 'mods', md: h.mods },
        { kind: 'want', id: 'result', md: '**' + oc.pos + '**  \n' + oc.how },
        { kind: 'grid', id: 'roll', rows: [{ k: 'Roll', md: r.zero
          ? '0d — rolled 2, kept the lowest: [' + r.dice.join(' ') + '] → **' + r.best + '**'
          : '[' + r.dice.join(' ') + '] → **' + (r.crit ? 'critical' : r.best) + '**' }] },
        { kind: 'read', id: 'cut', md: T.cut }
      ];
      var m = meta(h, { result: { pool: r.pool, zero: r.zero, dice: r.dice, crit: r.crit, best: r.best, pos: oc.pos } }, lines);
      m.chips = [oc.pos.split(' — ')[0]];
      return {
        lines: lines, meta: m, seed: seed, pool: r.pool, zero: r.zero, dice: r.dice, crit: r.crit, best: r.best, position: oc.pos,
        replay: { id: 'engagement', seed: seed, mem: {}, ui: n.ui }
      };
    }
    return {
      controls: controls, defaults: defaults,
      pool: function (ui) { return poolOf(T, norm(ui).mods); },
      card: card, roll: roll,
      replay: function (r) { return roll(clone(r.ui), { seed: r.seed }); },
      mem: function () { return {}; }
    };
  }

  return { create: create, check: check, seedRng: seedRng, poolOf: poolOf, rollPool: rollPool, outcomeOf: outcomeOf, titlePool: titlePool, plain: plain, ID: 'engagement' };
});
