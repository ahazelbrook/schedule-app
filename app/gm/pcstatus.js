/* gm/pcstatus.js — PC status on the band's faces (suite ticket 3.7, switch face.pcstatus).

   Window.B68GmPcStatus, and module.exports under Node. With the switch on, the iPad band's faces are the table's player characters, each carrying Stress, harm
   marks (a plaster for level 1, a sling for 2, a splint for 3) and a stamp per deadlocked key. The GM page is the only writer: it builds the faces from the slim
   characters (app/boot.js gives each a non-enumerable `status`) and sends them as the `band.faces` layer, only when what would be drawn has changed (players tick
   their sheets all night, and every layer write wakes the iPad). Harm goes as levels 1-4, never as the text a player typed.

   facesFrom(pcs, actingId?, bare?) -> [{ pcId, name, stress?, harm?, locks?, acting? }]   at most MAX (3, the band's cap); a fourth PC is left off.
     bare: name and the mark only (STAGE_STATUS false)
   sync(host) -> Promise<'sent'|'same'|'busy'|'off'|'cleared'>
     host: { feature(id) -> bool, pcs() -> [slim PC], layer(path, value) -> Promise (null on failure), current() -> the band.faces now served (or null),
             KS14 (optional): stage() -> bool (the setting kit.stage), who() -> the Roll's Who, stampUp() -> bool, joined() -> KS12's join,
             left(v?) -> reads (no v) or sets this browser's memory that the stage's faces are on the band (so a page loaded with both settings off
             still clears them once) }
   acting(who, stampUp) -> the acting name   down(gone?)   actingId(name, joined) -> id | ''   STAGE_STATUS (see below)
   It never takes over faces that hold an NPC (the Hard start names three NPCs there): those are left alone until they are gone. It clears only what it wrote.

   THE NEW STAGE (KS14, the kit and stage build; the Gate 2 contract in KS14-contract.md). The faces are sent while face.pcstatus OR host.stage() is on
   (the stage's heads read them). Turn both off and the faces it wrote are cleared (Gate 2 condition 3); turn kit.stage off with face.pcstatus on and
   the faces stay, without the mark. With face.pcstatus off they carry their status only while STAGE_STATUS is true (one constant: Alex's call).
   WHO IS ACTING (KS14.2): only while host.stage() is true. One face may carry acting: true: the PC the Roll's Who names, from the pick until
   the stamp comes down. acting(who, up) is the page-memory step, read on every sync:
     a new Who (picked, or unpicked)  -> that PC acts (or nobody)        the stamp goes up -> the Who of that moment acts
     the stamp comes down (Take it down, Esc, Clean, a result) -> nobody acts      down() (Take it down, Blank, Clear, PANIC) -> nobody acts
   actingId(name, joined) turns the Who into a character id through KS12's one join (B68GmWho.join / present(): the pack's name to the filed
   character); a name it cannot join, or a PC who is not here, is nobody. facesFrom(pcs, id) marks that face, and only a face it builds from pcs
   (the page passes the PCs playing): a fourth PC acting takes the third face's place, so the acting PC is always on the band. */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPcStatus = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX = 3, last = null, mine = false, flying = false, again = false, hush = false;
  /* KS14, Gate 2 condition 3 (Alex's answer pending): with kit.stage on and face.pcstatus OFF, do the stage's heads show Stress and Harm?
     true: the faces go with their status, as face.pcstatus sends them. false: they go bare ({ pcId, name, acting? }): the heads show names and
     who is acting, no ring. This one constant is the switch; nothing else changes with it. */
  var STAGE_STATUS = true;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function ID(v) { return /^[A-Za-z0-9_-]{1,80}$/.test(v); }

  function facesFrom(pcs, actingId, bare) {
    var out = [], list = (Array.isArray(pcs) ? pcs : []).filter(function (pc) { return isObj(pc) && ID(str(pc.id)); });
    var act = actingId ? str(actingId) : '', ai = -1;
    list.forEach(function (pc, i) { if (ai < 0 && act && str(pc.id) === act) ai = i; });
    if (ai >= MAX) list = list.slice(0, MAX - 1).concat([list[ai]]);      /* KS14.2: the acting PC is always on the band */
    list.forEach(function (pc) {
      if (out.length >= MAX) return;
      var f = { pcId: str(pc.id) }, nm = (str(pc.name).trim() || str(pc.alias).trim()).replace(/\s+/g, ' ').slice(0, 40);
      if (nm) f.name = nm;
      var st = !bare && isObj(pc.status) ? pc.status : null;
      if (st) {
        if (typeof st.stress === 'number' && st.stress >= 0 && st.stress <= 9 && Math.floor(st.stress) === st.stress) f.stress = st.stress;
        var h = Array.isArray(st.harm) ? st.harm.filter(function (x) { return x === 1 || x === 2 || x === 3 || x === 4; }).slice(0, 4) : [];
        if (h.length) f.harm = h;
        if (typeof st.locks === 'number' && st.locks > 0) f.locks = Math.min(6, Math.floor(st.locks));
      }
      if (ai >= 0 && str(pc.id) === act) f.acting = true;
      out.push(f);
    });
    return out;
  }
  function holdsNpc(cur) { return Array.isArray(cur) && cur.some(function (f) { return isObj(f) && f.npcId; }); }

  function sync(host) {
    if (!isObj(host)) return Promise.resolve('off');
    var own = !!host.feature('face.pcstatus'), stage = typeof host.stage === 'function' && !!host.stage();      /* KS14: kit.stage sends them too */
    var cur = typeof host.current === 'function' ? host.current() : null, left = typeof host.left === 'function';
    if (!own && !stage) {
      act = { who: '', up: false, name: '' };
      /* KS14: faces the stage wrote before this page loaded (the browser remembers, host.left()) are cleared once, unless an NPC holds the band */
      if (!mine && left && host.left()) { if (Array.isArray(cur) && cur.length && !holdsNpc(cur)) mine = true; else if (!holdsNpc(cur)) host.left(false); }
      if (!mine) return Promise.resolve('off');
      mine = false; last = null; if (left) host.left(false);
      return Promise.resolve(host.layer('band.faces', null)).then(function () { return 'cleared'; }, function () { return 'cleared'; });
    }
    if (left && !stage && host.left()) host.left(false);      /* face.pcstatus owns them now */
    if (flying) { again = true; return Promise.resolve('busy'); }
    if (holdsNpc(cur)) return Promise.resolve('busy');
    var faces = facesFrom(typeof host.pcs === 'function' ? host.pcs() : [], actingNow(host), !own && !M.STAGE_STATUS), sig = JSON.stringify(faces);
    if (hush) { hush = false; last = sig; return Promise.resolve('same'); }      /* KS14: after PANIC (down(true)) */
    if (sig === last) return Promise.resolve('same');
    if (!faces.length) {
      if (!mine) { last = sig; return Promise.resolve('same'); }
      last = sig; mine = false; if (left) host.left(false);
      return Promise.resolve(host.layer('band.faces', null)).then(function () { return 'cleared'; }, function () { return 'cleared'; });
    }
    flying = true;
    return Promise.resolve(host.layer('band.faces', faces)).then(function (r) {
      flying = false;
      if (r === null || r === undefined) return 'busy';     /* refused: try again at the next change */
      last = sig; mine = true; if (left && stage) host.left(true);
      if (again) { again = false; return sync(host); }
      return 'sent';
    }, function () { flying = false; return 'busy'; });
  }
  function reset() { last = null; mine = false; flying = false; again = false; hush = false; act = { who: '', up: false, name: '' }; }

  /* KS14.2: who is acting, in the page's memory (never stored) */
  var act = { who: '', up: false, name: '' };
  function acting(who, up) {
    who = str(who).trim(); up = !!up;
    if (who !== act.who) act.name = who;
    if (up && !act.up) act.name = who;
    if (!up && act.up) act.name = '';
    act.who = who; act.up = up;
    return act.name;
  }
  /* nobody acts (Take it down, Blank, Clear, PANIC). gone: the faces layer itself was just wiped (PANIC's layers: null), so dropping the mark is
     not a reason to lay the faces again: the next sync takes what it would send as already sent, and the faces come back only at the next real
     change, as today */
  function down(gone) { act.name = ''; if (gone && mine) hush = true; }
  /* the Who's character id through KS12's join ({ pack: [{ name, id, here }] }); '' for a name it cannot join or a PC who is not here */
  function actingId(name, joined) {
    name = str(name).trim(); if (!name || !isObj(joined) || !Array.isArray(joined.pack)) return '';
    var p = joined.pack.filter(function (x) { return isObj(x) && str(x.name).trim() === name; })[0];
    return p && p.id && p.here !== false && ID(str(p.id)) ? str(p.id) : '';
  }
  function actingNow(host) {
    if (typeof host.stage !== 'function' || !host.stage()) { act = { who: '', up: false, name: '' }; return ''; }
    var name = acting(typeof host.who === 'function' ? host.who() : '', typeof host.stampUp === 'function' && host.stampUp());
    return name && typeof host.joined === 'function' ? actingId(name, host.joined()) : '';
  }

  var M = { MAX: MAX, STAGE_STATUS: STAGE_STATUS, facesFrom: facesFrom, sync: sync, reset: reset, acting: acting, down: down, actingId: actingId };
  return M;
});
