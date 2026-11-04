/* gm/title-card.js — the score title card (suite ticket 2.10, switch map.title).

   Plain script, UMD: window.B68GmTitleCard in the browser, module.exports under Node. GM side only. create(host) reaches the page only through the host it is given, so a node
   test can drive it with a fake.

   WHEN. On GO: the night controller entering the Score phase (the phase rail's Score, "Blade, go" to the score, a cue that goes there). wrap(night, ctl) puts the card on that one
   door: a phase entered while another is current, to `score`, with the switch on. It never fires on its own: a page loaded while the night is already in the Score phase shows nothing.
   Two GM pages that press GO in the same minute send the same key, so the iPad shows it once.
   WHAT. The score's name (the roll's name), the district under it, and the building's outside: the footprint of each storey from the ground up, read off the site by the map kit's
   own layout. Nothing is authored. It is the OUTSIDE only: no room, no name, nothing below the ground. The kit lays the floors out the same whatever the crew knows, so this is
   the same card at every reveal; the server rebuilds the payload again and refuses any text that names a hidden NPC.

   API
     SWITCH, MS (6000)
     floorsOf(kit, roll, opts) -> ['x,y,w,d', ...] | []   the storeys from the ground up on a 0 to 100 grid; [] when the kit cannot lay the site out (the card then draws a plain block)
     payloadFor(kit, roll, opts) -> { text, sub?, floors? } | null
     keyFor(roll, now) -> the show key (one per site per minute)
     create(host) -> controller { fire(), wrap(night) }
       host: { feature(id) -> bool, roll() -> the current location's roll | null, kit() -> B68Map | null, kit1() -> bool, show(kind, payload, { ms, key }) -> Promise, toast(msg, bad), now() } */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmTitleCard = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'map.title', MS = 6000, MAX_FLOORS = 6;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function cut(s, n) { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).trim() : s; }

  /* the above-ground storeys of the roll's layout (never a basement: nobody sees one from the street) as footprints on the 0 to 100 grid, scaled by the biggest side of them all */
  function floorsOf(kit, roll, opts) {
    var M = kit && kit._internal; if (!M || !roll || typeof M.model !== 'function' || !M.layout || typeof M.layout.build !== 'function') return [];
    try {
      var W = [], model = M.model(roll, W);
      if (opts && opts.kit1 === true && roll.kit === 1 && M.grand && typeof M.grand.read === 'function') model.grand = M.grand.read(roll, model, W);
      if (!model || !Array.isArray(model.rooms) || !model.rooms.length) return [];
      var seed = roll.seed != null ? roll.seed : M.hash(model.name + model.district), rng = M.rng(seed);      /* the seed the map itself lays the floors out with */
      var lay = M.layout.build(model, 'plan', rng.fork('layout'), model.grand ? { player: true, W: W } : { player: true });
      var lv = (lay && Array.isArray(lay.levels) ? lay.levels : []).filter(function (l) { return isObj(l) && isObj(l.bbox) && Number(l.lvl) >= 0; });
      lv.sort(function (a, b) { return Number(a.lvl) - Number(b.lvl); });
      if (!lv.length) return [];
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      lv.forEach(function (l) { var b = l.bbox; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
      var side = Math.max(x1 - x0, y1 - y0); if (!(side > 0)) return [];
      var k = 100 / side, out = [];
      lv.slice(0, MAX_FLOORS).forEach(function (l) {
        var b = l.bbox, x = Math.round((b.x - x0) * k), y = Math.round((b.y - y0) * k), w = Math.max(1, Math.round(b.w * k)), d = Math.max(1, Math.round(b.h * k));
        x = Math.min(99, Math.max(0, x)); y = Math.min(99, Math.max(0, y)); w = Math.min(w, 100 - x); d = Math.min(d, 100 - y);
        out.push([x, y, w, d].join(','));
      });
      return out;
    } catch (e) { return []; }
  }
  function payloadFor(kit, roll, opts) {
    if (!isObj(roll)) return null;
    var text = cut(roll.name, 80); if (!text) return null;
    var p = { text: text }, sub = cut(roll.district, 120), fl = floorsOf(kit, roll, opts);
    if (sub) p.sub = sub;
    if (fl.length) p.floors = fl;
    return p;
  }
  function keyFor(roll, now) {
    var n = Math.floor((+now || 0) / 60000), s = 'tc-' + str(isObj(roll) ? roll.name : '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + n;
    return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  }

  function create(host) {
    host = host || {};
    function on() { return typeof host.feature === 'function' && host.feature(SWITCH) === true; }
    function fire() {
      if (!on()) return Promise.resolve(null);
      var roll = typeof host.roll === 'function' ? host.roll() : null;
      var p = payloadFor(typeof host.kit === 'function' ? host.kit() : null, roll, { kit1: typeof host.kit1 === 'function' && host.kit1() === true });
      if (!p) return Promise.resolve(null);
      var now = typeof host.now === 'function' ? host.now() : Date.now();
      return Promise.resolve(host.show('scoretitle', p, { ms: MS, key: keyFor(roll, now) })).then(null, function () { return null; });
    }
    /* the night controller's enter(): after it, a move into the Score phase from another phase fires the card. The controller keeps its own behaviour and its answer. */
    function wrap(night) {
      if (!night || typeof night.enter !== 'function' || typeof night.phase !== 'function' || night.__b24) return false;
      var enter = night.enter;
      night.enter = function (phase) {
        var was = null; try { was = night.phase(); } catch (e) { was = null; }
        var r = enter.apply(night, arguments);
        if (r !== false && phase === 'score' && was !== 'score') fire();
        return r;
      };
      night.__b24 = true;
      return true;
    }
    return { fire: fire, wrap: wrap };
  }

  return { SWITCH: SWITCH, MS: MS, floorsOf: floorsOf, payloadFor: payloadFor, keyFor: keyFor, create: create };
});
