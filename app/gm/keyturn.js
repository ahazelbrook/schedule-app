/* gm/keyturn.js — a turned key reaches the iPad (suite ticket 1.8, switch spine.keyturn).

   Window.B68GmKeyturn, and module.exports under Node. A player turns a key on their phone (app/sheet/keys.js writes play.keyTurn { seq, name, word, dir, at } on
   their character); the GM page sees it on the slim characters and lays a `keyturn` card over the iPad: the key crossing into its deadlock, and AUTOMATIC
   CRITICAL. GM side only; nothing is sent to a phone.

   sync(host) -> [fired]      host: { pcs() -> [slim PC], show(kind, payload, { key }) -> Promise, toast(msg), now() -> ms }
   A turn fires once: the show key is "<character id>-<seq>" (a reload or a second GM device lands on the same beat), and a turn older than FRESH_MS (the
   page was closed when it happened) is marked seen and not shown. */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmKeyturn = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FRESH_MS = 5 * 60000, seen = {};
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  /* the payload of the beat for one turn */
  function payload(pc, kt) {
    var p = { label: str(kt.name).slice(0, 60) || 'A key' }, who = str(pc.name).trim() || str(pc.alias).trim();
    if (who) p.pc = who.slice(0, 60);
    var w = str(kt.word).trim();
    if (w) p.to = ((kt.dir === 'up' ? 'Intensified: ' : 'Reversed: ') + w).slice(0, 60);
    p.crit = true;
    return p;
  }
  function sync(host) {
    var out = [];
    if (!isObj(host) || typeof host.pcs !== 'function') return out;
    var now = typeof host.now === 'function' ? host.now() : Date.now(), list = host.pcs();
    (Array.isArray(list) ? list : []).forEach(function (pc) {
      if (!isObj(pc) || !isObj(pc.keyTurn) || !str(pc.id)) return;
      var kt = pc.keyTurn, seq = Math.floor(+kt.seq) || 0, id = str(pc.id);
      if (seq <= 0 || seq <= (seen[id] || 0)) return;
      seen[id] = seq;
      var at = Date.parse(str(kt.at));
      if (!isFinite(at) || now - at > FRESH_MS) return;
      var p = payload(pc, kt);
      out.push({ id: id, seq: seq, payload: p });
      if (typeof host.show === 'function') {
        var r; try { r = host.show('keyturn', p, { key: (id + '-' + seq).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) }); } catch (e) { r = null; }
        if (r && typeof r.then === 'function') r.then(null, function () { if (typeof host.toast === 'function') host.toast('Could not show the turned key on the iPad.', true); });
      }
      if (typeof host.toast === 'function') host.toast((p.pc ? p.pc + ' turns ' : 'Key turned: ') + p.label + ': Stress cleared, next action is an automatic critical');
    });
    return out;
  }
  function reset() { seen = {}; }

  return { FRESH_MS: FRESH_MS, payload: payload, sync: sync, reset: reset };
});
