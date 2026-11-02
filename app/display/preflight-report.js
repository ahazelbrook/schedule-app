/* display/preflight-report.js — what the table iPad tells the GM's Preflight about itself (suite ticket 4.2, switch room.preflight).

   Window.B68DisplayPreflight, and module.exports under Node. Read-only: it looks at the page's own audio state and the service worker's cache and says
   so in the transcriber's status report (app/stt.js adds it as `status.device`). Nothing is fetched, nothing is paid for, and with the switch off
   (B68Flags.on('room.preflight') is not true) it reports nothing at all, so the status is exactly what it was.

   reporter(host) -> function () -> Promise<device | null>
     host.on()      -> bool    the switch (default: B68Flags.on('room.preflight'))
     host.music()   -> the display's music state ({ unlocked, file, state }) or null
     host.caches    -> CacheStorage (default window.caches)      host.load -> B68Load (default window.B68Load)      host.build -> the build stamp
   device: { audio: 'unlocked' | 'locked' | 'none', files: <cached>, of: <wanted>, build: <string> }
     audio  none: this build has no music file (nothing to unlock);  locked: a tap is still needed;  unlocked: the tap happened
   deviceOf(music) is the pure audio word. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68DisplayPreflight = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var PREFIX = 'b68-shell-', BUNDLES = ['core', 'figures', 'display'];
  function audioOf(music) {
    if (!music || typeof music !== 'object') return 'none';
    if (music.file === false) return 'none';
    return music.unlocked === true ? 'unlocked' : 'locked';
  }
  function reporter(host) {
    host = host || {};
    return function () {
      var on = typeof host.on === 'function' ? host.on() : !!(W && W.B68Flags && W.B68Flags.on('room.preflight'));
      if (!on) return Promise.resolve(null);
      var music = typeof host.music === 'function' ? host.music() : null;
      var load = host.load || (W && W.B68Load), cs = host.caches || (W && W.caches), build = String(host.build || (load && load.build) || (W && W.B68_BUILD) || 'dev').slice(0, 40);
      var out = { audio: audioOf(music), files: 0, of: 0, build: build };
      if (!cs || typeof cs.open !== 'function' || !load || !load.BUNDLES) return Promise.resolve(out);
      var want = []; BUNDLES.forEach(function (n) { (load.BUNDLES[n] || []).forEach(function (f) { if (want.indexOf(f) < 0) want.push(f); }); });
      out.of = want.length;
      return Promise.resolve().then(function () { return cs.open(PREFIX + build); }).then(function (cache) {
        return Promise.all(want.map(function (f) { return Promise.resolve(cache.match(f, { ignoreSearch: true })).then(function (r) { return r ? 1 : 0; }, function () { return 0; }); }));
      }).then(function (hits) { out.files = hits.reduce(function (a, b) { return a + b; }, 0); return out; }, function () { return out; });
    };
  }
  return { reporter: reporter, audioOf: audioOf, PREFIX: PREFIX };
});
