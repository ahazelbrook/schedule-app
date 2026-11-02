/* gm/workshop.js — the right-edge sheet the Menu opens, and the Workshop's shell (suite ticket W0.5).

   Window.B68GmWorkshop, and module.exports under Node (the pure part only; the DOM part runs only where there is a document).

   The Workshop is where a tool goes when the census says it is rarely used: Menu -> Workshop lists every tool registered with workshop: true
   (gm/tools.js) and opens one in the sheet. It is a shell: no built-in tool lives there yet (spine.workshop, a later ticket, moves the first ones in). With
   nothing registered the Menu has no Workshop line at all, so the page is today's.

   sheet(root, id, title) is the shared right-edge panel (also the Switchboard's): one per id, created on first use inside the GM page's root, so the page's own
   DOM is untouched until a sheet is opened.

   API
     menuLine()                      -> '' when no tool is behind the Workshop, else the Menu's button html (data-gm="workshop")
     sheet(root, id, title)          -> { el, body, open(), close(), isOpen(), toggle() }   (the same object each call for an id)
     open(root, host) toggle(root, host) close(root)   the Workshop sheet: a list of tools, a tool opens in place (host: { toast })
     list()                          -> [{ id, label }] the tools behind the Workshop
     _pure                           { menuLine, list } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmWorkshop = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var sheets = {};
  function tools() { return W && W.B68GmTools ? W.B68GmTools : (typeof require === 'function' ? safeRequire() : null); }
  function safeRequire() { try { return require('./tools.js'); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function list() {
    var T = tools();
    return T ? T.workshop().map(function (t) { return { id: t.id, label: t.label }; }) : [];
  }
  function menuLine() {
    return list().length ? '<button type="button" data-gm="workshop" id="gm-menu-workshop" title="Tools put away until you need them">Workshop</button>' : '';
  }

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

  /* ---- the Workshop ---- */
  var cur = { tool: '' };
  function render(rootEl, host) {
    var s = sheet(rootEl, 'workshop', 'Workshop'); if (!s) return null;
    var T = tools(), ts = T ? T.workshop() : [];
    var h = '<p class="gm-dim">Tools put away until you need them. Nothing here changes the night.</p>';
    if (!ts.length) h += '<p class="gm-empty">No tools in the Workshop.</p>';
    else h += '<div class="gm-ws-list" role="list">' + ts.map(function (t) { return '<button type="button" class="chip" role="listitem" data-ws="' + esc(t.id) + '" aria-pressed="' + (cur.tool === t.id) + '">' + esc(t.label) + '</button>'; }).join('') + '</div><div class="gm-ws-tool" id="gm-ws-tool"></div>';
    s.body.innerHTML = h;
    if (!s.__wired) {
      s.__wired = true;
      s.el.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-ws]') : null; if (!b) return;
        cur.tool = b.getAttribute('data-ws'); render(rootEl, host); mountTool(s, host);
      });
    }
    if (cur.tool) mountTool(s, host);
    return s;
  }
  function mountTool(s, host) {
    var T = tools(), t = T ? T.get(cur.tool) : null, box = s.el.querySelector('#gm-ws-tool');
    if (!t || !box) return;
    if (typeof t.mount === 'function') { try { t.mount(box, host || {}); } catch (e) { box.textContent = 'This tool could not open: ' + (e && e.message || e); } }
    else box.innerHTML = '<p class="gm-empty">' + esc(t.label) + ' has nothing to show yet.</p>';
  }
  function open(rootEl, host) { var s = render(rootEl, host); if (s) s.open(); return s; }
  function toggle(rootEl, host) { var s = sheets.workshop; if (s && s.el && s.el.parentNode === rootEl && s.isOpen()) { s.close(); return s; } return open(rootEl, host); }
  function close() { if (sheets.workshop) sheets.workshop.close(); }

  return { menuLine: menuLine, sheet: sheet, open: open, toggle: toggle, close: close, list: list, render: render, _pure: { menuLine: menuLine, list: list, esc: esc } };
});
