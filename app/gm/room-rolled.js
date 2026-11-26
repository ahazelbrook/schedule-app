/* gm/room-rolled.js: room cards for a rolled site (RK14 of the room key build; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomRolled in the browser, module.exports under Node. ES5. GM page only: nothing here is sent, stored or drawn on the
   iPad or a phone. It defines its module when it loads and reads the others (B68GmRoomRoll, B68GmRoomTables, B68GmRoomThings, B68GmRoomState,
   B68Ui, B68GmRoomPeople) only when called: the room-tables bundle brings room-key first. The zoom card is RK09's, made by the page (host.zoom).

   WHERE IT DRAWS (Gate 1: the Run pane, runSite() untouched; _briefs/RK14-spike.md). The page's Run pane (#gm-runv) draws a v2 night with B68GmRunView and
   any other card (a rolled site, a saved one, an authored site with no v2 play) with RUN_HELP. With room.tables on, that second branch is this file's:
   draw(box, line) puts the site line and one card per room of the roll there, in the roll's order (by band). An authored v2 night keeps the Run view's
   cards, and its host's roomThings(room) asks block(room) for the same parts of the card. Nothing here calls runSite() or touches ball, the mission
   (missionSource reads the prep note, never the tables), cards.location, sites or the display: the cards are GM DOM only.

   A ROOM CARD (ruling 7: Landmark, Hidden and Secret).
     the eyebrow       the room's band, and "★ target" when it is the score's target
     the read-aloud    the table's say line (room-roll's say stream) and the app's "There's ..." line naming the things on the card by name only
                       (room-roll.there); a room with no table says "No table for <room>" (ruling 6: no theme-item fallback) and shows its
                       printed line instead, as the Location roller does
     Things            RK09's list: the note's things first, topped up from the table to 4 (RK13); a click, or 1 to 9 with the focus
                       in the card, opens the zoom card (Show on iPad, the states, Swap: RK10, RK11, RK15)
     Who's here        the people slots room-roll drew ({ role, seed }, ids p1, p2), drawn as quick-draw cards by room-people.js (RK17):
                       B68GmRoomPeople.html(slots, ctx), ctx.page = this host (its npc(), T() and masked() give the tables); a plain list of the roles
                       when that file is not there; "Nobody drawn." when the draw is empty
     If it goes wrong  the note's own lines (each with "→ the Roll", as the Run view's card) and the things' danger lines, as text: a danger
                       line is Secret, never sendable, and the Roll's line is stamped on the iPad, so it gets no button
     Exits             the roll's own: the room's back route (connects: "Out via ...") and the ring-skips from or to it
     the note          the room's prep note (### under ## Rooms), without its Things block, as the Run view draws it
   Rooms of one name are separate cards, told apart by n (room-state.js's roomKey: showroom#1, showroom#2; RK11's twins).

   STATE. Read through room-state (say, rr, extra, swaps, marks): host.rs() when the host gives the page's writer, else a read-only view of host.doc()
   (as RK09's card reads marks). This file writes nothing; the zoom card's buttons write through ctx.rs (RK11's marks, RK15's Swap): the page's writer,
   rsInst() (the overseer's RK14 ruling: the fifth rsInst line in gm-page.js). RK15's room-swap.js (a module of this bundle) adds, through this file's own
   parts and no page line: the card's "This room" row (Roll another, Reroll the room: the `actions` part, heard by this instance's capture listener on the Run
   pane), and the zoom host's scene(roomKey) and follow(room, n, slug), which Swap reads and calls through ctx.page. Marks are keyed by the rolled room's own roomKey (twins: name#2). The draw is room-roll's: three streams from the page's rollKey(roll) and the roomKey, after the roll, so
   nothing draws inside generate() and a reload gives the same cards.

   API
     create(host) -> rolled
       host = { roll() -> the roll on the Location card (S.locRoll) | null, rollKey(roll) -> the page's rollKey, T() -> the rooms part's T | null,
                md(room) -> the room's prep Markdown ('' for none), note(room) -> the note as markup | null, wrong(room) -> [the note's If it goes
                wrong lines], decorate(el), doc() -> the GM state (read through a read-only room-state view), rs() -> the page's room-state writer (the zoom
                card's ctx.rs, see STATE), redraw(), toast(text, bad), kit() -> bool (the kit desk), npc() -> the npc part's T | null and
                masked() -> bool (the authored site's play.crowd.masked), both for the quick-draw people (room-people.js, RK17),
                zoom(hooks) -> RK09's zoom card made with these hooks (its things(room, n) and where(room, n) in place of a note and a roll; doc, rs,
                redraw, toast), made once, box() -> the Run pane (a v2 card's things are heard there) }   every part optional; with no zoom the cards draw with no Things list
       rolled.draw(box, line) -> bool        the site line and the cards into box (false, and nothing drawn, with no roll)
       rolled.block(room, o) -> markup|null  the card's parts for the Run view's own card of that room (o.kit); null when the roll has no such room
       rolled.act(el) -> bool                a thing's button (data-site="thing") of this roll: its zoom card opens (or closes, tapped again)
       rolled.key(ev, o) -> bool             1 to 9 and the arrows in a focused card, or in its open zoom card (RK09's keys)
       rolled.model()   rolled.zoom() -> the zoom card   rolled.isOpen()   rolled.close()   rolled.destroy()
     Pure: model(roll, T, { rollKey, state?(rollKey, roomKey) -> read, hand?(room) -> [thing] }) -> { rollKey, tables, cards: [card] } | null
             card = { name, n, roomKey, band, target, table, say, there, detail, things: [thing + slug], people: [{ id, role, seed }],
                      wrong: [{ name, line }], exits: [line] }
           exitsOf(roll, room) -> [line]   roleLabel(role)   cardHtml(card, o)   siteHtml(model, o)   blockHtml(card, o)   NO_TABLE(room)   BANDS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomRolled = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BANDS = { public: 'Public', working: 'Working', controlled: 'Controlled', secure: 'Secure' };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (file && typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function live(M) { return M && !M.stub ? M : null; }
  function Roll() { return live(mod('B68GmRoomRoll', './room-roll.js')); }
  function Tables() { return live(mod('B68GmRoomTables', './room-tables.js')); }
  function Things() { return live(mod('B68GmRoomThings', './room-things.js')); }
  function State() { return live(mod('B68GmRoomState', './room-state.js')); }
  function Swap() { return live(mod('B68GmRoomSwap', './room-swap.js')); }
  function ui() { return mod('B68Ui', '../ui/ui.js'); }
  function esc(s) { var U = ui(); return U && typeof U.esc === 'function' ? U.esc(s) : esc0(s); }
  function cap(s) { s = str(s).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function NO_TABLE(room) { return 'No table for ' + str(room); }
  function roleLabel(role) { return cap(str(role).replace(/[-_]+/g, ' ')); }

  /* ---------- the model (pure, but for the modules it reads) ---------- */
  function exitsOf(roll, room) {
    var out = [], name = isObj(room) ? str(room.name) : '';
    if (!name) return out;
    if (str(room.connects).trim()) out.push('Out via ' + str(room.connects).trim());
    list(isObj(roll) ? roll.skips : null).forEach(function (s) {
      if (!isObj(s) || !str(s.via).trim()) return;
      if (s.from === name && str(s.to) && s.to !== name) out.push(cap(s.via) + ' to ' + str(s.to));
      else if (s.to === name && str(s.from) && s.from !== name) out.push(cap(s.via) + ' from ' + str(s.from));
    });
    return out.filter(function (l, i) { return out.indexOf(l) === i; });
  }
  function thingCopy(t, slug) {
    return { name: str(t.name), line: str(t.line), look: str(t.look), roll: str(t.roll), danger: str(t.danger),
      states: list(t.states).map(str), tags: list(t.tags).map(str), slug: str(slug) };
  }
  function model(roll, T, o) {
    o = o || {};
    var R = Roll(), Tb = Tables(), St = State(), rk = o.rollKey;
    if (!R || !Tb || !St || !isObj(roll) || !Array.isArray(roll.rooms) || (typeof rk !== 'number' && typeof rk !== 'string') || rk === '') return null;
    var T0 = isObj(T) ? T : null, hands = {};
    function hand(name) {
      if (!has(hands, name)) { var h = []; try { h = typeof o.hand === 'function' ? list(o.hand(name)) : []; } catch (e) { h = []; } hands[name] = h.filter(isObj); }
      return hands[name];
    }
    var s = R.site(roll, T0, { rollKey: rk, state: o.state, hand: function (room) { return hand(isObj(room) ? str(room.name) : ''); } });
    if (!s) return null;
    var names = roll.rooms.map(function (r) { return isObj(r) ? str(r.name) : ''; }), keys = St.roomKeys(names), seen = {}, cards = [];
    roll.rooms.forEach(function (r, i) {
      var name = names[i], key = keys[i], e = key && has(s.rooms, key) ? s.rooms[key] : null;
      if (!name || !e || !isObj(e.draw)) return;
      var n = seen[name] = (seen[name] || 0) + 1, d = e.draw, table = T0 ? Tb.get(name, T0) : null, h = hand(name);
      var things = list(d.shown).map(function (x) {
        var t = x.src === 'note' ? h[x.i] : table ? list(table.things)[x.i] : null;
        return isObj(t) && str(t.name).trim() && str(x.slug) ? thingCopy(t, x.slug) : null;
      }).filter(Boolean);
      var say = d.table && table && typeof d.say === 'number' ? str(list(table.say)[d.say]) : '';
      cards.push({ name: name, n: n, roomKey: key, band: str(r.band), target: !!r.isTarget, table: !!d.table, say: say,
        there: R.there(things.map(function (t) { return t.name; })), detail: str(r.detail),
        things: things, people: list(d.people).map(function (p, k) { return { id: 'p' + (k + 1), role: str(p.role), seed: p.seed }; }),
        wrong: things.filter(function (t) { return !!t.danger.trim(); }).map(function (t) { return { name: t.name, line: t.danger }; }),
        exits: exitsOf(roll, r) });
    });
    return { rollKey: str(rk), tables: !!T0, cards: cards };
  }

  /* ---------- the markup (pure) ----------
     Only classes the page already styles: the Run view's (rv-*, gm.css) on the old desk, and the kit desk's (krv-*, ui/desk-run.css) beside them, so
     this bundle needs no stylesheet. The cards sit in gm.css's view grid (gm-vgrid), each in a box (gm-box) of its own.
     o: { kit, run (a v2 card's block), things(card) -> the Things list markup, actions(card) -> Roll another and Reroll the room (RK15), note(card) -> markup | null, wrong(card) -> [the note's lines], people(card) -> markup | '' } */
  function part(o, k, c, dflt) { try { return typeof o[k] === 'function' ? o[k](c) : dflt; } catch (e) { return dflt; } }
  function cls(o, old, kit) { return o.kit ? old + ' ' + kit : old; }
  function lab(o, text) { return '<h4 class="' + (o.kit ? 'krv-lab' : 'rv-lab') + ' rr-lab">' + esc(text) + '</h4>'; }
  function sayBox(text, attr) { return '<div class="rv-say rr-say"' + (attr || '') + '><span class="rv-saylab">SAY</span> “' + esc(text) + '”</div>'; }
  function sayHtml(c, o) {
    var at = ' data-rr-room="' + esc(c.roomKey) + '"';
    if (!c.table) {
      return '<p class="' + cls(o, 'rv-dim rr-none', 'krv-hint') + '"' + at + '>' + esc(NO_TABLE(c.name)) + (c.detail ? '. ' + esc(c.detail) : '') + '</p>' +
        (c.there ? sayBox(c.there) : '');
    }
    var t = [c.say, c.there].filter(Boolean).join(' ');
    return t ? sayBox(t, at + ' data-rr-say') : '';
  }
  function peopleHtml(c, o) {
    var own = str(part(o, 'people', c, ''));
    var head = lab(o, o.run ? 'Quick-draw people' : 'Who’s here');      /* a v2 card has its own Who's here (the play's people) above */
    if (own) return head + own;
    return head + '<ul class="' + cls(o, 'rv-who rr-ppl', 'krv-ppl') + '">' + (c.people.length ? slotItems(c) : '<li class="rv-dim">Nobody drawn.</li>') + '</ul>';
  }
  /* the people slots as list items: the one place for their markup (the Blade tap's people join this list through its hook's slots) */
  function slotItems(c) {
    return list(c && c.people).map(function (p) {
      return '<li class="npc rr-slot" data-rr-slot="' + esc(p.id) + '" data-role="' + esc(p.role) + '"><b>' + esc(roleLabel(p.role)) + '</b> <small class="rv-dim">quick-draw</small></li>';
    }).join('');
  }
  function toRoll(l) {
    var U = ui(), title = 'Put this line in the Roll’s If it goes wrong line';
    return U && typeof U.button === 'function' ? U.button({ label: '→ the Roll', rank: 'quiet', cls: ['rv-btn', 'sm', 'rv-toroll'], data: { gm: 'site', site: 'threat', text: l }, title: title }) : '';
  }
  function wrongHtml(c, o) {
    var mine = list(part(o, 'wrong', c, [])).map(str).filter(Boolean);
    if (!mine.length && !c.wrong.length) return '';
    return lab(o, 'If it goes wrong') + '<div class="' + cls(o, 'rv-wrong rr-wrong', 'krv-wrong') + '">' +
      mine.map(function (l) { return '<p class="rr-wnote"><span class="rv-wrongt">' + esc(l) + '</span> ' + toRoll(l) + '</p>'; }).join('') +
      c.wrong.map(function (w) { return '<p class="rr-wthing"><b>' + esc(w.name) + ':</b> <span class="rv-wrongt">' + esc(w.line) + '</span></p>'; }).join('') + '</div>';
  }
  function exitsHtml(c, o) {
    return c.exits.length ? '<p class="' + cls(o, 'rv-rmpcs rr-exits', 'krv-pcs') + '"><span class="' + (o.kit ? 'krv-lab' : 'rv-lab') + '">Exits</span> ' + c.exits.map(esc).join(' · ') + '</p>' : '';
  }
  /* the card's parts after its heading: the read-aloud, Things, Who's here, If it goes wrong, Exits (block() hands these to the Run view's own card) */
  function blockHtml(c, o) {
    o = o || {};
    return sayHtml(c, o) + str(part(o, 'things', c, '')) + str(part(o, 'actions', c, '')) + peopleHtml(c, o) + wrongHtml(c, o) + exitsHtml(c, o);
  }
  function cardHtml(c, o) {
    o = o || {};
    var eye = [BANDS[c.band] || cap(c.band), c.target ? '★ target' : ''].filter(Boolean).join(' · '), note = part(o, 'note', c, null);
    return '<div class="gm-box rr-cell"><div class="gm-vcell-body">' +
      '<section class="' + cls(o, 'rv-rm rr-rm', 'krv-rm') + '" data-room="' + esc(c.name) + '"' + (c.n > 1 ? ' data-rn="' + c.n + '"' : '') + ' aria-label="' + esc(c.name) + '">' +
      (eye ? '<p class="' + cls(o, 'rv-rmk rr-eye', 'krv-eyebrow') + '">' + esc(eye) + '</p>' : '') +
      '<h3 class="' + cls(o, 'rv-sh rr-name', 'krv-rmt') + '">' + esc(c.name) + (c.n > 1 ? ' <small>' + c.n + '</small>' : '') + '</h3>' +
      blockHtml(c, o) + (typeof note === 'string' && note ? '<div class="' + cls(o, 'rv-rmnote pp-doc pp-cardbody rr-note', 'krv-note') + '">' + note + '</div>' : '') + '</section></div></div>';
  }
  function siteHtml(m, o) {
    o = o || {};
    var n = m.cards.length, tabled = m.cards.filter(function (c) { return c.table; }).length;
    var hint = n + (n === 1 ? ' room' : ' rooms') + (m.tables ? ', ' + tabled + ' with a table' : ': the pack has no room tables') + '. Tap a thing for a closer look.';
    return '<div class="rr-site" data-rr-site="' + esc(m.rollKey) + '">' + str(o.line) +
      '<h3 class="' + cls(o, 'rv-sh rr-title', 'krv-rmt') + '">' + esc(str(o.title) || 'Rooms') + '</h3><p class="' + cls(o, 'rv-dim rr-hint', 'krv-hint') + '">' + esc(hint) + '</p>' +
      '<div class="gm-vgrid rr-cards">' + m.cards.map(function (c) { return cardHtml(c, o); }).join('') + '</div></div>';
  }

  /* ---------- the page's instance ---------- */
  function create(host) {
    host = host || {};
    var z = null, boxes = [], viewer = null;
    function call(k, a) { try { return typeof host[k] === 'function' ? host[k](a) : null; } catch (e) { return null; } }
    /* reads need no writer: the host's room-state instance when it gives one, else a read-only view of its GM state (on() false: it can never write), as RK09's card reads marks */
    function reader() {
      var r = call('rs'); if (r && typeof r.read === 'function') return r;
      var M = State(); if (!M || typeof M.create !== 'function' || typeof host.doc !== 'function') return null;
      if (!viewer) viewer = M.create({ on: function () { return false; }, doc: function () { return call('doc'); }, patch: function () { return false; },
        busy: function () { return false; }, now: function () { return Date.now(); }, part: function () { return ''; } });
      return viewer;
    }
    function now() {
      var r = call('roll'); if (!isObj(r)) return null;
      var rk = null; try { rk = typeof host.rollKey === 'function' ? host.rollKey(r) : null; } catch (e) { rk = null; }
      var rs = reader();
      return model(r, call('T'), { rollKey: rk,
        state: function (a, b) { try { return rs && typeof rs.read === 'function' ? rs.read(str(a), b) : null; } catch (e) { return null; } },
        hand: handOf });
    }
    function handOf(name) { var md = str(call('md', name)), Th = Things(); return md && Th && typeof Th.parse === 'function' ? Th.parse(md) : []; }
    /* RK15 (Swap, Roll another, Reroll the room: gm/room-swap.js): a room of the roll as the draw sees it, by its roomKey */
    function scene(roomKey) {
      var m = now(), c = m ? m.cards.filter(function (x) { return x.roomKey === str(roomKey); })[0] : null, Tb = Tables(), T = call('T');
      return c ? { rollKey: m.rollKey, roomKey: c.roomKey, name: c.name, n: c.n, table: Tb && isObj(T) ? Tb.get(c.name, T) : null, hand: handOf(c.name) } : null;
    }
    var sw = null;
    function swapper() {
      var S = Swap();
      if (!sw && S && typeof S.create === 'function') sw = S.create({ scene: scene, rs: function () { return call('rs'); }, redraw: function () { call('redraw'); },
        toast: function (t, bad) { if (typeof host.toast === 'function') host.toast(t, bad); } });
      return sw;
    }
    function find(m, room, n) {
      n = n || 1;
      return m ? m.cards.filter(function (c) { return c.name === str(room) && c.n === n; })[0] || null : null;
    }
    function zoom() {
      if (!z && typeof host.zoom === 'function') z = call('zoom', {
        things: function (room, n) { var c = find(now(), room, n); return c ? c.things : []; },
        where: function (room, n) { var m = now(), c = find(m, room, n); return c ? { rollKey: m.rollKey, roomKey: c.roomKey } : null; },
        doc: function () { return call('doc'); }, rs: function () { return call('rs'); },
        redraw: function () { call('redraw'); }, toast: function (t, bad) { if (typeof host.toast === 'function') host.toast(t, bad); },
        scene: scene,      /* RK15: the Swap button asks for the room it is in (ctx.page.scene) */
        follow: function (room, n, slug) { call('redraw'); if (z) z.open(room, slug, null, n); } }) || null;      /* ... and the card follows the thing now in that place */
      if (z && (typeof z.html !== 'function' || typeof z.act !== 'function' || typeof z.key !== 'function')) z = null;
      return z;
    }
    function opts(kit, m, inRunView) {
      var Z = zoom(), P = live(mod('B68GmRoomPeople', './room-people.js'));
      return { kit: kit, run: !!inRunView,
        things: function (c) { return Z ? Z.html(c.name, { kit: kit, n: c.n }) : ''; },
        note: function (c) { return c.n === 1 ? call('note', c.name) : null; },
        actions: function (c) { var S = swapper(); return S ? str(S.html(c, { kit: kit })) : ''; },      /* RK15: Roll another and Reroll the room (room-swap.js) */
        wrong: function (c) { return c.n === 1 && !inRunView ? list(call('wrong', c.name)) : []; },      /* the Run view's card draws the note's lines itself */
        people: function (c) { return P && typeof P.html === 'function' ? str(P.html(c.people, { room: c.name, roomKey: c.roomKey, rollKey: m.rollKey, kit: kit, page: host })) : ''; } };
    }
    function act(el) {
      if (!el || typeof el.getAttribute !== 'function' || !el.getAttribute('data-thing')) return false;
      var Z = zoom(), n = parseInt(str(el.getAttribute('data-rn')), 10) || 1;
      if (!Z || !find(now(), el.getAttribute('data-room'), n)) return false;
      Z.act(el);
      return true;
    }
    function onAct(ev, a) {
      var S = swapper(), pane = boxes.filter(function (b) { return b.contains(a); })[0], room = a.getAttribute('data-rr-room'), next = S ? S.act(a) : '';
      if (!next) return;
      ev.preventDefault(); ev.stopPropagation();
      var again = pane ? Array.prototype.filter.call(pane.querySelectorAll('[data-rr-act="' + next + '"]'), function (e) { return e.getAttribute('data-rr-room') === room; })[0] : null;
      if (again && typeof again.focus === 'function') { try { again.focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ } }
    }
    function onClick(ev) {
      var t = ev.target, a = t && t.closest ? t.closest('[data-rr-act]') : null;
      if (a && a.closest('.rr-site, .rv-rm')) { onAct(ev, a); return; }      /* RK15: Roll another and Reroll the room (this roll's own cards only) */
      var b = t && t.closest ? t.closest('[data-site="thing"][data-thing]') : null;
      if (!b || !b.closest('.rr-site, .rv-rm') || !act(b)) return;
      ev.preventDefault(); ev.stopPropagation();      /* heard first (capture): the Run view's own routing (site.act, RK09's card) never sees a rolled room's thing */
    }
    function listen(box) { if (box && boxes.indexOf(box) < 0 && typeof box.addEventListener === 'function') { box.addEventListener('click', onClick, true); boxes.push(box); } }
    function draw(box, line) {
      if (!box) return false;
      var m = now(); if (!m) return false;
      var kit = !!call('kit'), o = opts(kit, m, false), r = call('roll');
      o.line = str(line); o.title = isObj(r) && str(r.name) ? str(r.name) : 'Rooms';
      var h = siteHtml(m, o);
      if (box.__rrHtml !== h || !box.querySelector('.rr-site')) {
        box.innerHTML = h; box.__rrHtml = h;
        box.removeAttribute('data-help');
        Array.prototype.forEach.call(box.querySelectorAll('.rr-note'), function (el) { if (typeof host.decorate === 'function') { try { host.decorate(el); } catch (e) { /* the note still reads */ } } });
      }
      listen(box);
      return true;
    }
    function block(room, o) {
      var m = now(), c = find(m, room, 1); if (!c) return null;
      listen(call('box'));
      return blockHtml(c, opts(!!(o && o.kit), m, true));
    }
    function key(ev, o) { var Z = zoom(); return !!(Z && Z.key(ev, o)); }
    var bl = null, raw = { now: now, opts: opts, click: onClick, slots: slotItems, live: function () { return boxes.length > 0; } }; function blade() { if (!bl) { var B = live(mod('B68GmRoomBlade', './room-blade.js')); bl = B && typeof B.hook === 'function' ? B.hook(host, raw) : null; } return bl || raw; } now = function () { return blade().now(); }; opts = function (k, m, r) { return blade().opts(k, m, r); }; onClick = function (ev) { return blade().click(ev); };      /* RK16: the Blade tap (gm/room-blade.js), looked up when called (it loads after this file), wraps the model, card parts and click of this instance */
    return { draw: draw, block: block, act: act, key: key, model: now, zoom: zoom,
      isOpen: function () { return !!(z && z.isOpen()); },
      close: function () { if (z) z.close(false); },
      destroy: function () {
        if (z) z.destroy(); z = null;
        if (sw) sw.destroy(); sw = null;
        boxes.forEach(function (b) { b.removeEventListener('click', onClick, true); b.__rrHtml = null; }); boxes = [];
      } };
  }

  return { create: create, model: model, exitsOf: exitsOf, roleLabel: roleLabel, cardHtml: cardHtml, siteHtml: siteHtml, blockHtml: blockHtml,
    NO_TABLE: NO_TABLE, BANDS: BANDS };
});
