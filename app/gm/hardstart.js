/* B68GmHardStart: the GM's side of the hard start (suite ticket 1.2, switch spine.start). The table display draws it (app/display/hardstart.js);
   this file lays the layers it reads, through the show contract (B68Show.layer), and gives the GM a small sheet to run it from.

   The layers it writes (and nothing else):
     scene.mode 'start'    data.countdown { to, label }    data.credits [npcId]    data.previously [npcId]    band.faces [{ npcId }]
   A hidden NPC cannot be picked: pool() lists revealed NPCs only, setPick refuses any other id, and the server drops a hidden one on write and again on
   every poll (functions/_lib/show.js), so a stale pick still never reaches the iPad.

   make(host) -> ctl, with host = { layer(path, value) -> Promise, npcs() -> { id: npcDoc }, now() -> ms, startAt() -> ms | 0, toast?(msg, bad?), onTitles?() }
     ctl.pool()              revealed NPCs, most recently revealed first: [{ id, name, role, firstSeen }]  (the three picks default to its first three)
     ctl.picks()             the three chosen ids now (a pick that is no longer revealed drops out and the next in the pool fills the slot)
     ctl.setPick(slot, id)   -> bool        false for an unknown or hidden NPC, or a slot outside 0..2, or an id already in another slot
     ctl.arm(at, label?)     lay the test card and the station clock for `at` (ms) -> Promise<bool>        ctl.armTest(minutes = 2) -> arm(now + minutes), a test only:
                             it never reads or writes the night's startAt
     ctl.go()                the clock to now: the same path as zero -> Promise<bool>
     ctl.reveal(slot)        show the name plate of that face (one tap) -> Promise<bool>; a face already shown stays shown
     ctl.end()               take the hard start off the iPad (every layer it set) and hand over to the cold open -> Promise<bool>. The hard start ends where the
                             Opening Titles begin: host.onTitles is the seam the run-order ticket (V1) fills; nothing here plays the Titles.
     ctl.state()             { armed, at, test, shown: [slot], picks }
   The sheet (open/toggle/render) is drawn in the right-edge sheet shared with the Switchboard (B68GmWorkshop.sheet). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmHardStart = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';
  var SLOTS = 3, CREDITS_MAX = 8, TEST_MIN = 2;
  var PATHS = ['scene.mode', 'data.countdown', 'data.credits', 'data.previously', 'band.faces'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* the revealed NPCs, newest reveal first (firstSeen is set the moment an NPC is revealed); no firstSeen sorts last, ties by name */
  function poolOf(npcs) {
    var out = [];
    Object.keys(isObj(npcs) ? npcs : {}).forEach(function (id) {
      var d = npcs[id];
      if (!isObj(d) || d.revealed !== true || !str(d.name).trim()) return;
      var t = Date.parse(str(d.firstSeen));
      out.push({ id: id, name: str(d.name).trim(), role: str(d.role).trim(), firstSeen: isFinite(t) ? t : -Infinity });
    });
    out.sort(function (a, b) { return b.firstSeen !== a.firstSeen ? (b.firstSeen > a.firstSeen ? 1 : -1) : (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1); });
    return out.map(function (p) { return { id: p.id, name: p.name, role: p.role, firstSeen: isFinite(p.firstSeen) ? new Date(p.firstSeen).toISOString() : '' }; });
  }
  function hhmm(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  function make(host) {
    var h = host || {};
    var st = { armed: false, at: 0, test: false, shown: [], chosen: [null, null, null] };
    function npcs() { return typeof h.npcs === 'function' ? h.npcs() : {}; }
    function now() { return typeof h.now === 'function' ? h.now() : Date.now(); }
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad === true); }
    function layer(path, v) { return typeof h.layer === 'function' ? Promise.resolve(h.layer(path, v)) : Promise.resolve(null); }
    function seq(steps) {   /* in order, stopping at the first the page refused (a refused write answers null) */
      var ok = true;
      return steps.reduce(function (p, s) { return p.then(function () { if (!ok) return null; return s().then(function (r) { if (r === null || r === undefined) ok = false; return r; }); }); }, Promise.resolve()).then(function () { return ok; });
    }
    function live() { var p = poolOf(npcs()), ids = {}; p.forEach(function (x) { ids[x.id] = x; }); return { pool: p, byId: ids }; }
    var ctl = {
      pool: function () { return live().pool; },
      picks: function () {
        var L = live(), out = [];
        st.chosen.forEach(function (id) { if (id && L.byId[id] && out.indexOf(id) < 0) out.push(id); else out.push(null); });
        for (var i = 0; i < SLOTS; i++) if (!out[i]) { for (var j = 0; j < L.pool.length; j++) if (out.indexOf(L.pool[j].id) < 0) { out[i] = L.pool[j].id; break; } }
        return out.filter(function (x) { return !!x; });
      },
      setPick: function (slot, id) {
        var L = live(); slot = +slot;
        if (!(slot >= 0 && slot < SLOTS) || Math.floor(slot) !== slot || !L.byId[id]) return false;
        var cur = ctl.picks();
        if (cur.indexOf(id) >= 0 && cur[slot] !== id) return false;
        var next = cur.slice(); while (next.length < SLOTS) next.push(null); next[slot] = id; st.chosen = next;
        return true;
      },
      arm: function (at, label) {
        var t = Math.floor(Number(at));
        if (!isFinite(t) || t < 1) { say('Pick a start time first.', true); return Promise.resolve(false); }
        var L = live(), picks = ctl.picks(), credits = L.pool.slice(0, CREDITS_MAX).map(function (p) { return p.id; });
        st.shown = [];
        return seq([
          function () { return layer('band.faces', null); },
          function () { return layer('data.credits', credits.length ? credits : null); },
          function () { return layer('data.previously', picks.length ? picks : null); },
          function () { return layer('data.countdown', { to: t, label: str(label).trim().slice(0, 40) || 'Station clock' }); },
          function () { return layer('scene.mode', 'start'); }
        ]).then(function (ok) { if (ok) { st.armed = true; st.at = t; st.test = false; } return ok; });
      },
      armTest: function (minutes) {
        var m = Number(minutes); if (!(m > 0)) m = TEST_MIN;
        return ctl.arm(now() + Math.round(m * 60000), 'Test').then(function (ok) { if (ok) st.test = true; return ok; });
      },
      go: function () {
        if (!st.armed) { say('Arm the hard start first.', true); return Promise.resolve(false); }
        var t = now();
        return layer('data.countdown', { to: t, label: 'Station clock' }).then(function (r) { if (r === null || r === undefined) return false; st.at = t; return true; });
      },
      reveal: function (slot) {
        slot = +slot;
        var picks = ctl.picks();
        if (!st.armed || !(slot >= 0 && slot < picks.length) || Math.floor(slot) !== slot) return Promise.resolve(false);
        if (st.shown.indexOf(slot) < 0) st.shown = st.shown.concat([slot]).sort();
        var ids = st.shown.map(function (s) { return picks[s]; }).filter(function (x) { return !!x; });
        return layer('band.faces', ids.map(function (id) { return { npcId: id }; })).then(function (r) { return r !== null && r !== undefined; });
      },
      end: function () {
        return seq(PATHS.slice().reverse().map(function (p) { return function () { return layer(p, null); }; })).then(function (ok) {
          if (ok) { st.armed = false; st.test = false; st.shown = []; if (typeof h.onTitles === 'function') { try { h.onTitles(); } catch (e) { /* the seam is the next ticket's */ } } }
          return ok;
        });
      },
      state: function () { return { armed: st.armed, at: st.at, test: st.test, shown: st.shown.slice(), picks: ctl.picks() }; }
    };

    /* ---- the sheet ---- */
    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'hardstart', 'Hard start') : null; }
    ctl.render = function (box) {
      if (!box) return;
      var L = live(), picks = ctl.picks(), s = ctl.state(), start = typeof h.startAt === 'function' ? +h.startAt() || 0 : 0;
      var opts = function (cur) { return '<option value="">(none)</option>' + L.pool.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + (p.role ? ' (' + esc(p.role) + ')' : '') + '</option>'; }).join(''); };
      var h2 = '<p class="gm-dim">' + (s.armed ? (s.test ? 'Test armed' : 'Armed') + ' for ' + esc(hhmm(s.at)) + '.' : 'Not armed. The iPad shows the test card and a station clock once you arm it.') + '</p>' +
        '<div class="gm-sb-row"><button type="button" class="btn sm primary" data-hs="arm"' + (start ? '' : ' disabled') + ' title="' + (start ? 'Counts down to the night’s start time' : 'The night has no start: line in its Run sheet') + '">Arm for ' + (start ? esc(hhmm(start)) : 'the night’s start') + '</button> ' +
        '<button type="button" class="btn sm" data-hs="test">Test: start in 2 minutes</button> <button type="button" class="btn sm" data-hs="go"' + (s.armed ? '' : ' disabled') + '>GO now</button> ' +
        '<button type="button" class="btn sm" data-hs="end"' + (s.armed ? '' : ' disabled') + '>End the hard start</button></div>' +
        '<h3>Previously on: three faces from the people the table has met</h3>';
      for (var i = 0; i < SLOTS; i++) {
        h2 += '<div class="gm-sb-row"><label>Face ' + (i + 1) + ' <select data-hs-pick="' + i + '">' + opts(picks[i] || '') + '</select></label> ' +
          '<button type="button" class="btn sm" data-hs-reveal="' + i + '"' + (s.armed && picks[i] ? '' : ' disabled') + ' aria-pressed="' + (s.shown.indexOf(i) >= 0) + '">' + (s.shown.indexOf(i) >= 0 ? 'Name shown' : 'Reveal the name') + '</button></div>';
      }
      h2 += '<p class="gm-dim">Only NPCs you have revealed are listed. The three newest reveals are picked for you.</p>';
      box.innerHTML = L.pool.length ? h2 : h2 + '<p class="gm-empty">No NPC has been revealed yet, so there is no one to show.</p>';
      var sh = box.parentNode;
      if (sh && !sh.__hs) {
        sh.__hs = true;
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-hs],[data-hs-reveal]') : null; if (!t) return;
          var a = t.getAttribute('data-hs'), p;
          if (t.hasAttribute('data-hs-reveal')) p = ctl.reveal(+t.getAttribute('data-hs-reveal'));
          else if (a === 'arm') p = ctl.arm(typeof h.startAt === 'function' ? h.startAt() : 0);
          else if (a === 'test') p = ctl.armTest(TEST_MIN);
          else if (a === 'go') p = ctl.go();
          else if (a === 'end') p = ctl.end();
          if (p) p.then(function () { var b = sheet(); if (b && b.isOpen()) ctl.render(b.body); });
        });
        sh.addEventListener('change', function (ev) {
          var t = ev.target && ev.target.getAttribute ? ev.target : null; if (!t || !t.hasAttribute('data-hs-pick')) return;
          if (!ctl.setPick(+t.getAttribute('data-hs-pick'), t.value)) say('That NPC cannot be shown.', true);
          var b = sheet(); if (b && b.isOpen()) ctl.render(b.body);
        });
      }
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.close = function () { var b = sheet(); if (b) b.close(); };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, poolOf: poolOf, SLOTS: SLOTS, TEST_MIN: TEST_MIN, PATHS: PATHS };
});
