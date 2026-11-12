/* ui/overlay.js: the kit's overlays, the kit and stage build (KS03). In the kit-ui bundle (app/routes.js), after ui/ui.js: fetched only while a kit
   setting is on (or by the look book). It defines nothing until it loads and does nothing until it is called, except two delegated listeners
   (a click, for the row's more button; pointer and focus, for tooltips) that act on kit markup alone. ES5, as the files beside it.

   It adds to B68Ui (the frozen contract in ui/ui.js; this only grows it):
     B68Ui.confirm(o) -> Promise<boolean>   a native <dialog>. o.title, o.body (text), o.confirm (label, 'OK'), o.cancel ('Cancel'), o.danger (the
                                            confirm button is the red one and Cancel is the focused Primary: a danger button is never the default),
                                            o.opener (where focus returns; the focused element when the dialog opens). Enter, Esc and a click
                                            outside all settle it (Esc and outside: false)
     B68Ui.prompt(o) -> Promise<string|null>   the same, with one field: o.label, o.value, o.placeholder, o.hint, o.kind ('text' | 'number' |
                                            'search' | 'textarea'; textarea takes Ctrl+Enter), o.required, o.maxlength. Esc and outside: null
     B68Ui.popover(o) -> handle              a floating panel anchored to o.anchor: o.content (an Element), o.placement ('bottom-start' by
                                            default; 'top|bottom|left|right' + '-start|-end|-center'), o.label, o.role, o.priority, o.onClose,
                                            o.mount + o.absolute + o.bounds (a local box, for the look book), o.pinned (no outside close).
                                            It flips to the other side, and to the other edge, where it would leave the screen.
                                            handle = { el, open(), close(opt), toggle(), isOpen(), place(), destroy() }
     B68Ui.openMenu(o) -> handle             (B68Ui.menu is the standalone menu PART, KS02b; this opens one) a popover of items: o.anchor, o.items [{label, value, rank, key, disabled, data, onSelect}],
                                            o.onSelect(value, item), o.label. Arrow keys, Home and End move; Enter or Space picks; Tab and Esc close
     B68Ui.toast(o) -> { id, dismiss() }     one stack, bottom right, at most four shown (the rest queue). o.text, o.tone ('info' | 'error'),
                                            o.undo (a function, or { label, fn }), o.duration (info only: 5000 ms; 0 stays), o.key (the same key
                                            replaces the message). Info fades; an error stays, with a red edge, until X (or an Escape heard on the stack where there is no B68GmEsc)
     B68Ui.tip(el, text, key) -> el          marks el with a tooltip (data-ui-tip, data-tip-key); a title on the desk becomes one as well
     B68Ui.tip.node(text, key) -> Element    a static tooltip (the look book)
     B68Ui.overlay                           the pieces, for the check and the look book: place(), step(), toastCore(), stack(), buildDialog()

   Esc. This file adds NO document-level Escape listener. On the GM page everything it opens closes through B68GmEsc (gm/esc.js): a dialog at 100
   (110 and up for a popover opened from inside one), a popover or menu at 70, and nothing for a toast.
   A native dialog's own Esc (its cancel event) is stopped and sent to B68GmEsc, so the order does not change. Where there is no B68GmEsc (the look
   book) a dialog keeps its own Esc and a popover or the stack closes on an Escape heard on itself. A toast takes no Esc on the GM page: PANIC wins, so an error toast has no
   B68GmEsc entry and never makes anyOpen() true; X always dismisses it (an Escape heard on the stack itself does, where there is no B68GmEsc).
   A tooltip never takes Esc.
   Everything the page shows goes in as text. The buttons come from B68Ui, never from markup here: the ratchet counts raw text. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) {
    root.B68Overlay = M;
    if (root.B68Ui) M.attach(root.B68Ui);
    M.install();
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict';

  var uid = 0, depth = 0, TIMES = '×';
  function nid(p) { uid += 1; return 'ui-' + p + '-' + uid; }
  function doc() { return W && W.document; }
  function str(v) { return v == null ? '' : String(v); }
  function norm(o) { return typeof o === 'string' || typeof o === 'number' ? { text: String(o), label: String(o) } : (o && typeof o === 'object' ? o : {}); }
  function el(tag, cls, text) {
    var e = doc().createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  /* a kit part as a DOM node (no markup sink) */
  function part(name, o) {
    var U = W.B68Ui;
    if (!U || typeof U.node !== 'function') throw new Error('overlay: B68Ui (ui/ui.js) loads first');
    return U.node(name, o, doc());   /* null for a part B68Ui does not have */
  }
  function elOf(t) { return t && t.nodeType === 1 ? t : (t && t.parentElement) || null; }
  function closest(t, sel) { var e = elOf(t); return e && typeof e.closest === 'function' ? e.closest(sel) : null; }
  function esc() { var E = W && W.B68GmEsc; return E && typeof E.register === 'function' ? E : null; }
  function connected(e) { return !!(e && (e.isConnected !== undefined ? e.isConnected : doc().documentElement.contains(e))); }
  function focusOf(e) { try { if (e && e !== doc().body && connected(e) && typeof e.focus === 'function') { e.focus(); return true; } } catch (x) {} return false; }
  function vport() {
    var d = doc().documentElement;
    return { left: 0, top: 0, right: d.clientWidth || W.innerWidth || 0, bottom: d.clientHeight || W.innerHeight || 0 };
  }
  function rectOf(e) { var r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }
  function motionMs(e) {
    try { var v = parseFloat(W.getComputedStyle(e).getPropertyValue('--ui-motion-quick')); return isFinite(v) ? v : 0; } catch (x) { return 0; }
  }
  function lastOpenDialog() { var l = doc().querySelectorAll('dialog[open]'); return l.length ? l[l.length - 1] : null; }
  /* a popover or menu opened from inside a dialog goes when the dialog does (it can close without Esc: a click outside, a script): returns the undo */
  function onDialogEnd(anchor, fn) {
    var dlg = closest(anchor, 'dialog');
    if (!dlg) return function () {};
    dlg.addEventListener('ui-dialog-end', fn); dlg.addEventListener('close', fn);
    return function () { dlg.removeEventListener('ui-dialog-end', fn); dlg.removeEventListener('close', fn); };
  }

  /* ---------- placement (pure) ----------
     a: the anchor's rect; size {w, h}; vp: the box it must stay in {left, top, right, bottom}. placement 'side-align': side top | bottom | left | right,
     align start | end | center. Where the side has no room and the other has more, it goes to the other; where the cross axis does not fit it goes to the
     other edge; then it is clamped inside vp. Gives { left, top, side, align, flipped, crossFlipped, room } (room: the space on the side it took) */
  function place(a, size, vp, placement, gap, margin) {
    gap = gap == null ? 6 : gap; margin = margin == null ? 8 : margin;
    var p = str(placement || 'bottom-start').split('-'), side = p[0], align = p[1] || 'start';
    if (!/^(top|bottom|left|right)$/.test(side)) side = 'bottom';
    if (!/^(start|end|center)$/.test(align)) align = 'start';
    var w = size.w, h = size.h;
    var room = { top: a.top - vp.top - margin - gap, bottom: vp.bottom - a.bottom - margin - gap, left: a.left - vp.left - margin - gap, right: vp.right - a.right - margin - gap };
    var vert = side === 'top' || side === 'bottom', need = vert ? h : w;
    var opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side], flipped = false, crossFlipped = false;
    if (room[side] < need && room[opp] > room[side]) { side = opp; flipped = true; }
    vert = side === 'top' || side === 'bottom';
    var lo = vert ? vp.left + margin : vp.top + margin, hi = vert ? vp.right - margin : vp.bottom - margin, len = vert ? w : h;
    var a0 = vert ? a.left : a.top, a1 = vert ? a.right : a.bottom;
    function at(al) { return al === 'center' ? (a0 + a1) / 2 - len / 2 : al === 'start' ? a0 : a1 - len; }
    function fits(v) { return v >= lo && v + len <= hi; }
    var cross = at(align);
    if (align !== 'center' && !fits(cross)) {
      var other = align === 'start' ? 'end' : 'start';
      if (fits(at(other))) { cross = at(other); align = other; crossFlipped = true; }
    }
    cross = Math.max(lo, Math.min(hi - len, cross));
    var left, top;
    if (vert) {
      left = cross; top = side === 'bottom' ? a.bottom + gap : a.top - gap - h;
      top = Math.max(vp.top + margin, Math.min(vp.bottom - margin - h, top));
    } else {
      top = cross; left = side === 'right' ? a.right + gap : a.left - gap - w;
      left = Math.max(vp.left + margin, Math.min(vp.right - margin - w, left));
    }
    return { left: left, top: top, side: side, align: align, flipped: flipped, crossFlipped: crossFlipped, room: room[side] };
  }
  /* the next menu item from the one at i (-1: none) of n: arrows wrap, Home and End jump; null for any other key */
  function step(i, key, n) {
    if (!n) return null;
    if (key === 'ArrowDown') return i < 0 ? 0 : (i + 1) % n;
    if (key === 'ArrowUp') return i < 0 ? n - 1 : (i - 1 + n) % n;
    if (key === 'Home') return 0;
    if (key === 'End') return n - 1;
    return null;
  }

  /* ---------- floating things: the shared placing code (popover, menu, the row's more menu, the tooltip) ----------
     box is shown, measured, placed with --ui-x and --ui-y (class ui-float), then corrected for an ancestor that makes position: fixed local */
  function floatAt(box, anchor, placement, o) {
    o = o || {};
    var abs = !!o.absolute, bounds = vport();
    if (o.bounds) { var b = rectOf(o.bounds); bounds = { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; }
    box.classList.add('ui-float');
    if (abs) box.classList.add('is-absolute');
    box.classList.remove('is-placed');
    box.style.setProperty('--ui-x', '0px'); box.style.setProperty('--ui-y', '0px'); box.style.removeProperty('--ui-pop-max');
    var home = abs && o.mount ? rectOf(o.mount) : { left: 0, top: 0 };
    var a = rectOf(anchor), r0 = rectOf(box), res = place(a, { w: r0.width, h: r0.height }, bounds, placement, o.gap, o.margin);
    if (res.room > 0 && res.room < r0.height && (res.side === 'top' || res.side === 'bottom')) {   /* not even the better side is tall enough: scroll inside it */
      box.style.setProperty('--ui-pop-max', Math.floor(res.room) + 'px');
      r0 = rectOf(box); res = place(a, { w: r0.width, h: r0.height }, bounds, placement, o.gap, o.margin);
    }
    var x = res.left - home.left, y = res.top - home.top;
    box.style.setProperty('--ui-x', x + 'px'); box.style.setProperty('--ui-y', y + 'px');
    var r1 = rectOf(box), dx = res.left - r1.left, dy = res.top - r1.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { box.style.setProperty('--ui-x', (x + dx) + 'px'); box.style.setProperty('--ui-y', (y + dy) + 'px'); }
    box.setAttribute('data-side', res.side);
    box.classList.add('is-placed');
    return res;
  }
  function unfloat(box) {
    box.classList.remove('ui-float', 'is-absolute', 'is-placed');
    box.style.removeProperty('--ui-x'); box.style.removeProperty('--ui-y'); box.style.removeProperty('--ui-pop-max');
    box.removeAttribute('data-side');
  }

  /* ---------- the dialog ---------- */
  function paras(parent, text) {
    str(text).split(/\n{2,}/).forEach(function (t) { if (t) parent.appendChild(el('p', 'ui-dialog-body', t)); });
  }
  /* the dialog's markup as nodes: tag 'dialog' (live) or 'div' (a still one, for the look book) */
  function buildDialog(kind, o, tag) {
    var id = nid('dlg'), danger = !!o.danger, isPrompt = kind === 'prompt';
    var root = el(tag || 'dialog', 'ui-dialog' + (tag === 'div' ? ' is-static' : ''));
    if (tag === 'div') { root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'false'); }
    root.setAttribute('aria-labelledby', id + '-t');
    var form = el('form', 'ui-dialog-form'); form.setAttribute('novalidate', '');
    form.addEventListener('submit', function (ev) { ev.preventDefault(); });   /* a still one (the look book) must not send the page anywhere */
    var title = el('h2', 'ui-dialog-title', str(o.title || (isPrompt ? o.label : '') || (isPrompt ? 'Enter a value' : 'Are you sure?'))); title.id = id + '-t';
    form.appendChild(title);
    if (o.body) paras(form, o.body);
    var input = null;
    if (isPrompt) {
      var fo = { label: str(o.label || o.title || 'Value'), kind: /^(number|search|textarea)$/.test(o.kind) ? o.kind : 'text', value: o.value == null ? '' : o.value,
        placeholder: o.placeholder, hint: o.hint, required: !!o.required, attrs: { autocomplete: 'off', spellcheck: 'false' } };
      if (o.maxlength) fo.attrs.maxlength = o.maxlength;
      var field = part('field', fo);
      input = field.querySelector('.ui-field-input');
      form.appendChild(field);
    }
    var acts = el('div', 'ui-dialog-acts');
    var cancel = part('button', { label: str(o.cancel || 'Cancel'), rank: danger ? 'primary' : 'standard', key: 'Esc', data: { 'ui-act': 'cancel' } });
    var ok = part('button', { label: str(o.confirm || (isPrompt ? 'Save' : 'OK')), rank: danger ? 'danger' : 'primary', type: danger ? 'button' : 'submit', data: { 'ui-act': 'confirm' } });
    acts.appendChild(cancel); acts.appendChild(ok);
    form.appendChild(acts);
    root.appendChild(form);
    return { root: root, form: form, input: input, cancel: cancel, ok: ok, danger: danger };
  }
  function openDialog(kind, o) {
    o = norm(o);
    if (o.title == null && o.text != null) o.title = o.text;
    return new Promise(function (resolve) {
      var d = doc(), opener = o.opener || d.activeElement, modal = !!(W.HTMLDialogElement && typeof W.HTMLDialogElement.prototype.showModal === 'function');
      /* no showModal: a div (role dialog) with a scrim, not a dialog element: the page's keys stop for an open dialog element, and this one must hear Esc through B68GmEsc */
      var b = buildDialog(kind, o, modal ? 'dialog' : 'div'), root = b.root;
      var isPrompt = kind === 'prompt', cancelVal = isPrompt ? null : false, done = false, unreg = null, scrim = null, downOnBackdrop = false;
      var n = ++depth, E = esc();
      function finish(val) {
        if (done) return;
        done = true; depth -= 1;
        try { root.dispatchEvent(new W.Event('ui-dialog-end')); } catch (x) {}
        if (unreg) { unreg(); unreg = null; }
        try { if (root.open && typeof root.close === 'function') root.close(); } catch (x) {}
        if (root.parentNode) root.parentNode.removeChild(root);
        if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim);
        homeToasts();
        focusOf(opener);
        resolve(val);
      }
      function submit() {
        if (!isPrompt) { finish(true); return; }
        var v = b.input.value;
        if (o.required && !v.trim()) { b.input.setAttribute('aria-invalid', 'true'); b.input.focus(); return; }
        finish(v);
      }
      /* Esc: through the page's one owner when this dialog is registered with it (it closes the topmost thing, which is this dialog or a popover
         opened from it); on its own where there is none */
      function onEsc() {
        if (unreg && E && typeof E.handle === 'function') { var r = E.handle({}); if (!done && r === 'none') finish(cancelVal); return; }
        finish(cancelVal);
      }
      if (E) unreg = E.register('ui.dialog.' + n, { priority: 100 + n, isOpen: function () { return !done; }, close: function () { finish(cancelVal); } });
      root.addEventListener('cancel', function (ev) { ev.preventDefault(); onEsc(); });
      root.addEventListener('close', function () { finish(cancelVal); });
      root.addEventListener('pointerdown', function (ev) { downOnBackdrop = ev.target === root; });
      root.addEventListener('click', function (ev) { if (ev.target === root && downOnBackdrop) finish(cancelVal); downOnBackdrop = false; });
      root.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Escape' || ev.key === 'Esc') && root.classList.contains('is-plain')) { ev.preventDefault(); onEsc(); return; }
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && b.input && b.input.tagName === 'TEXTAREA') { ev.preventDefault(); submit(); }
      });
      b.form.addEventListener('submit', function (ev) { ev.preventDefault(); submit(); });
      b.cancel.addEventListener('click', function () { finish(cancelVal); });
      if (b.danger) b.ok.addEventListener('click', function () { finish(true); });
      d.body.appendChild(root);
      if (modal) root.showModal();
      else {
        scrim = el('div', 'ui-dialog-scrim'); d.body.insertBefore(scrim, root);
        scrim.addEventListener('click', function () { finish(cancelVal); });
        root.classList.remove('is-static'); root.classList.add('is-plain'); root.setAttribute('aria-modal', 'true');
      }
      (b.danger ? b.cancel : b.input || b.ok).focus();
      if (b.input && typeof b.input.select === 'function') b.input.select();
    });
  }

  /* ---------- the popover and the menu ---------- */
  function popover(o) {
    o = o || {};
    var anchor = o.anchor, box = o.el || null, isOpen = false, unreg = null, offDlg = null, id = o.esc || nid('pop').replace(/-/g, '.');
    var inDialog = !!closest(anchor, 'dialog'), handle = {};
    if (!box) {
      box = el('div', 'ui-popover');
      box.setAttribute('role', o.role || 'dialog');
      if (o.label) box.setAttribute('aria-label', o.label);
      if (o.content) box.appendChild(o.content);
    }
    box.setAttribute('tabindex', '-1');
    function items() { return Array.prototype.slice.call(box.querySelectorAll('.ui-menu-item:not(:disabled)')); }
    function onKey(ev) {
      var k = ev.key, its = items();
      if (box.getAttribute('role') === 'menu' && its.length) {
        var to = step(its.indexOf(doc().activeElement), k, its.length);
        if (to !== null) { ev.preventDefault(); its[to].focus(); return; }
      }
      if (k === 'Tab') { handle.close({ focus: false }); focusOf(anchor); return; }
      if ((k === 'Escape' || k === 'Esc') && !unreg) { ev.preventDefault(); ev.stopPropagation(); handle.close(); }
    }
    function onOutside(ev) {
      if (o.pinned || !isOpen) return;
      var t = ev.target;
      if (box.contains(t) || (anchor && anchor.contains && anchor.contains(t))) return;
      handle.close({ focus: false });
    }
    function onScroll(ev) { if (!o.pinned && isOpen && !(ev && ev.target && box.contains && box.contains(ev.target))) handle.close({ focus: false }); }
    function onResize() { if (isOpen) handle.place(); }
    handle.el = box;
    handle.isOpen = function () { return isOpen; };
    handle.place = function () { if (isOpen && anchor) floatAt(box, anchor, o.placement, { absolute: o.absolute, mount: o.mount, bounds: o.bounds }); };
    handle.open = function () {
      if (isOpen) return handle;
      var mount = o.mount || closest(anchor, 'dialog') || doc().body;
      if (box.parentNode !== mount) mount.appendChild(box);
      box.hidden = false; isOpen = true;
      handle.place();
      if (anchor) anchor.setAttribute('aria-expanded', 'true');
      var E = esc();
      if (E && !o.pinned) unreg = E.register(id, { priority: o.priority || (inDialog ? 110 : 70), isOpen: function () { if (isOpen && anchor && anchor.isConnected === false) { handle.close({ focus: false }); return false; } return isOpen; }, close: function () { handle.close(); } });      /* KS08: the same for an anchor a redraw threw away */
      box.addEventListener('keydown', onKey);
      doc().addEventListener('pointerdown', onOutside, true);
      W.addEventListener('scroll', onScroll, true); W.addEventListener('resize', onResize);
      offDlg = onDialogEnd(anchor, function () { handle.close({ focus: false }); });
      if (o.focus !== false) {
        var its = items(), f = its[0] || box.querySelector('input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])') || box;
        its.forEach(function (it) { it.setAttribute('tabindex', '-1'); });
        focusOf(f);
      }
      return handle;
    };
    handle.close = function (opt) {
      if (!isOpen) return handle;
      isOpen = false;
      if (unreg) { unreg(); unreg = null; }
      if (offDlg) { offDlg(); offDlg = null; }
      box.removeEventListener('keydown', onKey);
      doc().removeEventListener('pointerdown', onOutside, true);
      W.removeEventListener('scroll', onScroll, true); W.removeEventListener('resize', onResize);
      unfloat(box);
      box.hidden = true;
      if (box.parentNode) box.parentNode.removeChild(box);
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
      if (!opt || opt.focus !== false) focusOf(anchor);
      if (typeof o.onClose === 'function') o.onClose();
      return handle;
    };
    handle.toggle = function () { return isOpen ? handle.close() : handle.open(); };
    handle.destroy = function () { handle.close({ focus: false }); };
    return handle;
  }
  /* a menu is the row part's own ui-menu (B68Ui has no standalone menu part), taken out of a row node and floated */
  function menu(o) {
    o = o || {};
    var list = (Array.isArray(o.items) ? o.items : []).map(function (it) { return typeof it === 'string' ? { label: it, value: it } : it; });
    var spec = list.map(function (it) {
      return { label: it.label, value: it.value, rank: it.rank, key: it.key, disabled: it.disabled, data: it.data, attrs: it.attrs, id: it.id, cls: it.cls, title: it.title };
    });
    /* the menu part (KS02b) when B68Ui has it; before that, the ui-menu of a row node (the part's own markup either way) */
    var m = part('menu', { items: spec, label: o.label });
    if (!m) { var row = part('row', { label: '-', open: true, more: spec }); m = row.querySelector('.ui-menu'); }
    if (!m) m = el('div', 'ui-menu');   /* no items: an empty menu, not a crash */
    m.classList.remove('ui-menu--static');
    m.setAttribute('role', 'menu'); m.removeAttribute('id'); m.removeAttribute('hidden');
    if (o.label) m.setAttribute('aria-label', o.label);
    var h = popover({ anchor: o.anchor, el: m, placement: o.placement || 'bottom-start', priority: o.priority, esc: o.esc, mount: o.mount, absolute: o.absolute,
      bounds: o.bounds, pinned: o.pinned, onClose: o.onClose, focus: o.focus });
    m.addEventListener('click', function (ev) {
      var b = closest(ev.target, '.ui-menu-item');
      if (!b || b.disabled || o.pinned) return;
      var it = list[Array.prototype.slice.call(m.querySelectorAll('.ui-menu-item')).indexOf(b)];
      h.close();
      if (it && typeof it.onSelect === 'function') it.onSelect(it);
      if (typeof o.onSelect === 'function') o.onSelect(it ? it.value : undefined, it);
    });
    return h;
  }
  /* the row's own more button: [data-ui-more] opens the .ui-menu that aria-controls names (or the one in its row). One is open at a time */
  var more = null;
  function moreClose(focus) {
    if (!more) return;
    var m = more; more = null;
    if (m.unreg) m.unreg();
    if (m.off) m.off();
    unfloat(m.menu); m.menu.hidden = true; m.btn.setAttribute('aria-expanded', 'false');
    if (focus) focusOf(m.btn);
  }
  function moreOpen(btn) {
    var id = btn.getAttribute('aria-controls'), m = id ? doc().getElementById(id) : null;
    if (!m) { var row = closest(btn, '.ui-row'); m = row ? row.querySelector('.ui-menu') : null; }
    if (!m) return;
    if (more && more.menu === m) { moreClose(true); return; }
    var untracked = !m.hidden;   /* drawn open with nothing tracking it (the look book): a click closes it */
    moreClose(false);
    if (untracked) { m.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    m.hidden = false; btn.setAttribute('aria-expanded', 'true');
    floatAt(m, btn, 'bottom-end', {});
    var E = esc(), rec = { btn: btn, menu: m, unreg: null, off: null };
    rec.off = onDialogEnd(btn, function () { moreClose(false); });
    if (E) rec.unreg = E.register('ui.more', { priority: closest(btn, 'dialog') ? 110 : 70, isOpen: function () { if (more === rec && rec.btn.isConnected === false) { moreClose(false); return false; } return more === rec; }, close: function () { moreClose(true); } });      /* KS08: a redraw that threw the row away closed its menu: Esc goes on to the next entry (PANIC), not to a ghost */
    more = rec;
    var its = Array.prototype.slice.call(m.querySelectorAll('.ui-menu-item:not(:disabled)'));
    its.forEach(function (it) { it.setAttribute('tabindex', '-1'); });
    if (!m.getAttribute('data-ui-keys')) {
      m.setAttribute('data-ui-keys', '1');
      m.addEventListener('keydown', function (ev) {
        var l = Array.prototype.slice.call(m.querySelectorAll('.ui-menu-item:not(:disabled)')), to = step(l.indexOf(doc().activeElement), ev.key, l.length);
        if (to !== null) { ev.preventDefault(); l[to].focus(); return; }
        if (ev.key === 'Tab') { var t = more && more.btn; moreClose(false); focusOf(t); return; }
        if ((ev.key === 'Escape' || ev.key === 'Esc') && more && !more.unreg) { ev.preventDefault(); ev.stopPropagation(); moreClose(true); }
      });
    }
    if (its[0]) its[0].focus();
  }
  function onClickDoc(ev) {
    var b = closest(ev.target, '[data-ui-more]');
    if (b) { moreOpen(b); return; }
    if (!more) return;
    if (more.menu.contains(ev.target)) { if (closest(ev.target, '.ui-menu-item:not(:disabled)')) moreClose(true); return; }
    moreClose(false);
  }
  function onScrollMore(ev) { if (more && !(ev.target && more.menu.contains && more.menu.contains(ev.target))) moreClose(false); }

  /* ---------- the toast stack ---------- */
  /* the state machine, with no DOM: view = { mount(item), update(item), unmount(item, done) }; timers = { set, clear, now } (injected by the check) */
  function toastCore(cfg) {
    var max = cfg.max || 4, T = cfg.timers, view = cfg.view, shown = [], queue = [], seq = 0;
    function find(fn) { var i; for (i = 0; i < shown.length; i++) if (fn(shown[i])) return shown[i]; for (i = 0; i < queue.length; i++) if (fn(queue[i])) return queue[i]; return null; }
    function handle(it) {
      return { id: it.id, dismiss: function () { dismiss(it); }, state: function () { return it.state; },
        update: function (text) { it.text = str(text); if (it.state === 'shown') view.update(it); } };
    }
    function startTimer(it, ms) {
      it.t0 = T.now();
      it.timer = T.set(function () { it.timer = null; dismiss(it); }, ms);
    }
    function showNow(it) {
      it.state = 'shown'; shown.push(it);
      view.mount(it);
      if (it.tone === 'info' && it.duration > 0 && !cfg.still) { it.left = it.duration; startTimer(it, it.left); }
    }
    function drain() { while (shown.length < max && queue.length) showNow(queue.shift()); }
    function dismiss(it) {
      if (it.state === 'gone' || it.state === 'leaving') return;
      if (it.state === 'queued') { var q = queue.indexOf(it); if (q >= 0) queue.splice(q, 1); it.state = 'gone'; return; }
      it.state = 'leaving';
      if (it.timer) { T.clear(it.timer); it.timer = null; }
      var once = false;
      view.unmount(it, function () {
        if (once) return;
        once = true; it.state = 'gone';
        var i = shown.indexOf(it); if (i >= 0) shown.splice(i, 1);
        drain();
      });
    }
    function add(o) {
      o = norm(o);
      var tone = o.tone === 'error' ? 'error' : 'info', text = str(o.text != null ? o.text : o.label);
      var undo = typeof o.undo === 'function' ? { label: 'Undo', fn: o.undo } : o.undo && typeof o.undo.fn === 'function' ? { label: str(o.undo.label || 'Undo'), fn: o.undo.fn } : null;
      if (o.key != null) {
        var same = find(function (i) { return i.key === o.key && i.state !== 'leaving' && i.state !== 'gone'; });
        if (same) {
          same.text = text; same.undo = undo;
          if (same.state === 'shown') { view.update(same, true); if (same.timer) { T.clear(same.timer); same.left = same.duration; startTimer(same, same.left); } }
          return handle(same);
        }
      }
      var it = { id: ++seq, key: o.key, tone: tone, text: text, undo: undo, duration: o.duration == null ? 5000 : Number(o.duration) || 0, state: 'queued', timer: null, left: 0, t0: 0, paused: false };
      if (shown.length < max) showNow(it);
      else if (tone === 'error') {   /* an error goes ahead of any info that is waiting */
        var at = 0; while (at < queue.length && queue[at].tone === 'error') at++;
        queue.splice(at, 0, it);
      } else queue.push(it);
      return handle(it);
    }
    function pause(it) { if (it.timer) { T.clear(it.timer); it.timer = null; it.left -= T.now() - it.t0; it.paused = true; } }
    function resume(it) { if (it.paused && it.state === 'shown') { it.paused = false; startTimer(it, Math.max(it.left, 400)); } }
    function errors() { return shown.filter(function (i) { return i.tone === 'error' && i.state === 'shown'; }); }
    return {
      add: add, dismiss: dismiss, pause: pause, resume: resume,
      dismissErrors: function () { errors().forEach(dismiss); },
      hasErrors: function () { return errors().length > 0; },
      shown: function () { return shown.filter(function (i) { return i.state === 'shown'; }); },
      queued: function () { return queue.slice(); },
      byId: function (id) { return find(function (i) { return i.id === id; }); }
    };
  }
  /* the stack on the page: one container, the newest at the bottom. cfg.mount (default: body, or the open dialog, so it stays above the backdrop),
     cfg.absolute (a local box), cfg.still (no timers: the look book) */
  function stack(cfg) {
    cfg = cfg || {};
    var box = null, core;
    function mountPoint() { return cfg.mount || lastOpenDialog() || doc().body; }
    function ensure() {
      if (!box) {
        box = el('div', 'ui-toast-stack' + (cfg.absolute ? ' is-local' : ''));
        box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Notifications');
        box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-relevant', 'additions');
        box.setAttribute('data-ui-toasts', '');
        box.addEventListener('keydown', function (ev) { if ((ev.key === 'Escape' || ev.key === 'Esc') && !esc()) { ev.preventDefault(); core.dismissErrors(); } });
      }
      var home = mountPoint();
      if (box.parentNode !== home) home.appendChild(box);
      if (home.nodeName === 'DIALOG' && !cfg.mount && !home.__uiToastWatch) {   /* any dialog, not only the kit's own: when it closes the stack goes home */
        home.__uiToastWatch = true;
        home.addEventListener('close', function again() { home.removeEventListener('close', again); home.__uiToastWatch = false; core.home(); });
      }
      return box;
    }
    function build(it) {
      var t = el('div', 'ui-toast ui-toast--' + it.tone);
      t.setAttribute('role', it.tone === 'error' ? 'alert' : 'status'); t.setAttribute('data-toast-id', String(it.id));
      if (it.tone === 'error') t.appendChild(el('span', 'ui-toast-kind', 'Error'));
      t.appendChild(el('span', 'ui-toast-text', it.text));
      var acts = el('span', 'ui-toast-acts');
      if (it.undo) {
        var u = part('button', { label: it.undo.label, rank: 'quiet', cls: 'ui-toast-undo', data: { 'ui-act': 'undo' } });
        u.addEventListener('click', function () {   /* once: a toast on its way out (a second Enter on the focused button) runs nothing */
          if (it.state !== 'shown') return;
          var f = it.undo && it.undo.fn; core.dismiss(it); if (typeof f === 'function') f();
        });
        acts.appendChild(u);
      }
      var x = part('button', { label: TIMES, rank: 'quiet', cls: 'ui-toast-x', attrs: { 'aria-label': 'Dismiss' }, data: { 'ui-act': 'dismiss' } });
      x.addEventListener('click', function () { core.dismiss(it); });
      acts.appendChild(x);
      t.appendChild(acts);
      if (it.tone === 'info' && it.duration > 0) {
        var bar = el('span', 'ui-toast-timer'); bar.setAttribute('aria-hidden', 'true');
        bar.style.setProperty('--ui-toast-ms', it.duration + 'ms');
        if (cfg.still) bar.classList.add('is-still');
        t.appendChild(bar);
      }
      var hov = false, foc = false;
      function sync() { if (hov || foc) { t.classList.add('is-paused'); core.pause(it); } else { t.classList.remove('is-paused'); core.resume(it); } }
      t.addEventListener('pointerenter', function () { hov = true; sync(); });
      t.addEventListener('pointerleave', function () { hov = false; sync(); });
      t.addEventListener('focusin', function () { foc = true; sync(); });
      t.addEventListener('focusout', function (ev) { if (!t.contains(ev.relatedTarget)) { foc = false; sync(); } });
      return t;
    }
    var view = {
      mount: function (it) {
        var b = ensure(); it.el = build(it); b.appendChild(it.el);
      },
      update: function (it, again) {
        var t = it.el && it.el.querySelector('.ui-toast-text'); if (t) t.textContent = it.text;
        var bar = again && it.el && it.el.querySelector('.ui-toast-timer');   /* a repeated message gets its five seconds again: restart the bar */
        if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      },
      unmount: function (it, done) {
        var e = it.el, ms = e ? motionMs(e) : 0;
        function gone() { if (e && e.parentNode) e.parentNode.removeChild(e); done(); }
        if (!e || !ms) { gone(); return; }
        e.classList.add('is-leaving'); W.setTimeout(gone, ms);
      }
    };
    core = toastCore({ max: cfg.max || 4, still: cfg.still, view: view, timers: cfg.timers ||
      { set: function (f, ms) { return W.setTimeout(f, ms); }, clear: function (t) { W.clearTimeout(t); }, now: function () { return Date.now(); } } });
    core.home = function () { if (box) { var h = mountPoint(); if (box.parentNode !== h) h.appendChild(box); } };
    core.root = ensure;
    return core;
  }
  var main = null;
  function homeToasts() { if (main) main.home(); }
  function theStack() { if (!main) main = stack({}); return main; }
  function toast(o) { return theStack().add(o); }
  toast.stack = theStack;

  /* ---------- the tooltip ---------- */
  var tipEl = null, tipFor = null, tipTimer = 0, tipLife = 0, pending = null, held = null;
  function isDesk() {
    var d = doc(), v = d && d.documentElement ? d.documentElement.getAttribute('data-kit') : null;
    return !!v && (' ' + v + ' ').indexOf(' desk ') >= 0;
  }
  function tipKey(a) {
    var k = a.getAttribute('data-tip-key') || str(a.getAttribute('aria-keyshortcuts')).split(' ')[0];
    if (!k) { var kb = a.querySelector('.ui-key'); k = kb ? kb.textContent : ''; }
    return str(k);
  }
  function tipText(a) { return str(a.getAttribute('data-ui-tip') || a.getAttribute('title')); }
  function tipNode(text, key) {
    var t = el('div', 'ui-tip is-static'); t.setAttribute('role', 'tooltip');
    t.appendChild(el('span', 'ui-tip-text', str(text)));
    if (key) t.appendChild(part('key', { label: str(key) }));
    return t;
  }
  function tipHide() {
    if (tipTimer) { W.clearTimeout(tipTimer); tipTimer = 0; }
    if (tipLife) { W.clearTimeout(tipLife); tipLife = 0; }
    pending = null;
    if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    if (tipFor && held) {
      if (held.title !== null) {   /* the title goes back, unless the page wrote a new one while the tip showed */
        if (!tipFor.hasAttribute('title')) tipFor.setAttribute('title', held.title);
        tipFor.removeAttribute('data-ui-tip');
      }
      if (held.describedby !== null) tipFor.setAttribute('aria-describedby', held.describedby); else tipFor.removeAttribute('aria-describedby');
    }
    tipFor = null; held = null;
  }
  function tipShow(a) {
    var text = tipText(a); if (!text || !connected(a)) return;
    if (tipFor === a && tipEl && tipEl.parentNode) return;
    tipHide();
    if (!tipEl) { tipEl = el('div', 'ui-tip'); tipEl.setAttribute('role', 'tooltip'); tipEl.id = nid('tip'); }
    tipEl.textContent = '';
    tipEl.appendChild(el('span', 'ui-tip-text', text));
    var key = tipKey(a);
    if (key) tipEl.appendChild(part('key', { label: key }));
    var hadTitle = a.hasAttribute('title') && !a.hasAttribute('data-ui-tip');
    held = { title: hadTitle ? a.getAttribute('title') : null, describedby: a.getAttribute('aria-describedby') };
    if (hadTitle) { a.setAttribute('data-ui-tip', held.title); a.removeAttribute('title'); }   /* the native one would show beside this one */
    a.setAttribute('aria-describedby', tipEl.id);
    tipFor = a;
    (closest(a, 'dialog') || doc().body).appendChild(tipEl);
    floatAt(tipEl, a, 'bottom-center', { gap: 8 });
    tipLife = W.setTimeout(tipHide, 12000);   /* the page can redraw its control under a tip that would then never get its pointer-out */
  }
  function tipAnchor(t) {
    var a = closest(t, '[title],[data-ui-tip]');
    if (!a || closest(a, '.ui-tip') || !tipText(a)) return null;
    if (a.hasAttribute('title') && !a.hasAttribute('data-ui-tip') && !isDesk()) return null;   /* a plain title is taken over on the desk only */
    return a;
  }
  function onPointerOver(ev) {
    if (ev.pointerType && ev.pointerType !== 'mouse' && ev.pointerType !== 'pen') return;
    var a = tipAnchor(ev.target);
    if (!a || a === tipFor || a === pending) return;
    tipHide();
    pending = a;
    tipTimer = W.setTimeout(function () { tipTimer = 0; pending = null; tipShow(a); }, 400);
  }
  function onPointerOut(ev) {
    var a = tipFor || pending;
    if (a && a.contains(ev.target) && !(ev.relatedTarget && a.contains(ev.relatedTarget))) tipHide();
  }
  function onFocusIn(ev) {
    var a = tipAnchor(ev.target), vis = true;
    if (!a) return;
    try { vis = a.matches(':focus-visible'); } catch (x) { vis = true; }
    if (vis) tipShow(a);
  }
  function tip(a, text, key) {
    if (a && typeof a.setAttribute === 'function') {
      a.setAttribute('data-ui-tip', str(text));
      if (key) a.setAttribute('data-tip-key', str(key)); else a.removeAttribute('data-tip-key');
    }
    return a;
  }
  tip.node = tipNode;
  tip.show = function (a) { tipShow(a); return tipEl; };
  tip.hide = tipHide;

  /* ---------- wiring ---------- */
  var installed = false;
  function install() {
    var d = doc();
    if (installed || !d || typeof d.addEventListener !== 'function' || typeof W.addEventListener !== 'function') return;
    installed = true;
    d.addEventListener('click', onClickDoc);
    d.addEventListener('pointerover', onPointerOver);
    d.addEventListener('pointerout', onPointerOut);
    d.addEventListener('pointerdown', tipHide, true);
    d.addEventListener('focusin', onFocusIn);
    d.addEventListener('focusout', tipHide);
    W.addEventListener('scroll', function (ev) { tipHide(); onScrollMore(ev); }, true);
    W.addEventListener('resize', tipHide);
    W.addEventListener('blur', tipHide);
  }
  function attach(U) {
    U.confirm = function (o) { return openDialog('confirm', o); };
    U.prompt = function (o) { return openDialog('prompt', o); };
    U.popover = popover; U.openMenu = menu; U.toast = toast; U.tip = tip;   /* U.menu is the menu part (KS02b): never overwritten */
    U.overlay = M;
    return U;
  }
  var M = {
    VERSION: 1, attach: attach, install: install,
    place: place, step: step, toastCore: toastCore, stack: stack, buildDialog: buildDialog, floatAt: floatAt,
    confirm: function (o) { return openDialog('confirm', o); }, prompt: function (o) { return openDialog('prompt', o); },
    popover: popover, openMenu: menu, toast: toast, tip: tip
  };
  return M;
});
