// Unit check of the Worker entry (worker/app.js) and the deploy config, in plain node: no server.
//   - the router maps every /api path to the same handler Pages Functions did, middleware first
//   - DEV_USER is honoured only on a loopback address; production config can never carry it
//   - the page gets its doctype, charset and viewport; other assets pass through untouched
//   - wrangler.toml: assets, run_worker_first, workers.dev off, D1 migrations = schema.sql
//
//   node checks/api/worker.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worker, matchApi, effectiveEnv, withPageHead, handlePage, PAGE_HEAD, isLoopback } from '../../worker/app.js';
import { onRequest as me, BUILD } from '../../functions/api/me.js';
import { onRequest as members } from '../../functions/api/members.js';
import { onRequest as exportAll } from '../../functions/api/export.js';
import { onRequest as campaign } from '../../functions/api/campaign.js';
import { onRequest as characters } from '../../functions/api/characters/index.js';
import { onRequest as character } from '../../functions/api/characters/[id].js';
import { onRequest as npcs } from '../../functions/api/npcs/index.js';
import { onRequest as npc } from '../../functions/api/npcs/[id].js';
import { onRequest as notFound } from '../../functions/api/[[path]].js';
import { onRequest as liveRoute } from '../../functions/api/live.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let passes = 0;
let failures = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

// A D1 stand-in good enough for /api/me (schema batch + one upsert).
function fakeDb() {
  const calls = [];
  const stmt = (sql) => ({ sql, bind(...a) { this.args = a; return this; }, async run() { calls.push(this.sql); return { success: true }; }, async all() { return { results: [] }; }, async first() { return null; } });
  return { calls, prepare: stmt, async batch(list) { list.forEach((s) => calls.push(s.sql)); return []; } };
}
const INDEX = readFileSync(join(ROOT, 'app', 'index.html'), 'utf8');
function fakeAssets() {
  return {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === '/') return new Response(INDEX, { headers: { 'Content-Type': 'text/html', ETag: '"abc"' } });
      if (p === '/index.html') return new Response(null, { status: 307, headers: { Location: '/' } });
      if (p === '/sw.js') return new Response('sw', { headers: { 'Content-Type': 'text/javascript' } });
      return new Response(null, { status: 404 });
    },
  };
}

await step('router: every Pages Functions route maps to its handler, with params', async () => {
  const cases = [
    ['/api/me', me], ['/api/me/', me], ['/api/members', members], ['/api/export', exportAll],
    ['/api/campaign', campaign], ['/api/characters', characters], ['/api/characters/', characters],
    ['/api/characters/abc_1-2', character], ['/api/characters/x/', character],
    ['/api/npcs', npcs], ['/api/npcs/', npcs], ['/api/npcs/npc_grunt', npc], ['/api/npcs/x/', npc], ['/api/npcs/a/b', notFound],
    ['/api', notFound], ['/api/', notFound], ['/api/nope', notFound], ['/api/characters/a/b', notFound], ['/api/me/x', notFound],
    ['/api/live', liveRoute], ['/api/live/', liveRoute], ['/api/live/x', notFound], ['/api/livex', notFound],
  ];
  for (const [p, h] of cases) expect(matchApi(p).handler === h, p + ' -> wrong handler');
  expect(matchApi('/api/characters/abc_1-2').params.id === 'abc_1-2', 'id param');
  expect(matchApi('/api/characters/a%20b').params.id === 'a b', 'id param is decoded');
  expect(JSON.stringify(matchApi('/api/a/b').params.path) === '["a","b"]', '[[path]] param');
});

await step('middleware first: unknown /api paths are 401 without a token, JSON, no-store', async () => {
  for (const p of ['/api/me', '/api/nope', '/api', '/api/characters/x']) {
    const r = await worker.fetch(new Request('https://blades.example.test' + p), { CAMPAIGN: 'default' }, {});
    expect(r.status === 401, p + ': ' + r.status);
    expect((await r.json()).error === 'not signed in', p + ': body');
    expect(r.headers.get('Cache-Control') === 'no-store', p + ': cache-control ' + r.headers.get('Cache-Control'));
    expect(r.headers.get('X-Content-Type-Options') === 'nosniff', p + ': nosniff');
  }
});

await step('DEV_USER: honoured on loopback, ignored on any other host (Access still required)', async () => {
  const env = () => ({ DEV_USER: 'gm@example.test', GM_EMAILS: 'gm@example.test', DB: fakeDb(), CAMPAIGN: 'default' });
  const local = await worker.fetch(new Request('http://127.0.0.1:8788/api/me'), env(), {});
  expect(local.status === 200, 'loopback: ' + local.status);
  expect((await local.json()).role === 'gm', 'loopback: GM');
  const localhost = await worker.fetch(new Request('http://localhost/api/me'), env(), {});
  expect(localhost.status === 200, 'localhost: ' + localhost.status);
  for (const host of ['blades.fieldguide.help', 'blades68.someone.workers.dev', 'localhost.evil.test', '127.0.0.1.nip.io']) {
    const r = await worker.fetch(new Request('https://' + host + '/api/me'), env(), {});
    expect(r.status === 401, host + ': expected 401, got ' + r.status);
  }
  // a Host header naming another host wins over the URL
  const spoof = new Request('http://127.0.0.1/api/me', { headers: { Host: 'blades.fieldguide.help' } });
  expect(!isLoopback(spoof), 'Host header is what counts');
  const spoofed = await worker.fetch(spoof, env(), {});
  expect(spoofed.status === 401, 'loopback URL with a public Host: ' + spoofed.status);
  expect(isLoopback(new Request('http://[::1]:8788/')), 'IPv6 loopback');
  const e = env();
  expect(effectiveEnv(new Request('https://blades.fieldguide.help/'), e).DEV_USER === undefined, 'stripped');
  expect(e.DEV_USER === 'gm@example.test', 'the original env is not modified');
});

await step('page: doctype, charset and viewport in front of index.html, security headers, ETag kept', async () => {
  const env = { ASSETS: fakeAssets() };
  const r = await worker.fetch(new Request('https://blades.example.test/'), env, {});
  const text = await r.text();
  expect(r.status === 200, 'status ' + r.status);
  expect(text.startsWith(PAGE_HEAD + '\n'), 'head: ' + text.slice(0, 120));
  expect(text.slice(PAGE_HEAD.length + 1) === INDEX, 'the rest is index.html unchanged');
  expect(/width=device-width, initial-scale=1, viewport-fit=cover/.test(PAGE_HEAD), 'viewport content');
  expect(r.headers.get('Content-Type') === 'text/html; charset=utf-8', 'content-type');
  expect(r.headers.get('ETag') === '"abc"', 'etag kept');
  expect(r.headers.get('X-Frame-Options') === 'DENY' && r.headers.get('X-Content-Type-Options') === 'nosniff', 'security headers');
  expect(!INDEX.trimStart().toLowerCase().startsWith('<!doctype'), 'app/index.html itself stays a bare fragment (the artifact wraps it)');
  expect(withPageHead('<!DOCTYPE html><p>x') === '<!DOCTYPE html><p>x', 'no second doctype');
  const redirect = await worker.fetch(new Request('https://blades.example.test/index.html'), env, {});
  expect(redirect.status === 307 && redirect.headers.get('Location') === '/', '/index.html redirect passes through');
  expect(r.headers.get('X-B68-Build') === 'dev', 'the page names the build (the service worker reads it): ' + r.headers.get('X-B68-Build'));
  const notModified = await handlePage(new Response(null, { status: 304, headers: { 'Content-Type': 'text/html', ETag: '"abc"' } }));
  expect(notModified.status === 304 && notModified.headers.get('ETag') === '"abc"', '304 passes through');
  expect(notModified.headers.get('X-B68-Build') === 'dev', 'a 304 names the build too: it refreshes the stored headers');
  const sw = await worker.fetch(new Request('https://blades.example.test/sw.js'), env, {});
  expect(sw.status === 200 && (await sw.text()) === 'sw', 'other assets untouched');
  const missing = await worker.fetch(new Request('https://blades.example.test/nope'), env, {});
  expect(missing.status === 404, 'missing file: asset 404');
});

await step('page: a full Content-Security-Policy is reported, not enforced; the enforced one stays frame-ancestors only', async () => {
  const r = await worker.fetch(new Request('https://blades.example.test/'), { ASSETS: fakeAssets() }, {});
  expect(r.headers.get('Content-Security-Policy') === "frame-ancestors 'none'", 'enforced CSP: ' + r.headers.get('Content-Security-Policy'));
  const ro = r.headers.get('Content-Security-Policy-Report-Only') || '';
  const dir = Object.fromEntries(ro.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(' ')]; }));
  const want = {
    'script-src': "'self'", 'style-src': "'self' 'unsafe-inline'", 'img-src': "'self' data: blob:", 'connect-src': "'self' wss://api.deepgram.com",
    'frame-src': "'self'", 'media-src': "'self'", 'font-src': "'self'", 'frame-ancestors': "'none'",
  };
  expect(JSON.stringify(dir) === JSON.stringify(want), 'report-only policy: ' + ro);
  expect(!/unsafe-eval|\*/.test(dir['script-src']) && !/unsafe-inline/.test(dir['script-src']), 'scripts: same-origin files only');
  const api = await worker.fetch(new Request('http://127.0.0.1:8788/api/me'), { DEV_USER: 'gm@example.test', GM_EMAILS: 'gm@example.test', DB: fakeDb(), CAMPAIGN: 'default' }, {});
  expect(api.headers.get('Content-Security-Policy-Report-Only') === null, 'the API answers carry no page policy');
});

await step('build: app/routes.js is committed as dev (deploy.sh stamps it), /api/me answers it and every API answer carries X-B68-Build', async () => {
  const routes = readFileSync(join(ROOT, 'app', 'routes.js'), 'utf8');
  expect(/^\s*var BUILD = 'dev';/m.test(routes), "app/routes.js must say var BUILD = 'dev' in the repository: scripts/deploy.sh stamps it for the upload and puts it back");
  expect(BUILD === 'dev', 'the Worker reads the same constant (got ' + BUILD + ')');
  const env = { DEV_USER: 'gm@example.test', GM_EMAILS: 'gm@example.test', DB: fakeDb(), CAMPAIGN: 'default' };
  const r = await worker.fetch(new Request('http://127.0.0.1:8788/api/me'), env, {});
  expect(r.headers.get('X-B68-Build') === 'dev', 'X-B68-Build on /api/me: ' + r.headers.get('X-B68-Build'));
  expect((await r.json()).build === 'dev', '/api/me carries build');
  const other = await worker.fetch(new Request('http://127.0.0.1:8788/api/nope'), env, {});
  expect(other.headers.get('X-B68-Build') === 'dev', 'X-B68-Build on every API answer, a 404 included');
});

const TOML = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const live = TOML.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, '')).join('\n');

await step('wrangler.toml: a Worker with assets, the API and page first, workers.dev off', async () => {
  expect(!/pages_build_output_dir/.test(live), 'no Pages config');
  expect(/^main\s*=\s*"worker\/index\.js"/m.test(live), 'main');
  expect(/^\[assets\][\s\S]*?directory\s*=\s*"\.\/app"/m.test(live), 'assets directory');
  expect(/binding\s*=\s*"ASSETS"/.test(live), 'ASSETS binding');
  const rwf = (live.match(/run_worker_first\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
  for (const p of ['"/api/*"', '"/"', '"/index.html"']) expect(rwf.includes(p), 'run_worker_first has ' + p);
  expect(/^workers_dev\s*=\s*false/m.test(live) && /^preview_urls\s*=\s*false/m.test(live), 'workers.dev and preview URLs off');
  expect(/custom_domain\s*=\s*true/.test(live), 'custom domain route');
  const host = (live.match(/pattern\s*=\s*"([^"]+)"/) || [])[1] || '';
  expect(host.split('.').length >= 3 && !/^www\./.test(host), 'the route is a subdomain, never the apex or www: ' + host);
  expect(/^CAMPAIGN\s*=\s*"/m.test(live), '[vars] CAMPAIGN');
  expect(/^\[dev\][\s\S]*?host\s*=\s*"localhost"/m.test(live), '[dev] host = localhost (keeps the loopback origin)');
});

await step('line endings: .gitattributes keeps scripts, code and docs LF on every clone (Git for Windows would make them CRLF), and the shell scripts are LF', async () => {
  const attrs = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
  for (const pat of ['*.sh', '*.mjs', '*.js', '*.json', '*.md', '*.css', '*.html', '*.sql', '*.toml']) {
    expect(new RegExp('^' + pat.replace(/[.*]/g, (c) => '\\' + c) + '\\s+text\\s+eol=lf\\s*$', 'm').test(attrs), '.gitattributes: ' + pat + ' text eol=lf');
  }
  for (const f of ['scripts/deploy.sh', 'scripts/lib/common.sh', 'scripts/access-emails.sh']) expect(!readFileSync(join(ROOT, f), 'utf8').includes('\r'), f + ' has CR line endings');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts.deploy === 'sh scripts/deploy.sh', 'npm run deploy runs the POSIX script with sh (Git Bash on Windows)');
});

await step('production config cannot carry DEV_USER or Access secrets', async () => {
  for (const name of ['DEV_USER', 'ACCESS_AUD', 'ACCESS_TEAM', 'GM_EMAILS']) {
    expect(!new RegExp('^\\s*' + name + '\\s*=', 'm').test(live), name + ' must not be set in wrangler.toml');
  }
  expect(!/^\s*\[env\./m.test(live), 'no [env.*] sections (one deployment, one config)');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  expect(!/DEV_USER/.test(pkg.scripts.deploy || '') && !/DEV_USER/.test(pkg.scripts.build || ''), 'deploy/build scripts do not pass DEV_USER');
  expect(/--var DEV_USER:/.test(pkg.scripts.dev), 'npm run dev passes DEV_USER as a local --var');
});

await step('D1: migrations hold exactly the statements of schema.sql', async () => {
  const stmts = (sql) => sql.replace(/--.*$/gm, '').split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  expect(/^\s*migrations_dir\s*=\s*"migrations"/m.test(live), 'migrations_dir');
  const files = readdirSync(join(ROOT, 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  expect(files[0] === '0001_init.sql', 'first migration: ' + files);
  const fromMigrations = files.flatMap((f) => stmts(readFileSync(join(ROOT, 'migrations', f), 'utf8')));
  const fromSchema = stmts(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
  expect(JSON.stringify(fromMigrations) === JSON.stringify(fromSchema), 'schema.sql and migrations/ differ');
});

await step('wrangler.toml: the LIVE Durable Object binding and its v1 migration (not D1 migrations_dir), both before [assets]', () => {
  expect(/^\[\[durable_objects\.bindings\]\]\s*\nname = "LIVE"\s*\nclass_name = "LiveHub"/m.test(live), 'binding LIVE -> LiveHub');
  expect(/^\[\[migrations\]\]\s*\ntag = "v1"\s*\nnew_sqlite_classes = \["LiveHub"\]/m.test(live), 'migration v1 new_sqlite_classes');
  expect(live.indexOf('[[durable_objects.bindings]]') < live.indexOf('[assets]') && live.indexOf('[[migrations]]') < live.indexOf('[assets]'), 'both before [assets]');
  expect(live.split('[[migrations]]').length === 2 && live.split('[[durable_objects.bindings]]').length === 2, 'one of each');
  expect(!/^\s*new_classes\s*=/m.test(live), 'sqlite classes only');
  expect(/^\s*migrations_dir\s*=\s*"migrations"/m.test(live), 'D1 migrations_dir untouched');
  const index = readFileSync(join(ROOT, 'worker', 'index.js'), 'utf8');
  expect(/^export \{ LiveHub \} from '\.\/live\.js';/m.test(index), 'index.js exports LiveHub');
  expect((readFileSync(join(ROOT, 'worker', 'app.js'), 'utf8').match(/LiveHub/g) || []).length === 0, 'app.js never names the class (node must import it)');
});

// A LIVE namespace stand-in. Node cannot build a real 101 Response, so the stub answers a plain object with status 101
// and headers whose set() throws: the guards must return it untouched (a copy would drop the socket).
function fakeLive(calls) {
  const upgraded = { status: 101, webSocket: { marker: 'socket' }, body: null, headers: { set() { throw new Error('headers touched on a 101'); }, get() { return null; } } };
  return {
    upgraded,
    idFromName(name) { calls.names.push(name); return { id: name }; },
    get(id) { calls.gets.push(id); return { async fetch(req) { calls.fetches.push(req); return upgraded; } }; },
  };
}
const liveCalls = () => ({ names: [], gets: [], fetches: [] });
const upgradeReq = (user) => new Request('http://127.0.0.1:8788/api/live', { headers: Object.assign({ Upgrade: 'websocket', Connection: 'Upgrade' }, user ? { 'X-Dev-User': user } : {}) });
const liveEnv = (extra) => Object.assign({ DEV_USER: 'gm@example.test', GM_EMAILS: 'gm@example.test', DISPLAY_EMAILS: 'ipad@example.test', DB: fakeDb(), CAMPAIGN: 'tablecheck' }, extra || {});

await step('/api/live: the GM upgrade reaches idFromName(campaign) and the 101 comes back as the very same object (no header copy)', async () => {
  const calls = liveCalls();
  const LIVE = fakeLive(calls);
  const r = await worker.fetch(upgradeReq(), liveEnv({ LIVE }), {});
  expect(r === LIVE.upgraded, 'the 101 must pass through untouched: got status ' + r.status);
  expect(calls.names.length === 1 && calls.names[0] === 'tablecheck', 'idFromName(campaign): ' + calls.names);
  expect(calls.gets.length === 1 && calls.gets[0].id === 'tablecheck', 'get() got that id');
  expect(calls.fetches.length === 1 && calls.fetches[0].headers.get('Upgrade') === 'websocket', 'the stub saw the upgrade request');
  const unset = liveCalls();
  const e2 = liveEnv({ LIVE: fakeLive(unset) }); delete e2.CAMPAIGN;
  await worker.fetch(upgradeReq(), e2, {});
  expect(unset.names[0] === 'default', 'no CAMPAIGN var: the app default: ' + unset.names);
});

await step('/api/live (MD1b): a player and the display reach the object on an upgrade, each as its own role; with no upgrade they are 426, the object untouched; no token is 401', async () => {
  for (const [who, user] of [['player', 'player@example.test'], ['display', 'ipad@example.test']]) {
    const up = liveCalls();
    const r = await worker.fetch(upgradeReq(user), liveEnv({ LIVE: fakeLive(up) }), {});
    expect(r.status === 101 && up.fetches.length === 1, who + ' upgrade: expected 101, got ' + r.status);
    expect(up.fetches[0].headers.get('X-B68-Role') === who, who + ': the object is told the signed-in role: ' + up.fetches[0].headers.get('X-B68-Role'));
    const calls = liveCalls();
    const plain = await worker.fetch(new Request('http://127.0.0.1:8788/api/live', { headers: { 'X-Dev-User': user } }), liveEnv({ LIVE: fakeLive(calls) }), {});
    expect(plain.status === 426 && plain.headers.get('Cache-Control') === 'no-store', who + ' plain: expected 426, got ' + plain.status);
    expect(calls.names.length === 0 && calls.gets.length === 0 && calls.fetches.length === 0, who + ': the Durable Object was reached');
  }
  const calls = liveCalls();
  const anon = await worker.fetch(upgradeReq(), { LIVE: fakeLive(calls), CAMPAIGN: 'tablecheck', GM_EMAILS: 'gm@example.test', DB: fakeDb() }, {});
  expect(anon.status === 401 && calls.fetches.length === 0, 'no token: ' + anon.status);
});

await step('/api/live: the GM without an upgrade header is 426, still not the object; the GM with LIVE unbound is a plain 503', async () => {
  const calls = liveCalls();
  const plain = await worker.fetch(new Request('http://127.0.0.1:8788/api/live'), liveEnv({ LIVE: fakeLive(calls) }), {});
  expect(plain.status === 426 && calls.fetches.length === 0, 'plain GET: ' + plain.status);
  expect(plain.headers.get('Cache-Control') === 'no-store', 'no-store on the 426');
  const unbound = await worker.fetch(upgradeReq(), liveEnv(), {});
  expect(unbound.status === 503, 'no binding: ' + unbound.status);
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
