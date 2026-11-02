/* sheet/flags.js — the switches a phone or the iPad has been told (suite ticket W0.2).

   Window.B68Flags, and module.exports under Node. In the core bundle (every route), so a phone and the iPad both have it. It knows no switch ids and has no
   registry: the Worker already filtered what it sends (only the display and phone switches, only booleans), and this holds what arrived.

   The GM's switches live in the GM state document and are copied, display and phone ones only, into the campaign document's `features` (app/features.js).
   A phone gets them with every campaign arrival (boot.js calls apply(doc)); the iPad gets them in every display poll (apply(answer)). Both are the same
   shape: an object with a `features` map. A feature reads on(id) at the moment it needs the answer, or subscribes and redraws; neither needs a reload.

   A switch is ON only when it is exactly true. An answer with no `features` (an older server, a document with none stored) turns everything off.

   API
     apply(source)   source: a campaign document, a display answer, or the features map itself -> true when any switch changed
     on(id)          -> bool
     all()           -> { id: bool } (a copy)
     subscribe(fn)   -> off(); fn(all(), changedIds) after a change
     reset()         everything off, no listeners (tests) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Flags = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var cur = {}, subs = [];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function mapOf(src) {
    if (!isObj(src)) return {};
    var m = isObj(src.features) ? src.features : (Object.keys(src).length && Object.keys(src).every(function (k) { return typeof src[k] === 'boolean'; }) ? src : {});
    var out = {};
    Object.keys(m).forEach(function (k) { if (typeof m[k] === 'boolean') out[k] = m[k]; });
    return out;
  }
  function apply(src) {
    var next = mapOf(src), changed = [], k;
    for (k in next) if (Object.prototype.hasOwnProperty.call(next, k) && (cur[k] === true) !== (next[k] === true)) changed.push(k);
    for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k) && !Object.prototype.hasOwnProperty.call(next, k) && cur[k] === true) changed.push(k);
    cur = next;
    if (!changed.length) return false;
    subs.slice().forEach(function (fn) { try { fn(all(), changed); } catch (e) { if (W && W.console) W.console.error(e); } });
    return true;
  }
  function on(id) { return cur[id] === true; }
  function all() { var o = {}; Object.keys(cur).forEach(function (k) { o[k] = cur[k]; }); return o; }
  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }
  function reset() { cur = {}; subs = []; }

  return { apply: apply, on: on, all: all, subscribe: subscribe, reset: reset };
});
