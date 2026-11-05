/* gm/trouble.js — the Trouble Engine desk (suite ticket 5.3, switch between.trouble).

   A wizard on the laptop that walks the Aftermath's trouble checks, one table at a time, using the tables of the pack part `trouble` (read at runtime: the
   tables are GM-only text and never in this repo; with no part the desk says so, as the downtime tables do). The players roll physical dice: the GM types
   the number, the desk shows the entry it lands on. NO model call from here. The result is written by the GM, or drafted by `/blade trouble` in Claude Code
   and pasted into the desk ("Headline:", "Blurb:", "Rumour:" lines). An item is a draft until the GM approves it; only approved items feed

     the front page   a list of headlines and blurbs for Personal Business (this desk and its print view)
     the rumours      one tap puts the next approved rumour on the iPad as a title beat (the show contract, so a hidden NPC's name is refused by the server)

   Items live in the GM state document, `trouble.items` (id-keyed, capped); nothing here is ever published to a phone or the campaign document.

   Window.B68GmTrouble, and module.exports under Node.

   PURE
     checksOf(body) -> [{ id, label, prompt, die, entries: [{ lo, hi, title, md }] }]      the part's checks, cleaned and capped ([] with no usable part)
     entryFor(check, n) -> entry | null          cleanItem(raw) -> item | null          parseDraft(text) -> { headline, blurb, rumour }
     approvedOf(items) -> [item] oldest first    frontPage(items) -> [{ id, headline, blurb }]        rumours(items) -> [{ id, text }] (80 characters)
     frontHtml(items) -> printable block
   make(host) -> ctl
     host: { part(): the trouble part's body | null, items(): { id: item }, save(id, item | null) -> void, show(kind, payload, opts) -> Promise, toast(msg, bad?), root?(), now?() }
     ctl.checks()  ctl.step() -> { i, check, roll, entry } | null   ctl.go(i)  ctl.next()  ctl.back()  ctl.setRoll(n)
     ctl.draft(fields) -> item   (from the current step; fields { headline, blurb, rumour })   ctl.approve(id, on)   ctl.drop(id)
     ctl.nextRumour() -> Promise      ctl.open() ctl.toggle() ctl.render(box) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmTrouble = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var MAX_CHECKS = 12, MAX_ENTRIES = 100, MAX_ITEMS = 60, RUMOUR_MAX = 80;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function line(v, max) { var t = str(v).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1).trim() + '…' : t; }
  function whole(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function checksOf(body) {
    var raw = isObj(body) && Array.isArray(body.checks) ? body.checks : [], out = [];
    raw.slice(0, MAX_CHECKS).forEach(function (c, i) {
      if (!isObj(c) || !Array.isArray(c.entries)) return;
      var es = [];
      c.entries.slice(0, MAX_ENTRIES).forEach(function (e) {
        if (!isObj(e) || !whole(e.lo) || !whole(e.hi) || e.hi < e.lo) return;
        es.push({ lo: e.lo, hi: e.hi, title: line(e.title, 80), md: str(e.md).slice(0, 1200) });
      });
      if (!es.length) return;
      out.push({ id: /^[A-Za-z0-9_-]{1,40}$/.test(str(c.id)) ? c.id : 'c' + i, label: line(c.label, 60) || 'Check ' + (out.length + 1), prompt: line(c.prompt, 200), die: line(c.die, 8), entries: es });
    });
    return out;
  }
  function entryFor(check, n) {
    if (!check || !whole(n)) return null;
    for (var i = 0; i < check.entries.length; i++) if (n >= check.entries[i].lo && n <= check.entries[i].hi) return check.entries[i];
    return null;
  }
  function cleanItem(r) {
    if (!isObj(r) || !/^[A-Za-z0-9_-]{1,60}$/.test(str(r.id))) return null;
    var headline = line(r.headline, 100); if (!headline) return null;
    return { id: r.id, check: line(r.check, 60), roll: whole(r.roll) ? r.roll : null, title: line(r.title, 80), headline: headline, blurb: line(r.blurb, 400), rumour: line(r.rumour, RUMOUR_MAX),
      status: r.status === 'approved' ? 'approved' : 'draft', at: typeof r.at === 'number' && isFinite(r.at) ? r.at : 0 };
  }
  /* "/blade trouble" prints a draft as lines; accept them in any order, any case, with or without the bullet */
  function parseDraft(text) {
    var out = { headline: '', blurb: '', rumour: '' };
    str(text).split(/\r?\n/).forEach(function (l) {
      var m = /^\s*[-*]?\s*\**\s*(headline|blurb|rumou?r)\s*\**\s*[:\-]\s*\**\s*(.*)$/i.exec(l); if (!m) return;
      var k = m[1].toLowerCase(); k = k === 'headline' ? 'headline' : k === 'blurb' ? 'blurb' : 'rumour';
      out[k] = line(m[2].replace(/\*+$/, ''), k === 'blurb' ? 400 : k === 'rumour' ? RUMOUR_MAX : 100);
    });
    return out;
  }
  function itemsOf(items) {
    var out = [];
    Object.keys(isObj(items) ? items : {}).forEach(function (k) { var it = cleanItem(items[k]); if (it) out.push(it); });
    return out.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
  }
  function approvedOf(items) { return itemsOf(items).filter(function (i) { return i.status === 'approved'; }); }
  function frontPage(items) { return approvedOf(items).map(function (i) { return { id: i.id, headline: i.headline, blurb: i.blurb }; }); }
  function rumours(items) { return approvedOf(items).filter(function (i) { return i.rumour; }).map(function (i) { return { id: i.id, text: i.rumour }; }); }
  function frontHtml(items) {
    var f = frontPage(items);
    return f.length ? f.map(function (i) { return '<article class="gm-tr-story"><h4>' + esc(i.headline) + '</h4>' + (i.blurb ? '<p>' + esc(i.blurb) + '</p>' : '') + '</article>'; }).join('') : '<p class="gm-empty">Nothing approved yet.</p>';
  }

  function make(host) {
    var h = host || {}, ctl = {}, cur = 0, roll = null, ru = 0, seq = 0;
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad); }
    function items() { return typeof h.items === 'function' ? h.items() : {}; }
    ctl.checks = function () { return checksOf(typeof h.part === 'function' ? h.part() : null); };
    ctl.step = function () {
      var cs = ctl.checks(); if (!cs.length) return null;
      cur = Math.max(0, Math.min(cs.length - 1, cur));
      return { i: cur, n: cs.length, check: cs[cur], roll: roll, entry: entryFor(cs[cur], roll) };
    };
    ctl.go = function (i) { cur = whole(i) ? i : 0; roll = null; return ctl.step(); };
    ctl.next = function () { cur++; roll = null; return ctl.step(); };
    ctl.back = function () { cur--; roll = null; return ctl.step(); };
    ctl.setRoll = function (n) { roll = whole(n) ? n : null; return ctl.step(); };
    ctl.draft = function (f) {
      var st = ctl.step(); if (!st) { say('There are no trouble tables on this laptop (load the pack).', true); return null; }
      var base = isObj(f) ? f : {}, now = typeof h.now === 'function' ? h.now() : Date.now();
      if (Object.keys(items()).length >= MAX_ITEMS) { say('The desk holds ' + MAX_ITEMS + ' items; drop some first.', true); return null; }
      var it = cleanItem({ id: 't' + now.toString(36) + (++seq), check: st.check.label, roll: st.roll, title: st.entry ? st.entry.title : '', headline: base.headline, blurb: base.blurb, rumour: base.rumour, status: 'draft', at: now });
      if (!it) { say('Write a headline first (or paste a draft).', true); return null; }
      if (typeof h.save === 'function') h.save(it.id, it);
      return it;
    };
    ctl.approve = function (id, on) {
      var it = cleanItem(items()[id]); if (!it) return false;
      it.status = on === false ? 'draft' : 'approved';
      if (typeof h.save === 'function') h.save(id, it);
      return true;
    };
    ctl.drop = function (id) { if (!isObj(items()[id])) return false; if (typeof h.save === 'function') h.save(id, null); return true; };
    ctl.nextRumour = function () {
      var rs = rumours(items()); if (!rs.length) { say('No approved rumours yet.', true); return Promise.resolve(null); }
      var r = rs[ru % rs.length]; ru++;
      return Promise.resolve(h.show('title', { text: r.text, sub: 'Rumour' }, { ms: 8000, key: 'rumour-' + r.id + '-' + ru }));
    };

    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'trouble', 'Trouble desk') : null; }
    ctl.html = function () {
      var st = ctl.step(), all = itemsOf(items()), out = '';
      if (!st) out += '<p class="gm-empty">No trouble tables on this laptop. Load the pack with the <code>trouble</code> part to walk the checks; you can still write items by hand below.</p>';
      else {
        out += '<div class="gm-sb-row"><button type="button" class="btn sm" data-tr="back"' + (st.i ? '' : ' disabled') + '>Back</button> <b>' + esc(st.check.label) + '</b> <span class="gm-dim">' + (st.i + 1) + ' of ' + st.n + '</span> ' +
          '<button type="button" class="btn sm" data-tr="next"' + (st.i + 1 < st.n ? '' : ' disabled') + '>Next check</button></div>' + (st.check.prompt ? '<p class="gm-dim">' + esc(st.check.prompt) + '</p>' : '') +
          '<div class="gm-sb-row"><label>Roll' + (st.check.die ? ' (' + esc(st.check.die) + ')' : '') + ': <input type="number" inputmode="numeric" data-tr-roll value="' + (st.roll === null ? '' : st.roll) + '"></label></div>' +
          (st.roll !== null ? (st.entry ? '<div class="gm-tr-entry"><b>' + esc(st.entry.title) + '</b><div class="gm-dim">' + esc(st.entry.md) + '</div></div>' : '<p class="gm-empty">That number is not on this table.</p>') : '');
      }
      out += '<h3>Write it up</h3><div class="gm-sb-row"><label>Headline <input type="text" data-tr-f="headline" maxlength="100"></label></div>' +
        '<div class="gm-sb-row"><label>Blurb <input type="text" data-tr-f="blurb" maxlength="400"></label></div><div class="gm-sb-row"><label>Rumour <input type="text" data-tr-f="rumour" maxlength="' + RUMOUR_MAX + '"></label></div>' +
        '<div class="gm-sb-row"><label>Paste a <code>/blade trouble</code> draft <textarea data-tr-paste rows="3"></textarea></label></div>' +
        '<div class="gm-sb-row"><button type="button" class="btn sm primary" data-tr="draft">Keep as a draft</button></div>';
      out += '<h3>Items</h3>' + (all.length ? all.map(function (i) {
        return '<div class="gm-sb-row"><b>' + esc(i.headline) + '</b> <span class="gm-dim">' + esc(i.check) + (i.roll === null ? '' : ' · ' + i.roll) + ' · ' + i.status + '</span> ' +
          '<button type="button" class="btn sm' + (i.status === 'approved' ? '' : ' primary') + '" data-tr-ap="' + esc(i.id) + '">' + (i.status === 'approved' ? 'Unapprove' : 'Approve') + '</button> <button type="button" class="btn sm" data-tr-drop="' + esc(i.id) + '">Drop</button></div>';
      }).join('') : '<p class="gm-empty">No items yet.</p>');
      out += '<h3>Front page</h3><div class="gm-tr-front">' + frontHtml(items()) + '</div><div class="gm-sb-row"><button type="button" class="btn sm" data-tr="rumour"' + (rumours(items()).length ? '' : ' disabled') + '>Show the next rumour on iPad</button></div>';
      return out;
    };
    ctl.render = function (box) {
      if (!box) return;
      box.innerHTML = ctl.html();
      var sh = box.parentNode;
      if (sh && !sh.__tr) {
        sh.__tr = true;
        function val(k) { var e = sh.querySelector('[data-tr-f="' + k + '"]'); return e ? e.value : ''; }
        sh.addEventListener('input', function (ev) {
          var t = ev.target; if (!t || !t.hasAttribute) return;
          if (t.hasAttribute('data-tr-paste')) {
            var d = parseDraft(t.value); ['headline', 'blurb', 'rumour'].forEach(function (k) { var e = sh.querySelector('[data-tr-f="' + k + '"]'); if (e && d[k]) e.value = d[k]; });
          }
        });
        sh.addEventListener('change', function (ev) { var t = ev.target; if (t && t.hasAttribute && t.hasAttribute('data-tr-roll')) { ctl.setRoll(t.value === '' ? null : +t.value); ctl.render(box); } });
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-tr],[data-tr-ap],[data-tr-drop]') : null; if (!t) return;
          if (t.hasAttribute('data-tr-ap')) { var id = t.getAttribute('data-tr-ap'), it = cleanItem(items()[id]); ctl.approve(id, !(it && it.status === 'approved')); }
          else if (t.hasAttribute('data-tr-drop')) ctl.drop(t.getAttribute('data-tr-drop'));
          else { var a = t.getAttribute('data-tr'); if (a === 'next') ctl.next(); else if (a === 'back') ctl.back(); else if (a === 'rumour') { ctl.nextRumour(); return; } else if (a === 'draft') ctl.draft({ headline: val('headline'), blurb: val('blurb'), rumour: val('rumour') }); }
          ctl.render(box);
        });
      }
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, checksOf: checksOf, entryFor: entryFor, cleanItem: cleanItem, parseDraft: parseDraft, approvedOf: approvedOf, frontPage: frontPage, rumours: rumours, frontHtml: frontHtml };
});
