// Offline end-to-end check of the hosted build against a real local server (wrangler dev, DEV_USER):
// the service worker takes control, a character is filed and ticked online, then with the browser offline the
// page reloads from the cache and shows the last-seen data, a tick made offline waits in the queue (the header
// says so) and lands on the server once the browser is back online. Also: the manifest is served and valid,
// and there are no console errors while online.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/offline.e2e.mjs      (PORT=8790 by default)
import { spawn, spawnSync } from 'node:child_process';
const WIN = process.platform === 'win32';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8790);
const BASE = 'http://127.0.0.1:' + PORT;
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- our own server (only this process group is ever signalled) ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-offline-check-'));
const server = spawn(path.join(ROOT, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1',
  '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false', '--persist-to', stateDir, '--log-level', 'warn',
  '--var', 'DEV_USER:gm@example.test', '--var', 'GM_EMAILS:gm@example.test'],
{ cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { WIN ? spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }) : process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

async function serverDoc(id) {
  const r = await fetch(BASE + '/api/characters/' + encodeURIComponent(id), { cache: 'no-store' });
  return r.ok ? (await r.json()).doc : null;
}

const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 240000);

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).ok; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);

  // the manifest, as the browser would fetch it
  const mr = await fetch(BASE + '/manifest.webmanifest');
  let manifest = null; try { manifest = await mr.json(); } catch (_) {}
  check(mr.ok && manifest && manifest.name === "Blades '68" && manifest.display === 'standalone' && manifest.start_url === './', 'manifest served and valid (' + mr.status + ', ' + mr.headers.get('content-type') + ')');
  for (const i of (manifest && manifest.icons) || []) {
    const ir = await fetch(new URL(i.src, BASE + '/').href);
    check(ir.ok && (ir.headers.get('content-type') || '').startsWith(i.type), 'icon ' + i.src + ' served as ' + ir.headers.get('content-type'));
  }

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const online = { errors: [] };
  let phase = 'online';
  // (a request that went out while offline may be reported a moment after the network is back: that is not an error online)
  page.on('console', (m) => { if (m.type() === 'error' && phase === 'online' && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) online.errors.push(m.text()); });
  page.on('pageerror', (e) => online.errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());

  await page.goto(BASE + '/#new');                // the creator (no hash is Home)
  const controlled = await until(() => page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)), 15000);
  check(controlled, 'the service worker controls the page');
  const head = await page.evaluate(() => ({
    manifest: (document.querySelector('link[rel="manifest"]') || {}).outerHTML || null,
    theme: (document.querySelector('meta[name="theme-color"]') || {}).content || null,
    apple: !!document.querySelector('link[rel="apple-touch-icon"]'),
  }));
  check(head.manifest && /crossorigin="use-credentials"/.test(head.manifest) && head.theme === '#14110e' && head.apple, 'manifest link, theme colour and touch icon in the page: ' + JSON.stringify(head));
  const cached = await until(() => page.evaluate(async () => { const ks = await caches.keys(); if (!ks.length) return null; const c = await caches.open(ks[0]); const p = (await c.keys()).map((r) => new URL(r.url).pathname); return p.includes('/display-page.js') ? p : null; }), 15000);   // install brings the core and table; /api/me saying GM brings gm and display by the page's message
  check(cached && cached.includes('/') && cached.includes('/boot.js') && cached.includes('/fonts/SpaceMono-Regular.woff2') && !cached.some((p) => p.startsWith('/api/')), 'app shell precached (' + (cached || []).length + ' files), no /api/');
  check(cached && ['/campaign.js', '/season.js', '/gm-page.js', '/gm/console.js', '/display-page.js', '/gm.css'].every((f) => cached.includes(f)), 'the GM page and the display bundle (app/routes.js) are precached too, though the page never asked for them: this user is the GM, so the page asked the worker for them');
  const cachedPage = await page.evaluate(async () => { const ks = await caches.keys(); const c = await caches.open(ks[0]); const r = await c.match(location.origin + '/'); return r ? (await r.text()).slice(0, 200) : null; });
  check(cachedPage && /^<!doctype html><meta charset=utf-8><meta name=viewport /i.test(cachedPage), 'the cached page carries the Worker\'s doctype and viewport: ' + JSON.stringify((cachedPage || '').slice(0, 60)));
  check(await page.evaluate(() => document.compatMode === 'CSS1Compat' && !!document.querySelector('meta[name="viewport"]')), 'online: standards mode with a viewport meta');

  // file a character through the app, as app/checks/e2e.js does, then tick a stress box
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me);
  await page.click('.pb[data-id="hound"]'); await sleep(400);
  await page.evaluate(() => { const S = B68.S, CT = B68.CT, pb = CT.byId.hound; S.sheet.name = 'Offline Olly'; S.sheet.alias = 'Signal'; S.sheet.heritage = 'Akoros'; S.sheet.background = 'Underworld'; S.sheet.dots = { Survey: 1, Consort: 2, Hunt: 2, Prowl: 1, Skirmish: 1 }; S.sheet.ability = pb.abilities[0][0]; S.sheet.keys = pb.keys.slice(0, 2); S.sheet.contacts = {}; S.sheet.contacts[pb.contacts[0][0] + ', ' + pb.contacts[0][1]] = 'friend'; S.sheet.contacts[pb.contacts[1][0] + ', ' + pb.contacts[1][1]] = 'friend'; S.sheet.contacts[pb.contacts[2][0] + ', ' + pb.contacts[2][1]] = 'rival'; S.sheet.vice = 'Gambling'; S.sheet.purveyor = 'The Silver Stag'; S.sheet.items = [pb.items[0][0]]; S.sheet.cohortType = 'hound dog'; S.sheet.cohortName = 'Biscuit'; B68.syncNameToSpec(); B68.changed(); });
  await page.click('#rail button:nth-child(16)'); await sleep(300);
  await page.click('#fileRoster');
  const id = await until(() => page.evaluate(() => { const m = location.hash.match(/^#c\/(.+)$/); return m && document.body.dataset.mode === 'sheet' ? decodeURIComponent(m[1]) : null; }), 10000);
  check(!!id, 'filed and opened the sheet: ' + id);
  const stressButtons = '#dossier .ds-stress button, #dossier [data-stress]';
  await page.waitForSelector(stressButtons);
  await page.evaluate((sel) => document.querySelectorAll(sel)[2].click(), stressButtons);
  const s1 = await until(async () => { const d = await serverDoc(id); return d && d.play && d.play.stress > 0 ? d.play.stress : null; }, 10000);
  check(s1 > 0, 'online tick saved: stress ' + s1);
  await sleep(2600);                              // past the snapshot throttle
  const snapKey = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('b68.cf.') && !k.endsWith('#queue') && k !== 'b68.cf.last'));
  check(snapKey.length === 1, 'snapshot in localStorage: ' + snapKey);
  check(online.errors.length === 0, 'no console errors online' + (online.errors.length ? ': ' + online.errors.join(' | ') : ''));

  // offline: reload from the cache, the last-seen data, a tick that waits
  phase = 'offline';
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  const who = await until(() => page.evaluate(() => { const w = document.getElementById('whoami'); return w && /Offline/.test(w.textContent) ? w.textContent : null; }), 15000);
  check(!!who, 'app shell loaded offline, header says: ' + who);
  check(await page.evaluate(() => document.compatMode === 'CSS1Compat' && document.characterSet === 'UTF-8' && /width=device-width/.test((document.querySelector('meta[name="viewport"]') || {}).content || '')), 'offline: the cached page is in standards mode too (doctype, charset, viewport)');
  const sheet = await until(() => page.evaluate((args) => document.body.dataset.mode === 'sheet' && document.querySelector(args.sel) ? document.querySelector('#dossier').textContent.includes('Offline Olly') : null, { sel: stressButtons }), 10000);
  check(!!sheet, 'the sheet opened offline with the last-seen character');
  const local = async () => page.evaluate(async (cid) => (await (await window.claude.use('db')).collection('characters').doc(cid).get()).data().play.stress, id);
  check((await local()) === s1, 'offline sheet shows the saved stress (' + s1 + ')');
  await page.evaluate((sel) => document.querySelectorAll(sel)[4].click(), stressButtons);
  const s2 = await local();
  check(s2 !== s1, 'offline tick applied locally: stress ' + s1 + ' -> ' + s2);
  const waiting = await until(() => page.evaluate(() => { const w = document.getElementById('whoami').textContent; return /1 change waiting/.test(w) ? w : null; }), 5000);
  check(!!waiting, 'header: ' + (waiting || (await page.evaluate(() => document.getElementById('whoami').textContent))));
  const st = await page.evaluate(() => window.B68Runtime.status);
  check(st.online === false && st.pending === 1, 'status offline with 1 pending: ' + JSON.stringify(st));
  check((await serverDoc(id)).play.stress === s1, 'server still has the old value while offline');
  // a route whose files load on first use (app/routes.js) opens offline too: its bundle comes from the precache
  await page.evaluate(() => { location.hash = '#t'; });
  const table = await until(() => page.evaluate(() => { const t = document.getElementById('table-page'); return t && !t.hidden && window.B68Campaign && t.querySelector('.tp-head, .tp-note') && !/Could not load/.test(t.textContent) ? t.textContent.trim().slice(0, 40) : null; }), 15000);
  check(!!table, 'offline: the table, a lazily loaded route, opens from the precache: ' + JSON.stringify(table));

  // back online: the queued write lands
  phase = 'online';
  await ctx.setOffline(false);
  const landed = await until(async () => { const d = await serverDoc(id); return d && d.play.stress === s2; }, 20000, 250);
  check(landed, 'the offline change reached the server after reconnecting (stress ' + s2 + ')');
  const synced = await until(() => page.evaluate(() => { const s = window.B68Runtime.status; const w = document.getElementById('whoami').textContent; return s.online && s.pending === 0 && !/Offline|waiting|Saving/.test(w) ? w : null; }), 10000);
  check(!!synced, 'header back to normal: ' + synced);
  check(online.errors.length === 0, 'no console errors after reconnecting' + (online.errors.length ? ': ' + online.errors.join(' | ') : ''));

  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timeout);
  killServer('SIGTERM');
  const t0 = Date.now(); while (server.exitCode === null && server.signalCode === null && Date.now() - t0 < 5000) await sleep(100);
  killServer('SIGKILL');
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
