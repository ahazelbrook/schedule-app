/* gm/pcstatus.js — PC status on the band's faces (suite ticket 3.7, switch face.pcstatus).

   Window.B68GmPcStatus, and module.exports under Node. With the switch on, the iPad band's faces are the table's player characters, each carrying Stress, harm
   marks (a plaster for level 1, a sling for 2, a splint for 3) and a stamp per deadlocked key. The GM page is the only writer: it builds the faces from the slim
   characters (app/boot.js gives each a non-enumerable `status`) and sends them as the `band.faces` layer, only when what would be drawn has changed (players tick
   their sheets all night, and every layer write wakes the iPad). Harm goes as levels 1-4, never as the text a player typed.

   facesFrom(pcs) -> [{ pcId, name, stress?, harm?, locks? }]   at most MAX (3, the band's cap); a fourth PC is left off
   sync(host) -> Promise<'sent'|'same'|'busy'|'off'|'cleared'>
     host: { feature(id) -> bool, pcs() -> [slim PC], layer(path, value) -> Promise (null on failure), current() -> the band.faces now served (or null) }
   It never takes over faces that hold an NPC (the Hard start names three NPCs there): those are left alone until they are gone. It clears only what it wrote. */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPcStatus = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX = 3, last = null, mine = false, flying = false, again = false;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function ID(v) { return /^[A-Za-z0-9_-]{1,80}$/.test(v); }

  function facesFrom(pcs) {
    var out = [];
    (Array.isArray(pcs) ? pcs : []).forEach(function (pc) {
      if (out.length >= MAX || !isObj(pc) || !ID(str(pc.id))) return;
      var f = { pcId: str(pc.id) }, nm = (str(pc.name).trim() || str(pc.alias).trim()).replace(/\s+/g, ' ').slice(0, 40);
      if (nm) f.name = nm;
      var st = isObj(pc.status) ? pc.status : null;
      if (st) {
        if (typeof st.stress === 'number' && st.stress >= 0 && st.stress <= 9 && Math.floor(st.stress) === st.stress) f.stress = st.stress;
        var h = Array.isArray(st.harm) ? st.harm.filter(function (x) { return x === 1 || x === 2 || x === 3 || x === 4; }).slice(0, 4) : [];
        if (h.length) f.harm = h;
        if (typeof st.locks === 'number' && st.locks > 0) f.locks = Math.min(6, Math.floor(st.locks));
      }
      out.push(f);
    });
    return out;
  }
  function holdsNpc(cur) { return Array.isArray(cur) && cur.some(function (f) { return isObj(f) && f.npcId; }); }

  function sync(host) {
    if (!isObj(host)) return Promise.resolve('off');
    if (!host.feature('face.pcstatus')) {
      if (!mine) return Promise.resolve('off');
      mine = false; last = null;
      return Promise.resolve(host.layer('band.faces', null)).then(function () { return 'cleared'; }, function () { return 'cleared'; });
    }
    if (flying) { again = true; return Promise.resolve('busy'); }
    var cur = typeof host.current === 'function' ? host.current() : null;
    if (holdsNpc(cur)) return Promise.resolve('busy');
    var faces = facesFrom(typeof host.pcs === 'function' ? host.pcs() : []), sig = JSON.stringify(faces);
    if (sig === last) return Promise.resolve('same');
    if (!faces.length) {
      if (!mine) { last = sig; return Promise.resolve('same'); }
      last = sig; mine = false;
      return Promise.resolve(host.layer('band.faces', null)).then(function () { return 'cleared'; }, function () { return 'cleared'; });
    }
    flying = true;
    return Promise.resolve(host.layer('band.faces', faces)).then(function (r) {
      flying = false;
      if (r === null || r === undefined) return 'busy';     /* refused: try again at the next change */
      last = sig; mine = true;
      if (again) { again = false; return sync(host); }
      return 'sent';
    }, function () { flying = false; return 'busy'; });
  }
  function reset() { last = null; mine = false; flying = false; again = false; }

  return { MAX: MAX, facesFrom: facesFrom, sync: sync, reset: reset };
});
