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
import { onRequest as me } from '../../functions/api/me.js';
import { onRequest as members } from '../../functions/api/members.js';
import { onRequest as exportAll } from '../../functions/api/export.js';
import { onRequest as campaign } from '../../functions/api/campaign.js';
import { onRequest as characters } from '../../functions/api/characters/index.js';
import { onRequest as character } from '../../functions/api/characters/[id].js';
import { onRequest as notFound } from '../../functions/api/[[path]].js';

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
    ['/api', notFound], ['/api/', notFound], ['/api/nope', notFound], ['/api/characters/a/b', notFound], ['/api/me/x', notFound],
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
  const notModified = await handlePage(new Response(null, { status: 304, headers: { 'Content-Type': 'text/html' } }));
  expect(notModified.status === 304, '304 passes through');
  const sw = await worker.fetch(new Request('https://blades.example.test/sw.js'), env, {});
  expect(sw.status === 200 && (await sw.text()) === 'sw', 'other assets untouched');
  const missing = await worker.fetch(new Request('https://blades.example.test/nope'), env, {});
  expect(missing.status === 404, 'missing file: asset 404');
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

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
