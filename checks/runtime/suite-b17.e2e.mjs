// Suite B17 smoke on the real GM page and Worker (map.stage, map.security, face.spotlight). Everything built is on (N0): a stored false changes nothing; the Map box carries the
// panel with the security line, the stage panel and the stage bar, a tap on Freeze and Blank works, and nothing throws. Every name is invented. No model, $0.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=8953] node checks/runtime/suite-b17.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8953);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', PLAYER = 'player@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-b09-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const clocksNow = async (user = GM) => ((await api('GET', '/campaign', null, user)).json.doc.clocks || []);
const clockNamed = async (name) => (await clocksNow()).find((k) => k.name === name) || null;
const npcsNow = async (user = GM) => ((await api('GET', '/npcs', null, user)).json.docs || []);
const SPEND = { tonight: 0.3, cap: 20, tier: 'all', tick: 0.02 };
const med = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };

// the transcript is REAL: rows posted to the Worker. say() returns the row's id, its seq and the time it was posted.
let lineN = 0;
async function say(text, opts = {}) {
  const id = 'cue-' + Date.now().toString(36) + '-' + (++lineN);
  const row = { id, at: opts.at || new Date().toISOString(), session: '1', conn: 'c1', speaker: opts.speaker === undefined ? 0 : opts.speaker, kind: 'line', text };
  const t = Date.now();
  const r = await api('POST', '/gm/transcript', { lines: [row] });
  if (r.status !== 200) throw new Error('transcript POST -> ' + r.status + ' ' + JSON.stringify(r.json));
  return { id, seq: r.json.last, t, text };
}
const seen = { requests: [] };

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_seed', name: 'Seed Clock Invented', size: 6, filled: 2, kind: 'danger', hidden: false }], log: [] });
  await api('PUT', '/npcs/npc_known', { name: 'Marta Quillfeather', role: 'invented', revealed: true, firstSeen: new Date().toISOString() });
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await c.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  const FEATS = (on) => ({ features: { 'map.stage': on, 'map.security': on, 'face.spotlight': on } });
  const roll = async () => {
    await page.goto(BASE + '/#gm');
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await page.keyboard.press('b'); await page.click('[data-gm="locroll"]'); await page.waitForSelector('#gm-loc .gm-loccard', { timeout: 10000 });
    await page.waitForSelector('#gm-loc .gm-mapbox', { timeout: 10000 });
  };
  // 1. a stored false (the old All off) changes nothing: the box is drawn
  await api('PATCH', '/gm/state', FEATS(false));
  await roll();
  check(!!(await until(() => page.$('#gm-b17'), 8000)), 'a stored false changes nothing: the B17 box is under the Map heading');
  // 2. a stored true (what the Switchboard used to write) is the same
  await api('PATCH', '/gm/state', FEATS(true));
  await page.reload(); await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await page.keyboard.press('b'); await page.waitForSelector('#gm-loc .gm-mapbox', { timeout: 10000 }).catch(() => {});
  if (!(await page.$('#gm-loc .gm-mapbox'))) { await page.click('[data-gm="locroll"]'); await page.waitForSelector('#gm-loc .gm-mapbox', { timeout: 10000 }); }
  const box = await until(() => page.$('#gm-b17'), 8000);
  check(!!box, 'a stored true: the B17 box is under the Map heading');
  const txt = box ? await box.innerText() : '';
  check(/Stage/i.test(txt) && /Security/i.test(txt) && /Stage bar/i.test(txt), 'the stage panel, the security line and the stage bar are drawn: ' + txt.replace(/\s+/g, ' ').slice(0, 120));
  check(/next level:/.test(txt), 'the GM line says next level');
  await page.click('[data-b17="sec-up"]'); await sleep(200);
  check(/Watchful/.test(await (await page.$('#gm-b17')).innerText()), 'stepping the security level by hand moves it');
  await page.click('[data-b17="freeze"]'); await sleep(200);
  check(/FROZEN/.test(await (await page.$('#gm-b17')).innerText()), 'Freeze shows FROZEN');
  await page.click('[data-b17="freeze"]');
  const disp0 = JSON.stringify((await api('GET', '/gm/display')).json.display || {});
  check(disp0.indexOf('GM-ONLY') < 0, 'nothing staged or secret in the display GET');
  check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await api('PATCH', '/gm/state', FEATS(false));
  await c.close();
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
