// Typed commands in the Ask bar (ticket C4f; app/cue.js fromTyped, gm-page.js cogmTyped, assist-panel.js ask). Text starting "Blade," or "/" is POSTed to the transcript as a line tagged
// conn 'typed' and then goes down the cue lane (POST /act in cue mode) instead of to Ask. The Worker, table and transcript are REAL (no model, $0); only the panel's tick/cards/ask are faked.
// Every name and sentence is invented.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=8950] node checks/runtime/gm-typed.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8950);
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

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-typed-e2e-'));
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
const seen = { ask: 0, act: [], responses: [], requests: [], dialogs: [], accept: true, promptText: '', delayAct: 0, modelReply: null };
const lands = [];          // cue-to-card times (ms), for the report

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
  const display0 = (await api('GET', '/gm/display')).json.display.kind;
  const errors = [];
  const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // the panel's own tick and cards have no model here; /act is the REAL Worker for a parsed cue, and a fake only for the model path (a cue the page could not parse)
  await c.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: seen.capped ? Object.assign({}, SPEND, { tonight: 20, tier: 'off' }) : SPEND, last: 9 }));
  await c.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [] }));
  await c.route('**/api/gm/assist/ask', (route) => { seen.ask++; return json(route, { error: 'no model in this check' }, 500); });
  await c.route('**/api/gm/assist/act', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (seen.delayAct) await sleep(seen.delayAct);
    if (!body.parsed && seen.modelReply) { const r = seen.modelReply; seen.modelReply = null; return json(route, r); }
    return route.continue();
  });
  // The page's own heat/wanted sync PATCHes the ambient document with { crew: { heat, wanted } } two seconds after the table loads, whatever the GM does (makeCrewSync in gm-page.js).
  // It is not the cue lane, so it is left out of the ledger; any other ambient or display write counts.
  const crewSyncOnly = (rq) => {
    if (rq.method() !== 'PATCH' || !/\/api\/gm\/ambient$/.test(rq.url())) return false;
    let b = null; try { b = JSON.parse(rq.postData() || 'null'); } catch (_) { return false; }
    return !!b && typeof b === 'object' && Object.keys(b).join() === 'crew' && !!b.crew && Object.keys(b.crew).every((k) => (k === 'heat' || k === 'wanted') && typeof b.crew[k] === 'number');
  };
  const wire = (page, n) => {
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('p' + n + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push('p' + n + ' pageerror: ' + e.message));
    page.on('request', (r) => {
      if (!r.url().startsWith(BASE + '/api/')) return;
      if (!crewSyncOnly(r)) seen.requests.push(n + ' ' + r.method() + ' ' + r.url().slice(BASE.length));
      if (r.method() === 'POST' && /\/api\/gm\/assist\/act$/.test(r.url())) seen.act.push({ page: n, body: JSON.parse(r.postData() || '{}'), at: Date.now() });
    });
    page.on('response', async (r) => {
      if (r.request().method() === 'POST' && /\/api\/gm\/assist\/act$/.test(r.url())) { try { seen.responses.push({ page: n, status: r.status(), body: await r.json(), at: Date.now() }); } catch (_) {} }
    });
    page.on('dialog', (d) => { seen.dialogs.push(d.type() + ': ' + d.message()); if (d.type() === 'prompt') return d.accept(seen.promptText); return seen.accept ? d.accept() : d.dismiss(); });
  };
  await c.addInitScript(() => {
    let A; Object.defineProperty(window, 'B68GmAssist', { configurable: true, get() { return A; },
      set(v) { A = v && v.create ? Object.assign({}, v, { create(o) { const ctl = v.create(o); window.__ctl = ctl; return ctl; } }) : v; } });
  });
  const open = async (n) => {
    const page = await c.newPage(); wire(page, n);
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await page.keyboard.press('a');
    await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 });
    return page;
  };
  const page = await open(1);
  const sw = '#as-cogm';
  const cards = (pg = page) => pg.$$eval('#as-list .as-card[data-id^="cogm|"]', (l) => l.map((x) => ({ id: x.getAttribute('data-id'), kind: x.getAttribute('data-kind'), text: x.querySelector('.as-text').textContent, html: x.innerHTML,
    acts: [...x.querySelectorAll('.as-act')].map((b) => b.textContent.trim()) })));
  const cardLike = async (re, ms = 6000, pg = page) => until(async () => (await cards(pg)).find((x) => re.test(x.text)), ms, 50);
  const actsNow = () => seen.act.length;
  const toastText = () => page.$$eval('.toast, #toast, [role="status"]', (l) => l.map((x) => x.textContent).join(' | '));
  const switchOn = async (pg = page) => { await pg.click(sw); return until(() => pg.$eval(sw, (b) => b.getAttribute('aria-pressed') === 'true'), 6000); };
  const T = (patch) => page.evaluate((p) => Object.assign(window.B68GmCogm.TIMING, p), patch);

  const typedRows = async () => ((await api('GET', '/gm/transcript?tail=50')).json.lines || []).filter((l) => l.conn === 'typed');
  const type = async (text) => { await page.fill('#as-ask-q', text); await page.press('#as-ask-q', 'Enter'); };
  const lastAct = () => seen.act[seen.act.length - 1];
  const SW = '#as-cogm';
  const coOn = () => page.$eval(SW, (b) => b.getAttribute('aria-pressed') === 'true');

  // ============ 1. "/clock 6 Quillmoth" with co-GM OFF: typed commands still work ============
  check(!(await coOn()), 'start: co-GM is off');
  await type('/clock 6 Quillmoth');
  const k1 = await until(() => clockNamed('Quillmoth').then((x) => x || clocksNow().then((l) => l.find((k) => /^Quillmoth$/i.test(k.name)))), 8000, 100);
  const tr1 = await typedRows();
  check(!!k1 && k1.size === 6 && k1.hidden === true && k1.filled === 0, 'co-GM off: "/clock 6 Quillmoth" makes a hidden 6 clock called Quillmoth: ' + JSON.stringify(k1 && { n: k1.name, s: k1.size, h: k1.hidden }));
  check(tr1.length === 1 && tr1[0].text === 'Blade, make a 6 clock called Quillmoth' && tr1[0].speaker === null && tr1[0].kind === 'line', 'the typed command is a transcript line tagged conn typed, speaker null, text the mapped cue sentence: ' + JSON.stringify(tr1.map((l) => l.text)));
  check(seen.act.length === 1 && seen.act[0].body.mode === 'cue' && seen.act[0].body.cueLineId === tr1[0].id && seen.act[0].body.from === tr1[0].seq && seen.act[0].body.to === tr1[0].seq && Array.isArray(seen.act[0].body.parsed),
    '/act was called once in cue mode, parsed, cueLineId = the typed line\'s id, range = its seq');
  check(seen.ask === 0 && !seen.requests.some((r) => /assist\/ask/.test(r)), 'no Ask call for a typed command');
  check(!seen.requests.some((r) => /\/api\/gm\/transcript\?after=/.test(r)), 'co-GM off: the page still does not poll the transcript');
  check((await page.inputValue('#as-ask-q')) === '', 'the field is cleared once it was sent');

  // ============ 2. "/tick Quillmoth 2" with co-GM ON ============
  check(await switchOn(), 'co-GM switches on');
  await sleep(2300);
  const before2 = seen.act.length;
  await type('/tick Quillmoth 2');
  const k2 = await until(async () => { const k = (await clocksNow()).find((x) => /^Quillmoth$/i.test(x.name)); return k && k.filled === 2 ? k : null; }, 8000, 100);
  await sleep(2500);
  const tr2 = (await typedRows()).filter((l) => l.text === 'Blade, tick Quillmoth 2');
  const acts2 = seen.act.slice(before2);
  check(!!k2, 'co-GM on: "/tick Quillmoth 2" fills 2 on Quillmoth');
  check(tr2.length === 1 && acts2.length === 1 && acts2[0].body.cueLineId === tr2[0].id && acts2[0].body.mode === 'cue', 'one typed line, ONE /act call (the poll did not run it again), cueLineId = its id');
  check(seen.ask === 0, 'no Ask call for /tick');

  // ============ 3. "/npc Pembrake, a nervous lamp salesman" ============
  await sleep(2300);
  const before3 = seen.act.length;
  await type('/npc Pembrake, a nervous lamp salesman');
  const n3 = await until(async () => (await npcsNow()).find((n) => /^Pembrake$/i.test(n.doc.name)), 8000, 100);
  await sleep(2500);
  const tr3 = (await typedRows()).filter((l) => l.text === 'Blade, new NPC called Pembrake, a nervous lamp salesman');
  const acts3 = seen.act.slice(before3);
  check(!!n3 && n3.doc.revealed === false, 'co-GM on: "/npc Pembrake, a nervous lamp salesman" makes a hidden NPC called Pembrake: ' + JSON.stringify(n3 && { name: n3.doc.name, revealed: n3.doc.revealed, role: n3.doc.role }));
  check(tr3.length === 1 && acts3.length === 1 && acts3[0].body.cueLineId === tr3[0].id, 'one typed line and one /act call for /npc, cueLineId = its id');

  // ============ 4. "Blade, ..." typed, a cap, an unknown slash, and a plain question ============
  await sleep(2300);
  const before4 = seen.act.length;
  await page.fill('#as-ask-q', 'Blade, tick Quillmoth'); await Promise.all([page.press('#as-ask-q', 'Enter'), page.press('#as-ask-q', 'Enter')]);
  const k4 = await until(async () => { const k = (await clocksNow()).find((x) => /^Quillmoth$/i.test(x.name)); return k && k.filled === 3 ? k : null; }, 8000, 100);
  await sleep(2500);
  check(!!k4 && (await clocksNow()).find((x) => /^Quillmoth$/i.test(x.name)).filled === 3 && seen.act.length === before4 + 1 && (await typedRows()).filter((l) => l.text === 'Blade, tick Quillmoth').length === 1, '"Blade, tick Quillmoth" typed, Enter pressed twice at once: one line, one /act, one tick');
  const typedBefore = (await typedRows()).length, actBefore = seen.act.length;
  await type('/frobnicate now');
  const grey = await cardLike(/don.t know the command/i, 4000);
  await sleep(500);
  check(!!grey && (await typedRows()).length === typedBefore && seen.act.length === actBefore, 'an unknown slash shows a grey card and posts nothing');
  const askBefore = seen.ask;
  await type('What does a four clock mean?');
  await until(() => seen.ask > askBefore, 4000, 50);
  check(seen.ask === askBefore + 1, 'a plain question still goes to Ask');
  seen.capped = true;
  await page.evaluate(() => window.__ctl.poll());
  check(await until(() => page.$eval('#as-state', (e) => e.getAttribute('data-state') === 'off'), 6000), 'cap: the panel header says Off');
  await sleep(2300);
  const before5 = seen.act.length;
  check(await page.$eval('#as-ask-go', (b) => b.disabled) === true, 'cap: Ask itself is disabled for a question'); await page.fill('#as-ask-q', '/tick Quillmoth'); check(await page.$eval('#as-ask-go', (b) => !b.disabled), 'cap: the button is enabled for a typed command'); await page.press('#as-ask-q', 'Enter');
  const k5 = await until(async () => { const k = (await clocksNow()).find((x) => /^Quillmoth$/i.test(x.name)); return k && k.filled === 4 ? k : null; }, 8000, 100);
  check(!!k5 && seen.act.length === before5 + 1, 'typed and parsed, it still acts when the panel is capped (seen.capped=' + seen.capped + ')');
  check(errors.filter((e) => !/status of 500/.test(e)).length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await c.close();
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
