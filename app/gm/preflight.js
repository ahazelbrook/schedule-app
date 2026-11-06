/* gm/preflight.js — Menu -> Preflight: is the room ready (suite ticket 4.2, switch room.preflight).

   Window.B68GmPreflight, and module.exports under Node. READ-ONLY and free: it looks, it never starts or pays for anything (no Anthropic call, no
   Deepgram audio, no token). Each item is green or red, and every red one says in one line what to do.

   The items (a missing report is red, never silently green)
     audio       the iPad's sound is unlocked (the iPad reports it with its transcriber status; "none" = this build has no music file)
     ipadfiles   the iPad has its files cached (the service worker's cache holds the display page's bundles)
     gmfiles     the same for this device
     deepgram    the Worker has a Deepgram key, and Deepgram answers from the Worker (an unauthenticated ping; nothing is sent to be transcribed)
     access      time left on the Access session (the server reads the sign-in token's expiry); red under REQUIRED_MIN minutes
     pack        the pack this page is running on is the pack the server holds (a push from the vault moves it)
     relay       the light relay, ONLY when something registered a check for it (addCheck); nothing does yet, so there is no such line
   Extra checks: addCheck(id, fn) where fn(facts, now) -> { ok, label, say, fix } | Promise of it; a throw is a red "could not check".

   When: from 45 minutes before the start (due(now, startMs)), or on demand from the Menu.

   Pure: evaluate(facts, now, local) -> [{ id, label, ok, say, fix }] · due(now, startMs) · summary(items) -> { red, total }
     facts  = GET /api/gm/preflight's answer  { now, access:{expiresAt}, deepgram:{keySet, reachable, ms}, pack:{version,parts}, device:{audio,files,of,build,at}|null }
     local  = { files, of, packVersion } this device's own look
   create(host) -> { run(), open(), close(), toggle(), badge(), tick() }
     host: root() toast(msg, bad) fetchFacts() -> Promise<facts> local() -> Promise<{files, of, packVersion}> startMs() -> epoch ms | null now() Sheet (default window.B68GmWorkshop) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPreflight = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var LEAD_MS = 45 * 60000, REQUIRED_MIN = 240, STALE_MS = 3 * 60000;
  var extra = [];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function item(id, label, ok, say, fix) { return { id: id, label: label, ok: !!ok, say: say, fix: ok ? '' : fix }; }
  function ms(v) { var t = typeof v === 'string' ? Date.parse(v) : NaN; return isNaN(t) ? null : t; }

  function due(now, startMs) { return typeof startMs === 'number' && isFinite(startMs) && now >= startMs - LEAD_MS; }
  function summary(items) { var red = 0; (items || []).forEach(function (i) { if (!i.ok) red++; }); return { red: red, total: (items || []).length }; }

  function evaluate(facts, now, local) {
    var f = isObj(facts) ? facts : {}, out = [], dev = isObj(f.device) ? f.device : null, dg = isObj(f.deepgram) ? f.deepgram : {}, loc = isObj(local) ? local : {};
    /* the iPad: a report older than a few minutes is no report (the iPad reports with its transcriber status, so it is silent while not listening) */
    var at = dev ? ms(dev.at) : null, fresh = !!dev && (at === null || now - at <= STALE_MS);
    if (!fresh) {
      var gone = 'The iPad has not reported ' + (dev && at !== null ? 'for ' + Math.round((now - at) / 60000) + ' minutes' : 'yet') + '.';
      out.push(item('audio', 'iPad sound', false, gone, 'Start listening on the iPad, then reopen Preflight.'));
      out.push(item('ipadfiles', 'iPad files', false, gone, 'Start listening on the iPad, then reopen Preflight.'));
    } else {
      out.push(dev.audio === 'locked' ? item('audio', 'iPad sound', false, 'Sound is locked until the iPad is touched.', 'Tap the iPad screen once.')
        : item('audio', 'iPad sound', true, dev.audio === 'none' ? 'No music file to unlock.' : 'Unlocked.', ''));
      var ok = dev.of > 0 && dev.files >= dev.of;
      out.push(item('ipadfiles', 'iPad files', ok, (dev.files || 0) + ' of ' + (dev.of || '?') + ' kept' + (ok ? ' (build ' + (dev.build || '?') + ').' : '.'), 'Reload the display page on the iPad while online and wait a minute.'));
    }
    var lok = loc.of > 0 && loc.files >= loc.of;
    out.push(item('gmfiles', 'This device’s files', lok, (loc.files || 0) + ' of ' + (loc.of || '?') + ' kept.', 'Reload this page while online and wait a minute.'));
    if (dg.keySet !== true) out.push(item('deepgram', 'Deepgram', false, 'The Worker has no Deepgram key.', 'Set the DEEPGRAM_API_KEY secret on the Worker.'));
    else if (dg.reachable !== true) out.push(item('deepgram', 'Deepgram', false, 'Deepgram did not answer from the Worker.', 'Check Deepgram’s status page, then run this again.'));
    else out.push(item('deepgram', 'Deepgram', true, 'Key set, answered in ' + (+dg.ms || 0) + ' ms.', ''));
    var exp = isObj(f.access) ? ms(f.access.expiresAt) : null;
    if (exp === null) out.push(item('access', 'Access session', true, 'Not applicable here (no sign-in token on this connection).', ''));
    else {
      var min = Math.floor((exp - now) / 60000);
      out.push(item('access', 'Access session', min >= REQUIRED_MIN, min >= 0 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min left.' : 'Ended.', 'Sign in again (reload this page) so it covers the evening.'));
    }
    var pv = isObj(f.pack) ? f.pack.version : null, mine = loc.packVersion;
    if (!pv || pv === '0') out.push(item('pack', 'Pack version', false, 'The server holds no pack.', 'Push it from the PC: npm run gm:sync.'));
    else out.push(item('pack', 'Pack version', pv === mine, pv === mine ? 'This page runs the server’s pack (' + pv + ').' : 'This page has ' + (mine || 'no pack') + ', the server holds ' + pv + '.', 'Reload this page; if it stays, push the pack from the PC (npm run gm:sync).'));
    return out;
  }

  /* extra checks are run by create(), not evaluate(): they may be async */
  function addCheck(id, fn) { if (typeof fn === 'function') extra.push({ id: String(id), fn: fn }); }
  function clearChecks() { extra = []; }
  function runExtra(facts, now) {
    return Promise.all(extra.map(function (c) {
      return Promise.resolve().then(function () { return c.fn(facts, now); }).then(function (r) { return item(c.id, r && r.label || c.id, r && r.ok === true, r && r.say || '', r && r.fix || 'Check it.'); },
        function () { return item(c.id, c.id, false, 'Could not check.', 'Check it by hand.'); });
    }));
  }

  /* this device's own look at its service-worker cache: how many of the GM page's files are kept. opts: { caches, load, bundles } (tests inject them) */
  function look(opts) {
    opts = opts || {};
    var cs = opts.caches || (W && W.caches), load = opts.load || (W && W.B68Load), names = opts.bundles || ['core', 'figures', 'gm'], want = [];
    if (!cs || typeof cs.open !== 'function' || !load || !load.BUNDLES) return Promise.resolve({ files: 0, of: 0 });
    names.forEach(function (n) { (load.BUNDLES[n] || []).forEach(function (f) { if (want.indexOf(f) < 0) want.push(f); }); });
    return Promise.resolve().then(function () { return cs.open('b68-shell-' + String(load.build || 'dev')); }).then(function (cache) {
      return Promise.all(want.map(function (f) { return Promise.resolve(cache.match(f, { ignoreSearch: true })).then(function (r) { return r ? 1 : 0; }, function () { return 0; }); }));
    }).then(function (hits) { return { files: hits.reduce(function (a, b) { return a + b; }, 0), of: want.length }; }, function () { return { files: 0, of: want.length }; });
  }

  function create(host) {
    var Sheet = host.Sheet || (W && W.B68GmWorkshop) || null, items = null, busy = false, toasted = 0;
    var ctl = {};
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function sheet() { var r = typeof host.root === 'function' ? host.root() : null; return Sheet && r ? Sheet.sheet(r, 'preflight', 'Preflight') : null; }
    function draw() {
      var s = sheet(); if (!s) return;
      var b = s.body, sm = summary(items || []);
      var h = '<div class="gm-sb-head"><button type="button" class="btn sm" data-pf-run>Check again</button> <span class="gm-sb-tag">' + (items ? (sm.red ? sm.red + ' red of ' + sm.total : 'All ' + sm.total + ' green') : (busy ? 'Looking…' : 'Not run yet')) + '</span></div>';
      if (items) h += items.map(function (i) { return '<div class="gm-sb-row"><b>' + (i.ok ? '✓ ' : '✗ ') + esc(i.label) + '</b><small>' + esc(i.say) + '</small>' + (i.ok ? '' : '<small class="gm-sb-tag">Fix: ' + esc(i.fix) + '</small>') + '</div>'; }).join('');
      b.innerHTML = h;
      var sh = b.parentNode;
      if (sh && !sh.__pf) { sh.__pf = true; sh.addEventListener('click', function (ev) { var t = ev.target && ev.target.closest ? ev.target.closest('[data-pf-run]') : null; if (t) ctl.run(); }); }
    }
    /* run: look at everything once; read-only. -> Promise<items> */
    ctl.run = function () {
      if (busy) return Promise.resolve(items || []);
      busy = true; draw();
      var t = now(), facts = null;
      var loc = function () { return typeof host.local === 'function' ? host.local() : {}; };
      return Promise.resolve().then(function () { return host.fetchFacts(); }).then(function (f) { facts = f; return loc(); }, function () { facts = null; return loc(); })
        .then(function (l) {
          var base = facts ? evaluate(facts, t, l) : [item('server', 'The server', false, 'The server did not answer.', 'Check the connection, then run this again.')];
          return runExtra(facts || {}, t).then(function (x) { items = base.concat(x); });
        }).catch(function () { items = [item('check', 'Preflight', false, 'The check itself failed.', 'Reload this page and run it again.')]; })
        .then(function () { busy = false; draw(); return items; });
    };
    ctl.open = function () { var s = sheet(); if (!s) return false; draw(); s.open(); ctl.run(); return true; };
    ctl.close = function () { var s = sheet(); if (s) s.close(); };
    ctl.toggle = function () { var s = sheet(); if (s && s.isOpen()) { s.close(); return false; } return ctl.open(); };
    /* the count of red items once a run has found any, else '' */
    ctl.badge = function () { var sm = summary(items || []); return items && sm.red ? String(sm.red) : ''; };
    /* called on the page's ticks: from 45 minutes before the start, run once and say so if anything is red */
    ctl.tick = function () {
      var st = typeof host.startMs === 'function' ? host.startMs() : null, t = now();
      if (!due(t, st) || toasted === st || busy) return;
      toasted = st;
      ctl.run().then(function (list) { var sm = summary(list); if (sm.red && typeof host.toast === 'function') host.toast('Preflight: ' + sm.red + ' to fix before the start (Before, Preflight).', true); });
    };
    return ctl;
  }

  return { evaluate: evaluate, due: due, summary: summary, addCheck: addCheck, clearChecks: clearChecks, create: create, look: look, LEAD_MS: LEAD_MS, REQUIRED_MIN: REQUIRED_MIN, STALE_MS: STALE_MS };
});
