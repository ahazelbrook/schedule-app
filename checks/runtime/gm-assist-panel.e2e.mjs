// The Claude box (app/gm/assist-panel.js) on the real GM page, in a real browser, against a local wrangler dev. The assist endpoints are
// answered by the browser's own route (invented cards): no key, no model, no spend. Checks: the launcher and its count, the banner, key A,
// Listening-gated polling, the five Fit lines, the 429 state, a phone layout with no box, and that the player view never has it.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [GM_SHOTS=<dir>] node checks/runtime/gm-assist-panel.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8862);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  handouts: { src: { file: 'invented/handouts', blockSha: '1', exportedAt: new Date().toISOString() }, v: 1, rel: 'invented/handouts', items: [
    { id: 'ho-a', title: 'Invented brass key', file: '0123456789abcdef.png', when: 'invented cue one' },
    { id: 'ho-b', title: 'Invented torn map', file: 'fedcba9876543210.png' },
  ] },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-assist-e2e-'));
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
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });

const CARD = { seat: 'ref', at: new Date().toISOString(), text: 'Invented rule slip: a stress cost can be resisted once per roll.', detail: { said_at: '22:14', rule: 'Rulebook p. 12' } };
const CLERK = { seat: 'clerk', at: new Date().toISOString(), text: 'Invented clerk note: a new name came up twice.' };
const FIT = { seat: 'fixer', at: new Date().toISOString(), text: 'Crew at the gate, risky, standard effect.', read: 'Crew at the gate, risky, standard effect.',
  one_three: 'A guard glances over.', four_five: 'In, but the lock is marked.', six: 'Clean through.', crit: 'The guard waves them in.', bargain: 'Leave a tool behind.' };

const VOICE = { who: 'Mrs Test', want: 'to be paid', lines: ['Invented line one.', 'Invented line two.'], at: new Date().toISOString() };

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(hash, { width = 1280, height = 800, mobile = false, tickReply, mode } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile });
    const page = await c.newPage();
    const seen = { tick: [], fit: [], another: [] };
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    const reply = { cards: [CARD], updates: [{ seat: 'ledger', at: CARD.at, key: 'stress', text: 'Invented: two stress to the crew.' }], flags: ['harm'], spend: { tonight: 1.42, cap: 20, tier: 'all', tick: 0.02 }, last: 12 };
    seen.mode = mode || 'card';
    await page.route('**/api/gm/assist/tick', async (route) => {
      seen.tick.push(JSON.parse(route.request().postData() || '{}'));
      if (seen.mode === 'cap') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: "tonight's cap is reached" }) });
      if (seen.mode === 'voice') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], flags: [], spend: reply.spend, last: 30, voice: VOICE }) });
      if (seen.mode === 'stall') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [{ seat: 'mystery', at: new Date().toISOString(), text: 'Push next: invented second key.' }], updates: [], flags: ['stall'], spend: reply.spend, last: 32, stall: { kind: 'clue', offer: 'Invented: a runner bursts in with news.', why: 'Invented: the table went quiet.', at: new Date().toISOString() } }) });
      if (seen.mode === 'handout') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], flags: [], spend: reply.spend, last: 40, handout: { id: seen.handoutId || 'ho-a', why: 'Invented: the table has just reached the cue.', at: new Date().toISOString() } }) });
      if (seen.mode === 'quiet') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], flags: [], spend: reply.spend, last: 31 }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seen.mode === 'second' ? { ...reply, cards: [CLERK], updates: [], last: 20 } : reply) });
    });
    await page.route('**/api/gm/assist/another', async (route) => {
      seen.another.push(JSON.parse(route.request().postData() || '{}'));
      if (seen.anotherCap) return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: "tonight's cap is reached" }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], flags: [], spend: { tonight: 1.5, cap: 20, tier: 'all', tick: 0.01 }, last: 30, voice: { who: 'Mrs Test', lines: ['Invented third line.'], at: new Date().toISOString() } }) });
    });
    await page.route('**/api/gm/assist/fit', async (route) => {
      seen.fit.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [FIT], flags: [], spend: { tonight: 1.9, cap: 20, tier: 'all', tick: 0.5 }, last: 12 }) });
    });
    // the Screen: invented items from the browser's own route; the display, the ambient document and the cast are the REAL server
    seen.sc = { gate: 'pass', gateDelay: 0, cardBad: ['Rulebook p. 12'], reqs: { portrait: [], prop: [], wire: [], board: [], gate: [] }, dialogs: [], accept: false };
    page.on('dialog', (d) => { seen.sc.dialogs.push(d.message()); return seen.sc.accept ? d.accept() : d.dismiss(); });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const SPEND = { tonight: 2.1, cap: 20, tier: 'all', tick: 0.05 };
    await page.route('**/api/gm/assist/prop', (route) => { seen.sc.reqs.prop.push(JSON.parse(route.request().postData() || '{}')); return json(route, { item: { kind: 'prop', title: 'Telegram', text: 'TELEGRAM\nINVENTED: MEET AT THE FERRY STOP\nNO NAMES', at: new Date().toISOString() }, spend: SPEND }); });
    await page.route('**/api/gm/assist/wire', (route) => { seen.sc.reqs.wire.push(1); return json(route, { item: { kind: 'wire', text: 'Invented: ferry timetable cut for the long weekend.', at: new Date().toISOString() }, spend: SPEND }); });
    await page.route('**/api/gm/assist/board', (route) => { seen.sc.reqs.board.push(1); return json(route, { item: { kind: 'board', title: 'Case board', text: 'WHAT WE KNOW\n- Invented: the ledger was torn.\n\nWHO AND WHAT WE SUSPECT\n- Invented: the clerk did it.', at: new Date().toISOString() } }); });
    await page.route('**/api/gm/assist/portrait', (route) => {
      seen.sc.reqs.portrait.push(JSON.parse(route.request().postData() || '{}'));
      const spec = { heightIn: 70, shape: 'oval', skin: 'tan', age: 44, pose: { stance: 'easy', arms: { R: 'down', L: 'pocket' } }, head: { shape: 'oval' }, face: { eyes: 'hooded', brows: 'straight', nose: 'straight', mouth: 'neutral', expression: 'cool', eyewear: { type: 'not-a-kit-name' } },
        hair: { style: 'crew', color: 'cloth-black' }, outfit: { base: { type: 'turtleneck', color: 'cloth-black' }, bottom: { type: 'trousers', color: 'cloth-charcoal' }, feet: { type: 'oxfords', color: 'cloth-black' } } };
      return json(route, { item: { kind: 'portrait', name: 'Heard Name', description: 'Invented: a tall person in dark clothes.', spec, at: new Date().toISOString() }, spend: SPEND });
    });
    await page.route('**/api/gm/assist/gatekeeper', async (route) => {
      const req = JSON.parse(route.request().postData() || '{}'); seen.sc.reqs.gate.push(req);
      if (req.kind === 'card') return json(route, { verdict: 'pass', unknown: false, reasons: [], revealed: [], rule: [], cites_bad: seen.sc.cardBad, spend: SPEND });
      if (seen.sc.gateDelay) await sleep(seen.sc.gateDelay);
      if (seen.sc.gate === 'error') return json(route, { error: 'boom' }, 500);
      if (seen.sc.gate === 'block') return json(route, { verdict: 'block', unknown: false, reasons: ['Invented: it names the buyer.'], revealed: ['#2 Invented entry'], rule: [], cites_bad: [], spend: SPEND });
      return json(route, { verdict: 'pass', unknown: false, reasons: [], revealed: [], rule: [], cites_bad: [], spend: SPEND });
    });
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { c, page, seen };
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'assist-ui-' + name + '.png') }); };

  // ---- laptop ----
  const G = await open('#gm');
  const p = G.page;
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  check(await p.waitForSelector('.gm-assist .as-launch', { timeout: 10000 }).then(() => true, () => false), 'the launcher is on the GM page');
  check(await p.waitForFunction(() => !document.querySelector('.gm-assist .as-count').hidden, null, { timeout: 15000 }).then(() => true, () => false), 'Listening is on: the first tick ran and the count shows');
  check(JSON.stringify(G.seen.tick[0]) === '{}', 'the first tick has no cursor');
  check(await p.$eval('.gm-assist .as-launch img', (i) => i.complete && i.naturalWidth > 0), 'the launcher shows the portrait');
  check(await p.$eval('.gm-assist .as-banner', (b) => !b.hidden && /rule slip/i.test(b.textContent)), 'the banner is up beside the launcher');
  await sleep(400);
  await shot(p, 'collapsed-banner');
  await p.waitForTimeout(500);
  await p.keyboard.press('a');
  check(await p.$eval('#as-panel', (e) => !e.hidden), 'key A opens the box');
  check(await p.$eval('.gm-assist .as-banner', (b) => b.hidden), 'the banner goes when the box opens');
  check((await p.$$('#as-list .as-card')).length === 1 && /p\. 12/.test(await p.$eval('#as-list .as-card', (e) => e.textContent)), 'the card in the feed carries the page cite');
  check(await p.$$eval('.gm-assist .as-up', (l) => l.length) === 1, 'the Ledger update is listed');
  await p.click('#gm-page .gm-dotb[data-v="2"]');
  await p.click('#as-tools > summary');                 // Fit it, the Screen and the Ledger live in the Tools drawer
  await p.fill('#as-eff', 'standard');
  await p.click('.gm-assist .as-pos label:nth-child(3)');
  await p.click('#as-go');
  check(await p.waitForSelector('.gm-assist .as-lines li', { timeout: 10000 }).then(() => true, () => false), 'Fit it shows the lines');
  check((await p.$$('.gm-assist .as-lines li')).length === 5, 'five lines: 1-3, 4-5, 6, crit, bargain');
  const fr = G.seen.fit[0] || {};
  check(fr.position === 'desperate' && fr.effect === 'standard' && fr.draws && /^A 1–3/.test(fr.draws.low) && /^A 4[/]5/.test(fr.draws.mid), 'the fit request carried the position, the effect and the console draws');
  check(fr.dots === 2, 'the Dots chip is set to 2: the first fit request carried dots: 2 (' + JSON.stringify(fr) + ')');
  await shot(p, 'expanded');
  await p.click('#gm-page .gm-dotb[data-v="2"]');      // tap again clears the chip
  await p.click('#as-go');
  check(await until(async () => G.seen.fit.length >= 2, 10000), 'a second fit was asked');
  check(G.seen.fit[1] && !('dots' in G.seen.fit[1]) && G.seen.fit[1].position === 'desperate', 'with the chip cleared the request has no dots field');
  await p.keyboard.press('Escape');
  check(await p.$eval('#as-panel', (e) => e.hidden), 'Escape closes the box');
  await p.keyboard.press('a'); await p.keyboard.press('a');
  check(await p.$eval('#as-panel', (e) => e.hidden), 'A twice leaves it closed');
  check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) !== null && await p.$eval('#gm-page', (e) => !!e.querySelector('#gm-buttons')), 'the other keys still work: the page is intact');
  await p.keyboard.press('n');
  check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) === 'npc', 'key N still opens the NPC panel');

  // the next tick carries the cursor; then a 429 stops everything
  G.seen.mode = 'second';
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check(await until(async () => G.seen.tick.length >= 2, 8000), 'a returning tab polls at once');
  check(G.seen.tick[1] && G.seen.tick[1].after === 12, 'the second tick carries `after` = the last answer');
  G.seen.mode = 'cap';
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await until(async () => G.seen.tick.length >= 3, 8000);
  await p.keyboard.press('a');
  check(await p.waitForFunction(() => /Cap reached/.test(document.querySelector('#as-status').textContent), null, { timeout: 8000 }).then(() => true, () => false), 'a 429 shows the cap state, in words');
  check(!/[{}]|error/.test(await p.$eval('#as-status', (e) => e.textContent)), 'no raw JSON');
  const n = G.seen.tick.length;
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(800);
  check(G.seen.tick.length === n, 'polling has stopped');
  await shot(p, 'capped');

  // Listening off: no ticks
  await api('PATCH', '/gm/stt', { want: 'off' });
  G.seen.mode = 'card';
  if (await p.$eval('#as-panel', (e) => e.hidden)) await p.keyboard.press('a');
  await p.click('.gm-assist [data-as="resume"]');
  await sleep(1200);
  check(G.seen.tick.length === n, 'Listening off: Check again asks nothing of the model');
  await G.c.close();

  // ---- Voice: an NPC on stage, lines in the Rack with their NPC's name, Another, and nothing without a name / Listening / the cap ----
  await api('PATCH', '/gm/stt', { want: 'on' });
  await api('PUT', '/npcs/npc_vtest', { name: 'Mrs Test', role: 'invented', revealed: true, firstSeen: new Date().toISOString() });
  const setStage = (on) => api('PATCH', '/campaign', { scene: { npcs: { npc_vtest: on }, at: new Date().toISOString() } });
  check((await setStage(true)).status === 200, 'an invented NPC is on stage');
  const V = await open('#gm', { mode: 'voice' });
  V.seen.mode = 'voice';
  const vp = V.page;
  await vp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  check(await until(async () => V.seen.tick.length >= 1, 15000), 'Voice: the first tick ran');
  check(V.seen.tick.some((t) => t.npc === 'Mrs Test'), 'the tick carries the on-stage NPC name');
  check(await vp.waitForSelector('#gm-rack .gm-voice', { timeout: 15000 }).then(() => true, () => false), 'Voice lines show in the Rack under the console card');
  check(/Mrs Test/.test(await vp.textContent('#gm-rack .gm-voice')) && (await vp.$$('#gm-rack .gm-voice-lines li')).length === 2, 'labelled with the NPC, two lines');
  check(await vp.$('#gm-rack [data-gm="another"]') !== null, 'an Another button');
  await shot(vp, 'voice-rack');
  await vp.click('#gm-rack [data-gm="another"]');
  check(await until(async () => V.seen.another.length === 1, 8000), 'Another asks the server');
  const areq = V.seen.another[0] || {};
  check(areq.npc === 'Mrs Test' && JSON.stringify(areq.shown) === JSON.stringify(['Invented line one.', 'Invented line two.']), 'with the NPC and the lines shown');
  check(await vp.waitForFunction(() => document.querySelectorAll('#gm-rack .gm-voice-lines li').length === 3, null, { timeout: 8000 }).then(() => true, () => false), 'the new line joins the others');
  await vp.click('#gm-rack [data-gm="voiceclear"]');
  check(await vp.$('#gm-rack .gm-voice') === null, 'Clear drops the lines');
  // the cap while Another is pressed: nothing shows
  V.seen.mode = 'voice';
  await vp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check(await vp.waitForSelector('#gm-rack .gm-voice', { timeout: 15000 }).then(() => true, () => false), 'the next tick brings Voice back');
  V.seen.anotherCap = true;
  await vp.click('#gm-rack [data-gm="another"]');
  check(await vp.waitForFunction(() => !document.querySelector('#gm-rack .gm-voice'), null, { timeout: 8000 }).then(() => true, () => false), 'a cap answer to Another clears Voice');
  // capped by a tick
  V.seen.anotherCap = false; V.seen.mode = 'cap';
  await vp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sleep(1500);
  check(await vp.$('#gm-rack .gm-voice') === null, 'capped: nothing shows');
  await V.c.close();
  // nobody on stage: the tick carries no name and no lines show
  await setStage(false);
  const V2 = await open('#gm', { mode: 'quiet' });
  V2.seen.mode = 'quiet';
  await V2.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  check(await until(async () => V2.seen.tick.length >= 1, 15000) && V2.seen.tick.every((t) => t.npc === undefined), 'no NPC on stage: the tick has no name');
  check(await V2.page.$('#gm-rack .gm-voice') === null, 'and Voice shows nothing');
  await V2.c.close();
  // Listening off with an NPC on stage: no tick, no lines
  await setStage(true);
  await api('PATCH', '/gm/stt', { want: 'off' });
  const V3 = await open('#gm', { mode: 'voice' });
  V3.seen.mode = 'voice';
  await V3.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await sleep(4000);
  check(V3.seen.tick.length === 0 && await V3.page.$('#gm-rack .gm-voice') === null, 'Listening off: no tick and no Voice');
  await V3.c.close();

  // ---- Stall: the offer lands in the Rack (not the box), a Mystery card is an ordinary card, Clear drops the offer ----
  await api('PATCH', '/gm/stt', { want: 'on' });
  await setStage(false);
  const S1 = await open('#gm', { mode: 'stall' });
  S1.seen.mode = 'stall';
  await S1.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  check(await S1.page.waitForSelector('#gm-rack .gm-stall', { timeout: 15000 }).then(() => true, () => false), 'Stall: the offer shows in the Rack');
  check(/runner bursts/.test(await S1.page.textContent('#gm-rack .gm-stall')) && /Clue/.test(await S1.page.textContent('#gm-rack .gm-stall')), 'with its kind and the offer');
  check(await S1.page.$('#gm-rack .gm-voice') === null, 'and no Voice without an NPC');
  await shot(S1.page, 'stall-rack');
  await S1.page.click('.gm-assist .as-launch, #as-launch');
  check(await S1.page.waitForFunction(() => /Mystery/.test((document.querySelector('#as-list') || {}).textContent || '') && !/runner bursts/.test((document.querySelector('#as-list') || {}).textContent || ''), null, { timeout: 8000 }).then(() => true, () => false), 'a Mystery card is a card in the box, the Stall offer is not');
  await S1.page.click('#gm-rack [data-gm="stallclear"]');
  check(await S1.page.$('#gm-rack .gm-stall') === null, 'Clear drops the offer');
  await S1.c.close();

  // ---- Handouts: the Mystery keeper's suggestion reaches the Rack once; not again after Dismiss or Show ----
  await api('PATCH', '/gm/stt', { want: 'on' });
  const Hd = await open('#gm', { mode: 'handout' });
  Hd.seen.mode = 'handout';
  const hp = Hd.page;
  await hp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  const offers = async () => (await hp.$$('#gm-rack .gm-offer')).length;
  const tickAgain = async (n) => { await hp.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); return until(async () => Hd.seen.tick.length >= n, 8000); };
  check(await hp.waitForSelector('#gm-rack .gm-offer[data-offer="ho-a"]', { timeout: 15000 }).then(() => true, () => false), 'Handout: the tick answer puts "Show handout?" in the Rack');
  check(/Show handout: Invented brass key?/.test(await hp.textContent('#gm-rack .gm-offer')) && /just reached the cue/.test(await hp.textContent('#gm-rack .gm-offer')), 'with the title and the reason');
  check(await tickAgain(2) && await offers() === 1, 'a second tick with the same handout leaves one offer');
  await hp.click('#gm-rack [data-offer="ho-a"] [data-gm="offer-dismiss"]');
  const n1 = Hd.seen.tick.length;
  check(await tickAgain(n1 + 1) && await sleep(600) === undefined && await offers() === 0, 'after Dismiss the same handout is not offered again');
  Hd.seen.handoutId = 'ho-b';
  const n2 = Hd.seen.tick.length;
  check(await tickAgain(n2 + 1) && await hp.waitForSelector('#gm-rack .gm-offer[data-offer="ho-b"]', { timeout: 8000 }).then(() => true, () => false), 'a different handout is offered');
  await hp.click('#gm-rack [data-offer="ho-b"] [data-gm="offer-show"]');
  check(await hp.waitForFunction(() => !document.querySelector('#gm-rack .gm-offer'), null, { timeout: 8000 }).then(() => true, () => false), 'Show takes the offer down');
  const n3 = Hd.seen.tick.length;
  check(await tickAgain(n3 + 1) && await sleep(600) === undefined && await offers() === 0, 'after Show the same handout is not offered again');
  await hp.reload();
  await hp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await until(async () => Hd.seen.tick.length >= n3 + 2, 15000); await sleep(800);
  check(await offers() === 0, 'and a reload does not bring it back');
  await Hd.c.close();

  // ---- the Screen: press -> preview -> gate -> Show (a prop), a block and a "not checked" that ask for a confirm, the wire, a hidden NPC, the board, the cite flag ----
  await api('PATCH', '/gm/stt', { want: 'on' });
  await api('PUT', '/gm/display', { kind: 'blank' });
  await api('PATCH', '/gm/ambient', { wire: null });
  const display = async () => (await api('GET', '/gm/display')).json.display;
  const Sc = await open('#gm', { mode: 'quiet' });
  Sc.seen.mode = 'quiet';
  const sp = Sc.page, sc = Sc.seen.sc;
  await sp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await sp.waitForSelector('.gm-assist .as-launch', { timeout: 10000 });
  await until(async () => Sc.seen.tick.length >= 1, 15000);
  await sp.keyboard.press('a');
  check(await sp.$eval('#as-panel', (e) => !e.hidden), 'Screen: the box is open');
  await sp.click('#as-tools > summary');
  check(await sp.$$eval('#as-screen button', (b) => b.map((x) => x.textContent.trim()).join('|')) === 'Draw them|Make the prop|Wire|Case board', 'Screen: the four buttons are in the box');
  await shot(sp, 'screen-buttons');
  // a prop: preview at once, Show disabled while the gatekeeper works, enabled with "Checked: clear"; nothing on the iPad until Show
  sc.gateDelay = 900;
  await sp.fill('#as-sc-ask', 'a ferry telegram');
  await sp.click('#as-sc-prop');
  check(await sp.waitForSelector('#gm-rack .gm-screenitem[data-screen]', { timeout: 10000 }).then(() => true, () => false), 'Screen prop: the preview lands in the Rack');
  check(sc.reqs.prop[0] && sc.reqs.prop[0].ask === 'a ferry telegram', 'Screen prop: the ask went with the request');
  let item = '#gm-rack .gm-screenitem[data-screen]';
  check(/FERRY STOP/.test(await sp.textContent(item + ' .gm-screen-text')) && /Checking/.test(await sp.textContent(item + ' .gm-gate')), 'Screen prop: the document and "Checking…" show at once');
  check(await sp.$eval(item + ' [data-gm="sc-show"]', (b) => b.disabled), 'Screen prop: Show is disabled while the check runs');
  check((await display()).kind === 'blank', 'Screen prop: nothing reaches the iPad before Show');
  check(await sp.waitForFunction(() => /Checked: clear/.test(document.querySelector('#gm-rack .gm-screenitem .gm-gate').textContent), null, { timeout: 10000 }).then(() => true, () => false), 'Screen prop: the gate answers "Checked: clear"');
  check(sc.reqs.gate[sc.reqs.gate.length - 1].kind === 'prop' && /FERRY STOP/.test(sc.reqs.gate[sc.reqs.gate.length - 1].text), 'Screen prop: the gatekeeper was sent the item');
  check(await sp.$eval(item + ' [data-gm="sc-show"]', (b) => !b.disabled), 'Screen prop: Show is enabled');
  check((await display()).kind === 'blank', 'Screen prop: still nothing on the iPad');
  await shot(sp, 'screen-prop-ready');
  await sp.click(item + ' [data-gm="sc-show"]');
  check(await until(async () => (await display()).kind === 'text', 8000), 'Screen prop: Show puts it on the iPad');
  let d = await display();
  check(d.title === 'Telegram' && /FERRY STOP/.test(d.text) && sc.dialogs.length === 0, 'Screen prop: as a text display, with no confirm for a clear item');
  // a block: reasons shown; Show asks first; a refused confirm leaves the iPad alone; an accepted one shows it
  await api('PUT', '/gm/display', { kind: 'blank' });
  sc.gate = 'block'; sc.gateDelay = 0;
  await sp.click('#gm-rack .gm-screenitem [data-gm="sc-dismiss"]');
  await sp.click('#as-sc-prop');
  check(await sp.waitForFunction(() => /Blocked/.test((document.querySelector('#gm-rack .gm-screenitem .gm-gate') || {}).textContent || ''), null, { timeout: 10000 }).then(() => true, () => false), 'Screen block: the badge says Blocked');
  check(/names the buyer/.test(await sp.textContent(item)) && /#2 Invented entry/.test(await sp.textContent(item)), 'Screen block: the reasons and the entry it would reveal are shown');
  await shot(sp, 'screen-blocked');
  sc.accept = false;
  await sp.click(item + ' [data-gm="sc-show"]');
  await sleep(500);
  check(sc.dialogs.length === 1 && /blocked/i.test(sc.dialogs[0]) && (await display()).kind === 'blank', 'Screen block: Show asks to confirm, and a No leaves the iPad alone');
  sc.accept = true;
  await sp.click(item + ' [data-gm="sc-show"]');
  check(await until(async () => (await display()).kind === 'text', 8000) && sc.dialogs.length === 2, 'Screen block: after a Yes the tap decides and it shows');
  // not checked (the gatekeeper errors): fails closed, a confirm is needed; a wire bulletin goes to the ambient document and Clear takes it off
  sc.gate = 'error'; sc.accept = false;
  await sp.click('#gm-rack .gm-screenitem [data-gm="sc-dismiss"]');
  await sp.click('#as-sc-wire');
  check(await sp.waitForFunction(() => /Not checked/.test((document.querySelector('#gm-rack .gm-screenitem .gm-gate') || {}).textContent || ''), null, { timeout: 10000 }).then(() => true, () => false), 'Screen wire: a gatekeeper that errors shows "Not checked"');
  const nd = sc.dialogs.length;
  await sp.click(item + ' [data-gm="sc-show"]');
  await sleep(500);
  check(sc.dialogs.length === nd + 1 && /did not check/.test(sc.dialogs[nd]) && !((await api('GET', '/gm/ambient')).json.doc.wire || []).length, 'Screen wire: not checked needs a confirm, and a No adds nothing');
  sc.accept = true;
  await sp.click(item + ' [data-gm="sc-show"]');
  check(await until(async () => ((await api('GET', '/gm/ambient')).json.doc.wire || []).length === 1, 8000), 'Screen wire: after a Yes the bulletin joins the ambient wire');
  const wire = (await api('GET', '/gm/ambient')).json.doc.wire;
  check(/ferry timetable/.test(wire[0].text), 'Screen wire: it is the bulletin text');
  check(await sp.waitForSelector('#gm-rack [data-gm="sc-wireclear"]', { timeout: 8000 }).then(() => true, () => false), 'Screen wire: a Clear button appears');
  await sp.click('#gm-rack [data-gm="sc-wireclear"]');
  check(await until(async () => !((await api('GET', '/gm/ambient')).json.doc.wire || []).length, 8000), 'Screen wire: Clear takes it off the ambient wire');
  // a portrait: preview from the figure kit with the unknown name dropped; Add saves a HIDDEN NPC and shows nothing
  sc.gate = 'pass'; sc.accept = false;
  await api('PUT', '/gm/display', { kind: 'blank' });
  await sp.click('#gm-rack .gm-screenitem [data-gm="sc-dismiss"]');
  await sp.fill('#as-sc-name', 'Test Person');
  await sp.click('#as-sc-portrait');
  check(await sp.waitForSelector('#gm-rack .gm-screen-fig svg', { timeout: 20000 }).then(() => true, () => false), 'Screen portrait: the figure kit draws the preview in the Rack');
  check(sc.reqs.portrait[0] && sc.reqs.portrait[0].name === 'Test Person' && /eyes: /.test(sc.reqs.portrait[0].vocab) && /cloth-black/.test(sc.reqs.portrait[0].vocab), 'Screen portrait: the typed name and the kit vocabulary went with the request');
  check(/not-a-kit-name/.test(await sp.textContent(item)), 'Screen portrait: the dropped name is noted');
  check(await sp.waitForFunction(() => /Checked: clear/.test(document.querySelector('#gm-rack .gm-screenitem .gm-gate').textContent), null, { timeout: 10000 }).then(() => true, () => false), 'Screen portrait: the gate runs on it too');
  check(await sp.$('#gm-rack [data-gm="sc-show"]') === null, 'Screen portrait: there is no Show, only Add (showing is the normal reveal flow)');
  await shot(sp, 'screen-portrait');
  const before = (await api('GET', '/npcs')).json.docs.length;
  await sp.click(item + ' [data-gm="sc-add"]');
  check(await until(async () => (await api('GET', '/npcs')).json.docs.length === before + 1, 8000), 'Screen portrait: Add saves an NPC');
  const made = (await api('GET', '/npcs')).json.docs.find((x) => x.doc.name === 'Heard Name');   // the mocked route answers with its own name; the real server puts the typed one first (unit-tested)
  check(made && made.doc.revealed === false && made.doc.spec && made.doc.spec.hair && !(made.doc.spec.face || {}).eyewear, 'Screen portrait: it is hidden (revealed false) with the cleaned spec');
  check((await display()).kind === 'blank', 'Screen portrait: nothing reached the iPad');
  // the case board: code only, checked, then Show
  await sp.click('#gm-rack .gm-screenitem [data-gm="sc-dismiss"]');
  await sp.click('#as-sc-board');
  check(await sp.waitForFunction(() => /Checked: clear/.test((document.querySelector('#gm-rack .gm-screenitem .gm-gate') || {}).textContent || ''), null, { timeout: 10000 }).then(() => true, () => false), 'Screen board: it passes the gatekeeper like the rest');
  check(sc.reqs.gate[sc.reqs.gate.length - 1].kind === 'board', 'Screen board: gated as a board');
  await sp.click(item + ' [data-gm="sc-show"]');
  check(await until(async () => /WHAT WE KNOW/.test((await display()).text || ''), 8000), 'Screen board: Show puts the board on the iPad');
  await api('PUT', '/gm/display', { kind: 'blank' });
  await Sc.c.close();
  // a Ref card with a bad page cite gets a small flag; it does not block anything
  const Cf = await open('#gm', { mode: 'card' });
  check(await Cf.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 }).then(() => true, () => false) && await until(async () => Cf.seen.sc.reqs.gate.some((r) => r.kind === 'card'), 15000), 'Cite flag: the Ref card with a page cite was spot-checked');
  const cg = Cf.seen.sc.reqs.gate.find((r) => r.kind === 'card');
  check(cg && cg.cites && cg.cites.join() === 'p. 12', 'Cite flag: the cite was sent for the check (' + JSON.stringify(cg && cg.cites) + ')');
  await Cf.page.keyboard.press('a');
  check(await Cf.page.waitForSelector('.gm-assist .as-card .as-citeflag', { timeout: 8000, state: 'attached' }).then(() => true, () => false), 'Cite flag: the card carries a small "cite?" flag');
  check(/Invented rule slip/.test(await Cf.page.textContent('.gm-assist .as-card .as-text')), 'Cite flag: and the card is shown as before');
  await Cf.c.close();

  // ---- a phone: no box ----
  await api('PATCH', '/gm/stt', { want: 'on' });
  const M = await open('#gm', { width: 390, height: 800, mobile: true, mode: 'voice' });
  M.seen.mode = 'voice';
  await sleep(4000);
  check(await M.page.$eval('.gm-assist', (e) => getComputedStyle(e).display === 'none').catch(() => true), 'a phone has no Claude box');
  check(M.seen.tick.length === 0, 'and it does not poll, even with an NPC on stage');
  check(await M.page.$('#gm-rack .gm-voice') === null, 'and Voice shows nothing on a phone');
  await M.c.close();

  // ---- not the GM page: no box ----
  const H = await open('#');
  await sleep(2500);
  check(await H.page.$('.gm-assist') === null && H.seen.tick.length === 0, 'the home page has no Claude box and calls nothing');
  await H.c.close();
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
