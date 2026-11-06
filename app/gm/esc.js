/* gm/esc.js — the ONE Esc of the GM page (the GM night rebuild, the design's Esc order). No DOM of its own, no clock, no network.

   Window.B68GmEsc in the browser, and module.exports under Node (checks/runtime/gm-esc.test.mjs).

   Esc does ONE thing per press, from the top:
     1. the topmost open thing a module registered closes (the highest priority first; on a tie, the one registered last);
     2. else a focused text field is left (blur), so the next Esc can act;
     3. else the stamp is taken down (the entry registered with kind 'stamp');
     4. else PANIC (the caller's panic: the safe scene, sound down, the work light).
   Nothing else in the page listens for Escape at document level. A module that owns something closable registers it here
   instead of adding its own keydown listener.

   register(id, { priority, isOpen, close, kind }) -> unregister()
     id        letters, digits, dots and dashes; registering the same id again replaces the old entry
     priority  a number; higher closes first. The shell's scale: 90 Find, 80 the Menu, 70 a popover (cue ⋯, quiet list,
               an alarm popover), 60 the Blade panel, 50 the drawer, 45 a GM-phone sheet, 40 an in-view panel (an NPC
               pop, a peek, an inline tool that asks to close), 10 the stamp (kind 'stamp')
     isOpen    () -> bool, read at the moment Esc is pressed (never cached)
     close     () -> void
     kind      'overlay' (the default) or 'stamp'
   handle(ctx) -> 'closed:<id>' | 'blur' | 'stamp' | 'panic' | 'none'
     ctx = { field: the focused element or null, isField(el) -> bool, blur(el), panic() }. 'none' only when ctx has no panic.
     An entry whose isOpen or close throws is skipped (and reported through ctx.onError if given), never fatal.
   anyOpen() -> bool        an 'overlay' entry is open: the page must not fire its letter and digit keys behind it
   list() -> [{ id, priority, kind, open }]   highest first, for tests and the Find palette's debug view
   reset()                  drop every entry (tests) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmEsc = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^[A-Za-z][A-Za-z0-9.-]{0,39}$/;
  var entries = [];   /* [{ id, priority, isOpen, close, kind, seq }] */
  var seq = 0;

  function find(id) { for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return i; return -1; }

  function register(id, def) {
    id = typeof id === 'string' ? id : '';
    if (!ID_RE.test(id)) throw new Error('esc: an id of letters, digits, dots and dashes');
    if (!def || typeof def.isOpen !== 'function' || typeof def.close !== 'function') throw new Error('esc ' + id + ': isOpen and close are functions');
    var p = typeof def.priority === 'number' && isFinite(def.priority) ? def.priority : 40;
    var kind = def.kind === 'stamp' ? 'stamp' : 'overlay';
    var at = find(id);
    var e = { id: id, priority: p, isOpen: def.isOpen, close: def.close, kind: kind, seq: ++seq };
    if (at >= 0) entries[at] = e; else entries.push(e);
    return function unregister() { var i = find(id); if (i >= 0 && entries[i] === e) entries.splice(i, 1); };
  }

  function ordered() {
    return entries.slice().sort(function (a, b) { return b.priority - a.priority || b.seq - a.seq; });
  }
  function safeOpen(e, ctx) {
    try { return !!e.isOpen(); } catch (err) { if (ctx && typeof ctx.onError === 'function') ctx.onError(e.id, err); return false; }
  }

  function handle(ctx) {
    ctx = ctx || {};
    var list = ordered(), i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.kind !== 'overlay' || !safeOpen(e, ctx)) continue;
      try { e.close(); } catch (err) { if (typeof ctx.onError === 'function') ctx.onError(e.id, err); continue; }
      return 'closed:' + e.id;
    }
    var f = ctx.field;
    if (f && typeof ctx.isField === 'function' && ctx.isField(f)) {
      if (typeof ctx.blur === 'function') ctx.blur(f); else if (typeof f.blur === 'function') f.blur();
      return 'blur';
    }
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.kind !== 'stamp' || !safeOpen(e, ctx)) continue;
      try { e.close(); } catch (err) { if (typeof ctx.onError === 'function') ctx.onError(e.id, err); continue; }
      return 'stamp';
    }
    if (typeof ctx.panic === 'function') { ctx.panic(); return 'panic'; }
    return 'none';
  }

  function anyOpen() {
    for (var i = 0; i < entries.length; i++) if (entries[i].kind === 'overlay' && safeOpen(entries[i])) return true;
    return false;
  }
  function list() {
    return ordered().map(function (e) { return { id: e.id, priority: e.priority, kind: e.kind, open: safeOpen(e) }; });
  }
  function reset() { entries = []; seq = 0; }

  return { register: register, handle: handle, anyOpen: anyOpen, list: list, reset: reset };
});
