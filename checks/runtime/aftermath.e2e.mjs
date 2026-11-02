// The Aftermath show end to end (suite ticket 1.6, switch spine.aftermath): a real local Worker (wrangler dev, DEV_USER) on PORT (default 9110), the GM page, the table
// iPad's display-only sign-in (1024 x 768) and a player's phone. INVENTED data only (the Pelican Rooms cast); every GM-only string is a GM-ONLY- marker.
//   1. Switch OFF: the Menu has no Aftermath entry, the phone loads no commend file and makes no /api/docs call, the iPad draws nothing new.
//   2. Switch ON (Menu -> Switchboard, no reload): the entry appears; Start puts scene.mode = aftermath on the iPad, and Next steps it through payout, tithe, heat (the siren),
//      status, harm, unwind, xp and the credits; Back and Skip work; the numbers the GM types are what the iPad draws.
//   3. Phones: the commendations strip stands on the player's sheet only while step 7 does (and the row is gone when the GM moves on); it opens the sheet's own End of session panel.
//   4. The credits list revealed NPCs only (a hidden NPC is never on the iPad); finishing clears the scene mode; an unreached step is filed for the Debrief.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/aftermath.e2e.mjs      (AFT_SHOTS=<dir> keeps a screenshot per step)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9110);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', PLAYER = 'player@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.AFT_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const NOW = new Date().toISOString();
const PARTS = {
  console: conFix.parts.console,
  campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra }
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-aftermath-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 420000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  check((await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: NOW, endedAt: null }, crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 5, wanted: 1, vault: 3, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] })).status === 200, 'the table is set up');
  const seen = new Date().toISOString();
  check((await api('PUT', '/characters/char_aft1', { name: 'Mara Penhallow', playbook: 'hound', spec: { name: 'Mara Penhallow', playbook: 'hound' }, sheet: { name: 'Mara Penhallow' }, play: {} }, PLAYER)).status === 200, 'a player files a character');
  for (const [id, name, role, revealed] of [['n_mabel', 'Mabel Quist', 'Fixer', true], ['n_dov', 'Dov Kessler', 'Desk sergeant', true], ['n_lotte', 'Lotte Brand', 'Doorwoman', true], ['n_hid', 'GM-ONLY-NPC-1', 'GM-ONLY-ROLE-1', false]]) {
    const r = await api('PUT', '/npcs/' + id, { name, alias: '', role, faction: 'The Invented Guild', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', revealed, firstSeen: seen, spec: {} });
    if (r.status !== 200) throw new Error('npc ' + id + ' -> ' + r.status);
  }
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(route, { w = 1280, h = 800, user = GM, record = null } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; try { if (window === window.top) localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ intervalMs: 600000, graceMs: 60000 })); } catch (e) { /* no storage */ } });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(route + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(route + ' pageerror: ' + e.message));
    if (record) page.on('request', (r) => record.push(r.url()));
    await page.goto(BASE + '/' + route);
    if (route === '#display') { await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 }); return { c, page }; }
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    if (route === '#gm') await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };

  const phoneUrls = [];
  const G = await open('#gm'), g = G.page;
  const I = await open('#display', { w: 1024, h: 768, user: IPAD }), ip = I.page;
  const PH = await open('#c/char_aft1', { w: 390, h: 844, user: PLAYER, record: phoneUrls }), ph = PH.page;
  const step = () => ip.evaluate(() => { const n = document.querySelector('.dp-overlay .dp-show-aftermath'); return n ? n.getAttribute('data-step') : ''; });
  const iPadText = () => ip.evaluate(() => (document.querySelector('.dp-overlay') || {}).innerText || '');
  const onStep = (id, t = 15000) => ip.waitForFunction((s) => !!document.querySelector('.dp-overlay .dp-show-aftermath.dp-ov-in[data-step="' + s + '"]'), id, { timeout: t });
  const panel = () => g.$eval('#gm-sheet-aftermath', (e) => e.innerText);
  const press = async (label) => { await g.click('#gm-sheet-aftermath button:has-text("' + label + '")'); };
  const setField = async (label, value) => { await g.fill('#gm-sheet-aftermath label:has-text("' + label + '") input, #gm-sheet-aftermath label:has-text("' + label + '") textarea', String(value)); await g.press('#gm-sheet-aftermath label:has-text("' + label + '") >> nth=0', 'Tab').catch(() => {}); };

  /* ---- 1. OFF ---- */
  await g.click('[data-gm="menu"]');
  check(await g.$eval('.gm-menu-list', (e) => !/ftermath/.test(e.innerHTML)), 'OFF: the Menu has no Aftermath entry');
  check((await g.$$('#gm-menu-aftermath')).length === 0 && (await g.$$('#gm-sheet-aftermath')).length === 0, 'and no Aftermath sheet');
  await g.click('[data-gm="menu"]');
  await sleep(1500);
  check((await ph.evaluate(() => typeof window.B68Commend)) === 'undefined', 'OFF: the phone has not loaded the commendations file');
  check(!phoneUrls.some((u) => /\/api\/docs|sheet\/commend/.test(u)), 'OFF: and made no /api/docs call: ' + phoneUrls.filter((u) => /docs|commend/.test(u)).join(','));
  check((await ip.$$('.dp-overlay .dp-show')).length === 0 && !(await ip.evaluate(() => document.querySelector('.dp-root').getAttribute('data-scene-mode'))), 'OFF: the iPad draws nothing and has no scene mode');

  /* ---- 2. ON, from the Switchboard, no reload ---- */
  await g.evaluate(() => { window.__gmMarker = 'same page'; });
  await g.click('[data-gm="menu"]'); await g.click('#gm-menu-switchboard');
  await g.click('[data-sb="spine.aftermath"]');
  check(await g.$eval('[data-sb="spine.aftermath"]', (e) => e.getAttribute('aria-pressed') === 'true'), 'ON: the Switchboard shows Aftermath show on');
  const camp = await until(async () => { const c = (await api('GET', '/campaign', null, PLAYER)).json.doc; return c.features && c.features['spine.aftermath'] === true ? c : null; }, 8000);
  check(!!camp, 'the phone switch reaches the campaign document');
  check(await until(async () => (await ph.evaluate(() => typeof window.B68Commend)) === 'object', 10000), 'ON: the phone fetches the commendations file by itself');
  check(await until(() => phoneUrls.some((u) => /\/api\/docs\?kind=commend/.test(u)), 8000), 'and reads the commend kind, nothing else: ' + phoneUrls.filter((u) => /docs/.test(u)).join(','));
  await g.press('body', 'Escape');
  await g.click('[data-gm="menu"]');
  check(await g.$eval('#gm-menu-aftermath', (e) => /Aftermath/.test(e.textContent)), 'ON: the Menu has the Aftermath entry, with no reload');
  await g.click('#gm-menu-aftermath');
  check(await g.$eval('#gm-sheet-aftermath', (e) => !e.hidden && /eight steps/i.test(e.innerText) && /Start the Aftermath/i.test(e.innerText)), 'it opens the panel');

  /* ---- the show ---- */
  await press('Start the Aftermath');
  await onStep('payout');
  check(await ip.evaluate(() => document.querySelector('.dp-root').getAttribute('data-scene-mode') === 'aftermath' && document.querySelector('.dp-root').getAttribute('data-band-phase') === 'after'), 'Start: the iPad carries scene.mode aftermath and the Aftermath band');
  check(/ftermath/i.test(await iPadText()) && /1 of 8/i.test(await iPadText()), 'step 1 is the payout, 1 of 8: ' + JSON.stringify((await iPadText()).slice(0, 60)));
  await shot(ip, '1-payout-empty');
  await setField('Stacks', 14);
  await ip.waitForFunction(() => document.querySelectorAll('.dp-show-aftermath .dp-aft-stack').length === 14, null, { timeout: 15000 });
  check(true, 'what the GM types is what the iPad draws: 14 stacks');
  await ip.waitForTimeout(1500); await shot(ip, '1-payout');
  check((await ip.$eval('.dp-show-aftermath .dp-aft-big', (e) => e.textContent)) === '14', 'the payout counted up to 14');

  await press('Next'); await onStep('tithe');
  await setField('Tithe', 3);
  await ip.waitForFunction(() => /3/.test((document.querySelector('.dp-show-aftermath .dp-aft-big') || {}).textContent || '') && /keeps 11/i.test(document.querySelector('.dp-show-aftermath').innerText), null, { timeout: 15000 });
  await shot(ip, '2-tithe');
  check(true, 'step 2: the tithe, and what the crew keeps');

  await press('Next'); await onStep('heat');
  check(/Heat 6\./.test(await panel()) || /Heat 5\./.test(await panel()), 'step 3: the panel starts from the crew sheet\'s heat (5): ' + (await panel()).match(/Heat \d+[^.]*\./));
  await g.click('#gm-sheet-aftermath .chip:has-text("4")');
  await setField('Modifiers', 2);
  await ip.waitForFunction(() => document.querySelectorAll('.dp-show-aftermath .dp-aft-pip.on').length === 9, null, { timeout: 15000 });
  await ip.waitForFunction(() => !!document.querySelector('.dp-show-aftermath .dp-show-wanted.dp-ov-in'), null, { timeout: 15000 });
  await shot(ip, '3-heat-siren');
  check(/siren/i.test(await panel()) && /WANTED/.test(await iPadText()), 'at 9 the siren and WANTED: the panel says so and the iPad shows the poster');

  await press('Next'); await onStep('status');
  check(/No status changes/i.test(await iPadText()), 'step 4 with nothing typed: "No status changes"');
  await setField('Status changes', 'The Kestrel Club +1\nGM-ONLY-NPC-1 owes a favour');
  await sleep(1500);
  check(/No status changes/i.test(await iPadText()) && !/GM-ONLY/i.test(await iPadText()), 'a line naming a hidden NPC is refused by the page and never reaches the iPad');
  await setField('Status changes', 'The Kestrel Club +1\nThe Tidewater Watch -1');
  await ip.waitForFunction(() => document.querySelectorAll('.dp-show-aftermath .dp-aft-line').length === 2, null, { timeout: 15000 });
  await shot(ip, '4-status');
  check(true, 'two clean lines reach the iPad');

  await press('Next'); await onStep('harm');
  await press('Skip'); await onStep('unwind');
  check(/Not done yet[^\n]*harm/.test(await panel()), 'Skip on step 5 (harm): it is listed for the Debrief: ' + (await panel()).match(/Not done yet[^\n]*/));
  await press('Back'); await onStep('harm');
  check(/Harm complications \(1:30\) ←/.test(await panel()), 'Back returns to harm, the current step again');
  await setField('Harm complications', 'Nell Arbuthnot: a bad leg slows the next job');
  await ip.waitForFunction(() => /bad leg/i.test(document.querySelector('.dp-show-aftermath').innerText), null, { timeout: 15000 });
  await shot(ip, '5-harm');
  await press('Next'); await onStep('unwind');
  await setField('Whose turn to decide', 'Nell Arbuthnot');
  await ip.waitForFunction(() => /Nell Arbuthnot/i.test(document.querySelector('.dp-show-aftermath').innerText), null, { timeout: 15000 });
  await shot(ip, '6-unwind');

  /* ---- 3. the phones ---- */
  const strip = () => ph.evaluate(() => window.B68Commend.state());
  check((await strip()).open === false && (await ph.$$('.ds-commend')).length === 0, 'before step 7 the phone has no commendations, and the sheet has no strip');
  await press('Next'); await onStep('xp');
  check(await until(async () => (await strip()).open === true, 12000), 'step 7: the phone has the commendations window (within a poll or a poke)');
  check(await until(async () => (await ph.$$('.ds-commend')).length === 1, 8000), 'and the sheet shows the strip: ' + ((await ph.$$eval('.ds-commend', (e) => e.map((x) => x.innerText)).catch(() => [])) || [])[0]);
  await shot(ph, '7-phone-strip');
  await ph.click('.ds-commend [data-act="endopen"]');
  check(await until(async () => (await ph.$$('.ds-endp')).length === 1, 5000), 'the strip opens the sheets own End of session panel, where the xp triggers are ticked');
  check((await ph.$$eval('.ds-endp .ds-endrow', (e) => e.length)) >= 2, 'with the playbook triggers on it');
  check(/Check your sheet/i.test(await iPadText()), 'and the iPad says Check your sheet');
  await shot(ip, '7-xp');
  const row = (await api('GET', '/docs?kind=commend', null, PLAYER)).json;
  check(row.docs.length === 1 && row.docs[0].scope === 'public' && row.docs[0].json.secs === 90 && !/Kestrel|Nell|GM-ONLY/.test(JSON.stringify(row)), 'the row is public, 90 s, with no text in it');
  await press('Next'); await onStep('credits').catch(() => {});
  check(await until(async () => (await strip()).open === false && (await ph.$$('.ds-commend')).length === 0, 12000), 'moving on takes the commendations off the phone, strip and all');
  check((await api('GET', '/docs?kind=commend', null, PLAYER)).json.docs.length === 0, 'and the row is gone');

  /* ---- 4. the credits ---- */
  await ip.waitForFunction(() => !!document.querySelector('.dp-overlay .dp-show-credits.dp-ov-in'), null, { timeout: 15000 });
  await ip.waitForTimeout(2500); await shot(ip, '8-credits');
  const credits = await ip.$$eval('.dp-show-credits .dp-cr-name', (els) => els.map((e) => e.textContent));
  check(credits.length === 3 && ['Mabel Quist', 'Dov Kessler', 'Lotte Brand'].every((n) => credits.includes(n)), 'the end credits are the revealed NPCs: ' + credits.join(', '));
  check(!/GM-ONLY|DESC-MARKER|GMNOTES-MARKER/.test(await ip.evaluate(() => document.getElementById('display-page').innerText)), 'no hidden NPC and no note on the iPad');
  check((await ip.$$('.dp-show-credits .dp-cr-bar')).length === 4, 'four bars, as the opening card has');
  await press('Finish');
  await ip.waitForFunction(() => !document.querySelector('.dp-overlay .dp-show') && !document.querySelector('.dp-root').getAttribute('data-scene-mode'), null, { timeout: 15000 });
  check(true, 'Finish: the beat goes off and scene.mode is cleared');
  const st = await until(async () => { const d = (await api('GET', '/gm/state')).json.doc; return d.night && d.night.aftermath && d.night.aftermath.step === 'done' ? d : null; }, 8000);
  check(!!st && !st.night.aftermath.data.pending, 'the night document says the Aftermath is done with nothing left for the Debrief: ' + JSON.stringify(st && st.night.aftermath));
  check(await g.evaluate(() => window.__gmMarker) === 'same page', 'the GM page never reloaded');

  /* ---- OFF again ---- */
  await g.click('[data-gm="menu"]'); await g.click('#gm-menu-switchboard'); await g.click('[data-sb-alloff]');
  await until(async () => { const c = (await api('GET', '/campaign', null, PLAYER)).json.doc; return c.features && c.features['spine.aftermath'] === false; }, 8000);
  await g.press('body', 'Escape'); await g.click('[data-gm="menu"]');
  check(await until(async () => (await g.$$('#gm-menu-aftermath')).length === 0, 4000), 'OFF again: the Menu entry is gone');
  check(await until(async () => (await ph.evaluate(() => window.B68Commend.state())).started === false, 8000), 'and the phone stops reading');

  check(errors.length === 0, 'no console errors or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
