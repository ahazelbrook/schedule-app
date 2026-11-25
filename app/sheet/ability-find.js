/* sheet/ability-find.js: a search box over the abilities on a player's sheet (RK25 of the room key build; setting phone.find).

   Window.B68AbilityFind, and module.exports under Node. A lazy bundle (routes.js 'phone-find'): boot.js fetches it only while phone.find is on, for a player only, and calls
   start() / stop() from every campaign arrival. With the setting off nothing is fetched, nothing is drawn and no listener is added.

   WHAT IT DOES. A box over each place the sheet lists abilities: type a few letters of a name and the rows that do not match go away; clear the box and they come back.
   It only hides rows. It never edits the character, so it has no Undo, makes no request and reads nothing but what the page already holds (the rows on screen).
     abbox   the classic sheet's abilities box (tracker.js abilities(): the playbook's abilities and the Hull's frame features; the Versatile row, which holds the add
             control, is never hidden)
     strip   the abilities strip in the mark and roll panels (tracker.js abStrip(): the player's own and the crew's, both groups at once)
     abs     the glance screen's "Your abilities" sheet (sheet/glance.js), which is where the glance puts the whole list
   MATCHING. Case, accents and apostrophes are ignored; every word typed must be found in the ability's NAME. If no name has them all, it looks in the rule TEXT instead
   and says so. A line under the box says "2 of 9" (or that nothing matches). The query lives here, so a sheet that redraws around the box keeps it.
   A scope's query is dropped when its box leaves the page (the strip folded, the glance sheet closed).

   SEAMS (one line each): tracker.js asks box('abbox') at the head of the abilities box and box('strip') at the head of the open strip, and calls apply(root) after every
   render; glance.js asks box('abs') for the abilities sheet's body and calls apply(layer, 'gl') whenever it draws that sheet. All three are no-ops while this is not started.
   Its few styles are one <style> this file adds on start() and takes away on stop(): the box's own classes and the one rule that hides a row ([data-abf-off]).

   API: start() stop() box(scope) -> markup ('' when not started) apply(root, kind) -> bool state()
   pure (Node tests): norm(s) terms(q) match(items, q) -> { keep: [bool], shown, total, tier } (tier 0 no query, 1 by name, 2 in the text, 3 nothing) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68AbilityFind = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var STYLE_ID = 'b68-abf-css';
  var SCOPES = {
    abbox: { kind: 'sheet', host: '.ds-abbox', rows: '.ds-ab, .ds-feat', group: '' },
    strip: { kind: 'sheet', host: '.ds-abstrip-b', rows: '.ds-abi', group: '.ds-abgrp' },
    abs: { kind: 'gl', host: '.gl-sh-b', rows: '.gl-abt', group: '', fresh: true }
  };
  var S = { on: false, q: {} };

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function closest(n, sel) { return n && typeof n.closest === 'function' ? n.closest(sel) : null; }

  /* ---------- pure ---------- */
  function norm(s) {
    s = str(s).toLowerCase();
    try { if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* no normalize: accents stay */ }
    return s.replace(/['‘’`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '');
  }
  function terms(q) { var n = norm(q); return n ? n.split(' ') : []; }
  function hasAll(hay, ts) { for (var i = 0; i < ts.length; i++) if (hay.indexOf(ts[i]) < 0) return false; return true; }
  /* items: [{ n, t }]. Names first; the rule text only when no name has every word. */
  function match(items, q) {
    items = Array.isArray(items) ? items : [];
    var ts = terms(q), keep = [], shown = 0, tier = 1, i;
    if (!ts.length) { for (i = 0; i < items.length; i++) keep.push(true); return { keep: keep, shown: items.length, total: items.length, tier: 0 }; }
    for (i = 0; i < items.length; i++) { var k = hasAll(norm(items[i] && items[i].n), ts); keep.push(k); if (k) shown++; }
    if (!shown) {
      tier = 2;
      for (i = 0; i < items.length; i++) { var k2 = hasAll(norm((items[i] && items[i].n) + ' ' + (items[i] && items[i].t)), ts); keep[i] = k2; if (k2) shown++; }
    }
    if (!shown) tier = 3;
    return { keep: keep, shown: shown, total: items.length, tier: tier };
  }

  /* ---------- the page ---------- */
  function rowsOf(host, sel) {
    var out = [], nodes = host.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.querySelector('.ds-addrow')) continue;   /* the Versatile row holds the add control: never hidden */
      var b = el.querySelector('b');
      out.push({ el: el, n: b ? b.textContent : '', t: el.textContent });
    }
    return out;
  }
  function setOff(el, off) {
    if (el.hasAttribute('data-abf-off') === off) return;
    if (off) el.setAttribute('data-abf-off', ''); else el.removeAttribute('data-abf-off');
  }
  function applyBox(box, k) {
    var sc = SCOPES[k], host = sc && closest(box, sc.host); if (!host) return;
    var inp = box.querySelector('input'), q = S.q[k] || '';
    if (inp && inp.value !== q) inp.value = q;
    var rows = rowsOf(host, sc.rows), r = match(rows, q);
    rows.forEach(function (x, i) { setOff(x.el, !r.keep[i]); });
    if (sc.group) {
      var gs = host.querySelectorAll(sc.group);
      for (var g = 0; g < gs.length; g++) {
        var inG = gs[g].querySelectorAll(sc.rows), on = 0;
        for (var j = 0; j < inG.length; j++) if (!inG[j].hasAttribute('data-abf-off')) on++;
        setOff(gs[g], inG.length > 0 && on === 0);
      }
    }
    var line = box.querySelector('.abf-n'), x = box.querySelector('[data-abf-clear]'), msg = '';
    if (r.tier === 3) msg = 'No ability matches “' + str(q).trim() + '”.';
    else if (r.tier) msg = r.shown + ' of ' + r.total + (r.tier === 2 ? ', found in the rule text' : '');
    if (line) { if (line.textContent !== msg) line.textContent = msg; line.hidden = !msg; }
    if (x) x.hidden = !q;
  }
  /* the sheet redrew (or the glance sheet drew): put each box's query back and filter again */
  function apply(rootEl, kind) {
    if (!S.on || !rootEl || typeof rootEl.querySelectorAll !== 'function') return false;
    var gl = kind === 'gl';
    Object.keys(SCOPES).forEach(function (k) {
      var sc = SCOPES[k]; if ((sc.kind === 'gl') !== gl) return;
      var boxes = rootEl.querySelectorAll('[data-abf-box="' + k + '"]');
      if (!boxes.length) { if (!sc.fresh) delete S.q[k]; return; }   /* a box that left the page takes its query with it (the glance sheet's is cleared when the next one opens) */
      for (var i = 0; i < boxes.length; i++) {
        if (sc.fresh && !boxes[i].__abf) S.q[k] = '';   /* a sheet that opened: a clean box */
        boxes[i].__abf = true;
        applyBox(boxes[i], k);
      }
    });
    return true;
  }
  function box(k) {
    if (!S.on || !SCOPES[k]) return '';
    return '<div class="abf" data-abf-box="' + k + '"><div class="abf-r"><input type="search" class="abf-in ds-newfind' + k + '" data-abf="' + k + '" data-always="1"' +
      ' placeholder="Find an ability" aria-label="Find an ability" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
      '<button type="button" class="abf-x" data-abf-clear="' + k + '" data-always="1" hidden>Clear</button></div><p class="abf-n" role="status" aria-live="polite" hidden></p></div>';
  }

  /* ---------- events (one set on the document, added by start()) ---------- */
  function onInput(e) {
    var t = e && e.target, k = t && typeof t.getAttribute === 'function' ? t.getAttribute('data-abf') : null;
    if (!S.on || !k || !SCOPES[k]) return;
    S.q[k] = str(t.value);
    var b = closest(t, '[data-abf-box]'); if (b) applyBox(b, k);
  }
  function onClick(e) {
    var x = closest(e && e.target, '[data-abf-clear]'); if (!S.on || !x) return;
    var k = x.getAttribute('data-abf-clear'), b = closest(x, '[data-abf-box]'); if (!SCOPES[k] || !b) return;
    S.q[k] = ''; applyBox(b, k);
    var i = b.querySelector('input'); if (i) { try { i.focus({ preventScroll: true }); } catch (err) { /* gone */ } }
  }
  function onKey(e) {
    var t = e && e.target; if (!S.on || !e || e.key !== 'Enter' || !t || typeof t.getAttribute !== 'function' || !t.getAttribute('data-abf')) return;
    e.preventDefault(); if (typeof t.blur === 'function') t.blur();   /* Enter puts the keyboard away */
  }
  function listen(on) {
    var d = W && W.document; if (!d || typeof d.addEventListener !== 'function') return;
    var f = on ? 'addEventListener' : 'removeEventListener';
    d[f]('input', onInput); d[f]('click', onClick); d[f]('keydown', onKey);
  }
  function css() {
    return ['#dossier .abf { display: grid; gap: 4px; margin: 0 0 8px; }',
      '#dossier .abf-r { display: flex; gap: 8px; align-items: center; }',
      '#dossier .abf-in { flex: 1 1 auto; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 6px 10px; border: 1.5px solid var(--hair, #b9b3a6);' +
        ' border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 16px; }',
      '#dossier .abf-x { flex: none; min-height: 44px; padding: 0 12px; border: 1.5px solid var(--hair, #b9b3a6); border-radius: 6px; background: transparent;' +
        ' color: inherit; font: 700 14px/1 var(--font-cond, inherit); cursor: pointer; }',
      '#dossier .abf-n { margin: 0; font-size: 14px; color: var(--ink-soft, #5a554b); }',
      '#dossier .abf [hidden] { display: none; }',
      '#dossier [data-abf-off][data-abf-off] { display: none; }',
      '@media print { #dossier .abf { display: none; } }'].join('\n');
  }
  function styleOn() {
    var d = W && W.document; if (!d || typeof d.createElement !== 'function' || !d.head || (d.getElementById && d.getElementById(STYLE_ID))) return;
    var s = d.createElement('style'); s.id = STYLE_ID; s.textContent = css(); d.head.appendChild(s);
  }
  function styleOff() { var d = W && W.document, s = d && d.getElementById ? d.getElementById(STYLE_ID) : null; if (s && s.parentNode) s.parentNode.removeChild(s); }
  /* the boxes and the hidden rows come off the page the moment it goes off */
  function unwind() {
    var d = W && W.document; if (!d || typeof d.querySelectorAll !== 'function') return;
    var b = d.querySelectorAll('[data-abf-box]'), o = d.querySelectorAll('[data-abf-off]'), i;
    for (i = 0; i < b.length; i++) if (b[i].parentNode) b[i].parentNode.removeChild(b[i]);
    for (i = 0; i < o.length; i++) o[i].removeAttribute('data-abf-off');
  }
  function redraw() { var T = W && W.B68Tracker; if (T && typeof T.refresh === 'function') { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } } }

  function start() {
    if (S.on) return null;
    S.on = true; S.q = {};
    styleOn(); listen(true); redraw();   /* the sheet is already on screen: draw it again with the boxes */
    return null;
  }
  function stop() {
    if (!S.on) return null;
    S.on = false; S.q = {};
    listen(false); unwind(); styleOff(); redraw();
    return null;
  }
  function state() { var q = {}; Object.keys(S.q).forEach(function (k) { q[k] = S.q[k]; }); return { on: S.on, q: q }; }

  return { start: start, stop: stop, box: box, apply: apply, state: state, norm: norm, terms: terms, match: match };
});
