/* The build stamp and the route bundles (lazy loading). Loaded by index.html after runtime/cf.js and before boot.js;
   the service worker (sw.js) imports it too, and the Worker (functions/api/me.js) bundles it, so the build is kept in
   this ONE place and the three agree.

   B68_BUILD: 'dev' in the repository. scripts/deploy.sh stamps this file with the deploy's date and commit
   (YYYY-MM-DD-<commit>) for the upload and puts 'dev' back, so the page, its bundle URLs (?v=<build>), the service
   worker's cache name and /api/me (`build`, and the X-B68-Build header on every API answer) all carry the deployed
   build; a page left open learns from the header that the server moved on and shows "Updated: reload".

   B68Load.need(name): appends the bundle's <link rel=stylesheet> and <script> tags (relative URLs, exactly like the
   static tags, so the claude.ai artifact and the file:// checks resolve them unchanged), each file once, scripts in
   order (gm/console.js before gm-page.js: dynamic scripts with async=false run in insertion order while they fetch in
   parallel), and resolves with the bundle's name when every file has loaded; it rejects on the first file that fails,
   and that file is forgotten so the next need() tries it again. Everything a route needs that is not in index.html is
   listed here; sw.js precaches the union, so every route still works offline. */
(function (root) {
  'use strict';
  var BUILD = 'dev';   /* B68_BUILD: stamped by scripts/deploy.sh, never committed stamped (checks/api/worker.mjs) */

  /* core (index.html, every route): the creator, the sheet, Home with its next-session card and the "on stage" banner,
     the rules wiki (its "?" links sit on every sheet) and the cast page. The rest loads with its route. */
  /* the table carries the season print too: its "Print the season" button calls B68Season straight from campaign.js */
  var TABLE = ['crewsheet.css', 'season.css', 'crews.js', 'crewsheet.js', 'campaign.js', 'season.js'];
  var BUNDLES = {
    table: TABLE,
    print: TABLE,
    gm: ['gm.css', 'prep.css', 'maps/map-kit.js', 'gm/console.js', 'gm/location.js', 'gm/scenes.js', 'gm/engagement.js', 'gm/npc.js', 'gm/figure-map.js', 'gm/prep.js', 'gm-page.js'],
    display: ['display.css', 'stt.js', 'display-page.js']
  };

  var loading = {};            /* file -> Promise (resolved: loaded; a failure is forgotten so it can be tried again) */
  var loaded = {};             /* file -> true once its load event fired */
  function url(file) { return file + '?v=' + encodeURIComponent(BUILD); }
  function one(file) {
    if (loading[file]) return loading[file];
    loading[file] = new Promise(function (resolve, reject) {
      var d = root.document, el;
      if (!d || typeof d.createElement !== 'function') { reject(new Error('no document to load ' + file + ' into')); return; }
      if (/\.css$/.test(file)) { el = d.createElement('link'); el.rel = 'stylesheet'; el.href = url(file); }
      else { el = d.createElement('script'); el.src = url(file); el.async = false; }
      el.onload = function () { loaded[file] = true; resolve(file); };
      el.onerror = function () { delete loading[file]; if (el.parentNode) el.parentNode.removeChild(el); reject(new Error('could not load ' + file)); };
      (d.head || d.body || d.documentElement).appendChild(el);
    });
    return loading[file];
  }
  function need(name) {
    var files = BUNDLES[name];
    if (!files) return Promise.reject(new Error('unknown bundle: ' + name));
    return Promise.all(files.map(one)).then(function () { return name; });
  }
  /* true once every file of the bundle has loaded (then a module still missing is the file's fault, not a load to wait for) */
  function done(name) { return !!BUNDLES[name] && BUNDLES[name].every(function (f) { return loaded[f]; }); }
  /* every file of every bundle, each once, in order (sw.js precaches these beside index.html's own files) */
  function files() {
    var out = [], seen = {};
    Object.keys(BUNDLES).forEach(function (n) { BUNDLES[n].forEach(function (f) { if (!seen[f]) { seen[f] = true; out.push(f); } }); });
    return out;
  }

  root.B68_BUILD = BUILD;
  root.B68Load = { need: need, done: done, files: files, url: url, BUNDLES: BUNDLES, build: BUILD };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
