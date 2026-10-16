// The table iPad's transcriber end to end (GM.md "Listening") against a real local Worker (wrangler dev) on PORT (default
// 8847): a fake microphone (Chromium's fake device), a stand-in for Deepgram's token endpoint on loopback, and Deepgram's
// live WebSocket replaced by the browser test (routeWebSocket). The GM presses Start listening; the iPad's display shows
// the tap; the tap opens the mic (the page's Permissions-Policy must allow it) and the socket; audio flows; two finished
// results come back as merged lines, posted to the server; the GM panel shows them with names; Stop closes it all.
//   PW_MODULE=<playwright 1.48+> PW_CHANNEL=msedge node checks/runtime/gm-stt.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8847), BASE = 'http://127.0.0.1:' + PORT, GM = 'gm@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

/* the stand-in for Deepgram's token endpoint */
const grants = [];
const fakeDg = http.createServer((req, res) => { grants.push(req.headers.authorization || ''); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ access_token: 'jwt-test', expires_in: 30 })); });
await new Promise((r) => fakeDg.listen(0, '127.0.0.1', r));
const GRANT = 'http://127.0.0.1:' + fakeDg.address().port + '/v1/auth/grant';

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-stt-e2e-'));
/* an invented pack (the fixture console and location parts), so the GM page opens */
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8')), locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const PACK_FILE = path.join(stateDir, 'pack.json');
writeFileSync(PACK_FILE, JSON.stringify({ format: 1, exportedAt: new Date().toISOString(), parts: { console: conFix.parts.console, campaign: conFix.parts.campaign,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: locFix.T, extra: locFix.extra } } }));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DEEPGRAM_API_KEY:test-key', '--var', 'DEEPGRAM_GRANT_URL:' + GRANT],
  { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); fakeDg.close(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 300000);

try {
  if (!await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 300)) throw new Error('server not ready');
  await api('PATCH', '/campaign', { session: { number: 9 } });
  const browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function open(hash, opts = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: opts.viewport || { width: 1280, height: 860 }, serviceWorkers: 'block', permissions: ['microphone'] });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return page;
  }

  /* the iPad, with Deepgram's live socket replaced */
  const ipad = await open('#display', { viewport: { width: 1180, height: 820 } });
  const dg = { opens: 0, protocols: [], audioBytes: 0, closed: false, ws: null };
  await ipad.context().routeWebSocket(/api\.deepgram\.com/, (ws) => {
    dg.opens++; dg.ws = ws; dg.url = ws.url();
    ws.onMessage((m) => { if (typeof m === 'string') { if (/CloseStream/.test(m)) dg.closed = true; } else dg.audioBytes += m.length; });
  });
  check(await ipad.waitForSelector('#display-page .dp-stages', { timeout: 20000 }).then(() => true, () => false), '#display is up');
  check(await ipad.$eval('.stt-tap', (b) => b.hidden), 'no listening button until the GM asks');

  /* the GM asks */
  const gm = await open('#gm');
  await gm.waitForSelector('#gm-file', { state: 'attached', timeout: 30000 });
  await gm.setInputFiles('#gm-file', PACK_FILE);
  await gm.waitForSelector('[data-gm="upload"]:not([disabled])', { timeout: 10000 });
  await gm.click('[data-gm="upload"]');
  await gm.waitForSelector('#gm-root', { timeout: 30000 });
  await gm.keyboard.press('i');
  await gm.waitForSelector('[data-gm="stt-on"]', { timeout: 15000 });
  await gm.click('[data-gm="stt-on"]');
  await gm.waitForSelector('#gm-stt-s0', { state: 'visible', timeout: 10000 });   /* "Who is who" opens while listening is on */
  await gm.fill('#gm-stt-s0', 'Alex (GM)'); await gm.click('.gm-stt .gm-band');
  const ctl = await until(async () => { const r = await api('GET', '/gm/stt'); return r.json && r.json.doc.want === 'on' && r.json.doc.speakers['0'] ? r.json.doc : null; }, 8000);
  check(!!ctl && ctl.session === '9' && ctl.speakers['0'] === 'Alex (GM)', 'Start listening: want on, session 9, the name saved');

  check(await ipad.waitForSelector('.stt-tap:not([hidden])', { timeout: 15000 }).then(() => true, () => false), 'the iPad shows "Tap to start listening"');
  await ipad.click('.stt-tap');
  check(await until(() => dg.opens > 0, 15000), 'the tap opens the mic and the live socket (the page may use the mic)');
  check(/encoding=linear16/.test(dg.url || '') && /sample_rate=16000/.test(dg.url || ''), 'raw 16 kHz PCM is asked for');
  check(grants.length >= 1 && grants[0] === 'Token test-key', 'the token came from the Worker, with the key only on the server');
  check(await until(() => dg.audioBytes > 16000, 15000), 'audio flows (' + dg.audioBytes + ' bytes)');
  check(await ipad.waitForSelector('.stt-pill:not([hidden])', { timeout: 10000 }).then(() => true, () => false), 'the table can see "Listening"');

  /* Deepgram answers: two finished results, the second split between two speakers */
  const res = (words) => JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: words.map((w) => w[0]).join(' '), words: words.map((w) => ({ word: w[0], punctuated_word: w[0], speaker: w[1], start: w[2], end: w[2] + 0.3 })) }] } });
  dg.ws.send(res([['The', 0, 0.1], ['fog', 0, 0.5], ['rolls', 0, 0.9], ['in.', 0, 1.2]]));
  dg.ws.send(res([['Again', 0, 2.0], ['tonight.', 0, 2.4], ['Who', 1, 3.0], ['knocks?', 1, 3.3]]));
  const lines = await until(async () => { const r = await api('GET', '/gm/transcript?after=0'); return r.json && r.json.lines.length >= 2 ? r.json.lines : null; }, 20000, 500);
  check(!!lines && lines[0].text === 'The fog rolls in. Again tonight.' && lines[0].speaker === 0 && lines[1].text === 'Who knocks?' && lines[1].speaker === 1 && lines[0].session === '9',
    'finished words merge into lines by speaker and reach the server: ' + JSON.stringify((lines || []).map((l) => [l.speaker, l.text])));
  check(await gm.waitForFunction(() => /Alex \(GM\)\s*The fog rolls in/.test((document.querySelector('.gm-stt-tail') || {}).textContent || ''), null, { timeout: 15000 }).then(() => true, () => false), 'the GM panel shows the tail with names');
  check(/waiting for the PC/.test(await gm.textContent('.gm-stt-pc').catch(() => '')), 'no heartbeat from the PC yet: the panel says it is waiting for it');
  check(await until(async () => { const r = await api('GET', '/gm/stt'); return r.json && r.json.doc.status.state === 'listening' && r.json.doc.status.lines >= 2; }, 15000, 500), 'the iPad reports listening, and lines sent');

  /* Stop */
  await gm.click('[data-gm="stt-off"]');
  check(await until(() => dg.closed, 15000), 'Stop: the iPad asks Deepgram to finish (CloseStream)');
  check(await ipad.waitForSelector('.stt-pill', { state: 'hidden', timeout: 15000 }).then(() => true, () => false), 'Stop: "Listening" goes away on the iPad');
  check(await until(async () => { const r = await api('GET', '/gm/stt'); return r.json && r.json.doc.status.state === 'stopped'; }, 15000, 500), 'Stop: the iPad reports stopped');
  check((await api('GET', '/export')).json && !JSON.stringify((await api('GET', '/export')).json).includes('fog rolls'), 'the transcript is not in "Download everything"');

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) { console.log('FAIL ' + (e && e.stack || e)); failed++; }
clearTimeout(timeout);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
