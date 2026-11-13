/* gm/players-screen.js: the GM page's side of the players' screen, map first (IP2, behind the display setting stage.players). In the gm bundle.
   It only defines B68GmPlayersScreen when it loads; gm-page.js calls it only while the setting is on, so off nothing here runs.
   ES5, window.B68GmPlayersScreen in the browser, module.exports under Node.

   WHAT IT DOES (each from a one-line branch in gm-page.js):
     offerLine(o, offer, show)   Next landing on a public event: the 8-second line is NOT sent; the GM gets the actionable notice instead (the line and
                                 Send). Send shows it exactly as before; nothing shows if the GM does nothing. The notice stays through the publish
                                 that follows the beat (keep: true).
     apLine(el, on)              the iPad view's Autopilot row says why it sends nothing: "Map first: you send NPCs."
     scene(host, p)              a scene tile, Pin or Auto, Next scene, a cue's scene: the ambient write, then whatever covers the scene comes down
                                 (a blank push, as Roll the opening credits does), so the new scene plays at once. Re-picking the scene that is up
                                 does nothing. Lasting layers (a flashback, a montage, the hard start, the Aftermath) and an overlay stay: they are the
                                 GM's own and come down with Clear. A scene file the iPad cannot load is named in a toast (probe).
     openCard(host, id)          Show on iPad, Introduce and a held spotlight open that NPC's card on this page: the Run view's card beside the
                                 right column, and the cast list's card; never while the GM is typing in a field (it opens when the field is left).
     notesMd(npc)                with no vault card, the app's own GM notes as the card: Tell: and Signature: first.
   Pure: no network but probe (a HEAD of the scene file, as the theme probe does). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else if (root) root.B68GmPlayersScreen = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var AP_WHY = 'Map first: you send NPCs.';
  var PROBE_MS = 20000;      /* the iPad's own watchdog (display-page.js createAmbient T.watchdogMs) */
  /* the scene files, as the display names them (display-page.js Pure.AMBIENT_SCENES; players-screen.test.mjs checks the two agree) */
  var FILES = { harvest: 'second-harvest.html', watch: 'watch-feed.html', duskwall: 'duskwall-after-dark.html', boneyard: 'boneyard-dawn.html', undertow: 'undertow.html',
    vet: 'grunts-vet.html', tram: 'night-tram.html', lurker: 'lurker-press.html', cards: 'calling-cards.html', pells: 'pells-provisions.html', wanted: 'wanted-wall.html',
    meeting: 'planning-meeting.html', credits: 'opening-credits.html', veil: 'sunrise-ball-opening.html', board: 'planning-board.html', exploded: 'score-exploded.html',
    testcard: 'test-card.html' };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  /* ---- IP2.3 B: the public line waits for Send ---- */
  function offerLine(o, offer, show) {
    if (!isObj(o) || typeof offer !== 'function') return Promise.resolve(null);
    var t = str(o.text).trim(); if (!t) return Promise.resolve(null);
    offer({ text: 'Public line: “' + t + '”', label: 'Send', keep: true, run: function () { return typeof show === 'function' ? show(o) : null; } });
    return Promise.resolve(null);
  }

  /* ---- IP2.3 E: the Autopilot row says why ---- */
  function apLine(el, on) {
    if (!el || typeof el.querySelector !== 'function') return;
    var w = el.querySelector('[data-p2-why]');
    if (on && !w) { var d = el.ownerDocument; w = d.createElement('span'); w.className = 'gm-dim'; w.setAttribute('data-p2-why', ''); w.textContent = ' ' + AP_WHY; el.appendChild(w); }
    else if (!on && w) w.parentNode.removeChild(w);
  }

  /* ---- IP2.4: a new scene just plays ---- */
  /* what the patch asks for: { pin: id } | { mode: 'auto' | 'off' } | { skip: true } | null (anything else: not a scene change) */
  function intent(p) {
    if (!isObj(p)) return null;
    if (p.skip === true) return { skip: true };
    if (p.mode === 'pin' && typeof p.scene === 'string') return { pin: p.scene };
    if (p.mode === 'auto' || p.mode === 'off') return { mode: p.mode };
    return null;
  }
  /* the scene already playing, unchanged by this pick: the shown display is blank and the pin names the scene pinned now */
  function same(it, cur, shownKind) {
    return !!it && !!it.pin && isObj(cur) && cur.mode === 'pin' && cur.scene === it.pin && shownKind === 'blank';
  }
  /* host = { patch(p) -> Promise<r | null>, shown() -> the display kind up ('' unknown), current() -> { mode, scene } of the ambient doc, blank() -> Promise,
             label(id) -> name, toast(m, bad), fetch(url, init) (optional) } */
  function scene(host, p) {
    var it = intent(p);
    var kind = str(host.shown());
    if (same(it, host.current(), kind)) return Promise.resolve(true);     /* re-picking the scene that is up: nothing */
    return Promise.resolve(host.patch(p)).then(function (r) {
      if (r === null || r === undefined || !it) return r;
      var cur = host.current() || {}, id = it.pin || (cur.mode === 'pin' ? cur.scene : '');
      var off = it.mode === 'off';
      /* the ambient plays only under a blank: the stage comes down, also when this page does not know what is up (Off leaves the stage alone) */
      var down = !off && kind !== 'blank' ? Promise.resolve().then(function () { return host.blank(); }).then(null, function () { return null; }) : Promise.resolve(null);
      return down.then(function () { if (id) probe(host, id); return r; });
    });
  }
  /* a HEAD of the scene file, like the theme probe: a scene the iPad cannot load is named, not silently skipped */
  function probe(host, id) {
    var f = FILES[id], fetch = host.fetch || (W && W.fetch);
    if (!f || typeof fetch !== 'function') return Promise.resolve(null);
    var url = 'ambient/' + f.replace(/\.html$/, ''), done = false;
    var say = function (why) { if (done) return; done = true; if (typeof host.toast === 'function') host.toast('The iPad could not load the scene ' + (str(host.label(id)) || id) + ' (' + why + '): it plays the next one. Pick another.', true); };
    var t = setTimeout(function () { say('no answer'); }, PROBE_MS);
    return Promise.resolve().then(function () { return fetch(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' }); }).then(function (r) {
      clearTimeout(t); if (done) return false;
      if (!r || !r.ok) { say(r ? 'HTTP ' + r.status : 'no answer'); return false; }
      done = true; return true;
    }, function () { clearTimeout(t); say('no answer'); return false; });
  }

  /* ---- IP2.5: the NPC's card opens on the GM page ---- */
  function typing(doc) {
    var a = doc && doc.activeElement; if (!a || !a.tagName) return false;
    var t = String(a.tagName).toUpperCase();
    if (t === 'TEXTAREA' || a.isContentEditable) return true;
    if (t !== 'INPUT') return false;
    var ty = String(a.type || 'text').toLowerCase();
    return ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].indexOf(ty) < 0;
  }
  /* host = { doc, npc(id) -> the cast doc, rv() -> the Run view (showNpc) or null, cast(id) (the cast list's card open, redrawn) } */
  function openCard(host, id) {
    var d = host.npc(id); if (!isObj(d)) return false;
    var names = [str(d.name)].concat(Array.isArray(d.alias) ? d.alias.map(str) : typeof d.alias === 'string' ? [d.alias] : []).filter(Boolean);
    if (!names.length) return false;
    var go = function () {
      var rv = host.rv();
      if (rv && typeof rv.showNpc === 'function') rv.showNpc(names, names[0]);
      if (typeof host.cast === 'function') host.cast(id);
    };
    var doc = host.doc;
    if (typing(doc)) {      /* the GM is typing: the card waits until the field is left */
      var a = doc.activeElement, once = function () { a.removeEventListener('blur', once); setTimeout(go, 0); };
      a.addEventListener('blur', once);
      return 'later';
    }
    go();
    return true;
  }
  /* the app's own GM notes as the card (Markdown for the Prep card renderer): Tell: and Signature: first, then the rest */
  function notesMd(d) {
    if (!isObj(d)) return '';
    var lines = str(d.gmNotes).split(/\r?\n/), first = [], rest = [];
    lines.forEach(function (l) { if (/^\s*(tell|signature)\s*:/i.test(l)) first.push(l.trim()); else rest.push(l); });
    var head = [str(d.role), str(d.faction)].filter(Boolean).join(' · ');
    var body = first.map(function (l) { var m = l.match(/^(\w+)\s*:\s*(.*)$/); return m ? '**' + m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ':** ' + m[2] : l; }).join('\n\n');
    var more = rest.map(function (l) { return l.trim(); }).filter(Boolean).join('\n\n');      /* each line of the notes is a paragraph of the card */
    var out = (head ? '*' + head + '*\n\n' : '') + body + (body && more ? '\n\n' : '') + more;
    return out.trim() ? out.trim() + '\n\n*No vault card: the cast notes.*' : '';
  }

  return { VERSION: 1, AP_WHY: AP_WHY, FILES: FILES, offerLine: offerLine, apLine: apLine, scene: scene, probe: probe, openCard: openCard, notesMd: notesMd,
    _pure: { intent: intent, same: same, typing: typing } };
});
