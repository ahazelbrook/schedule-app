/* Service worker for the hosted build (registered by runtime/cf.js; never inside the claude.ai artifact).
   Network first for every same-origin GET outside /api/ and /cdn-cgi/, so an online page always runs the latest
   code; a successful answer (200, same-origin, not redirected) refreshes the cache. When the cache holds the file and
   the network has not answered within a few seconds (a navigation 4 s, anything else 8 s: a venue's wifi that is up but
   dead, a stalled stream), the cached copy answers and the network's answer, when it comes, refreshes the cache in the
   background. When the network fails outright the cached copy answers at once (a navigation falls back to the cached
   page). A redirect is the network answering (Cloudflare Access asking to sign in) and goes to the page as it is, never
   a cached page. /api/*, /cdn-cgi/*, /media/* and other origins are not touched at all: the data layer (cf.js) keeps its
   own offline copy. */
'use strict';

/* routes.js: the build stamp (B68_BUILD, stamped by scripts/deploy.sh) and the route bundles. A new build is a new cache
   name, so the next activation drops the old one; a deploy also changes this import's bytes, which is what makes the
   browser install the new worker (cf.js registers with updateViaCache 'none' so the import is fetched fresh). */
try { importScripts('routes.js'); } catch (e) {}
var BUILD = typeof self.B68_BUILD === 'string' && self.B68_BUILD ? self.B68_BUILD : 'dev';
var CACHE = 'b68-shell-' + BUILD;
var PREFIX = 'b68-shell-';
var NAV_MS = 4000;               /* a navigation with a cached page: how long the network may take before the cache answers */
var ASSET_MS = 8000;             /* the same for a script, stylesheet, font or icon the cache holds */

/* the app shell: the page and everything index.html loads (CORE; checks/runtime/pwa.test.mjs keeps it in step), plus every
   file of every route bundle (routes.js), so install still precaches the whole app in the background and every route
   works offline while nothing but the core blocks the first paint */
var CORE = [
  './',
  'tracker.css', 'campaign.css', 'schedule.css', 'rules.css', 'cast.css',
  'fonts/ArchivoCompressed-Black.woff2', 'fonts/ArchivoCondensed-Variable.woff2',
  'fonts/GTAmericaArabic-Regular.woff2', 'fonts/GTAmericaArabic-Bold.woff2', 'fonts/GTAmericaArabic-Black.woff2',
  'fonts/SpaceMono-Regular.woff2', 'fonts/SpaceMono-Bold.woff2',
  'fonts/CourierPrime-Regular.woff2', 'fonts/CourierPrime-Bold.woff2', 'fonts/Yellowtail-Regular.woff2',
  'figures/figure-kit.js', 'figures/cast.js',
  'content.js', 'core.js', 'zoom.js', 'steps.js', 'tracker.js', 'schedule.js', 'markdown.js', 'rules.js', 'cast-page.js', 'name-edit.js',
  'runtime/cf.js', 'routes.js', 'boot.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'
];
var SHELL = CORE.slice();
((self.B68Load && typeof self.B68Load.files === 'function') ? self.B68Load.files() : []).forEach(function (f) { if (SHELL.indexOf(f) < 0) SHELL.push(f); });

var scopeUrl = new URL(self.registration ? self.registration.scope : './', self.location.href);
var INDEX = new URL('./', scopeUrl).href;

function cacheable(res) { return !!res && res.status === 200 && res.type === 'basic' && !res.redirected; }

/* the cache key: the page itself is stored under the scope URL whichever way it was asked for (/, /index.html, /?x);
   any other file under its path alone, so a versioned request (boot.js?v=…) finds the precached copy */
function keyFor(req) {
  var u = new URL(req.url), p = u.origin + u.pathname;
  return p === INDEX || p === INDEX + 'index.html' ? INDEX : p;
}

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    /* one by one, so a file that fails (offline, signed out) does not stop the install */
    return Promise.all(SHELL.map(function (path) {
      var url = new URL(path, scopeUrl).href;
      return fetch(new Request(url, { credentials: 'same-origin', cache: 'no-cache' })).then(function (res) {
        if (cacheable(res)) return cache.put(path === './' ? INDEX : url, res);
      }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/cdn-cgi/') === 0) return;
  /* media (the theme) goes straight to the network: Safari plays audio through range requests, which a worker in the way can break */
  if (url.pathname.indexOf('/media/') === 0) return;
  var key = keyFor(req), limit = req.mode === 'navigate' ? NAV_MS : ASSET_MS;
  event.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      var fromNet = fetch(req).then(function (res) {
        if (cacheable(res)) {
          var copy = res.clone();
          event.waitUntil(cache.put(key, copy).catch(function () {}));
        }
        return res;                               /* whatever the network said, redirects included */
      });
      if (!hit) {
        /* nothing cached: the network, however long it takes; when it fails, a navigation gets the cached page */
        return fromNet.catch(function (err) {
          if (req.mode === 'navigate') return cache.match(INDEX).then(function (page) { if (page) return page; throw err; });
          throw err;
        });
      }
      /* a cached copy: the network answers unless it fails (then the cache does, at once) or is slow (then the cache
         answers at the limit and the late answer still refreshes the cache for next time) */
      var timer = null;
      var late = new Promise(function (resolve) { timer = setTimeout(function () { resolve(hit); }, limit); });
      var net = fromNet.then(function (res) { clearTimeout(timer); return res; }, function () { clearTimeout(timer); return hit; });
      event.waitUntil(net);
      return Promise.race([net, late]);
    });
  }));
});
