// Static and unit checks for the installable hosted build: the manifest, the icons, the service worker's
// precache list against index.html, and app/sw.js's fetch rules run against a fake worker scope.
//   node checks/runtime/pwa.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || 'not equal') + ': got ' + A + ' want ' + B); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
const pngSize = (file) => { const b = fs.readFileSync(file); ok(b.slice(1, 4).toString() === 'PNG', file + ' is not a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

await test('manifest: valid JSON with the install fields, and every icon exists at its declared size', async () => {
  const m = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
  eq([m.name, m.short_name, m.start_url, m.scope, m.display], ["Blades '68", "Blades '68", './', './', 'standalone']);
  const css = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const tok = (n) => (css.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];
  eq([m.background_color, m.theme_color], [tok('paper'), tok('ink')], 'colours = the light theme paper and ink');
  const purposes = m.icons.map((i) => i.sizes + ' ' + i.type + ' ' + (i.purpose || 'any'));
  for (const want of ['192x192 image/png any', '512x512 image/png any', '512x512 image/png maskable', 'any image/svg+xml any']) ok(purposes.includes(want), 'missing icon ' + want + ' in ' + purposes);
  for (const i of m.icons) {
    const f = path.join(APP, i.src); ok(fs.existsSync(f), 'missing ' + i.src);
    if (i.type === 'image/png') eq(pngSize(f).join('x'), i.sizes, i.src);
    else ok(/^<svg[^>]+viewBox="0 0 512 512"/.test(fs.readFileSync(f, 'utf8')), i.src + ' is not a square SVG');
  }
  eq(pngSize(path.join(APP, 'icons', 'apple-touch-icon.png')), [180, 180], 'apple-touch-icon');
});

/* ---------- sw.js in a fake ServiceWorkerGlobalScope ---------- */
const SW = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
const ORIGIN = 'https://b68.test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function worker(opts = {}) {
  /* net.slow[url]: that fetch answers only when the test resolves net.pending[url] (a stalled connection) */
  const handlers = {}, store = {}, net = { down: false, answers: {}, log: [], slow: {}, pending: {} };
  const caches = {
    _stores: store,
    open: async (name) => {
      const c = store[name] = store[name] || new Map();
      const k = (r) => (typeof r === 'string' ? r : r.url);
      return { put: async (r, res) => { c.set(k(r), res); }, match: async (r) => c.get(k(r)), keys: async () => [...c.keys()] };
    },
    keys: async () => Object.keys(store),
    delete: async (n) => delete store[n],
  };
  const res = (status, extra = {}) => ({ status, type: 'basic', redirected: false, ok: status >= 200 && status < 300, ...extra, clone() { return this; } });
  async function fetch(req) {
    const url = typeof req === 'string' ? req : req.url;
    net.log.push(url);
    if (net.down) throw new TypeError('Failed to fetch');
    if (net.slow[url]) return new Promise((resolve, reject) => { net.pending[url] = { resolve, reject }; });
    return net.answers[url] || res(200, { body: 'net:' + url });
  }
  class Request { constructor(url, init = {}) { this.url = url; this.method = 'GET'; this.mode = 'cors'; Object.assign(this, init); } }
  const self = {
    location: { href: ORIGIN + '/sw.js', origin: ORIGIN },
    registration: { scope: ORIGIN + '/' },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: async () => { self.skipped = true; },
    clients: { claim: async () => { self.claimed = true; } },
  };
  /* the worker's clock: its setTimeout calls are recorded and fired by the test (tick), never by time passing */
  const timers = [];
  const ctx = { self, caches, fetch, Request, URL, Promise, console,
    setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
    /* importScripts('routes.js'): the real file (or opts.routes, the source to use instead; null: the import fails), run in
       this scope (self.B68_BUILD, self.B68Load) */
    importScripts: (...names) => {
      for (const n of names) {
        if (n === 'routes.js' && opts.routes === null) throw new Error('NetworkError: routes.js could not be fetched');
        vm.runInContext(n === 'routes.js' && opts.routes ? opts.routes : fs.readFileSync(path.join(APP, n), 'utf8'), ctx, { filename: n });
      }
    } };
  const tick = () => { timers.forEach((t) => { if (!t.done) { t.done = true; t.fn(); } }); };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx, { filename: 'sw.js' });
  /* during(): the test's hand on the clock and the network while the event is in flight */
  async function dispatch(type, extra = {}, during) {
    let waits = [], responded = null;
    const ev = { ...extra, waitUntil: (p) => waits.push(p), respondWith: (p) => { responded = p; } };
    handlers[type](ev);
    if (during) await during();
    const r = responded ? await responded.then((x) => ({ ok: true, res: x }), (e) => ({ ok: false, err: e })) : null;
    await Promise.all(waits.map((p) => Promise.resolve(p).catch(() => {})));
    return { responded: !!responded, r };
  }
  const get = (p, mode = 'no-cors', during) => dispatch('fetch', { request: new Request(p.startsWith('http') ? p : ORIGIN + p, { mode }) }, during);
  return { self, caches, net, res, dispatch, get, timers, tick, SHELL: ctx.SHELL || vm.runInContext('SHELL', ctx), CACHE: vm.runInContext('CACHE', ctx) };
}

/* ---------- routes.js (B68_BUILD, B68Load) ---------- */
const ROUTES = fs.readFileSync(path.join(APP, 'routes.js'), 'utf8');
const STAMP = '2026-10-16-abc1234';
const stamped = (src = ROUTES) => src.replace(/^(\s*var BUILD = )'dev';/m, "$1'" + STAMP + "';");
/* a <head> holding index.html's stylesheet links and its inline <style>; elements added later record their order */
function fakeDoc(links) {
  const head = { children: [] };
  const at = (el) => head.children.indexOf(el);
  const mk = (tag) => {
    const el = { tagName: tag.toUpperCase(), parentNode: null, getAttribute(k) { return this[k] == null ? null : String(this[k]); } };
    Object.defineProperty(el, 'nextSibling', { get() { const i = at(el); return i < 0 ? null : head.children[i + 1] || null; } });
    return el;
  };
  head.appendChild = (el) => { el.parentNode = head; head.children.push(el); return el; };
  head.insertBefore = (el, ref) => { el.parentNode = head; const i = ref ? at(ref) : -1; if (i < 0) head.children.push(el); else head.children.splice(i, 0, el); return el; };
  head.removeChild = (el) => { head.children.splice(at(el), 1); el.parentNode = null; return el; };
  for (const f of links) { const l = mk('link'); l.rel = 'stylesheet'; l.href = f; head.appendChild(l); }
  head.appendChild(mk('style'));
  const doc = { head, createElement: mk, querySelectorAll: (sel) => (sel === 'link[rel="stylesheet"]' ? head.children.filter((e) => e.tagName === 'LINK' && e.rel === 'stylesheet') : []) };
  const name = (e) => (e.tagName === 'STYLE' ? '<style>' : String(e.href || e.src));
  doc.order = () => head.children.map(name);
  doc.added = () => head.children.filter((e) => e.onload);
  doc.settle = (fail = []) => { for (const e of doc.added()) if (!e.settled) { e.settled = true; (fail.some((f) => name(e).startsWith(f)) ? e.onerror : e.onload)(); } };
  return doc;
}
/* routes.js run as the page runs it (a window; with a document when given) */
function routes(src = ROUTES, doc) {
  const ctx = { window: { document: doc } }; vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'routes.js' });
  return ctx.window;
}
const HTML = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
/* index.html's own <link rel=stylesheet> and <script src> tags, in document order */
const htmlTags = () => [...HTML.matchAll(/<link rel="stylesheet" href="([^"]+)">|<script src="([^"]+)"><\/script>/g)].map((m) => m[1] || m[2]);

await test('routes.js: index.html loads exactly the core bundle; every other bundle file is lazy, exists and is a script or a stylesheet; one cascade order for every stylesheet', async () => {
  const W = routes(), L = W.B68Load;
  ok(L && typeof L.need === 'function' && typeof L.files === 'function', 'routes.js defines B68Load');
  eq(W.B68_BUILD, 'dev', "the committed build is 'dev' (scripts/deploy.sh stamps it for the upload)");
  eq(Object.keys(L.BUNDLES), ['core', 'table', 'print', 'gm', 'display'], 'the bundles');
  eq(htmlTags(), L.BUNDLES.core, "index.html's stylesheet and script tags are BUNDLES.core, in order");
  const core = new Set(L.BUNDLES.core);
  for (const [name, list] of Object.entries(L.BUNDLES)) {
    ok(list.length && new Set(list).size === list.length, 'bundle ' + name + ' is a list without repeats');
    for (const f of list) {
      ok(/\.(js|css)$/.test(f) && fs.existsSync(path.join(APP, f)), name + ': ' + f + ' exists and is a script or a stylesheet');
      if (name !== 'core') ok(!core.has(f), name + ': ' + f + ' is in the core too (loaded twice)');
    }
  }
  for (const f of ['gm-page.js', 'gm/console.js', 'display-page.js', 'stt.js', 'maps/map-kit.js', 'campaign.js', 'season.js']) ok(!core.has(f) && !HTML.includes('"' + f + '"'), f + ' is lazy, not in index.html');
  eq(L.BUNDLES.print, L.BUNDLES.table, "#print and #t need the same files (the table's print button calls B68Season)");
  // the scripts ran in this order when index.html loaded them all, and some register with another as they run
  // (crewsheet.js with B68Campaign): every bundle keeps it
  const OLD = ['figures/figure-kit.js', 'figures/cast.js', 'maps/map-kit.js', 'content.js', 'core.js', 'zoom.js', 'steps.js', 'tracker.js', 'schedule.js',
    'campaign.js', 'crews.js', 'crewsheet.js', 'season.js', 'markdown.js', 'rules.js', 'cast-page.js', 'gm/console.js', 'gm/location.js', 'gm/scenes.js',
    'gm/engagement.js', 'gm/npc.js', 'gm/figure-map.js', 'gm/prep.js', 'gm/downtime.js', 'gm-page.js', 'stt.js', 'display-page.js', 'name-edit.js', 'runtime/cf.js', 'boot.js'];
  for (const [name, list] of Object.entries(L.BUNDLES)) {
    const known = list.filter((f) => OLD.includes(f));
    eq(known, [...known].sort((a, b) => OLD.indexOf(a) - OLD.indexOf(b)), 'bundle ' + name + ' keeps the scripts in their index.html order');
  }
  const css = L.files().filter((f) => f.endsWith('.css'));
  eq(css.filter((f) => !L.CSS_ORDER.includes(f)), [], 'a stylesheet with no place in CSS_ORDER');
  eq(L.CSS_ORDER.filter((f) => !css.includes(f)), [], 'CSS_ORDER names a stylesheet no bundle has');
  const coreCss = L.BUNDLES.core.filter((f) => f.endsWith('.css'));
  eq(coreCss, L.CSS_ORDER.filter((f) => coreCss.includes(f)), "index.html's stylesheets follow CSS_ORDER");
});

await test('routes.js: need() adds each file once, scripts in order (async off), stylesheets at their cascade place before the inline style; resolves when all have loaded; the core needs nothing', async () => {
  const doc = fakeDoc(['tracker.css', 'schedule.css', 'rules.css', 'cast.css']);
  const L = routes(ROUTES, doc).B68Load;
  eq(await L.need('core'), 'core', 'the core is already in'); eq(doc.added().length, 0, 'nothing added for the core');
  ok(L.done('core') && !L.done('table'), 'done(): core yes, table not yet');
  let settled = null;
  const p = L.need('table').then((v) => { settled = v; });
  await sleep(1);
  eq(settled, null, 'pending until every file has loaded');
  eq(doc.order(), ['tracker.css', 'campaign.css', 'crewsheet.css', 'schedule.css', 'season.css', 'rules.css', 'cast.css', '<style>', 'campaign.js', 'crews.js', 'crewsheet.js', 'season.js'],
    "stylesheets where index.html had them (before the inline style), scripts after, in the bundle's order");
  ok(doc.added().filter((e) => e.tagName === 'SCRIPT').every((e) => e.async === false), 'scripts run in insertion order (async false)');
  const again = L.need('print');
  doc.settle(); await p;
  eq([settled, await again, L.done('table'), L.done('print')], ['table', 'print', true, true], 'resolved; #print needed nothing more');
  eq(doc.added().length, 7, 'each file added once');
  const gm = L.need('gm');
  eq(doc.order().slice(0, 10), ['tracker.css', 'campaign.css', 'crewsheet.css', 'schedule.css', 'season.css', 'rules.css', 'cast.css', 'gm.css', 'prep.css', '<style>'], 'the GM stylesheets after the cast, still before the inline style');
  eq(doc.order().slice(14), ['maps/map-kit.js', 'gm/console.js', 'gm/location.js', 'gm/scenes.js', 'gm/engagement.js', 'gm/npc.js', 'gm/figure-map.js', 'gm/prep.js', 'gm/downtime.js', 'gm-page.js'], 'gm/*.js before gm-page.js');
  doc.settle(['gm/npc.js']);
  let err = null; try { await gm; } catch (e) { err = e; }
  eq(err && err.message, 'could not load gm/npc.js', 'a file that fails rejects the bundle');
  ok(!doc.order().includes('gm/npc.js') && !L.done('gm'), 'the failed tag is removed; the bundle is not done');
  const retry = L.need('gm');
  eq(doc.order().filter((f) => f === 'gm/npc.js').length + doc.order().filter((f) => f === 'gm-page.js').length, 2, 'a retry adds only the file that failed');
  doc.settle(); eq(await retry, 'gm', 'the retry loads it'); ok(L.done('gm'), 'done');
  let unknown = null; try { await L.need('nope'); } catch (e) { unknown = e.message; }
  eq(unknown, 'unknown bundle: nope', 'an unknown bundle rejects');
  let noDoc = null; try { await routes(ROUTES, undefined).B68Load.need('gm'); } catch (e) { noDoc = e.message; }
  eq(noDoc, 'no document to load gm.css into', 'no document (the service worker): rejects');
});

await test('routes.js: an unstamped build (the repository, the artifact, file://) asks for the plain files; a stamped one adds ?v=<build>', async () => {
  const dev = routes().B68Load;
  eq([dev.url('gm-page.js'), dev.url('gm.css')], ['gm-page.js', 'gm.css'], 'dev: the paths the static tags always used');
  const doc = fakeDoc(['tracker.css']);
  const W = routes(stamped(), doc);
  eq(W.B68_BUILD, STAMP, 'the stamp is B68_BUILD');
  W.B68Load.need('display');
  eq(doc.order(), ['tracker.css', 'display.css?v=' + STAMP, '<style>', 'stt.js?v=' + STAMP, 'display-page.js?v=' + STAMP], 'a stamped build versions every bundle URL');
});

await test('sw: the precache list is the page, the fonts and install files, and every bundle file (the core first); all exist; the cache is named after the build', async () => {
  const w = worker(), L = routes().B68Load;
  const refs = new Set();
  for (const m of HTML.matchAll(/(?:src|href)="([^"#:]+)"/g)) refs.add(m[1]);
  for (const m of HTML.matchAll(/url\("?((?!data:)[^")]+)"?\)/g)) refs.add(m[1]);
  eq([...refs].filter((r) => /^[\w./-]+\.\w+$/.test(r) && !w.SHELL.includes(r)), [], 'in index.html but not in SHELL (app/sw.js)');
  eq(L.files().filter((f) => !w.SHELL.includes(f)), [], 'in a bundle (routes.js) but not in SHELL: that route would not work offline');
  eq(w.SHELL.filter((f) => f.endsWith('.js') || f.endsWith('.css')), L.files(), 'every script and stylesheet SHELL holds comes from routes.js, the core first');
  eq(new Set(w.SHELL).size, w.SHELL.length, 'no file twice');
  for (const f of w.SHELL) if (f !== './') ok(fs.existsSync(path.join(APP, f)), 'SHELL names a missing file: ' + f);
  ok(w.SHELL[0] === './' && w.SHELL.includes('routes.js'), 'the page itself, and routes.js');
  eq(w.CACHE, 'b68-shell-dev', "the cache is named after routes.js B68_BUILD ('dev' in the repository)");
  eq(worker({ routes: stamped() }).CACHE, 'b68-shell-' + STAMP, 'a stamped build is a new cache (the next activation drops the old one)');
  let threw = null; try { worker({ routes: null }); } catch (e) { threw = e.message; }
  ok(/routes\.js could not be fetched/.test(threw || ''), 'a worker that cannot import routes.js fails to install (the previous one keeps serving): ' + threw);
});

await test('sw: install precaches the shell (page under the scope URL), skips waiting; activate drops old caches and claims', async () => {
  const w = worker();
  w.net.answers[ORIGIN + '/boot.js'] = w.res(200, { redirected: true });       // e.g. Access: never cached
  w.net.answers[ORIGIN + '/core.js'] = w.res(404);
  await w.dispatch('install');
  const c = w.caches._stores[w.CACHE];
  ok(c.has(ORIGIN + '/'), 'page cached under /');
  ok(c.has(ORIGIN + '/fonts/SpaceMono-Bold.woff2') && c.has(ORIGIN + '/runtime/cf.js'), 'shell cached');
  ok(!c.has(ORIGIN + '/boot.js') && !c.has(ORIGIN + '/core.js'), 'a redirected or failed answer was cached');
  ok(w.self.skipped, 'skipWaiting');
  w.caches._stores['b68-shell-v0'] = new Map(); w.caches._stores['other-app'] = new Map();
  await w.dispatch('activate');
  eq(Object.keys(w.caches._stores).sort(), [w.CACHE, 'other-app'].sort(), 'old b68 caches deleted, others kept');
  ok(w.self.claimed, 'clients.claim');
  // an install with no network still installs
  const off = worker(); off.net.down = true; await off.dispatch('install'); ok(off.self.skipped, 'offline install');
});

await test('sw: /api/, /cdn-cgi/, other origins and non-GET are not intercepted', async () => {
  const w = worker();
  for (const p of ['/api/me', '/api/characters?since=x', '/cdn-cgi/access/logout', 'https://cdn.example/x.js']) eq((await w.get(p)).responded, false, p);
  eq((await w.dispatch('fetch', { request: { url: ORIGIN + '/boot.js', method: 'POST', mode: 'cors' } })).responded, false, 'POST');
  eq(Object.keys(w.caches._stores), [], 'nothing cached');
});

await test('sw: network first (fresh answers win and refresh the cache); offline falls back; a redirect passes through', async () => {
  const w = worker();
  let { r } = await w.get('/boot.js');
  eq([r.ok, r.res.body], [true, 'net:' + ORIGIN + '/boot.js'], 'from the network');
  w.net.answers[ORIGIN + '/boot.js'] = w.res(200, { body: 'v2' });
  r = (await w.get('/boot.js')).r; eq(r.res.body, 'v2', 'online: always the network');
  // navigations: /, /index.html and /?q all store and read the page under /
  w.net.answers[ORIGIN + '/?x=1'] = w.res(200, { body: 'page' });
  await w.get('/?x=1', 'navigate');
  w.net.down = true;
  eq((await w.get('/boot.js')).r.res.body, 'v2', 'offline: the cached copy');
  eq((await w.get('/', 'navigate')).r.res.body, 'page', 'offline navigation: the cached page');
  eq((await w.get('/some/where', 'navigate')).r.res.body, 'page', 'an uncached navigation falls back to the page');
  const miss = (await w.get('/never.js')).r; eq([miss.ok, miss.err && miss.err.name], [false, 'TypeError'], 'uncached file offline: the network error');
  // back online, Access redirects: the redirect goes to the page, never the cached copy, and is not stored
  w.net.down = false;
  const redirect = w.res(0, { type: 'opaqueredirect', ok: false });
  w.net.answers[ORIGIN + '/'] = redirect;
  eq((await w.get('/', 'navigate')).r.res === redirect, true, 'redirect passed through');
  w.net.answers[ORIGIN + '/boot.js'] = w.res(200, { redirected: true, body: 'login' });
  eq((await w.get('/boot.js')).r.res.body, 'login', 'followed redirect passed through');
  w.net.down = true;
  eq((await w.get('/', 'navigate')).r.res.body, 'page', 'the redirect did not replace the cached page');
  eq((await w.get('/boot.js')).r.res.body, 'v2', 'nor the cached file');
  // errors are not cached either
  w.net.down = false; w.net.answers[ORIGIN + '/core.js'] = w.res(500);
  await w.get('/core.js'); w.net.down = true;
  eq((await w.get('/core.js')).r.ok, false, 'a 500 was cached');
  // a versioned request (boot.js?v=<build>) finds the copy stored under the path alone
  eq((await w.get('/boot.js?v=2026-10-16-1')).r.res.body, 'v2', 'the query string is not part of the cache key');
  w.net.down = false; w.net.answers[ORIGIN + '/boot.js?v=2026-10-16-1'] = w.res(200, { body: 'v4' });
  await w.get('/boot.js?v=2026-10-16-1'); w.net.down = true;
  eq((await w.get('/boot.js')).r.res.body, 'v4', 'and a versioned answer is stored under the path alone');
});

await test('sw: a slow network (up but dead) with a cached copy: the cache answers at the limit (4 s page, 8 s files) and the late answer still refreshes the cache; a fast network wins; without a cached copy the network is waited for', async () => {
  const w = worker();
  const BOOT = ORIGIN + '/boot.js', PAGE = ORIGIN + '/';
  await w.get('/boot.js');                                                   // cached as net:…/boot.js
  w.net.answers[PAGE] = w.res(200, { body: 'page' }); await w.get('/', 'navigate');
  const pending = async () => { await sleep(10); return w.timers.filter((t) => !t.done).map((t) => t.ms); };
  // a file: the 8 s limit passes, the cached copy answers, the network's late answer refreshes the cache
  w.net.slow[BOOT] = true;
  let r = await w.get('/boot.js', 'no-cors', async () => {
    eq(await pending(), [8000], 'an 8 s limit for a file the cache holds');
    w.tick(); await sleep(10);
    w.net.pending[BOOT].resolve(w.res(200, { body: 'late' }));
  });
  eq(r.r.res.body, 'net:' + BOOT, 'the cached copy answered when the network was slow');
  eq(w.caches._stores[w.CACHE].get(BOOT).body, 'late', 'the late answer refreshed the cache');
  eq((await w.get('/boot.js', 'no-cors', async () => { await sleep(10); w.net.pending[BOOT].resolve(w.res(200, { body: 'later' })); })).r.res.body, 'later', 'a network answer before the limit wins');
  // the page: 4 s
  w.net.slow[PAGE] = true;
  r = await w.get('/', 'navigate', async () => {
    eq(await pending(), [4000], 'a 4 s limit for a navigation the cache holds');
    w.tick(); await sleep(10);
    w.net.pending[PAGE].reject(new TypeError('Failed to fetch'));                // and then it fails: the cached page already answered
  });
  eq(r.r.res.body, 'page', 'the cached page answered the slow navigation');
  // a fast network: the timer is cleared, the network answer is served
  delete w.net.slow[BOOT]; w.net.answers[BOOT] = w.res(200, { body: 'v3' });
  const before = w.timers.length;
  r = await w.get('/boot.js');
  eq([r.r.res.body, w.timers.slice(before).every((t) => t.done)], ['v3', true], 'fast network: served, the timer cleared');
  // a failing network with a cached copy: the cache answers at once, no waiting for the limit
  w.net.down = true;
  eq((await w.get('/boot.js')).r.res.body, 'v3', 'offline: the cached copy at once');
  w.net.down = false;
  // nothing cached: no limit, the network is waited for however long it takes
  const NEW = ORIGIN + '/new.js'; w.net.slow[NEW] = true;
  const t0 = w.timers.length;
  r = await w.get('/new.js', 'no-cors', async () => { await sleep(10); eq(w.timers.length, t0, 'no timer without a cached copy'); w.net.pending[NEW].resolve(w.res(200, { body: 'eventually' })); });
  eq(r.r.res.body, 'eventually', 'uncached: the network answer, late as it was');
});

/* ---------- cf.js wires the install bits only on the hosted build ---------- */
await test('cf.js: injects the manifest (with credentials), theme colour, icons, home-screen metas and registers sw.js; nothing when inert', async () => {
  const SRC = fs.readFileSync(path.join(APP, 'runtime', 'cf.js'), 'utf8');
  function page({ preset, protocol = 'https:' } = {}) {
    const added = [], regs = [];
    const el = (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
    const head = { appendChild: (n) => added.push(n), querySelector: (sel) => added.find((n) => { const m = sel.match(/^(\w+)\[(\w+)="([^"]+)"\]$/); return m && n.tag === m[1] && n.attrs[m[2]] === m[3]; }) || null };
    const document = { head, readyState: 'complete', addEventListener() {}, createElement: el, body: {} };
    const win = { document, setTimeout, clearTimeout, console, location: { protocol, pathname: '/' }, fetch: async () => { throw new TypeError('offline'); },
      navigator: { serviceWorker: { register: (u, o) => { regs.push([u, o]); return Promise.resolve(); } } }, addEventListener() {} };
    win.window = win; if (preset) win.claude = preset;
    vm.createContext(win); vm.runInContext(SRC, win);
    return { added, regs };
  }
  const p = page();
  const by = (tag, k, v) => p.added.find((n) => n.tag === tag && n.attrs[k] === v);
  eq(by('link', 'rel', 'manifest').attrs, { rel: 'manifest', href: 'manifest.webmanifest', crossorigin: 'use-credentials' }, 'manifest link');
  eq(by('meta', 'name', 'theme-color').attrs.content, '#14110e', 'theme colour');
  eq(by('link', 'rel', 'apple-touch-icon').attrs.href, 'icons/apple-touch-icon.png', 'apple-touch-icon');
  eq([by('meta', 'name', 'apple-mobile-web-app-capable').attrs.content, by('meta', 'name', 'apple-mobile-web-app-title').attrs.content], ['yes', "Blades '68"]);
  eq(p.regs, [['sw.js', { scope: './', updateViaCache: 'none' }]], 'service worker registration (updateViaCache none: sw.js imports routes.js, which must be fetched fresh on an update check)');
  for (const opts of [{ preset: { use() {} } }, { protocol: 'file:' }]) {
    const q = page(opts); eq([q.added.length, q.regs.length], [0, 0], 'inert: ' + JSON.stringify(opts));
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
