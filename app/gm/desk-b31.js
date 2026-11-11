/* gm/desk-b31.js — the page's seam for the canon queue, the front page and the absent packet (suite A4, 5.2, 5.7; switches ai.canon, between.frontpage, between.absent).

   Plain script, UMD: window.B68GmDeskB31 in the browser, module.exports under Node. gm/room-desk.js asks it for one controller per Menu line. Each exists only
   while its own switch is on (room-desk checks), so with all three off nothing here draws, fetches or writes.

   make(which, host, shared) -> controller | null      which: 'canon' | 'frontpage' | 'absent'
     host:   room-desk's host ({ show, toast, root, now, ... }). shared: an object room-desk keeps, so the absent packet reads the SAME front page controller.
   browserHost(W) -> { docs, members, characters, npcs, print }   the GM page's fetch layer (GET/PUT/DELETE on the app's own /api), injectable in tests.

   The canon desk is a read-only preview of the queue note: paste it, see how many lines are ticked and which are GM-only. It writes nothing; the writing is
   `npm run gm:canon-apply` on the laptop (scripts/gm-canon-apply.mjs), which has no model. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmDeskB31 = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function req(name, path) { if (W && W[name]) return W[name]; try { return require(path); } catch (e) { return null; } }

  function jfetch(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return W.fetch('/api' + path, opts).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } throw new Error((j && j.error) || 'HTTP ' + res.status); });
      return res.json();
    });
  }
  function browserHost() {
    return {
      docs: {
        get: function (kind, owner) { return jfetch('GET', '/docs?kind=' + encodeURIComponent(kind) + '&owner=' + encodeURIComponent(owner) + '&limit=1').then(function (j) { var r = (Array.isArray(j.docs) ? j.docs : [])[0]; return r ? r.json : null; }); },
        put: function (row) { return jfetch('PUT', '/docs', row); },
        del: function (kind, owner) { return jfetch('DELETE', '/docs?kind=' + encodeURIComponent(kind) + '&owner=' + encodeURIComponent(owner)); }
      },
      members: function () { return jfetch('GET', '/members').then(function (j) { return (Array.isArray(j.members) ? j.members : []).filter(function (m) { return m && m.role === 'player'; }).map(function (m) { return { id: str(m.id), name: str(m.name) }; }); }); },
      characters: function () { return jfetch('GET', '/characters').then(function (j) { return Array.isArray(j.docs) ? j.docs.filter(function (d) { return isObj(d) && isObj(d.doc); }) : []; }); },
      npcs: function () { return jfetch('GET', '/npcs').then(function (j) { var l = Array.isArray(j.npcs) ? j.npcs : Array.isArray(j.docs) ? j.docs : []; return l.map(function (d) { return isObj(d) && isObj(d.doc) ? d.doc : d; }).filter(isObj); }); },
      print: function (html) { var w = W.open('', '_blank'); if (!w) return false; w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(function () { try { w.print(); } catch (e) { /* the sheet is open; print by hand */ } }, 300); return true; }
    };
  }

  function canonDesk(h) {
    var C = req('B68GmCanon', './canon.js'), ctl = {}, text = '';
    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'canon', 'Canon queue') : null; }
    ctl.preview = function (t) {
      var p = C ? C.parseQueue(t) : { items: [], warnings: [] }, s = C ? C.summary(p.items) : {};
      return { items: p.items, warnings: p.warnings, summary: s };
    };
    ctl.html = function (t) {
      var r = ctl.preview(t), s = r.summary;
      var out = '<p class="gm-dim">Paste the queue note to see what ticking would do. This writes nothing. To apply it, run <code>npm run gm:canon-apply -- --queue "&lt;the note&gt;" --yes</code> on the laptop.</p>' +
        '<div class="gm-sb-row"><textarea data-cq-text rows="6" style="width:100%"></textarea></div><div class="gm-sb-row"><button type="button" class="btn sm primary" data-cq="check">Check it</button></div>';
      if (r.items.length || r.warnings.length) {
        out += '<p><b>' + s.ticked + '</b> ticked (' + s.tickedGmOnly + ' GM-only, ' + s.tickedPlayerSafe + ' player-safe), <b>' + s.unticked + '</b> left unticked.</p><ul>' +
          r.items.map(function (i) { return '<li>' + (i.done ? '[x]' : '[ ]') + ' ' + (i.scope === 'player' ? 'player-safe' : 'GM-only') + ' ' + esc(i.kind) + ' ' + esc(i.target) + '</li>'; }).join('') + '</ul>' +
          r.warnings.map(function (w) { return '<p class="gm-dim">line ' + w.line + ': ' + esc(w.msg) + '</p>'; }).join('');
      }
      return out;
    };
    ctl.render = function (box) {
      if (!box) return;
      box.innerHTML = ctl.html(text);
      var ta = box.querySelector('[data-cq-text]'); if (ta) ta.value = text;
      var sh = box.parentNode;
      if (sh && !sh.__cq) {
        sh.__cq = true;
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-cq]') : null; if (!t) return;
          var e = sh.querySelector('[data-cq-text]'); text = e ? e.value : ''; ctl.render(box);
        });
      }
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  function make(which, host, shared) {
    var h = host || {}, sh = isObj(shared) ? shared : {};
    if (which === 'canon') return sh.canon || (sh.canon = canonDesk(h));
    var bh = sh.bh || (sh.bh = (h.net || (W && W.fetch ? browserHost() : null)));
    var Fp = req('B68GmFrontPage', './frontpage.js'), Ab = req('B68GmAbsent', './absent.js');
    if (which === 'frontpage') {
      if (!Fp || !bh) return null;
      return sh.frontpage || (sh.frontpage = Fp.make({ docs: bh.docs, show: h.show, toast: h.toast, root: h.root, now: h.now, print: bh.print }));
    }
    if (which === 'absent') {
      if (!Ab || !bh) return null;
      return sh.absent || (sh.absent = Ab.make({ members: bh.members, characters: bh.characters, npcs: bh.npcs, docs: bh.docs, toast: h.toast, root: h.root, now: h.now, away: h.away,      /* KS12.6: h.away (night.who) */
        frontPage: function () { var f = make('frontpage', h, sh); return f ? f.current() : Promise.resolve(null); } }));
    }
    return null;
  }

  return { make: make, browserHost: browserHost };
});
