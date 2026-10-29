/* Service worker for the hosted build (registered by runtime/cf.js; never inside the claude.ai artifact).

   ONE BUILD PER CACHE. The cache is named after the build (B68_BUILD, stamped into routes.js by scripts/deploy.sh) and only
   ever holds that build's files. A new deploy is a new worker with a new cache; a page never gets a file from another
   build:
   - the app's own files (SHELL) answer at once from the build's cache and are refreshed from the network a few seconds
     later, after the first paint (stale-while-revalidate), so a bad cached copy mends itself on the next load;
   - nothing fetched from the network is written to the cache until a probe of routes.js, made AFTER the answer arrived,
     names this worker's build (flush). An answer that arrives late, once the server has moved on, is dropped, never filed
     into the older build's cache. A probe that fails drops the batch too;
   - the page is network first: its answer (the Worker names its build in X-B68-Build) is served and stored only when it is
     this build; a slow network (4 s) with a cached page gets the cached page. A redirect (Cloudflare Access asking to sign
     in) is the network answering and goes to the page as it is, never cached;
   - a file asked for with ?v=<build> comes from that build's cache when it exists (a page left open on build A keeps A's
     files after build B's worker has taken over), else from the network;
   - once this worker has seen the server on a newer build it is 'moved': it asks the browser to update, writes nothing, and
     goes network first, except for pages it answered from its own cache (a slow link: the 4 s fallback still applies), which
     keep getting this build's files from the cache, and for ?v=<its build>. Offline the cache answers as always.
   Install precaches the page, the fonts and the core, table and figures bundles only, and fails (the running worker stays in charge)
   unless the page, boot.js, the core and the table are all filed (the figures bundle, the figure kit, is filed too but not required:
   the page draws placeholders until it has it, and any later load from the network files it); the page asks for the gm and display bundles
   by message ({ precache: ['gm', 'display'] }) when /api/me says GM. /api/*, /cdn-cgi/*, /media/* and other origins are not
   touched at all: the data layer (cf.js) keeps its own offline copy. */
'use strict';

/* routes.js: the build stamp and the bundles. A deploy changes this import's bytes, which is what makes the browser install
   the new worker (cf.js registers with updateViaCache 'none' so the import is fetched fresh). Not caught: a worker that
   cannot import it fails to install and the previous one, with its complete cache, keeps serving. */
importScripts('routes.js');
var BUILD = typeof self.B68_BUILD === 'string' && self.B68_BUILD ? self.B68_BUILD : 'dev';
var PREFIX = 'b68-shell-';
var CACHE = PREFIX + BUILD;
var NAV_MS = 4000;               /* a navigation with a cached page: how long the network may take before the cache answers */
var ASSET_MS = 8000;             /* the same for a cached file that is not part of the shell (an ambient scene, say) */
var REFRESH_MS = 5000;           /* a cached shell file is revalidated this long after the first one was served: after first paint */
var FLUSH_MS = 1500;             /* answers waiting to be filed are verified and written this long after the first one arrived */
var LANES = 6;                   /* background fetches at once */

/* the install files: the page, its fonts (index.html's @font-face) and the install files */
var STATIC = [
  './',
  'fonts/ArchivoCompressed-Black.woff2', 'fonts/ArchivoCondensed-Variable.woff2',
  'fonts/GTAmericaArabic-Regular.woff2', 'fonts/GTAmericaArabic-Bold.woff2', 'fonts/GTAmericaArabic-Black.woff2',
  'fonts/SpaceMono-Regular.woff2', 'fonts/SpaceMono-Bold.woff2',
  'fonts/CourierPrime-Regular.woff2', 'fonts/CourierPrime-Bold.woff2', 'fonts/Yellowtail-Regular.woff2',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'
];

/* the files of the named bundles (routes.js), each once, in order */
function bundleFiles(names) {
  var out = [], seen = {};
  names.forEach(function (n) {
    if (!Object.prototype.hasOwnProperty.call(self.B68Load.BUNDLES, n)) return;
    self.B68Load.BUNDLES[n].forEach(function (f) { if (!seen[f]) { seen[f] = true; out.push(f); } });
  });
  return out;
}

/* INSTALL: what install precaches, every device: the page, the fonts and the core, table and figures bundles (checks/runtime/
   pwa.test.mjs: no file of the gm or display bundles is in it). SHELL: the whole app, every file of every bundle, all of
   which are served from the cache once it holds them; the gm and display bundles get there by the page's message, or by
   being used once (checks/runtime/pwa.test.mjs: index.html's references and every bundle are in it, and every file exists) */
var INSTALL = STATIC.concat(bundleFiles(['core', 'table', 'figures']));   /* the figure kit last: the required files are fetched before it */
var SHELL = STATIC.concat(self.B68Load.files());
var REQUIRED = ['./'].concat(bundleFiles(['core', 'table']));   /* an install without all of these fails (boot.js is in the core) */

var scopeUrl = new URL(self.registration ? self.registration.scope : './', self.location.href);
var INDEX = new URL('./', scopeUrl).href;
var MARK = new URL('__b68-activated', scopeUrl).href;      /* in each cache: when its worker took over (activate keeps the newest older cache) */

function pathKey(path) { return path === './' ? INDEX : new URL(path, scopeUrl).href; }
var SHELL_KEYS = {};
SHELL.forEach(function (p) { SHELL_KEYS[pathKey(p)] = true; });

function noop() {}
function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function cacheable(res) { return !!res && res.status === 200 && res.type === 'basic' && !res.redirected; }

/* the cache key: the page itself is stored under the scope URL whichever way it was asked for (/, /index.html, /?x);
   any other file under its path alone, so a versioned request (boot.js?v=…) finds the precached copy */
function keyFor(req) {
  var u = new URL(req.url), p = u.origin + u.pathname;
  return p === INDEX || p === INDEX + 'index.html' ? INDEX : p;
}

/* ---------- what the server is running ---------- */
var serverBuild = null;          /* the last build seen on the server (the page's X-B68-Build, or the probe), null: not known */
var lastUpdate = 0;
function moved() { return serverBuild !== null && serverBuild !== BUILD; }
/* a newer build on the server: ask the browser to look for its worker now (a failed install is retried by the next call) */
function noteServer(build) {
  if (!build) return;
  serverBuild = build;
  if (build !== BUILD && self.registration && typeof self.registration.update === 'function' && Date.now() - lastUpdate > 30000) {
    lastUpdate = Date.now();
    try { var p = self.registration.update(); if (p && p.catch) p.catch(noop); } catch (e) {}
  }
}
/* the build the server runs right now, from routes.js (a static file: costs the Worker nothing); null when it cannot be told
   (offline, signed out, a redirect) */
function probe() {
  return fetch(new Request(new URL('routes.js', scopeUrl).href, { credentials: 'same-origin', cache: 'no-store' }))
    .then(function (res) { return cacheable(res) ? res.text() : null; })
    .then(function (text) {
      var m = text && /^\s*var BUILD = '([^']*)';/m.exec(text);
      if (!m) return null;
      noteServer(m[1]);
      return m[1];
    })
    .catch(function () { return null; });
}

/* ---------- filing answers: the one door into the cache ---------- */
/* fetchAll([{ key, url }]): each from the network (revalidated, never the browser's stale copy), LANES at a time, bodies read
   into memory at once (a stalled unread stream would hold a connection the probe needs). Only good answers come back: 200,
   same origin, not redirected. A failure is skipped. */
function fetchAll(items) {
  var got = [], i = 0;
  function lane() {
    if (i >= items.length) return Promise.resolve();
    var it = items[i++];
    return fetch(new Request(it.url, { credentials: 'same-origin', cache: 'no-cache' })).then(function (res) {
      if (!cacheable(res)) return null;
      return res.arrayBuffer().then(function (buf) { got.push({ key: it.key, res: new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers }) }); });
    }).catch(noop).then(lane);
  }
  var lanes = [];
  for (var n = 0; n < Math.min(LANES, items.length); n++) lanes.push(lane());
  return Promise.all(lanes).then(function () { return got; });
}

var learned = [];                /* [{ key, res }]: answers from the network waiting for a probe */
var flushP = null;
/* write the waiting answers to this build's cache, but only when a probe made now, after they all arrived, names this build */
function flush() {
  var batch = learned; learned = [];
  if (!batch.length) return Promise.resolve();
  return probe().then(function (build) {
    if (build !== BUILD) return;                       /* another build, or not known: file nothing */
    return caches.open(CACHE).then(function (cache) {
      return Promise.all(batch.map(function (e) { return cache.put(e.key, e.res).catch(noop); }));
    });
  }).catch(noop);
}
function flushSoon(event) {
  if (!flushP) flushP = delay(FLUSH_MS).then(function () { flushP = null; return flush(); });
  event.waitUntil(flushP);
}
function learn(event, key, res) {
  if (moved() || !cacheable(res)) return;
  learned.push({ key: key, res: res.clone() });
  flushSoon(event);
}

/* stale-while-revalidate: the keys served from the cache since the last round, fetched again after the first paint */
var refreshSet = {}, roundP = null;
function refreshLater(event, key, url) {
  refreshSet[key] = url;
  if (!roundP) roundP = delay(REFRESH_MS).then(function () { roundP = null; return runRound(); });
  event.waitUntil(roundP);
}
function runRound() {
  var set = refreshSet; refreshSet = {};
  if (moved()) return Promise.resolve();
  var items = Object.keys(set).map(function (k) { return { key: k, url: set[k] }; });
  if (!items.length) return Promise.resolve();
  return fetchAll(items).then(function (got) { got.forEach(function (e) { learned.push(e); }); return flush(); }).catch(noop);
}

/* ---------- install, activate, message ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    fetchAll(INSTALL.map(function (p) { return { key: pathKey(p), url: pathKey(p) }; })).then(function (got) {
      return probe().then(function (b) { return b || probe(); }).then(function (build) {
        /* the server moved on while this worker was installing: its files are not this build's. Fail the install: the
           worker that is running keeps serving, and the next update check finds the newer worker */
        if (build && build !== BUILD) throw new Error('the server runs build ' + build + ', this worker is ' + BUILD);
        if (build !== BUILD) throw new Error('could not tell which build the server runs (offline, signed out)');
        /* the required set: the page, boot.js, the core and the table. Without all of it this worker is not ready to take over,
           so the install fails (no skipWaiting): the running worker and its complete cache stay in charge, and the next update
           check tries again. Fonts, the manifest and the icons are optional */
        var have = {};
        got.forEach(function (e) { have[e.key] = true; });
        var missing = REQUIRED.filter(function (p) { return !have[pathKey(p)]; });
        if (missing.length) throw new Error('install is missing ' + missing.length + ' required file(s), first: ' + missing[0]);
        return caches.open(CACHE).then(function (cache) {
          return Promise.all(got.map(function (e) { return cache.put(e.key, e.res); }));
        });
      });
    }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  /* keep the newest older cache (a page still open on the previous build asks for its files by ?v=), drop the rest */
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.put(MARK, new Response(String(Date.now()))).catch(noop);
  }).then(function () { return caches.keys(); }).then(function (keys) {
    var older = keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; });
    return Promise.all(older.map(function (k) {
      return caches.open(k).then(function (c) { return c.match(MARK); }).then(function (r) { return r ? r.text() : '0'; })
        .catch(function () { return '0'; }).then(function (t) { return { k: k, t: Number(t) || 0 }; });
    })).then(function (list) {
      list.sort(function (a, b) { return b.t - a.t; });
      return Promise.all(list.slice(1).map(function (e) { return caches.delete(e.k); }));
    });
  }).then(function () { return self.clients.claim(); }));
});

/* { precache: ['gm', 'display'] }: the page (cf.js, when /api/me says GM) asks for these bundles. Only the files the cache
   does not hold are fetched, and they are filed like any other answer */
self.addEventListener('message', function (event) {
  var d = event.data;
  if (!d || !Array.isArray(d.precache) || moved()) return;
  var files = bundleFiles(d.precache.filter(function (n) { return typeof n === 'string'; }));
  if (!files.length) return;
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    var keys = files.map(pathKey);
    return Promise.all(keys.map(function (k) { return cache.match(k); })).then(function (hits) {
      var items = [];
      keys.forEach(function (k, i) { if (!hits[i]) items.push({ key: k, url: k }); });
      if (!items.length) return;
      return fetchAll(items).then(function (got) { got.forEach(function (e) { learned.push(e); }); return flush(); });
    });
  }).catch(noop));
});

/* ---------- fetch ---------- */
/* The pages (clients) that were answered from this build's cache. Their files come from it too, even once the worker has seen
   a newer build on the server: a slow link serves the cached page, and a cached page must get the cached core, never the new
   build's scripts. In memory only; a client id this worker does not know is treated as a page of the newer build. */
var cachedClients = [];
function markClient(id) {
  if (!id || cachedClients.indexOf(id) >= 0) return;
  cachedClients.push(id);
  if (cachedClients.length > 64) cachedClients.shift();
}

/* the page. Network first; the answer names the server's build */
function navigate(event, req, key) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      var fromCache = function (page) { markClient(event.resultingClientId); return page; };
      var fromNet = fetch(req).then(function (res) {
        if (!cacheable(res)) return res;               /* a redirect (Access asking to sign in), an error: to the page as it is */
        var b = res.headers && typeof res.headers.get === 'function' ? res.headers.get('X-B68-Build') : null;
        noteServer(b);
        if (b === BUILD) { event.waitUntil(cache.put(key, res.clone()).catch(noop)); return res; }
        if (b) return res;                             /* a newer build's page: served, never filed in this build's cache */
        return hit ? fromCache(hit) : res;             /* no build named, so no way to tell: the cached page if there is one */
      });
      var fallback = function (err) { return hit ? fromCache(hit) : cache.match(INDEX).then(function (page) { if (page) return fromCache(page); throw err; }); };
      if (!hit) return fromNet.catch(fallback);
      /* a cached page: the network answers unless it fails (then the cache does, at once) or is slow (then the cache answers
         at the limit and the late answer, when it is this build's, still refreshes the cache for next time) */
      var timer = null;
      var late = new Promise(function (resolve) { timer = setTimeout(function () { resolve(fromCache(hit)); }, NAV_MS); });
      var net = fromNet.then(function (res) { clearTimeout(timer); return res; }, function () { clearTimeout(timer); return fromCache(hit); });
      event.waitUntil(net);
      return Promise.race([net, late]);
    });
  });
}

/* a file asked for with ?v=<another build>: that build's cache answers when there is one, else the network. Never written */
function otherBuild(req, v, key) {
  return caches.has(PREFIX + v).then(function (has) {
    if (!has) return fetch(req);
    return caches.open(PREFIX + v).then(function (c) { return c.match(key); }).then(function (hit) { return hit || fetch(req); });
  });
}

function asset(event, req, url, key) {
  var v = url.searchParams.get('v');
  if (v !== null && v !== BUILD) return otherBuild(req, v, key);
  return caches.open(CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      var shell = !!SHELL_KEYS[key];
      /* the app's own files: the cache answers at once, a later round makes sure it is current */
      if (shell && hit && (!moved() || v === BUILD || cachedClients.indexOf(event.clientId) >= 0)) {
        if (!moved()) refreshLater(event, key, req.url);
        return hit;
      }
      var fromNet = fetch(req).then(function (res) { learn(event, key, res); return res; });   /* whatever the network said, redirects included */
      if (!hit) return fromNet;                        /* nothing cached: the network, however long it takes */
      if (moved() || shell) return fromNet.catch(function () { return hit; });
      /* a cached copy of a file outside the shell: network first, the cache when it fails or is slow */
      var timer = null;
      var late = new Promise(function (resolve) { timer = setTimeout(function () { resolve(hit); }, ASSET_MS); });
      var net = fromNet.then(function (res) { clearTimeout(timer); return res; }, function () { clearTimeout(timer); return hit; });
      event.waitUntil(net);
      return Promise.race([net, late]);
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/cdn-cgi/') === 0) return;
  /* media (the theme) goes straight to the network: Safari plays audio through range requests, which a worker in the way can break */
  if (url.pathname.indexOf('/media/') === 0) return;
  var key = keyFor(req);
  event.respondWith(req.mode === 'navigate' ? navigate(event, req, key) : asset(event, req, url, key));
});
