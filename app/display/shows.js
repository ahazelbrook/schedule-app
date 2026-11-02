/* B68Shows: the show registry (suite W0.3). Maps each kind of brief beat (an overlay kind the server whitelists, functions/_lib/show.js)
   to what the iPad needs to draw it: a label, a `fixture` (the look book draws it, app/lookbook.html), a `clean` (the display's own check of the
   SERVED payload: the same bounds as the server, plus the server's join) and a `render` that builds a node. A renderer may live in a bundle of its
   own: give the kind `bundle: '<name>'` instead of `render`, and mount() asks B68Load.need() for it first (the registry shape is the lazy hook).

   API
     register(kind, { label, fixture, ms?, clean(payload) -> payload | null, render(payload, env) -> Node } | { ..., bundle })
     has(kind), ids(), entry(kind) -> { kind, label, fixture, ms } | null, entries() -> [entry...]
     clean(kind, payload) -> the checked payload or null          (an unknown kind, or a payload that does not pass, is null)
     mount(overlay, env) -> Promise<Node | null>   overlay = { kind, payload, ... } as the display GET served it; env = { document?, reduced? }
   Nothing here touches the network. Every string reaches the page by textContent. A renderer never gets a hidden NPC: the server joins rolodex and
   spotlight to revealed NPCs only, and `clean` refuses a payload that does not have the joined shape. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68Shows = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var K = {}, order = [];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  /* small checkers the kinds share (also used by show-beats.js): each returns the clean value or undefined */
  var C = {
    text: function (v, max) { if (typeof v !== 'string') return undefined; var t = v.replace(/\s+/g, ' ').trim(); return t && t.length <= max ? t : undefined; },
    whole: function (v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi ? v : undefined; },
    oneOf: function (v, list) { return typeof v === 'string' && list.indexOf(v) >= 0 ? v : undefined; },
    id: function (v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : undefined; },
    /* a served NPC card: exactly the keys the server joins (no description, notes or tags) */
    card: function (c) {
      if (!isObj(c)) return null;
      var id = C.id(c.npcId), name = C.text(c.name, 120);
      if (!id || !name) return null;
      return { npcId: id, name: name, alias: C.text(c.alias, 120) || '', role: C.text(c.role, 120) || '', faction: C.text(c.faction, 120) || '', spec: isObj(c.spec) ? c.spec : null };
    }
  };

  function register(kind, spec) {
    if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(kind) || !isObj(spec) || typeof spec.clean !== 'function') throw new Error('bad show kind');
    if (typeof spec.render !== 'function' && typeof spec.bundle !== 'string') throw new Error('a show kind needs render or bundle');
    if (!K[kind]) order.push(kind);
    K[kind] = spec;
  }
  function has(kind) { return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(K, kind); }
  function entry(kind) { var s = has(kind) ? K[kind] : null; return s ? { kind: kind, label: s.label || kind, fixture: s.fixture, fixtures: Array.isArray(s.fixtures) ? s.fixtures : undefined, ms: s.ms || 6000 } : null; }
  function clean(kind, payload) {
    if (!has(kind)) return null;
    try { var out = K[kind].clean(isObj(payload) ? payload : {}); return isObj(out) ? out : null; } catch (e) { return null; }
  }
  /* mount(overlay, env): the node for a served overlay (null when it cannot be drawn). A renderer that fails is no beat at all, never an error on the page. */
  function mount(overlay, env) {
    if (!isObj(overlay) || !has(overlay.kind)) return Promise.resolve(null);
    var spec = K[overlay.kind], payload = clean(overlay.kind, overlay.payload);
    if (!payload) return Promise.resolve(null);
    var ready = typeof spec.render === 'function' ? Promise.resolve() : (root && root.B68Load ? root.B68Load.need(spec.bundle) : Promise.reject(new Error('no loader')));
    return ready.then(function () {
      if (typeof K[overlay.kind].render !== 'function') return null;
      var node = K[overlay.kind].render(payload, env || {});
      return node || null;
    }).then(function (n) { return n; }, function () { return null; });
  }

  return {
    register: register, has: has, ids: function () { return order.slice(); }, entry: entry, clean: clean, mount: mount, C: C,
    entries: function () { return order.map(entry); },
    isObj: isObj
  };
});
