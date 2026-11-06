/* gm/settings.js — the Settings: the four choices left once the Switchboard went (the night rebuild, N0), in the iPad view (N5).

   Everything built is on (app/features.js). What is left are modes, not features, each a two-way choice with the current value shown:
     Scenes              moving / held still          fx.off       a display setting: the iPad reads it on its next poll
     Music               scene themes / heat music    room.music   a display setting
     Phones              sheet only / mission cards   phoneCards   a phone setting; the page republishes the mission at once (its own setPhoneCards)
     Mirror for phones   off / on                     the GM state's `mirror` (not a registry line: the server reads it beside Live sync)
   Their home is the iPad view's Settings section (gm-page.js renderIpad renders them with render(box)); the Menu's sheet that held them first is gone.

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
     F                   the registry (default window.B68Features)
   controller
     on(id) -> bool                  a setting's value (valueOf)
     set(id, on) -> bool             write a setting (the GM state, then the campaign copy), redraw; false for an id that is not a setting
     rows() -> [{ key, label, what, value, options: [{ v, label }] }]       choose(key, v) -> bool   a row's choice (nothing happens when it is the value already)
     syncPublic() / heal()           copy the settings into the campaign document when its copy differs: a copy just sent is not sent again for 4 s,
                                     and the same copy at most three times (a page newer than the Worker)
     render(box)                     draw the rows into box (the iPad view's Settings) and keep it: a tap on a choice there chooses it
     sync(force)                     redraw the kept box when a value moved (force: now), the focused choice kept; nothing while it is off the page */
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
    var sent = { key: '', at: 0, n: 0 }, drawn = '', bound = null, wired = [];
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
    ctl.state = state;
    /* the iPad view's Settings: the rows drawn into box, kept so a choice (here or on another device) redraws them; one listener per box */
    ctl.render = function (box) {
      if (!box) return;
      box.innerHTML = html(); drawn = state(); bound = box;
      if (typeof box.addEventListener === 'function' && wired.indexOf(box) < 0) {
        wired.push(box); if (wired.length > 8) wired.shift();
        box.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-set]') : null; if (!t || !box.contains(t)) return;
          ctl.choose(t.getAttribute('data-set'), t.getAttribute('data-v') === '1');
        });
      }
    };
    /* the kept box follows a value that moved; force: redraw now. A box taken off the page is let go (the view draws a new one when it opens) */
    ctl.sync = function (force) {
      var b = bound; if (!b) return;
      if (b.isConnected === false) { bound = null; return; }
      if (force || state() !== drawn) {
        var d = b.ownerDocument, f = d && d.activeElement, k = f && f.getAttribute && b.contains && b.contains(f) ? f.getAttribute('data-set') : null, v = k ? f.getAttribute('data-v') : null;
        ctl.render(b);
        if (k) { var btn = b.querySelector('[data-set="' + k + '"][data-v="' + v + '"]'); if (btn && btn.focus) try { btn.focus(); } catch (e) {} }
      }
    };
    return ctl;
  }

  return { ROWS: ROWS.map(function (r) { return { key: r.key, label: r.label }; }), create: create, _pure: { esc: esc } };
});
