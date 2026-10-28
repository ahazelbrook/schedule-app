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
const ROUTES = fs.readFileSync(path.join(APP, 'routes.js'), 'utf8');
const STAMP = '2026-10-16-abc1234';
const stamped = (src = ROUTES, build = STAMP) => src.replace(/^(\s*var BUILD = )'dev';/m, "$1'" + build + "';");

class FakeHeaders {
  constructor(init) { this.m = new Map(); if (init instanceof FakeHeaders) init.m.forEach((v, k) => this.m.set(k, v)); else for (const [k, v] of Object.entries(init || {})) this.m.set(k.toLowerCase(), v); }
  get(k) { return this.m.has(k.toLowerCase()) ? this.m.get(k.toLowerCase()) : null; }
}
/* a Response: body is whatever the test wants to read back ('A:/boot.js'); arrayBuffer() hands it over untouched */
class FakeResponse {
  constructor(body, init = {}) {
    this.body = body; this.status = init.status === undefined ? 200 : init.status; this.statusText = init.statusText || '';
    this.headers = new FakeHeaders(init.headers); this.type = init.type || 'basic'; this.redirected = !!init.redirected;
    this.ok = this.status >= 200 && this.status < 300;
  }
  clone() { return new FakeResponse(this.body, { status: this.status, headers: this.headers, type: this.type, redirected: this.redirected }); }
  async text() { return String(this.body); }
  async arrayBuffer() { return this.body; }
}
const isPage = (url) => url === ORIGIN + '/' || url === ORIGIN + '/index.html' || url.startsWith(ORIGIN + '/?');

/* world(): one browser's storage and one server, shared by every worker made from it (a worker per build) */
function world() {
  const store = {};                                    // cache name -> Map(url -> Response)
  const net = {
    build: 'dev', down: false, answers: {}, fail: {}, slow: {}, pending: {}, log: [], reqs: [],
    /* what the server answers for a URL at this moment: the page names its build (X-B68-Build, as worker/app.js does), routes.js
       carries it (the probe reads it), every other file is stamped with the build it came from */
    serve(url) {
      const p = url.slice(ORIGIN.length).split('?')[0];
      if (isPage(url)) return new FakeResponse('page:' + net.build, { headers: { 'X-B68-Build': net.build } });
      if (p === '/routes.js') return new FakeResponse(stamped(ROUTES, net.build).replace("var BUILD = 'dev';", "var BUILD = '" + net.build + "';"));
      return new FakeResponse(net.build + ':' + p);
    },
  };
  const caches = {
    _stores: store,
    open: async (name) => {
      const c = store[name] = store[name] || new Map();
      const k = (r) => (typeof r === 'string' ? r : r.url);
      return { put: async (r, res) => { c.set(k(r), res); }, match: async (r) => c.get(k(r)), keys: async () => [...c.keys()] };
    },
    has: async (name) => Object.prototype.hasOwnProperty.call(store, name),
    keys: async () => Object.keys(store),
    delete: async (n) => delete store[n],
  };
  async function fetch(req) {
    const url = typeof req === 'string' ? req : req.url;
    net.log.push(url); net.reqs.push(req);
    if (net.down || net.fail[url]) throw new TypeError('Failed to fetch');
    if (net.slow[url]) return new Promise((resolve, reject) => { net.pending[url] = { resolve, reject }; });
    return net.answers[url] || net.serve(url);
  }
  class Request { constructor(url, init = {}) { this.url = url; this.method = 'GET'; this.mode = 'cors'; Object.assign(this, init); } }
  const res = (status, extra = {}) => { const { body, headers, ...rest } = extra; return new FakeResponse(body === undefined ? 'net' : body, { status, headers, ...rest }); };
  return { store, net, caches, fetch, Request, res };
}

/* worker({ build, world, routes }): sw.js as the browser would run it for that build. build: the stamp (null: the repository's 'dev') */
function worker(opts = {}) {
  const W = opts.world || world();
  const handlers = {}, bg = [];
  const self = {
    location: { href: ORIGIN + '/sw.js', origin: ORIGIN },
    registration: { scope: ORIGIN + '/', updates: 0, update: async () => { self.registration.updates++; } },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: async () => { self.skipped = true; },
    clients: { claim: async () => { self.claimed = true; } },
  };
  /* the worker's clock: its setTimeout calls are recorded and fired by the test (tick, drain), never by time passing */
  const timers = [];
  const ctx = { self, caches: W.caches, fetch: W.fetch, Request: W.Request, Response: FakeResponse, URL, Promise, console,
    setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
    /* importScripts('routes.js'): the real file stamped with opts.build (opts.routes: the source to use instead; null: the import fails) */
    importScripts: (...names) => {
      for (const n of names) {
        if (n === 'routes.js' && opts.routes === null) throw new Error('NetworkError: routes.js could not be fetched');
        const src = n === 'routes.js' ? (opts.routes || (opts.build ? stamped(ROUTES, opts.build) : ROUTES)) : fs.readFileSync(path.join(APP, n), 'utf8');
        vm.runInContext(src, ctx, { filename: n });
      }
    } };
  const pendingTimers = (...ms) => timers.filter((t) => !t.done && (!ms.length || ms.includes(t.ms)));
  const tick = (...ms) => pendingTimers(...ms).forEach((t) => { t.done = true; t.fn(); });
  vm.createContext(ctx);
  vm.runInContext(SW, ctx, { filename: 'sw.js' });
  /* dispatch(): the test's hand on the clock and the network while the event is in flight (during). Background work the
     worker asked to keep alive (waitUntil) is awaited here for install, activate and message; for a fetch it is left to drain() */
  async function dispatch(type, extra = {}, during, keep = type !== 'fetch') {
    const waits = []; let responded = null;
    const ev = { ...extra, waitUntil: (p) => { waits.push(p); bg.push(p); }, respondWith: (p) => { responded = p; } };
    handlers[type](ev);
    if (during) await during();
    const r = responded ? await responded.then((x) => ({ ok: true, res: x }), (e) => ({ ok: false, err: e })) : null;
    let rejected = null;
    if (keep) await Promise.all(waits.map((p) => Promise.resolve(p).catch((e) => { rejected = rejected || e; })));
    return { responded: !!responded, r, rejected };
  }
  /* drain(): fire the worker's refresh and filing timers and wait for everything it kept alive, until it is quiet */
  async function drain() {
    for (let i = 0; i < 12; i++) {
      await sleep(5);
      const due = pendingTimers(1500, 5000);
      due.forEach((t) => { t.done = true; t.fn(); });
      await Promise.all(bg.splice(0).map((p) => Promise.resolve(p).catch(() => {})));
      if (!due.length && !pendingTimers(1500, 5000).length) { await sleep(5); if (!pendingTimers(1500, 5000).length && !bg.length) return; }
    }
    throw new Error('drain: the worker never went quiet');
  }
  /* ids: { resultingClientId } on a navigation, { clientId } on a file: the page the request belongs to */
  const get = (p, mode = 'no-cors', during, ids = {}) => dispatch('fetch', { request: new W.Request(p.startsWith('http') ? p : ORIGIN + p, { mode }), ...ids }, during);
  const read = (name) => (W.store[name || self.CACHE] || new Map());
  const out = { self, W, caches: W.caches, net: W.net, res: W.res, dispatch, get, timers, tick, drain, pendingTimers, handlers,
    SHELL: vm.runInContext('SHELL', ctx), INSTALL: vm.runInContext('INSTALL', ctx), CACHE: vm.runInContext('CACHE', ctx),
    cache: () => W.store[out.CACHE] || new Map(),
    /* the cached body at a path, or undefined */
    at: (p, name) => { const e = (name ? W.store[name] : out.cache()); const r = e && e.get(p === '/' ? ORIGIN + '/' : ORIGIN + p); return r && r.body; },
    message: (data) => dispatch('message', { data }),
  };
  self.CACHE = out.CACHE;
  return out;
}

/* ---------- routes.js (B68_BUILD, B68Load) ---------- */
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
  for (const f of ['gm-page.js', 'gm/console.js', 'display-page.js', 'stt.js', 'cue.js', 'maps/map-kit.js', 'campaign.js', 'season.js']) ok(!core.has(f) && !HTML.includes('"' + f + '"'), f + ' is lazy, not in index.html');
  eq(L.BUNDLES.print, L.BUNDLES.table, "#print and #t need the same files (the table's print button calls B68Season)");
  // the scripts ran in this order when index.html loaded them all, and some register with another as they run
  // (crewsheet.js with B68Campaign): every bundle keeps it
  const OLD = ['figures/figure-kit.js', 'figures/cast.js', 'maps/map-kit.js', 'content.js', 'core.js', 'zoom.js', 'steps.js', 'tracker.js', 'schedule.js',
    'campaign.js', 'crews.js', 'crewsheet.js', 'season.js', 'markdown.js', 'rules.js', 'cast-page.js', 'gm/console.js', 'gm/location.js', 'gm/scenes.js',
    'gm/npc.js', 'gm/figure-map.js', 'gm/prep.js', 'downtime-tables.js', 'gm/downtime.js', 'gm/assist-panel.js', 'gm-page.js', 'stt.js', 'display-page.js', 'name-edit.js', 'runtime/cf.js', 'boot.js'];
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
  eq(doc.order().slice(14), ['maps/map-kit.js', 'gm/console.js', 'gm/location.js', 'gm/scenes.js', 'gm/score.js', 'gm/npc.js', 'gm/figure-map.js', 'gm/prep.js', 'downtime-tables.js', 'gm/downtime.js', 'gm/assist-panel.js', 'gm/chase.js', 'gm/ball.js', 'cue.js', 'gm/cogm.js', 'gm/autopilot.js', 'gm-page.js'], 'gm/*.js before gm-page.js');
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
  eq(doc.order(), ['tracker.css', 'display.css?v=' + STAMP, '<style>', 'cue.js?v=' + STAMP, 'stt.js?v=' + STAMP, 'display-page.js?v=' + STAMP], 'a stamped build versions every bundle URL');
});

/* the files that only the GM's laptop and the table iPad load: in the gm or display bundle and not in core or table */
const ROLE_ONLY = (() => {
  const L = routes().B68Load, keep = new Set([...L.BUNDLES.core, ...L.BUNDLES.table]);
  return [...new Set([...L.BUNDLES.gm, ...L.BUNDLES.display])].filter((f) => !keep.has(f));
})();
const GM_ONLY = ROLE_ONLY.filter((f) => !routes().B68Load.BUNDLES.display.includes(f));
const u = (p) => ORIGIN + '/' + p;                       // a shell path as a URL
const CORE_JS = ['boot.js', 'core.js', 'tracker.js', 'runtime/cf.js'];

/* a worker for build `build`, installed and activated against the world's server (which must be on that build) */
async function up(build, W = world(), opts = {}) {
  W.net.build = build;
  const w = worker({ build, world: W, ...opts });
  await w.dispatch('install'); await w.dispatch('activate');
  return w;
}

await test('sw: SHELL is the page, the fonts and install files and every bundle file (the core first); INSTALL is the same without the gm and display bundles; all exist; the cache is named after the build', async () => {
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
  // INSTALL: static files + core + table, nothing else
  eq(new Set(w.INSTALL).size, w.INSTALL.length, 'no file twice in INSTALL');
  eq(w.INSTALL.filter((f) => !w.SHELL.includes(f)), [], 'INSTALL is part of SHELL');
  eq(w.INSTALL.filter((f) => f.endsWith('.js') || f.endsWith('.css')), [...new Set([...L.BUNDLES.core, ...L.BUNDLES.table])], 'INSTALL scripts and stylesheets are exactly the core and table bundles');
  eq(w.INSTALL.filter((f) => ROLE_ONLY.includes(f)), [], 'no gm or display file is installed on every device');
  ok(ROLE_ONLY.includes('gm-page.js') && ROLE_ONLY.includes('maps/map-kit.js') && ROLE_ONLY.includes('display-page.js'), 'the role-only list names the GM page, the map kit and the display page: ' + ROLE_ONLY.length + ' files');
  ok(w.INSTALL.includes('./') && w.INSTALL.includes('routes.js') && w.INSTALL.includes('campaign.js') && w.INSTALL.includes('fonts/SpaceMono-Bold.woff2'), 'the page, routes.js, the table and the fonts are installed');
  eq(w.CACHE, 'b68-shell-dev', "the cache is named after routes.js B68_BUILD ('dev' in the repository)");
  eq(worker({ routes: stamped() }).CACHE, 'b68-shell-' + STAMP, 'a stamped build is a new cache (the next activation drops the old one)');
  let threw = null; try { worker({ routes: null }); } catch (e) { threw = e.message; }
  ok(/routes\.js could not be fetched/.test(threw || ''), 'a worker that cannot import routes.js fails to install (the previous one keeps serving): ' + threw);
});

await test('sw: a player\'s install fetches the page, the fonts, the core and the table, and not one gm or display file; the page goes under the scope URL; a redirected or failed answer is not filed; it skips waiting', async () => {
  const W = world(), w = worker({ world: W });
  W.net.answers[u('boot.js')] = w.res(200, { redirected: true });      // e.g. Access: never cached
  W.net.answers[u('core.js')] = w.res(404);
  await w.dispatch('install');
  const fetched = new Set(W.net.log);
  eq([...fetched].filter((x) => ROLE_ONLY.some((f) => x === u(f))), [], 'a gm or display file was fetched by the install');
  eq(w.INSTALL.filter((f) => f !== './' && !fetched.has(u(f))), [], 'every INSTALL file was fetched');
  ok(fetched.has(ORIGIN + '/'), 'the page was fetched');
  for (const r of W.net.reqs) eq(r.url.endsWith('/routes.js') ? ['no-cache', 'no-store'].includes(r.cache) : r.cache, r.url.endsWith('/routes.js') ? true : 'no-cache', 'install revalidates (the probe of routes.js is no-store): ' + r.url);
  ok(w.cache().has(ORIGIN + '/'), 'page cached under /');
  ok(w.cache().has(u('fonts/SpaceMono-Bold.woff2')) && w.cache().has(u('runtime/cf.js')) && w.cache().has(u('campaign.js')), 'shell cached');
  ok(!w.cache().has(u('boot.js')) && !w.cache().has(u('core.js')), 'a redirected or failed answer was cached');
  eq(w.cache().size, w.INSTALL.length - 2, 'exactly the install files that answered');
  ok(w.self.skipped, 'skipWaiting');
  // an install with no network still installs (empty cache; the first online visits fill it)
  const off = worker(); off.net.down = true; await off.dispatch('install'); ok(off.self.skipped, 'offline install');
  eq(off.cache().size, 0, 'nothing filed offline');
  // the server moved on while this worker (build A) was installing: its files are build B's. The install fails, nothing is filed
  const W2 = world(); W2.net.build = 'B';
  const stale = worker({ build: 'A', world: W2 });
  const failed = (await stale.dispatch('install')).rejected;
  ok(failed && /server runs build B, this worker is A/.test(failed.message), 'the install of a worker whose build the server has left fails: ' + (failed && failed.message));
  eq(W2.store[stale.CACHE], undefined, 'no cache was made for the older build');
  ok(!stale.self.skipped, 'an install that found a newer build does not take over');
});

await test('sw: activate keeps the newest older cache (a page open on the previous build asks for its files), drops the rest, keeps other apps\' caches and claims', async () => {
  const w = worker();
  w.caches._stores['b68-shell-v0'] = new Map([[ORIGIN + '/old', new FakeResponse('0')]]);
  w.caches._stores['b68-shell-v1'] = new Map([[ORIGIN + '/__b68-activated', new FakeResponse('2000')]]);
  w.caches._stores['b68-shell-v2'] = new Map([[ORIGIN + '/__b68-activated', new FakeResponse('3000')]]);
  w.caches._stores['other-app'] = new Map();
  await w.dispatch('activate');
  eq(Object.keys(w.caches._stores).sort(), [w.CACHE, 'b68-shell-v2', 'other-app'].sort(), 'this build, the newest older one, other apps');
  ok(w.cache().has(ORIGIN + '/__b68-activated'), 'this cache is marked with when it took over');
  ok(w.self.claimed, 'clients.claim');
  // only one older cache, with no mark (a worker from before this one): kept
  const x = worker(); x.caches._stores['b68-shell-legacy'] = new Map();
  await x.dispatch('activate');
  eq(Object.keys(x.caches._stores).sort(), [x.CACHE, 'b68-shell-legacy'].sort());
});

await test('sw: /api/, /cdn-cgi/, other origins and non-GET are not intercepted', async () => {
  const w = worker();
  for (const p of ['/api/me', '/api/characters?since=x', '/cdn-cgi/access/logout', '/media/theme.mp3', 'https://cdn.example/x.js']) eq((await w.get(p)).responded, false, p);
  eq((await w.dispatch('fetch', { request: { url: ORIGIN + '/boot.js', method: 'POST', mode: 'cors' } })).responded, false, 'POST');
  eq(Object.keys(w.caches._stores), [], 'nothing cached');
  eq(w.net.log, [], 'nothing fetched');
});

await test('sw: a warm open fetches no script, stylesheet or font from the network; the files are revalidated after first paint, one probe of routes.js follows, and a bad cached copy mends itself', async () => {
  const W = world(), w = await up('A', W);
  const cached = w.INSTALL.filter((f) => f !== './'), core = routes().B68Load.BUNDLES.core;
  W.net.log.length = 0;
  // the page (network first) and every installed file, as a warm open asks for them: the core as index.html's own tags (no ?v=), the rest through need() (?v=)
  eq((await w.get('/', 'navigate')).r.res.body, 'page:A', 'the page comes from the network');
  const before = W.net.log.filter((x) => x !== ORIGIN + '/').length;
  for (const f of cached) {
    const lazy = (f.endsWith('.js') || f.endsWith('.css')) && !core.includes(f);
    const got = (await w.get('/' + f + (lazy ? '?v=A' : ''))).r.res.body;
    eq(f === 'routes.js' ? got.includes("var BUILD = 'A';") : got, f === 'routes.js' ? true : 'A:/' + f, 'served from the cache: ' + f);
  }
  eq(W.net.log.filter((x) => x !== ORIGIN + '/').length, before, 'not one file was fetched from the network while the page loaded');
  eq(w.pendingTimers(5000).length, 1, 'one refresh round is waiting for after first paint');
  // a bad copy in the cache: it answers this load, the round replaces it, the next load has the good one
  w.cache().set(u('boot.js'), new FakeResponse('BAD:/boot.js'));
  eq((await w.get('/boot.js')).r.res.body, 'BAD:/boot.js', 'the cached copy answers at once, bad as it is');
  W.net.log.length = 0; W.net.reqs.length = 0;
  await w.drain();
  ok(W.net.log.includes(u('boot.js')) && W.net.log.includes(u('tracker.js')), 'the round revalidated what was served');
  ok(!W.net.log.includes(u('gm-page.js')) && !W.net.log.includes(u('display-page.js')), 'a gm or display file nobody asked for is not fetched');
  eq(W.net.log.filter((x) => x === u('routes.js')).length, 2, 'routes.js: the page asked for it (revalidated) and one probe checked the build before filing');
  for (const r of W.net.reqs) eq(r.cache === 'no-cache' || r.cache === 'no-store', true, 'revalidated, not the browser\'s stale copy: ' + r.url);
  eq(w.at('/boot.js'), 'A:/boot.js', 'the cache now holds the good copy');
  eq((await w.get('/boot.js')).r.res.body, 'A:/boot.js', 'and the next load gets it');
});

await test('sw: the page is network first (the answer is served and, when it is this build\'s, filed); a slow network gets the cached page after 4 s and the late answer still refreshes it; offline gets the cached page', async () => {
  const W = world(), w = await up('A', W);
  const PAGE = ORIGIN + '/';
  eq(w.at('/'), 'page:A', 'installed');
  W.net.answers[PAGE] = new FakeResponse('page:A2', { headers: { 'X-B68-Build': 'A' } });
  eq((await w.get('/', 'navigate')).r.res.body, 'page:A2', 'online: the network answers');
  eq(w.at('/'), 'page:A2', 'and is filed');
  // /index.html and /?x are the same page
  W.net.answers[ORIGIN + '/?x=1'] = new FakeResponse('page:A3', { headers: { 'X-B68-Build': 'A' } });
  await w.get('/?x=1', 'navigate'); eq(w.at('/'), 'page:A3', 'a query string is not part of the key');
  // slow: the cache answers at the limit, the late answer (this build) refreshes the cache
  W.net.slow[PAGE] = true;
  let r = await w.get('/', 'navigate', async () => {
    await sleep(10);
    eq(w.pendingTimers().map((t) => t.ms), [4000], 'a 4 s limit for a navigation the cache holds');
    w.tick(4000); await sleep(10);
    W.net.pending[PAGE].resolve(new FakeResponse('page:late', { headers: { 'X-B68-Build': 'A' } }));
  });
  eq(r.r.res.body, 'page:A3', 'the cached page answered the slow navigation');
  await w.drain();
  eq(w.at('/'), 'page:late', 'the late answer refreshed the cache');
  // a fast network: the timer is cleared
  delete W.net.slow[PAGE]; delete W.net.answers[PAGE];
  const t0 = w.timers.length;
  r = await w.get('/', 'navigate');
  eq([r.r.res.body, w.timers.slice(t0).every((t) => t.done)], ['page:A', true], 'fast network: served, the timer cleared');
  // the network fails with a cached page: the cache answers at once
  W.net.down = true;
  eq((await w.get('/', 'navigate')).r.res.body, 'page:A', 'offline: the cached page');
  eq((await w.get('/some/where', 'navigate')).r.res.body, 'page:A', 'an uncached navigation falls back to the page');
  // nothing cached: no limit, the network is waited for
  W.net.down = false;
  const fresh = worker({ build: 'A', world: world() }); fresh.net.build = 'A'; fresh.net.slow[PAGE] = true;
  const t1 = fresh.timers.length;
  r = await fresh.get('/', 'navigate', async () => { await sleep(10); eq(fresh.timers.length, t1, 'no timer without a cached page'); fresh.net.pending[PAGE].resolve(new FakeResponse('page:eventually', { headers: { 'X-B68-Build': 'A' } })); });
  eq(r.r.res.body, 'page:eventually', 'uncached: the network answer, late as it was');
  // a page that names no build (not the Worker's) cannot be told apart: the cached page answers, else the network's
  W.net.answers[PAGE] = new FakeResponse('page:nameless');
  eq((await w.get('/', 'navigate')).r.res.body, 'page:A', 'no build named: the cached page');
  eq(w.at('/'), 'page:A', 'and nothing is filed');
});

await test('sw: a redirect (Access asking to sign in) is never cached and always reaches the page: the page, a file, a revalidation and the probe', async () => {
  const W = world(), w = await up('A', W);
  const PAGE = ORIGIN + '/';
  const redirect = new FakeResponse(null, { status: 0, type: 'opaqueredirect' });
  W.net.answers[PAGE] = redirect;
  W.net.log.length = 0;
  eq((await w.get('/', 'navigate')).r.res === redirect, true, 'the page: the redirect is handed to the browser as it is');
  eq(W.net.log, [PAGE], 'and nothing else was fetched for it (no probe)');
  eq(w.at('/'), 'page:A', 'the cached page was not replaced');
  // a file the cache does not hold, answered by a followed redirect (a login page): passed on, not filed
  W.net.answers[u('never.js')] = new FakeResponse('login', { redirected: true });
  eq((await w.get('/never.js')).r.res.body, 'login', 'followed redirect passed through');
  await w.drain();
  eq(w.cache().has(u('never.js')), false, 'a followed redirect is not filed');
  // a revalidation that comes back redirected leaves the cached copy alone
  await w.get('/boot.js');
  W.net.answers[u('boot.js')] = new FakeResponse('login', { redirected: true });
  await w.drain();
  eq(w.at('/boot.js'), 'A:/boot.js', 'the redirected revalidation did not replace the file');
  // errors are not cached either
  W.net.answers[u('core.js')] = new FakeResponse('oops', { status: 500 });
  await w.get('/core.js'); await w.drain();
  eq(w.at('/core.js'), 'A:/core.js', 'a 500 revalidation did not replace the file');
  // the probe hitting the login page: build unknown, nothing is filed
  W.net.answers[u('routes.js')] = new FakeResponse('<html>Sign in</html>', { redirected: true });
  W.net.answers[u('tracker.js')] = new FakeResponse('A:/tracker.js (new)');
  await w.get('/tracker.js'); await w.drain();
  eq(w.at('/tracker.js'), 'A:/tracker.js', 'a probe that could not tell the build files nothing');
});

await test('sw: starting offline: the page and every installed file come from the cache, no error, nothing is waited for; a file the cache lacks fails as the network does', async () => {
  const W = world(), w = await up('A', W);
  W.net.down = true; W.net.log.length = 0;
  const t0 = w.timers.length;
  eq((await w.get('/', 'navigate')).r.res.body, 'page:A', 'the page');
  eq(w.timers.slice(t0).filter((t) => t.ms === 4000 && !t.done).length, 0, 'no timer left waiting on the network');
  for (const f of ['boot.js', 'core.js', 'campaign.js', 'fonts/SpaceMono-Bold.woff2', 'manifest.webmanifest']) eq((await w.get('/' + f)).r.res.body, 'A:/' + f, f);
  await w.drain();
  eq(W.net.log.filter((x) => x === u('routes.js')).length, 0, 'no probe when no answer arrived to file');
  eq(w.at('/boot.js'), 'A:/boot.js', 'the cache is as it was');
  // a player has no GM page cached: offline it fails like the network
  const miss = (await w.get('/gm-page.js?v=A')).r; eq([miss.ok, miss.err && miss.err.name], [false, 'TypeError'], 'uncached file offline: the network error');
  // back online: the first visits fill what was missing, once the probe agrees
  W.net.down = false;
  eq((await w.get('/gm-page.js?v=A')).r.res.body, 'A:/gm-page.js', 'online: the network');
  await w.drain();
  eq(w.at('/gm-page.js'), 'A:/gm-page.js', 'and it is filed for next time');
});

await test('sw: an update from build A to B: A\'s page keeps A\'s files, a page of B gets B\'s, no cache ever holds two builds, and a reload after B takes over is all B', async () => {
  const W = world(), A = await up('A', W);
  // an A page is open: it has its files from A's cache
  await A.get('/', 'navigate');
  for (const f of ['boot.js', 'tracker.js']) await A.get('/' + f);
  // the GM's laptop has the GM page cached under A
  await A.message({ precache: ['gm'] });
  eq(A.at('/gm-page.js'), 'A:/gm-page.js', 'A cached the GM page');
  // deploy B
  W.net.build = 'B';
  // 1. A reload before B has installed: A's worker sees B's page. The page is B's, so are its files; nothing goes into A's cache
  const marks = () => [...A.cache().entries()].filter(([k]) => !k.endsWith('__b68-activated')).map(([k, r]) => r.body);
  const aBefore = JSON.stringify(marks());
  eq((await A.get('/', 'navigate')).r.res.body, 'page:B', 'the new page comes from the network');
  ok(A.self.registration.updates >= 1, 'A asked the browser to look for the new worker');
  for (const f of ['boot.js', 'tracker.js', 'core.js']) eq((await A.get('/' + f)).r.res.body, 'B:/' + f, f + ' comes from the network, not the older build\'s cache');
  eq((await A.get('/gm-page.js?v=B')).r.res.body, 'B:/gm-page.js', 'a lazy file of B: the network');
  await A.drain();
  eq(JSON.stringify(marks()), aBefore, 'A\'s cache holds the same files as before: nothing of B went into it');
  // the A page still open lazy-loads its own build: A's cache
  eq((await A.get('/gm-page.js?v=A')).r.res.body, 'A:/gm-page.js', 'an A page keeps A\'s files');
  // 2. B's worker installs and takes over: B's own cache, filled with B only
  const B = worker({ build: 'B', world: W });
  await B.dispatch('install'); await B.dispatch('activate');
  ok(B.self.skipped && B.self.claimed, 'B takes over');
  eq([...B.cache().values()].filter((r) => r.body !== 'page:B' && !String(r.body).startsWith('B:') && !String(r.body).includes("var BUILD = 'B'") && !/^\d+$/.test(r.body)).map((r) => r.body), [], 'B\'s cache holds B files only');
  eq(Object.keys(W.store).sort(), ['b68-shell-A', 'b68-shell-B'], 'A\'s cache is kept for the A page still open');
  // the A page asks its lazy bundle after B took over: A's cache, by its ?v=
  eq((await B.get('/gm-page.js?v=A')).r.res.body, 'A:/gm-page.js', 'B\'s worker answers an A page from A\'s cache');
  eq((await B.get('/campaign.js?v=A')).r.res.body, 'A:/campaign.js', 'including a file A cached at install');
  // a reload: all B, from B's cache, no file from the network
  W.net.log.length = 0;
  eq((await B.get('/', 'navigate')).r.res.body, 'page:B', 'the reload gets B\'s page');
  for (const f of ['boot.js', 'tracker.js', 'campaign.js']) eq((await B.get('/' + f + '?v=B')).r.res.body, 'B:/' + f, f);
  eq(W.net.log.filter((x) => x !== ORIGIN + '/').length, 0, 'and no file from the network');
  // 3. then C: A's cache goes, B's stays for the B page open
  W.net.build = 'C';
  const C = worker({ build: 'C', world: W });
  await C.dispatch('install'); await C.dispatch('activate');
  eq(Object.keys(W.store).sort(), ['b68-shell-B', 'b68-shell-C'], 'only the newest older cache is kept');
});

await test('sw: a moved worker on a slow link: a navigation the cache answered (4 s) loads its core from the cache, zero scripts from the network; a page of the new build, or one the worker does not know, still gets the network', async () => {
  const W = world(), w = await up('A', W);
  // the worker learns the server is on B from a fast page
  W.net.build = 'B';
  eq((await w.get('/', 'navigate', null, { resultingClientId: 'new-page' })).r.res.body, 'page:B');
  eq(w.pendingTimers(4000).length, 0, 'the fast answer cleared its timer');
  // the venue's wifi: the next page takes longer than 4 s
  W.net.slow[ORIGIN + '/'] = true;
  const r = await w.get('/', 'navigate', async () => { await sleep(10); eq(w.pendingTimers().map((t) => t.ms), [4000], 'the 4 s limit applies to a moved worker too'); w.tick(4000); }, { resultingClientId: 'slow-page' });
  eq(r.r.res.body, 'page:A', 'the cached page answered');
  W.net.log.length = 0;
  for (const f of CORE_JS) eq((await w.get('/' + f, 'no-cors', null, { clientId: 'slow-page' })).r.res.body, 'A:/' + f, f + ' from the cache for the cached page');
  eq(W.net.log.filter((x) => x.endsWith('.js')), [], 'not one script from the network');
  // the page of build B, and a client the worker never heard of, go to the network
  eq((await w.get('/boot.js', 'no-cors', null, { clientId: 'new-page' })).r.res.body, 'B:/boot.js', 'a page of the new build: the network');
  eq((await w.get('/boot.js', 'no-cors', null, { clientId: 'who' })).r.res.body, 'B:/boot.js', 'an unknown page: the network');
  eq((await w.get('/boot.js')).r.res.body, 'B:/boot.js', 'no client id: the network');
  // the slow page finally answers (build B): not filed either
  W.net.pending[ORIGIN + '/'].resolve(new FakeResponse('page:B', { headers: { 'X-B68-Build': 'B' } }));
  await w.drain();
  eq([...w.cache().values()].filter((x) => String(x.body).startsWith('B:')).length, 0, 'no B file in the A cache');
});

await test('sw: a slow answer that arrives after the server switched builds is dropped, never filed into the older build\'s cache (no mixed cache); one that is still this build\'s is filed; a probe that fails files nothing', async () => {
  const W = world(), w = await up('A', W);
  const BOOT = u('boot.js');
  await w.get('/boot.js');                                           // from the cache; a round is waiting
  W.net.slow[BOOT] = true;
  w.tick(5000);                                                      // after first paint: the round starts, boot.js is slow
  await sleep(20);
  ok(W.net.pending[BOOT], 'the revalidation of boot.js is in flight');
  W.net.build = 'B';                                                 // the server switches while it is
  delete W.net.slow[BOOT];
  W.net.pending[BOOT].resolve(new FakeResponse('B:/boot.js (late)'));
  await w.drain();
  eq(w.at('/boot.js'), 'A:/boot.js', 'the late build-B answer was not filed into the A cache');
  eq([...w.cache().values()].filter((r) => String(r.body).startsWith('B:')).length, 0, 'the A cache holds no B file');
  ok(w.self.registration.updates >= 1, 'and the worker asked for the update');
  // the next request: A is told the server moved on, so a file comes from the network (B), consistent with a B page
  eq((await w.get('/core.js')).r.res.body, 'B:/core.js', 'once moved, files come from the network');
  // the same slow answer, but the server is still on A: filed
  const W2 = world(), w2 = await up('A', W2);
  await w2.get('/boot.js'); W2.net.slow[u('boot.js')] = true; w2.tick(5000); await sleep(20);
  delete W2.net.slow[u('boot.js')];
  W2.net.pending[u('boot.js')].resolve(new FakeResponse('A:/boot.js (late, newer)'));
  await w2.drain();
  eq(w2.at('/boot.js'), 'A:/boot.js (late, newer)', 'a late answer of the same build is filed');
  // the probe fails (the link died after the file arrived): nothing is filed
  const W3 = world(), w3 = await up('A', W3);
  await w3.get('/boot.js'); W3.net.answers[u('boot.js')] = new FakeResponse('A:/boot.js (unverified)');
  W3.net.fail[u('routes.js')] = true;                                // the probe cannot get through
  w3.tick(5000);
  await w3.drain();
  eq(w3.at('/boot.js'), 'A:/boot.js', 'no probe, no filing');
  // a late PAGE of another build is not filed either
  const W4 = world(), w4 = await up('A', W4);
  W4.net.slow[ORIGIN + '/'] = true;
  const r = await w4.get('/', 'navigate', async () => { await sleep(10); w4.tick(4000); await sleep(10); W4.net.build = 'B'; W4.net.pending[ORIGIN + '/'].resolve(new FakeResponse('page:B', { headers: { 'X-B68-Build': 'B' } })); });
  eq(r.r.res.body, 'page:A', 'the cached page answered');
  await w4.drain();
  eq(w4.at('/'), 'page:A', 'the late page of build B was not filed');
});

await test('sw: the GM\'s message { precache: [\'gm\', \'display\'] } caches those bundles (only what is missing, once), and nothing else; unknown names, other shapes and a moved worker do nothing', async () => {
  const W = world(), w = await up('A', W);
  const roleFiles = ROLE_ONLY;
  eq(roleFiles.filter((f) => w.cache().has(u(f))), [], 'a player\'s cache holds none of them');
  W.net.log.length = 0;
  await w.message({ precache: ['gm', 'display'] });
  eq(roleFiles.filter((f) => !w.cache().has(u(f))), [], 'the GM page and the display are cached');
  eq([...new Set(W.net.log.filter((x) => x !== u('routes.js')))].sort(), roleFiles.map(u).sort(), 'exactly the files of those two bundles were fetched');
  eq(W.net.log.filter((x) => x === u('routes.js')).length, 1, 'one probe vouched for the batch');
  eq(w.at('/gm-page.js'), 'A:/gm-page.js');
  // a second message (the next page load): nothing to fetch
  W.net.log.length = 0;
  await w.message({ precache: ['gm', 'display'] });
  eq(W.net.log, [], 'already cached: no request at all');
  // the iPad asks for the display alone
  const W2 = world(), w2 = await up('A', W2);
  await w2.message({ precache: ['display'] });
  eq(GM_ONLY.filter((f) => w2.cache().has(u(f))), [], 'the display alone brings no GM-only file');
  ok(w2.cache().has(u('display-page.js')), 'and brings the display page');
  // junk
  const W3 = world(), w3 = await up('A', W3); W3.net.log.length = 0;
  for (const d of [null, 'gm', {}, { precache: 'gm' }, { precache: ['nope', 7, null] }, { precache: [] }]) await w3.message(d);
  eq(W3.net.log, [], 'unknown names and other shapes fetch nothing');
  // a moved worker (the server is on B) does not cache A's files for the GM
  const W4 = world(), w4 = await up('A', W4); W4.net.build = 'B'; await w4.get('/', 'navigate'); W4.net.log.length = 0;
  await w4.message({ precache: ['gm'] });
  eq(W4.net.log, [], 'moved: nothing fetched');
  // the files are fetched but the server moved on in between: nothing is filed
  const W5 = world(), w5 = await up('A', W5);
  W5.net.slow[u('gm-page.js')] = true;
  const p = w5.message({ precache: ['gm'] });
  await sleep(20); W5.net.build = 'B'; delete W5.net.slow[u('gm-page.js')]; W5.net.pending[u('gm-page.js')].resolve(new FakeResponse('B:/gm-page.js'));
  await p;
  eq(GM_ONLY.filter((f) => w5.cache().has(u(f))), [], 'a batch the probe did not vouch for is not filed');
});

await test('sw: a file outside the shell (an ambient scene) is network first with an 8 s fallback to its cached copy, filed after a probe; a file of another build comes from that build\'s cache or the network and is never written', async () => {
  const W = world(), w = await up('A', W);
  const SCENE = u('ambient/night-tram.html');
  eq((await w.get('/ambient/night-tram.html')).r.res.body, 'A:/ambient/night-tram.html', 'first visit: the network');
  await w.drain(); ok(w.cache().has(SCENE), 'filed');
  W.net.answers[SCENE] = new FakeResponse('A:scene v2');
  eq((await w.get('/ambient/night-tram.html')).r.res.body, 'A:scene v2', 'online: the network answers first (not the shell\'s cache-first rule)');
  await w.drain(); eq(w.at('/ambient/night-tram.html'), 'A:scene v2', 'and the newer copy is filed');
  W.net.slow[SCENE] = true; delete W.net.answers[SCENE];
  const r = await w.get('/ambient/night-tram.html', 'no-cors', async () => { await sleep(10); eq(w.pendingTimers().map((t) => t.ms).filter((m) => m === 8000), [8000], 'an 8 s limit'); w.tick(8000); });
  eq(r.r.res.body, 'A:scene v2', 'slow: the cached copy answered at the limit');
  W.net.pending[SCENE].resolve(new FakeResponse('A:scene v3')); await w.drain();
  // another build's file
  const W2 = world(), w2 = await up('A', W2);
  W2.net.log.length = 0;
  eq((await w2.get('/gm-page.js?v=B')).r.res.body, 'A:/gm-page.js', 'no cache for build B: the network');
  await w2.drain();
  eq(w2.cache().has(u('gm-page.js')), false, 'and nothing is written for it');
});

/* ---------- cf.js asks the worker for the GM's and the iPad's bundles ---------- */
await test('cf.js: once /api/me says GM it asks the worker to precache gm and display; the iPad (display) asks for display; a player, a signed-out visit and a browser with no worker ask for nothing', async () => {
  const SRC = fs.readFileSync(path.join(APP, 'runtime', 'cf.js'), 'utf8');
  async function visit(role, { down = false, withSw = true, preset } = {}) {
    const posts = [];
    const reg = { active: { postMessage: (m) => posts.push(m) } };
    const stored = {};
    const win = { document: { readyState: 'complete', addEventListener() {}, createElement: () => ({ setAttribute() {} }), head: { appendChild() {}, querySelector: () => null } }, setTimeout, clearTimeout, console, AbortController,
      location: { protocol: 'https:', pathname: '/' }, addEventListener() {}, dispatchEvent() { return true; }, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
      localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); }, removeItem: (k) => { delete stored[k]; } },
      navigator: withSw ? { serviceWorker: { register: () => Promise.resolve(), ready: Promise.resolve(reg), controller: null } } : {},
      fetch: async (url) => {
        if (down) throw new TypeError('Failed to fetch');
        const body = role ? { id: 'x@x.test', email: 'x@x.test', name: 'X', role, campaign: 'default', build: 'dev' } : null;
        const mk = (status, text) => ({ status, ok: status >= 200 && status < 300, redirected: false, type: 'basic', headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => text, json: async () => JSON.parse(text) });
        return role ? mk(200, JSON.stringify(body)) : mk(401, '{"error":"not signed in"}');
      } };
    win.window = win;
    vm.createContext(win); vm.runInContext(SRC, win, { filename: 'cf.js' });
    await win.claude.use('user'); await sleep(20);
    return posts;
  }
  eq(await visit('gm'), [{ precache: ['gm', 'display'] }], 'the GM');
  eq(await visit('display'), [{ precache: ['display'] }], 'the iPad');
  eq(await visit('player'), [], 'a player');
  eq(await visit(null), [], 'signed out');
  eq(await visit('gm', { withSw: false }), [], 'no service worker in this browser');
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
