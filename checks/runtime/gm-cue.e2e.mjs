// Co-GM by cue on the real GM page, in a real browser (ticket C4d; app/gm/cogm.js cueNext, gm-page.js the cue lane, app/cue.js the parser). The table, the cast, the capture bar, the
// transcript and POST /api/gm/assist/act in cue mode with `parsed` are the REAL local Worker (no model, no key, $0): the fake "transcript" is real rows posted to /api/gm/transcript, so
// the quote check, the keys and `seen` are the Worker's. The only fakes are the Blade panel's tick and cards (no model) and the model path of /act (a cue the page could not parse). Every
// name and sentence is invented.
//   shown: a cue lands within 4 s of its line, with a "working…" card at once and the strip popped with the panel closed; "and mark two" fills the clock and Undo still works; a cue split
//   over two lines under different speaker labels lands once; two GM pages apply one cue once (one 'act', one 'seen'); a hidden page that comes back offers an old cue instead of
//   acting; "Blade, undo" and the card's Undo both work, and with two pages only one undoes; "call him ..." renames the last NPC; an NPC with no name gets a rolled name; a refused or
//   missing cue is a card and is never posted; a lost answer is "Didn't land" and is never retried; the model path is used only for a cut-off command; with the switch off the lane is
//   a no-op; and nothing a cue makes is visible to a player or written to the iPad.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=8881] node checks/runtime/gm-cue.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8881);
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

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-cue-e2e-'));
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
const seen = { act: [], responses: [], requests: [], dialogs: [], accept: true, promptText: '', delayAct: 0, modelReply: null };
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
  await c.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 9 }));
  await c.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [] }));
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
  const tapCard = async (re, label, pg = page) => {
    const cd = await cardLike(re, 6000, pg); if (!cd) return false;
    const s = '#as-list .as-card[data-id="' + cd.id + '"]';
    if ((await pg.$eval(s, (e) => e.getAttribute('data-open'))) !== '1') await pg.click(s + ' .as-fold');
    await pg.click(s + ' .as-act:has-text("' + label + '")', { timeout: 3000 });
    return true;
  };
  const undoOf = async (re, pg = page) => {
    const cd = await cardLike(re, 6000, pg); if (!cd) return false;
    const s = '#as-list .as-card[data-id="' + cd.id + '"]';
    if ((await pg.$eval(s, (e) => e.getAttribute('data-open'))) !== '1') await pg.click(s + ' .as-fold');
    await pg.click(s + ' .as-undo', { timeout: 3000 });
    return true;
  };
  /* say a cue and time it to its card: ms from the POST of the line to a card whose text matches */
  const cue = async (text, re, o = {}) => {
    await sleep(2200);               // the page makes at most one cue call every 2 s (TIMING.cueGap): space the cues so each time measures the lane, not the gap before it
    const l = await say(text, o);
    const cd = await cardLike(re, o.ms || 8000, o.page || page);
    const ms = cd ? Date.now() - l.t : -1;
    if (cd && o.measure !== false) lands.push(ms);
    return { line: l, card: cd, ms };
  };

  // ============ off: the lane is a no-op and the console is as it was ============
  await say('Blade, make a four segment clock called Off Test Invented');
  await sleep(3500);
  check(!(await clockNamed('Off Test Invented')) && actsNow() === 0, 'switch off: a cue line makes nothing and posts nothing');
  check(!seen.requests.some((r) => /\/api\/gm\/transcript\?after=/.test(r)) && !seen.requests.some((r) => /assist\/act/.test(r)), 'switch off: the page does not poll the transcript or call /act (the console is as it is today)');
  check(await page.$eval(sw, (b) => b.getAttribute('aria-pressed') === 'false' && /off/i.test(b.textContent)), 'switch off: it says Off');
  check(await page.$eval('#as-cogm-also-row', (e) => e.hidden === true), 'switch off: the second switch is not shown');

  // ============ on means cue only ============
  check(await switchOn(), 'the Co-GM switch turns on (Listening is on)');
  check(await page.$eval('#as-cogm-also', (b) => b.checked === false && !b.closest('label').hidden) && /Also listen for uncued decisions \(offers only\)/.test(await page.$eval('#as-cogm-also-row', (e) => e.textContent)), 'on: the second switch "Also listen for uncued decisions (offers only)" is shown and OFF');
  await sleep(2600);
  check(actsNow() === 0 && !(await clockNamed('Off Test Invented')), 'the cue said before the switch was on is not replayed');
  await say('We could make a four segment clock called Plain Talk Invented, I suppose');
  await sleep(4500);
  check(actsNow() === 0 && !(await clockNamed('Plain Talk Invented')), 'uncued talk is not read: no /act call, no clock (the second switch is off)');

  // ============ a cue lands within 4 s: working… at once, the strip with the panel closed ============
  seen.delayAct = 1500;
  await page.keyboard.press('a');                                  // close the panel: the strip must still pop
  await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left >= innerWidth - 10 || document.querySelector('#as-panel').hidden, null, { timeout: 4000 });
  const l1 = await say('Blade, make a six segment clock called Escape Invented');
  const bannerWorking = await until(() => page.$eval('#as-banner', (b) => !b.hidden && /Working/.test(b.textContent)).catch(() => false), 4500, 50);
  check(!!bannerWorking, 'working…: the strip slides out at once with the panel closed ("' + (await page.$eval('#as-banner', (b) => b.textContent).catch(() => '')) + '")');
  const wcard = await until(async () => (await page.evaluate(() => window.__ctl.state().cards)).find((x) => /Working/.test(x.headline)), 3000, 50);
  check(!!wcard && wcard.id.startsWith('cogm|cue|w'), 'working…: a "Working…" card is on the panel while the Worker answers');
  const done1 = await until(async () => (await page.evaluate(() => window.__ctl.state().cards)).find((x) => x.headline === 'Clock made (hidden): Escape Invented (6)'), 8000, 50);
  const ms1 = Date.now() - l1.t; seen.delayAct = 0;
  check(!!done1, 'the clock card arrives: ' + (done1 && done1.headline));
  check(!(await page.evaluate(() => window.__ctl.state().cards)).some((x) => /Working/.test(x.headline)), 'and the working… card is gone');
  await page.keyboard.press('a');                                  // open the panel again
  await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 });
  const esc = await clockNamed('Escape Invented');
  check(esc && esc.size === 6 && esc.hidden === true && esc.filled === 0 && esc.kind === 'danger', 'it is a hidden, empty, six-segment clock on the real table');
  const a1 = seen.act[0];
  check(seen.act.length === 1 && a1.body.mode === 'cue' && a1.body.cueLineId === l1.id && a1.body.seenOk === true && Array.isArray(a1.body.parsed) && a1.body.parsed.length === 1 && !('key' in a1.body.parsed[0]) && a1.body.parsed[0].type === 'clock_add' && /^Blade, make a six/.test(a1.body.parsed[0].quote), 'POST /act: mode cue, the cue line\'s id, seenOk, parsed with NO key and the quote from the wake word');
  const r1 = seen.responses[0];
  check(r1 && r1.status === 200 && r1.body.actions.length === 1 && r1.body.actions[0].mode === 'act' && /^cue:/.test(r1.body.actions[0].key) && r1.body.spend.tick === 0, 'the Worker answered with an act and its own key (cue:...), no model spend');
  const k1 = r1 && r1.body.actions[0].key;
  const s1 = await cardLike(/^Clock made \(hidden\): Escape Invented/);
  check(s1 && s1.id === 'cogm|' + k1 && s1.kind === 'done' && /Heard at \d\d:\d\d: .Blade, make a six segment clock called Escape Invented/.test(s1.html.replace(/<[^>]+>/g, '')), 'the card is green, keyed by the Worker\'s key, and quotes what was heard ' + JSON.stringify(s1 && [s1.id, s1.kind, s1.html.replace(/<[^>]+>/g, ' ').slice(0, 300)]) + k1);
  await page.click('#as-list .as-card[data-id="cogm|' + k1 + '"] .as-fold').catch(() => {});

  // ============ more cues: timing, "and mark two", a split cue, the model path ============
  const t2 = await cue('Blade, make a four segment clock called Ferry Late Invented and mark two', /^Clock made \(hidden\): Ferry Late Invented/);
  check(t2.card && t2.ms <= 4000, 'a cue lands within 4 s of its line (' + t2.ms + ' ms)');
  const ferry = await clockNamed('Ferry Late Invented');
  check(ferry && ferry.size === 4 && ferry.filled === 2 && ferry.hidden === true, '"and mark two": the clock is made with two marked (filled carried through to the table)');
  check(/, 2 marked/.test(t2.card.text), 'and the card says so: ' + t2.card.text);

  await sleep(2200);
  const nSplit0 = actsNow();
  const sa = await say('Blade, make a six', { speaker: 1 });
  await sleep(500);
  const sb = await say('segment clock called Night Boat Invented', { speaker: 0 });
  const split = await cardLike(/^Clock made \(hidden\): Night Boat Invented/, 9000);
  const msSplit = Date.now() - sa.t; if (split) lands.push(msSplit);
  check(!!split && msSplit <= 4000, 'a cue split over two lines under different speaker labels lands (' + msSplit + ' ms)');
  await sleep(2500);
  check((await clocksNow()).filter((k) => k.name === 'Night Boat Invented').length === 1 && (await clockNamed('Night Boat Invented')).size === 6, 'and lands ONCE, at six segments');
  const bs = seen.act.slice(nSplit0);
  check(bs.length === 1 && bs[0].body.cueLineId === sa.id && bs[0].body.from === sa.seq && bs[0].body.to === sb.seq && !!bs[0].body.parsed && /^Blade, make a six segment clock called Night Boat Invented$/.test(bs[0].body.parsed[0].quote), 'one /act call: the first line\'s id, from..to covering both lines, parsed, the quote spans the join with one space');

  // the model path: a cut-off command with no next line (the page waits cueWait, then sends it without parsed)
  await T({ cueWait: 1500 });
  const nModel0 = actsNow();
  const lm = await say('Blade, make a six');
  seen.modelReply = { actions: [{ type: 'clock_add', mode: 'act', key: 'cue:fakemodelkey:0', quote: 'Blade, make a six', at: '', confidence: 0.9, name: 'Model Path Invented', size: 6, hidden: true, filled: 0 }], dropped: [], spend: SPEND };
  const mp = await cardLike(/^Clock made \(hidden\): Model Path Invented/, 9000);
  const mcall = seen.act[nModel0];
  check(!!mp && seen.act.length === nModel0 + 1 && mcall.body.mode === 'cue' && !('parsed' in mcall.body) && mcall.body.cueLineId === lm.id, 'the model path: a still-cut-off command is sent WITHOUT parsed, with its cue line id (' + (Date.now() - lm.t) + ' ms after it was said)');
  await T({ cueWait: 6000 });

  // ============ cards that are not acted on: refused, which, size, clock, name ============
  await T({ cueWait: 1500 });          // a cue that is missing something waits cueWait for one more line before it becomes a card (6 s in use)
  const nCards0 = actsNow();
  await say('Blade, show the harbour map to the table');
  const grey = await cardLike(/can.t do that yet/);
  check(grey && grey.kind === 'note' && /^Heard .Blade, show the harbour map to the table.: I can.t do that yet\.$/.test(grey.text), 'refused: a grey card says it was heard: ' + (grey && grey.text));
  await say('Blade, take a stress from the Hound');
  check(!!(await cardLike(/stress from the Hound.*can.t do that yet/)), 'refused: a sheet write too');
  const nTick0 = actsNow();
  await cue('Blade, tick that', /^Ticked: Model Path Invented 0→1\/6/);
  check(actsNow() === nTick0 + 1 && (await clockNamed('Model Path Invented')).filled === 1, 'tick that: means the clock Blade last made (Model Path Invented), within the last 10 minutes');
  const nCards1 = actsNow();
  await say('Blade, tick Invented');
  const which = await cardLike(/^Which clock\?/, 9000);
  check(which && which.kind === 'idea' && ['Escape Invented', 'Ferry Late Invented', 'Night Boat Invented', 'Model Path Invented', 'Seed Clock Invented'].every((n) => which.acts.includes(n)), 'which: a name that fits several clocks ("tick Invented") is a yellow card with a button per clock: ' + (which && which.acts.join(', ')));
  await say('Blade, make a clock called Sizeless Invented');
  const size = await cardLike(/^How big is .Sizeless Invented.\?/, 9000);
  check(size && size.kind === 'idea' && ['4', '6', '8'].every((n) => size.acts.includes(n)), 'size: "make a clock" with no size asks 4, 6 or 8: ' + (size && size.acts.join(', ')));
  await say('Blade, tick Nonexistent Pier');
  const noClock = await cardLike(/^No clock called .Nonexistent Pier.: make one\?/);
  check(!!noClock && noClock.kind === 'idea', 'clock: "No clock called Nonexistent Pier: make one?" is a yellow card');
  await sleep(500);
  check(actsNow() === nCards1 && nCards0 + 1 === nCards1, 'none of those cards was posted (no /act call for a refused or missing cue)');
  const nSz = actsNow();
  check(await tapCard(/^How big is .Sizeless Invented.\?/, '8'), 'size: tapped 8');
  check(await until(async () => { const k = await clockNamed('Sizeless Invented'); return k && k.size === 8 && k.hidden === true; }, 8000), 'size: the hidden eight-segment clock is made from the tap');
  check(seen.act.length === nSz + 1 && seen.act[nSz].body.parsed[0].size === 8 && !('key' in seen.act[nSz].body.parsed[0]), 'size: the tap is posted as a cue (parsed, no key)');
  check(await tapCard(/^Which clock\?/, 'Escape Invented'), 'which: tapped Escape Invented');
  check(await until(async () => (await clockNamed('Escape Invented')).filled === 1, 8000), 'which: it ticks that clock by one');
  await T({ cueWait: 6000 });
  // "tick that" now means the clock Blade last ticked (within 10 minutes)
  await cue('Blade, tick that', /^Ticked: Escape Invented 1→2\/6/);
  check((await clockNamed('Escape Invented')).filled === 2, 'tick that: after a tick, "tick that" means the clock Blade last ticked');

  // ============ an NPC, a rolled name, a rename ============
  const t3 = await cue('Blade, new NPC called Wexley Invented, a bouncer', /^New NPC \(hidden\): Wexley Invented/);
  const wexley = (await npcsNow()).find((n) => n.doc.name === 'Wexley Invented');
  check(wexley && wexley.doc.revealed === false && wexley.doc.tags.includes('cogm') && wexley.doc.role === 'bouncer' && wexley.doc.firstSeen === null, 'a named NPC is made hidden (revealed: false), tagged cogm ' + JSON.stringify(wexley && wexley.doc));
  const t4 = await cue('Blade, call him Big Sal Invented', /Renamed: Big Sal Invented/);
  check(await until(async () => (await npcsNow()).some((n) => n.id === wexley.id && n.doc.name === 'Big Sal Invented'), 6000), '"call him Big Sal": the last NPC Blade made is renamed on the real cast');
  check(await until(async () => (await cardLike(/^New NPC \(hidden\): Big Sal Invented/)), 4000), 'and its card follows the rename');
  const nBefore = (await npcsNow()).length;
  const t5 = await cue('Blade, new NPC who looks like a tired ferryman', /^New NPC \(hidden\): .+ \(name rolled\)/);
  const rolled = t5.card && /^New NPC \(hidden\): (.+) \(name rolled\)$/.exec(t5.card.text);
  const rolledDoc = rolled && (await npcsNow()).find((n) => n.doc.name === rolled[1]);
  check(rolled && rolled[1].length > 1 && rolledDoc && rolledDoc.doc.revealed === false && rolledDoc.doc.description === 'a tired ferryman' && (await npcsNow()).length === nBefore + 1, 'no name: the generator rolls one (' + (rolled && rolled[1]) + '), the card says name rolled, the NPC is hidden with the look');
  check(t5.card && t5.card.acts.includes('Rename'), 'and the card has a Rename button');
  seen.promptText = 'Tired Ferryman Renamed';
  const rs = '#as-list .as-card[data-id="' + t5.card.id + '"]';
  if ((await page.$eval(rs, (e) => e.getAttribute('data-open'))) !== '1') await page.click(rs + ' .as-fold');
  await page.click(rs + ' .as-act:has-text("Rename")');
  check(await until(async () => (await npcsNow()).some((n) => n.doc.name === 'Tired Ferryman Renamed'), 6000) && !!(await cardLike(/^New NPC \(hidden\): Tired Ferryman Renamed$/)), 'Rename on the rolled card renames it (and drops "name rolled")');

  // ============ Undo: the card's button, and "Blade, undo" ============
  await cue('Blade, make a four segment clock called Undo Target Invented', /^Clock made \(hidden\): Undo Target Invented/);
  check(!!(await clockNamed('Undo Target Invented')), 'undo: a clock to undo is made');
  await undoOf(/^Clock made \(hidden\): Undo Target Invented/);
  check(await until(async () => !(await clockNamed('Undo Target Invented')), 6000), 'Undo on the card takes the clock off the table');
  await cue('Blade, make a four segment clock called Voice Undone Invented', /^Clock made \(hidden\): Voice Undone Invented/);
  check(!!(await clockNamed('Voice Undone Invented')), 'undo: another clock is made');
  const nUndo0 = actsNow();
  const uc = await cue('Blade, undo', /^Undid: Clock made \(hidden\): Voice Undone Invented/);
  check(!!uc.card && await until(async () => !(await clockNamed('Voice Undone Invented')), 6000), '"Blade, undo" takes the newest thing Blade made off the table');
  check(!!(await clockNamed('Night Boat Invented')) && !!(await clockNamed('Seed Clock Invented')), 'and nothing else: earlier clocks and the GM\'s own clock stand');
  await sleep(300);
  check(seen.act.length === nUndo0 + 1 && seen.act[nUndo0].body.parsed[0].type === 'undo' && seen.responses[seen.responses.length - 1].body.actions[0].mode === 'act', 'the undo came back from /act as an act (so only one page undoes)');
  const vcard = await cardLike(/^Clock made \(hidden\): Voice Undone Invented/);
  check(vcard && /Undone/.test(vcard.html), 'its card says Undone');
  // a changed clock is not clobbered: the same compare-and-swap as the U key
  await cue('Blade, make a four segment clock called Changed Invented', /^Clock made \(hidden\): Changed Invented/);
  const chg = await clockNamed('Changed Invented');
  await api('PATCH', '/campaign', { clockOps: [{ id: chg.id, filled: 3 }] });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sleep(1500);
  const uc2 = await cue('Blade, undo', /Not undone: it changed since/);
  check(!!uc2.card && (await clockNamed('Changed Invented')).filled === 3, '"Blade, undo" on a clock that changed since is REFUSED: the clock stays (the compare-and-swap)');
  await undoOf(/^Clock made \(hidden\): Changed Invented/);
  await sleep(500);
  const forceBtn = await cardLike(/^Clock made \(hidden\): Changed Invented/);
  check(forceBtn && forceBtn.acts.includes('Undo anyway'), 'and the card offers Undo anyway');
  await page.click('#as-list .as-card[data-id="' + forceBtn.id + '"] .as-act:has-text("Undo anyway")');
  check(await until(async () => !(await clockNamed('Changed Invented')), 6000), 'Undo anyway removes it');
  // rename a clock by voice
  await cue('Blade, make a four segment clock called Rename Me Invented', /^Clock made \(hidden\): Rename Me Invented/);
  await cue('Blade, rename that to Renamed By Voice Invented', /Renamed: Renamed By Voice Invented/);
  check(await until(async () => !!(await clockNamed('Renamed By Voice Invented')) && !(await clockNamed('Rename Me Invented')), 6000), '"Blade, rename that": the last clock Blade made is renamed through clockOps');
  await cue('Blade, undo', /^Undid: Clock made \(hidden\): Renamed By Voice Invented/);
  check(await until(async () => !(await clockNamed('Renamed By Voice Invented')), 6000), 'and Undo after a rename still works (the rename is not "changed since")');

  // ============ a lost answer: Didn't land, never retried, and a late answer is still used ============
  await T({ cueAnswer: 1200 });
  seen.delayAct = 3200;
  const nLost0 = actsNow();
  const ll = await say('Blade, make a four segment clock called Late Answer Invented');
  const dl = await cardLike(/^Didn.t land: say it again$/, 6000);
  check(!!dl && dl.kind === 'warn', 'a lost answer: after the timeout the card says "Didn\'t land: say it again"');
  const late = await cardLike(/^Clock made \(hidden\): Late Answer Invented/, 8000);
  seen.delayAct = 0; await T({ cueAnswer: 10000 });
  check(!!late && !!(await clockNamed('Late Answer Invented')) && (await clocksNow()).filter((k) => k.name === 'Late Answer Invented').length === 1, 'and a late answer is still applied, once');
  await sleep(2500);
  check(actsNow() === nLost0 + 1, 'the cue was never auto-retried (one /act call: ' + (actsNow() - nLost0) + ')');

  // ============ a hidden page that comes back offers an old cue ============
  await T({ cueStale: 3000 });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get() { return true; } }); });
  const nOld0 = actsNow();
  await say('Blade, make a four segment clock called Stale Invented');
  await sleep(4500);
  check(actsNow() === nOld0 && !(await clockNamed('Stale Invented')), 'hidden: a hidden page reads nothing and acts on nothing');
  await page.evaluate(() => { delete document.hidden; });
  const old = await cardLike(/^Old cue: .Blade, make a four segment clock called Stale Invented./, 8000);
  check(old && old.kind === 'idea' && old.acts.includes('Do it'), 'back in view: the old cue is a YELLOW card with Do it');
  await sleep(1500);
  check(actsNow() === nOld0 && !(await clockNamed('Stale Invented')), 'and it did not act by itself');
  check(await tapCard(/^Old cue: /, 'Do it'), 'Do it tapped');
  check(await until(async () => !!(await clockNamed('Stale Invented')), 8000), 'Do it posts the cue and the clock is made');
  await T({ cueStale: 60000 });

  // ============ two GM pages: one cue acts once ============
  const page2 = await open(2);
  check(await switchOn(page2), 'page 2: Co-GM on');
  await page2.bringToFront(); await page.bringToFront();
  const n2 = seen.responses.length;
  const two = await say('Blade, make a four segment clock called Twice Heard Invented');
  const bothAnswered = await until(() => seen.responses.slice(n2).filter((r) => r.body.actions && r.body.actions.length).length >= 2, 10000, 50);
  check(!!bothAnswered, 'two pages: both posted the cue');
  await sleep(1500);
  const modes = seen.responses.slice(n2).filter((r) => r.body.actions && r.body.actions.length).map((r) => r.page + ':' + r.body.actions[0].mode).sort();
  check(modes.length === 2 && modes.filter((m) => /:act$/.test(m)).length === 1 && modes.filter((m) => /:seen$/.test(m)).length === 1, 'two pages: one comes back act and one seen (' + modes.join(', ') + ')');
  check((await clocksNow()).filter((k) => k.name === 'Twice Heard Invented').length === 1, 'two pages: ONE clock on the table');
  const actedPage = seen.responses.slice(n2).find((r) => r.body.actions[0].mode === 'act').page;
  const otherPg = actedPage === 1 ? page2 : page, actPg = actedPage === 1 ? page : page2;
  check(!!(await cardLike(/^Clock made \(hidden\): Twice Heard Invented/, 4000, actPg)) && !(await cards(otherPg)).some((x) => /Twice Heard Invented/.test(x.text) && x.kind === 'done'), 'two pages: only the page that acted shows the green card');
  // "Blade, undo" with two pages undoes once: another clock is made first so a double undo would take two
  await cue('Blade, make a four segment clock called Twice Two Invented', /^Clock made \(hidden\): Twice Two Invented/, { page: page, measure: false });
  const n3 = seen.responses.length;
  await say('Blade, undo');
  await until(() => seen.responses.slice(n3).filter((r) => r.body.actions && r.body.actions.length).length >= 2, 10000, 50);
  await sleep(2500);
  const um = seen.responses.slice(n3).filter((r) => r.body.actions && r.body.actions.length).map((r) => r.body.actions[0].mode).sort();
  check(um.join() === 'act,seen', 'two pages: "Blade, undo" comes back act on one page and seen on the other (' + um.join(', ') + ')');
  check(!(await clockNamed('Twice Two Invented')) && !!(await clockNamed('Twice Heard Invented')), 'two pages: it undid ONE thing (the newest); the earlier clock stands');
  await page2.close();

  // ============ nothing a cue makes is visible to players, or reaches the iPad ============
  const cueClocks = ['Escape Invented', 'Ferry Late Invented', 'Night Boat Invented', 'Sizeless Invented', 'Late Answer Invented', 'Stale Invented', 'Twice Heard Invented', 'Model Path Invented'];
  const gmClocks = await clocksNow(), plClocks = await clocksNow(PLAYER);
  check(cueClocks.every((n) => gmClocks.some((k) => k.name === n && k.hidden === true)), 'every clock a cue made is hidden: true on the table');
  // A player's table page (the player data poll, drawn). `hidden` is presentation only in the campaign document by design (CAMPAIGN.md), so the page is what is checked.
  const pc = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': PLAYER }, viewport: { width: 900, height: 900 }, serviceWorkers: 'block' });
  const pp = await pc.newPage();
  await pp.goto(BASE + '/#t');
  await pp.waitForSelector('.tp-clock[data-id="c_seed"]', { timeout: 20000 });
  const plIds = await pp.$$eval('.tp-clock', (ns) => ns.map((n) => n.dataset.id));
  const plAllText = await pp.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('input,textarea')].map((i) => i.value).join(' '));
  check(plIds.join() === 'c_seed' && !cueClocks.some((n) => plAllText.includes(n)), 'a player\'s table page shows the GM\'s own clock only (' + plIds.join() + '), none of the cue\'s clocks, in text or fields');
  const plNpcs = JSON.stringify(await npcsNow(PLAYER));
  check(plNpcs.includes('Marta Quillfeather') && !/Big Sal|Wexley|Tired Ferryman|ferryman|bouncer/.test(plNpcs), 'the player\'s read of the cast carries the revealed NPC and none of the cue\'s');
  check(!(await npcsNow()).some((n) => /cogm/.test(JSON.stringify(n.doc.tags)) && n.doc.revealed === true), 'every NPC a cue made is still revealed: false');
  check((await api('GET', '/gm/display')).json.display.kind === display0, 'the iPad display is as it was (' + display0 + ')');
  await pc.close();
  const writes = seen.requests.filter((r) => /^\d (PUT|POST|PATCH|DELETE) /.test(r));
  check(!writes.some((r) => /\/api\/gm\/(display|ambient)/.test(r)), 'no request wrote the display or the ambient document (nothing reached the iPad): ' + writes.filter((r) => /gm\/(display|ambient)/.test(r)).join('; '));
  check(!writes.some((r) => /\/api\/characters/.test(r)), 'no request wrote a player\'s sheet');
  check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));

  console.log('cue-to-card times (ms): ' + lands.join(', ') + '  | median ' + med(lands) + ' ms over ' + lands.length + ' cues');
  await c.close();
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
