/* gm/spotlight.js — the stage bar and the held spotlight (suite 3.1, switch face.spotlight).

   Plain script, UMD: window.B68GmSpotlight in the browser, module.exports under Node. GM side only; create(host) reaches the page only through its host.

   THE STAGE BAR. Up to three NPCs held ready for this room, on the GM screen. They are taken from the room's "Who:" line in the prep note (whoNames), matched to the
   cast by name or alias, and editable: add one by name, take one off. The bar is page-local; nothing about it reaches the iPad or a phone.
   SPOTLIGHT. One tap holds that NPC's portrait on the iPad: the `npc` overlay, laid for the longest time the server allows and laid again before it runs out, so it
   stays still. "Narrator" clears it (only while the overlay up is still this one). "Blade, spotlight <name>" does the same by voice (holdByName).
   A HIDDEN NPC asks "Reveal and show?" first; a no leaves them hidden and shows nothing. The server drops a hidden NPC's overlay anyway.

   API
     MAX whoNames(md) -> [name]      matchNpcs(names, npcs) -> [npc]      (npc = { id, name, alias?, revealed })
     create(host) -> controller
       host: { feature(id) -> bool, npcs() -> [npc], roomKey() -> string, roomMd() -> Markdown of the room the crew are in | '', hold(npcId, ms) -> Promise<answer | null>,
               clear() -> Promise, overlayId() -> the id of the overlay up now, confirm(msg) -> bool, reveal(npcId) -> Promise, toast, changed(),
               setTimeout, clearTimeout }
       controller: seed() bar() add(name) remove(id) spotlight(id) narrator() holdByName(name) held() view() reset() */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSpotlight = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX = 3, SWITCH = 'face.spotlight', HOLD_MS = 180000, REFRESH_MS = 170000;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function fold(s) { return str(s).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim(); }
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

  function create(host) {
    host = host || {};
    var ids = [], seededFor = null, heldId = '', timer = null;
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    function npcs() { return typeof host.npcs === 'function' ? host.npcs() : []; }
    function byId(id) { return npcs().filter(function (n) { return n.id === id; })[0] || null; }
    function setT(fn, ms) { return typeof host.setTimeout === 'function' ? host.setTimeout(fn, ms) : setTimeout(fn, ms); }
    function clrT(h) { if (h == null) return; if (typeof host.clearTimeout === 'function') host.clearTimeout(h); else clearTimeout(h); }

    /* fill the bar from the room's Who line when the room changes (and only then, so the GM's edits stay) */
    function seed() {
      if (!on()) return;
      var key = typeof host.roomKey === 'function' ? str(host.roomKey()) : '';
      if (key === seededFor) return;
      seededFor = key;
      ids = matchNpcs(whoNames(typeof host.roomMd === 'function' ? host.roomMd() : ''), npcs()).slice(0, MAX).map(function (n) { return n.id; });
      changed();
    }
    function bar() { return ids.map(byId).filter(Boolean); }
    function add(name) {
      if (!on()) return false;
      var got = matchNpcs([name], npcs());
      if (!got.length) { say('No one in the cast is called that, or more than one is.', true); return false; }
      if (ids.indexOf(got[0].id) >= 0) return true;
      if (ids.length >= MAX) { say('The stage bar holds three: take someone off first.', true); return false; }
      ids.push(got[0].id); changed(); return true;
    }
    function remove(id) { var i = ids.indexOf(id); if (i < 0) return false; ids.splice(i, 1); changed(); return true; }

    function lay(id) { return Promise.resolve(host.hold(id, HOLD_MS)); }
    function again(id) {
      clrT(timer);
      timer = setT(function () {
        timer = null;
        if (heldId !== id || !on()) return;
        /* only while the overlay up is still ours (a held spotlight's id starts b17sl-) */
        var up = typeof host.overlayId === 'function' ? host.overlayId() : '';
        if (up && up.indexOf('b17sl-') !== 0) { heldId = ''; changed(); return; }
        lay(id).then(function (r) { if (r === null || r === undefined) { heldId = ''; changed(); } else again(id); });
      }, REFRESH_MS);
    }
    /* hold one NPC on the iPad -> Promise<{ ok, name, say }> */
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
        return lay(id).then(function (r) {
          if (r === null || r === undefined) return { ok: false, say: '' };
          heldId = id; again(id); changed();
          return { ok: true, name: n.name, say: n.name + ' is held on the iPad.' };
        });
      });
    }
    function narrator() {
      if (!on()) return Promise.resolve(false);
      clrT(timer); timer = null;
      var had = heldId; heldId = ''; changed();
      if (!had) return Promise.resolve(false);
      return Promise.resolve(host.clear()).then(function () { return true; }, function () { return false; });
    }
    /* "Blade, spotlight <name>": the bar first, then the whole cast; two of the same name are not guessed */
    function holdByName(name) {
      if (!on()) return null;
      var f = fold(name), inBar = bar().filter(function (n) { return fold(n.name) === f || fold(n.alias) === f; });
      var got = inBar.length === 1 ? inBar : matchNpcs([name], npcs());
      if (got.length !== 1) return Promise.resolve({ ok: false, say: 'Which ' + name + '? Not found, or more than one.' });
      return spotlight(got[0].id);
    }
    function held() { return heldId; }
    function view() { return { on: on(), bar: bar(), held: heldId, full: ids.length >= MAX }; }
    function reset() { ids = []; seededFor = null; heldId = ''; clrT(timer); timer = null; }
    return { seed: seed, bar: bar, add: add, remove: remove, spotlight: spotlight, narrator: narrator, holdByName: holdByName, held: held, view: view, reset: reset, HOLD_MS: HOLD_MS };
  }

  function html(v, esc) {
    esc = esc || function (s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    if (!v || !v.on) return '';
    var h = '<div class="gm-bar-h"><span class="gm-lab">Stage bar</span> <span class="gm-dim">up to three, from this room’s Who line</span></div><ul class="gm-bar-list">';
    h += v.bar.map(function (n) {
      var held = v.held === n.id;
      return '<li><button type="button" class="btn sm' + (held ? ' primary' : '') + '" data-b17="spot" data-id="' + esc(n.id) + '" aria-pressed="' + held + '">' + esc(n.name) + (n.revealed ? '' : ' (hidden)') + '</button> ' +
        '<button type="button" class="btn sm" data-b17="bar-x" data-id="' + esc(n.id) + '" aria-label="Take ' + esc(n.name) + ' off the bar">×</button></li>';
    }).join('');
    h += '</ul>';
    if (!v.full) h += '<form class="gm-bar-add" data-b17="bar-add"><input type="text" name="who" autocomplete="off" spellcheck="false" placeholder="Add a name" ' +
      'aria-label="Add someone to the stage bar"> <button type="submit" class="btn sm">Add</button></form>';
    h += '<div class="gm-stage-acts"><button type="button" class="btn sm" data-b17="narrator"' + (v.held ? '' : ' disabled') + '>Narrator</button></div>';
    return h;
  }

  return { SWITCH: SWITCH, MAX: MAX, HOLD_MS: HOLD_MS, REFRESH_MS: REFRESH_MS, whoNames: whoNames, matchNpcs: matchNpcs, create: create, html: html };
});
