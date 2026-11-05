/* gm/workshop.js — the right-edge sheet the Menu's tools open in (suite ticket W0.5; the night rebuild, N0).

   Window.B68GmWorkshop, and module.exports under Node (the pure part only; the DOM part runs only where there is a document).

   The Workshop drawer is gone (N0): its five items went to Settings, back to where they were, or stay put away (see gm/settings.js). What is left is the
   host every Menu tool still opens in until the shell places them inline: sheet(root, id, title), one per id, created on first use inside the GM page's
   root, so the page's own DOM is untouched until a sheet is opened. One sheet is open at a time.

   API
     sheet(root, id, title)          -> { el, body, open(), close(), isOpen(), toggle() }   (the same object each call for an id)
     _pure                           { esc } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmWorkshop = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var sheets = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---- the sheet (DOM) ---- */
  function sheet(rootEl, id, title) {
    var d = rootEl && rootEl.ownerDocument;
    if (!d) return null;
    var cur = sheets[id];
    if (cur && cur.el && cur.el.parentNode === rootEl) return cur;
    var el = d.createElement('aside');
    el.className = 'gm-sheet'; el.id = 'gm-sheet-' + id; el.setAttribute('aria-label', title); el.hidden = true;
    el.innerHTML = '<div class="gm-dhead"><h2 class="gm-sheet-h">' + esc(title) + '</h2><button type="button" class="gm-x" data-sheet-close aria-label="Close ' + esc(title) + '" title="Close (Esc)">×</button></div><div class="gm-sheet-body" tabindex="-1"></div>';
    rootEl.appendChild(el);
    var s = {
      el: el, body: el.querySelector('.gm-sheet-body'),
      isOpen: function () { return !el.hidden; },
      open: function () {
        // one sheet at a time
        Object.keys(sheets).forEach(function (k) { if (k !== id && sheets[k] && sheets[k].el && !sheets[k].el.hidden) sheets[k].close(); });
        el.hidden = false; rootEl.classList.add('sheet-open');
        try { s.body.focus(); } catch (e) {}
      },
      close: function () { el.hidden = true; if (!Object.keys(sheets).some(function (k) { return sheets[k] && sheets[k].el && !sheets[k].el.hidden; })) rootEl.classList.remove('sheet-open'); },
      toggle: function () { if (el.hidden) s.open(); else s.close(); }
    };
    el.addEventListener('click', function (ev) { var t = ev.target; if (t && t.closest && t.closest('[data-sheet-close]')) s.close(); });
    el.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { s.close(); ev.stopPropagation(); } });
    sheets[id] = s;
    return s;
  }

  return { sheet: sheet, _pure: { esc: esc } };
});
