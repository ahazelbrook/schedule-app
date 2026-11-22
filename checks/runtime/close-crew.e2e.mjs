// close-crew (RK07, setting close.crew) end to end: a real local Worker (wrangler dev, DEV_USER) on PORT (default 9501, inspector on PORT + 20000), the GM page,
// the table iPad's display-only sign-in and a player's phone. INVENTED data only (the Dovetail Crew, the Pelican Rooms cast); GM-only strings are GM-ONLY- markers.
//   1. Off (the default): the close-crew bundle is never fetched, and Next on the heat step leaves the campaign document's crew exactly as it was.
//   2. On: the heat step has the reason ticks and the house add-on; a close at Heat 2, exposure 6, +1 +2 +1 (12) leaves the crew record at Heat 0, Wanted 1,
//      and every other crew field as it was; the iPad's ambient crew follows (crewSync). Back and Next again: still Heat 0, Wanted 1 (never 2).
//   3. Status by faction reaches the iPad as a line and crew.factions is untouched; the Open line is in the GM state's night only.
//   4. Nothing new reaches a phone: the player's campaign GET, the display GET and the phone's DOM hold no Open line, no guard and no label.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge [PORT=9501] [CC_SHOTS=<dir>] node checks/runtime/close-crew.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9501);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', PLAYER = 'player@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.CC_SHOTS || '';
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
const CREW = { name: 'The Dovetail Crew', type: 'shadows', lair: 'The Pelican Rooms', notes: 'NOTES-MARKER', tier: 1, hold: 'strong', rep: 4, turf: 1, heat: 2, wanted: 0, vault: 3,
  claims: [], cohorts: [{ name: 'The Lamplighters', type: 'gang', harm: 0 }], factions: [{ name: 'The Kestrel Club', status: 1 }, { name: 'The Tidewater Watch', status: -1 }] };
const OPEN = 'Ray Okonjo: dead or alive? GM-ONLY-OPEN-1';

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-close-crew-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
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
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 480000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const crewNow = async () => (await api('GET', '/campaign', null, PLAYER)).json.doc.crew;
const without = (c) => { const o = { ...c }; delete o.heat; delete o.wanted; return JSON.stringify(o); };

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  check((await api('PUT', '/campaign', { v: 1, session: { number: 4, startedAt: NOW, endedAt: null }, crew: CREW, clocks: [], log: [] })).status === 200, 'the table is set up: the Dovetail Crew at Heat 2, Wanted 0');
  for (const [id, name, pb] of [['char_cc1', 'Nell Arbuthnot', 'hound'], ['char_cc2', 'Tam Petrakis', 'hound']]) {
    check((await api('PUT', '/characters/' + id, { name, playbook: pb, spec: { name, playbook: pb }, sheet: { name }, play: {} }, PLAYER)).status === 200, 'a player files ' + name);
  }
  const seen = new Date().toISOString();
  for (const [id, name, role, revealed] of [['n_mabel', 'Mabel Quist', 'Fixer', true], ['n_hid', 'GM-ONLY-NPC-1', 'GM-ONLY-ROLE-1', false]]) {
    const r = await api('PUT', '/npcs/' + id, { name, alias: '', role, faction: 'The Kestrel Club', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', revealed, firstSeen: seen, spec: {} });
    if (r.status !== 200) throw new Error('npc ' + id + ' -> ' + r.status);
  }
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(route, { w = 1366, h = 768, user = GM, record = null } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript(atPlace('score'));
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; try { if (window === window.top) localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ intervalMs: 600000, graceMs: 60000 })); } catch (e) { /* no storage */ } });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(route + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(route + ' pageerror: ' + e.message));
    if (record) page.on('request', (r) => record.push(r.url()));
    await page.goto(BASE + '/' + route);
    if (route === '#display') { await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 }); return { c, page }; }
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    if (route === '#gm') await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };

  const gmUrls = [], phoneUrls = [];
  let G = await open('#gm', { record: gmUrls }), g = G.page;
  const I = await open('#display', { w: 1024, h: 768, user: IPAD }), ip = I.page;
  const PH = await open('#c/char_cc1', { w: 390, h: 844, user: PLAYER, record: phoneUrls }), ph = PH.page;
  const AFT = ':is(#gm-sheet-aftermath:not([hidden]), #gm-vpane [data-inline="aftermath"])';
  const panel = () => g.$eval(AFT, (e) => e.innerText);
  const press = async (label) => { await g.click(AFT + ' .seg button:text-is("' + label + '")'); await sleep(300); };
  const setField = async (label, value) => { await g.fill(AFT + ' label:has-text("' + label + '") input, ' + AFT + ' label:has-text("' + label + '") textarea', String(value)); await g.press(AFT + ' label:has-text("' + label + '") >> nth=0', 'Tab').catch(() => {}); await sleep(300); };
  const onStep = (id, t = 15000) => ip.waitForFunction((s) => !!document.querySelector('.dp-overlay .dp-show-aftermath.dp-ov-in[data-step="' + s + '"]'), id, { timeout: t });
  const exposure = async (n) => { await g.click(AFT + ' .seg:has-text("Exposure") > .chip:text-is("' + n + '")'); await sleep(300); };
  let titheText = '';
  const toHeat = async () => {
    await g.evaluate(() => window.B68GmTools.get('aftermath').open());
    await g.click(AFT + ' button:has-text("Start the Aftermath")'); await onStep('payout');
    await setField('Stacks', 14); await press('Next'); await onStep('tithe');
    await setField('Tithe', 3); titheText = await panel(); await press('Next'); await onStep('heat');
  };

  /* ---- 1. off ---- */
  await toHeat();
  await exposure(6); await setField('Modifiers', 4);
  check(!/Heat reasons/.test(await panel()), 'off: the heat step is as it was (the Modifiers box, no reason ticks)');
  await press('Next'); await onStep('status');
  await sleep(1500);
  const offCrew = await crewNow();
  check(offCrew.heat === 2 && offCrew.wanted === 0 && without(offCrew) === without(CREW), 'off: Next on the heat step writes nothing: ' + JSON.stringify([offCrew.heat, offCrew.wanted]));
  check(!gmUrls.some((u) => /close-crew/.test(u)) && (await g.evaluate(() => typeof window.B68GmCloseCrew)) === 'undefined', 'off: the close-crew bundle is never fetched');
  await press('End now');
  await sleep(500);

  /* ---- 2. on ---- */
  check((await api('PATCH', '/gm/state', { features: { 'close.crew': true } })).status === 200, 'the GM turns The close on');
  await g.reload();
  await g.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await g.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  check(await until(() => g.evaluate(() => !!(window.B68GmCloseCrew && !window.B68GmCloseCrew.stub)), 15000), 'on: the close-crew bundle loads');
  const before = await crewNow();
  await toHeat();
  check(/Kept 11 stacks: 5 each for 2 PCs, 1 left over/.test(titheText), 'the tithe step shows the split over the two PCs: ' + (titheText.match(/Kept[^\n]*/) || [''])[0]);
  const ptxt = await panel();
  check(/Heat reasons/i.test(ptxt) && /House add-on/i.test(ptxt) && !/Modifiers \(\+ or/i.test(ptxt) && (await g.$$(AFT + ' .cc-row .chip:not(.cc-rule-chip)')).length === 4, 'on: the heat step has the reason ticks and the house add-on in place of the Modifiers box: ' + JSON.stringify(ptxt.slice(0, 700)));
  await exposure(6);
  await g.click(AFT + ' .cc-row button:has-text("High-profile target")'); await sleep(300);
  await g.click(AFT + ' .cc-row button:has-text("A killing")'); await sleep(300);
  await g.fill(AFT + ' input.cc-house-why', 'explosives'); await g.press(AFT + ' input.cc-house-why', 'Tab'); await sleep(300);
  await g.fill(AFT + ' input.cc-house', '1'); await g.press(AFT + ' input.cc-house', 'Tab'); await sleep(300);
  await ip.waitForFunction(() => !!document.querySelector('.dp-show-aftermath .dp-show-wanted.dp-ov-in'), null, { timeout: 15000 });
  const htxt = await panel();
  const nextLine = await g.$eval(AFT + ' .cc-next-line', (p) => ({ text: p.textContent, beside: !!(p.nextElementSibling && p.nextElementSibling.querySelector('button.primary')) }));
  check(/Modifiers \+4/.test(htxt) && nextLine.text === 'Next writes the crew: Heat 2 → 0 · Wanted 0 → 1' && nextLine.beside, 'the ticks make +4, and the line right above Next says what it writes: ' + JSON.stringify(nextLine));
  const nextBox = await g.$eval(AFT + ' .seg button.primary:text-is("Next")', (b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
  check(nextBox.bottom <= nextBox.vh && nextBox.top >= 0, 'at 1366x768 Next is in view on the heat step: ' + JSON.stringify(nextBox));
  check(await g.$$eval(AFT + ' .cc-rule-chip', (b) => b.length === 1 && /rule: heat/.test(b[0].textContent)), 'a rule chip for the heat rules');
  await shot(g, 'gm-heat-on');
  await shot(ip, 'ipad-heat-siren');
  await press('Next'); await onStep('status');
  const after = await until(async () => { const c = await crewNow(); return c.heat === 0 && c.wanted === 1 ? c : null; }, 10000);
  check(!!after, 'DONE WHEN: the crew record is at Heat 0, Wanted 1: ' + JSON.stringify(after ? [after.heat, after.wanted] : await crewNow().then((c) => [c.heat, c.wanted])));
  check(!!after && without(after) === without(before), 'and every other crew field (name, factions, cohorts, notes, vault) is as it was');
  const amb = await until(async () => { const d = (await api('GET', '/gm/display', null, IPAD)).json; const c = d && d.ambient && d.ambient.doc && d.ambient.doc.crew; return c && c.heat === 0 && c.wanted === 1 ? c : null; }, 12000);
  check(!!amb, 'the iPad\'s crew (the ambient document) follows: Heat 0, Wanted 1');
  const st1 = (await api('GET', '/gm/state')).json.doc;
  const w1 = JSON.parse(st1.night.aftermath.data.crewWritten || 'null');
  check(!!w1 && w1.from.heat === 2 && w1.from.wanted === 0 && w1.to.heat === 0 && w1.to.wanted === 1, 'the guard holds the numbers from before the close: ' + st1.night.aftermath.data.crewWritten);

  await press('Back'); await onStep('heat');
  check(/Heat 2 → 0 · Wanted 0 → 1 \(written already: the same numbers again\)/.test(await g.$eval(AFT + ' .cc-next-line', (p) => p.textContent)), 'Back: the line beside Next says it was written, and Next sends the same numbers');
  await press('Next'); await onStep('status'); await sleep(2000);
  const again = await crewNow();
  check(again.heat === 0 && again.wanted === 1, 'Back and Next again: still Heat 0, Wanted 1 (never 2): ' + JSON.stringify([again.heat, again.wanted]));

  /* ---- 3. status by faction, and the Open line ---- */
  await g.click(AFT + ' .cc-factions .cc-row:has-text("The Kestrel Club") button:text-is("+1")'); await sleep(300);
  const lineOk = await ip.waitForFunction(() => [...document.querySelectorAll('.dp-show-aftermath .dp-aft-line')].some((e) => /The Kestrel Club \+1/.test(e.textContent)), null, { timeout: 15000 }).then(() => true, () => false);
  check(lineOk, 'a faction pick reaches the iPad as a status line: ' + JSON.stringify(await ip.$$eval('.dp-show-aftermath .dp-aft-line', (e) => e.map((x) => x.textContent))));
  const st15 = (await api('GET', '/gm/state')).json.doc;
  if (!lineOk) console.log('  picks stored: ' + JSON.stringify(st15.night.aftermath.data.picks) + ' / panel: ' + JSON.stringify((await panel()).slice(0, 500)));
  await g.fill(AFT + ' .cc-open textarea', OPEN); await g.press(AFT + ' .cc-open textarea', 'Tab'); await sleep(800);
  await shot(g, 'gm-status-on'); await shot(ip, 'ipad-status');
  await press('Next'); await sleep(800);
  const camp2 = (await api('GET', '/campaign', null, PLAYER)).json.doc;
  check(JSON.stringify(camp2.crew.factions) === JSON.stringify(CREW.factions), 'crew.factions is never written: ' + JSON.stringify(camp2.crew.factions));
  const st2 = (await api('GET', '/gm/state')).json.doc;
  check(st2.night.aftermath.data.open === OPEN, 'the Open line is in the night\'s aftermath data');
  const logText = JSON.stringify(st2.night.log || {});
  check(/Crew written: Heat 2/.test(logText) && /Status: The Kestrel Club \+1/.test(logText) && /Kept 11 stacks/.test(logText), 'the night log has the write, the split and the picks');

  /* ---- 4. nothing new reaches a phone, or the iPad ---- */
  const leak = /Okonjo|GM-ONLY|crewWritten|explosives|heatWhy|xpTicks/;
  check(!leak.test(JSON.stringify(camp2)), 'the player\'s campaign GET has no Open line, guard or label');
  check(!leak.test(JSON.stringify((await api('GET', '/gm/display', null, IPAD)).json)), 'nor has the display GET');
  check(!leak.test(await ip.evaluate(() => document.getElementById('display-page').innerText)) && !leak.test(await ph.evaluate(() => document.body.innerText)), 'nor the iPad\'s or the phone\'s DOM');
  check(!phoneUrls.some((u) => /close-crew/.test(u)), 'the phone never fetches the close-crew bundle');
  check((await api('GET', '/campaign', null, PLAYER)).json.doc.log.every((e) => !leak.test(JSON.stringify(e))), 'the campaign log (every player downloads it) holds none of it');

  /* ---- 5. the xp step lists the crew's triggers (the crews bundle loads on demand) ---- */
  await press('Next'); await press('Next'); await onStep('xp');
  const crewRows = await until(() => g.$$eval(AFT + ' .cc-xp-row', (r) => r.map((x) => x.textContent).filter((t) => /The crew:/.test(t)).length), 10000);
  check(crewRows >= 1, 'the xp step lists the crew\'s triggers as ticks: ' + crewRows + ' rows');
  await shot(g, 'gm-xp-on');
  await press('End now'); await sleep(800);
  /* ---- 6. Start again: a close tonight is on the crew, so it asks ---- */
  await g.evaluate(() => window.B68GmTools.get('aftermath').open()); await sleep(500);
  const ask = await panel();
  check(/A close tonight already wrote the crew: Heat 2 → 0, Wanted 0 → 1/.test(ask) && (await g.$$(AFT + ' button:text-is("Same score")')).length === 1 && (await g.$$(AFT + ' button:text-is("A new score")')).length === 1 && (await g.$$(AFT + ' button:has-text("Start the Aftermath")')).length === 0, 'Start asks: Same score or A new score: ' + JSON.stringify(ask.slice(0, 300)));
  await shot(g, 'gm-start-ask');
  await g.click(AFT + ' button:text-is("Same score")'); await onStep('payout');
  check(await g.$eval(AFT + ' label:has-text("Stacks") input', (i) => i.value) === '14', 'Same score takes that close back with its numbers (14 stacks)');
  await press('Next'); await press('Next'); await onStep('heat');
  check(/\(written already: the same numbers again\)/.test(await g.$eval(AFT + ' .cc-next-line', (p) => p.textContent)), 'and its heat step will write the same numbers again');
  await press('Next'); await onStep('status'); await sleep(1500);
  const same = await crewNow();
  check(same.heat === 0 && same.wanted === 1, 'Same score and Next: still Heat 0, Wanted 1: ' + JSON.stringify([same.heat, same.wanted]));
  await press('End now'); await sleep(500);
  check(errors.length === 0, 'no console errors or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
