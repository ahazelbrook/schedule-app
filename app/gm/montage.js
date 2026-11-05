/* gm/montage.js — Montage mode (suite 2.8, switch map.montage). GM side only.

   Plain script, UMD: window.B68GmMontage in the browser, module.exports under Node.

   WHAT IT DOES. When the score has passed its time budget, one tap (Menu -> Montage -> Split the iPad) splits the iPad into one panel per player character, two to four of
   them. Each panel has a figure (the character's initial), a place and one line. A marked roll resolves a panel (a stamp on it). One tap collapses it back to the single scene.
   THE WIRE. A lasting layer, never an overlay, so a stamp's report card can stand over the panels while a roll is resolved: data.montage { panels: [{ pcId, name, room, line, done }] }
   (functions/_lib/show-montage.js) and scene.layout montage (the contract already had it). Both are cleared on Collapse. The iPad draws it in app/display/montage.js.
   SECRECY. A place is offered, and sent, only if it is one of the rooms the players already know (host.rooms()); a typed line is scanned for hidden names by the server on write.
   THE BUDGET. host.over() says whether the score is past its budget: true / false, or null when no phase is running and so there is no budget yet. The tap is
   always there; when the score is still within its budget (or there is no budget) the button says so and still works.
   WHICH PANEL A MARKED ROLL RESOLVES. The one the GM last tapped "Rolling" on; else the unresolved panel whose place is the crew's room; else the only unresolved one.

   API
     make(host) -> ctl { view(), pick(id, yes), setRoom(id, name), setLine(id, text), focus(id), split(), update(), resolve(id), marked(), collapse(), active(), render(box), open(), toggle(), destroy() }
       host: { on(id), pcs() -> [{ id, name }], rooms() -> [name], over() -> bool | null, room() -> the crew's room name, layer(path, value) -> Promise<answer | null>,
               log(text), toast(msg, bad), root() } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmMontage = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'map.montage', MIN = 2, MAX = 4, LINE_MAX = 100, NAME_MAX = 40, ROOM_MAX = 60;
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function one(v, max) { var t = str(v).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max).trim() : t; }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function make(host) {
    var h = host || {};
    var st = { pickd: {}, room: {}, line: {}, done: {}, rolling: '', live: false, box: null };
    function on() { return typeof h.on === 'function' && h.on(SWITCH) === true; }
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad); }
    function pcs() { var a = typeof h.pcs === 'function' ? h.pcs() : []; return (Array.isArray(a) ? a : []).filter(function (c) { return c && str(c.id); }); }
    function rooms() { var a = typeof h.rooms === 'function' ? h.rooms() : []; return (Array.isArray(a) ? a : []).map(str).filter(Boolean); }
    function send(path, v) { return typeof h.layer === 'function' ? Promise.resolve(h.layer(path, v)).then(function (r) { return r; }, function () { return null; }) : Promise.resolve(null); }
    function redraw() { if (st.box) ctl.render(st.box); }

    /* the panels now picked, in the page's PC order; a place that is no longer a known room is dropped, so a stale choice never goes out */
    function panels() {
      var known = rooms();
      return pcs().filter(function (c) { return st.pickd[c.id]; }).map(function (c) {
        var o = { pcId: str(c.id), name: one(c.name, NAME_MAX) }, rm = one(st.room[c.id], ROOM_MAX), ln = one(st.line[c.id], LINE_MAX);
        if (!o.name) delete o.name;
        if (rm && known.indexOf(rm) >= 0) o.room = rm;
        if (ln) o.line = ln;
        if (st.done[c.id]) o.done = true;
        return o;
      });
    }
    function push() {
      var p = panels();
      if (p.length < MIN || p.length > MAX) return Promise.resolve(false);
      return send('data.montage', { panels: p }).then(function (r) {
        if (r === null) return false;
        return send('scene.layout', 'montage').then(function () { return true; });
      });
    }

    var ctl = {
      active: function () { return st.live; },
      view: function () {
        var over = typeof h.over === 'function' ? h.over() : null, known = rooms(), list = pcs();
        return { on: on(), live: st.live, over: over === true ? true : over === false ? false : null, rooms: known, count: panels().length, min: MIN, max: MAX,
          pcs: list.map(function (c) { return { id: str(c.id), name: one(c.name, NAME_MAX) || 'Unnamed', picked: !!st.pickd[c.id], room: known.indexOf(st.room[c.id]) >= 0 ? st.room[c.id] : '', line: str(st.line[c.id]), done: !!st.done[c.id], rolling: st.rolling === c.id }; }) };
      },
      pick: function (id, yes) {
        if (!on()) return false;
        if (yes && !st.pickd[id] && panels().length >= MAX) { say('A montage holds at most ' + MAX + ' characters.', true); redraw(); return false; }
        st.pickd[id] = !!yes; if (!yes && st.rolling === id) st.rolling = '';
        if (st.live) { ctl.update(); return true; }
        redraw(); return true;
      },
      setRoom: function (id, name) {
        if (!on()) return false;
        var n = one(name, ROOM_MAX);
        if (n && rooms().indexOf(n) < 0) { say('The players have not seen that place yet.', true); redraw(); return false; }
        st.room[id] = n; if (st.live) ctl.update();
        return true;
      },
      setLine: function (id, text) { if (!on()) return false; st.line[id] = one(text, LINE_MAX); return true; },
      focus: function (id) { st.rolling = st.rolling === id ? '' : id; redraw(); return st.rolling; },
      /* send again after an edit while the montage is up */
      update: function () { return push().then(function (ok) { redraw(); return ok; }); },
      split: function () {
        if (!on()) return Promise.resolve(false);
        var n = panels().length;
        if (n < MIN) { say('Pick at least ' + MIN + ' characters for a montage.', true); return Promise.resolve(false); }
        st.done = {};
        return push().then(function (ok) {
          if (ok) { st.live = true; if (typeof h.log === 'function') h.log('Montage: ' + n + ' panels on the iPad.'); say('The iPad is split into ' + n + ' panels.'); }
          else say('Could not split the iPad.', true);
          redraw(); return ok;
        });
      },
      resolve: function (id) {
        if (!on() || !st.live || !st.pickd[id] || st.done[id]) return Promise.resolve(false);
        st.done[id] = true;
        return push().then(function (ok) { if (ok && typeof h.log === 'function') h.log('Montage: a panel resolved.'); redraw(); return ok; });
      },
      /* a roll was marked: resolve the panel it belongs to (see the header) */
      marked: function () {
        if (!on() || !st.live) return Promise.resolve(false);
        var open = pcs().filter(function (c) { return st.pickd[c.id] && !st.done[c.id]; }), pick = null, here = typeof h.room === 'function' ? str(h.room()) : '', i;
        if (st.rolling && open.some(function (c) { return c.id === st.rolling; })) pick = st.rolling;
        else {
          if (here) for (i = 0; i < open.length; i++) if (st.room[open[i].id] === here) { pick = open[i].id; break; }
          if (!pick && open.length === 1) pick = open[0].id;
        }
        return pick ? ctl.resolve(pick) : Promise.resolve(false);
      },
      collapse: function () {
        if (!st.live) return Promise.resolve(false);
        st.live = false; st.done = {}; st.rolling = '';
        return send('data.montage', null).then(function () { return send('scene.layout', null); }).then(function () {
          if (typeof h.log === 'function') h.log('Montage: back to one scene.');
          redraw(); return true;
        });
      },
      destroy: function () { st.box = null; }
    };

    ctl.render = function (box) {
      if (!box) return;
      st.box = box;
      var v = ctl.view();
      if (!v.on) { box.innerHTML = '<p class="gm-empty">Montage is off.</p>'; return; }
      var note = v.over === true ? 'The score is past its budget.' : v.over === false ? 'The score is still within its budget.' : 'No budget yet: no phase is running.';
      var html = '<p class="gm-dim">' + esc(note) + ' Pick two to four characters; each gets a panel with a place and a line.</p>';
      html += v.pcs.length ? v.pcs.map(function (c) {
        return '<div class="gm-sb-row" data-mt-row="' + esc(c.id) + '"><label><input type="checkbox" data-mt-pick="' + esc(c.id) + '"' + (c.picked ? ' checked' : '') + '> <b>' + esc(c.name) + '</b></label> ' +
          '<select data-mt-room="' + esc(c.id) + '" aria-label="Place for ' + esc(c.name) + '"><option value="">(no place)</option>' + v.rooms.map(function (r) { return '<option' + (r === c.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select> ' +
          '<input type="text" maxlength="' + LINE_MAX + '" data-mt-line="' + esc(c.id) + '" value="' + esc(c.line) + '" placeholder="one line" aria-label="Line for ' + esc(c.name) + '">' +
          (v.live ? ' <button type="button" class="btn sm' + (c.rolling ? ' primary' : '') + '" data-mt="rolling" data-id="' + esc(c.id) + '">Rolling</button> <button type="button" class="btn sm" data-mt="resolve" data-id="' + esc(c.id) + '"' + (c.done || !c.picked ? ' disabled' : '') + '>' + (c.done ? 'Resolved' : 'Resolve') + '</button>' : '') + '</div>';
      }).join('') : '<p class="gm-empty">No characters on the table.</p>';
      html += '<div class="gm-sb-row">' + (v.live ? '<button type="button" class="btn sm primary" data-mt="collapse" title="The panels come down: back to one scene">Take it down</button> <button type="button" class="btn sm" data-mt="split">Send changes</button>'
        : '<button type="button" class="btn sm primary" data-mt="split"' + (v.count < MIN ? ' disabled' : '') + '>' + (v.over === false ? 'Split anyway' : 'Split the iPad') + '</button>') + '</div>';
      box.innerHTML = html;
      var sh = box.parentNode;
      if (sh && !sh.__mt) {
        sh.__mt = true;
        sh.addEventListener('change', function (ev) {
          var t = ev.target; if (!t || !t.hasAttribute) return;
          if (t.hasAttribute('data-mt-pick')) ctl.pick(t.getAttribute('data-mt-pick'), t.checked);
          else if (t.hasAttribute('data-mt-room')) ctl.setRoom(t.getAttribute('data-mt-room'), t.value);
          else if (t.hasAttribute('data-mt-line')) ctl.setLine(t.getAttribute('data-mt-line'), t.value);
        });
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-mt]') : null; if (!t) return;
          var a = t.getAttribute('data-mt'), id = t.getAttribute('data-id');
          if (a === 'split') { if (st.live) ctl.update(); else ctl.split(); } else if (a === 'collapse') ctl.collapse(); else if (a === 'resolve') ctl.resolve(id); else if (a === 'rolling') ctl.focus(id);
        });
      }
    };
    function sheet() { var S = W && W.B68GmWorkshop ? W.B68GmWorkshop : null, r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'montage', 'Montage') : null; }
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, SWITCH: SWITCH, MIN: MIN, MAX: MAX };
});
