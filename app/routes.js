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
   the core and table at install and the gm and display bundles when the page says the viewer is the GM (or the iPad), so
   each route still works offline on the devices that use it. */
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
      'content.js', 'core.js', 'zoom.js', 'steps.js', 'tracker.js', 'schedule.js',
      'markdown.js', 'rules.js', 'cast-page.js', 'name-edit.js', 'sheet/flags.js', 'sheet/keys.js', 'sheet/now.js', 'runtime/cf.js', 'routes.js', 'ui/kit-flag.js', 'boot.js'],
    /* the figure kit and the cast canon (about 1 MB): NOT in the core. First paint draws no figure; boot.js asks for this bundle
       once the route has rendered (B68Load.kit), every caller shows a placeholder and redraws on B68Load.onFigures. gm and
       display need it before they run (DEPS); season.js and the other callers wait for it themselves. sw.js precaches it for everyone but does not require it at install */
    figures: ['figures/figure-kit.js', 'figures/cast.js'],
    table: TABLE,
    print: TABLE,
    crews: ['crews.js'],   /* just the crew playbooks' text, for the sheet's roll-panel abilities strip (the table bundle loads it too, once) */
    gm: ['gm.css', 'prep.css', 'gm/esc.js', 'maps/map-kit.js', 'mapzoom.js', 'gm/console.js', 'gm/location.js', 'gm/scenes.js', 'gm/score.js', 'gm/npc.js', 'gm/figure-map.js', 'gm/prep.js', 'gm/night.js', 'downtime-tables.js', 'gm/downtime.js', 'gm/assist-panel.js', 'gm/chase.js', 'gm/ball.js', 'gm/run-view.js', 'gm/room-notes.js', 'gm/mission-publish.js', 'cue-verbs.js', 'cue.js', 'gm/cogm.js', 'gm/autopilot.js', 'features.js', 'gm/tools.js', 'gm/tool-registry.js', 'gm/workshop.js', 'gm/settings.js', 'gm/show.js', 'gm/phase-rail.js', 'gm/curfew.js', 'gm/preflight.js', 'gm/spine.js', 'gm/stamp.js', 'gm/roll.js', 'gm/cue-grammar.js', 'gm/cue-stack.js', 'gm/hardstart.js', 'gm/onair.js', 'gm/batch-record.js', 'gm/light.js', 'gm/b29.js', 'gm/keyturn.js', 'gm/pcstatus.js', 'gm/aftermath.js', 'gm/debrief.js', 'gm/quiet.js', 'gm/board.js', 'sheet/claims.js', 'gm/print.js', 'gm/corkboard.js', 'gm/map-spotted.js', 'gm/map-flashback.js', 'gm/map-threat.js', 'gm/stage.js', 'gm/security.js', 'display/face-look.js', 'gm/face-looks.js', 'gm/spotlight.js', 'gm/panel17.js', 'gm/knowledge.js', 'gm/site.js', 'gm/title-card.js', 'gm/montage.js', 'gm/practical.js', 'gm/phone.js', 'gm/music.js', 'gm/trouble.js', 'gm/frontpage.js', 'gm/absent.js', 'gm/canon.js', 'gm/desk-b31.js', 'gm/room-desk.js', 'display/castphoto.js', 'display/lair.js', 'display/lair-draw.js', 'gm/castphoto.js', 'gm/lair.js', 'gm/ipad-tray.js', 'gm/places.js', 'gm/band.js', 'gm/shortcuts.js', 'gm/players-intro.js', 'gm-page.js', 'gm/players-screen.js'],
    display: ['tokens.css', 'display.css', 'display/shows.css', 'display/onair.css', 'display/hardstart.css', 'display/aftermath.css', 'display/board.css', 'display/title-card.css', 'display/castphoto.css', 'display/lair.css', 'display/face-cards.css', 'display/montage.css', 'display/players/intro.css', 'tokens.js', 'cue-verbs.js', 'cue.js', 'stt.js', 'display/shows.js', 'display/show-beats.js', 'display/rolodex-card.js', 'display/face-look.js', 'display/face-motif.js', 'display/face-formats.js', 'display/face-badge.js', 'display/face-render.js', 'display/report-beat.js', 'display/preflight-report.js', 'display/aftermath.js', 'display/board.js', 'display/title-card.js', 'display/castphoto.js', 'display/lair.js', 'display/layers.js', 'display/montage.js', 'display/hardstart.js', 'display/onair.js', 'display/fx.js', 'display/room-audio.js', 'display/players/intro.js', 'display-page.js', 'display/players/players.css', 'display/players/players.js'],
    /* the phone's Aftermath commendations (suite 1.6): fetched only while the spine.aftermath switch is on (boot.js asks), so a phone with it off loads nothing */
    commend: ['sheet/commend.js'],
    /* the Debrief card (1.7, spine.debrief) and the quiet line (5.8, between.quiet): each fetched only while its switch is on (boot.js asks) */
    debrief: ['sheet/debrief.js'],
    quiet: ['sheet/quiet.js'],
    /* the opportunity board (5.1, between.board): a player posts a client, a target or an operation; fetched only while its switch is on */
    board: ['sheet/board.js'],
    /* claims and status (5.5, between.claims): the claim track and the faction cards on the crew sheet; fetched only while its switch is on (the GM bundle carries it too) */
    claims: ['sheet/claims.js'],
    /* the absent-player packet (5.7, between.absent): the page the GM left for a player who missed the night; fetched only while its switch is on */
    absent: ['sheet/absent.js'],
    /* the look book (app/lookbook.html, GM only): every show kind with its fixture; a later bundle that adds a kind lists its renderer file here */
    /* the lair (5.4, between.lair): the display fetches the map kit and the drawer only when a lair is first put on the iPad (the show kind is registered with bundle: 'lair') */
    lair: ['maps/map-kit.js', 'display/lair-draw.js'],
    lookbook: ['tokens.css', 'display.css', 'display/shows.css', 'display/hardstart.css', 'display/onair.css', 'display/aftermath.css', 'display/board.css', 'display/title-card.css', 'display/castphoto.css', 'display/lair.css', 'display/face-cards.css', 'display/montage.css', 'tokens.js', 'display/shows.js', 'display/show-beats.js', 'display/rolodex-card.js', 'display/report-beat.js', 'display/aftermath.js', 'display/board.js', 'display/title-card.js', 'display/castphoto.js', 'display/lair.js', 'display/layers.js', 'display/montage.js', 'display/hardstart.js', 'display/onair.js', 'maps/map-kit.js', 'display/lair-draw.js', 'display/face-look.js', 'display/face-motif.js', 'display/face-formats.js', 'display/face-badge.js', 'display/face-render.js', 'display/lookbook-faces.js', 'display/lookbook.js'],
    /* the kit and stage build: one bundle per setting, each fetched only while its setting is on, so with every setting off a page
       fetches what it always did (the core's ui/kit-flag.js aside). The desk, the stage and the phone sheet are asked for by the kit
       flag (B68Kit, ui/kit-flag.js) when their token turns on; Start the night and the pitches by the GM page while their setting is on;
       kit-lookbook by lookbook-boot.js. Each brings kit-ui first (DEPS): the UI kit every one of them shares. gm/kit/blade.js holds
       the Blade panel of the new desk and the pitch cards, which also show on the old desk, so it is in both bundles */
    'kit-ui': ['ui/tokens.css', 'ui/parts.css', 'ui/overlay.css', 'ui/ui.js', 'ui/overlay.js'],
    'kit-desk': ['ui/desk-band.css', 'ui/desk-roll.css', 'ui/desk-blade.css', 'ui/desk-run.css', 'ui/desk-shell.css', 'ui/desk-skin.css', 'gm/kit/band.js', 'gm/kit/roll.js', 'gm/kit/blade.js', 'gm/kit/run.js', 'gm/kit/shell.js'],
    'kit-stage': ['display/kit/stage.css', 'display/kit/band.css', 'display/kit/roll.css', 'display/kit/scene.css', 'display/kit/stage.js', 'display/kit/band.js', 'display/kit/roll.js', 'display/kit/scene.js'],
    'kit-phone': ['sheet/kit/tabs.css', 'sheet/kit/tabs.js'],
    'night-who': ['ui/desk-who.css', 'gm/kit/who.js'],
    'blade-pitches': ['gm/kit/blade.js'],
    'kit-lookbook': ['display/kit/stage.css', 'display/kit/band.css', 'display/kit/roll.css', 'display/kit/scene.css', 'display/kit/stage.js', 'display/kit/band.js', 'display/kit/roll.js', 'display/kit/scene.js'],
    /* MK1: the map kit's new options (gm/scene-state.js), fetched by the GM page only while one of map.fill, map.people, map.lights or map.room is on,
       so with all four off the page makes the requests it always made */
    'map-scene': ['gm/scene-state.js'],
    /* IP4 (phone.handouts): handouts on the players' phones. The phone's list and viewer, started by boot.js for a player while the setting is on;
       the GM page's Send to…, fetched by gm-page.js while it is on. With it off neither is fetched */
    handouts: ['sheet/handouts.css', 'sheet/handouts.js'],
    'gm-handouts': ['gm/handout-send.css', 'gm/handout-send.js']
  };
  /* every stylesheet, in cascade order (index.html's order from before lazy loading); the kit's sheets come after every old one */
  var CSS_ORDER = ['tracker.css', 'campaign.css', 'crewsheet.css', 'schedule.css', 'season.css', 'rules.css', 'cast.css', 'gm.css', 'prep.css', 'display.css', 'tokens.css', 'display/shows.css', 'display/hardstart.css', 'display/onair.css', 'display/aftermath.css', 'display/board.css', 'display/title-card.css', 'display/castphoto.css', 'display/lair.css', 'display/face-cards.css', 'display/montage.css', 'display/players/intro.css', 'display/players/players.css',
    'sheet/handouts.css', 'gm/handout-send.css',      /* IP4: old-style sheets of their own classes, last of the old ones (layered with them while a kit is on) */
    'ui/tokens.css', 'ui/parts.css', 'ui/overlay.css', 'ui/desk-band.css', 'ui/desk-roll.css', 'ui/desk-blade.css', 'ui/desk-run.css', 'ui/desk-shell.css', 'ui/desk-who.css', 'ui/desk-skin.css',
    'display/kit/stage.css', 'display/kit/band.css', 'display/kit/roll.css', 'display/kit/scene.css', 'sheet/kit/tabs.css'];

  var DEPS = { gm: ['figures'], display: ['figures'], lookbook: ['figures'],   /* bundles that need another one in first */
    'kit-desk': ['kit-ui'], 'kit-stage': ['kit-ui'], 'kit-phone': ['kit-ui'], 'night-who': ['kit-ui'], 'blade-pitches': ['kit-ui'], 'kit-lookbook': ['kit-ui'], 'map-scene': ['gm'] };
  var loading = {};            /* file -> Promise (resolved: loaded; a failure is forgotten so it can be tried again) */
  var loaded = {};             /* file -> true once its load event fired (the core: index.html's own tags) */
  BUNDLES.core.forEach(function (f) { loaded[f] = true; loading[f] = Promise.resolve(f); });
  function url(file) { return BUILD === 'dev' ? file : file + '?v=' + encodeURIComponent(BUILD); }
  /* the kit and stage build (KS01.5, Gate 1 approach A1): the kit's sheets are unlayered and the OLD sheets go into the cascade layer
     `old` while the kit is on, so a kit rule beats an old one at any specificity and an old !important still beats everything.
     layerOld() is called by the kit flag (ui/kit-flag.js) when this page first paints a kit token: beside each old <link> already in
     goes <style data-href="x.css">@import url("x.css?v=…") layer(old)</style>; once every import has answered, in ONE step, the links
     whose imports loaded are removed and index.html's inline block is wrapped in @layer old { } (until then the links and the block
     stand as before, so the look never changes on the way). A link still loading when this runs is handed to its import: the import's
     load or error settles that file for need() (the link is removed before its own load event could). An import that fails leaves its
     link where it was, UNLAYERED: it then beats the inline block and the kit at any specificity, which is better than losing the sheet.
     (For a link that was still loading, a failed import removes the link and fails the file, as a failed link would have.) From then on, for the rest of the page's life, every old sheet the loader brings comes in as an import. Until
     layerOld() runs nothing here differs from before: the same <link> tags, the same order, no write to the page.
     Only index.html's own block is wrapped: the one style element in <head> without an id when this file runs (routes.js is one of
     index.html's own tags, so it runs before any script builds a style). Styles built in JS (zoom.js, sheet/quiet.js, sheet/claims.js,
     gm/frontpage.js) and the ambient frames' own styles (display/fx.js) are never touched (layer rule 5). */
  var layering = null;         /* the page has gone layered: a promise that settles once the static links are converted */
  var pend = {};               /* file -> { ok, bad } while its <link> or <style> has not answered (layerOld hands a loading link to its import) */
  var INLINE = (function () {
    var d = root.document; if (!d || typeof d.querySelectorAll !== 'function') return null;
    var s = [].filter.call(d.querySelectorAll('head > style'), function (x) { return !(x.getAttribute && (x.getAttribute('id') || x.getAttribute('data-href'))); });
    if (s.length !== 1 && typeof console !== 'undefined') console.warn('B68Load: ' + s.length + ' id-less head styles, not one: the inline block will not be layered');
    return s.length === 1 ? s[0] : null;
  })();
  function isKitCss(f) { return /^(ui|display\/kit|sheet\/kit)\//.test(f); }
  function importOf(d, file, href) {
    var s = d.createElement('style'); s.setAttribute('data-href', file); s.textContent = '@import url("' + href + '") layer(old);';
    return s;
  }
  function layerOld() {
    var d = root.document;
    if (layering) return layering;
    if (!d || typeof d.querySelectorAll !== 'function' || typeof d.createElement !== 'function') return Promise.resolve(0);
    var waits = [], swap = [];
    [].slice.call(d.querySelectorAll('link[rel="stylesheet"]')).forEach(function (l) {
      var href = String(l.getAttribute('href') || ''), f = href.split('?')[0];
      if (CSS_ORDER.indexOf(f) < 0 || isKitCss(f) || !l.parentNode) return;
      var s = importOf(d, f, href), p = !loaded[f] ? pend[f] : null;
      if (p) { l.onload = l.onerror = null; }          /* still loading: from here the import answers for this file */
      waits.push(new Promise(function (done) {
        s.onload = function () { swap.push(l); if (p) p.ok(); done(); };
        s.onerror = function () { if (s.parentNode) s.parentNode.removeChild(s); if (p) p.bad(); done(); };   /* the link stays */
      }));
      l.parentNode.insertBefore(s, l);
    });
    layering = Promise.all(waits).then(function () {
      swap.forEach(function (l) { if (l.parentNode) l.parentNode.removeChild(l); });
      if (INLINE && INLINE.parentNode) {      /* once: layering runs once per page */
        INLINE.textContent = '@layer old {\n' + INLINE.textContent + '\n}'; INLINE.setAttribute('data-layered', '');
      }
      return swap.length;
    });
    return layering;
  }
  /* a stylesheet goes in before the first one that comes after it in CSS_ORDER, else after the last one (a layered page counts its imports) */
  function placeCss(d, el, file) {
    var mine = CSS_ORDER.indexOf(file), links = d.querySelectorAll ? d.querySelectorAll(layering ? 'link[rel="stylesheet"], style[data-href]' : 'link[rel="stylesheet"]') : [], last = null;
    for (var i = 0; i < links.length; i++) {
      var at = CSS_ORDER.indexOf(String(links[i].getAttribute('href') || links[i].getAttribute('data-href') || '').split('?')[0]);
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
      if (css && layering && !isKitCss(file)) el = importOf(d, file, url(file));      /* a layered page: an old sheet comes in layer(old) */
      else if (css) { el = d.createElement('link'); el.rel = 'stylesheet'; }
      else { el = d.createElement('script'); el.async = false; }
      var settled = false;
      function ok() { if (settled) return; settled = true; delete pend[file]; loaded[file] = true; resolve(file); }
      function bad() { if (settled) return; settled = true; delete pend[file]; delete loading[file]; if (el.parentNode) el.parentNode.removeChild(el); reject(new Error('could not load ' + file)); }
      el.onload = ok; el.onerror = bad;
      if (css) pend[file] = { ok: ok, bad: bad };
      if (css) { if (el.tagName !== 'STYLE') el.href = url(file); placeCss(d, el, file); }
      else { el.src = url(file); (d.head || d.body || d.documentElement).appendChild(el); }
    });
    return loading[file];
  }
  function need(name) {
    var files = Object.prototype.hasOwnProperty.call(BUNDLES, name) ? BUNDLES[name] : null;
    if (!files) return Promise.reject(new Error('unknown bundle: ' + name));
    var deps = DEPS[name] || [];
    return Promise.all(deps.map(need).concat(files.map(one))).then(function () { if (name === 'figures') arrive(); return name; });   /* whoever fetched the kit, its waiters run */
  }
  /* true once every file of the bundle has loaded (then a module still missing is the file's fault, not a load to wait for) */
  function done(name) { return Object.prototype.hasOwnProperty.call(BUNDLES, name) && BUNDLES[name].every(function (f) { return loaded[f]; }); }
  /* every file of every bundle, the core first, each once, in order (sw.js precaches these beside the page, fonts and icons) */
  function files() {
    var out = [], seen = {};
    Object.keys(BUNDLES).forEach(function (n) { BUNDLES[n].forEach(function (f) { if (!seen[f]) { seen[f] = true; out.push(f); } }); });
    return out;
  }

  /* ---------- the figure kit, after the first paint ----------
     kitIn(): the kit and the cast canon are both here. onFigures(fn): fn runs now when they are, else once when they arrive
     (every caller draws a placeholder meanwhile and redraws in fn). kit(urgent): fetch the bundle; urgent (a route that cannot
     do without it: the creator) at once, else when the browser is idle, never before the route's first render (boot.js calls
     it after that). One fetch at a time; a failure is forgotten so the next kit() tries again. */
  var waiters = [], kitP = null, kitGo = null;
  function kitIn() { return !!(root.B68Figure && root.B68Cast); }
  function onFigures(fn) {
    if (typeof fn !== 'function') return;
    if (kitIn()) { try { fn(); } catch (e) { if (root.console) root.console.error(e); } return; }
    waiters.push(fn);
  }
  function arrive() {
    var w = waiters; waiters = [];
    w.forEach(function (fn) { try { fn(); } catch (e) { if (root.console) root.console.error(e); } });
  }
  function kit(urgent) {
    if (kitIn()) return Promise.resolve(true);
    if (kitP) { if (urgent === true && kitGo) kitGo(); return kitP; }
    kitP = new Promise(function (resolve) {
      var started = false;
      kitGo = function () {
        if (started) return; started = true;
        need('figures').then(function () { kitP = null; kitGo = null; resolve(true); }, function () { kitP = null; kitGo = null; resolve(false); });
      };
      if (urgent === true || !root.document) kitGo();
      else if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(function () { if (kitGo) kitGo(); }, { timeout: 1500 });
      else setTimeout(function () { if (kitGo) kitGo(); }, 200);
    });
    return kitP;
  }

  root.B68_BUILD = BUILD;
  root.B68Load = { need: need, done: done, kit: kit, kitIn: kitIn, onFigures: onFigures, files: files, url: url, layerOld: layerOld, layered: function () { return !!layering; }, BUNDLES: BUNDLES, CSS_ORDER: CSS_ORDER, build: BUILD };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
