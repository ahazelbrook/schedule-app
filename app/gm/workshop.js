/* gm/workshop.js — the host the GM page's tools open in: the right-edge sheet, or INLINE in a container the shell owns (suite ticket W0.5; the night rebuild, N0 and N2).

   Window.B68GmWorkshop, and module.exports under Node (the pure part only; the DOM part runs only where there is a document).

   The Workshop drawer is gone (N0): its five items went to Settings, back to where they were, or stay put away (see gm/settings.js). What is left is the
   host every Menu tool still opens in until the shell places them inline: sheet(root, id, title), one per id, created on first use inside the GM page's
   root, so the page's own DOM is untouched until a sheet is opened. One sheet is open at a time.

   N2: INLINE. The shell (N1b) gives a tool a home inside a place: inline(id, el, opts) binds sheet `id` to the container `el`. While bound, sheet(root, id, title)
   returns an object of the SAME shape whose body sits inside `el`, whose isOpen() is true, and whose open/close/toggle never hide it (close() calls opts.onClose, so the
   shell can leave the view). Nothing a tool does (it closes itself after an action, it re-asks for its sheet) can make it vanish. Unbound ids keep the right-edge path.

   API
     sheet(root, id, title)          -> { el, body, open(), close(), isOpen(), toggle(), inline, onUnbind(fn) }   (the same object each call for an id; while the id is bound
                                        inline it is the inline object, see below)
     inline(id, el, opts)            bind sheet `id` to container `el` (drawn at once: a wrapper .gm-inline-sheet with an optional heading and the body); -> the inline object,
                                        or null when el is not an element. Binding again replaces the old binding (unbinds it first).
                                        opts: { title: string | false (the small heading; false drops it; default: the title the tool gives), onClose: fn (called when the tool
                                        asks to close), esc: true (register the Esc entry 'inline-<id>' with B68GmEsc at priority 40 so Esc calls onClose; needs onClose) }
     inline(id, null)                unbind: run the tool's onUnbind hooks (a tool stops its own timers there), empty the container; -> true when it was bound
     bound(id)                       -> true while id is bound inline         boundIds() -> [id]
     The inline object: { el (the wrapper), body (.gm-sheet-body.gm-inline), isOpen() true, open() (no-op), close() (onClose), toggle() (onClose), inline: true,
                          onUnbind(fn) (run once, on unbind) }. The wrapper has data-inline="<id>"; the body carries the same classes as a sheet body plus gm-inline.
     Esc: a right-edge sheet registers 'sheet-<id>' with B68GmEsc (priority 50) when that module is there, and keeps its own keydown for focus inside it.
          An Esc entry counts as open only while its sheet or wrapper is in the document (an inline wrapper must also be laid out: a place that hides its
          column, or drops the container without unbinding, leaves no open tool behind, so the page's keys are not held back by B68GmEsc.anyOpen()).
     Binding a tool inline closes and EMPTIES its right-edge copy (two copies of a drawing would share their SVG ids); the next open() of the unbound tool redraws it.
     _pure                           { esc } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmWorkshop = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var sheets = {}, bound = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* in the document and laid out: not detached, and neither it nor an ancestor is display:none (a hidden place, a [hidden] column) */
  function laidOut(el) { return !!(el && el.isConnected && typeof el.getClientRects === 'function' && el.getClientRects().length); }

  /* ---- the sheet (DOM) ---- */
  function sheet(rootEl, id, title) {
    var b = bound[id];
    if (b) { if (title && b.headEl && !b.fixedTitle && b.headEl.textContent !== title) b.headEl.textContent = title; return b.obj; }
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
    var Esc = W && W.B68GmEsc;
    if (Esc && typeof Esc.register === 'function') { try { Esc.register('sheet-' + id, { priority: 50, isOpen: function () { return !el.hidden && !!el.isConnected; }, close: function () { s.close(); } }); } catch (e) { /* the id is the tool's own */ } }
    sheets[id] = s;
    return s;
  }

  /* ---- inline (N2) ---- */
  function unbind(id) {
    var b = bound[id]; if (!b) return false;
    delete bound[id];
    b.hooks.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* a tool's cleanup must not stop the unbind */ } });
    if (b.offEsc) { try { b.offEsc(); } catch (e) { /* ignore */ } }
    if (b.wrap && b.wrap.parentNode) b.wrap.parentNode.removeChild(b.wrap);
    return true;
  }
  function inline(id, el, opts) {
    id = String(id == null ? '' : id);
    if (el == null) return unbind(id);
    if (!el || el.nodeType !== 1 || !el.ownerDocument) return null;
    unbind(id);
    opts = opts && typeof opts === 'object' ? opts : {};
    var d = el.ownerDocument, fixed = typeof opts.title === 'string' || opts.title === false;
    if (sheets[id]) {                    /* the right-edge copy of the same tool gives way, and is emptied: its SVG ids would clash with the inline copy's */
      if (sheets[id].el && !sheets[id].el.hidden) sheets[id].close();
      if (sheets[id].body) sheets[id].body.textContent = '';
    }
    var wrap = d.createElement('div'), bodyEl = d.createElement('div'), headEl = null;
    wrap.className = 'gm-inline-sheet'; wrap.setAttribute('data-inline', id);
    if (opts.title !== false) {
      var T = W && W.B68GmTools, def = T && typeof T.get === 'function' ? T.get(id) : null;
      headEl = d.createElement('h2'); headEl.className = 'gm-sheet-h gm-inline-h';
      headEl.textContent = typeof opts.title === 'string' ? opts.title : def && def.label ? def.label : id;
      wrap.appendChild(headEl);
    }
    bodyEl.className = 'gm-sheet-body gm-inline'; bodyEl.setAttribute('tabindex', '-1');
    wrap.appendChild(bodyEl);
    el.appendChild(wrap);
    var rec = { wrap: wrap, hooks: [], headEl: headEl, fixedTitle: fixed, offEsc: null, obj: null };
    var ask = function () { if (typeof opts.onClose === 'function') { try { opts.onClose(id); } catch (e) { /* the shell's */ } } };
    var s = {
      el: wrap, body: bodyEl, inline: true,
      isOpen: function () { return bound[id] === rec; },
      open: function () {},
      close: ask,
      toggle: ask,
      onUnbind: function (fn) { if (typeof fn === 'function' && bound[id] === rec) rec.hooks.push(fn); }
    };
    rec.obj = s;
    bound[id] = rec;
    var Esc = W && W.B68GmEsc;
    if (opts.esc === true && typeof opts.onClose === 'function' && Esc && typeof Esc.register === 'function') {
      try { rec.offEsc = Esc.register('inline-' + id, { priority: 40, isOpen: function () { return bound[id] === rec && laidOut(rec.wrap); }, close: ask }); } catch (e) { /* ignore */ }
    }
    return s;
  }

  return { sheet: sheet, inline: inline, bound: function (id) { return !!bound[id]; }, boundIds: function () { return Object.keys(bound); }, _pure: { esc: esc } };
});
