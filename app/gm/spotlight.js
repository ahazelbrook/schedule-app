/* gm/spotlight.js — the people in a room, and the held spotlight (suite 3.1; the GM night rebuild, N3: the site).

   Plain script, UMD: window.B68GmSpotlight in the browser, module.exports under Node. GM side only; create(host) reaches the page only through its host.

   WHO'S HERE. A room's card on the site lists its people, each a row: the play's people the night places there at the time shown, then the names on the room's
   "Who:" line in the prep note (whoNames), then anyone the GM added to that room on this page. Names are matched to the cast by name or alias (an ambiguous or
   unknown name is left out). The rows are page-local; nothing about them reaches the iPad or a phone. (They replace the old stage bar box.)
   SPOTLIGHT. One tap holds that person's portrait on the iPad: the `npc` overlay, laid for the longest time the server allows and laid again before it runs out, so
   it stays still. "Take it down" clears it (only while the overlay up is still this one). "Blade, spotlight <name>" does the same by voice (holdByName: the people of
   the room in focus first, then the whole cast). A HIDDEN person asks "Reveal and show?" first; a no leaves them hidden and shows nothing. The server drops a hidden
   person's overlay anyway.
   THE FACE LOOKS (suite 3.2, 3.3): while someone is held, their row offers the expressions and the signature pose (gm/face-looks.js); only NAMES are sent.

   API
     MAX whoNames(md) -> [name]      matchNpcs(names, npcs) -> [npc]      (npc = { id, name, alias?, role?, revealed })
     peopleFor({ here, md, npcs, extra }) -> [row]       here: [{ label, kind, npc, moving }] the play's people in the room now; extra: [npc id]
       row = { id (the cast id, '' for a play person the cast lacks), name, alias, role, kind, revealed, here, moving, added }
     rowsHtml(rows, view, opts, esc) -> HTML the rows and the Add field; opts: { room, face(row) -> html | '', card(row) -> bool, introduce: bool }
     create(host) -> controller
       host: { feature(id) -> bool, npcs() -> [npc], roomMd(room) -> Markdown, here(room) -> [play person], focusRoom() -> room name,
               hold(npcId, ms, look?) -> Promise<answer | null>, clear() -> Promise, overlayId() -> the id of the overlay up now, confirm(msg) -> bool,
               reveal(npcId) -> Promise, notes(npcId) -> the person's GM notes (the face looks read Tell, Signature and Relation), toast, changed(),
               setTimeout, clearTimeout }
       controller: people(room) add(room, name) remove(room, id) spotlight(id) narrator() holdByName(name) held() view() reset() express(name) signature()
   Every action is a data-site button (spot, intro, card, expr, sig, down, who-x) or the form data-site="who-add"; the page routes them. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSpotlight = M;
})(typeof self !== 'undefined' ? self : this, function (root_) {
  'use strict';

  function req(name, path) { if (root_ && root_[name]) return root_[name]; try { return require(path); } catch (e) { return null; } }
  var MAX = 3, SWITCH = 'face.spotlight', HOLD_MS = 180000, REFRESH_MS = 170000;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function fold(s) { return str(s).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim(); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plain(s) {
    return str(s).replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/!?\[\[([^\]]*)\]\]/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~=]+/g, '').replace(/\s+/g, ' ').trim();
  }

  /* the names on the room's "Who" line: "- **Who:** Mabel Quist, Dov and the porter", a bullet or a plain line, outside code fences */
  function whoNames(md) {
    var fence = null, lines = str(md).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
      if (f) { if (!fence) fence = f[1].charAt(0); else if (f[1].charAt(0) === fence) fence = null; continue; }
      if (fence) continue;
      var m = /^\s*(?:>\s*)*(?:[-*+]\s+)?(?:\*\*|__)?who(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i.exec(l);
      if (!m) continue;
      var parts = plain(m[1]).split(/\s*(?:,|;|\band\b|&|·|\|)\s*/i).map(function (p) { return p.replace(/^(?:the|our)\s+/i, '').replace(/[.]+$/, '').trim(); }).filter(Boolean);
      return parts.slice(0, 12);
    }
    return [];
  }
  /* each name that is exactly one cast member's name or alias, once, in order; an ambiguous or unknown name is left out */
  function matchNpcs(names, npcs) {
    var out = [], list = Array.isArray(npcs) ? npcs.filter(isObj) : [];
    (Array.isArray(names) ? names : []).forEach(function (nm) {
      var f = fold(nm); if (!f) return;
      var hit = list.filter(function (n) { return fold(n.name) === f || fold(n.alias) === f; });
      if (hit.length === 1 && !out.some(function (o) { return o.id === hit[0].id; })) out.push(hit[0]);
    });
    return out;
  }
  function castRow(n, extra) {
    return Object.assign({ id: str(n.id), name: str(n.name), alias: str(n.alias), role: str(n.role), kind: '', revealed: n.revealed === true, here: false, moving: null, added: false }, extra || {});
  }
  /* the room's people: the play's people placed here now, then the Who line, then the GM's own additions; one row a person */
  function peopleFor(src) {
    src = isObj(src) ? src : {};
    var npcs = Array.isArray(src.npcs) ? src.npcs.filter(isObj) : [], out = [], seen = {};
    function has(r) { var k = r.id ? 'n:' + r.id : 'p:' + fold(r.name); if (seen[k]) return true; seen[k] = 1; return false; }
    (Array.isArray(src.here) ? src.here : []).forEach(function (p) {
      if (!isObj(p)) return;
      var hit = matchNpcs([p.npc], npcs)[0] || matchNpcs([p.label], npcs)[0] || null;
      var mv = isObj(p.moving) ? { to: str(p.moving.to), inMin: p.moving.inMin } : null;
      var r = hit ? castRow(hit, { kind: str(p.kind), here: true, moving: mv }) : { id: '', name: str(p.label) || str(p.npc), alias: '', role: '', kind: str(p.kind), revealed: false, here: true, moving: mv, added: false };
      if (r.name && !has(r)) out.push(r);
    });
    matchNpcs(whoNames(src.md), npcs).forEach(function (n) { var r = castRow(n); if (!has(r)) out.push(r); });
    (Array.isArray(src.extra) ? src.extra : []).forEach(function (id) { var n = npcs.filter(function (x) { return str(x.id) === id; })[0]; if (n) { var r = castRow(n, { added: true }); if (!has(r)) out.push(r); } });
    return out;
  }
  function initials(name) { var o = ''; str(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).forEach(function (w) { o += Array.from(w)[0].toUpperCase(); }); return o || '?'; }

  function rowsHtml(rows, v, o, esc) {
    esc = esc || esc0; o = o || {}; v = v || {};
    var FL = req('B68GmFaceLooks', './face-looks.js'), room = str(o.room);
    var h = '<ul class="rv-ppl">' + (rows.length ? rows.map(function (r) {
      var held = !!r.id && v.held === r.id, face = typeof o.face === 'function' ? str(o.face(r)) : '';
      var role = [r.kind, r.role].filter(Boolean).join(' · ');
      var acts = '';
      if (r.id) {
        acts += '<button type="button" class="rv-btn sm rv-spot' + (held ? ' on' : '') + '" data-site="spot" data-id="' + esc(r.id) + '" aria-pressed="' + held + '" title="' +
          (held ? 'Held on the iPad: Take it down below' : r.revealed ? 'Hold their portrait on the iPad' : 'Hidden from the players: asks Reveal and show? first') + '">' + (held ? '● On the iPad' : 'Spotlight') + '</button>';
        if (o.introduce !== false) acts += '<button type="button" class="rv-btn sm" data-site="intro" data-id="' + esc(r.id) + '"' + (r.revealed ? ' title="Flip their card up as a lower third on the iPad"' : ' disabled title="Hidden from the players: reveal them first (Spotlight asks)"') + '>Introduce</button>';
      }
      if (typeof o.card === 'function' && o.card(r)) acts += '<button type="button" class="rv-btn sm" data-site="card" data-name="' + esc(r.name) + '"' + (r.alias ? ' data-alias="' + esc(r.alias) + '"' : '') + ' title="Their card, here on this screen">Card</button>';
      if (r.added) acts += '<button type="button" class="rv-btn sm rv-px" data-site="who-x" data-id="' + esc(r.id) + '" data-room="' + esc(room) + '" aria-label="Take ' + esc(r.name) + ' off this room">×</button>';
      var looks = '';
      if (held) {
        if (FL && v.faces) looks += FL.html(v.faces, esc);
        looks += '<button type="button" class="rv-btn sm rv-down" data-site="down" title="Their portrait comes off the iPad">Take it down</button>';
      }
      return '<li class="rv-p' + (held ? ' held' : '') + (r.id && !r.revealed ? ' hidden' : '') + (r.id ? '' : ' nocast') + '" data-pid="' + esc(r.id) + '">' +
        '<span class="rv-face" aria-hidden="true">' + (face || '<span class="rv-ini">' + esc(initials(r.name)) + '</span>') + '</span>' +
        '<span class="rv-pn"><b>' + esc(r.name) + '</b>' + (r.id && !r.revealed ? ' <small class="rv-hid">hidden</small>' : '') +
        (role ? '<span class="rv-prole">' + esc(role) + '</span>' : '') +
        (r.moving ? '<span class="rv-pmove">→ ' + esc(r.moving.to) + ' in ' + esc(r.moving.inMin) + ' min</span>' : '') + '</span>' +
        (acts ? '<span class="rv-pacts">' + acts + '</span>' : '') + (looks ? '<div class="rv-plooks">' + looks + '</div>' : '') + '</li>';
    }).join('') : '<li class="rv-dim rv-pnone">Nobody here.</li>') + '</ul>';
    if (room && o.add !== false) h += '<form class="rv-padd" data-site="who-add" data-room="' + esc(room) + '"><input type="text" name="who" autocomplete="off" spellcheck="false" placeholder="Add someone from the cast" aria-label="Add someone from the cast to ' + esc(room) + '"><button type="submit" class="rv-btn sm">Add</button></form>';
    return h;
  }

  function create(host) {
    host = host || {};
    var extra = {}, heldId = '', timer = null, heldLook = null, FLk = req('B68GmFaceLooks', './face-looks.js'), looks = FLk ? FLk.create(host) : null;
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    function npcs() { return typeof host.npcs === 'function' ? host.npcs() : []; }
    function byId(id) { return npcs().filter(function (n) { return n.id === id; })[0] || null; }
    function setT(fn, ms) { return typeof host.setTimeout === 'function' ? host.setTimeout(fn, ms) : setTimeout(fn, ms); }
    function clrT(h) { if (h == null) return; if (typeof host.clearTimeout === 'function') host.clearTimeout(h); else clearTimeout(h); }

    function people(room) {
      var r = str(room); if (!r) return [];
      return peopleFor({ here: typeof host.here === 'function' ? host.here(r) : [], md: typeof host.roomMd === 'function' ? host.roomMd(r) : '', npcs: npcs(), extra: extra[r] || [] });
    }
    function add(room, name) {
      var r = str(room); if (!on() || !r) return false;
      var got = matchNpcs([name], npcs());
      if (!got.length) { say('No one in the cast is called that, or more than one is.', true); return false; }
      if (people(r).some(function (p) { return p.id === got[0].id; })) return true;
      var l = extra[r] = extra[r] || [];
      if (l.length >= MAX) { say('A room takes three more people at most: take someone off first.', true); return false; }
      l.push(got[0].id); changed(); return true;
    }
    function remove(room, id) { var l = extra[str(room)] || [], i = l.indexOf(id); if (i < 0) return false; l.splice(i, 1); changed(); return true; }
    function extras(room) { return (extra[str(room)] || []).slice(); }

    function lay(id, look) { return Promise.resolve(look ? host.hold(id, HOLD_MS, look) : host.hold(id, HOLD_MS)); }
    function again(id) {
      clrT(timer);
      timer = setT(function () {
        timer = null;
        if (heldId !== id || !on()) return;
        /* only while the overlay up is still ours (a held spotlight's id starts b17sl-) */
        var up = typeof host.overlayId === 'function' ? host.overlayId() : '';
        if (up && up.indexOf('b17sl-') !== 0) { heldId = ''; changed(); return; }
        lay(id, looks ? looks.relay(heldLook) : null).then(function (r) { if (r === null || r === undefined) { heldId = ''; heldLook = null; changed(); } else again(id); });
      }, REFRESH_MS);
    }
    /* hold one person on the iPad -> Promise<{ ok, name, say }> */
    function spotlight(id) {
      if (!on()) return Promise.resolve({ ok: false, say: '' });
      var n = byId(id); if (!n) return Promise.resolve({ ok: false, say: 'That person is not in the cast.' });
      var pre = Promise.resolve(true);
      if (n.revealed !== true) {
        if (typeof host.confirm === 'function' && !host.confirm('Reveal and show? ' + n.name + ' is hidden from the players. This reveals them to everyone and holds them on the iPad.')) return Promise.resolve({ ok: false, say: '' });
        pre = Promise.resolve(host.reveal(id)).then(function () { return true; }, function () { return false; });
      }
      return pre.then(function (ok) {
        if (!ok) { say('Could not reveal ' + n.name + '.', true); return { ok: false, say: '' }; }
        var look = looks ? looks.initial(id) : null;
        return lay(id, look).then(function (r) {
          if (r === null || r === undefined) return { ok: false, say: '' };
          heldId = id; heldLook = look; again(id); changed();
          return { ok: true, name: n.name, say: n.name + ' is held on the iPad.' };
        });
      });
    }
    /* Take it down (the old Narrator) */
    function narrator() {
      if (!on()) return Promise.resolve(false);
      clrT(timer); timer = null;
      var had = heldId; heldId = ''; heldLook = null; changed();
      if (!had) return Promise.resolve(false);
      return Promise.resolve(host.clear()).then(function () { return true; }, function () { return false; });
    }
    /* "Blade, spotlight <name>": the people of the room in focus first, then the whole cast; two of the same name are not guessed */
    function holdByName(name) {
      if (!on()) return null;
      var f = fold(name), room = typeof host.focusRoom === 'function' ? str(host.focusRoom()) : '';
      var inRoom = people(room).filter(function (p) { return p.id && (fold(p.name) === f || fold(p.alias) === f); });
      var got = inRoom.length === 1 ? [byId(inRoom[0].id)].filter(Boolean) : matchNpcs([name], npcs());
      if (got.length !== 1) return Promise.resolve({ ok: false, say: 'Which ' + name + '? Not found, or more than one.' });
      return spotlight(got[0].id);
    }
    function held() { return heldId; }
    function view() { var fv = looks && heldId ? looks.view(heldId) : null; if (fv) fv.cur = heldLook && heldLook.expr ? heldLook.expr : ''; return { on: on(), held: heldId, faces: fv }; }
    function reset() { extra = {}; heldId = ''; heldLook = null; clrT(timer); timer = null; }
    /* the held person's expression (neutral, pleased, hostile, afraid, or their tell) and signature pose: laid again as a new overlay, so the iPad shows it afresh */
    function express(name) {
      if (!on() || !heldId || !looks) return Promise.resolve(false);
      var r = looks.express(heldLook, heldId, name);
      if (!r.look) { if (r.say) say(r.say, true); return Promise.resolve(false); }
      var id = heldId;
      /* a change of face on the person already held is not a new spotlight: `re` tells the iPad not to play the motif again (heldLook keeps no `re`, so the signature that follows still plays its pose) */
      return lay(id, Object.assign({}, r.look, { re: true })).then(function (a) { if (a === null || a === undefined || heldId !== id) return false; heldLook = r.look; again(id); changed(); return true; });
    }
    function signature() {
      if (!on() || !heldId || !looks) return Promise.resolve(false);
      var r = looks.signature(heldLook, heldId);
      if (!r.look) { if (r.say) say(r.say, true); return Promise.resolve(false); }
      var id = heldId;
      return lay(id, r.look).then(function (a) { if (a === null || a === undefined || heldId !== id) return false; again(id); return true; });     /* the pose is in this overlay only: the next renewal drops it */
    }
    function expression() { return heldLook && heldLook.expr ? heldLook.expr : ''; }
    return { people: people, add: add, remove: remove, extras: extras, spotlight: spotlight, narrator: narrator, holdByName: holdByName, held: held, view: view, reset: reset, express: express, signature: signature, expression: expression, HOLD_MS: HOLD_MS };
  }

  return { SWITCH: SWITCH, MAX: MAX, HOLD_MS: HOLD_MS, REFRESH_MS: REFRESH_MS, whoNames: whoNames, matchNpcs: matchNpcs, peopleFor: peopleFor, rowsHtml: rowsHtml, initials: initials, create: create };
});
