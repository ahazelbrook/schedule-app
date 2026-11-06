// The stamp before the roll, the consequence sizer and the strict cue grammar (suite 1.3, 1.4, A2; app/gm/stamp.js, app/gm/cue-grammar.js) on the real GM page, Worker and
// ambient document: the Roll's stamp (N4: position, effect and the line set, then Stamp it on the iPad; there with nothing stored: everything built is on, N0), the report card
// on the display route, the sizer's strip under the card after a 4/5, Esc one thing per press through gm/esc.js, a typed cue with its Undo toast, "didn't catch that", and a
// stored false that changes nothing. No model, $0; only the panel's tick/cards/ask are faked. Every name is invented.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9030] node checks/runtime/gm-stamp.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9030);
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

  const FEATS = (on) => ({ features: { 'spine.stamp': on, 'spine.sizer': on, 'ai.grammar': on } });
  const ambientDoc = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return j.doc || (j.ambient && j.ambient.doc) || {}; };
  const ovKind = async () => { const d = await ambientDoc(); return d.overlay ? d.overlay.kind : ''; };
  const toasts = () => page.$$eval('.gm-ugtoast, .toast, #toast, [role="status"]', (l) => l.map((x) => x.textContent).join(' | '));
  const reopen = async () => { await page.reload(); await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 }); };

  // ============ 1. nothing stored: the Roll's stamp is there (N0: everything built is on) ============
  const STAMP = '#gm-stamp [data-gm="stamp"]', SIZER = '#gm-card #gm-sz:not([hidden])';
  check(!!(await until(() => page.$(STAMP), 8000)), 'nothing stored: the Roll offers Stamp it on the iPad');
  // ============ 2. a stored true (what the Switchboard used to write) is the same ============
  await api('PATCH', '/gm/state', FEATS(true));
  await reopen();
  check(!!(await until(() => page.$(STAMP), 8000)), 'a stored true: the same');
  await page.fill('#gm-c-threat', 'Wren Tully turns round');
  await page.click('#gm-pos [data-v="risky"]');
  check((await ovKind()) === '', 'a position stamps nothing');
  await page.click('#gm-eff [data-v="standard"]');
  await sleep(400);
  check((await ovKind()) === '', 'and nor does an effect (since N4 the effect is picked, never a trigger)');
  await page.click(STAMP);
  check(!!(await until(async () => (await ovKind()) === 'report', 6000)), 'Stamp it on the iPad puts the report card on the display route');
  const od = (await ambientDoc()).overlay || {};
  check(od.payload && od.payload.position === 'risky' && od.payload.effect === 'standard' && od.payload.text === 'Wren Tully turns round' && od.ms === 180000, 'its payload: ' + JSON.stringify(od.payload));
  check(!!(await until(async () => Object.values((((await api('GET', '/gm/state')).json.doc || {}).night || {}).log || {}).some((e) => e.k === 'stamp' && /^Stamp: risky, standard - Wren Tully turns round/.test(e.text)), 6000)), 'the stamp is in night.log');
  check(/On the iPad/.test(await page.textContent('#gm-stamp')) && !!(await page.$('#gm-stamp [data-gm="stamp-down"]')), 'the Roll says it is on the iPad, with Take it down');
  check(((await api('GET', '/gm/state')).json.doc.con || {}).live.threat === 'Wren Tully turns round', 'the line is the console’s Threat on screen: one value');
  await page.click('#gm-buttons [data-gm="situation"][data-n="2"]');
  check(!!(await until(async () => (await ovKind()) === '', 6000)), 'a 4/5 marked: the card comes down');
  check(!!(await until(() => page.$(SIZER), 4000)), 'and the sizer’s strip is offered under the card’s header');
  const full = await page.$eval('#gm-card #gm-sz', (e) => e.textContent);
  check(/Full size for risky/.test(full), 'at full size for the stamped position: ' + full.slice(0, 120));
  check(/Wren Tully turns round/.test(await page.textContent('#gm-card .gm-lead')) && !/Wren Tully turns round/.test(full), 'the card’s lead spends the line, so the strip does not say it again');
  check(!!(await until(async () => (await page.inputValue('#gm-c-threat')) === '' && ((await api('GET', '/gm/state')).json.doc.con || {}).live.threat === '', 4000)), 'the threat landed: the Roll’s line is spent (field and store)');
  check(!!(await page.$('#gm-card .gm-card-acts [data-gm="sz-reduce"]')) && !(await page.$('#gm-card #gm-sz button')), 'Reduce is on the card’s actions row, the strip holds no button');
  await page.click('#gm-card [data-gm="sz-reduce"]');
  check(/Full size for risky/.test(await page.$eval('#gm-card #gm-sz', (e) => e.textContent)), 'one tap does not reduce');
  await page.click('#gm-card [data-gm="sz-reduce"]');
  check(/Reduced to controlled/.test(await page.$eval('#gm-card #gm-sz', (e) => e.textContent)), 'the second tap reduces one step');
  await page.click('#gm-card [data-gm="sz-done"]');
  check(!(await page.$(SIZER)) && !(await page.$('#gm-card [data-gm="sz-done"]')), 'Hide size puts the strip and its buttons away');
  await api('PATCH', '/gm/ambient', { layer: { path: 'band.phase', value: 'plan' } });
  await page.click('#gm-pos [data-v="desperate"]'); await page.click('#gm-eff [data-v="limited"]'); await page.click(STAMP);
  check(!!(await until(async () => (await ovKind()) === 'report', 6000)), 'a second stamp is up');
  check(await page.evaluate(() => !!window.B68GmEsc && window.B68GmEsc.list().some((e) => e.id === 'stamp' && e.kind === 'stamp' && e.open)), 'the stamp is the one Esc’s stamp entry (gm/esc.js), open while it is up');
  /* one Esc, one thing (the night design's one Esc): an open Blade panel closes first, and only the next press takes the stamp down */
  const panelOpen = () => page.evaluate(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  if (await panelOpen()) {
    await page.keyboard.press('Escape'); await sleep(600);
    check(!(await panelOpen()) && (await ovKind()) === 'report', 'the first Esc closes the Blade panel and leaves the stamp up');
  }
  await page.keyboard.press('Escape');
  check(!!(await until(async () => (await ovKind()) === '', 6000)), 'Esc takes it down');
  check(JSON.stringify((await ambientDoc()).layers || {}).includes('plan'), 'and leaves the band layer as it was');

  // ============ 3. the cue grammar, typed in the Ask bar ============
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 });
  /* N4-fix: the 4/5 above spent the line, so a bare cue puts no old threat back on the iPad */
  await type('Blade, risky, standard');
  const bare = await until(async () => { const d = await ambientDoc(); return d.overlay && d.overlay.kind === 'report' ? d.overlay : null; }, 8000);
  check(!!bare && bare.payload.position === 'risky' && !bare.payload.text, 'after a landed threat, a bare "Blade, risky, standard" stamps no old line: ' + JSON.stringify(bare && bare.payload));
  await until(() => page.$('.gm-ugtoast [data-ug="undo"]'), 4000);
  await page.click('.gm-ugtoast [data-ug="undo"]');
  check(!!(await until(async () => (await ovKind()) === '', 6000)), 'and its Undo takes it down');
  await sleep(2300);
  await type('Blade, desperate, great, the lights fail');
  check(!!(await until(async () => (await ovKind()) === 'report', 8000)), 'typed "Blade, desperate, great, the lights fail" stamps through the grammar');
  const t1 = await until(async () => { const t = await toasts(); return /Stamped desperate, great/.test(t) ? t : ''; }, 4000);
  check(!!t1, 'a toast names it: ' + t1);
  check(!!(await until(async () => (await page.inputValue('#gm-c-threat')) === 'the lights fail', 3000)) && (await page.$eval('#gm-pos [aria-checked="true"]', (b) => b.getAttribute('data-v'))) === 'desperate', 'the cue’s line and position are the Roll’s now (one field, one value)');
  check(!!(await page.$('.gm-ugtoast [data-ug="undo"]')), 'the toast has an Undo button');
  await page.click('.gm-ugtoast [data-ug="undo"]');
  check(!!(await until(async () => (await ovKind()) === '', 6000)), 'Undo takes the card down');
  await sleep(2300);
  await type('Blade, go to the Showroom');
  const nope = await until(async () => { const t = await toasts(); return /catch that/.test(t) ? t : ''; }, 6000);
  check(!!nope, '"Blade, go to the Showroom" says it did not catch that: ' + nope);
  check((await ovKind()) === '', 'and nothing was done');
  await sleep(2300);
  await type('Blade, flashback');
  check(!!(await until(async () => JSON.stringify((await ambientDoc()).layers || {}).includes('flashback'), 6000)), 'flashback sets the scene filter layer');
  await sleep(2300);
  await type('Blade, back');
  check(!!(await until(async () => !JSON.stringify((await ambientDoc()).layers || {}).includes('flashback'), 6000)), 'back clears it');

  // ============ 4. a stored false (the old All off) changes nothing ============
  await api('PATCH', '/gm/state', FEATS(false));
  await reopen();
  await sleep(500);
  check(!!(await until(() => page.$(STAMP), 8000)), 'a stored false changes nothing: the Roll’s stamp stays');
  check(errors.filter((e) => !/status of 500/.test(e)).length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await c.close();
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
