/* gm/room-desk.js — the page's seam for the practical speaker, the ringing phone and the Trouble Engine desk (suite 4.5, 4.7, 5.3, B31).

   Plain script, UMD: window.B68GmRoomDesk in the browser, module.exports under Node. It builds the three controllers (gm/practical.js, gm/phone.js,
   gm/trouble.js) from ONE host the GM page gives it, passes every show the page sends to the phone.
   Each part exists only while its own switch is on: with all three off nothing here draws, plays, writes or sends.

   create(host) -> { lines(), desk(which), toggle(which), onShow(kind, payload), practical(), phone(), trouble() }   (N2: no Menu lines; desk(which) -> the controller or null)
     host: { feature(id) -> bool, doc(): the GM state document, save(id, item|null), show(kind, payload, opts), toast(msg, bad?), root(), part(name), now?(), browser?: window-like }
     which: 'practical' | 'phone' | 'trouble' | 'canon' | 'frontpage' | 'absent' */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmRoomDesk = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var DEFS = [
    { which: 'practical', sw: 'room.practical', label: 'Practical speaker', title: 'Choose the second speaker for in-world sounds' },
    { which: 'phone', sw: 'room.phone', label: 'Ringing phone', title: 'Ring the practical speaker and answer with a recorded line' },
    { which: 'trouble', sw: 'between.trouble', label: 'Trouble desk', title: 'Walk the Aftermath trouble checks; approved items feed the front page and rumours' },
    /* suite B31: the canon queue preview, the front page and the absent packet (gm/desk-b31.js builds them) */
    { which: 'canon', sw: 'ai.canon', label: 'Canon queue', title: 'Preview the canon queue note: what ticking would file, and what stays GM-only' },
    { which: 'frontpage', sw: 'between.frontpage', label: 'Front page', title: 'Draw, print and show the front page note' },
    { which: 'absent', sw: 'between.absent', label: 'Absent packet', title: 'Send an absent player the front page, a recap and their sheet changes' }
  ];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function req(name, path) { if (W && W[name]) return W[name]; try { return require(path); } catch (e) { return null; } }

  function create(host) {
    var h = host || {}, api = {}, inst = {};
    var Pr = req('B68GmPractical', './practical.js'), Ph = req('B68GmPhone', './phone.js'), Tr = req('B68GmTrouble', './trouble.js');
    function on(id) { return typeof h.feature === 'function' && !!h.feature(id); }

    function practical() {
      if (!on('room.practical') || !Pr) return null;
      if (!inst.pr) inst.pr = Pr.make(Pr.browserHost({ toast: h.toast, root: h.root }));
      return inst.pr;
    }
    function phone() {
      if (!on('room.phone') || !Ph) return null;
      if (!inst.ph) {
        /* with the speaker switch off the phone still rings, on the default output: it builds its own plain speaker */
        var sp = practical() || (Pr ? Pr.make(Pr.browserHost({ toast: h.toast })) : null);
        inst.ph = Ph.make({ on: function () { return on('room.phone'); }, speaker: sp, show: h.show, toast: h.toast, root: h.root, now: h.now,
          store: (W && Ph.idbStore(W)) || Ph.memStore(), later: function (fn, ms) { return W && W.setTimeout ? W.setTimeout(fn, ms) : null; }, cancel: function (t) { if (W && W.clearTimeout) W.clearTimeout(t); } });
      }
      return inst.ph;
    }
    function trouble() {
      if (!on('between.trouble') || !Tr) return null;
      if (!inst.tr) inst.tr = Tr.make({ part: function () { return h.part ? h.part('trouble') : null; }, show: h.show, toast: h.toast, root: h.root, now: h.now, save: h.save,
        items: function () { var d = typeof h.doc === 'function' ? h.doc() : null; return isObj(d) && isObj(d.trouble) && isObj(d.trouble.items) ? d.trouble.items : {}; } });
      return inst.tr;
    }
    function b31(which, sw) { var D = req('B68GmDeskB31', './desk-b31.js'); return on(sw) && D ? D.make(which, h, inst.b31 || (inst.b31 = {})) : null; }
    var get = { practical: practical, phone: phone, trouble: trouble, canon: function () { return b31('canon', 'ai.canon'); }, frontpage: function () { return b31('frontpage', 'between.frontpage'); }, absent: function () { return b31('absent', 'between.absent'); } };
    api.practical = practical; api.phone = phone; api.trouble = trouble;
    api.lines = function () { return DEFS.filter(function (d) { return on(d.sw); }); };
    api.desk = function (which) { return get[which] ? get[which]() : null; };
    api.toggle = function (which) { var c = get[which] ? get[which]() : null; return c ? c.toggle() : false; };
    api.onShow = function (kind) { var p = phone(); if (p) p.onShow(kind); };
    api.reset = function () { if (inst.ph) inst.ph.hangup(); if (inst.pr) inst.pr.stopAll(); inst = {}; };
    return api;
  }

  return { create: create, DEFS: DEFS };
});
