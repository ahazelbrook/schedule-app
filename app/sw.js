/* Service worker for the hosted build (registered by runtime/cf.js; never inside the claude.ai artifact).
   Network first for every same-origin GET outside /api/ and /cdn-cgi/, so an online page always runs the latest
   code; a successful answer (200, same-origin, not redirected) refreshes the cache, and only when the network
   fails outright does the cached copy answer (a navigation falls back to the cached page). A redirect is the
   network answering (Cloudflare Access asking to sign in) and goes to the page as it is, never a cached page.
   /api/*, /cdn-cgi/* and other origins are not touched at all: the data layer (cf.js) keeps its own offline copy. */
'use strict';

var CACHE = 'b68-shell-v2';     /* bump to drop every cached file on the next activation */
var PREFIX = 'b68-shell-';

/* the app shell: the page and everything index.html loads (checks/runtime/pwa.test.mjs keeps this in step with it) */
var SHELL = [
  './',
  'tracker.css', 'campaign.css', 'crewsheet.css', 'schedule.css', 'season.css', 'rules.css',
  'fonts/ArchivoCompressed-Black.woff2', 'fonts/ArchivoCondensed-Variable.woff2',
  'fonts/GTAmericaArabic-Regular.woff2', 'fonts/GTAmericaArabic-Bold.woff2', 'fonts/GTAmericaArabic-Black.woff2',
  'fonts/SpaceMono-Regular.woff2', 'fonts/SpaceMono-Bold.woff2',
  'figures/figure-kit.js', 'figures/cast.js',
  'content.js', 'core.js', 'zoom.js', 'steps.js', 'tracker.js', 'campaign.js', 'schedule.js', 'crews.js', 'crewsheet.js', 'season.js', 'markdown.js', 'rules.js',
  'runtime/cf.js', 'boot.js',
  'cast.css', 'cast-page.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'
];

var scopeUrl = new URL(self.registration ? self.registration.scope : './', self.location.href);
var INDEX = new URL('./', scopeUrl).href;

function cacheable(res) { return !!res && res.status === 200 && res.type === 'basic' && !res.redirected; }

/* the page itself is stored under the scope URL whichever way it was asked for (/, /index.html, /?x) */
function keyFor(req) {
  var u = new URL(req.url), p = u.origin + u.pathname;
  return p === INDEX || p === INDEX + 'index.html' ? INDEX : req;
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
  var key = keyFor(req);
  event.respondWith(fetch(req).then(function (res) {
    if (cacheable(res)) {
      var copy = res.clone();
      event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.put(key, copy); }).catch(function () {}));
    }
    return res;                                   /* whatever the network said, redirects included */
  }, function (err) {
    return caches.open(CACHE).then(function (cache) {
      return cache.match(key).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match(INDEX);
        return undefined;
      });
    }).then(function (hit) { if (hit) return hit; throw err; });
  }));
});
