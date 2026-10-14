// The rules wiki's API against a local `wrangler dev` (see HOSTING.md, RULES.md):
//   GET /api/rules (any member), POST /api/rules/import (GM, chunked, replace), PUT / DELETE /api/rules/house/:slug (GM),
//   the size caps, and /api/export carrying no rules. Every text in here is made-up placeholder prose: the real rulebooks
//   are never in this repository.
//
//   node checks/api/rules.mjs            (or: npm run check:api)
//
// Starts its own dev server on PORT (default 8794) with DEV_USER set and a throwaway D1 state directory.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worker, matchApi } from '../../worker/app.js';
import { onRequest as rulesList } from '../../functions/api/rules/index.js';
import { onRequest as rulesImport } from '../../functions/api/rules/import.js';
import { onRequest as rulesHouse } from '../../functions/api/rules/house/[slug].js';
import { onRequest as notFound } from '../../functions/api/[[path]].js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8794);
const GM = 'gm@example.test';
const PLAYER = 'player@example.test';
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 240000);
const L = { entryBody: 120 * 1024, entriesPerRequest: 40, request: 1024 * 1024, bookEntries: 4000, bookBytes: 8 * 1024 * 1024 };

const stateDir = mkdtempSync(join(tmpdir(), 'b68-rules-check-'));
let failures = 0;
let passes = 0;
let child;
let log = '';

function signal(sig) { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-child.pid, sig); } catch (_) {} }
async function stop() {
  if (!child) return;
  signal('SIGTERM');
  const until = Date.now() + 5000;
  while (Date.now() < until && child.exitCode === null && child.signalCode === null) await sleep(100);
  signal('SIGKILL');
  try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', () => signal('SIGKILL'));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stop(); process.exit(130); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start() {
  const bin = join(ROOT, 'node_modules', '.bin', 'wrangler');
  const args = ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000),
    '--show-interactive-dev-session', 'false', '--persist-to', join(stateDir, 'p'), '--log-level', 'warn',
    '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'CAMPAIGN:rulescheck'];
  child = spawn(bin, args, { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
}
async function ready() {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server exited:\n' + log);
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); if (r.status > 0) return; } catch (_) {}
    await sleep(500);
  }
  throw new Error('server did not start:\n' + log);
}

async function call(method, path, { user, body, raw } = {}) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let payload;
  if (raw !== undefined) { payload = raw; h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text, headers: r.headers };
}
const gm = (method, path, body) => call(method, path, { user: GM, body });
const player = (method, path, body) => call(method, path, { user: PLAYER, body });

async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function expectStatus(r, status) { expect(r.status === status, 'expected ' + status + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }

// made-up placeholder prose
const entry = (slug, extra = {}) => ({ slug, title: 'Placeholder ' + slug, trail: 'Fixture > ' + slug, body: 'The wobbling lantern of ' + slug + ' hums softly.', ord: 0, src: 'Fixture/' + slug + '.md', ...extra });
const imp = (book, entries, extra = {}) => gm('POST', '/api/rules/import', { book, entries, ...extra });
const corpus = async (user = PLAYER) => (await call('GET', '/api/rules', { user })).json;
const of = (c, book) => c.entries.filter((e) => e.book === book);

// ---------- no server: the router and the middleware ----------

await step('router: /api/rules, /api/rules/import and /api/rules/house/:slug map to their handlers', async () => {
  expect(matchApi('/api/rules').handler === rulesList && matchApi('/api/rules/').handler === rulesList, 'list');
  expect(matchApi('/api/rules/import').handler === rulesImport && matchApi('/api/rules/import/').handler === rulesImport, 'import');
  const h = matchApi('/api/rules/house/my-rule');
  expect(h.handler === rulesHouse && h.params.slug === 'my-rule', 'house');
  expect(matchApi('/api/rules/house').handler === notFound && matchApi('/api/rules/house/a/b').handler === notFound && matchApi('/api/rules/x').handler === notFound, 'other paths stay 404');
});

await step('without a token every rules path is 401, no-store', async () => {
  for (const [m, p] of [['GET', '/api/rules'], ['POST', '/api/rules/import'], ['PUT', '/api/rules/house/x'], ['DELETE', '/api/rules/house/x']]) {
    const r = await worker.fetch(new Request('https://blades.example.test' + p, { method: m }), { CAMPAIGN: 'x' }, {});
    expect(r.status === 401, m + ' ' + p + ': ' + r.status);
    expect(r.headers.get('Cache-Control') === 'no-store', m + ' ' + p + ': cache-control');
  }
});

// ---------- the server ----------

async function main() {
  start();
  await ready();
  console.log('server up on ' + PORT);

  let v0;
  await step('GET /api/rules on an empty database (as a player): version, no entries, no-store', async () => {
    const r = await player('GET', '/api/rules');
    expectStatus(r, 200);
    expect(r.json.version === '0' && r.json.updatedAt === null && r.json.count === 0, JSON.stringify(r.json));
    expect(Array.isArray(r.json.entries) && r.json.entries.length === 0, 'entries');
    expect(r.headers.get('cache-control') === 'no-store', 'cache-control');
    v0 = r.json.version;
  });

  await step('a player is refused every write (403) and nothing is stored', async () => {
    const body = { book: 'bitd', entries: [entry('player-try')], replace: true };
    const a = await player('POST', '/api/rules/import', body);
    expectStatus(a, 403);
    expect(/only the GM/.test(a.json.error), a.text);
    expectStatus(await player('PUT', '/api/rules/house/player-try', { title: 'Nope', body: 'x' }), 403);
    expectStatus(await player('DELETE', '/api/rules/house/player-try'), 403);
    // a junk body is a 403 too (the role is checked before the body is read)
    expectStatus(await call('POST', '/api/rules/import', { user: PLAYER, raw: '{nope' }), 403);
    const c = await corpus(GM);
    expect(c.entries.length === 0 && c.version === v0, 'nothing stored: ' + c.entries.length);
  });

  await step('GM imports a book in one request (replace): rows, shape, version moves', async () => {
    const r = await imp('bitd', [entry('alpha', { ord: 0 }), entry('beta', { ord: 1, keys: 'Beta Alias\nSecond key' }), entry('gamma', { ord: 2, body: '' })], { replace: true });
    expectStatus(r, 200);
    expect(r.json.ok === true && r.json.book === 'bitd' && r.json.received === 3 && r.json.count === 3 && r.json.replaced === true, JSON.stringify(r.json));
    const c = await corpus();
    expect(c.count === 3 && c.books.bitd === 3 && c.books.b68 === 0 && c.books.house === 0, JSON.stringify(c.books));
    expect(c.version !== v0 && c.version === r.json.version && typeof c.updatedAt === 'string', 'version ' + c.version);
    const beta = c.entries.find((e) => e.slug === 'beta');
    expect(beta.book === 'bitd' && beta.title === 'Placeholder beta' && beta.trail === 'Fixture > beta' && beta.keys === 'Beta Alias\nSecond key' &&
      beta.ord === 1 && beta.src === 'Fixture/beta.md' && /wobbling lantern/.test(beta.body) && typeof beta.updatedAt === 'string', JSON.stringify(beta));
    expect(c.entries.map((e) => e.slug).join() === 'alpha,beta,gamma', 'ordered by ord: ' + c.entries.map((e) => e.slug));
  });

  await step('?v=<version>: unchanged answers without entries; a stale version gets the corpus', async () => {
    const c = await corpus();
    const same = await player('GET', '/api/rules?v=' + encodeURIComponent(c.version));
    expectStatus(same, 200);
    expect(same.json.unchanged === true && same.json.version === c.version && !('entries' in same.json), same.text.slice(0, 200));
    const stale = await player('GET', '/api/rules?v=old');
    expect(stale.json.entries.length === 3 && !stale.json.unchanged, 'stale');
  });

  await step('chunked import: only the first chunk with replace deletes; later chunks append; the other book is untouched', async () => {
    let r = await imp('b68', [entry('old-1'), entry('old-2')], { replace: true });
    expectStatus(r, 200);
    r = await imp('b68', [entry('c1-a', { ord: 0 }), entry('c1-b', { ord: 1 })], { replace: true, part: 1, of: 3 });
    expectStatus(r, 200);
    expect(r.json.replaced === true && r.json.count === 2 && r.json.part === 1 && r.json.of === 3, 'chunk 1 replaced the book: ' + JSON.stringify(r.json));
    r = await imp('b68', [entry('c2-a', { ord: 2 }), entry('c2-b', { ord: 3 })], { replace: true, part: 2, of: 3 });
    expectStatus(r, 200);
    expect(r.json.replaced === false && r.json.count === 4, 'chunk 2 appended even with replace: ' + JSON.stringify(r.json));
    r = await imp('b68', [entry('c3-a', { ord: 4 })], { replace: false, part: 3, of: 3 });
    expectStatus(r, 200);
    expect(r.json.count === 5, 'chunk 3: ' + JSON.stringify(r.json));
    const c = await corpus();
    expect(of(c, 'b68').map((e) => e.slug).join() === 'c1-a,c1-b,c2-a,c2-b,c3-a', 'b68: ' + of(c, 'b68').map((e) => e.slug));
    expect(of(c, 'bitd').length === 3, 'bitd untouched');
  });

  await step('a chunk sent twice is harmless (same slug replaces); a changed entry takes the new text', async () => {
    let r = await imp('b68', [entry('c3-a', { ord: 4, title: 'Placeholder c3-a, revised', body: 'Now a stuttering kettle.' })], { part: 3, of: 3 });
    expectStatus(r, 200);
    expect(r.json.count === 5, 'still five: ' + JSON.stringify(r.json));
    const e = of(await corpus(), 'b68').find((x) => x.slug === 'c3-a');
    expect(e.title === 'Placeholder c3-a, revised' && e.body === 'Now a stuttering kettle.', JSON.stringify(e));
  });

  await step('re-importing a book with replace swaps it for the new set', async () => {
    const r = await imp('b68', [entry('fresh-1'), entry('fresh-2', { ord: 1 })], { replace: true });
    expectStatus(r, 200);
    const c = await corpus();
    expect(of(c, 'b68').map((e) => e.slug).join() === 'fresh-1,fresh-2', of(c, 'b68').map((e) => e.slug));
    expect(of(c, 'bitd').length === 3, 'bitd untouched');
  });

  await step('import validation: 400 with a clear message', async () => {
    const bad = async (body, re) => {
      const r = await gm('POST', '/api/rules/import', body);
      expectStatus(r, 400);
      expect(re.test(r.json.error), JSON.stringify(body).slice(0, 80) + ' -> ' + r.text);
    };
    await bad({ book: 'nope', entries: [entry('x')] }, /book must be/);
    await bad({ entries: [entry('x')] }, /book must be/);
    await bad({ book: 'house', entries: [entry('x')] }, /house rules are written one at a time/);
    await bad({ book: 'b68', entries: 'x' }, /entries must be an array/);
    await bad({ book: 'b68', entries: [] }, /entries is empty/);
    await bad({ book: 'b68', entries: [entry('x')], replace: 'yes' }, /replace must be/);
    await bad({ book: 'b68', entries: [entry('x')], part: 1 }, /of must be/);
    await bad({ book: 'b68', entries: [entry('x')], part: 3, of: 2 }, /part must be/);
    await bad({ book: 'b68', entries: [entry('x')], part: 0, of: 2 }, /part must be/);
    await bad({ book: 'b68', entries: [entry('x'), entry('x')] }, /appears twice/);
    await bad({ book: 'b68', entries: [entry('Bad Slug')] }, /entries\[0\]\.slug is bad/);
    await bad({ book: 'b68', entries: [entry('ok'), entry('')] }, /entries\[1\]\.slug is bad/);
    await bad({ book: 'b68', entries: [{ ...entry('t'), title: '   ' }] }, /entries\[0\]\.title is required/);
    await bad({ book: 'b68', entries: [{ ...entry('t'), body: 5 }] }, /entries\[0\]\.body must be a string/);
    await bad({ book: 'b68', entries: [{ ...entry('t'), ord: 1.5 }] }, /entries\[0\]\.ord must be an integer/);
    await bad({ book: 'b68', entries: ['text'] }, /entries\[0\] must be an object/);
    const j = await call('POST', '/api/rules/import', { user: GM, raw: '[1]' });
    expectStatus(j, 400);
    const j2 = await call('POST', '/api/rules/import', { user: GM, raw: '{nope' });
    expectStatus(j2, 400);
    // nothing of the rejected requests was kept
    expect(of(await corpus(), 'b68').map((e) => e.slug).join() === 'fresh-1,fresh-2', 'b68 unchanged');
  });

  await step('size caps: an entry over the limit, too many entries, a request over 1 MiB are 413', async () => {
    let r = await imp('b68', [entry('big', { body: 'x'.repeat(L.entryBody + 1) })]);
    expectStatus(r, 413);
    expect(/entries\[0\]\.body is too large/.test(r.json.error), r.text);
    r = await imp('b68', [entry('ok-one'), entry('big', { body: 'é'.repeat(L.entryBody / 2 + 1) })]);
    expectStatus(r, 413);   // two bytes per character: the cap is in bytes
    expect(/entries\[1\]/.test(r.json.error), r.text);
    const many = Array.from({ length: L.entriesPerRequest + 1 }, (_, i) => entry('m' + i, { ord: i }));
    r = await imp('b68', many);
    expectStatus(r, 413);
    expect(/too many entries in one request/.test(r.json.error), r.text);
    const bulky = Array.from({ length: 10 }, (_, i) => entry('b' + i, { body: 'y'.repeat(L.entryBody) }));
    r = await imp('b68', bulky);
    expectStatus(r, 413);
    expect(/body too large/.test(r.json.error), r.text);
    r = await imp('b68', [entry('t'), { ...entry('long-title'), title: 'T'.repeat(201) }]);
    expectStatus(r, 413);
    // an entry at the cap is fine
    r = await imp('b68', [entry('at-cap', { body: 'z'.repeat(L.entryBody) })], { part: 2, of: 2 });
    expectStatus(r, 200);
    const slugs = of(await corpus(), 'b68').map((e) => e.slug).sort().join();
    expect(slugs === 'at-cap,fresh-1,fresh-2', 'b68 after the caps (nothing from a refused request): ' + slugs);
  });

  await step('size caps: 4000 entries and 8 MiB of text in a book, across chunks', async () => {
    const N = L.entriesPerRequest, P = L.bookEntries / N;
    let r = await imp('bitd', Array.from({ length: N }, (_, i) => entry('n0-' + i, { ord: i, body: 'p' })), { replace: true, part: 1, of: P + 1 });
    expectStatus(r, 200);
    for (let k = 1; k < P; k++) {
      r = await imp('bitd', Array.from({ length: N }, (_, i) => entry('n' + k + '-' + i, { ord: k * N + i, body: 'p' })), { part: k + 1, of: P + 1 });
      expectStatus(r, 200);
    }
    expect(r.json.count === 4000, 'count ' + r.json.count);
    r = await imp('bitd', [entry('one-too-many')], { part: P + 1, of: P + 1 });
    expectStatus(r, 413);
    expect(/too many entries in bitd/.test(r.json.error), r.text);
    // text: 8 MiB = 69 entries of 120 KiB (and a bit); sent 8 at a time under the 1 MiB request cap
    r = await imp('bitd', Array.from({ length: 8 }, (_, i) => entry('t0-' + i, { body: 'q'.repeat(L.entryBody) })), { replace: true, part: 1, of: 10 });
    expectStatus(r, 200);
    let sent = 8;
    for (let k = 1; k < 9; k++) {
      r = await imp('bitd', Array.from({ length: 8 }, (_, i) => entry('t' + k + '-' + i, { body: 'q'.repeat(L.entryBody) })), { part: k + 1, of: 10 });
      if (sent * L.entryBody + 8 * L.entryBody > L.bookBytes) { expectStatus(r, 413); expect(/is too large/.test(r.json.error), r.text); break; }
      expectStatus(r, 200);
      sent += 8;
    }
    expect(sent < 72, 'the byte cap stopped the book at ' + sent + ' entries');
    // put bitd back to a small book for the steps below
    r = await imp('bitd', [entry('alpha', { title: 'Placeholder alpha' }), entry('beta', { ord: 1 })], { replace: true });
    expectStatus(r, 200);
  });

  await step('house rules: GM PUT creates and replaces, players read them, DELETE removes (404 the second time)', async () => {
    let r = await gm('PUT', '/api/rules/house/lantern-rule', { title: 'Lantern rule', body: 'A made-up house ruling about lanterns.', keys: 'lamp' });
    expectStatus(r, 200);
    expect(r.json.entry.book === 'house' && r.json.entry.slug === 'lantern-rule' && r.json.entry.trail === 'House rules' && r.json.entry.title === 'Lantern rule', r.text);
    let c = await corpus();
    const h = of(c, 'house');
    expect(h.length === 1 && h[0].keys === 'lamp' && c.books.house === 1 && c.version === r.json.version, JSON.stringify(h));
    const v1 = c.version;
    r = await gm('PUT', '/api/rules/house/lantern-rule', { title: 'Lantern rule v2', body: 'Revised.', trail: 'Table rules' });
    expectStatus(r, 200);
    c = await corpus();
    expect(of(c, 'house').length === 1 && of(c, 'house')[0].title === 'Lantern rule v2' && of(c, 'house')[0].trail === 'Table rules' && c.version !== v1, 'replaced');
    expect(of(c, 'bitd').length === 2, 'other books untouched');
    r = await gm('DELETE', '/api/rules/house/lantern-rule');
    expectStatus(r, 200);
    expect(r.json.ok === true, r.text);
    c = await corpus();
    expect(of(c, 'house').length === 0 && c.version !== v1, 'deleted');
    expectStatus(await gm('DELETE', '/api/rules/house/lantern-rule'), 404);
    // DELETE only reaches house rules
    expectStatus(await gm('DELETE', '/api/rules/house/alpha'), 404);
    expect(of(await corpus(), 'bitd').length === 2, 'a book entry is not deleted through the house path');
  });

  await step('house rules: validation (400 / 413) and methods (405)', async () => {
    expectStatus(await gm('PUT', '/api/rules/house/Bad%20Slug', { title: 'x', body: 'y' }), 400);
    expectStatus(await gm('PUT', '/api/rules/house/ok', { body: 'no title' }), 400);
    expectStatus(await gm('PUT', '/api/rules/house/ok', { title: 'x', body: 7 }), 400);
    expectStatus(await call('PUT', '/api/rules/house/ok', { user: GM, raw: '[1]' }), 400);
    expectStatus(await gm('PUT', '/api/rules/house/ok', { title: 'x', body: 'y'.repeat(L.entryBody + 1) }), 413);
    expectStatus(await gm('GET', '/api/rules/house/ok'), 405);
    expectStatus(await gm('POST', '/api/rules'), 405);
    expectStatus(await gm('PUT', '/api/rules'), 405);
    expectStatus(await gm('GET', '/api/rules/import'), 405);
    expectStatus(await gm('DELETE', '/api/rules/import'), 405);
    expect(of(await corpus(), 'house').length === 0, 'no house rule kept');
  });

  await step('replace with no entries clears a book', async () => {
    const r = await imp('bitd', [], { replace: true });
    expectStatus(r, 200);
    expect(r.json.count === 0, r.text);
    const c = await corpus();
    expect(of(c, 'bitd').length === 0 && of(c, 'b68').length === 3, 'bitd gone, b68 kept');
  });

  await step('GET /api/export carries no rules (no key, none of the text), for the GM; a player is refused', async () => {
    await gm('PUT', '/api/rules/house/export-probe', { title: 'Export probe', body: 'A zebra-striped marker sentence that must never leave through a backup.' });
    const c = await corpus();
    expect(c.entries.length > 0, 'there are rules to leave out');
    const r = await gm('GET', '/api/export');
    expectStatus(r, 200);
    expect(!('rules' in r.json) && Object.keys(r.json).sort().join() === 'campaign,characters,exportedAt,members,npcs', 'keys ' + Object.keys(r.json));
    expect(!/zebra-striped|wobbling lantern|Placeholder|export-probe/.test(r.text), 'rule text in the export');
    expectStatus(await player('GET', '/api/export'), 403);
  });
}

const timer = setTimeout(async () => {
  console.log('FAIL overall timeout after ' + OVERALL_TIMEOUT_MS + ' ms');
  await stop();
  process.exit(1);
}, OVERALL_TIMEOUT_MS);

try {
  await main();
} catch (e) {
  failures++;
  console.log('FAIL setup\n     ' + (e && e.message || e));
}
clearTimeout(timer);
console.log('\n' + passes + ' passed, ' + failures + ' failed');
await stop();
process.exit(failures ? 1 : 0);
