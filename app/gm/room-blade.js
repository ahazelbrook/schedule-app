/* gm/room-blade.js: the Blade tap that fits one rolled room (RK16 of the room key build; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomBlade in the browser, module.exports under Node. ES5. GM page only: what Blade answers is kept in the GM state
   through room-state.js (setBlade: the ONE place a room's text is stored) and drawn on the GM's own card. Nothing here sends anything to the iPad or a
   phone: a Blade thing is a thing like any other on the card, and Show on iPad on it is RK10's single-line path, never a second one.
   It defines its module when it loads and reads the others (B68GmRoomState, B68GmRoomRoll, B68GmLocation, B68Ui) only when called.

   WHERE IT DRAWS. RK14's rolled-room cards look this module up on ONE line, when called (it loads after them in the bundle, so a card drawn before it
   arrives picks it up on its next draw), and make one hook per rolled instance, hook(host, inner): it wraps that instance's own now(), opts() and click
   handler, so everything here goes with the instance (room.tables turned off live destroys it: its capture listener on the Run pane
   is the wrapped one). No document listener, no key, no stylesheet: only classes the page already styles (rv-* on the old desk, krv-* on the kit).
     now()     the model, with each card's stored Blade entry laid over it (apply): Blade's say in place of the table's read-aloud, its things after
               the drawn ones (each with a ✦ before its button in the Things list) (by slug: a thing already on the card is never doubled), the "There's ..." line naming them all, their danger lines
               in If it goes wrong (as text: Secret), and its people lines (in Who's here, each with a ✦). So the zoom card, the keys, marks and Show on iPad see Blade's things too.
     opts()    the card's Things part gets the Blade block first: "Fit to tonight (~3¢)" (and, once fitted, the ✦ Blade line saying what it changed,
               and Clear). Only a room with a table offers it (ruling 6: no theme-item fallback, so a room with no table keeps saying so).
     click     a Blade button in a rolled card (data-rb): heard first, then everything else goes to the instance's own handler.

   THE TAP. POST /api/gm/assist/room (functions/_lib/assist/room-seat.js, through the page's runtime: host.gm() or window.claude.gm, assistRoom) with
   only what the card already shows the GM (payload): the site (name, theme, faction), the room (name, band, the table's read-aloud, the drawn things'
   names and first lines, the people slots' roles) and tonight (the goal and the plan from the roll's own glance, who is on stage). Never a closer
   look, a roll line or a danger line. One tap at a time: while it runs every Fit button on the page is busy ("Fitting…"). The answer is
   checked again here (check); it lands as setBlade(rollKey, roomKey, { say, things, people }); a refusal, a malformed answer or an error is a toast
   and nothing changes. An answer that comes back after its room was rerolled is dropped with a toast, and one that comes back after the
   cards were torn down (inner.live() false) is dropped quietly: never written. Reroll the room (RK15, room-state's reroll) takes the Blade entry away with the rest; Clear takes it away alone.

   API
     hook(host, inner) -> { now, opts, click, busy } | null   inner = the instance's { now, opts, click, live?, slots? }; host = the rolled instance's host (roll(),
                                                          rs(), doc(), redraw(), toast(text, bad), gm?() -> the runtime, tonight?() -> { goal?, plan?, onStage? })
     Pure: apply(card, blade, there?) -> card    payload(roll, card, tonight) -> body    check(answer) -> { room } | { error }
           blockHtml(card, o) -> markup (o: { kit, busy, any })    starThings(listHtml, card)    peopleHtml(card, own, kit, slots?)    LABEL, MARK, BUSY, LIMITS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomBlade = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var LABEL = 'Fit to tonight (~3¢)', MARK = '✦ Blade', BUSY = 'Fitting…';
  /* the server's request limits (room-seat.js IN; gm-room-blade.test.mjs keeps them equal) and its answer limits */
  var LIMITS = { site: 80, theme: 60, faction: 80, room: 80, say: 300, thing: 40, thingLine: 80, things: 10, role: 24, people: 6, goal: 200, plan: 300,
    name: 80, onStage: 6, bladeThings: 2, bladePeople: 3, person: 120 };
  var BANDS = ['public', 'working', 'controlled', 'secure'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (file && typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function live(M) { return M && !M.stub ? M : null; }
  function ui() { return mod('B68Ui', '../ui/ui.js'); }
  function esc(s) { var U = ui(); return U && typeof U.esc === 'function' ? U.esc(s) : esc0(s); }
  function cap(s) { s = str(s).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function copy(o) { var c = {}, k; for (k in o) if (own(o, k)) c[k] = o[k]; return c; }
  /* whitespace squashed, then cut at max characters with no half surrogate pair (the server squashes and refuses anything longer) */
  function cut(s, max) {
    s = str(s).replace(/\s+/g, ' ').trim();
    if (s.length > max) { s = s.slice(0, max); var c = s.charCodeAt(max - 1); if (c >= 0xd800 && c <= 0xdbff) s = s.slice(0, -1); s = s.trim(); }
    return s;
  }

  /* ---------- the card (pure) ---------- */
  /* The stored Blade entry (room-state read().blade: { at, say, things: [thing + slug], people: [{ line, role? }] }) laid over a rolled card.
     there(names) -> the "There's ..." line (room-roll's); without it the card's own line stays. Returns a new card; no entry: the card as it was. */
  function apply(card, blade, there) {
    if (!isObj(card) || !isObj(blade)) return card;
    var c = copy(card), have = list(card.things).map(function (t) { return str(t.slug); }), added = [];
    list(blade.things).forEach(function (t) {
      if (!isObj(t) || !str(t.name).trim() || !str(t.slug) || have.indexOf(str(t.slug)) >= 0) return;
      have.push(str(t.slug)); added.push(t);
    });
    var say = str(blade.say).trim();
    c.tableSay = str(card.say);
    if (say) c.say = say;
    c.things = list(card.things).concat(added.map(function (t) {
      return { name: str(t.name), line: str(t.line), look: str(t.look), roll: str(t.roll), danger: str(t.danger), states: list(t.states).map(str),
        tags: list(t.tags).map(str), slug: str(t.slug), blade: true };
    }));
    if (typeof there === 'function' && added.length) { try { c.there = str(there(c.things.map(function (t) { return t.name; }))); } catch (e) { /* the card's own line stays */ } }
    c.wrong = list(card.wrong).concat(added.filter(function (t) { return !!str(t.danger).trim(); }).map(function (t) { return { name: str(t.name), line: str(t.danger) }; }));
    c.blade = { at: str(blade.at), say: !!say, things: added.map(function (t) { return str(t.name); }),
      people: list(blade.people).filter(function (p) { return isObj(p) && str(p.line).trim(); }).map(function (p) { return { line: str(p.line), role: str(p.role) }; }) };
    return c;
  }

  /* the request body: only what the card already shows the GM (never a closer look, a roll or a danger line), each text cut to the server's limit */
  function glanceOf(roll) {
    var L = mod('B68GmLocation', './location.js');
    if (!L || typeof L.glance !== 'function' || !isObj(roll) || roll.auth) return null;
    try { return L.glance(roll); } catch (e) { return null; }
  }
  function payload(roll, card, tonight) {
    var r = isObj(roll) ? roll : {}, c = isObj(card) ? card : {}, t = isObj(tonight) ? tonight : {}, g = glanceOf(r) || {}, tg = isObj(g.target) ? g.target : {};
    var mine = list(c.things).filter(function (x) { return isObj(x) && !x.blade; });
    var what = str(r.targetWhat) || str(tg.what), where = str(r.targetRoom) || str(tg.room);
    var goal = str(t.goal) || (what ? 'The target' + (where ? ', ' + where : '') + ': ' + what : '');
    return {
      site: { name: cut(r.name || r.auth || 'The site', LIMITS.site), theme: cut(r.themeName, LIMITS.theme), faction: cut(r.faction, LIMITS.faction) },
      room: { name: cut(c.name, LIMITS.room), band: BANDS.indexOf(str(c.band)) >= 0 ? str(c.band) : '',
        say: cut(own(c, 'tableSay') ? c.tableSay : c.say, LIMITS.say),
        things: mine.slice(0, LIMITS.things).map(function (x) { return { name: cut(x.name, LIMITS.thing), line: cut(x.line, LIMITS.thingLine) }; }).filter(function (x) { return !!x.name; }),
        people: list(c.people).map(function (p) { return cut(isObj(p) ? p.role : '', LIMITS.role); }).filter(Boolean).slice(0, LIMITS.people) },
      tonight: { goal: cut(goal, LIMITS.goal), plan: cut(str(t.plan) || str(g.plan), LIMITS.plan),
        onStage: list(t.onStage).map(function (n) { return cut(n, LIMITS.name); }).filter(Boolean).slice(0, LIMITS.onStage) }
    };
  }

  /* the answer, checked again on the page (the server's toRoom is the real check): { room: { say, things, people } } or { error } */
  function check(res) {
    var bad = { error: 'Blade’s answer did not fit the card: nothing changed' };
    if (!isObj(res)) return { error: 'Blade gave no answer: nothing changed' };
    if (res.room === null || res.room === undefined) return str(res.error) ? { error: str(res.error) } : bad;
    var r = res.room;
    if (!isObj(r) || typeof r.say !== 'string' || r.say.length > LIMITS.say || !Array.isArray(r.things) || r.things.length > LIMITS.bladeThings ||
      !Array.isArray(r.people) || r.people.length > LIMITS.bladePeople) return bad;
    if (r.things.some(function (t) { return !isObj(t) || typeof t.name !== 'string' || !t.name.trim(); })) return bad;
    if (r.people.some(function (p) { return !isObj(p) || typeof p.line !== 'string' || !p.line.trim() || p.line.length > LIMITS.person; })) return bad;
    return { room: { say: r.say, things: r.things, people: r.people.map(function (p) { return p.role ? { line: p.line, role: str(p.role) } : { line: p.line }; }) } };
  }

  /* ---------- the markup (pure) ---------- */
  function btn(label, rb, x) {
    var U = ui();
    if (!U || typeof U.button !== 'function') return '';
    return U.button({ label: label, rank: 'quiet', cls: ['rv-btn', 'sm', 'rr-bbtn'], data: { rb: rb, rbRoom: x.room }, busy: !!x.busy, disabled: !!x.disabled, title: x.title });
  }
  function changed(b) {
    var bits = [];
    if (b.say) bits.push('the read-aloud');
    b.things.forEach(function (n) { bits.push(n); });
    if (b.people.length) bits.push(b.people.length === 1 ? '1 person' : b.people.length + ' people');
    if (!bits.length) return 'nothing';
    return bits.length === 1 ? bits[0] : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
  }
  /* o: { kit, busy (this room's tap is running), any (a tap is running somewhere) }; '' for a room with no table */
  function blockHtml(c, o) {
    o = o || {};
    if (!isObj(c) || !c.table) return '';
    var b = isObj(c.blade) ? c.blade : null, room = str(c.roomKey), h = '';
    if (b) h += '<p class="rr-bmark"><b class="rr-bstar">' + esc(MARK) + '</b> fitted this room to tonight: ' + esc(changed(b)) + '.</p>';      /* body text, not a dim label: >= 12 px */
    var title = 'Blade fits this room for tonight: a read-aloud, up to two things and up to three people (about 3¢, never over 5¢)';
    h += '<p class="rr-bbar">' + btn(o.busy ? BUSY : LABEL, 'fit', { room: room, busy: o.busy, disabled: !!o.any, title: title }) +
      (b ? ' ' + btn('Clear', 'clear', { room: room, disabled: !!o.any, title: 'Take Blade’s changes off this room' }) : '') + '</p>';
    return '<div class="rr-blade" data-rr-blade="' + esc(room) + '">' + h + '</div>';
  }
  /* the Things list (RK09's markup) with a ✦ before each of Blade's own things: a mark beside the button, the button itself untouched */
  function starThings(html, c) {
    var h = str(html);
    list(isObj(c) ? c.things : null).forEach(function (t) {
      if (!t || !t.blade || !str(t.slug)) return;
      var at = h.indexOf('data-thing="' + esc(t.slug) + '"'), li = at < 0 ? -1 : h.lastIndexOf('<li class="rk-ti">', at);
      if (li < 0) return;
      li += '<li class="rk-ti">'.length;
      h = h.slice(0, li) + '<span class="rr-bstar" title="Blade’s" aria-label="Blade’s">✦</span> ' + h.slice(li);
    });
    return h;
  }
  /* Who's here with Blade's people in it: own is the list the card would draw (RK17's), or '' for the slot list, whose items come from slots(card)
     (the rolled cards' own markup, handed over by the hook: one place for it; none given, Blade's people stand alone) */
  function peopleHtml(c, own, kit, slots) {
    var bp = isObj(c) && isObj(c.blade) ? list(c.blade.people) : [];
    var mine = bp.map(function (p) {
      return '<li class="npc rr-bperson"' + (p.role ? ' data-role="' + esc(p.role) + '"' : '') + '><b>' + esc(MARK.charAt(0) + (p.role ? ' ' + cap(str(p.role).replace(/-+/g, ' ')) : '')) + '</b> ' + esc(p.line) + '</li>';
    }).join('');
    if (!mine) return str(own);
    if (str(own)) return str(own) + '<ul class="' + (kit ? 'rv-who rr-bppl krv-ppl' : 'rv-who rr-bppl') + '">' + mine + '</ul>';
    var items = ''; try { items = typeof slots === 'function' ? str(slots(c)) : ''; } catch (e) { items = ''; }
    return '<ul class="' + (kit ? 'rv-who rr-ppl krv-ppl' : 'rv-who rr-ppl') + '">' + items + mine + '</ul>';
  }

  /* ---------- the instance's hook ---------- */
  function hook(host, inner) {
    host = host || {};
    inner = inner || {};
    if (typeof inner.now !== 'function' || typeof inner.opts !== 'function' || typeof inner.click !== 'function') return null;
    var busy = '', viewer = null;
    function call(k, a) { try { return typeof host[k] === 'function' ? host[k](a) : null; } catch (e) { return null; } }
    function toast(t, bad) { if (typeof host.toast === 'function') { try { host.toast(t, bad); } catch (e) { /* a toast never breaks the tap */ } } }
    function writer() { var r = call('rs'); return r && typeof r.setBlade === 'function' && typeof r.read === 'function' ? r : null; }
    /* reads need no writer: the host's room-state instance, else a read-only view of its GM state (as RK14's cards read) */
    function reader() {
      var r = call('rs'); if (r && typeof r.read === 'function') return r;
      var M = live(mod('B68GmRoomState', './room-state.js')); if (!M || typeof M.create !== 'function' || typeof host.doc !== 'function') return null;
      if (!viewer) viewer = M.create({ on: function () { return false; }, doc: function () { return call('doc'); }, patch: function () { return false; },
        busy: function () { return false; }, now: function () { return Date.now(); }, part: function () { return ''; } });
      return viewer;
    }
    function now() {
      var m = inner.now(); if (!isObj(m) || !Array.isArray(m.cards)) return m;
      var rs = reader(), R = live(mod('B68GmRoomRoll', './room-roll.js')), there = R && typeof R.there === 'function' ? R.there : null;
      if (!rs) return m;
      var out = copy(m);
      out.cards = m.cards.map(function (c) {
        var st = null; try { st = rs.read(str(m.rollKey), c.roomKey); } catch (e) { st = null; }
        return c.table && st && isObj(st.blade) ? apply(c, st.blade, there) : c;
      });
      return out;
    }
    function opts(kit, m, inRunView) {
      var o = inner.opts(kit, m, inRunView), was = o.things, wp = o.people;
      o.things = function (c) { return blockHtml(c, { kit: kit, busy: !!busy && busy === str(c.roomKey), any: !!busy }) + starThings(typeof was === 'function' ? str(was(c)) : '', c); };
      o.people = function (c) { var own = typeof wp === 'function' ? str(wp(c)) : ''; return isObj(c.blade) && c.blade.people.length ? peopleHtml(c, own, kit, inner.slots) : own; };
      return o;
    }
    function gm() { var g = call('gm'); if (g) return g; return root && root.claude && root.claude.gm ? root.claude.gm : null; }
    function rrOf(rk, roomKey) { var rs = reader(), st = null; try { st = rs ? rs.read(rk, roomKey) : null; } catch (e) { st = null; } return st && typeof st.rr === 'number' ? st.rr : 0; }
    function cardOf(m, roomKey) { return isObj(m) ? list(m.cards).filter(function (c) { return c.roomKey === roomKey; })[0] || null : null; }
    function fit(roomKey) {
      if (busy) return false;
      var m = now(), c = cardOf(m, roomKey), g = gm();
      if (!c || !c.table) return false;
      if (!g || typeof g.assistRoom !== 'function') { toast('Blade can’t fit rooms on this page', true); return true; }
      if (!writer()) { toast('Blade’s answer could not be kept here: nothing was asked', true); return true; }
      var rk = str(m.rollKey), body = payload(call('roll'), c, call('tonight')), rr0 = rrOf(rk, roomKey);
      busy = roomKey; call('redraw');
      var sent; try { sent = g.assistRoom(body); } catch (e) { sent = Promise.reject(e); }
      Promise.resolve(sent).then(function (res) {
        busy = '';
        var v = check(res), w = writer();
        /* a late answer is dropped, never written: the cards were torn down (room.tables off, another page state), or the room was rerolled while Blade worked */
        if (typeof inner.live === 'function' && !inner.live()) return;
        if (rrOf(rk, roomKey) !== rr0) toast('Blade’s answer came after ' + c.name + ' was rerolled: dropped', true);
        else if (v.error) toast(v.error, true);
        else if (!w || !w.setBlade(rk, roomKey, v.room)) toast('Blade’s answer could not be kept: nothing changed', true);
        else toast(MARK + ' fitted ' + c.name + ' to tonight.');
        call('redraw');
      }, function (e) {
        busy = '';
        if (typeof inner.live === 'function' && !inner.live()) return;
        toast('Blade could not fit ' + c.name + ': ' + str(e && e.message || e || 'no answer'), true);
        call('redraw');
      });
      return true;
    }
    function clear(roomKey) {
      var m = now(), c = cardOf(m, roomKey), w = writer();
      if (!c || !c.blade || busy) return false;
      if (!w || !w.setBlade(str(m.rollKey), roomKey, null)) toast('Blade’s changes could not be taken off: nothing changed', true);
      call('redraw');
      return true;
    }
    function click(ev) {
      var t = ev && ev.target, b = t && t.closest ? t.closest('[data-rb][data-rb-room]') : null;
      if (b && b.closest('.rr-blade')) {
        ev.preventDefault(); ev.stopPropagation();
        if (b.disabled || b.getAttribute('aria-busy') === 'true') return;
        var room = str(b.getAttribute('data-rb-room')), what = b.getAttribute('data-rb');
        if (what === 'fit') fit(room); else if (what === 'clear') clear(room);
        return;
      }
      return inner.click(ev);
    }
    return { now: now, opts: opts, click: click, busy: function () { return busy; } };
  }

  return { hook: hook, apply: apply, payload: payload, check: check, blockHtml: blockHtml, starThings: starThings, peopleHtml: peopleHtml, LABEL: LABEL, MARK: MARK, BUSY: BUSY, LIMITS: LIMITS };
});
