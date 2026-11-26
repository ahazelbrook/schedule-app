/* gm/room-keep.js: Keep, a quick-draw person filed into the cast as a hidden NPC (RK19 of the room key build; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomKeep in the browser, module.exports under Node. ES5. GM page only. It defines its module when it loads and reads the
   others (B68FaceLook, B68Ui) only when called. It names neither the quick cards' module nor the rolled cards' (their tests pin who names them): the
   rolled card hands it what it needs (create's o.model and o.cards), and the quick card asks it for its button (html).

   WHAT KEEP DOES. A quick card (RK17) is not an NPC. Keep makes one:
     the person      o.cards(room.people, ctx), the quick cards' cards(): found by its slot id (p1, p2), the room's people together as the room shows them, never a lone card()
     the doc         castDoc's shape (gm/npc.js): { name, alias, role, faction, description, spec, revealed: false, firstSeen: null, tags: ['room', 'generated'], gmNotes }
                     role is the kit's role label, description the card's look, spec the card's figure (named)
     the GM notes    Tell: <face> — <habit>   the role's face word (the rooms part's `face`) and the card's tell
                     Signature: <pose>          the role's pose word (the rooms part's `pose`)
                     Met: <site> · <room> · <date>
                     then the role, the want, the manner and the one line (GM-only: a player is never sent gmNotes)
                     A face or pose that is not a face-look name (an older pack) falls back to the drawn figure's own expression and arm pose, then neutral and
                     pocket, so every kept NPC has both lines (the b68 skill's rule 11)
     the write       host.file(id, doc): the page's db adapter, as fileNpc writes (POST /api/npcs), hidden. Then room-state's addKept(rollKey, roomKey, id, slot):
                     the card shows Kept after a reload, one Keep a slot. Nothing else is stored (no npcgen entry: gm:pull files the card from the doc's fields).
     a clash         a person whose name (or alias) someone in the cast already has, or one this page filed a moment ago, is REFUSED with a toast: gm:pull matches
                     a vault card by name, so a second person of the name would be filed onto the first one's card
     after Keep      Kept, and Show on iPad: the cast's own button (data-gm="npcipad"), which asks "Reveal and show?" while the person is hidden
   Replay safety: nothing here draws. Keep reads the room's slots as the roll drew them and stores an id against a slot; Reroll the room keeps kept.

   API
     html(card, ctx) -> markup | ''      the Keep button for a card (or Kept and Show on iPad); '' with no name, no writer or no file host. ctx is the quick
                                         card's own: { room, roomKey, rollKey, kit, page: the rolled host (rs(), cast(), file()) }
     create(host, o) -> { keep(roomKey, slot) -> Promise<{ ok, say, id? }>, busy(roomKey, slot) -> bool }
       host = the rolled card's host: { roll(), rs(), cast() -> { id: doc } | null (null while it loads), file(id, doc) -> Promise, toast(text, bad), redraw(),
               npc(), T(), masked() (for the people) }
       o = { model() -> the rolled model ({ rollKey, cards: [{ name, n, roomKey, people }] }), cards(slots, ctx) -> the room's quick cards, now?() -> ms }
     Pure: doc(card, o) notes(card, o) tellLine(card) sigLine(card) metLine(site, room, ms) idFor(name, ms) clash(name, cast, more) keptOf(ctx, slot) dmy(ms) TAGS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomKeep = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var TAGS = ['room', 'generated'], MAX_KEPT = 12;
  var filed = {};      /* name (folded) -> id, for the people this page filed (the cast's snapshot can lag a moment behind the write) */
  var shown = {};      /* id -> true: filed here, so Show on iPad is offered before the cast's snapshot holds them */

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function has(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k); }
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (file && typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ui() { return mod('B68Ui', '../ui/ui.js'); }
  function esc(s) { var U = ui(); return U && typeof U.esc === 'function' ? U.esc(s) : esc0(s); }
  function fold(s) { return str(s).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim(); }
  function low(s) { s = str(s).trim(); return s && !/^[A-Z][A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function bare(s) { return str(s).trim().replace(/[.!?…]+$/, ''); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- the lines ---------- */
  function looks() { var F = mod('B68FaceLook', '../display/face-look.js'); return { exprs: F ? list(F.EXPRS) : [], poses: F ? list(F.POSES) : [] }; }
  function word(s) { return str(s).trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, ''); }
  function faceWord(c) {
    var L = looks(), w = word(c && c.face), sp = isObj(c) && isObj(c.spec) ? c.spec : {}, x = isObj(sp.face) ? word(sp.face.expression) : '';
    if (L.exprs.indexOf(w) >= 0) return w;
    return L.exprs.indexOf(x) >= 0 ? x : 'neutral';
  }
  function poseWord(c) {
    var L = looks(), w = word(c && c.pose), sp = isObj(c) && isObj(c.spec) ? c.spec : {}, arms = isObj(sp.pose) && isObj(sp.pose.arms) ? sp.pose.arms : {};
    if (L.poses.indexOf(w) >= 0) return w;
    var a = [word(arms.R), word(arms.L)].filter(function (p) { return L.poses.indexOf(p) >= 0; })[0];
    return a || 'pocket';
  }
  function tellLine(c) { var h = bare(low(isObj(c) ? c.tell : '')); return 'Tell: ' + faceWord(c) + (h ? ' — ' + h : ''); }
  function sigLine(c) { return 'Signature: ' + poseWord(c); }
  function dmy(ms) { var d = new Date(typeof ms === 'number' ? ms : Date.now()); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function metLine(site, room, ms) { return 'Met: ' + [str(site).trim() || 'a rolled site', str(room).trim() || 'a room', dmy(ms)].join(' · '); }

  /* o = { site, room, now } */
  function notes(c, o) {
    o = o || {};
    var who = [str(c.label), c.masked ? 'masked' : ''].filter(Boolean).join(', ');
    var out = [tellLine(c), sigLine(c), metLine(o.site, o.room, o.now), ''];
    if (who) out.push('*' + who + '*');
    if (str(c.want)) out.push(str(c.want));
    if (str(c.manner)) out.push('Manner: ' + low(c.manner) + '.');
    if (str(c.line)) out.push('Says: “' + str(c.line) + '”');
    out.push('', '*Kept from a room’s quick-draw people.*');
    return out.join('\n').slice(0, 8000);
  }
  function doc(c, o) {
    var spec = isObj(c.spec) ? JSON.parse(JSON.stringify(c.spec)) : {};
    return { name: str(c.name).slice(0, 80), alias: '', role: str(c.label).slice(0, 80), faction: '', description: str(c.look).slice(0, 2000), spec: spec,
      revealed: false, firstSeen: null, tags: TAGS.slice(), gmNotes: notes(c, o) };
  }
  function idFor(name, ms) {
    var s = str(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'person';
    return 'npc_' + s + '_' + (typeof ms === 'number' ? ms : Date.now()).toString(36);
  }
  /* someone in the cast (or filed here) with that name or alias: their id, else '' */
  function clash(name, cast, more) {
    var n = fold(name); if (!n) return '';
    var ids = Object.keys(isObj(cast) ? cast : {});
    for (var i = 0; i < ids.length; i++) { var d = cast[ids[i]]; if (isObj(d) && (fold(d.name) === n || (str(d.alias).trim() && fold(d.alias) === n))) return ids[i]; }
    return isObj(more) && has(more, n) ? str(more[n]) : '';
  }

  /* ---------- what a card shows ---------- */
  function call(h, k, a, b) { try { return h && typeof h[k] === 'function' ? h[k](a, b) : null; } catch (e) { return null; } }
  function rsOf(ctx) { var r = call(isObj(ctx) ? ctx.page : null, 'rs'); return r && typeof r.read === 'function' && typeof r.addKept === 'function' ? r : null; }
  /* the id kept from this slot of the room, or '' */
  function keptOf(ctx, slot) {
    var rs = rsOf(ctx); if (!rs || !isObj(ctx)) return '';
    var r = null; try { r = rs.read(str(ctx.rollKey), str(ctx.roomKey)); } catch (e) { r = null; }
    var k = list(r && r.kept).filter(function (x) { return isObj(x) && x.slot === str(slot); })[0];
    return k ? str(k.id) : '';
  }
  function btn(o) {
    var U = ui();
    if (U && typeof U.button === 'function') return U.button(o);
    var d = Object.keys(o.data || {}).map(function (k) { return ' data-' + k + '="' + esc(o.data[k]) + '"'; }).join('');
    return '<button type="button" class="' + (o.cls || []).join(' ') + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + d + '>' + esc(o.label) + '</button>';
  }
  function html(c, ctx) {
    if (!isObj(c) || !str(c.name) || !isObj(ctx) || !str(ctx.roomKey) || !rsOf(ctx) || typeof ctx.page.file !== 'function') return '';
    var id = keptOf(ctx, c.id);
    if (!id) {
      return '<span class="rr-pkeep">' + btn({ label: 'Keep', rank: 'quiet', cls: ['rv-btn', 'sm', 'rr-keep'], data: { 'rr-keep': str(c.id), 'rr-room': str(ctx.roomKey) },
        title: 'Adds them to the cast, hidden from the players' }) + '</span>';
    }
    var cast = call(ctx.page, 'cast'), here = !isObj(cast) || has(cast, id) || shown[id] === true;
    return '<span class="rr-pkeep rr-pkept" data-rr-kept="' + esc(id) + '"><small class="rv-prole rr-ptag">Kept</small> ' + (here ?
      btn({ label: 'Show on iPad', rank: 'quiet', cls: ['rv-btn', 'sm'], data: { gm: 'npcipad', id: id }, title: 'Asks Reveal and show? first: they are hidden from the players' }) :
      '<small class="rv-prole">not in the cast now</small>') + '</span>';
  }

  /* ---------- the page's instance ---------- */
  function create(host, o) {
    host = host || {}; o = o || {};
    var busy = {};
    function toast(t, bad) { call(host, 'toast', t, !!bad); return { ok: !bad, say: t }; }
    function now() { var n = typeof o.now === 'function' ? o.now() : Date.now(); return typeof n === 'number' ? n : Date.now(); }
    function keep(roomKey, slot) {
      roomKey = str(roomKey); slot = str(slot);
      var key = roomKey + '|' + slot; if (busy[key]) return Promise.resolve({ ok: false, say: '' });
      var m = null; try { m = typeof o.model === 'function' ? o.model() : null; } catch (e) { m = null; }
      var room = m ? list(m.cards).filter(function (x) { return isObj(x) && x.roomKey === roomKey; })[0] : null;
      if (!room || typeof o.cards !== 'function') return Promise.resolve(toast('That room is not on the site any more.', true));
      var r0 = call(host, 'roll'), ctx = { room: room.name, roomKey: roomKey, rollKey: str(m.rollKey), page: host }, all = [];
      try { all = list(o.cards(list(room.people), ctx)); } catch (e) { all = []; }
      var c = all.filter(function (x) { return isObj(x) && x.id === slot; })[0];
      if (!c || !str(c.name)) return Promise.resolve(toast('There is nobody to keep in that place.', true));
      var rs = rsOf(ctx); if (!rs) return Promise.resolve(toast('Keep needs the room notes, and they are not available here.', true));
      var read = rs.read(ctx.rollKey, roomKey), kept = list(read && read.kept);
      if (kept.some(function (k) { return k.slot === slot; })) return Promise.resolve(toast(c.name + ' is kept already.'));
      if (kept.length >= MAX_KEPT) return Promise.resolve(toast('This room has kept ' + MAX_KEPT + ' people already.', true));
      var cast = call(host, 'cast');
      if (!isObj(cast)) return Promise.resolve(toast('The cast is still loading: try Keep again in a moment.', true));
      if (clash(c.name, cast, filed)) return Promise.resolve(toast('Someone called ' + c.name + ' is in the cast already, so Keep filed nobody (two of one name would share a vault card).', true));
      var at = now(), id = idFor(c.name, at), d = doc(c, { site: isObj(r0) ? str(r0.name) : '', room: room.name + (room.n > 1 ? ' ' + room.n : ''), now: at });
      busy[key] = true;
      return Promise.resolve().then(function () { return host.file(id, d); }).then(function () {
        busy[key] = false; filed[fold(c.name)] = id; shown[id] = true;
        var ok = rs.addKept(ctx.rollKey, roomKey, id, slot);
        call(host, 'redraw');
        return ok ? toast(c.name + ' is in the cast, hidden.') : toast(c.name + ' is in the cast, hidden, but the card could not mark them Kept (the room notes are full).', true);
      }, function (e) {
        busy[key] = false; call(host, 'redraw');
        return toast('Could not add them to the cast: ' + (e && e.message ? e.message : 'the write failed') + '.', true);
      }).then(function (r) { if (r.ok) r.id = id; return r; });
    }
    return { keep: keep, busy: function (roomKey, slot) { return !!busy[str(roomKey) + '|' + str(slot)]; } };
  }

  /* tests only: forget what this page filed */
  function reset() { filed = {}; shown = {}; }

  return { html: html, create: create, doc: doc, notes: notes, tellLine: tellLine, sigLine: sigLine, metLine: metLine, idFor: idFor, clash: clash, keptOf: keptOf,
    dmy: dmy, reset: reset, TAGS: TAGS, MAX_KEPT: MAX_KEPT };
});
