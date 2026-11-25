/* gm/room-zoom.js: a room card's things, and the zoom card (RK09 of the room key build; setting room.key, bundle room-key).

   Window.B68GmRoomZoom; in Node, require() returns the same object. GM page only: nothing here is sent anywhere, stored, or drawn on the iPad or a phone.
   It defines its module when it loads and reads other modules (B68Ui, B68GmEsc, B68GmRoomThings, the slot modules) only when called.

   THE ROOM CARD. html(room) is the room card's Things: the room's things as bold names in the note's order (the format's "most obvious first"), each
   a button (data-site="thing", data-room, data-thing = its slug, data-i) with its key, 1 to 9, and its state as a chip when it has a mark (a taken or
   gone thing dims, and stays clickable). The Run view draws it before the room's note (run-view.js, kit/run.js); the page's site.act routes the click
   here (act). With no things the markup is '' and the card is as it was.

   THE ZOOM CARD. One card at a time, B68Ui's popover, pinned beside the thing (left of it where there is room), mounted in a data-ui-scope host so the
   kit's parts work on the old desk too. It shows the room and "n of m", the name and its line, then 🔍 the closer look, 🎲 the roll (4/5, then 6),
   ! the danger and the state, then the button row, then Previous, Next and Close. It closes on Esc (B68GmEsc 'room.zoom', 70, never a listener of
   its own), on Close, on a tap outside it (a tap on another thing opens that one instead), when its thing leaves the screen, and when the same thing
   is tapped again. Focus goes into the card, and back to the thing's button when it closes. A Run view redraw keeps it open: the card follows the
   new button and draws again (a mark another device wrote shows at once).

   KEYS (the page asks key() first, before any page key; the Shortcuts card has the line):
     focus in a room card that has things   1 to 9 open that thing (a digit there is always the card's: a missing thing does nothing, so 1 to 4
                                            never roll a situation by surprise); ← ↑ and → ↓ step the focus between the things
     the zoom card open (the top box)       ← ↑ and → ↓ the previous and next thing of the room; 1 to 9 that thing; Esc closes (B68GmEsc)

   THE BUTTON ROW: the hook for RK10 (Show on iPad), RK11 (a thing's state) and RK15 (Swap). Three named slots, drawn in this order:
     'show'  B68GmRoomShow.buttons(ctx)      'state'  B68GmRoomMark.buttons(ctx)      'swap'  B68GmRoomSwap.buttons(ctx)
   On every draw the card asks the slot's module (when it is loaded, not a stub, and has buttons()), then every fn added with
   zoom.addButtons(slot, fn) -> off(). Each gives a list (anything else is none) of
     { label, run(ctx), rank? 'standard' (default) | 'quiet' | 'primary' | 'danger', title?, pressed?: bool, disabled?: bool, key?: hint, id? }
   drawn as B68Ui buttons (data-rk-btn = id, else the slot). A tap calls run(ctx) once (the button is busy until a Promise it returns settles), then
   the card draws again and the Run view redraws; a throw or a rejection is toasted. A button is GM-side: what it sends is the slot module's business.
     ctx = { room, rollKey, roomKey (room-state.js's keys: '' when the page has none), thing (a copy: name line look roll danger states tags slug),
             index, count, state (the thing's mark, '' for none), rs (the room-state instance, or null), page (the host given to create),
             refresh() (draw the card and the Run view again), close(), toast(text, bad) }

   API
     create(host) -> zoom
       host = { md(room) -> the room note's Markdown (its Things block is parsed here, room-things.js), roll() -> { key: the roll's rollKey,
                rooms: [room name] } | null, doc() -> the GM state (marks are read from it through a read-only room-state view),
                redraw() (the Run view again), toast(text, bad),
                rs?() -> the page's room-state instance, the writer (ctx.rs; null until a ticket wires it: RK11),
                things?(room) -> [thing] and where?(room) -> { rollKey, roomKey } in place of md and roll (a rolled room, RK14) }   every part optional
       zoom.html(room, o) -> markup ('' with no things; o.kit: the kit desk's classes)   zoom.noteMd(md) -> the note without its Things block
       zoom.act(el) -> bool   (a data-site="thing" control)   zoom.open(room, slug | index, anchor?) -> bool   zoom.close(focusBack)
       zoom.step(d) -> bool   zoom.key(ev, { typing, top }) -> bool (true: the key was the card's, and it is preventDefault()ed)
       zoom.isOpen()   zoom.current() -> { room, slug, index, count } | null   zoom.refresh()   zoom.addButtons(slot, fn) -> off()   zoom.destroy()
     Pure: listHtml(room, things, { kit, marks }) -> markup   rows(thing, state) -> [{ k, icon, label, lines }]   rollLines(roll) -> [line]
           slotsOf(slot, ctx, extra, root) -> [button]   noteMd(md)   ESC_ID, SLOTS, KEYS, DIM */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomZoom = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var ESC_ID = 'room.zoom', PRIORITY = 70, KEYS = 9;
  var SLOTS = ['show', 'state', 'swap'];
  var PROVIDER = { show: 'B68GmRoomShow', state: 'B68GmRoomMark', swap: 'B68GmRoomSwap' };
  var DIM = ['taken', 'gone'];
  var DIRS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
  var RANKS = ['standard', 'quiet', 'primary', 'danger'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* a module of the page, read when called: the global in the browser, require() under Node */
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (file && typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function ui() { return mod('B68Ui', '../ui/ui.js'); }
  function things() { return mod('B68GmRoomThings', './room-things.js'); }
  function noteMd(md) { var T = things(); try { return T && typeof T.read === 'function' ? T.read(md).md : str(md); } catch (e) { return str(md); } }
  function copy(t) {
    return { name: str(t.name), line: str(t.line), look: str(t.look), roll: str(t.roll), danger: str(t.danger),
      states: list(t.states).map(str), tags: list(t.tags).map(str), slug: str(t.slug) };
  }
  function good(t) { return isObj(t) && !!str(t.name).trim() && !!str(t.slug); }

  /* ---------- the room card's Things (pure) ---------- */
  function listHtml(room, ts, o) {
    o = o || {};
    var U = ui(), kit = !!o.kit, marks = isObj(o.marks) ? o.marks : {};
    ts = list(ts).filter(good);
    if (!U || typeof U.button !== 'function' || !ts.length || !str(room)) return '';
    var e = typeof U.esc === 'function' ? U.esc : esc0;
    var h = '<div class="rk-things' + (kit ? ' krv-things' : '') + '" data-rk-things="' + e(room) + '" role="group" aria-label="' + e('Things in ' + room) + '">' +
      '<h4 class="' + (kit ? 'krv-lab' : 'rv-lab') + ' rk-thead">Things</h4><ul class="rk-tlist">';
    ts.forEach(function (t, i) {
      var st = has(marks, t.slug) ? str(marks[t.slug]) : '', done = DIM.indexOf(st) >= 0;
      var cls = ['rk-thing'].concat(kit ? [] : ['rv-btn', 'sm'], done ? ['is-done'] : []);
      h += '<li class="rk-ti">' + U.button({ label: str(t.name), rank: 'quiet', cls: cls, data: { site: 'thing', room: str(room), thing: t.slug, i: String(i) },
        key: i < KEYS ? String(i + 1) : '', title: str(t.line) || 'A closer look', attrs: { 'aria-haspopup': 'dialog' } }) +
        (st ? '<span class="rk-tstate' + (done ? ' is-done' : '') + '">' + e(st) + '</span>' : '') + '</li>';
    });
    return h + '</ul></div>';
  }

  /* ---------- the zoom card's lines (pure) ---------- */
  /* "4/5: a ticket. 6: and more." -> ['4/5: a ticket.', '6: and more.'] (the 6 starts its own line) */
  function rollLines(s) { return str(s).split(/\s+(?=6\s*[:.)–-])/).map(function (l) { return l.trim(); }).filter(Boolean); }
  function rows(t, state) {
    var out = [];
    if (!isObj(t)) return out;
    if (str(t.look)) out.push({ k: 'look', icon: '🔍', label: 'A closer look', lines: [str(t.look)] });
    if (str(t.roll)) out.push({ k: 'roll', icon: '🎲', label: 'On a roll', lines: rollLines(t.roll) });
    if (str(t.danger)) out.push({ k: 'danger', icon: '!', label: 'Danger', lines: [str(t.danger)] });
    var sts = list(t.states).map(str).filter(Boolean);
    if (str(state)) out.push({ k: 'state', icon: '', label: 'State', lines: [str(state)] });
    else if (sts.length) out.push({ k: 'state', icon: '', label: 'States', lines: [sts.join(' · ')] });
    return out;
  }

  /* ---------- the button row's slots (pure, but for the modules it asks) ---------- */
  function slotsOf(slot, ctx, extra, at) {
    var fns = [], out = [], R = at || root, P = R && R[PROVIDER[slot]];
    if (P && !P.stub && typeof P.buttons === 'function') fns.push(function (c) { return P.buttons(c); });
    list(extra).forEach(function (f) { if (typeof f === 'function') fns.push(f); });
    fns.forEach(function (f) {
      var got = null; try { got = f(ctx); } catch (e) { got = null; if (root && root.console) root.console.error(e); }
      list(got).forEach(function (b) { if (isObj(b) && str(b.label).trim() && typeof b.run === 'function') out.push(b); });
    });
    return out;
  }

  function create(host) {
    host = host || {};
    var cur = null, pop = null, popAt = null, box = null, scope = null, unreg = null, extra = {}, busy = false, followSoon = false, listening = false;
    SLOTS.forEach(function (s) { extra[s] = []; });
    function doc() { return root && root.document ? root.document : null; }
    function later(fn) { if (root && typeof root.setTimeout === 'function') root.setTimeout(fn, 0); else fn(); }
    function call(name, a) { try { return typeof host[name] === 'function' ? host[name](a) : null; } catch (e) { return null; } }
    function toast(t, bad) { if (typeof host.toast === 'function') { try { host.toast(t, !!bad); } catch (e) { /* a toast is a courtesy */ } } }
    /* a room's things: the host's own list (a rolled room, RK14), else the room note's Things block */
    function thingsOf(room) {
      if (typeof host.things === 'function') return list(call('things', room)).filter(good);
      var T = things(); return T && !T.stub && typeof T.parse === 'function' ? list(T.parse(str(call('md', room)))).filter(good) : [];
    }
    function stateMod() { var M = mod('B68GmRoomState', './room-state.js'); return M && !M.stub && typeof M.create === 'function' ? M : null; }
    /* room-state.js's keys for a room: the host's own, else the roll's key and its first same-named room (roomKeys) */
    function where(room) {
      if (typeof host.where === 'function') { var w = call('where', room); return isObj(w) ? w : null; }
      var r = call('roll'), M = stateMod(); if (!isObj(r) || !M || !Array.isArray(r.rooms)) return null;
      var names = r.rooms.map(str), i = names.indexOf(str(room)), ks = i < 0 ? [] : M.roomKeys(names);
      return i >= 0 && ks[i] && str(r.key) ? { rollKey: str(r.key), roomKey: ks[i] } : null;
    }
    function rs() { var r = call('rs'); return r && typeof r.read === 'function' ? r : null; }
    /* reads need no writer: a read-only room-state view of the host's GM state (on() false, so it can never write) when the host gives no rs */
    var viewer = null;
    function reader() {
      var r = rs(); if (r) return r;
      var M = stateMod(); if (!M || typeof host.doc !== 'function') return null;
      if (!viewer) viewer = M.create({ on: function () { return false; }, doc: function () { return call('doc'); }, patch: function () { return false; },
        busy: function () { return false; }, now: function () { return Date.now(); }, part: function () { return ''; } });
      return viewer;
    }
    function marks(room) {
      var w = where(room), r = reader(); if (!w || !r || !str(w.rollKey) || !str(w.roomKey)) return {};
      try { var m = r.read(str(w.rollKey), str(w.roomKey)).marks; return isObj(m) ? m : {}; } catch (e) { return {}; }
    }
    function indexOf(ts, slug) { for (var i = 0; i < ts.length; i++) if (ts[i].slug === slug) return i; return -1; }

    /* the room card */
    function html(room, o) {
      if (cur && !followSoon) { followSoon = true; later(follow); }      /* a redraw while open: the card follows the new button */
      return listHtml(room, thingsOf(room), { kit: !!(o && o.kit), marks: marks(room) });
    }
    function buttonsIn(card) { return card ? Array.prototype.slice.call(card.querySelectorAll('[data-site="thing"][data-thing]')) : []; }
    function findBtn(room, slug) {
      var d = doc(); if (!d) return null;
      var l = Array.prototype.filter.call(d.querySelectorAll('[data-site="thing"][data-thing]'), function (b) {
        return b.getAttribute('data-room') === room && b.getAttribute('data-thing') === slug && b.isConnected !== false && b.offsetParent !== null;
      });
      return l[0] || null;
    }

    /* the card's own box and its scope host (the kit's tokens and parts on the old desk; the kit page's own theme on the new one) */
    function nightPage(d) {
      var t = d.documentElement.getAttribute('data-theme');
      if (t === 'dark') return true;
      if (t === 'light') return false;
      try { return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
    }
    function mountScope() {
      var d = doc(); if (!d) return null;
      if (!scope) { scope = d.createElement('div'); scope.className = 'rk-zscope'; scope.setAttribute('data-ui-scope', ''); }
      if (d.documentElement.hasAttribute('data-kit')) scope.removeAttribute('data-ui-theme');
      else scope.setAttribute('data-ui-theme', nightPage(d) ? 'night' : 'paper');
      if (scope.parentNode !== d.body) d.body.appendChild(scope);
      return scope;
    }
    function ensureBox() {
      var d = doc(); if (!d) return null;
      if (!box) { box = d.createElement('div'); box.className = 'ui-popover rk-zoom'; box.setAttribute('role', 'dialog'); box.addEventListener('keydown', onBoxKey); }
      return box;
    }
    function rectOf(e) { try { var r = e.getBoundingClientRect(); return { x: r.left, y: r.top }; } catch (x) { return { x: 0, y: 0 }; } }
    function float() {
      var U = ui(); if (!U || typeof U.popover !== 'function' || !cur || !cur.anchor) return false;
      if (pop) { pop.close({ focus: false }); pop = null; }
      pop = U.popover({ anchor: cur.anchor, el: box, pinned: true, placement: 'left-start', mount: mountScope(), focus: false });
      pop.open(); popAt = cur.anchor; cur.at = rectOf(cur.anchor);
      return true;
    }
    function el(tag, cls, text) { var e = doc().createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
    function btn(o, fn) {
      var U = ui(), b = U && typeof U.node === 'function' ? U.node('button', o, doc()) : null; if (!b) return null;
      b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); if (b.getAttribute('aria-busy') !== 'true' && !b.disabled) fn(b); });
      return b;
    }
    function ctxOf(t, i, n, state) {
      var w = where(cur.room) || {};
      return { room: cur.room, rollKey: str(w.rollKey), roomKey: str(w.roomKey), thing: copy(t), index: i, count: n, state: state, rs: rs(), page: host,
        refresh: refresh, close: function () { close(true); }, toast: toast };
    }
    function hookBtn(spec, slot, ctx) {
      var rank = RANKS.indexOf(spec.rank) >= 0 ? spec.rank : 'standard';
      return btn({ label: str(spec.label), rank: rank, title: str(spec.title), pressed: typeof spec.pressed === 'boolean' ? spec.pressed : undefined, disabled: !!spec.disabled,
        key: str(spec.key), data: { 'rk-btn': str(spec.id) || slot } }, function (b) {
        if (busy) return;
        busy = true; b.setAttribute('aria-busy', 'true');
        var done = function () { busy = false; b.removeAttribute('aria-busy'); refresh(); };
        var p; try { p = spec.run(ctx); } catch (e) { p = Promise.reject(e); }
        Promise.resolve(p).then(done, function (e) { toast(str(spec.label) + ' did not work: ' + str(e && e.message || e), true); done(); });
      });
    }
    function draw() {
      if (!cur || !box) return false;
      var ts = thingsOf(cur.room), i = indexOf(ts, cur.slug);
      if (i < 0) { close(false); return false; }
      var t = ts[i], n = ts.length, st = str(marks(cur.room)[t.slug]), d = doc(), had = d.activeElement && box.contains(d.activeElement) ? d.activeElement : null;
      var keep = had && had !== box ? had.getAttribute('data-rk-btn') : null;
      cur.i = i; cur.n = n;
      box.textContent = '';
      box.setAttribute('aria-label', t.name + ', ' + cur.room);
      box.appendChild(el('p', 'rk-zeye', cur.room + ' · ' + (i + 1) + ' of ' + n + (t.tags.length ? ' · ' + t.tags.join(', ') : '')));
      box.appendChild(el('h3', 'rk-zname', t.name));
      if (t.line) box.appendChild(el('p', 'rk-zline', t.line));
      var rw = rows(t, st);
      if (rw.length) {
        var dl = el('dl', 'rk-zrows');
        rw.forEach(function (r) {
          var row = el('div', 'rk-zrow rk-z' + r.k + (r.k === 'state' && DIM.indexOf(st) >= 0 ? ' is-done' : '')), dt = el('dt', 'rk-zlab');
          if (r.icon) { var ic = el('span', 'rk-zicon', r.icon); ic.setAttribute('aria-hidden', 'true'); dt.appendChild(ic); }
          dt.appendChild(d.createTextNode(r.label)); row.appendChild(dt);
          r.lines.forEach(function (l) { row.appendChild(el('dd', 'rk-zt', l)); });
          dl.appendChild(row);
        });
        box.appendChild(dl);
      }
      var ctx = ctxOf(t, i, n, st), row2 = el('div', 'rk-zbtns'), any = false;
      SLOTS.forEach(function (s) {
        var sp = el('span', 'rk-zslot'); sp.setAttribute('data-rk-slot', s);
        slotsOf(s, ctx, extra[s]).forEach(function (spec) { var b = hookBtn(spec, s, ctx); if (b) { sp.appendChild(b); any = true; } });
        row2.appendChild(sp);
      });
      if (!any) row2.className += ' is-empty';
      box.appendChild(row2);
      var nav = el('div', 'rk-znav');
      [btn({ label: 'Previous', rank: 'quiet', key: '←', disabled: n < 2, data: { 'rk-btn': 'prev' }, title: 'The room’s thing before this one' }, function () { step(-1); }),
        btn({ label: 'Next', rank: 'quiet', key: '→', disabled: n < 2, data: { 'rk-btn': 'next' }, title: 'The room’s next thing' }, function () { step(1); }),
        btn({ label: 'Close', rank: 'quiet', key: 'Esc', data: { 'rk-btn': 'close' } }, function () { close(true); })].forEach(function (b) { if (b) nav.appendChild(b); });
      box.appendChild(nav);
      if (had) { var back = keep ? box.querySelector('[data-rk-btn="' + keep.replace(/[^a-z0-9-]/gi, '') + '"]') : null; focusIn(back && !back.disabled ? back : box); }
      if (pop && popAt && popAt.isConnected !== false) pop.place();      /* the content changed size; a redraw's stale anchor is never measured */
      return true;
    }
    function focusIn(e) { try { if (e && typeof e.focus === 'function') e.focus({ preventScroll: true }); } catch (x) { /* focus is a courtesy */ } }

    function onOutside(ev) {
      if (!cur) return;
      var t = ev.target;
      if (box && box.contains(t)) return;
      if (t && t.closest && t.closest('[data-site="thing"][data-thing]')) return;      /* another thing: act() opens it */
      close(false);
    }
    function onResize() { if (cur && pop) float(); }
    function listen(on) {
      var d = doc(); if (!d || listening === on) return;
      listening = on;
      if (on) { d.addEventListener('pointerdown', onOutside, true); root.addEventListener('resize', onResize); }
      else { d.removeEventListener('pointerdown', onOutside, true); root.removeEventListener('resize', onResize); }
    }
    /* the card's own keys, heard before the popover's (registered first): Tab stays in the card (the popover would close on it and leave this file
       thinking it open), and Esc is the page's ONE Esc (B68GmEsc, through the page's capture listener), never the popover's own close */
    function onBoxKey(ev) {
      if ((ev.key === 'Escape' || ev.key === 'Esc') && typeof ev.stopImmediatePropagation === 'function') { ev.stopImmediatePropagation(); return; }
      if (ev.key !== 'Tab' || !box) return;
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      var f = Array.prototype.filter.call(box.querySelectorAll('button'), function (b) { return !b.disabled; });
      if (!f.length) { ev.preventDefault(); return; }
      var a = doc().activeElement, first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && (a === first || a === box)) { ev.preventDefault(); focusIn(last); }
      else if (!ev.shiftKey && a === last) { ev.preventDefault(); focusIn(first); }
    }

    function open(room, which, anchor) {
      room = str(room);
      var ts = thingsOf(room), i = typeof which === 'number' ? which : indexOf(ts, str(which));
      if (!(i >= 0 && i < ts.length) || !doc() || !ui()) return false;
      var t = ts[i], a = anchor && anchor.nodeType === 1 ? anchor : findBtn(room, t.slug);
      if (!a) return false;
      var moved = !cur || cur.anchor !== a;
      cur = { room: room, slug: t.slug, anchor: a, i: i, n: ts.length, at: cur ? cur.at : null };
      ensureBox();
      if (moved || !pop || !pop.isOpen()) float();
      draw();
      var E = mod('B68GmEsc', './esc.js');
      if (!unreg && E && typeof E.register === 'function') unreg = E.register(ESC_ID, { priority: PRIORITY, isOpen: function () { return !!cur; }, close: function () { close(true); } });
      listen(true);
      focusIn(box);
      return true;
    }
    function close(focusBack) {
      if (!cur) return false;
      var was = cur; cur = null;
      if (pop) { pop.close({ focus: false }); pop = null; }
      if (unreg) { unreg(); unreg = null; }
      listen(false);
      if (scope && scope.parentNode) scope.parentNode.removeChild(scope);
      if (focusBack) focusIn(was.anchor && was.anchor.isConnected !== false ? was.anchor : findBtn(was.room, was.slug));
      return true;
    }
    function step(d) {
      if (!cur) return false;
      var ts = thingsOf(cur.room), n = ts.length, i = indexOf(ts, cur.slug);
      if (n < 2 || i < 0) return false;
      return open(cur.room, ((i + (d < 0 ? -1 : 1)) % n + n) % n, null);
    }
    /* a Run view redraw: the same thing's new button, or the card goes (its room card left the screen, or the thing left the note) */
    function follow() {
      followSoon = false;
      if (!cur) return;
      var b = findBtn(cur.room, cur.slug);
      if (!b) { close(false); return; }
      if (b !== cur.anchor) {
        var was = cur.at, now = rectOf(b); cur.anchor = b;
        if (!was || Math.abs(was.x - now.x) > 4 || Math.abs(was.y - now.y) > 4) float();      /* it moved: the card moves with it */
      }
      draw();
    }
    function refresh() { if (!cur) return; draw(); if (typeof host.redraw === 'function') { try { host.redraw(); } catch (e) { /* the card is drawn */ } } }
    function act(e) {
      if (!e || typeof e.getAttribute !== 'function') return false;
      var room = str(e.getAttribute('data-room')), slug = str(e.getAttribute('data-thing'));
      if (!room || !slug) return false;
      if (cur && cur.room === room && cur.slug === slug) { close(true); return true; }      /* the same thing again: it closes */
      return open(room, slug, e);
    }
    function focusedCard() {
      var d = doc(), a = d ? d.activeElement : null;
      return a && a.closest ? a.closest('.rv-rm[data-room]') : null;
    }
    function key(ev, o) {
      o = o || {};
      if (!ev || ev.ctrlKey || ev.altKey || ev.metaKey || o.typing) return false;
      var k = str(ev.key), d = DIRS[k] || 0, n = /^[1-9]$/.test(k) ? +k : 0;
      if (!d && !n) return false;
      var stop = function () { if (typeof ev.preventDefault === 'function') ev.preventDefault(); return true; };
      if (cur) {
        if (o.top && o.top !== ESC_ID) return false;
        if (d) step(d); else open(cur.room, n - 1, null);
        return stop();
      }
      if (o.top) return false;
      var card = focusedCard(), bs = buttonsIn(card);
      if (!bs.length) return false;
      if (n) { var b = bs[n - 1]; if (b) open(b.getAttribute('data-room'), b.getAttribute('data-thing'), b); return stop(); }
      var at = bs.indexOf(doc().activeElement), to = at < 0 ? (d > 0 ? 0 : bs.length - 1) : ((at + d) % bs.length + bs.length) % bs.length;
      focusIn(bs[to]);
      return stop();
    }
    function addButtons(slot, fn) {
      if (!has(extra, slot) || typeof fn !== 'function') return function () {};
      extra[slot].push(fn);
      if (cur) draw();
      return function () { var i = extra[slot].indexOf(fn); if (i >= 0) { extra[slot].splice(i, 1); if (cur) draw(); } };
    }

    return { html: html, noteMd: noteMd, act: act, open: open, close: close, step: step, key: key, refresh: refresh, addButtons: addButtons,
      isOpen: function () { return !!cur; },
      current: function () { return cur ? { room: cur.room, slug: cur.slug, index: cur.i, count: cur.n } : null; },
      el: function () { return cur ? box : null; },
      destroy: function () { close(false); box = null; scope = null; } };
  }

  return { create: create, listHtml: listHtml, rows: rows, rollLines: rollLines, slotsOf: slotsOf, noteMd: noteMd,
    ESC_ID: ESC_ID, SLOTS: SLOTS, KEYS: KEYS, DIM: DIM };
});
