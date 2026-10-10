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
function worker() {
  const handlers = {}, store = {}, net = { down: false, answers: {}, log: [] };
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
  const ctx = { self, caches, fetch, Request, URL, Promise, console };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx, { filename: 'sw.js' });
  async function dispatch(type, extra = {}) {
    let waits = [], responded = null;
    const ev = { ...extra, waitUntil: (p) => waits.push(p), respondWith: (p) => { responded = p; } };
    handlers[type](ev);
    const r = responded ? await responded.then((x) => ({ ok: true, res: x }), (e) => ({ ok: false, err: e })) : null;
    await Promise.all(waits);
    return { responded: !!responded, r };
  }
  const get = (p, mode = 'no-cors') => dispatch('fetch', { request: new Request(p.startsWith('http') ? p : ORIGIN + p, { mode }) });
  return { self, caches, net, res, dispatch, get, SHELL: ctx.SHELL || vm.runInContext('SHELL', ctx), CACHE: vm.runInContext('CACHE', ctx) };
}

await test('sw: the precache list covers every local file index.html loads, and they all exist', async () => {
  const w = worker();
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/url\("?((?!data:)[^")]+)"?\)/g)) refs.add(m[1]);
  const missing = [...refs].filter((r) => /^[\w./-]+\.\w+$/.test(r) && !w.SHELL.includes(r));
  eq(missing, [], 'in index.html but not in SHELL (app/sw.js)');
  for (const f of w.SHELL) if (f !== './') ok(fs.existsSync(path.join(APP, f)), 'SHELL names a missing file: ' + f);
  ok(w.SHELL.includes('./'), 'the page itself');
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
  eq(p.regs, [['sw.js', { scope: './' }]], 'service worker registration');
  for (const opts of [{ preset: { use() {} } }, { protocol: 'file:' }]) {
    const q = page(opts); eq([q.added.length, q.regs.length], [0, 0], 'inert: ' + JSON.stringify(opts));
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
