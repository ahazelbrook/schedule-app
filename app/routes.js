/* The build stamp and the route bundles (lazy loading). Loaded by index.html after runtime/cf.js and before boot.js;
   the service worker (sw.js) imports it too, and the Worker (functions/api/me.js) bundles it, so the build is kept in
   this ONE place and the three agree.

   B68_BUILD: 'dev' in the repository. scripts/deploy.sh stamps this file with the deploy's date and commit
   (YYYY-MM-DD-<commit>) for the upload and puts 'dev' back, so the page, its bundle URLs (?v=<build>), the service
   worker's cache name and /api/me (`build`, and the X-B68-Build header on every API answer) all carry the deployed
   build; a page left open learns from the header that the server moved on and shows "Updated: reload".

   BUNDLES.core is what index.html loads with its own tags, on every route (checks/runtime/pwa.test.mjs keeps the two
   lists equal). Every other bundle is fetched by B68Load.need(name) the first time its route opens (boot.js starters).
   need() appends the bundle's <link rel=stylesheet> and <script> tags (relative URLs, exactly like the static tags, so
   the claude.ai artifact and the file:// checks resolve them unchanged), each file once: scripts run in order
   (gm/console.js before gm-page.js: dynamic scripts with async=false run in insertion order while they fetch in
   parallel), and a stylesheet goes in at its place in CSS_ORDER, so the cascade is the one index.html always had,
   whichever routes have opened and in what order. need() resolves with the bundle's name when every file has loaded
   and rejects on the first that fails; that file is forgotten, so the next need() tries it again. sw.js precaches
   every file of every bundle, so each route still works offline. */
(function (root) {
  'use strict';
  var BUILD = 'dev';   /* B68_BUILD: stamped by scripts/deploy.sh, never committed stamped (checks/api/worker.mjs) */

  /* the table carries the season print too (its "Print the season" button calls B68Season straight from campaign.js),
     so #t and #print need the same files. Scripts keep the order index.html gave them: crewsheet.js registers itself
     with B68Campaign as it runs, so campaign.js comes first */
  var TABLE = ['campaign.css', 'crewsheet.css', 'season.css', 'campaign.js', 'crews.js', 'crewsheet.js', 'season.js'];
  var BUNDLES = {
    /* every route: the creator, the sheet and Home with its next-session card (schedule.js); the rules wiki, because
       every sheet draws its "?" links (tracker.js asks B68Rules.help while it renders) and the Rules button shows when
       it is there; the cast, because its "on stage" banner shows on every screen during a scene */
    core: ['tracker.css', 'schedule.css', 'rules.css', 'cast.css',
      'figures/figure-kit.js', 'figures/cast.js', 'content.js', 'core.js', 'zoom.js', 'steps.js', 'tracker.js', 'schedule.js',
      'markdown.js', 'rules.js', 'cast-page.js', 'name-edit.js', 'runtime/cf.js', 'routes.js', 'boot.js'],
    table: TABLE,
    print: TABLE,
    gm: ['gm.css', 'prep.css', 'maps/map-kit.js', 'gm/console.js', 'gm/location.js', 'gm/scenes.js', 'gm/score.js', 'gm/npc.js', 'gm/figure-map.js', 'gm/prep.js', 'downtime-tables.js', 'gm/downtime.js', 'gm/assist-panel.js', 'gm/chase.js', 'gm/ball.js', 'gm/cogm.js', 'gm/autopilot.js', 'gm-page.js'],
    display: ['display.css', 'stt.js', 'display-page.js']
  };
  /* every stylesheet, in cascade order (index.html's order from before lazy loading) */
  var CSS_ORDER = ['tracker.css', 'campaign.css', 'crewsheet.css', 'schedule.css', 'season.css', 'rules.css', 'cast.css', 'gm.css', 'prep.css', 'display.css'];

  var loading = {};            /* file -> Promise (resolved: loaded; a failure is forgotten so it can be tried again) */
  var loaded = {};             /* file -> true once its load event fired (the core: index.html's own tags) */
  BUNDLES.core.forEach(function (f) { loaded[f] = true; loading[f] = Promise.resolve(f); });
  function url(file) { return BUILD === 'dev' ? file : file + '?v=' + encodeURIComponent(BUILD); }
  /* a stylesheet goes in before the first one that comes after it in CSS_ORDER, else after the last one */
  function placeCss(d, el, file) {
    var mine = CSS_ORDER.indexOf(file), links = d.querySelectorAll ? d.querySelectorAll('link[rel="stylesheet"]') : [], last = null;
    for (var i = 0; i < links.length; i++) {
      var at = CSS_ORDER.indexOf(String(links[i].getAttribute('href') || '').split('?')[0]);
      if (at < 0) continue;
      if (mine >= 0 && at > mine) { links[i].parentNode.insertBefore(el, links[i]); return; }
      last = links[i];
    }
    if (last) last.parentNode.insertBefore(el, last.nextSibling);
    else (d.head || d.documentElement).appendChild(el);
  }
  function one(file) {
    if (loading[file]) return loading[file];
    loading[file] = new Promise(function (resolve, reject) {
      var d = root.document, el, css = /\.css$/.test(file);
      if (!d || typeof d.createElement !== 'function') { delete loading[file]; reject(new Error('no document to load ' + file + ' into')); return; }
      if (css) { el = d.createElement('link'); el.rel = 'stylesheet'; }
      else { el = d.createElement('script'); el.async = false; }
      el.onload = function () { loaded[file] = true; resolve(file); };
      el.onerror = function () { delete loading[file]; if (el.parentNode) el.parentNode.removeChild(el); reject(new Error('could not load ' + file)); };
      if (css) { el.href = url(file); placeCss(d, el, file); }
      else { el.src = url(file); (d.head || d.body || d.documentElement).appendChild(el); }
    });
    return loading[file];
  }
  function need(name) {
    var files = Object.prototype.hasOwnProperty.call(BUNDLES, name) ? BUNDLES[name] : null;
    if (!files) return Promise.reject(new Error('unknown bundle: ' + name));
    return Promise.all(files.map(one)).then(function () { return name; });
  }
  /* true once every file of the bundle has loaded (then a module still missing is the file's fault, not a load to wait for) */
  function done(name) { return Object.prototype.hasOwnProperty.call(BUNDLES, name) && BUNDLES[name].every(function (f) { return loaded[f]; }); }
  /* every file of every bundle, the core first, each once, in order (sw.js precaches these beside the page, fonts and icons) */
  function files() {
    var out = [], seen = {};
    Object.keys(BUNDLES).forEach(function (n) { BUNDLES[n].forEach(function (f) { if (!seen[f]) { seen[f] = true; out.push(f); } }); });
    return out;
  }

  root.B68_BUILD = BUILD;
  root.B68Load = { need: need, done: done, files: files, url: url, BUNDLES: BUNDLES, CSS_ORDER: CSS_ORDER, build: BUILD };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
