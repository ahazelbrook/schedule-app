/* gm/room-swap.js: Swap, Roll another and Reroll the room (RK15 of the room key build; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomSwap in the browser, module.exports under Node. ES5. GM page only: nothing here is sent to the iPad or a phone, and
   nothing here draws. It defines its module when it loads and reads the others (B68Ui, B68GmRoomRoll, B68GmRoomThings) only when called. The draw is
   RK13's (room-roll.js: another(), swap(i), the rr re-fork); this file owns the buttons and the writes, and writes only through the room-state
   instance it is handed (the page's rsInst(): ctx.rs on a zoom card, host.rs() on a room card). Only overrides are stored, never rolled text.

   SWAP is the zoom card's `swap` slot: buttons(ctx) answers on every draw. One "Swap" button, for a thing drawn from the room's table. A thing the note
   wrote by hand has no button (the note is the GM's, not a roll), and a room with no table has none. A tap asks room-roll for the next thing in the
   room's things order that keeps the mix, and stores it:
     a thing of the first draw      RS.setSwap(rollKey, roomKey, slug, to)      chains collapse (a to b, then b to c, stores a to c; coming round to a
                                                                                stores nothing)
     a thing Roll another added     RS.setExtra(rollKey, roomKey, the list with its slug replaced)      the draw applies swaps to the first draw only,
                                                                                so a swap stored for an extra would show nothing
   The zoom card then stays open on the thing now in that place (host.follow, the rolled instance's own). With nothing left in the table to swap in,
   the button is drawn disabled and says so.

   ROLL ANOTHER and REROLL THE ROOM are two buttons under a rolled room card's Things (create(host).html(card, o)); a tap is heard by the rolled
   instance's own capture listener on the Run pane (act(el)), never a document listener, so they go with the instance when room.tables is turned off.
     Roll another     RS.addExtra(rollKey, roomKey, RL.another(...)): the next thing the room has not shown, at the end of the list. At most 10 a room.
     Reroll the room  RS.reroll(rollKey, roomKey): a fresh draw of the read-aloud and the things (the people never move, room-state keeps `kept`).
                      It clears the room's marks, extras and swaps, so with any mark set the first tap asks ("Rerolling clears N marks") and a second
                      tap, on Reroll the room again, does it; Cancel leaves the room as it was.

   API
     buttons(ctx) -> [{ label, id, run(ctx), rank, title, disabled }]      the zoom card's hook (ctx.page.scene(roomKey) is the rolled host's)
     create(host) -> swapper      host = { scene(roomKey) -> { rollKey, roomKey, name, n, table, hand } | null, rs() -> the room-state writer | null,
                                           redraw(), toast(text, bad) }   every part optional
       swapper.html(card, o) -> markup ('' for a room with no table; o.kit: the kit desk's classes)
       swapper.act(el) -> the control to focus once the card has drawn again, or '' (not this file's)      swapper.destroy()
     Pure: swapPlan(scene, read, slug) -> { slug, to, extra } | { why }     anotherPlan(scene, read) -> slug | null     marksOf(read) -> n
           WHY */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomSwap = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var WHY = {
    writer: 'Swaps are made on the live GM page.',
    place: 'This room has no place in a saved roll yet.',
    none: 'Nothing else in this room’s table to swap in.',
    more: 'Nothing else in this room’s table to add.',
    swapFail: 'The swap was not saved. A room keeps at most 10 changes of this kind, and the setting must be on.',
    moreFail: 'It was not added. A room keeps at most 10 extra things, and the setting must be on.',
    rerollFail: 'The room was not rerolled. The setting must be on, and a room is rerolled at most 999 times.'
  };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (file && typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function live(M) { return M && !M.stub ? M : null; }
  function Roll() { return live(mod('B68GmRoomRoll', './room-roll.js')); }
  function Things() { return live(mod('B68GmRoomThings', './room-things.js')); }
  function ui() { return mod('B68Ui', '../ui/ui.js'); }
  function esc(s) { var U = ui(); return U && typeof U.esc === 'function' ? U.esc(s) : esc0(s); }

  /* ---------- the plans (pure, but for room-roll) ---------- */
  function readOf(rs, sc) {
    if (!rs || typeof rs.read !== 'function' || !isObj(sc)) return null;
    try { var r = rs.read(str(sc.rollKey), str(sc.roomKey)); return isObj(r) ? r : null; } catch (e) { return null; }
  }
  /* room-roll's opts for the room as it stands: the note's things and the stored overrides (room-state's read) */
  function optsOf(sc, rd) { return { hand: list(sc.hand), say: rd.say, rr: rd.rr, extra: list(rd.extra), swaps: isObj(rd.swaps) ? rd.swaps : {} }; }
  function placed(sc) { return !!str(sc.rollKey) && !!str(sc.roomKey); }
  function marksOf(rd) { return isObj(rd) && isObj(rd.marks) ? Object.keys(rd.marks).length : 0; }

  /* Swap for the thing now showing as slug: { slug, to, extra } (extra: it was added by Roll another), or { why } where there is nothing to do:
       'table' no table for the room, 'gone' the thing is not on the card, 'hand' the note wrote it, 'none' nothing left in the table to swap in */
  function swapPlan(sc, rd, slug) {
    var R = Roll();
    if (!R || !isObj(sc) || !isObj(sc.table) || !isObj(rd)) return { why: 'table' };
    var seed = R.key(sc.rollKey, sc.roomKey), o = optsOf(sc, rd), shown = R.roll(sc.table, seed, o).shown, i = -1;
    shown.forEach(function (e, k) { if (i < 0 && e.slug === str(slug)) i = k; });
    if (i < 0) return { why: 'gone' };
    if (shown[i].src !== 'table') return { why: 'hand' };
    var res = R.swap(sc.table, seed, o, i);
    return res ? { slug: res.slug, to: res.to, extra: o.extra.indexOf(res.slug) >= 0 } : { why: 'none' };
  }
  /* Roll another: the slug to add, or null when the table has nothing else that keeps the mix */
  function anotherPlan(sc, rd) {
    var R = Roll();
    if (!R || !isObj(sc) || !isObj(sc.table) || !isObj(rd)) return null;
    return R.another(sc.table, R.key(sc.rollKey, sc.roomKey), optsOf(sc, rd));
  }
  function nameOf(sc, slug) {
    var Th = Things(), t = isObj(sc) && isObj(sc.table) ? list(sc.table.things) : [], out = '';
    t.forEach(function (x) { if (!out && isObj(x) && Th && Th.slug(str(x.name)) === slug) out = str(x.name); });
    return out;
  }

  /* ---------- Swap: the zoom card's slot ---------- */
  function sceneOf(ctx) {
    var pg = ctx.page;
    try { var sc = pg && typeof pg.scene === 'function' ? pg.scene(str(ctx.roomKey)) : null; return isObj(sc) ? sc : null; } catch (e) { return null; }
  }
  function buttons(ctx) {
    if (!isObj(ctx) || !isObj(ctx.thing) || !str(ctx.thing.slug)) return [];
    var sc = sceneOf(ctx), slug = str(ctx.thing.slug);
    if (!sc || !isObj(sc.table)) return [];      /* not a rolled room, or a room with no table: no Swap */
    var rs = ctx.rs, rd = readOf(rs, sc), plan = rd ? swapPlan(sc, rd, slug) : { why: 'writer' };
    if (plan.why === 'hand' || plan.why === 'gone' || plan.why === 'table') return [];      /* the note's own thing stays: Swap is for a rolled one */
    var why = !rs || typeof rs.setSwap !== 'function' ? WHY.writer : !placed(sc) ? WHY.place : plan.why === 'none' ? WHY.none : '';
    return [{
      label: 'Swap', id: 'swap', rank: 'standard', disabled: !!why,
      title: why || 'Put the next thing from this room’s table in its place.',
      run: function (c) {
        c = c || ctx;
        var s2 = sceneOf(c) || sc, w = c.rs || rs, d2 = readOf(w, s2);
        if (!w || typeof w.setSwap !== 'function' || !d2) throw new Error(WHY.writer);
        if (!placed(s2)) throw new Error(WHY.place);
        var p = swapPlan(s2, d2, slug);      /* read again: another device may have written since the card drew */
        if (p.why === 'none') throw new Error(WHY.none);
        if (!p.to) throw new Error(WHY.swapFail);
        var ok = p.extra ? w.setExtra(str(s2.rollKey), str(s2.roomKey), list(d2.extra).map(function (x) { return x === p.slug ? p.to : x; }))
          : w.setSwap(str(s2.rollKey), str(s2.roomKey), p.slug, p.to);
        if (ok !== true) throw new Error(WHY.swapFail);
        var pg = c.page;
        if (pg && typeof pg.follow === 'function') pg.follow(str(c.room), s2.n, p.to);      /* the card stays open on what is there now */
      }
    }];
  }

  /* ---------- Roll another and Reroll the room: a room card's two buttons ---------- */
  function create(host) {
    host = host || {};
    var asking = {};
    function call(k, a) { try { return typeof host[k] === 'function' ? host[k](a) : null; } catch (e) { return null; } }
    function toast(t, bad) { if (typeof host.toast === 'function') { try { host.toast(t, !!bad); } catch (e) { /* a toast is a courtesy */ } } }
    function redraw() { call('redraw'); }
    function askKey(sc) { return str(sc.rollKey) + '|' + str(sc.roomKey); }
    function btn(o) {
      var U = ui(); if (!U || typeof U.button !== 'function') return '';
      return U.button({ label: o.label, rank: o.rank || 'standard', cls: ['rr-act'].concat(o.kit ? [] : ['rv-btn', 'sm']), disabled: !!o.disabled, title: o.title,
        data: { 'rr-act': o.act, 'rr-room': o.room } });
    }
    function html(c, o) {
      o = o || {};
      if (!isObj(c) || !c.table || !str(c.roomKey)) return '';
      var sc = call('scene', c.roomKey), rs = call('rs'), kit = !!o.kit;
      if (!isObj(sc) || !isObj(sc.table)) return '';
      var rd = readOf(rs, sc), ok = !!(rd && rs && typeof rs.addExtra === 'function' && placed(sc));
      var more = ok && anotherPlan(sc, rd) !== null, k = askKey(sc), marks = marksOf(rd), why = rs ? WHY.place : WHY.writer;
      /* the old desk's own label class (rv-lab) is 10.5 px, under the build's 12 px floor, so there this label is the dim 12.5 px line; the kit's label is 12 px */
      var lab = kit ? '<h4 class="krv-lab rr-lab rr-actlab">This room</h4>' : '<p class="rv-dim rr-lab rr-actlab">This room</p>';
      var head = lab + '<div class="rr-acts' + (kit ? ' krv-acts' : '') + '" data-rr-acts="' + esc(c.roomKey) + '" role="group" aria-label="' + esc('Roll another thing or reroll ' + c.name) + '">';
      var a = btn({ kit: kit, label: 'Roll another', act: 'another', room: c.roomKey, disabled: !more,
        title: !ok ? why : more ? 'Add the next thing from this room’s table.' : WHY.more });
      var b;
      if (asking[k] && ok) {      /* the question on a line of its own, then the two answers; Roll another waits */
        return lab + '<div class="rr-acts rr-asking' + (kit ? ' krv-acts' : '') + '" data-rr-acts="' + esc(c.roomKey) + '" role="group" aria-label="' + esc('Reroll ' + c.name + '?') + '">' +
          '<p class="' + (kit ? 'krv-hint' : 'rv-dim') + ' rr-asktext">' + esc('Rerolling clears ' + marks + (marks === 1 ? ' mark' : ' marks') + '.') + '</p>' +
          btn({ kit: kit, label: 'Reroll the room', rank: 'danger', act: 'reroll-yes', room: c.roomKey, title: 'Reroll this room and clear its marks.' }) + ' ' +
          btn({ kit: kit, label: 'Cancel', rank: 'quiet', act: 'reroll-no', room: c.roomKey, title: 'Leave the room as it is.' }) + '</div>';
      } else {
        b = btn({ kit: kit, label: 'Reroll the room', act: 'reroll', room: c.roomKey, disabled: !ok,
          title: !ok ? why : 'Draw this room’s read-aloud and things again. The people stay.' });
      }
      return head + a + ' ' + b + '</div>';
    }
    /* a tap: returns the control to put the focus on once the card has drawn again ('' when the element is not this file's) */
    function act(el) {
      var has = !!el && typeof el.getAttribute === 'function';
      var what = has ? str(el.getAttribute('data-rr-act')) : '', room = has ? str(el.getAttribute('data-rr-room')) : '';
      if (!what || !room) return '';
      var sc = call('scene', room), rs = call('rs'), rd = readOf(rs, sc);
      if (!isObj(sc) || !rd || !rs || !placed(sc)) { toast(rs ? WHY.place : WHY.writer, true); return what; }
      var k = askKey(sc);
      if (what === 'another') {
        var slug = anotherPlan(sc, rd);
        if (slug === null) toast(WHY.more, true);
        else if (rs.addExtra(str(sc.rollKey), str(sc.roomKey), slug) !== true) toast(WHY.moreFail, true);
        else toast('Added ' + (nameOf(sc, slug) || 'a thing') + '.');
        redraw(); return 'another';
      }
      if (what === 'reroll' && marksOf(rd) > 0) { asking[k] = true; redraw(); return 'reroll-yes'; }
      if (what === 'reroll-no') { delete asking[k]; redraw(); return 'reroll'; }
      if (what === 'reroll' || what === 'reroll-yes') {
        delete asking[k];
        if (rs.reroll(str(sc.rollKey), str(sc.roomKey)) !== true) toast(WHY.rerollFail, true);
        else toast('Rerolled ' + str(sc.name) + '.');
        redraw(); return 'reroll';
      }
      return '';
    }
    return { html: html, act: act, destroy: function () { asking = {}; } };
  }

  return { buttons: buttons, create: create, swapPlan: swapPlan, anotherPlan: anotherPlan, marksOf: marksOf, WHY: WHY };
});
