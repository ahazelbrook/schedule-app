/* gm/settings.js — Menu > Settings: the four choices left once the Switchboard went (the night rebuild, N0).

   Everything built is on (app/features.js). What is left are modes, not features, each a two-way choice with the current value shown:
     Scenes              moving / held still          fx.off       a display setting: the iPad reads it on its next poll
     Music               scene themes / heat music    room.music   a display setting
     Phones              sheet only / mission cards   phoneCards   a phone setting; the page republishes the mission at once (its own setPhoneCards)
     Mirror for phones   off / on                     the GM state's `mirror` (not a registry line: the server reads it beside Live sync)
   A temporary home in the Menu: a later ticket moves these into the iPad view.

   Window.B68GmSettings, and module.exports under Node. gm-page.js makes one per page session with create(host) and calls heal() on every campaign arrival.

   Where the values live (app/features.js says it too)
     the GM state document   features: { <id>: bool } (and phoneCards' old top-level key)   the source of truth; written with the registry's patchFor
     the campaign document   features: { <id>: bool }   the display and phone settings, copied here by syncPublic() when the copy differs. A phone or the iPad
                             reads it through the Worker, which serves every other display and phone feature as ON whatever is stored.

   create(host) -> the controller. host:
     doc()               the GM state document (live)           patch(p, opts) -> bool   the page's patch (a change to the state document)
     campaign()          the campaign document as last arrived, or null
     publish(map)        -> Promise: write the campaign document's `features` (the page api's publishFeatures)
     root()              the #gm-root element                    toast(msg, bad)        redraw()   after a change, so what shows follows
     setPhoneCards(on)   -> bool: the page's own write (the setting, a flush, the mission republished, a toast); without it set('phoneCards', on)
     mirrorOn() -> bool  toggleMirror()   the page's own mirror toggle (the GM state's `mirror`)
     F, Sheet            the registry and the sheet builder (default window.B68Features, window.B68GmWorkshop)
   controller
     on(id) -> bool                  a setting's value (valueOf)
     set(id, on) -> bool             write a setting (the GM state, then the campaign copy), redraw; false for an id that is not a setting
     rows() -> [{ key, label, what, value, options: [{ v, label }] }]       choose(key, v) -> bool   a row's choice (nothing happens when it is the value already)
     syncPublic() / heal()           copy the settings into the campaign document when its copy differs: a copy just sent is not sent again for 4 s,
                                     and the same copy at most three times (a page newer than the Worker)
     render(box)  open()  close()  toggle()  isOpen()  sync()   sync(): redraw the open sheet when a value moved (another device's change) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSettings = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var RESEND_MS = 4000, RESEND_MAX = 3;
  var ROWS = [
    { key: 'fx.off', label: 'Scenes', what: 'The ambient scenes on the iPad: moving, or held as stills to save the battery and the heat.',
      options: [{ v: false, label: 'Moving' }, { v: true, label: 'Held still' }],
      said: { 'false': 'Scenes: moving. The iPad follows within a few seconds.', 'true': 'Scenes: held still. The iPad follows within a few seconds.' } },
    { key: 'room.music', label: 'Music', what: 'What the iPad plays: each scene’s own theme, or music that follows the security level and the heat.',
      options: [{ v: false, label: 'Scene themes' }, { v: true, label: 'Heat music' }],
      said: { 'false': 'Music: scene themes. The iPad follows within a few seconds.', 'true': 'Music: heat music. The iPad follows within a few seconds.' } },
    { key: 'phoneCards', label: 'Phones', what: 'While a night runs: the character sheet only, or a mission card and a Move row as well.',
      options: [{ v: false, label: 'Sheet only' }, { v: true, label: 'Mission cards' }] },
    { key: 'mirror', label: 'Mirror for phones', what: 'While on, a map or a handout on the iPad also shows on the players’ phones (their Table button). Nothing else ever does.',
      options: [{ v: false, label: 'Off' }, { v: true, label: 'On' }] }
  ];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function create(host) {
    var F = host.F || (W && W.B68Features) || null;
    var Sheet = host.Sheet || (W && W.B68GmWorkshop) || null;
    var sent = { key: '', at: 0, n: 0 }, drawn = '';
    var ctl = {};
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function doc() { return F ? host.doc() : {}; }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }

    ctl.on = function (id) { return !!F && F.isSetting(id) && F.valueOf(doc(), id); };
    function mirrorOn() { return typeof host.mirrorOn === 'function' ? host.mirrorOn() === true : !(isObj(doc()) && doc().mirror === false); }
    function valueOf(key) { return key === 'mirror' ? mirrorOn() : ctl.on(key); }

    ctl.syncPublic = function () {
      if (!F || typeof host.publish !== 'function') return false;
      var camp = typeof host.campaign === 'function' ? host.campaign() : null;
      if (!isObj(camp)) return false;                            /* the campaign has not arrived: nothing to compare with yet */
      var want = F.publishMap(doc(), camp.features);
      if (F.sameSettings(want, camp.features)) return false;
      var key = JSON.stringify(want), t = now();
      if (sent.key === key && (t - sent.at < RESEND_MS || sent.n >= RESEND_MAX)) return false;
      sent = { key: key, at: t, n: sent.key === key ? sent.n + 1 : 1 };
      Promise.resolve().then(function () { return host.publish(want); }).catch(function (e) {
        sent = { key: '', at: 0, n: 0 };
        say('Could not copy the settings to the players’ screens: ' + (e && e.message || e), true);
      });
      return true;
    };
    ctl.heal = function () { try { return ctl.syncPublic(); } catch (e) { return false; } };

    function changed() {
      ctl.syncPublic();
      if (typeof host.redraw === 'function') host.redraw();
      ctl.sync(true);
    }
    ctl.set = function (id, on) {
      if (!F || !F.isSetting(id)) return false;
      if (!host.patch(F.patchFor(doc(), id, on === true), { force: true })) return false;
      changed();
      return true;
    };

    ctl.rows = function () {
      return ROWS.map(function (r) { return { key: r.key, label: r.label, what: r.what, value: valueOf(r.key), options: r.options.map(function (o) { return { v: o.v, label: o.label }; }) }; });
    };
    ctl.choose = function (key, v) {
      var row = ROWS.filter(function (r) { return r.key === key; })[0]; if (!row) return false;
      var want = v === true;
      if (valueOf(key) === want) return false;
      var ok;
      if (key === 'mirror') { if (typeof host.toggleMirror !== 'function') return false; host.toggleMirror(); ok = mirrorOn() === want; }
      else if (key === 'phoneCards' && typeof host.setPhoneCards === 'function') ok = host.setPhoneCards(want) !== false;
      else { ok = ctl.set(key, want); if (ok && row.said) say(row.said[String(want)]); }
      ctl.sync(true);
      return !!ok;
    };

    function html() {
      return '<p class="gm-dim">Everything built is on. These four are choices for the night; each one changes at once, with no reload.</p>' +
        ctl.rows().map(function (r) {
          return '<div class="gm-set-row" data-set-row="' + esc(r.key) + '"><span class="gm-lab" id="gm-set-l-' + esc(r.key.replace(/\W/g, '-')) + '">' + esc(r.label) + '</span>' +
            '<div class="seg" role="group" aria-labelledby="gm-set-l-' + esc(r.key.replace(/\W/g, '-')) + '">' + r.options.map(function (o) {
              return '<button type="button" class="chip" data-set="' + esc(r.key) + '" data-v="' + (o.v ? '1' : '0') + '" aria-pressed="' + (r.value === o.v) + '">' + esc(o.label) + '</button>';
            }).join('') + '</div><small>' + esc(r.what) + '</small></div>';
        }).join('');
    }
    function state() { return ctl.rows().map(function (r) { return r.value ? '1' : '0'; }).join(''); }
    ctl.render = function (box) {
      if (!box) return;
      box.innerHTML = html(); drawn = state();
      var sh = box.parentNode;
      if (sh && !sh.__set) {
        sh.__set = true;
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-set]') : null; if (!t) return;
          ctl.choose(t.getAttribute('data-set'), t.getAttribute('data-v') === '1');
        });
      }
    };
    function sheet() { var r = typeof host.root === 'function' ? host.root() : null; return Sheet && r ? Sheet.sheet(r, 'settings', 'Settings') : null; }
    ctl.isOpen = function () { var r = typeof host.root === 'function' ? host.root() : null, el = r && r.querySelector ? r.querySelector('#gm-sheet-settings') : null; return !!(el && !el.hidden); };
    ctl.open = function () { var s = sheet(); if (!s) return false; ctl.render(s.body); s.open(); return true; };
    ctl.close = function () { var s = sheet(); if (s) s.close(); };
    ctl.toggle = function () { var s = sheet(); if (s && s.isOpen()) { s.close(); return false; } return ctl.open(); };
    /* the open sheet follows a value that moved (a change from another device arrives with the state); force: redraw now. A sheet never opened is not
       made here (the page's DOM is untouched until the Menu line is used) */
    ctl.sync = function (force) {
      var r = typeof host.root === 'function' ? host.root() : null; if (!r || !Sheet || !r.querySelector) return;
      var el = r.querySelector('#gm-sheet-settings'); if (!el || el.hidden) return;
      var s = Sheet.sheet(r, 'settings', 'Settings'); if (!s || !s.isOpen()) return;
      if (force || state() !== drawn) {
        var f = s.body.ownerDocument && s.body.ownerDocument.activeElement, k = f && f.getAttribute ? f.getAttribute('data-set') : null, v = k ? f.getAttribute('data-v') : null;
        ctl.render(s.body);
        if (k) { var b = s.body.querySelector('[data-set="' + k + '"][data-v="' + v + '"]'); if (b && b.focus) try { b.focus(); } catch (e) {} }
      }
    };
    return ctl;
  }

  return { ROWS: ROWS.map(function (r) { return { key: r.key, label: r.label }; }), create: create, _pure: { esc: esc } };
});
